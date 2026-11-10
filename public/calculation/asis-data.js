export const MAX_ASIS_ROWS = 500;
export const ASIS_FIELDS = [
  ['id', '거래번호', ['TID', 'BILL_TID', 'SEQNO', '거래번호']],
  ['productCode', '상품코드', ['SMT_GDS_CD', '상품코드']],
  ['amount', '거래금액', ['TX_AMOUNT', 'BILL_AMOUNT', 'AMT', 'AMOUNT', '거래금액', '금액']],
  ['targetAmount', '계산대상금액', ['FEE_CALC_TRGT_AMT', 'AMT_R', 'ACTIVE_AMT', '계산대상금액']],
  [
    'feeValue',
    '요율·정액단가',
    ['FEE_VALUE', 'CALRATE', 'CPRATE', 'BILL_RATE', 'AUTHRATE', '요율', '정액단가'],
  ],
  ['count', '과금건수', ['COUNT', 'SCOUNT', 'TCOUNT', 'CNT', 'CNT_S', '건수', '과금건수']],
  ['asisFee', 'AS-IS 수수료', ['BILL_FEE', 'CPFEE', 'RAMT', 'ASIS_FEE', '수수료']],
  ['asisVat', 'AS-IS VAT', ['BILL_VAT', 'CPVAT', 'VAMT', 'ASIS_VAT', 'VAT', '부가세']],
  ['asisPayout', 'AS-IS 지급액', ['BILL_PAYOUT', 'JAMT', 'ASIS_PAYOUT', '지급액']],
  ['groupKey', '검증 그룹', ['GROUP_KEY', '검증그룹', '그룹']],
  ['merchant', '가맹점', ['CPID', 'MID', '가맹점']],
  ['period', '정산기간', ['REGMON', 'SMT_DT', 'PDATE', '정산기간']],
  ['currency', '통화', ['CURRENCY', 'CURN_CD', '통화']],
];

const headerKey = (value) =>
  value
    .trim()
    .replace(/^\uFEFF/, '')
    .replace(/[\[\]\s]/g, '')
    .toUpperCase();

export function parseAsisTable(text, { headerless = false } = {}) {
  if (typeof text !== 'string' || !text.trim())
    throw new Error('헤더를 포함한 AS-IS 조회 결과를 붙여넣어 주세요.');
  if (text.length > 2_000_000) throw new Error('파일은 2MB 이내로 나눠 주세요.');
  const firstLine = text.replace(/^\uFEFF/, '').split(/\r?\n/)[0];
  const delimiter = firstLine.includes('\t') ? '\t' : firstLine.includes('|') ? '|' : ',';
  const records = [];
  let row = [],
    cell = '',
    quoted = false,
    closed = false;
  const finishCell = () => {
    row.push(cell);
    cell = '';
    closed = false;
  };
  const finishRow = () => {
    finishCell();
    if (row.some((value) => value.trim())) records.push(row);
    row = [];
    if (records.length > MAX_ASIS_ROWS + 1)
      throw new Error(`한 번에 ${MAX_ASIS_ROWS}행까지 비교할 수 있어요.`);
  };
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index++;
      } else if (char === '"') {
        quoted = false;
        closed = true;
      } else cell += char;
    } else if (char === delimiter) finishCell();
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index++;
      finishRow();
    } else if (char === '"' && cell === '' && !closed) quoted = true;
    else if (closed && !/\s/.test(char))
      throw new Error('닫는 따옴표 뒤의 구분자를 확인해 주세요.');
    else if (!closed) cell += char;
    if (row.length > 100) throw new Error('조회 컬럼을 100개 이내로 줄여 주세요.');
  }
  if (quoted) throw new Error('CSV의 닫는 따옴표를 확인해 주세요.');
  if (cell || row.length || closed) finishRow();
  if (headerless && (records[0]?.length < 2 || records[0]?.length > 5))
    throw new Error('금액·요율 순서로 입력해 주세요. 기존 금액은 뒤에 붙일 수 있어요.');
  const headers = headerless
    ? ['AMT', 'FEE_VALUE', 'CPFEE', 'CPVAT', 'JAMT'].slice(0, records[0]?.length ?? 0)
    : (records.shift()?.map((value) => value.trim().replace(/^\uFEFF/, '')) ?? []);
  if (records.length > MAX_ASIS_ROWS)
    throw new Error(`한 번에 ${MAX_ASIS_ROWS}행까지 비교할 수 있어요.`);
  if (headers.length < 2 || !records.length)
    throw new Error('컬럼명이 있는 첫 행과 거래 데이터가 필요해요.');
  if (new Set(headers.map(headerKey)).size !== headers.length)
    throw new Error('중복된 컬럼명이 있어요. 조회 컬럼에 서로 다른 별칭을 지정해 주세요.');
  for (const [index, record] of records.entries())
    if (record.length !== headers.length)
      throw new Error(`${index + 2}행의 컬럼 수가 헤더와 달라요.`);
  return { headers, records };
}

