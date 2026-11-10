import { Decimal } from './decimal.js';
import { cleanNumber, asCsv } from './asis-data.js';

export const DASHBOARD_STATUS_LABELS = {
  match: '일치',
  mismatch: '차이 있음',
  unavailable: '비교 불가',
  error: '계산 불가',
  calculated: '계산 완료',
  partial: '일부 비교',
};

const number = (value, { calculated = false } = {}) => {
  try {
    return Decimal.parse(cleanNumber(value), { maxLength: calculated ? 1000 : 120 });
  } catch {
    return null;
  }
};
const total = (values) =>
  values.reduce((sum, value) => sum.add(value), Decimal.parse('0')).toString();

function entry({ key, rows, status, fee, vat, payout, reasons = [] }) {
  const amounts = rows.map((row) => number(row.amount));
  const inputs = rows.map((row, index) => ({
    amount: amounts[index]?.toString() ?? null,
    currency: row.currency?.trim().toUpperCase() || '미지정',
  }));
  const currencies = [...new Set(inputs.map((input) => input.currency))];
  const signs = new Set(inputs.map((row) => number(row.amount)?.sign()));
  return {
    key,
    inputs,
    status,
    reasons,
    currencies,
    currency: currencies.length === 1 ? currencies[0] : '혼합',
    direction:
      signs.size === 1
        ? { 1: 'positive', '-1': 'negative', 0: 'zero' }[[...signs][0]] || 'unknown'
        : 'mixed',
    amount: amounts.every((amount) => amount !== null) ? total(amounts) : null,
    fee: number(fee, { calculated: true })?.toString() ?? null,
    vat: number(vat, { calculated: true })?.toString() ?? null,
    payout: number(payout, { calculated: true })?.toString() ?? null,
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

export function summarizeDashboard(
  entries,
  { direction = 'all', status = 'all', currency = '' } = {},
) {
  const filtered = entries.filter(
    (item) =>
      (direction === 'all' || item.direction === direction) &&
      (!currency || (item.currencies.length === 1 && item.currency === currency)) &&
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
      const values = filtered
        .map((item) => number(item[key], { calculated: true }))
        .filter((value) => value !== null);
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

export function exportDashboard(model, filters = {}) {
  const { entries } = summarizeDashboard(model.entries, filters);
  return asCsv([
    [
      '상품명',
      '계산 단위',
      '통화',
      '입력 건수',
      '거래금액',
      '수수료',
      '부가세',
      '지급액',
      '결과',
      '확인사항',
    ],
    ...entries.map((item) => [
      model.title,
      item.key,
      item.currency === '혼합' ? item.currencies.join(' / ') : item.currency,
      item.inputs.length,
      item.amount,
      item.fee,
      item.vat,
      item.payout,
      DASHBOARD_STATUS_LABELS[item.status] || item.status,
      item.reasons.join(' '),
    ]),
  ]);
}

export function formatDashboardNumber(value) {
  if (value === null || value === undefined || value === '') return '—';
  const [integer, fraction] = String(value).split('.');
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction ? `.${fraction}` : '');
}

export function dashboardBarWidth(value, maximum) {
  const amount = number(value, { calculated: true }),
    max = number(maximum, { calculated: true });
  if (!amount || !max || max.sign() === 0) return 0;
  return Math.min(100, Number(amount.abs().div(max.abs()).mul('100').round('DOWN').toString()));
}

export function dashboardAmounts(entries, limit = 8) {
  return entries
    .map((entry) => ({ entry, amount: number(entry.amount, { calculated: true }) }))
    .filter((item) => item.amount !== null)
    .sort((left, right) => right.amount.abs().compare(left.amount.abs()))
    .slice(0, limit)
    .map((item) => item.entry);
}
