import { Decimal } from './calculation/decimal.js';
import { cleanNumber } from './calculation/asis-data.js';

export const ROUNDING_METHODS = [
  ['DOWN', '절사'],
  ['HALF_UP', '반올림'],
  ['CEILING', '올림'],
  ['NONE', '단수 처리 안 함'],
  ['HALF_DOWN', '절반이면 버림'],
  ['SIGNED_DOWN', '음수도 아래로 내림'],
];
export const ROUNDING_UNITS = [
  [0, '1원'],
  [10, '10원'],
  [100, '100원'],
  [0.1, '0.1원'],
  [0.01, '0.01원'],
];

export function unitCode(text) {
  const value = Number(cleanNumber(text));
  if (!Number.isFinite(value) || value <= 0 || value > 1e12)
    throw new Error('단위는 0보다 크고 1조 이하인 금액으로 입력해 주세요.');
  return value === 1 ? 0 : value;
}
export function readRoundingPolicy(fields, prefix) {
  const value = (key) => (fields[key]?.status === 'known' ? fields[key].value : null);
  return {
    method: value(`${prefix}_SMT_CALC_MHOD_DVCD`),
    unit: value(`${prefix}_SMT_CALC_UNIT_VAL`),
    base: value(`${prefix}_SMT_CALC_BASE_DVCD`),
  };
}
export function roundingChanges(fields, prefix, policy) {
  const values = {
    [`${prefix}_SMT_CALC_MHOD_DVCD`]: policy.method,
    [`${prefix}_SMT_CALC_BASE_DVCD`]: policy.base,
    ...(policy.method !== 'NONE' ? { [`${prefix}_SMT_CALC_UNIT_VAL`]: policy.unit } : {}),
  };
  return Object.fromEntries(
    Object.entries(values)
      .filter(
        ([key, value]) =>
          value !== null && (fields[key]?.status !== 'known' || fields[key].value !== value),
      )
      .map(([key, value]) => [key, String(value)]),
  );
}
export function roundingPreview(policy, text) {
  if (!policy.method || (policy.method !== 'NONE' && policy.unit === null)) return null;
  const value = Decimal.parse(cleanNumber(text)).abs();
  const unit = policy.method === 'NONE' || policy.unit === 0 ? '1' : String(policy.unit);
  return {
    positive: value.round(policy.method, unit).toString(),
    negative: value.neg().round(policy.method, unit).toString(),
  };
}
