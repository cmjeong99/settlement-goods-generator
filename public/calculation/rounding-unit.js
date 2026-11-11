import { Decimal } from './decimal.js';

// RoundingRule.apply uses BigDecimal.setScale: 0 = 1, -1 = 10, 2 = 0.01.
export function validScale(value) {
  return Number.isInteger(value) && Math.abs(value) <= 999;
}

export function roundingUnit(scale) {
  if (!validScale(scale)) throw new Error('계산 단위 코드는 -999~999 정수로 입력해 주세요.');
  return Decimal.unit(scale);
}

export function roundingUnitLabel(scale) {
  if (!validScale(scale)) return '단위 확인 필요';
  return Math.abs(scale) <= 12
    ? `${roundingUnit(scale).toString()}원 단위`
    : `소수 자릿수 ${scale} (scale)`;
}
