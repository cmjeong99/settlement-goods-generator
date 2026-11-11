import { Decimal } from './decimal.js';
import { calculateSettings } from './verify.js';
import { cleanNumber, MAX_ASIS_ROWS, asCsv } from './asis-data.js';
import { commonCalculationErrors } from './product-context.js';
import { calculateCustom } from './custom-calculation.js';
import { customCalculator } from './batch-reference.js';

export const RECONCILIATION_LABELS = {
  match: '일치',
  mismatch: '불일치',
  partial: '일부 항목만 비교',
  calculated: 'AS-IS 값 없음',
  error: '계산 불가',
};
const sum = (values) => values.reduce((total, value) => total.add(value), Decimal.parse('0'));
export const needsAggregation = (product) =>
  !!customCalculator(product) ||
  product?.expected.FEE_SMT_CALC_BASE_DVCD === 'SUM' ||
  (product?.expected.VAT_DVCD !== 'ZERO' && product?.expected.VAT_SMT_CALC_BASE_DVCD === 'SUM');

function numeric(value, label, { required = true, fallback } = {}) {
  const cleaned = cleanNumber(value);
  if (!cleaned) {
    if (fallback !== undefined) return Decimal.parse(fallback);
    if (required) throw new Error(`${label}을 입력해 주세요.`);
    return null;
  }
  try {
    return Decimal.parse(cleaned);
  } catch {
    throw new Error(`${label}의 숫자를 확인해 주세요: ${value}`);
  }
}

function groupedRows(rows, scope) {
  if (scope === 'rows')
    return rows.map((row, index) => ({ key: row.id || `${index + 1}행`, rows: [row] }));
  if (scope === 'all') return [{ key: '전체 합산', rows }];
  if (scope !== 'groups') throw new Error('합산 상품의 검증 단위를 선택해 주세요.');
  const groups = new Map();
  for (const [index, row] of rows.entries()) {
    const key = row.groupKey?.trim() || `그룹 미입력 ${index + 1}행`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups].map(([key, rows]) => ({ key, rows }));
}

function compareMetric(rows, key, calculated) {
  const values = rows.map((row) =>
    numeric(row[key], `AS-IS ${{ asisFee: '수수료', asisVat: 'VAT', asisPayout: '지급액' }[key]}`, {
      required: false,
    }),
  );
  const present = values.filter((value) => value !== null);
  const complete = present.length === rows.length;
  const actual = complete ? sum(present) : null;
  return {
    asis: actual?.toString() ?? '',
    calculated: calculated?.toString() ?? '',
    difference: actual !== null && calculated !== null ? calculated.sub(actual).toString() : '',
    match: actual !== null && calculated !== null ? calculated.compare(actual) === 0 : null,
    missing: rows.length - present.length,
  };
}

