import { Decimal } from './decimal.js';
import { evaluateFormula } from './expression.js';

const zero = () => Decimal.parse('0');
const sum = (values) =>
  values.filter((value) => value !== null).reduce((total, value) => total.add(value), zero());
const total = (values) => (values.some((value) => value !== null) ? sum(values) : null);

function settingsValue(fields, key) {
  const field = fields[key];
  if (!field || field.status !== 'known' || field.value === null)
    throw new Error(`${key} 설정을 확정해야 비교할 수 있어요.`);
  return field.value;
}

function roundSetting(value, fields, prefix, amount) {
  const absolute = settingsValue(fields, 'ABS_PROCS_YN');
  const position =
    absolute === 'N' && fields.SIGN_APLY_LOCT_DVCD?.value == null
      ? 'NONE'
      : settingsValue(fields, 'SIGN_APLY_LOCT_DVCD');
  const method = settingsValue(fields, `${prefix}_SMT_CALC_MHOD_DVCD`);
  const configuredUnit =
    method === 'NONE' ? 0 : settingsValue(fields, `${prefix}_SMT_CALC_UNIT_VAL`);
  const applySign = (value) => (amount.sign() < 0 && value.sign() > 0 ? value.neg() : value);
  if (position === 'BEFORE') value = applySign(value);
  value = value.round(method, configuredUnit === 0 ? '1' : String(configuredUnit));
  return position === 'AFTER' ? applySign(value) : value;
}

export function calculateSettings(
  fields,
  rows,
  {
    amountColumn,
    targetAmountColumn = amountColumn,
    countColumn,
    feeValue,
    countPerRow = '1',
    engine = 'COMMON',
  } = {},
) {
  if (engine !== 'COMMON')
    throw new Error('이 DB 상품은 특이 계산기 대상이에요. 공통 설정만으로 계산하지 않아요.');
  if (!amountColumn) throw new Error('설정 비교에 사용할 거래금액 컬럼을 선택해 주세요.');
  const amounts = rows.map((row) => {
    if (row[amountColumn] === null || row[amountColumn] === undefined || row[amountColumn] === '')
      throw new Error(`${amountColumn} 거래금액이 필요해요.`);
    return Decimal.parse(row[amountColumn]);
  });
  const value = Decimal.parse(feeValue);
  const counts = rows.map((row) => Decimal.parse(countColumn ? row[countColumn] : countPerRow));
  const targetAmounts = rows.map((row, index) =>
    row[targetAmountColumn] === null ||
    row[targetAmountColumn] === undefined ||
    row[targetAmountColumn] === ''
      ? amounts[index]
      : Decimal.parse(row[targetAmountColumn]),
  );
  if (value.sign() < 0 || counts.some((count) => count.sign() < 0 || count.d !== 1n))
    throw new Error('요율·단가는 비음수, 건수는 비음수 정수로 입력해 주세요.');
  const feeType = settingsValue(fields, 'FEE_TYPE_DVCD');
  const feeBasis = settingsValue(fields, 'FRIM_BASE_DVCD');
  if (feeType === 'FIXED' && !['SCOUNT', 'TCOUNT'].includes(feeBasis))
    throw new Error('정액 수수료의 건수 기준을 확인해야 비교할 수 있어요.');
  const absolute = settingsValue(fields, 'ABS_PROCS_YN') === 'Y';
  const feeBase = settingsValue(fields, 'FEE_SMT_CALC_BASE_DVCD');
  const vatType = settingsValue(fields, 'VAT_DVCD');
  const aggregateCalculation =
    feeBase === 'SUM' || (vatType !== 'ZERO' && fields.VAT_SMT_CALC_BASE_DVCD?.value === 'SUM');
  if (
    aggregateCalculation &&
    absolute &&
    fields.SIGN_APLY_LOCT_DVCD?.value !== 'NONE' &&
    amounts.some((amount) => amount.sign() > 0) &&
    amounts.some((amount) => amount.sign() < 0)
  )
    throw new Error('승인과 취소는 따로 입력해 검증해 주세요.');
  const indexes = rows.map((_, index) => index);
  const groups = feeBase === 'SUM' ? [indexes] : indexes.map((index) => [index]);
  const rawFees = groups.map((group) => {
    const amount = sum(group.map((index) => targetAmounts[index]));
    const target =
      feeType === 'FIXED'
        ? sum(group.map((index) => counts[index]))
        : absolute
          ? amount.abs()
          : amount;
    return target.mul(value);
  });
  const fees = rawFees.map((fee, index) =>
    roundSetting(fee, fields, 'FEE', sum(groups[index].map((index) => amounts[index]))),
  );
  if (vatType === 'INCLUDED')
    throw new Error('VAT 포함·재분리 계산은 별도 계산기가 필요해요. 원문 수식으로 확인하세요.');
  let vats = [zero()];
  const rawVats = [];
  if (vatType !== 'ZERO') {
    const vatTarget = settingsValue(fields, 'VAT_CALC_TRGT_DVCD');
    const vatBase = settingsValue(fields, 'VAT_SMT_CALC_BASE_DVCD');
    if (vatTarget === 'NONE')
      throw new Error('VAT 계산 대상이 없는 과세 설정이에요. 상품 설정을 확인하세요.');
    if (feeBase === 'SUM' && vatBase === 'EACH')
      throw new Error('합산 수수료를 건별 VAT로 배분하는 방식은 별도 확인이 필요해요.');
    const targets = vatTarget === 'FEE' ? fees : rawFees;
    const vatGroups = vatBase === 'SUM' ? [targets] : targets.map((target) => [target]);
    vats = vatGroups.map((group, index) => {
      let target = sum(group);
      if (absolute) target = target.abs();
      const amount =
        vatBase === 'SUM' ? sum(amounts) : sum(groups[index].map((index) => amounts[index]));
      const rawVat = target.mul('0.1');
      rawVats.push(rawVat);
      return roundSetting(rawVat, fields, 'VAT', amount);
    });
  }
  const fee = sum(fees),
    vat = sum(vats);
  const payout = sum(amounts).sub(fee).sub(vat);
  return {
    fee,
    vat,
    payout,
    breakdown: {
      amount: sum(amounts).toString(),
      targetAmount: sum(targetAmounts).toString(),
      rawFee: sum(rawFees).toString(),
      fee: fee.toString(),
      feeCalculationCount: fees.length,
      rawVat: sum(rawVats).toString(),
      vat: vat.toString(),
      vatCalculationCount: rawVats.length,
      payout: payout.toString(),
    },
  };
}

