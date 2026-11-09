import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../public/analyzer.js';
import { PRODUCT_EXAMPLES } from '../public/product-examples.js';
import { compareProduct } from '../public/catalog.js';
import { compareSample } from '../public/calculation/sample-verification.js';
import { buildFinalProduct } from '../public/final-product.js';

const product = PRODUCT_EXAMPLES.find((p) => p.code === 'BOOKNLIFEGIFT-BASIC');
const fee = 'FLOOR(ABS(AMT)*RATE)*CASE WHEN AMT<0 THEN -1 ELSE 1 END';
const vat = 'FLOOR(ABS(AMT)*RATE*0.1)*CASE WHEN AMT<0 THEN -1 ELSE 1 END';
const predicate = "B_FLAG IN ('J','H','CG') AND ACTIONDATE=@ACTIONDATE";
const pair = (secondTable = 'TEAMDB.DBO.TPAYNOTE_REGMON', secondPredicate = predicate) =>
  `UPDATE TEAMDB.DBO.TPAYNOTE_REGMON SET RAMT=${fee}, RAMT_2=0 WHERE ${predicate};\nUPDATE ${secondTable} SET VAMT=${vat} WHERE ${secondPredicate};`;

test('동일 테이블·조건의 독립된 수수료/VAT UPDATE를 한 상품으로 연결하고 근거 위치를 보존한다', () => {
  const sql = pair();
  const outcome = analyze(sql);
  assert.deepEqual(outcome.errors, []);
  assert.equal(outcome.results.length, 1);
  const result = outcome.results[0];
  assert.equal(result.statements.length, 2);
  assert.equal(result.fields.FEE_TYPE_DVCD.value, 'RATE');
  assert.equal(result.fields.VAT_CALC_TRGT_DVCD.value, 'AMOUNT');
  assert.equal(result.fields.SIGN_APLY_LOCT_DVCD.value, 'AFTER');
  assert.ok(Object.values(result.fields).every((f) => f.status === 'known'));
  for (const [key, line] of [
    ['FEE_TYPE_DVCD', 1],
    ['VAT_DVCD', 2],
  ]) {
    const proof = result.fields[key].evidence[0];
    assert.equal(proof.line, line);
    assert.equal(sql.slice(proof.start, proof.end), proof.text);
  }
  const noSemicolon = analyze(sql.replaceAll(';', ''));
  assert.equal(noSemicolon.results.length, 1);
});

test('다른 테이블·조건·분기·중간 갱신·선행 계산 참조가 있으면 UPDATE를 합치지 않는다', () => {
  const cases = [
    pair('ACCOUNT.DBO.TPAYNOTE_REGMON'),
    pair('[TEAMDB.DBO.TPAYNOTE_REGMON]'),
    pair(undefined, 'AMT/2.0=1').replace(predicate, 'AMT/2=1'),
    pair(undefined, "B_FLAG IN ('J','H') AND ACTIONDATE=@ACTIONDATE"),
    pair(undefined, "B_FLAG IN ('j','h','cg') AND ACTIONDATE=@ACTIONDATE"),
    pair().replace('VAMT=' + vat, 'VAMT=FLOOR(RAMT*0.1)'),
    pair().replace('VAMT=' + vat, 'VAMT=FLOOR(RAMT_2*0.1)'),
    'IF @FLAG=1 ' + pair(),
    'BEGIN ' + pair() + ' END',
    pair().replace(';\nUPDATE', ';\nUPDATE OTHER SET AMT=1;\nUPDATE'),
    pair().replace('RAMT_2=0', 'RAMT_2=0, AMT=100'),
    pair().replace(';\nUPDATE', ';\nGO\nUPDATE'),
  ];
  for (const sql of cases) assert.equal(analyze(sql).results.length, 2, sql);
});

test('합산 여부는 테이블명으로 추정하지 않고 확인된 입력 기준을 반영한다', () => {
  const source = analyze(pair()).results[0];
  assert.equal(source.fields.FEE_SMT_CALC_BASE_DVCD.value, 'EACH');
  const result = analyze(pair(), { inputScope: 'settlement' }).results[0];
  for (const key of ['FEE_SMT_CALC_BASE_DVCD', 'VAT_SMT_CALC_BASE_DVCD']) {
    assert.equal(result.fields[key].value, 'SUM');
    assert.equal(result.fields[key].source, 'context');
  }
  const preset = analyze(product.sql, { inputScope: product.inputScope }).results[0];
  assert.ok(compareProduct(product, preset).every((row) => row.status === 'match'));
  assert.match(product.sources[0].name, /JOB_TB_BILL_STATUS_4_REGMON_CULTUERE/);
  for (const inputScope of ['invalid', null, 0, false, ''])
    assert.ok(analyze(pair(), { inputScope }).errors.length);
});

test('기집계 AMT 원문은 거래금액을 먼저 합산한 뒤 대입하고 개별 절사와 구분한다', () => {
  const source = analyze(product.sql, { inputScope: product.inputScope }).results[0];
  const options = {
    rows: [
      { amount: '55', count: '1' },
      { amount: '55', count: '1' },
    ],
    sourceRows: [
      { AMT: '55', RATE: '0.015' },
      { AMT: '55', RATE: '0.0150' },
    ],
    feeValue: '0.015',
  };
  const report = compareSample(source, source, options);
  assert.equal(report.status, 'match');
  assert.equal(report.metrics[0].original, '1');
  assert.equal(report.metrics[0].calculated, '1');
  const perRow = buildFinalProduct(source, {
    FEE_SMT_CALC_BASE_DVCD: 'EACH',
    VAT_SMT_CALC_BASE_DVCD: 'EACH',
  }).result;
  const changed = compareSample(source, perRow, options);
  assert.equal(changed.status, 'mismatch');
  assert.equal(changed.metrics[0].original, '1');
  assert.equal(changed.metrics[0].calculated, '0');
  const cancel = {
    rows: [{ amount: '-9900', count: '1' }],
    sourceRows: [{ AMT: '-9900', RATE: '0.015' }],
    feeValue: '0.015',
  };
  const negative = compareSample(source, source, cancel);
  assert.equal(negative.status, 'match');
  assert.equal(negative.metrics[0].original, '-148');
  assert.equal(negative.metrics[1].original, '-14');
  const mixed = structuredClone(options);
  mixed.sourceRows[1].RATE = '0.02';
  const invalid = compareSample(source, source, mixed);
  assert.equal(invalid.status, 'unavailable');
  assert.ok(invalid.errors.some((error) => error.includes('RATE')));
  const missing = structuredClone(options);
  delete missing.sourceRows[1].RATE;
  assert.equal(compareSample(source, source, missing).status, 'unavailable');
});
