import { Decimal } from './calculation/decimal.js';
import { cleanNumber } from './calculation/asis-data.js';
import { NULL_OVERRIDE, NULLABLE_FIELDS } from './domain.js';

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
  const value = (key) =>
    fields[key]?.status === 'known'
      ? fields[key].value
      : fields[key]?.status === 'not-applicable' && NULLABLE_FIELDS.includes(key)
        ? NULL_OVERRIDE
        : null;
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
    ...(policy.unit === NULL_OVERRIDE || !['NONE', NULL_OVERRIDE].includes(policy.method)
      ? { [`${prefix}_SMT_CALC_UNIT_VAL`]: policy.unit }
      : {}),
  };
  return Object.fromEntries(
    Object.entries(values)
      .filter(
        ([key, value]) =>
          value !== null &&
          (value === NULL_OVERRIDE
            ? NULLABLE_FIELDS.includes(key) && fields[key]?.status !== 'not-applicable'
            : fields[key]?.status !== 'known' || fields[key].value !== value),
      )
      .map(([key, value]) => [key, String(value)]),
  );
}
export function roundingPreview(policy, text) {
  if (
    !policy.method ||
    policy.method === NULL_OVERRIDE ||
    (policy.method !== 'NONE' && [null, NULL_OVERRIDE].includes(policy.unit))
  )
    return null;
  const value = Decimal.parse(cleanNumber(text)).abs();
  const unit = policy.method === 'NONE' || policy.unit === 0 ? '1' : String(policy.unit);
  return {
    positive: value.round(policy.method, unit).toString(),
    negative: value.neg().round(policy.method, unit).toString(),
  };
}
