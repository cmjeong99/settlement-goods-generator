import { sourcesForProduct } from './product-source-map.js';

const regmon = (suffix, line, end = line, extra = {}) => ({
  source: `JUNGSAN.dbo.JOB_TB_BILL_STATUS_4_REGMON_${suffix}`,
  line,
  selectLines: [line, end],
  ...extra,
});
const ref = (source, line, extra = {}) => ({ source, line, ...extra });
const reference = (row, stage, note = row.note ?? '') => ({ ...row, stage, active: false, note });
const main = (row, stage = '집계 계산') => ({ ...row, stage, active: true });

// These are reviewed SP paths, not SQL synthesized from the DB product settings.
export function calculationForProduct(code) {
  const original = sourcesForProduct(code);
  if (!original) throw new Error(`출처 매핑 없음: ${code}`);
  const transactions = original.map((row) => main(row, '거래 계산'));
  const profile = (kind, summary, refs, options = {}) => ({
    kind,
    status: 'verified',
    summary,
    references: refs,
    ...options,
  });
  const copied = (aggregation, options = {}) =>
    profile(
      'sum-results',
      '거래별 수수료·VAT 계산 후 그 결과를 합산해 집계 테이블에 입력합니다.',
      [
        ...transactions,
        reference(
          aggregation,
          '집계 입력',
          aggregation.note ??
            'SUM(CPFEE)·SUM(CPVAT)는 결과를 더하는 단계이며 금액 합산 후 요율을 다시 적용하지 않습니다.',
        ),
      ],
      options,
    );
  const transactionNotes = original.map((row) => reference(row, '거래 계산 · 참고'));

  if (code.startsWith('BOKU-') || code.startsWith('ALIPAYPLUS-')) {
    const boku = code.startsWith('BOKU-');
    return profile(
      'transaction',
      '거래별 계산식은 확인했습니다. 보관 SP에서 최초 지급 집계 입력식은 확인하지 못했습니다.',
      [
        ...transactions,
        ...(boku
          ? [
              reference(
                ref('ACCOUNT.dbo.SP_TPAYNOTE_TOTAL', 596, { rawLines: [596, 628] }),
                '최종 이관 · 참고',
                'PAYOUT의 기존 BK 지급 결과를 이관합니다. 최초 집계 또는 재계산 근거로 사용하지 않습니다.',
              ),
            ]
          : []),
      ],
      {
        status: 'unverified',
        unresolved:
          '국가별 지급 집계 입력 경로 미확인. 조회·파일 생성 SP의 SUM을 지급 계산식으로 대체하지 않습니다.',
      },
    );
  }
  if (code.startsWith('SELF-')) {
    const billing = original.map((row, index) =>
      index === 0 ? main(row, '집계 후 청구 계산') : reference(row, '조건부 후처리'),
    );
    if (code.endsWith('-ZERO')) billing[1] = main(original[1], '면세 후처리');
    const contexts = [
      reference(
        ref('ADMINPROC.dbo.job_cauth_publish', 86, { rawLines: [86, 87], groupByLine: 139 }),
        '건수 집계',
        'V_AUTH의 성공·시도 건수를 MERCHANTID별로 집계해 TCAUTH_DEMAND_TEMP에 넣습니다. 거래마다 수수료를 산출하는 방식이 아닙니다.',
      ),
    ];
    if (code.includes('-BASE-'))
      contexts.push(
        reference(
          ref('ADMINPROC.dbo.job_cauth_publish', 288, { rawLines: [288, 310] }),
          '기본·초과요금 준비',
          '집계 건수를 기본 제공 건수와 초과 건수로 나눈 뒤 RAMT_F1·RAMT_F2를 준비합니다.',
        ),
      );
    if (code.includes('-SLIDE-'))
      contexts.push(
        reference(
          ref('ADMINPROC.dbo.job_cauth_publish', 321, { rawLines: [321, 324] }),
          '구간요금 집계',
          '청구 상세의 RAMT를 DEMAND_NUM별로 합산한 B.RAMT를 사용합니다.',
        ),
      );
    return profile(
      'count-aggregate',
      '가맹점·청구기간별 건수를 먼저 집계한 뒤 일반·기본·구간 요금과 VAT를 계산합니다.',
      [...billing, ...contexts],
      {
        status: code.endsWith('-EXCL') ? 'verified' : 'conditional',
        mergeActive: code.endsWith('-ZERO'),
        ...(code.endsWith('-INCL')
          ? {
              unresolved:
                'ROUNDDOWN=Y의 십원 단위 총액 재분리와 VAT 포함 상품은 동일 조건으로 확정하지 않습니다. 실제 계약 매핑을 확인해야 합니다.',
            }
          : {}),
        ...(code.endsWith('-ZERO')
          ? { unresolved: 'VAMT=0은 SP의 면세 CPID 목록에 해당할 때만 적용합니다.' }
          : {}),
      },
    );
  }
  if (['BOOKNLIFEGIFT-BASIC', 'CULTUREGIFT-BASIC', 'CULTUREGIFT-OVERSEAS'].includes(code)) {
    const overseas = code.endsWith('-OVERSEAS');
    return profile(
      'amount-aggregate',
      '거래금액을 가맹점·월·주기·요율·지급 구분·B_FLAG별로 합산한 뒤 수수료와 VAT를 각각 계산합니다.',
      [
        main(
          regmon('CULTUERE', 160, 173, {
            rawLines: [160, 173],
            selectLines: undefined,
            note: 'TEAMDB.TPAYNOTE_REGMON의 AMT는 #CPIDS2에서 이미 합산한 금액입니다.',
          }),
        ),
        ...transactionNotes,
        reference(
          regmon('CULTUERE', 71, 78, {
            rawLines: [68, 78],
            selectLines: undefined,
            groupByLine: 78,
          }),
          '금액 집계',
          'SUM(CAST(AMT AS BIGINT)) AMT → #CPIDS2',
        ),
        reference(
          regmon('CULTUERE', 117, 123, { rawLines: [117, 123], selectLines: undefined }),
          '집계 입력',
          '#CPIDS2의 합산 AMT와 CPRATE를 TEAMDB.TPAYNOTE_REGMON의 AMT·RATE로 입력합니다.',
        ),
        ...(overseas
          ? [
              reference(
                regmon('CULTUERE', 145, 153, { rawLines: [145, 153], selectLines: undefined }),
                '비활성 과거 후처리',
                '원문에서도 주석인 ACCOUNT 대상 VAT 0 처리입니다. 현행 TEAMDB 해외 면세 근거로 사용하지 않습니다.',
              ),
            ]
          : []),
      ],
      {
        inputScope: 'settlement',
        ...(overseas
          ? {
              status: 'conditional',
              unresolved:
                '현행 TEAMDB의 해외 VAT 0 후처리는 확인하지 못했습니다. 본문은 공통 과세식이며, 기존 휴대폰 월집계 SP 연결은 잘못된 출처라 제거했습니다.',
            }
          : {}),
      },
    );
  }
  if (code === 'MOBILEGIFT-BASIC')
    return profile(
      'amount-aggregate',
      'TPAYNOTE_REGMON INSERT SELECT에서 SUM(AMT)에 요율을 적용하고 수수료·VAT를 각각 반올림합니다.',
      [
        main(
          regmon('MOBILEGIFT', 27, 28, {
            groupByLine: 39,
            note: '서비스·발행처(ORICODE_DET)·월·CPRATE·주기·CPID별 집계. 11515 일반 분기입니다.',
          }),
        ),
        ...transactionNotes,
        reference(
          regmon('MOBILEGIFT', 34, 39, { rawLines: [34, 39], selectLines: undefined }),
          '집계 대상·단위',
        ),
      ],
    );
  if (code === 'MOBILE-BASIC-SUM')
    return profile(
      'amount-aggregate',
      'CALTYPE=G 지급 집계에서 원금 합계에 PCALRATE를 적용해 계산대상금액을 만든 뒤 CALRATE로 수수료·VAT를 계산합니다.',
      [
        main(
          regmon('TELEDIT', 74, 75, {
            groupByLine: 99,
            note: '실제 REGMON 호출 경로의 합산 분기. FLOOR(SUM(AMT)*PCALRATE) 계산대상금액 단계를 생략하지 않습니다.',
          }),
        ),
        reference(ref('JUNGSAN.dbo.JOB_TB_BILL_STATUS_3', 2408), '거래 계산 · 참고'),
        ...original.map((row) =>
          reference(
            row,
            'DV 참고 · 기본 분석 제외',
            'LABS에 입력하는 DV SP의 단순 합산식입니다. 운영 지급 분기의 PCALRATE 단계를 대체하지 않습니다.',
          ),
        ),
        reference(
          regmon('TELEDIT', 88, 99, { rawLines: [88, 99], selectLines: undefined }),
          '집계 대상·단위',
        ),
      ],
      {
        status: 'conditional',
        unresolved:
          '요율 유효기간·PCALRATE·CALTYPE=G 및 지급주기 조건을 함께 확인합니다. DB 상품 설정을 맞추려고 원문 식을 단순화하지 않습니다.',
      },
    );
  if (code === 'MOBILE-EACH-VAT-RND')
    return profile(
      'fee-aggregate',
      'TFI_DAILYSALE의 수수료를 월 합산한 뒤 ROUND(SUM(FEE)*0.1,0)으로 VAT를 다시 계산합니다.',
      [
        main(
          ref('ACCOUNT.dbo.fms_inMonSale', 66, {
            projection: { fee: 'sum(fee)', vat: 'round(sum(fee)*0.1,0)' },
            groupByLine: 90,
            note: '수수료는 기존 건별 결과의 합, VAT만 합계 기준 반올림입니다.',
          }),
        ),
        ...transactionNotes,
        reference(ref('ACCOUNT.dbo.fms_inMonSale', 68, { rawLines: [68, 90] }), '청구 대상·단위'),
      ],
      {
        status: 'conditional',
        unresolved:
          '월청구의 대상 CPID·요금제 설정에 해당하는지 확인합니다. 건별 CPVAT의 ROUND를 합산 VAT 계산 근거로 사용하지 않습니다.',
      },
    );
  if (code === 'MOBILE-EACH-VAT-SUM')
    return profile(
      'fee-aggregate',
      '건별 CPFEE를 더해 RAMT로 넣고 FLOOR(ABS(SUM(CPFEE))*0.1)에 합산 원금의 부호를 붙여 VAT를 재계산합니다.',
      [
        main(
          regmon('TELEDIT', 210, 211, {
            groupByLine: 232,
            note: 'CALTYPE=T, CALTYPE2=2의 후속 집계입니다. 수수료를 원금 합계×요율로 다시 계산하지 않습니다.',
          }),
        ),
        ...transactionNotes.slice(0, 1),
        reference(
          regmon('TELEDIT', 220, 232, { rawLines: [220, 232], selectLines: undefined }),
          '집계 대상·단위',
        ),
      ],
    );
  if (code === 'MOBILE-FIXED-INCL')
    return profile(
      'included-split',
      '건별 고정 수수료를 합산한 뒤 /1.1로 공급가액을 반올림하고, 재분리한 B.FEE로 VAT를 계산합니다.',
      [
        main(original[1]),
        transactionNotes[0],
        reference(
          ref('ACCOUNT.dbo.FMS_INDAILYSALE_TELEDIT', 334, { rawLines: [334, 340] }),
          '집계·공급가액 준비',
          'B.FEE는 ROUND(ABS(SUM(FEE))/1.1,0)에 승인/취소 부호를 적용한 값입니다.',
        ),
      ],
      {
        status: 'conditional',
        unresolved:
          '고정요금 대상과 CPID·단가·승인/취소별 집계 조건이 필요합니다. 정률 공통식으로 대체하지 않습니다.',
      },
    );
  if (code === 'MOBILE-RATE-INCL')
    return profile(
      'included-split',
      '거래별 VAT 포함 수수료를 절사해 합산하고, 합계/1.1로 공급가액을 절사한 뒤 차액을 VAT로 분리합니다.',
      [
        main(original[0]),
        reference(
          ref('JUNGSAN.dbo.JOB_TB_BILL_STATUS_3', 2408),
          '거래 계산 · 일반 참고',
          '별도 가맹점의 VAT 포함 계산이므로 이 일반 건별 식과 동일하다고 확정하지 않습니다.',
        ),
      ],
      {
        status: 'conditional',
        unresolved:
          'VAT 포함 총액의 건별 절사 → 합계 → 재분리 순서를 유지합니다. 대상 CPID·요율 조건은 본문 출처를 확인합니다.',
      },
    );
  if (code === 'MOBILE-TIMONET')
    return profile(
      'included-split',
      '건별 CPFEE를 주기별로 합산하고 공급가액=FLOOR(ABS(SUM(CPFEE))/1.1)·부호, VAT=SUM(CPFEE)−공급가액으로 재분리합니다.',
      [
        main(
          regmon('TELEDIT_WEEKLY', 160, 161, {
            groupByLine: 195,
            note: '주정산 CALTYPE=F의 티모넷 재분리 분기입니다.',
          }),
        ),
        transactionNotes[0],
        reference(
          original[1],
          '일집계 대응식',
          'TFI_DAILYSALE에서는 같은 순서로 SUM(FEE)를 재분리합니다.',
        ),
        reference(
          regmon('TELEDIT_WEEKLY', 203, 204, { groupByLine: 234 }),
          '다른 계약 분기 · 참고',
          '별도 CPID 목록은 SUM(AMT_R)×CPRATE로 계산합니다. 주 분기와 혼용하지 않습니다.',
        ),
      ],
      {
        status: 'conditional',
        unresolved:
          'CPID에 따라 수수료 합계 재분리와 대상금액 합산×요율 분기가 다릅니다. 계약 분기를 확인합니다.',
      },
    );
  if (code === 'MOBILE-COUPANG')
    return profile(
      'reconciled-aggregate',
      '대사 완료 ACTIVE_AMT를 사용해 행별 과세 수수료를 합산하고 공급가액·VAT를 재분리합니다.',
      [
        main(original[0]),
        reference(
          ref('JUNGSAN.dbo.JOB_TB_BILL_STATUS_3', 2408),
          '거래 계산 · 일반 참고',
          '집계 본문은 ACTIVE_AMT·CALRATE·PCALRATE를 사용합니다. 일반 TB_BILL 식은 참고로만 남깁니다.',
        ),
      ],
      {
        status: 'conditional',
        unresolved:
          '대사 완료 조건·ACTIVE_AMT·두 요율과 환불 분기를 확인해야 합니다. 일반 합산 정률 상품과 동일하다고 보지 않습니다.',
      },
    );
  if (code === 'MOBILE-GOVERNMENT')
    return profile(
      'payout-inverse',
      '집계 원금과 지급요청금액 EXT1의 차액에서 공급가액·VAT를 역산합니다.',
      [main(original[0])],
      {
        status: 'conditional',
        unresolved:
          'EXT1 원천·지급요청 대상이 필요한 특수 역산입니다. 일반 거래별 요율식으로 대체하지 않습니다.',
      },
    );

  if (code.startsWith('AMTTRANS-'))
    return copied(
      regmon('AMTTRAN', 26, 26, { groupByLine: 40 }),
      code.endsWith('-FIX')
        ? {
            status: 'conditional',
            unresolved:
              '일반 집계는 ORICODE=KA/SUBTYPE=001·002입니다. 건별 정산 SUBTYPE=003의 최종 지급 입력 경로는 이 분기로 확정하지 않습니다.',
          }
        : {},
    );
  if (code === 'CARD-BASIC')
    return copied(
      regmon('DANALPAYCARD', 34, 35, {
        groupByLine: 45,
        note: 'SERVICECODE=12206. EXT2·하위 가맹점 분기별로 이미 계산한 수수료·VAT를 합산합니다.',
      }),
    );
  if (code === 'MOBILE-BASIC-EACH')
    return copied(
      regmon('TELEDIT', 48, 48, {
        groupByLine: 64,
        note: 'CALTYPE=T 거래의 CPFEE·CPVAT를 합산합니다.',
      }),
    );
  if (code === 'VACCOUNT-BASIC')
    return copied(
      regmon('VACCOUNT', 26, 27, {
        groupByLine: 41,
        note: '입금·출금은 AMT 부호 조건별로 따로 집계합니다. CPID별 제외 조건도 적용합니다.',
      }),
    );
  if (code === 'SPCTLIMTCARD-BASIC')
    return copied(
      regmon('LECREDIT', 55, 56, {
        groupByLine: 64,
        note: 'SERVICECODE=12204. 기존 CPFEE·CPVAT·JAMT를 합산합니다. 일부 가맹점 VAT 조정은 별도 지급 행입니다.',
      }),
    );
  if (code === 'PAYCOIN-BASIC') return copied(regmon('PAYCOIN', 23, 24, { groupByLine: 38 }));
  if (code === 'PAYPAL-SCHOOL')
    return copied(
      regmon('PAL', 26, 27, {
        groupByLine: 37,
        note: '원금은 AMT+CPFEE+CPVAT 합계로 복원하고 지급액은 SUM(AMT)를 사용합니다. 수수료 재계산은 아닙니다.',
      }),
    );
  if (code === 'VISACYBERSOURCE-BASIC')
    return copied(
      regmon('MCA', 26, 27, {
        groupByLine: 39,
        note: 'SERVICECODE=50802, EXTRA=KRW의 승인기준 계약 가맹점 분기입니다.',
      }),
      {
        status: 'conditional',
        unresolved:
          '승인기준 계약 CPID 목록·통화 조건에 해당하는 집계 경로입니다. 다른 계약까지 일반화하지 않습니다.',
      },
    );
  if (code.startsWith('OPENBANKING-'))
    return copied(
      regmon('OPENBANKING', 23, 23, {
        groupByLine: 32,
        note: 'ORICODE_DET=001·002 및 003 분기에서 SUM(CPFEE)·SUM(CPVAT)를 입력합니다. 원금이 취소여도 거래 단계 양수 수수료를 그대로 더합니다.',
      }),
    );
  if (code.startsWith('WECHAT-SCHOOL-'))
    return copied(
      regmon('WECHAT', 27, 27, {
        groupByLine: 36,
        note: 'SERVICECODE=50601·50602. 원천에서 이관한 CHARGE/FEE를 합산합니다.',
      }),
    );
  if (code === 'WECHAT-OFFLINE')
    return profile(
      'transaction',
      '50415 거래 계산과 최종 바통 지급 이관은 확인했지만 최초 집계 입력식은 확인하지 못했습니다.',
      [
        ...transactions,
        reference(
          ref('ACCOUNT.dbo.SP_TPAYNOTE_TOTAL', 560, { rawLines: [560, 592] }),
          '최종 이관 · 참고',
          'PY→50415 매핑으로 기존 ACCOUNT.TPAYNOTE_BARTONG 지급 결과를 이관합니다. 50418 전용 REGMON_BARTONG과 혼동하지 않습니다.',
        ),
      ],
      {
        status: 'unverified',
        unresolved: '50415의 최초 집계 입력식 미확인. 50418의 집계 SP를 재사용하지 않습니다.',
      },
    );
  if (
    [
      'KAKAOPAY-MONEY',
      'NAVERPAY-MONEY',
      'PAYCO-COUPON',
      'PAYCO-POINT',
      'SAMSUNGWALLET-MONEY',
    ].includes(code)
  )
    return copied(
      regmon('ALLIANCE', 34, 35, {
        groupByLine: 45,
        note: 'SERVICECODE=12801. EXT2·상위/하위 가맹점·월·요율·주기별로 CPFEE와 CPVAT를 합산합니다.',
      }),
    );
  throw new Error(`계산 단계 매핑 없음: ${code}`);
}
