import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFinalProduct } from '../public/final-product.js';
import { analyze } from '../public/analyzer.js';
import { EXAMPLES } from '../public/examples.js';
import { exportRow } from '../public/domain.js';

const source = () => analyze(EXAMPLES['오픈뱅킹 정률']).results[0];

test('최종 수정값과 상품명을 복사하되 분석 원본과 근거는 보존한다', () => {
  const original = source(),
    before = structuredClone(original);
  const draft = buildFinalProduct(
    original,
    {
      FEE_SMT_CALC_MHOD_DVCD: 'HALF_UP',
      FEE_SMT_CALC_UNIT_VAL: '0.01',
      SIGN_APLY_LOCT_DVCD: 'AFTER',
    },
    { code: ' FINAL-01 ', name: ' 최종 정산 상품 ' },
  );
  assert.deepEqual(draft.errors, []);
  assert.equal(draft.changedFields.length, 3);
  assert.equal(draft.result.fields.FEE_SMT_CALC_UNIT_VAL.value, 0.01);
  assert.deepEqual(draft.result.fields.SIGN_APLY_LOCT_DVCD.evidence, []);
  const [keys, values] = exportRow(draft.result, 'tsv', draft.name)
    .split('\n')
    .map((row) => row.split('\t'));
  const copied = Object.fromEntries(keys.map((key, i) => [key, values[i]]));
  assert.equal(copied.SMT_GDS_CD, 'FINAL-01');
  assert.equal(copied.SMT_GDS_NM, '최종 정산 상품');
  assert.equal(copied.SIGN_APLY_LOCT_DVCD, 'AFTER');
  assert.equal(copied.FEE_SMT_CALC_UNIT_VAL, '0.01');
  assert.match(exportRow(draft.result, 'markdown', draft.name), /FINAL-01/);
  assert.deepEqual(original, before);
});

test('분석값 유지와 0원 단위를 구분하고 미확정 값을 자동 확정하지 않는다', () => {
  const original = analyze('SELECT OTHER(AMT) AS CPFEE').results[0];
  const retained = buildFinalProduct(original, { FEE_SMT_CALC_UNIT_VAL: '', FEE_TYPE_DVCD: '' });
  assert.deepEqual(retained.result.fields, original.fields);
  assert.equal(retained.changedFields.length, 0);
  const filled = buildFinalProduct(original, { FEE_SMT_CALC_UNIT_VAL: '0', FEE_TYPE_DVCD: 'RATE' });
  assert.equal(filled.result.fields.FEE_SMT_CALC_UNIT_VAL.value, 0);
  assert.equal(filled.result.fields.FEE_TYPE_DVCD.status, 'known');
  assert.equal(filled.changedFields.length, 2);
});

test('잘못된 계산 단위와 코드값은 복사 오류로 남기고 원본을 덮어쓰지 않는다', () => {
  const original = source();
  for (const value of ['-1', 'Infinity', 'NaN', '1e30', '1000000000001']) {
    const draft = buildFinalProduct(original, { FEE_SMT_CALC_UNIT_VAL: value });
    assert.equal(draft.errors.length, 1);
    assert.deepEqual(draft.result.fields, original.fields);
  }
  assert.equal(buildFinalProduct(original, { FEE_TYPE_DVCD: 'INVALID' }).errors.length, 1);
  assert.equal(buildFinalProduct(original, {}, { code: 'ONLY-CODE' }).errors.length, 1);
  assert.equal(buildFinalProduct(original, {}, { code: '', name: '' }).name, null);
  assert.equal(buildFinalProduct(null).result, null);
});
