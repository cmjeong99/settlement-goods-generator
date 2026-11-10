import { Decimal } from './decimal.js';
import { cleanNumber } from './asis-data.js';

const number = (value) => {
  try {
    return Decimal.parse(cleanNumber(value));
  } catch {
    return null;
  }
};
const total = (values) =>
  values.reduce((sum, value) => sum.add(value), Decimal.parse('0')).toString();

function entry({ key, rows, status, fee, vat, payout, reasons = [] }) {
  const inputs = rows.map((row) => ({
    amount: number(row.amount)?.toString() ?? null,
    currency: row.currency?.trim() || '미지정',
  }));
  const signs = new Set(inputs.map((row) => number(row.amount)?.sign()));
  return {
    key,
    inputs,
    status,
    reasons,
    direction:
      signs.size === 1
        ? { 1: 'positive', '-1': 'negative', 0: 'zero' }[[...signs][0]] || 'unknown'
        : 'mixed',
    amount: inputs.every((row) => row.amount !== null)
      ? total(inputs.map((row) => number(row.amount)))
      : null,
    fee: number(fee)?.toString() ?? null,
    vat: number(vat)?.toString() ?? null,
    payout: number(payout)?.toString() ?? null,
  };
}

export function quickDashboard(report, rows, product) {
  const payoutSupported =
    product?.settlement?.paymentMethod === 'PAYOUT' && product?.settlement?.feeCollection === 'PRE';
  return {
    title: product?.name || '내 상품 설정',
    scope: '이번 테스트 전체',
    entries: [
      entry({
        key: '이번 테스트',
        rows,
        status: report.breakdown ? report.status : 'error',
        fee: report.breakdown?.fee,
        vat: report.breakdown?.vat,
        payout: payoutSupported ? report.breakdown?.payout : null,
        reasons: report.errors,
      }),
    ],
  };
}

export function reconciliationDashboard(report, rows, { aggregate = false, title = '' } = {}) {
  return {
    title: title || '선택한 상품',
    scope: aggregate ? '전체 합산 단위' : '행별 계산 단위',
    entries: report.results.map((result, index) =>
      entry({
        key: result.key,
        rows: aggregate ? rows : [rows[index]],
        status: result.status,
        fee: result.metrics?.fee.calculated,
        vat: result.metrics?.vat.calculated,
        payout: result.metrics?.payout.calculated,
        reasons: result.reasons,
      }),
    ),
  };
}

export function summarizeDashboard(entries, { direction = 'all', status = 'all' } = {}) {
  const filtered = entries.filter(
    (item) =>
      (direction === 'all' || item.direction === direction) &&
      (status === 'all' ||
        (status === 'attention'
          ? ['mismatch', 'error', 'unavailable'].includes(item.status)
          : item.status === status)),
  );
  const inputs = filtered.flatMap((item) => item.inputs);
  const currencies = [...new Set(inputs.map((row) => row.currency))];
  const mixedCurrencies = currencies.length > 1;
  const valid = inputs.map((row) => number(row.amount)).filter((value) => value !== null);
  const metrics = Object.fromEntries(
    ['fee', 'vat', 'payout'].map((key) => {
      const values = filtered.map((item) => number(item[key])).filter((value) => value !== null);
      return [
        key,
        { value: values.length && !mixedCurrencies ? total(values) : null, count: values.length },
      ];
    }),
  );
  return {
    entries: filtered,
    currencies,
    mixedCurrencies,
    metrics,
    count: inputs.length,
    invalidAmounts: inputs.length - valid.length,
    amount: valid.length && !mixedCurrencies ? total(valid) : null,
    positive: valid.filter((value) => value.sign() > 0).length,
    negative: valid.filter((value) => value.sign() < 0).length,
    zero: valid.filter((value) => value.sign() === 0).length,
    positiveAmount: mixedCurrencies ? null : total(valid.filter((value) => value.sign() > 0)),
    negativeAmount: mixedCurrencies ? null : total(valid.filter((value) => value.sign() < 0)),
    attention: filtered.filter((item) => ['mismatch', 'error', 'unavailable'].includes(item.status))
      .length,
    errors: filtered.filter((item) => item.status === 'error').length,
  };
}

export function formatDashboardNumber(value) {
  if (value === null || value === undefined || value === '') return '—';
  const [integer, fraction] = String(value).split('.');
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction ? `.${fraction}` : '');
}

export function dashboardBarWidth(value, maximum) {
  const amount = number(value),
    max = number(maximum);
  if (!amount || !max || max.sign() === 0) return 0;
  return Math.min(100, Number(amount.abs().div(max.abs()).mul('100').round('DOWN').toString()));
}
