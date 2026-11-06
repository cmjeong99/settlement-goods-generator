const status3 = (line, note = '') => ({
  source: 'JUNGSAN.dbo.JOB_TB_BILL_STATUS_3',
  line,
  note,
});
const self = (line, note = '') => ({ source: 'ADMINPROC.dbo.job_cauth_publish', line, note });

// References identify actual expression lines in the stored procedure archive.
// DB settings are comparison data; they must never be used to invent SQL.
export function sourcesForProduct(code) {
  if (code.startsWith('ALIPAYPLUS-'))
    return [status3(3144, '국가별 정책은 별도이며 면세 후 공통 계산 구문입니다.')];
  if (code.startsWith('BOKU-'))
    return [status3(3096, '국가별 정책은 별도이며 면세 후 공통 계산 구문입니다.')];
  if (code.startsWith('SELF-')) {
    const line = code.includes('-BASE-') ? 308 : code.includes('-SLIDE-') ? 315 : 273;
    const references = [
      self(line, 'ASIS 본인확인 11502 청구 SP. 건수·구간·기본요금 계산은 앞 단계에서 준비합니다.'),
    ];
    if (code.endsWith('-ZERO')) references.push({ ...self(351, '면세 후처리'), vatOnly: true });
    if (code.endsWith('-INCL'))
      references.push(
        self(341, 'ROUNDDOWN=Y 후처리 참고. VAT 포함 상품과의 적용 조건은 별도 확인이 필요합니다.'),
      );
    return references;
  }
  if (
    [
      'KAKAOPAY-MONEY',
      'NAVERPAY-MONEY',
      'PAYCO-COUPON',
      'PAYCO-POINT',
      'SAMSUNGWALLET-MONEY',
    ].includes(code)
  ) {
    return [
      status3(
        3039,
        'ICODE·금액 매핑은 상품별로 다릅니다. 쿠폰은 DISCOUNTAMOUNT, 나머지는 TRXAMOUNT를 사용합니다.',
      ),
    ];
  }
  const map = {
    'AMTTRANS-BANKPAY': [
      status3(1273, '실시간 환불 및 에스크로 분기. CPFEE2는 별도 계산입니다.'),
      { ...status3(1296, '앞 단계에서 산출한 CPFEE를 참조하는 후속 UPDATE입니다.'), vatOnly: true },
    ],
    'AMTTRANS-KBANK': [status3(1487, 'ORICODE=KA, SUBTYPE=001 일반 거래')],
    'AMTTRANS-KBANK-FIX': [
      status3(1588, 'ORICODE=KA, SUBTYPE=003 건별 정산. 음수 VAT 부호 적용을 원문대로 확인하세요.'),
    ],
    'BOOKNLIFEGIFT-BASIC': [status3(229)],
    'CARD-BASIC': [status3(472, '수수료 끝자리 6 이상 여부로 VAT 올림/내림을 분기합니다.')],
    'CULTUREGIFT-BASIC': [status3(70, '건별 계산 구문입니다. DB의 합산 설정과 차이를 확인하세요.')],
    'CULTUREGIFT-OVERSEAS': [
      {
        source: 'ACCOUNT.dbo.fms_inMonSale',
        line: 157,
        selectLines: [157, 157],
        columns: { feeColumn: 'FEE', vatColumn: 'VAT' },
        note: '해외 가맹점 VAT 0 분기를 포함한 월 합산 원문입니다. 식별값은 예제값으로 치환합니다.',
      },
    ],
    'MOBILE-BASIC-EACH': [
      status3(2408, 'AMT_R이 NULL이면 AMT, 거래금액 0이면 부호 0을 사용합니다.'),
    ],
    'MOBILE-BASIC-SUM': [
      {
        source: 'JUNGSAN.dbo.DV_JOB_TB_BILL_STATUS_4_REGMON_TELEDIT_MONTHLY',
        line: 70,
        note: 'DB 보관 DV 월정산 SP의 합산 분기입니다. 실제 운영 호출 여부는 별도 확인하세요.',
      },
    ],
    'MOBILE-COUPANG': [
      {
        source: 'ADMINPROC.dbo.job_jungsan_coupang',
        line: 110,
        note: '대사 완료 ACTIVE_AMT와 CALRATE/PCALRATE를 사용하는 별도 집계 계산입니다.',
      },
    ],
    'MOBILE-EACH-VAT-RND': [
      status3(2285, '코리아세븐 특이 건별 계산. VAT 합산 정책과의 차이는 별도 확인하세요.'),
    ],
    'MOBILE-EACH-VAT-SUM': [
      status3(2408),
      {
        source: 'JUNGSAN.dbo.JOB_TB_BILL_STATUS_4_REGMON_TELEDIT',
        line: 210,
        note: '건별 CPFEE를 합산한 뒤 VAT를 재계산하는 후속 단계입니다. 컬리 ADJUSTED_AMT 매핑은 별도입니다.',
      },
    ],
    'MOBILE-FIXED-INCL': [
      status3(2475),
      {
        source: 'ACCOUNT.dbo.FMS_INDAILYSALE_TELEDIT',
        line: 332,
        columns: { feeColumn: 'FEE', vatColumn: 'VAT' },
        note: '하위 SELECT에서 재분리한 B.FEE를 받아 VAT를 계산하는 후속 UPDATE입니다.',
      },
    ],
    'MOBILE-GOVERNMENT': [
      {
        source: 'ADMINPROC.dbo.Job_Monthly_Prepayout_C2',
        line: 128,
        note: 'EXT1 지급요청금액을 사용한 역산입니다.',
      },
    ],
    'MOBILE-RATE-INCL': [
      {
        source: 'ACCOUNT.dbo.FMS_INDAILYSALE_TELEDIT',
        line: 352,
        selectLines: [352, 353],
        columns: { feeColumn: 'FEE', vatColumn: 'VAT' },
        note: '건별 VAT 포함 수수료를 합산한 뒤 공급가액/VAT로 재분리합니다. 환불 조건은 별도입니다.',
      },
    ],
    'MOBILE-TIMONET': [
      status3(2520),
      {
        source: 'ACCOUNT.dbo.FMS_INDAILYSALE_TELEDIT',
        line: 244,
        selectLines: [244, 245],
        note: '앞 단계에서 계산한 FEE를 합산해 공급가액과 VAT로 재분리합니다.',
      },
    ],
    'MOBILEGIFT-BASIC': [status3(1184, '건별 계산 구문입니다. 집계 단계는 별도로 확인하세요.')],
    'OPENBANKING-FIXED': [
      status3(
        2972,
        '승인·취소 모두 양수 정액 수수료를 부과합니다. ICODE=4는 정률에서 다시 계산합니다.',
      ),
    ],
    'OPENBANKING-RATE': [status3(2988, 'B_FLAG=OB, ICODE=4. 취소도 양수 수수료/VAT를 부과합니다.')],
    'PAYCOIN-BASIC': [status3(2756)],
    'PAYPAL-SCHOOL': [status3(3306, '원천 CUST_TOTL_FEE 공급가액 계산 후 VAT 0 처리입니다.')],
    'SPCTLIMTCARD-BASIC': [status3(2885)],
    'VACCOUNT-BASIC': [
      status3(2044, '일반/비일반 SUBTYPE에 따른 수수료 분기. +200 및 예외 조건을 확인하세요.'),
    ],
    'VISACYBERSOURCE-BASIC': [
      status3(3250, 'VAT 포함 금액을 올림한 값과 수수료 올림 값의 차액입니다.'),
    ],
    'WECHAT-OFFLINE': [
      status3(2671, 'ASIS 서비스 12101, SUB_SERVICECODE=50415에 해당하는 바통 일반 분기입니다.'),
    ],
    'WECHAT-SCHOOL-QR': [
      {
        source: 'JUNGSAN.dbo.JOB_IN_BILL',
        line: 588,
        note: 'CLIENTTYPE=campus이면 원천 CHARGE를 수수료로 이관하며 VAT는 0입니다.',
      },
    ],
    'WECHAT-SCHOOL-WMP': [
      {
        source: 'JUNGSAN.dbo.JOB_IN_BILL',
        line: 605,
        projection: { fee: 'A.FEE', vat: '0' },
        note: 'INSERT의 CPFEE/CPVAT 위치에 대응하는 원문 SELECT 표현식입니다. 원천 FEE를 그대로 이관합니다.',
      },
    ],
  };
  return map[code];
}
