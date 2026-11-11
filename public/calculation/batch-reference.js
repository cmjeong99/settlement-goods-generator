export const BATCH_REFERENCE = {
  repository: 'daon-settlement-batch',
  revision: '1d34afaf335f3b646741077b4c3b20896374e8fe',
  checkedAt: '2026-11-11',
};

export const CUSTOM_CALCULATORS = {
  'MOBILE-RATE-INCL': {
    name: '휴대폰 VAT 포함 합산',
    source: 'MobileRateIncludeVatMerchantSumCalculator',
    inputs: [['grossFee', 'VAT 포함 수수료 합계']],
    summary: '전달받은 수수료 합계를 1.1로 나누고 내림한 뒤, 차액을 부가세로 계산해요.',
  },
  'MOBILE-TIMONET': {
    name: '티모넷 합산',
    source: 'MobileTmonetMerchantSumCalculator',
    inputs: [['grossFee', 'VAT 포함 수수료 합계']],
    summary: '수수료 합계의 절댓값을 1.1로 나누고 내림한 뒤 원래 부호를 붙여요.',
  },
  'MOBILE-GOVERNMENT': {
    name: '관공서 지급액 역산',
    source: 'MobileGovernmentOfficeMerchantSumCalculator',
    inputs: [['scheduledPayout', '확정할 지급예정금액 합계']],
    summary: '거래금액에서 지급예정금액을 뺀 금액을 수수료와 부가세로 나눠요.',
  },
  'SELF-STANDARD-SCNT-INCL': {
    name: '본인확인 성공건수 VAT 재분리',
    source: 'SelfConfirmIncludeVatMerchantSumCalculator',
    inputs: [],
    countBased: true,
    summary: '건수로 수수료·부가세를 계산하고 총액을 10원 단위로 절사한 뒤 재분리해요.',
  },
  'SELF-STANDARD-TCNT-INCL': {
    name: '본인확인 시도건수 VAT 재분리',
    source: 'SelfConfirmIncludeVatMerchantSumCalculator',
    inputs: [],
    countBased: true,
    summary: '건수로 수수료·부가세를 계산하고 총액을 10원 단위로 절사한 뒤 재분리해요.',
  },
};

export const calculatorCode = (product) => product?.calculatorCode || product?.code;
export const customCalculator = (product) =>
  product?.engine === 'CUSTOM' ? CUSTOM_CALCULATORS[calculatorCode(product)] : null;

export function calculatorParameters(product) {
  if (!product) return [];
  if (product.engine === 'CUSTOM') return customCalculator(product)?.inputs || [];
  const registration = product.registration || {};
  return [
    ...(registration.TRFS_DVCD === 'BASE'
      ? [
          ['baseFee', '기본요금'],
          ['baseOffer', '기본 제공량'],
        ]
      : registration.TRFS_DVCD === 'SLIDING'
        ? [
            ['tierFrom', '적용 구간 시작 (포함)'],
            ['tierTo', '적용 구간 끝 (미포함, 빈칸은 상한 없음)'],
          ]
        : []),
    ...(registration.MIN_FEE_SETP_YN === 'Y' ? [['minimumFee', '최소 수수료']] : []),
  ];
}

export function batchNotes(product) {
  if (!product) return [];
  const rule = CUSTOM_CALCULATORS[calculatorCode(product)];
  if (product.engine === 'CUSTOM')
    return rule
      ? [
          ...(product.batchEngineOverride
            ? ['저장된 상품을 변경하지 않고 배치에 등록된 CUSTOM 계산기로 테스트해요.']
            : []),
          rule.summary,
        ]
      : [
          '이 상품코드로 등록된 배치 CUSTOM 계산기를 확인하지 못했어요. 공통 계산으로 대체하지 않아요.',
        ];
  const notes = [];
  if (rule)
    notes.push(
      '배치에는 이 상품의 CUSTOM 계산기가 등록돼 있지만 상품 설정은 COMMON이에요. 계산 엔진을 확인해 주세요.',
    );
  if (product.expected.SIGN_APLY_LOCT_DVCD === 'NONE')
    notes.push(
      '상품 설정의 부호 미적용(NONE)은 배치 매퍼가 아직 받지 못해요. 아래는 상품 설정을 대입한 결과예요.',
    );
  else if (product.expected.VAT_DVCD !== 'ZERO')
    notes.push(
      '현재 배치 VAT 파이프라인은 부호 위치와 단수 처리 순서가 상품 설정 설명과 달라요. 음수·NULL 부호 결과는 배치 확인이 필요해요.',
    );
  if (product.registration?.TRFS_DVCD === 'SLIDING')
    notes.push(
      '배치는 적용 구간 하나를 선택해 전체 대상에 해당 단가를 곱해요. 구간별 누진 합산이 아니에요.',
    );
  return notes;
}
