import { NULL_OVERRIDE } from '../domain.js';

const registrationValue = (value, fallback = null) =>
  value === NULL_OVERRIDE ? null : String(value ?? '').trim() || fallback;

export function currentProductContext(dbProduct, { registration, identity } = {}) {
  if (!registration)
    return {
      ...dbProduct,
      name: identity?.name || (dbProduct ? `${dbProduct.name} · 내 설정` : '내 상품 설정'),
      engine: dbProduct?.engine ?? 'COMMON',
    };
  return {
    ...dbProduct,
    name: identity?.name || (dbProduct ? `${dbProduct.name} · 내 설정` : '내 상품 설정'),
    registration,
    serviceCode: registrationValue(registration.SRVC_CD) || '',
    detailServiceCode: registrationValue(registration.DTLS_SRVC_CD) || '',
    // MerchantEachCalculateService/MerchantSumCalculateService route only CUSTOM
    // to a dedicated calculator. A NULL engine follows their common path.
    engine: registrationValue(registration.CALC_ENGE_DVCD) || 'COMMON',
    settlement: {
      paymentMethod: registrationValue(registration.PAYM_MHOD_DVCD),
      // The DB default is PRE when this optional INSERT column is omitted.
      feeCollection: registrationValue(registration.FEE_RCVG_DVCD, 'PRE'),
    },
  };
}

export function commonCalculationErrors(product, parameters = {}) {
  const errors = [];
  const registration = product?.registration;
  const missing = (key) => String(parameters[key] ?? '').trim() === '';
  if (registration?.MIN_FEE_SETP_YN === 'Y' && missing('minimumFee'))
    errors.push('최소 수수료 상품은 계산기에서 최소 금액을 입력해 주세요.');
  if (registration?.TRFS_DVCD === 'BASE' && (missing('baseFee') || missing('baseOffer')))
    errors.push('기본 요금제는 계산기에서 기본요금과 기본 제공량을 입력해 주세요.');
  if (registration?.TRFS_DVCD === 'SLIDING' && missing('tierFrom'))
    errors.push('구간 요금제는 계산기에서 적용 구간을 입력해 주세요.');
  return errors;
}
