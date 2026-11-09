import { Decimal } from './decimal.js';
import { cleanNumber } from './asis-data.js';
import { referencedColumns, evaluateFormula } from './expression.js';
import { calculateSettings } from './verify.js';

export function sampleRate(text, fixed = false) {
  const value = String(text).trim(),
    percent = value.endsWith('%');
  if (fixed && percent) throw new Error('정액단가는 금액으로 입력해 주세요.');
  const number = Decimal.parse(cleanNumber(percent ? value.slice(0, -1) : value));
  return (!fixed && percent ? number.div('100') : number).toString();
}

export function suggestSampleColumns(source) {
  const columns = referencedColumns(source.formulas);
  const unique = (pattern) => {
    const matches = columns.filter((name) => pattern.test(name.split('.').at(-1)));
    return matches.length === 1 ? matches[0] : null;
  };
  return {
    columns,
    amount: unique(/^(AMT|TX_AMOUNT|BILL_AMOUNT|AMOUNT)$/),
    rate: unique(/^(CPRATE|CALRATE|AUTHRATE|RATE|R)$/),
    count: unique(/^(CNT|SCOUNT|TCOUNT|COUNT|CNT_S|CNT_T)$/),
  };
}

function originalInput(source, sourceRows) {
  if (source.inputScope !== 'settlement' || sourceRows.length === 1) return sourceRows;
  const amount = suggestSampleColumns(source).amount;
  if (!amount) throw new Error('합산할 원문 금액 컬럼을 하나로 확인할 수 없어요.');
  const first = { ...sourceRows[0] };
  const same = (left, right) => {
    try {
      return Decimal.parse(cleanNumber(left)).compare(Decimal.parse(cleanNumber(right))) === 0;
    } catch {
      return String(left).trim() === String(right).trim();
    }
  };
  const keys = new Set(sourceRows.flatMap((row) => Object.keys(row)));
  for (const row of sourceRows)
    for (const key of keys)
      if (key !== amount && !same(first[key], row[key]))
        throw new Error(`합산 예시의 ${key} 값이 달라요. 같은 정산 단위의 거래를 입력해 주세요.`);
  first[amount] = sourceRows
    .reduce((sum, row) => sum.add(Decimal.parse(cleanNumber(row[amount]))), Decimal.parse('0'))
    .toString();
  return [first];
}

export function compareSample(
  source,
  draft,
  { rows, sourceRows, feeValue, expected = {}, engine = 'COMMON' },
) {
  if (!rows.length || rows.length > 100 || rows.length !== sourceRows.length)
    throw new Error('원문과 상품에 같은 건수의 예시를 입력해 주세요.');
  const errors = [];
  let originalRows = null;
  try {
    originalRows = originalInput(source, sourceRows);
  } catch (error) {
    errors.push(`원문 입력: ${error.message}`);
  }
  let calculation = null;
  try {
    calculation = calculateSettings(draft.fields, rows, {
      amountColumn: 'amount',
      targetAmountColumn: 'targetAmount',
      countColumn: 'count',
      feeValue,
      engine,
    });
  } catch (error) {
    errors.push(`상품 설정: ${error.message}`);
  }
  const metrics = ['fee', 'vat'].map((key) => {
    let original = null;
    try {
      if (!source.formulas[key]) throw new Error('원문 수식이 없어요.');
      if (!originalRows) throw new Error('원문에 대입할 합산 금액을 확인해 주세요.');
      const values = evaluateFormula(source.formulas[key], originalRows).filter(
        (value) => value !== null,
      );
      if (values.length)
        original = values.reduce((total, value) => total.add(value), Decimal.parse('0'));
    } catch (error) {
      errors.push(`${key === 'fee' ? '수수료' : 'VAT'} 원문: ${error.message}`);
    }
    const calculated = calculation?.[key] ?? null;
    const actual = cleanNumber(expected[key]) ? Decimal.parse(cleanNumber(expected[key])) : null;
    return {
      key,
      original: original?.toString() ?? '',
      calculated: calculated?.toString() ?? '',
      difference:
        original !== null && calculated !== null ? calculated.sub(original).toString() : '',
      match: original !== null && calculated !== null ? original.compare(calculated) === 0 : null,
      expected: actual?.toString() ?? '',
      expectedMatch:
        actual !== null && calculated !== null ? actual.compare(calculated) === 0 : null,
    };
  });
  const status = metrics.some((metric) => metric.match === false || metric.expectedMatch === false)
    ? 'mismatch'
    : errors.length || metrics.some((metric) => metric.match === null)
      ? 'unavailable'
      : 'match';
  return { metrics, status, errors, breakdown: calculation?.breakdown ?? null };
}
