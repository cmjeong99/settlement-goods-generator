import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileAsis } from '../public/calculation/reconciliation.js';
import { productByCode } from '../public/catalog.js';

const rate = productByCode.get('OPENBANKING-RATE');
const calculate = (product, rows, options) => reconcileAsis(product, rows, options).results[0];

test('입력 요율을 숫자로 대입하고 수수료와 VAT의 단수 처리 전후 값을 보존한다', () => {
  for (const feeValue of ['0.015', '1.5%']) {
    const result = calculate(rate, [{ amount: '9000', feeValue }]);
    const { fee, vat } = result.breakdown.steps;
    assert.deepEqual(fee[0].inputs, ['9000']);
    assert.equal(fee[0].multiplier, '0.015');
    assert.equal(fee[0].raw, '135');
    assert.equal(fee[0].result, '135');
    assert.deepEqual(vat[0].inputs, ['135']);
    assert.equal(vat[0].multiplier, '0.1');
    assert.equal(vat[0].raw, '13.5');
    assert.equal(vat[0].result, '13');
    assert.equal(result.metrics.fee.calculated, fee[0].result);
    assert.equal(result.metrics.vat.calculated, vat[0].result);
  }
});

test('별도 계산대상금액을 수수료 식에 대입하고 지급액에는 원래 거래금액을 사용한다', () => {
  const result = calculate(rate, [{ amount: '9000', targetAmount: '8000', feeValue: '0.015' }]);
  assert.deepEqual(result.breakdown.steps.fee[0].inputs, ['8000']);
  assert.equal(result.breakdown.steps.fee[0].result, '120');
  assert.equal(result.breakdown.amount, '9000');
  assert.equal(result.breakdown.payout, '8868');
});

test('건별 절사 후 합산과 금액 합산 후 절사의 서로 다른 식과 결과를 기록한다', () => {
  const rows = [
    { amount: '39', feeValue: '0.015' },
    { amount: '39', feeValue: '0.015' },
  ];
  const each = calculate(rate, rows, { scope: 'all' });
  const aggregate = calculate(productByCode.get('BOOKNLIFEGIFT-BASIC'), rows, { scope: 'all' });
  assert.deepEqual(
    each.breakdown.steps.fee.map((step) => step.inputs),
    [['39'], ['39']],
  );
  assert.deepEqual(
    each.breakdown.steps.fee.map((step) => step.raw),
    ['0.585', '0.585'],
  );
  assert.equal(each.breakdown.fee, '0');
  assert.deepEqual(aggregate.breakdown.steps.fee[0].inputs, ['39', '39']);
  assert.equal(aggregate.breakdown.steps.fee[0].raw, '1.17');
  assert.equal(aggregate.breakdown.fee, '1');
});

test('음수 절사에서 부호 적용 전후의 실제 실행 순서와 중간 금액을 보존한다', () => {
  for (const [position, expected, kinds] of [
    ['BEFORE', '-149', ['sign', 'round']],
    ['AFTER', '-148', ['round', 'sign']],
  ]) {
    const product = {
      ...rate,
      expected: {
        ...rate.expected,
        SIGN_APLY_LOCT_DVCD: position,
        FEE_SMT_CALC_MHOD_DVCD: 'SIGNED_DOWN',
      },
    };
    const result = calculate(product, [{ amount: '-9900', feeValue: '0.015' }]);
    const step = result.breakdown.steps.fee[0];
    assert.deepEqual(step.inputs, ['-9900']);
    assert.equal(step.absolute, true);
    assert.equal(step.raw, '148.5');
    assert.deepEqual(
      step.adjustments.map((item) => item.kind),
      kinds,
    );
    assert.equal(step.adjustments[0].result, position === 'BEFORE' ? '-148.5' : '148');
    assert.equal(step.result, expected);
    assert.equal(result.metrics.fee.calculated, expected);
  }
});

test('VAT가 계산된 수수료와 단수 처리 전 수수료 중 실제로 참조한 값을 보여 준다', () => {
  for (const [target, input, raw] of [
    ['FEE', '148', '14.8'],
    ['AMOUNT', '148.5', '14.85'],
  ]) {
    const product = { ...rate, expected: { ...rate.expected, VAT_CALC_TRGT_DVCD: target } };
    const result = calculate(product, [{ amount: '9900', feeValue: '0.015' }]);
    assert.deepEqual(result.breakdown.steps.vat[0].inputs, [input]);
    assert.equal(result.breakdown.steps.vat[0].raw, raw);
    assert.equal(result.breakdown.steps.vat[0].result, '14');
  }
});

test('정액 식에는 과금건수와 단가를 대입하며 면세 VAT와 계산 불가를 구분한다', () => {
  const fixed = productByCode.get('OPENBANKING-FIXED');
  const product = { ...fixed, expected: { ...fixed.expected, VAT_DVCD: 'ZERO' } };
  const result = calculate(product, [{ amount: '-9000', count: '2', feeValue: '100' }]);
  const step = result.breakdown.steps.fee[0];
  assert.deepEqual(step.inputs, ['2']);
  assert.equal(step.multiplier, '100');
  assert.equal(step.result, '200');
  assert.equal(step.absolute, false);
  assert.deepEqual(result.breakdown.steps.vat, []);
  assert.equal(result.breakdown.vat, '0');
  const unsupported = calculate({ ...product, engine: 'CUSTOM' }, [
    { amount: '9000', feeValue: '100' },
  ]);
  assert.equal(unsupported.status, 'error');
  assert.equal(unsupported.breakdown, undefined);
});
