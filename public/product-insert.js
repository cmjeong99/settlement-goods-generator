import { FIELDS, NULL_OVERRIDE, NULLABLE_FIELDS } from './domain.js';
import { validScale } from './calculation/rounding-unit.js';

// DAON_SMT_OWNER.TB_SSI_MERC_SMT_GDS_M, checked against ALL_TAB_COLUMNS 2026-11-09.
export const INSERT_FIELDS = [
  ['SRVC_CD', '서비스코드', 5, true, '예: 10603'],
  ['DTLS_SRVC_CD', '세부서비스코드', 5, true, '예: 00'],
  ['SMT_TRGT_BASE_DVCD', '정산 대상 기준', 20, true, '예: TRANS'],
  ['SMT_DVCD', '정산 구분', 10, true, '예: PREPAY'],
  ['TRFS_DVCD', '요금제', 10, true, '예: STANDARD'],
  ['MIN_FEE_SETP_YN', '최소 수수료 설정', 1, true, 'Y 또는 N'],
  ['PAYM_MHOD_DVCD', '납부 방식', 10, true, '예: PAYOUT'],
  ['CANC_FEE_PLCY_DVCD', '취소 수수료 정책', 20, false],
  ['FEE_RCVG_DVCD', '수수료 징수', 5, false],
  ['MERC_PMT_CURN_CD', '가맹점 결제 통화', 3, false],
  ['ORCM_APRV_CURN_CD', '원천사 승인 통화', 3, false],
  ['ORCM_SMT_CURN_CD', '원천사 정산 통화', 3, false],
  ['MERC_SMT_CURN_CD', '가맹점 정산 통화', 3, false],
  ['EXRT_APLY_PNTM_DVCD', '환율 적용 시점', 10, false],
  ['CALC_ENGE_DVCD', '계산 엔진', 20, false],
  ['RMK', '비고', 4000, false],
  ['REG_USER_ID', '등록자 ID', 30, true, '본인의 등록자 ID'],
];
const text = (value) => String(value ?? '').trim();

export function normalizeRegistration(registration = {}) {
  return Object.fromEntries(INSERT_FIELDS.map(([key]) => [key, text(registration[key])]));
}

export function productInsertErrors(result, name, registration = {}) {
  if (!result) return ['수식을 먼저 분석해 주세요.'];
  const errors = [];
  if (!text(name?.code) || !text(name?.name)) errors.push('상품코드와 상품명을 입력해 주세요.');
  for (const [value, label] of [
    [name?.code, '상품코드'],
    [name?.name, '상품명'],
  ])
    if (Array.from(text(value)).length > 100) errors.push(`${label}은 100자 이하로 입력해 주세요.`);
  for (const [key, label, maxLength, required] of INSERT_FIELDS) {
    const value = text(registration[key]);
    if (value === NULL_OVERRIDE) {
      if (required) errors.push(`${label}은 NULL로 지정할 수 없어요.`);
      continue;
    }
    if (required && !value) errors.push(`${label}: 값을 입력해 주세요.`);
    if (Array.from(value).length > maxLength)
      errors.push(`${label}은 ${maxLength}자 이하로 입력해 주세요.`);
    if (key === 'MIN_FEE_SETP_YN' && value && !['Y', 'N'].includes(value))
      errors.push('최소 수수료 설정은 Y 또는 N으로 입력해 주세요.');
  }
  const pending = FIELDS.filter(([key, , options]) => {
    const cell = result.fields[key];
    if (cell?.status === 'not-applicable') return !NULLABLE_FIELDS.includes(key);
    if (cell?.status !== 'known') return true;
    return options ? !options.includes(cell.value) : !validScale(cell.value);
  });
  if (pending.length)
    errors.push(`다음 설정을 확정해 주세요: ${pending.map(([, label]) => label).join(', ')}.`);
  for (const [key, label, options] of FIELDS) {
    const cell = result.fields[key];
    if (!options && cell?.status === 'known' && !validScale(cell.value))
      errors.push(`${label}은 DB 컬럼 NUMBER(3,0)에 맞는 -999~999 정수로 지정해 주세요.`);
  }
  return errors;
}

export function exportProductInsert(result, name, registration = {}) {
  const errors = productInsertErrors(result, name, registration);
  if (errors.length) throw new Error(errors.join(' '));
  const literal = (value) => `'${text(value).replace(/'/g, "''")}'`;
  const entries = [
    ['SMT_GDS_CD', literal(name.code)],
    ['SMT_GDS_NM', literal(name.name)],
    ...FIELDS.map(([key, , options]) => {
      const cell = result.fields[key];
      return [
        key,
        cell.status === 'not-applicable'
          ? 'NULL'
          : options
            ? literal(cell.value)
            : String(cell.value),
      ];
    }),
    ...INSERT_FIELDS.filter(([key]) => key !== 'REG_USER_ID' && text(registration[key])).map(
      ([key]) => [key, registration[key] === NULL_OVERRIDE ? 'NULL' : literal(registration[key])],
    ),
    ['FRST_REG_DTTM', 'SYSTIMESTAMP'],
    ['FRST_REG_USER_ID', literal(registration.REG_USER_ID)],
    ['FRST_REG_PROG_NM', literal('settlement-formula-studio')],
    ['LAST_CHNG_DTTM', 'SYSTIMESTAMP'],
    ['LAST_CHNG_USER_ID', literal(registration.REG_USER_ID)],
    ['LAST_CHNG_PROG_NM', literal('settlement-formula-studio')],
  ];
  // Empty optional columns are omitted so Oracle's declared defaults still apply.
  return `INSERT INTO TB_SSI_MERC_SMT_GDS_M (\n  ${entries.map(([key]) => key).join(',\n  ')}\n) VALUES (\n  ${entries.map(([, value]) => value).join(',\n  ')}\n)`;
}
