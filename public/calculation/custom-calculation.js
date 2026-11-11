import { Decimal } from './decimal.js';
import { calculatorCode, customCalculator } from './batch-reference.js';
import { cleanNumber } from './asis-data.js';

const zero = () => Decimal.parse('0');
const sum = (values) => values.reduce((total, value) => total.add(value), zero());
const token = (value, kind = 'input') => ({ text: String(value), kind });
const expression = (left, op, right) => {
  const negative = op === '−' && String(right).startsWith('-');
  return [
    token(left),
    token(` ${op} ${negative ? '(' : ''}`, 'operator'),
    token(right, ['×', '÷'].includes(op) ? 'rate' : 'input'),
    ...(negative ? [token(')', 'operator')] : []),
  ];
};

function step(expression, raw, result, adjustments = []) {
  return { expression, raw: raw.toString(), result: result.toString(), adjustments };
}

function rounded(value, method, unit, adjustments) {
  const result = value.round(method, unit);
  adjustments.push({
    kind: 'round',
    method,
    unit,
    input: value.toString(),
    result: result.toString(),
  });
  return result;
}

export function calculateCustom(product, rows, { parameters = {}, feeValue } = {}) {
  const rule = customCalculator(product);
  if (!rule) throw new Error('이 상품코드로 등록된 배치 CUSTOM 계산기를 확인하지 못했어요.');
  const code = calculatorCode(product);
  const amount = sum(rows.map((row) => row.amount));
  const required = (key, label) => {
    const text = cleanNumber(parameters[key]);
    if (!text) throw new Error(`${label}을 입력해 주세요. 기존 금액 비교값과는 별도 입력이에요.`);
    return Decimal.parse(text);
  };
  let fee, vat, feeStep, vatStep;
  const preparation = [];
  if (rule.countBased) {
    const count = sum(rows.map((row) => row.count));
    const rawFee = count.mul(feeValue);
    const initialFee = rawFee.round('SIGNED_DOWN');
    const rawVat = initialFee.mul('0.1');
    const initialVat = rawVat.round('SIGNED_DOWN');
    const total = initialFee.add(initialVat).round('DOWN', '10');
    preparation.push(
      {
        label: '건수 × 단가',
        ...step(expression(count, '×', feeValue), rawFee, initialFee, [
          {
            kind: 'round',
            method: 'SIGNED_DOWN',
            unit: '1',
            input: rawFee.toString(),
            result: initialFee.toString(),
          },
        ]),
      },
      {
        label: '부가세 선계산',
        ...step(expression(initialFee, '×', '0.1'), rawVat, initialVat, [
          {
            kind: 'round',
            method: 'SIGNED_DOWN',
            unit: '1',
            input: rawVat.toString(),
            result: initialVat.toString(),
          },
        ]),
      },
      {
        label: '총액 10원 절사',
        ...step(expression(initialFee, '+', initialVat), initialFee.add(initialVat), total, [
          {
            kind: 'round',
            method: 'DOWN',
            unit: '10',
            input: initialFee.add(initialVat).toString(),
            result: total.toString(),
          },
        ]),
      },
    );
    const raw = total.div('1.1');
    fee = raw.round('DOWN');
    vat = total.sub(fee);
    feeStep = step(expression(total, '÷', '1.1'), raw, fee, [
      { kind: 'round', method: 'DOWN', unit: '1', input: raw.toString(), result: fee.toString() },
    ]);
    vatStep = step(expression(total, '−', fee), vat, vat);
  } else {
    const gross =
      code === 'MOBILE-GOVERNMENT'
        ? amount.sub(required('scheduledPayout', '확정할 지급예정금액 합계'))
        : required('grossFee', 'VAT 포함 수수료 합계');
    if (code === 'MOBILE-GOVERNMENT')
      preparation.push({
        label: '지급액 차감',
        ...step(expression(amount, '−', amount.sub(gross)), gross, gross),
      });
    const target = code === 'MOBILE-TIMONET' ? gross.abs() : gross;
    const adjustments = [];
    const raw = target.div('1.1');
    const divided = rounded(raw, 'HALF_UP', '0.000001', adjustments);
    fee = rounded(divided, 'SIGNED_DOWN', '1', adjustments);
    if (code === 'MOBILE-TIMONET' && gross.sign() < 0) {
      const signed = fee.neg();
      adjustments.push({
        kind: 'sign',
        position: 'AFTER',
        input: fee.toString(),
        result: signed.toString(),
      });
      fee = signed;
    }
    const formula =
      code === 'MOBILE-TIMONET' && gross.sign() < 0
        ? [
            token('ABS', 'function'),
            token('(', 'operator'),
            token(gross),
            token(') ÷ ', 'operator'),
            token('1.1', 'rate'),
          ]
        : expression(gross, '÷', '1.1');
    feeStep = step(formula, raw, fee, adjustments);
    vat = gross.sub(fee);
    vatStep = step(expression(gross, '−', fee), vat, vat);
  }
  return {
    fee,
    vat,
    payout: amount.sub(fee).sub(vat),
    breakdown: {
      amount: amount.toString(),
      targetAmount: amount.toString(),
      rawFee: feeStep.raw,
      fee: fee.toString(),
      feeCalculationCount: 1,
      rawVat: vatStep.raw,
      vat: vat.toString(),
      vatCalculationCount: 1,
      payout: amount.sub(fee).sub(vat).toString(),
      steps: { fee: [feeStep], vat: [vatStep] },
      preparation,
    },
  };
}
