import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../public/analyzer.js';
import { EXAMPLES } from '../public/examples.js';
import { buildFinalProduct } from '../public/final-product.js';
import {
  compareSample,
  sampleRate,
  suggestSampleColumns,
} from '../public/calculation/sample-verification.js';

const openbanking = () => analyze(EXAMPLES['오픈뱅킹 정률']).results[0];
const cancel = {
  rows: [{ amount: '-9900', count: '1' }],
  sourceRows: [{ AMT: '-9900', CPRATE: '0.015' }],
  feeValue: '0.015',
};

test('원문 수식과 현재 판단한 설정을 동일한 취소 예시에서 비교한다', () => {
  const source = openbanking();
  const original = structuredClone(source);
  const matching = compareSample(source, source, cancel);
  assert.equal(matching.status, 'match');
  assert.equal(matching.metrics[0].original, '148');
  assert.equal(matching.metrics[1].original, '14');
  const draft = buildFinalProduct(source, { SIGN_APLY_LOCT_DVCD: 'AFTER' });
  const changed = compareSample(source, draft.result, cancel);
  assert.equal(changed.status, 'mismatch');
  assert.equal(changed.metrics[0].calculated, '-148');
  assert.equal(changed.metrics[0].difference, '-296');
  assert.deepEqual(source, original);
});

test('빠른 테스트도 합산 단위의 승인·취소 혼합을 막고 0원 거래는 허용한다', () => {
  const source = openbanking();
  const draft = buildFinalProduct(source, {
    FEE_SMT_CALC_BASE_DVCD: 'SUM',
    VAT_SMT_CALC_BASE_DVCD: 'SUM',
    SIGN_APLY_LOCT_DVCD: 'AFTER',
  }).result;
  const options = (amounts) => ({
    rows: amounts.map((amount) => ({ amount, count: '1' })),
    sourceRows: amounts.map((AMT) => ({ AMT, CPRATE: '0.015' })),
    feeValue: '0.015',
  });
  const mixed = compareSample(source, draft, options(['10000', '-10000']));
  assert.equal(mixed.status, 'unavailable');
  assert.equal(mixed.breakdown, null);
  assert.ok(mixed.errors.some((error) => error.includes('승인과 취소')));
  const zero = compareSample(source, draft, options(['10000', '0']));
  assert.equal(zero.breakdown.fee, '150');
  assert.equal(zero.status, 'match');
});

test('수식에서 알 수 없는 건수 기준은 사용자가 선택해야 설정 계산이 가능하다', () => {
  const source = analyze(EXAMPLES['오픈뱅킹 정액']).results[0];
  const options = {
    rows: [{ amount: '-9900', count: '1' }],
    sourceRows: [{ AUTHRATE: '100' }],
    feeValue: '100',
  };
  assert.equal(compareSample(source, source, options).status, 'unavailable');
  const draft = buildFinalProduct(source, { FRIM_BASE_DVCD: 'SCOUNT' });
  assert.equal(compareSample(source, draft.result, options).status, 'match');
  const deferred = buildFinalProduct(source, { FRIM_BASE_DVCD: '__defer__' });
  assert.equal(deferred.result.fields.FRIM_BASE_DVCD.status, 'unknown');
  assert.equal(compareSample(source, deferred.result, options).status, 'unavailable');
});

test('두 거래에서 합산 후 반올림과 거래별 반올림의 차이를 드러낸다', () => {
  const source = analyze('SELECT ROUND(SUM(AMT)*CPRATE,0) AS CPFEE, 0 AS CPVAT').results[0];
  const options = {
    rows: [
      { amount: '99', count: '1' },
      { amount: '99', count: '1' },
    ],
    sourceRows: [
      { AMT: '99', CPRATE: '0.015' },
      { AMT: '99', CPRATE: '0.015' },
    ],
    feeValue: '0.015',
  };
  assert.equal(compareSample(source, source, options).metrics[0].calculated, '3');
  const draft = buildFinalProduct(source, { FEE_SMT_CALC_BASE_DVCD: 'EACH' });
  const report = compareSample(source, draft.result, options);
  assert.equal(report.metrics[0].original, '3');
  assert.equal(report.metrics[0].calculated, '2');
  assert.equal(report.status, 'mismatch');
});

test('컬럼 별칭과 갱신 전 수수료를 임의로 합치거나 현재 계산값으로 채우지 않는다', () => {
  const source = analyze('UPDATE A SET CPFEE=FLOOR(A.AMT*A.CPRATE),CPVAT=FLOOR(A.CPFEE*0.1)')
    .results[0];
  const draft = buildFinalProduct(source, { VAT_CALC_TRGT_DVCD: 'FEE' });
  const options = {
    rows: [{ amount: '9900', count: '1' }],
    sourceRows: [{ 'A.AMT': '9900', 'A.CPRATE': '0.015' }],
    feeValue: '0.015',
  };
  assert.equal(compareSample(source, draft.result, options).status, 'unavailable');
  options.sourceRows[0]['A.CPFEE'] = '40';
  assert.equal(compareSample(source, draft.result, options).metrics[1].original, '4');
  const multiple = analyze('SELECT A.AMT*B.RATE+B.AMT AS CPFEE,0 AS CPVAT').results[0];
  assert.equal(suggestSampleColumns(multiple).amount, null);
});

test('원문 백분율 입력과 상품 비율을 별도로 지정하고 기대값 차이도 비교한다', () => {
  const source = analyze(EXAMPLES['백분율·VAT 나눗셈']).results[0];
  const options = {
    rows: [{ amount: '-9900', count: '1' }],
    sourceRows: [{ AMT: '-9900', CPRATE: '1.5' }],
    feeValue: sampleRate('1.5%'),
  };
  assert.equal(compareSample(source, source, options).status, 'match');
  assert.equal(
    compareSample(source, source, { ...options, expected: { fee: '0' } }).status,
    'mismatch',
  );
  assert.throws(() => sampleRate('100%', true), /정액/);
});

test('원문 함수가 미지원이면 결과를 일치로 판정하지 않는다', () => {
  const source = analyze('SELECT OTHER(AMT) AS CPFEE, FLOOR(ABS(AMT)*CPRATE*0.1) AS CPVAT')
    .results[0];
  const report = compareSample(source, openbanking(), cancel);
  assert.equal(report.status, 'unavailable');
  assert.equal(report.metrics[0].match, null);
  assert.ok(report.errors.length);
});
