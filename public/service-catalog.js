// [Daon] 플랫폼-서비스 관계, page 472613061, version 39 (2026-10-27).
export const SERVICE_CATALOG_SOURCE = 'https://danal.atlassian.net/wiki/x/xYArH';

export const SERVICES = [
  ['10101', '휴대폰'],
  ['12206', '카드'],
  ['12204', '특수한도카드'],
  ['12801', '제휴간편결제'],
  ['10602', '계좌이체'],
  // The relationship table and existing DB products use 12502. The page's
  // service list instead says 12052; that conflicting entry is not auto-resolved.
  ['12502', '가상계좌'],
  ['10901', '컬처랜드상품권'],
  ['10903', '도서문화상품권'],
  ['10603', '오픈뱅킹'],
  ['10701', '티머니상품권'],
  ['51001', '페이코인'],
  ['50601', '위챗페이-학비결제온라인'],
  ['50415', '위챗페이-오프라인'],
  ['50602', '위챗페이-학비결제미니프로그램'],
  ['51101', '보쿠'],
  ['51102', '알리페이플러스'],
  ['50802', '비자사이버소스'],
  ['51401', '페이팔'],
  ['12001', '본인확인'],
  ['11501', '기업형SMS'],
  ['11505', '인증SMS'],
  ['11511', '계좌성명조회'],
  ['11520', '계좌점유인증'],
  ['11515', '상품권발행'],
];
const details = {
  10101: { '01': '디지털', '02': '실물', '03': '오프라인' },
  10602: { '01': '뱅크페이', '02': '케이뱅크' },
  12502: { '01': '헥토파이낸셜', '02': '더즌', '03': '농협', '04': '하나' },
  12801: {
    '01': '삼성월렛머니',
    '02': '네이버페이머니',
    '03': '카카오페이머니',
    '04': '페이코포인트',
    '05': '페이코쿠폰',
  },
  12204: { '01': 'LG특수카드' },
  51102: { HKG: '홍콩', IDN: '인도', MYS: '말레이시아', PHL: '필리핀', THA: '태국' },
  51101: {
    IDN: '인도',
    MYS: '말레이시아',
    PHL: '필리핀',
    SGP: '싱가포르',
    THA: '태국',
    TWN: '대만',
    VNM: '베트남',
  },
  51401: { '01': '학비결제온라인' },
};
const names = new Map(SERVICES);
const unresolved = new Map([
  [
    '51104',
    '문서에서 엑심베이와 잘로페이가 같은 코드로 기재되어 있어요. 서비스명을 직접 입력해 주세요.',
  ],
  [
    '12052',
    '문서의 서비스 목록과 관계표에 가상계좌 코드가 다르게 기재되어 있어요. 서비스코드를 확인해 주세요.',
  ],
]);

export function detailServiceOptions(serviceCode) {
  return [['00', '일반'], ...Object.entries(details[serviceCode] ?? {})];
}

export function resolveServiceIdentity(registration = {}) {
  const serviceCode = String(registration.SRVC_CD ?? '').trim();
  const detailCode = String(registration.DTLS_SRVC_CD ?? '').trim();
  const serviceName = names.get(serviceCode) ?? '';
  const detailName = detailCode === '00' ? '일반' : (details[serviceCode]?.[detailCode] ?? '');
  return {
    serviceCode,
    detailCode,
    serviceName,
    detailName,
    warning:
      unresolved.get(serviceCode) ??
      (serviceCode && !serviceName
        ? '서비스명을 확인할 수 없어요. 이름 추천의 서비스명 또는 설명을 입력해 주세요.'
        : ''),
  };
}
