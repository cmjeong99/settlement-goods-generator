import { Decimal } from './decimal.js';
import { evaluateFormula } from './expression.js';
import { roundingUnit } from './rounding-unit.js';

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

function roundSetting(value, fields, prefix, amount, adjustments) {
  const absolute = settingsValue(fields, 'ABS_PROCS_YN');
  const position =
    absolute === 'N' && fields.SIGN_APLY_LOCT_DVCD?.value == null
      ? 'NONE'
      : settingsValue(fields, 'SIGN_APLY_LOCT_DVCD');
  const method = settingsValue(fields, `${prefix}_SMT_CALC_MHOD_DVCD`);
  const configuredUnit =
    method === 'NONE' || fields[`${prefix}_SMT_CALC_UNIT_VAL`]?.status === 'not-applicable'
      ? 0
      : settingsValue(fields, `${prefix}_SMT_CALC_UNIT_VAL`);
  const applySign = (value) => (amount.sign() < 0 && value.sign() > 0 ? value.neg() : value);
  const sign = () => {
    const signed = applySign(value);
    adjustments?.push({
      kind: 'sign',
      position,
      input: value.toString(),
      result: signed.toString(),
    });
    value = signed;
  };
  if (position === 'BEFORE') sign();
  const unit = roundingUnit(configuredUnit).toString();
  const rounded = value.round(method, unit);
  adjustments?.push({
    kind: 'round',
    method,
    unit,
    input: value.toString(),
    result: rounded.toString(),
  });
  value = rounded;
  if (position === 'AFTER') sign();
  return value;
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
    tariff = 'STANDARD',
    parameters = {},
    minimumFeeEnabled = false,
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
  if (!['AMOUNT', 'SCOUNT', 'TCOUNT'].includes(feeBasis))
    throw new Error('수수료의 과금 기준을 확인해야 비교할 수 있어요.');
  const countBased = feeBasis !== 'AMOUNT';
  if (!['STANDARD', 'BASE', 'SLIDING'].includes(tariff))
    throw new Error('지원하지 않는 요금제예요. 배치 요금제 코드를 확인해 주세요.');
  const parameter = (key, label, { optional = false } = {}) => {
    const text = String(parameters[key] ?? '')
      .replaceAll(',', '')
      .trim();
    if (!text) {
      if (optional) return null;
      throw new Error(`${label}을 입력해 주세요.`);
    }
    return Decimal.parse(text);
  };
  const baseFee = tariff === 'BASE' ? parameter('baseFee', '기본요금') : null;
  const baseOffer = tariff === 'BASE' ? parameter('baseOffer', '기본 제공량') : null;
  const tierFrom = tariff === 'SLIDING' ? parameter('tierFrom', '구간 시작값') : null;
  const tierTo = tariff === 'SLIDING' ? parameter('tierTo', '구간 끝값', { optional: true }) : null;
  if (tierTo && tierTo.compare(tierFrom) <= 0)
    throw new Error('구간 끝값은 시작값보다 커야 해요. 끝값은 구간에 포함하지 않아요.');
  const minimumFee = minimumFeeEnabled ? parameter('minimumFee', '최소 수수료').abs() : null;
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
  const feeSteps = [];
  const rawFees = groups.map((group) => {
    const amount = sum(group.map((index) => targetAmounts[index]));
    const target = countBased
      ? sum(group.map((index) => counts[index]))
      : absolute
        ? amount.abs()
        : amount;
    let raw = target.mul(value);
    let expression;
    const input = (value) => ({ text: value.toString(), kind: 'input' });
    const op = (text) => ({ text, kind: 'operator' });
    if (tariff === 'BASE') {
      raw =
        target.sign() === 0
          ? zero()
          : target.compare(baseOffer) <= 0
            ? baseFee
            : baseFee.add(target.sub(baseOffer).mul(value));
      expression =
        target.sign() === 0
          ? [input('0')]
          : target.compare(baseOffer) <= 0
            ? [input(baseFee)]
            : [
                input(baseFee),
                op(' + ('),
                input(target),
                op(' − '),
                input(baseOffer),
                op(') × '),
                input(value),
              ];
    } else if (tariff === 'SLIDING') {
      if (target.compare(tierFrom) < 0 || (tierTo && target.compare(tierTo) >= 0))
        throw new Error(
          '입력한 대상은 선택 구간에 속하지 않아요. 시작 이상·끝 미만의 구간을 입력해 주세요.',
        );
    }
    feeSteps.push({
      inputs: group.map((index) => (countBased ? counts[index] : targetAmounts[index]).toString()),
      inputTotal: countBased
        ? sum(group.map((index) => counts[index])).toString()
        : amount.toString(),
      basis: countBased ? '과금건수' : '계산대상금액',
      absolute: !countBased && absolute,
      ...(expression ? { expression } : {}),
      multiplier: value.toString(),
      raw: raw.toString(),
      adjustments: [],
    });
    return raw;
  });
  const fees = rawFees.map((fee, index) => {
    const amount = sum(groups[index].map((index) => amounts[index]));
    const rounded = roundSetting(fee, fields, 'FEE', amount, feeSteps[index].adjustments);
    if (minimumFee && rounded.abs().compare(minimumFee) < 0) {
      const result = amount.sign() < 0 ? minimumFee.neg() : minimumFee;
      feeSteps[index].adjustments.push({
        kind: 'minimum',
        input: rounded.toString(),
        result: result.toString(),
      });
      return result;
    }
    return rounded;
  });
  if (vatType === 'INCLUDED')
    throw new Error(
      'VAT 포함의 공통 계산과 상품별 CUSTOM 재분리는 달라요. 배치의 상품코드·계산 엔진 매핑을 확인해 주세요.',
    );
  let vats = [zero()];
  const rawVats = [];
  const vatSteps = [];
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
      const step = {
        inputs: group.map((value) => value.toString()),
        inputTotal: sum(group).toString(),
        basis: vatTarget === 'FEE' ? '계산된 수수료' : '단수 처리 전 수수료',
        absolute,
        multiplier: '0.1',
        raw: rawVat.toString(),
        adjustments: [],
      };
      vatSteps.push(step);
      return roundSetting(rawVat, fields, 'VAT', amount, step.adjustments);
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
      steps: {
        fee: feeSteps.map((step, index) => ({ ...step, result: fees[index].toString() })),
        vat: vatSteps.map((step, index) => ({ ...step, result: vats[index].toString() })),
      },
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
