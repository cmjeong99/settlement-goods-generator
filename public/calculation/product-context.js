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

export function commonCalculationErrors(product) {
  const errors = [];
  const registration = product?.registration;
  if (registration?.MIN_FEE_SETP_YN === 'Y')
    errors.push('최소 수수료 상품은 최소 금액 입력을 아직 지원하지 않아 계산할 수 없어요.');
  if (registration?.TRFS_DVCD && registration.TRFS_DVCD !== 'STANDARD')
    errors.push(
      '구간·기본 요금제는 구간값과 기본 제공량 입력을 아직 지원하지 않아 계산할 수 없어요.',
    );
  return errors;
}
