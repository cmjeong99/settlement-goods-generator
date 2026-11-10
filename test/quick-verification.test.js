import test from 'node:test';
import assert from 'node:assert/strict';
import { verificationProduct } from '../public/ui/quick-verification.js';
import { reconcileAsis } from '../public/calculation/reconciliation.js';
import { analyze } from '../public/analyzer.js';
import { EXAMPLES } from '../public/examples.js';
import { productByCode } from '../public/catalog.js';
import { NULL_OVERRIDE } from '../public/domain.js';
import { commonCalculationErrors } from '../public/calculation/product-context.js';
import { compareSample } from '../public/calculation/sample-verification.js';

test('예시 검증은 DB 메타데이터를 유지하면서 사용자가 판단한 설정을 사용한다', () => {
  const product = productByCode.get('OPENBANKING-RATE');
  assert.equal(verificationProduct(null, product), null);
  const result = analyze(product.sql).results[0];
  const draft = {
    ...result,
    fields: { ...result.fields, SIGN_APLY_LOCT_DVCD: { status: 'known', value: 'AFTER' } },
  };
  const selected = verificationProduct(draft, product);
  assert.equal(selected.expected.SIGN_APLY_LOCT_DVCD, 'AFTER');
  assert.equal(product.expected.SIGN_APLY_LOCT_DVCD, 'NONE');
  assert.equal(selected.engine, product.engine);
  assert.equal(selected.settlement, product.settlement);
});

test('직접 입력한 수식은 확인된 설정만 계산기로 전달하고 지급 방식은 추측하지 않는다', () => {
  const result = analyze(EXAMPLES['오픈뱅킹 정률']).results[0];
  const product = verificationProduct(result);
  const report = reconcileAsis(product, [{ amount: '-9900', feeValue: '1.5%' }]);
  assert.equal(report.results[0].metrics.fee.calculated, '148');
  assert.equal(report.results[0].metrics.vat.calculated, '14');
  assert.equal(report.results[0].metrics.payout.calculated, '');
  assert.equal(product.settlement, undefined);
  const partial = verificationProduct({
    fields: {
      ...result.fields,
      FEE_TYPE_DVCD: { status: 'unknown', value: 'RATE' },
    },
  });
  assert.equal(partial.expected.FEE_TYPE_DVCD, null);
  assert.equal(
    reconcileAsis(partial, [{ amount: '9900', feeValue: '1.5%' }]).results[0].status,
    'error',
  );
});

test('상세 계산 과정은 실제 단수 처리 전 금액과 건별·합산 계산 횟수를 보여 준다', () => {
  const each = productByCode.get('OPENBANKING-RATE');
  const aggregate = productByCode.get('BOOKNLIFEGIFT-BASIC');
  const rows = [
    { amount: '99', feeValue: '0.015' },
    { amount: '99', feeValue: '0.015' },
  ];
  const a = reconcileAsis(each, rows, { scope: 'all' }).results[0];
  const b = reconcileAsis(aggregate, rows, { scope: 'all' }).results[0];
  assert.equal(a.breakdown.rawFee, '2.97');
  assert.equal(a.breakdown.feeCalculationCount, 2);
  assert.equal(b.breakdown.rawFee, '2.97');
  assert.equal(b.breakdown.feeCalculationCount, 1);
  assert.equal(a.breakdown.fee, a.metrics.fee.calculated);
  assert.equal(b.breakdown.fee, b.metrics.fee.calculated);
  const cancel = reconcileAsis(each, [{ amount: '-9900', feeValue: '1.5%' }]).results[0];
  assert.equal(cancel.breakdown.rawFee, '148.5');
  assert.equal(cancel.breakdown.rawVat, '14.85');
  assert.equal(cancel.breakdown.payout, '-10062');
});

test('현재 등록 정보와 상품명이 DB 예제의 엔진·납부·징수 메타데이터를 대체한다', () => {
  const dbProduct = productByCode.get('OPENBANKING-RATE');
  const result = analyze(dbProduct.sql).results[0];
  const registration = {
    ...dbProduct.registration,
    CALC_ENGE_DVCD: 'CUSTOM',
    FEE_RCVG_DVCD: 'POST',
    PAYM_MHOD_DVCD: 'BILLING',
  };
  const selected = verificationProduct(result, dbProduct, {
    registration,
    identity: { name: '수정한 상품' },
  });
  assert.equal(selected.name, '수정한 상품');
  assert.equal(selected.engine, 'CUSTOM');
  assert.equal(selected.settlement.feeCollection, 'POST');
  assert.equal(selected.settlement.paymentMethod, 'BILLING');
  assert.equal(dbProduct.engine, 'COMMON');
  assert.equal(dbProduct.settlement.feeCollection, 'PRE');
  assert.equal(
    reconcileAsis(selected, [{ amount: '9900', feeValue: '1.5%' }]).results[0].status,
    'error',
  );
});

test('징수 방식의 빈칸 DB 기본값과 명시적 NULL을 구분하며 NULL 엔진은 공통 경로를 따른다', () => {
  const result = analyze(EXAMPLES['오픈뱅킹 정률']).results[0];
  const context = {
    registration: { PAYM_MHOD_DVCD: 'PAYOUT', FEE_RCVG_DVCD: '', CALC_ENGE_DVCD: NULL_OVERRIDE },
  };
  const omitted = verificationProduct(result, undefined, context);
  assert.equal(omitted.engine, 'COMMON');
  assert.equal(omitted.settlement.feeCollection, 'PRE');
  const explicit = verificationProduct(result, undefined, {
    registration: { ...context.registration, FEE_RCVG_DVCD: NULL_OVERRIDE },
  });
  assert.equal(explicit.settlement.feeCollection, null);
  const calculated = reconcileAsis(explicit, [{ amount: '9900', feeValue: '1.5%' }]).results[0];
  assert.equal(calculated.metrics.fee.calculated, '148');
  assert.equal(calculated.metrics.payout.calculated, '');
});

test('최소 수수료·구간·기본 요금제를 필요한 값 없이 일반 정률 계산으로 대신하지 않는다', () => {
  const dbProduct = productByCode.get('OPENBANKING-RATE');
  const source = analyze(dbProduct.sql).results[0];
  for (const changes of [
    { MIN_FEE_SETP_YN: 'Y' },
    { TRFS_DVCD: 'SLIDING' },
    { TRFS_DVCD: 'BASE' },
  ]) {
    const selected = verificationProduct(source, dbProduct, {
      registration: { ...dbProduct.registration, ...changes },
    });
    const errors = commonCalculationErrors(selected);
    assert.equal(errors.length, 1);
    const input = [{ amount: '9900', feeValue: '1.5%', count: '1' }];
    const report = compareSample(source, source, {
      rows: input,
      sourceRows: [{ AMT: '9900', CPRATE: '0.015' }],
      feeValue: '0.015',
      contextErrors: errors,
    });
    assert.equal(report.breakdown, null);
    assert.equal(report.status, 'unavailable');
    const detailed = reconcileAsis(selected, input).results[0];
    assert.equal(detailed.status, 'error');
    assert.equal(detailed.metrics, null);
    assert.match(detailed.reasons[0], /아직 지원하지 않아/);
  }
});