export function verifyCalculation(
  result,
  rows,
  { fields = result.fields, expected = {}, ...options } = {},
) {
  if (!rows.length || rows.length > 100) throw new Error('검증할 거래를 1~100행 입력해 주세요.');
  const sql = {};
  const errors = [];
  const unavailable = new Set();
  const details = {};
  for (const key of ['fee', 'vat']) {
    try {
      if (!result.formulas[key]) throw new Error('원문 수식이 없어요.');
      const values = evaluateFormula(result.formulas[key], rows);
      details[key] = values.map((value) => (value === null ? 'NULL' : value.toString()));
      sql[key] = total(values);
    } catch (error) {
      errors.push(`${key === 'fee' ? '수수료' : '부가세'}: ${error.message}`);
      sql[key] = null;
      unavailable.add(key);
    }
  }
  sql.payout = null;
  if (!options.amountColumn || unavailable.size) unavailable.add('payout');
  if (options.amountColumn && sql.fee !== null && sql.vat !== null) {
    try {
      sql.payout = sum(rows.map((row) => Decimal.parse(row[options.amountColumn])))
        .sub(sql.fee)
        .sub(sql.vat);
    } catch (error) {
      errors.push(error.message);
      unavailable.add('payout');
    }
  }
  let settings = null;
  try {
    settings = calculateSettings(fields, rows, options);
  } catch (error) {
    errors.push(`설정 비교: ${error.message}`);
  }
  const comparisons = ['fee', 'vat', 'payout'].map((key) => {
    const expectedValue =
      expected[key] === undefined || expected[key] === '' ? null : Decimal.parse(expected[key]);
    return {
      key,
      sql: unavailable.has(key) ? '계산 불가' : (sql[key]?.toString() ?? 'NULL'),
      settings: settings?.[key]?.toString() ?? '계산 불가',
      expected: expectedValue?.toString() ?? '미입력',
      settingsMatch: sql[key] && settings?.[key] ? sql[key].compare(settings[key]) === 0 : null,
      expectedMatch: sql[key] && expectedValue ? sql[key].compare(expectedValue) === 0 : null,
    };
  });
  return { comparisons, errors, details };
}
