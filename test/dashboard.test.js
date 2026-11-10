import test from 'node:test';
import assert from 'node:assert/strict';
import { productByCode } from '../public/catalog.js';
import { analyze } from '../public/analyzer.js';
import { EXAMPLES } from '../public/examples.js';
import { reconcileAsis } from '../public/calculation/reconciliation.js';
import { compareSample } from '../public/calculation/sample-verification.js';
import {
  quickDashboard,
  reconciliationDashboard,
  summarizeDashboard,
  formatDashboardNumber,
  dashboardBarWidth,
} from '../public/calculation/dashboard.js';

const product = productByCode.get('OPENBANKING-RATE');
const row = (amount, extra = {}) => ({ amount, feeValue: '1.5%', count: '1', ...extra });
const dashboard = (rows, selected = product, options = {}) =>
  reconciliationDashboard(
    reconcileAsis(selected, rows, { scope: options.aggregate ? 'all' : 'rows' }),
    rows,
    options,
  );

test('양수·취소·0원 입력과 계산 결과를 부호를 유지하며 정확하게 합산한다', () => {
  const rows = [row('9900'), row('-9900'), row('0')];
  const original = structuredClone(rows);
  const model = dashboard(rows);
  const summary = summarizeDashboard(model.entries);
  assert.equal(summary.count, 3);
  assert.equal(summary.amount, '0');
  assert.deepEqual([summary.positive, summary.negative, summary.zero], [1, 1, 1]);
  assert.equal(summary.metrics.fee.value, '296');
  assert.equal(summary.metrics.vat.value, '28');
  assert.equal(summary.metrics.payout.value, '-324');
  assert.equal(summary.attention, 0);
  assert.deepEqual(rows, original);
  const cancellations = summarizeDashboard(model.entries, { direction: 'negative' });
  assert.equal(cancellations.count, 1);
  assert.equal(cancellations.amount, '-9900');
  assert.equal(cancellations.metrics.payout.value, '-10062');
});

test('계산 불가·미입력 금액은 0으로 바꾸지 않으며 확인 필요 필터에 남는다', () => {
  const model = dashboard([row('9900'), row('bad'), row('100', { feeValue: '' })]);
  const summary = summarizeDashboard(model.entries);
  assert.equal(summary.count, 3);
  assert.equal(summary.amount, '10000');
  assert.equal(summary.invalidAmounts, 1);
  assert.equal(summary.metrics.fee.value, '148');
  assert.equal(summary.metrics.fee.count, 1);
  assert.equal(summary.errors, 2);
  const attention = summarizeDashboard(model.entries, { status: 'attention' });
  assert.equal(attention.entries.length, 2);
  assert.equal(attention.metrics.fee.value, null);
  assert.equal(attention.entries[0].amount, null);
  assert.ok(attention.entries.every((entry) => entry.reasons.length));
});

test('실제 비교 차이를 대시보드 확인 필요 결과에 반영하고 필터 합계를 다시 구한다', () => {
  const model = dashboard([row('9900', { asisFee: '999' }), row('10000')]);
  const summary = summarizeDashboard(model.entries, { status: 'attention' });
  assert.equal(summary.attention, 1);
  assert.equal(summary.amount, '9900');
  assert.equal(summary.metrics.fee.value, '148');
});

test('합산 결과를 거래별로 배분하지 않고 1개 계산 단위와 원본 건수로 유지한다', () => {
  const aggregateProduct = structuredClone(product);
  aggregateProduct.expected.FEE_SMT_CALC_BASE_DVCD = 'SUM';
  aggregateProduct.expected.VAT_SMT_CALC_BASE_DVCD = 'SUM';
  const model = dashboard([row('101'), row('101')], aggregateProduct, { aggregate: true });
  assert.equal(model.entries.length, 1);
  const summary = summarizeDashboard(model.entries);
  assert.equal(summary.count, 2);
  assert.equal(summary.metrics.fee.value, '3');
  assert.equal(summary.metrics.fee.count, 1);
  assert.equal(summary.amount, '202');
});

test('통화가 섞이면 거래 건수만 요약하고 서로 다른 통화의 금액을 합산하지 않는다', () => {
  const model = dashboard([row('100', { currency: 'KRW' }), row('100', { currency: 'USD' })]);
  const summary = summarizeDashboard(model.entries);
  assert.equal(summary.mixedCurrencies, true);
  assert.equal(summary.count, 2);
  assert.equal(summary.amount, null);
  assert.equal(summary.metrics.fee.value, null);
  assert.equal(summary.positiveAmount, null);
});

test('큰 정수와 소수 합계를 Number로 변환하지 않으며 차트 비율만 변환한다', () => {
  const model = dashboard([row('9007199254740993.1'), row('0.2')]);
  assert.equal(summarizeDashboard(model.entries).amount, '9007199254740993.3');
  assert.equal(formatDashboardNumber('9007199254740993.3'), '9,007,199,254,740,993.3');
  assert.equal(formatDashboardNumber('-1234.50'), '-1,234.50');
  assert.equal(formatDashboardNumber(null), '—');
  assert.equal(dashboardBarWidth('-50000000000000000000', '100000000000000000000'), 50);
  assert.equal(dashboardBarWidth('0', '0'), 0);
});

test('빠른 테스트는 이번 실행의 실제 계산 결과만 사용하며 미지원 지급액은 표시하지 않는다', () => {
  const source = analyze(EXAMPLES['오픈뱅킹 정률']).results[0];
  const rows = [row('9900')];
  const report = compareSample(source, source, {
    rows,
    sourceRows: [{ AMT: '9900', CPRATE: '0.015' }],
    feeValue: '0.015',
  });
  const supported = summarizeDashboard(quickDashboard(report, rows, product).entries);
  assert.equal(supported.metrics.fee.value, report.breakdown.fee);
  assert.equal(supported.metrics.payout.value, report.breakdown.payout);
  const unsupported = summarizeDashboard(quickDashboard(report, rows, {}).entries);
  assert.equal(unsupported.metrics.payout.value, null);
  const failed = summarizeDashboard(
    quickDashboard({ status: 'unavailable', errors: ['미확정'], breakdown: null }, rows, product)
      .entries,
  );
  assert.equal(failed.metrics.fee.value, null);
  assert.equal(failed.errors, 1);
});