export function reconcileAsis(
  product,
  rows,
  {
    scope = 'rows',
    rateUnit = 'ratio',
    useRowProducts = false,
    products = new Map(),
    parameters = {},
    parametersByProduct = new Map(),
  } = {},
) {
  if (!rows.length || rows.length > MAX_ASIS_ROWS)
    throw new Error(`검증할 AS-IS 거래를 1~${MAX_ASIS_ROWS}행 입력해 주세요.`);
  if (!product && !useRowProducts) throw new Error('검증할 상품을 선택해 주세요.');
  if (!['ratio', 'percent'].includes(rateUnit)) throw new Error('요율 단위를 선택해 주세요.');
  if (!useRowProducts && needsAggregation(product) && !scope)
    throw new Error('합산 상품의 검증 단위를 선택해 주세요.');
  const groups = groupedRows(rows, scope || 'rows');
  const results = groups.map((group) => {
    let selectedProduct = product;
    try {
      if (scope === 'groups' && group.rows.some((row) => !row.groupKey?.trim()))
        throw new Error('GROUP_KEY에 검증 그룹을 입력해 주세요.');
      if (useRowProducts) {
        const codes = new Set(
          group.rows.map((row) => row.productCode || product?.code).filter(Boolean),
        );
        if (codes.size !== 1) throw new Error('한 검증 단위에는 동일한 상품코드가 필요해요.');
        selectedProduct = products.get([...codes][0]);
      }
      if (!selectedProduct) throw new Error('입력한 상품코드를 찾을 수 없어요.');
      if (needsAggregation(selectedProduct) && !scope)
        throw new Error('합산 상품의 검증 단위를 선택해 주세요.');
      const custom = customCalculator(selectedProduct);
      if (selectedProduct.engine !== 'COMMON' && !custom)
        throw new Error('이 상품코드로 등록된 배치 CUSTOM 계산기를 확인하지 못했어요.');
      if (custom && scope === 'rows')
        throw new Error(
          '이 상품은 합산 검증에서 계산해 주세요. 배치의 합산 CUSTOM 계산기 대상이에요.',
        );
      const selectedParameters = parametersByProduct.get(selectedProduct.code) || parameters;
      const contextErrors = custom
        ? []
        : commonCalculationErrors(selectedProduct, selectedParameters);
      if (contextErrors.length) throw new Error(contextErrors.join(' '));
      // Do not silently combine distinct merchant settlements or fee contracts.
      for (const key of ['merchant', 'period', 'currency']) {
        if (new Set(group.rows.map((row) => row[key] || '')).size > 1)
          throw new Error(
            '같은 가맹점·정산기간·통화의 거래만 넣어 주세요. 다른 거래는 따로 검증해 주세요.',
          );
      }
      const fixed = selectedProduct.expected.FEE_TYPE_DVCD === 'FIXED';
      const values = group.rows.map((row) => {
        if (custom && !custom.countBased) return Decimal.parse('0');
        const text = String(row.feeValue ?? '').trim();
        const percent = text.endsWith('%');
        if (fixed && percent) throw new Error('정액단가는 금액으로 입력해 주세요.');
        const value = numeric(percent ? text.slice(0, -1) : text, fixed ? '정액단가' : '요율');
        return !fixed && (percent || rateUnit === 'percent') ? value.div('100') : value;
      });
      if (values.some((value) => value.compare(values[0]) !== 0))
        throw new Error('같은 요율·단가의 거래만 넣어 주세요. 다른 거래는 따로 검증해 주세요.');
      const feeValue = values[0];
      const data = group.rows.map((row) => ({
        amount: numeric(row.amount, '거래금액'),
        targetAmount: numeric(row.targetAmount, '계산대상금액', { required: false }) ?? '',
        count: numeric(row.count, '과금건수', { fallback: '1' }),
      }));
      const fields = Object.fromEntries(
        Object.entries(selectedProduct.expected).map(([key, value]) => [
          key,
          { value, status: value === null ? 'unknown' : 'known' },
        ]),
      );
      const calculation = custom
        ? calculateCustom(selectedProduct, data, { parameters: selectedParameters, feeValue })
        : calculateSettings(fields, data, {
            amountColumn: 'amount',
            targetAmountColumn: 'targetAmount',
            countColumn: 'count',
            feeValue,
            engine: selectedProduct.engine,
            tariff: selectedProduct.registration?.TRFS_DVCD || 'STANDARD',
            parameters: selectedParameters,
            minimumFeeEnabled: selectedProduct.registration?.MIN_FEE_SETP_YN === 'Y',
          });
      const payoutSupported =
        selectedProduct.settlement?.paymentMethod === 'PAYOUT' &&
        selectedProduct.settlement?.feeCollection === 'PRE';
      const metrics = {
        fee: compareMetric(group.rows, 'asisFee', calculation.fee),
        vat: compareMetric(group.rows, 'asisVat', calculation.vat),
        payout: compareMetric(
          group.rows,
          'asisPayout',
          payoutSupported ? calculation.payout : null,
        ),
      };
      const comparisons = Object.values(metrics);
      const compared = comparisons.filter((item) => item.match !== null);
      const status = compared.some((item) => !item.match)
        ? 'mismatch'
        : compared.length === 3
          ? 'match'
          : compared.length
            ? 'partial'
            : 'calculated';
      const reasons = [];
      if (!payoutSupported)
        reasons.push(
          '지급액 비교는 선취·지급 상품에서만 지원해요. 이 상품은 수수료와 VAT만 비교해요.',
        );
      if (
        !useRowProducts &&
        group.rows.some((row) => row.productCode && row.productCode !== selectedProduct.code)
      )
        reasons.push(
          '원본 상품코드와 다른 상품을 선택했어요. 선택한 상품 설정으로 계산한 결과예요.',
        );
      if (comparisons.some((item) => item.missing))
        reasons.push('미입력·NULL인 AS-IS 금액은 일치로 판정하지 않아요.');
      return {
        key: group.key,
        productCode: selectedProduct.code,
        sourceRows: group.rows.map((row) => row.sourceRow),
        count: group.rows.length,
        amount: sum(data.map((row) => Decimal.parse(row.amount))).toString(),
        metrics,
        breakdown: calculation.breakdown,
        status,
        reasons,
      };
    } catch (error) {
      return {
        key: group.key,
        productCode: selectedProduct?.code ?? '',
        sourceRows: group.rows.map((row) => row.sourceRow),
        count: group.rows.length,
        amount: '',
        metrics: null,
        status: 'error',
        reasons: [error.message],
      };
    }
  });
  return {
    results,
    summary: Object.fromEntries(
      Object.keys(RECONCILIATION_LABELS).map((status) => [
        status,
        results.filter((result) => result.status === status).length,
      ]),
    ),
  };
}

export function exportReconciliation(results) {
  const header = [
    '거래/그룹',
    '상품코드',
    '원본행',
    '거래금액',
    'ASIS_FEE',
    'CALC_FEE',
    'DIFF_FEE',
    'ASIS_VAT',
    'CALC_VAT',
    'DIFF_VAT',
    'ASIS_PAYOUT',
    'CALC_PAYOUT',
    'DIFF_PAYOUT',
    '판정',
    '확인사항',
  ];
  return asCsv([
    header,
    ...results.map((result) => [
      result.key,
      result.productCode,
      result.sourceRows.join(', '),
      result.amount,
      ...['fee', 'vat', 'payout'].flatMap((key) => [
        result.metrics?.[key].asis ?? '',
        result.metrics?.[key].calculated ?? '',
        result.metrics?.[key].difference ?? '',
      ]),
      RECONCILIATION_LABELS[result.status],
      result.reasons.join(' '),
    ]),
  ]);
}
