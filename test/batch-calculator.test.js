import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Decimal } from '../public/calculation/decimal.js';
import { roundingUnit } from '../public/calculation/rounding-unit.js';
import { reconcileAsis, needsAggregation } from '../public/calculation/reconciliation.js';
import {
  CUSTOM_CALCULATORS,
  batchNotes,
  BATCH_REFERENCE,
} from '../public/calculation/batch-reference.js';
import { productByCode } from '../public/catalog.js';
import { analyze } from '../public/analyzer.js';
import { createHistoryStore, historySnapshot } from '../public/history.js';
import { buildFinalProduct } from '../public/final-product.js';

const fixture = JSON.parse(
  await readFile(new URL('fixtures/batch-calculator-jvm.json', import.meta.url)),
);
const canonical = (value) => Decimal.parse(value).toString();

test('Java 배치의 실제 CUSTOM 메서드에서 실행한 22개 양수·취소·재분리 결과와 일치한다', () => {
  assert.equal(fixture.custom.length, 22);
  assert.equal(fixture.revision, BATCH_REFERENCE.revision);
  for (const sample of fixture.custom) {
    // The self-confirmation DB snapshot is COMMON: changing the engine here is explicit.
    const product = { ...productByCode.get(sample.productCode), engine: 'CUSTOM' };
    const report = reconcileAsis(
      product,
      [
        {
          amount: sample.amount,
          count: sample.count,
          feeValue: sample.feeValue,
        },
      ],
      {
        scope: 'all',
        parameters: { grossFee: sample.grossFee, scheduledPayout: sample.scheduledPayout },
      },
    );
    const result = report.results[0];
    assert.notEqual(result.status, 'error', `${sample.method}: ${result.reasons}`);
    for (const key of ['fee', 'vat', 'payout'])
      assert.equal(
        result.breakdown[key],
        canonical(sample.expected[key]),
        `${sample.method}/${sample.grossFee}/${key}`,
      );
    assert.equal(needsAggregation(product), true);
  }
});

test('배치 RoundingRule의 정수 scale·음수 단수 처리를 Java 실행값과 대조한다', () => {
  for (const sample of fixture.rounding)
    assert.equal(
      Decimal.parse(sample.value).round(sample.rule, roundingUnit(sample.scale)).toString(),
      canonical(sample.expected),
    );
});

test('학교 상품의 DB scale 2와 -2는 소수 둘째 자리와 100원 단위로 계산한다', () => {
  for (const [code, amount, expected] of [
    ['WECHAT-SCHOOL-QR', '100.29', '1.5'],
    ['WECHAT-SCHOOL-WMP', '100.29', '1.5'],
    ['PAYPAL-SCHOOL', '9900', '100'],
  ]) {
    const result = reconcileAsis(productByCode.get(code), [{ amount, feeValue: '0.015' }])
      .results[0];
    assert.equal(result.metrics.fee.calculated, expected);
  }
});

test('CUSTOM 계산은 별도 원금액 입력과 합산 단위를 요구하며 AS-IS 기대값으로 채우지 않는다', () => {
  const product = productByCode.get('MOBILE-RATE-INCL');
  const rows = [{ amount: '1000', feeValue: '', asisFee: '100', asisVat: '10' }];
  const missing = reconcileAsis(product, rows, { scope: 'all' }).results[0];
  assert.equal(missing.status, 'error');
  assert.match(missing.reasons[0], /별도 입력/);
  assert.equal(
    reconcileAsis(product, rows, { parameters: { grossFee: '110' } }).results[0].status,
    'error',
  );
  const good = reconcileAsis(product, rows, { scope: 'all', parameters: { grossFee: '110' } })
    .results[0];
  assert.equal(good.metrics.fee.calculated, '100');
  assert.equal(good.metrics.vat.calculated, '10');
});

test('구현 없는 CUSTOM은 공통 계산으로 대체하지 않고 COMMON 스냅샷을 자동 변경하지 않는다', () => {
  for (const code of ['MOBILE-COUPANG', 'MOBILE-EACH-VAT-SUM', 'MOBILE-FIXED-INCL']) {
    assert.equal(CUSTOM_CALCULATORS[code], undefined);
    assert.equal(
      reconcileAsis(productByCode.get(code), [{ amount: '1000', feeValue: '0.015' }], {
        scope: 'all',
      }).results[0].status,
      'error',
    );
  }
  const product = productByCode.get('SELF-STANDARD-SCNT-INCL');
  assert.equal(product.engine, 'COMMON');
  assert.ok(batchNotes(product).some((note) => note.includes('계산 엔진')));
});

test('기본요금은 0건·기본 제공량·초과분을 구분하고 구간요금 끝값은 포함하지 않는다', () => {
  const base = productByCode.get('SELF-BASE-SCNT-EXCL');
  for (const [count, expected] of [
    ['0', '0'],
    ['10', '100'],
    ['11', '102'],
  ]) {
    const result = reconcileAsis(base, [{ amount: '0', count, feeValue: '2' }], {
      scope: 'all',
      parameters: { baseFee: '100', baseOffer: '10' },
    }).results[0];
    assert.equal(result.metrics.fee.calculated, expected);
  }
  const sliding = productByCode.get('SELF-SLIDE-SCNT-EXCL');
  const calc = (count) =>
    reconcileAsis(sliding, [{ amount: '0', count, feeValue: '2' }], {
      scope: 'all',
      parameters: { tierFrom: '10', tierTo: '20' },
    }).results[0];
  assert.equal(calc('10').metrics.fee.calculated, '20');
  assert.equal(calc('19').metrics.fee.calculated, '38');
  assert.equal(calc('20').status, 'error');
  assert.equal(calc('9').status, 'error');
});

test('최소 수수료는 단수 처리 뒤 적용하고 필요한 계약값이 없으면 계산하지 않는다', () => {
  const base = productByCode.get('OPENBANKING-RATE');
  const product = { ...base, registration: { ...base.registration, MIN_FEE_SETP_YN: 'Y' } };
  const rows = [{ amount: '1000', feeValue: '0.015' }];
  assert.equal(reconcileAsis(product, rows).results[0].status, 'error');
  const result = reconcileAsis(product, rows, { parameters: { minimumFee: '100' } }).results[0];
  assert.equal(result.metrics.fee.calculated, '100');
  assert.equal(result.breakdown.steps.fee[0].adjustments.at(-1).kind, 'minimum');
});

test('음수 scale을 새 이력에 보관하고 이전 단위 이력은 값 변경 없이 읽는다', () => {
  const source = analyze('SELECT ROUND(ABS(AMT)*RATE,-2) AS CPFEE, 0 AS CPVAT').results[0];
  const draft = buildFinalProduct(source);
  const snapshot = historySnapshot(draft, { sql: source.sql });
  assert.equal(snapshot.unitEncoding, 'scale');
  let value = null;
  const storage = {
    getItem: () => value,
    setItem: (_, v) => {
      value = v;
    },
  };
  const store = createHistoryStore(storage, { id: () => 'scale-test' });
  store.add(snapshot);
  assert.equal(store.read()[0].fields.FEE_SMT_CALC_UNIT_VAL.value, -2);
  const legacy = JSON.parse(value);
  delete legacy.entries[0].unitEncoding;
  legacy.entries[0].fields.FEE_SMT_CALC_UNIT_VAL.value = 100;
  value = JSON.stringify(legacy);
  assert.equal(store.read()[0].fields.FEE_SMT_CALC_UNIT_VAL.value, 100);
});