export function parseAsisInput(text) {
  const first = String(text).trim().split(/\r?\n/)[0];
  const headerless = /^"?[+-]?(?:\d|\.\d)/.test(first);
  if (headerless && !first.includes('\t') && /\s/.test(first) && !first.includes('"')) {
    text = text
      .trim()
      .split(/\r?\n/)
      .map((line) => line.trim().split(/\s+/).join('\t'))
      .join('\n');
  }
  return parseAsisTable(text, { headerless });
}

export function detectAsisMapping(headers, product) {
  const indexes = new Map(headers.map((header, index) => [headerKey(header), index]));
  return Object.fromEntries(
    ASIS_FIELDS.map(([key, , defaults]) => {
      let aliases = defaults;
      if (key === 'feeValue')
        aliases =
          product?.expected.FEE_TYPE_DVCD === 'FIXED'
            ? ['FEE_VALUE', 'AUTHRATE', 'CPRATE2', '정액단가', 'CALRATE', 'CPRATE', 'BILL_RATE']
            : defaults;
      if (key === 'count')
        aliases =
          product?.expected.FRIM_BASE_DVCD === 'TCOUNT'
            ? ['TCOUNT', 'COUNT', 'CNT_TOTAL', 'CNT', '과금건수', '건수']
            : ['SCOUNT', 'COUNT', 'CNT_S', 'CNT', '과금건수', '건수'];
      return [
        key,
        aliases
          .map((alias) => indexes.get(headerKey(alias)))
          .find((index) => index !== undefined) ?? -1,
      ];
    }),
  );
}

export function mapAsisRows(table, mapping) {
  return table.records.map((record, index) => ({
    ...Object.fromEntries(
      ASIS_FIELDS.map(([key]) => [key, mapping[key] >= 0 ? record[mapping[key]].trim() : '']),
    ),
    sourceRow: index + 2,
  }));
}

export function productFieldMapping(headers, mapping, product, manualFields = new Set()) {
  const detected = detectAsisMapping(headers, product);
  const next = { ...mapping };
  for (const key of ['feeValue', 'count']) if (!manualFields.has(key)) next[key] = detected[key];
  return next;
}

export function cleanNumber(value) {
  const text = String(value ?? '').trim();
  if (!text || text.toUpperCase() === 'NULL') return '';
  if (text.includes(',')) {
    if (!/^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(text))
      throw new Error(`숫자의 쉼표 위치를 확인해 주세요: ${text}`);
    return text.replaceAll(',', '');
  }
  return text;
}

export function asCsv(rows) {
  return (
    '\uFEFF' +
    rows
      .map((row) =>
        row
          .map((value) => {
            let text = String(value ?? '');
            if (/^[=+@]/.test(text) || (/^-/.test(text) && !/^-\d+(?:\.\d+)?$/.test(text)))
              text = "'" + text;
            return '"' + text.replaceAll('"', '""') + '"';
          })
          .join(','),
      )
      .join('\r\n')
  );
}

export const ASIS_TEMPLATE =
  'TID\tSMT_GDS_CD\tTX_AMOUNT\tFEE_VALUE\tBILL_FEE\tBILL_VAT\tBILL_PAYOUT';
export const OPENBANKING_ASIS_SAMPLE =
  ASIS_TEMPLATE +
  '\nCANCEL-9900\tOPENBANKING-RATE\t-9900\t0.015\t148\t14\t-10062\nCANCEL-55000\tOPENBANKING-RATE\t-55000\t0.015\t825\t82\t-55907';
