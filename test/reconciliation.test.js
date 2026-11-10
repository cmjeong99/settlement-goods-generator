import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ASIS_TEMPLATE,
  OPENBANKING_ASIS_SAMPLE,
  MAX_ASIS_ROWS,
  parseAsisTable,
  parseAsisInput,
  detectAsisMapping,
  mapAsisRows,
  cleanNumber,
  productFieldMapping,
} from '../public/calculation/asis-data.js';
import {
  reconcileAsis,
  exportReconciliation,
  needsAggregation,
} from '../public/calculation/reconciliation.js';
import { productByCode } from '../public/catalog.js';

const rate = productByCode.get('OPENBANKING-RATE');
const fixed = productByCode.get('OPENBANKING-FIXED');
const importRows = (text, product = rate) => {
  const table = parseAsisTable(text);
  return mapAsisRows(table, detectAsisMapping(table.headers, product));
};
const sampleRows = () => importRows(OPENBANKING_ASIS_SAMPLE);

test('실제 조회 결과 형식의 오픈뱅킹 취소 두 건을 상품 설정으로 대조한다', () => {
  const rows = sampleRows();
  const report = reconcileAsis(rate, rows);
  assert.equal(report.summary.match, 2);
  assert.deepEqual(
    report.results.map((result) => result.metrics.payout.calculated),
    ['-10062', '-55907'],
  );
  assert.ok(
    report.results.every((result) =>
      Object.values(result.metrics).every((metric) => metric.difference === '0'),
    ),
  );
  assert.equal(rows[0].amount, '-9900');
});

test('헤더 없이 금액·요율을 자유롭게 입력하고 기존 금액은 선택해서 비교한다', () => {
  for (const text of ['-9900  1.5%', '-9900\t0.015', '-9900,0.015']) {
    const table = parseAsisInput(text);
    const rows = mapAsisRows(table, detectAsisMapping(table.headers, rate));
    const result = reconcileAsis(rate, rows).results[0];
    assert.equal(result.metrics.fee.calculated, '148');
    assert.equal(result.metrics.vat.calculated, '14');
    assert.equal(result.status, 'calculated');
  }
  const table = parseAsisInput('-9,900 1.5% 148 14 -10,062\n-55,000 0.015 825 82 -55,907');
  assert.equal(
    reconcileAsis(rate, mapAsisRows(table, detectAsisMapping(table.headers, rate))).summary.match,
    2,
  );
  assert.throws(() => parseAsisInput('9900'), /금액·요율/);
  assert.throws(() => parseAsisInput('1,2,3,4,5,6'), /금액·요율/);
});

test('퍼센트 기호와 비율을 같은 요율로 해석하고 정액단가는 구분한다', () => {
  const rows = sampleRows();
  rows[0].feeValue = '1.5%';
  assert.equal(reconcileAsis(rate, rows, { scope: 'all' }).results[0].status, 'match');
  assert.equal(reconcileAsis(fixed, [{ ...rows[0], feeValue: '100%' }]).results[0].status, 'error');
  const table = parseAsisInput('"-9,900",0.015,148,14,"-10,062"');
  assert.equal(
    reconcileAsis(rate, mapAsisRows(table, detectAsisMapping(table.headers, rate))).summary.match,
    1,
  );
});

test('수수료·VAT·지급액 차이를 행별로 표시하고 원본 입력을 변경하지 않는다', () => {
  const rows = sampleRows();
  rows[0].asisFee = '-148';
  const before = structuredClone(rows);
  const report = reconcileAsis(rate, rows);
  assert.equal(report.summary.mismatch, 1);
  assert.equal(report.summary.match, 1);
  assert.equal(report.results[0].metrics.fee.difference, '296');
  assert.deepEqual(rows, before);
});

test('미입력·NULL·0원을 구분하고 일부만 입력된 행을 전체 일치로 판정하지 않는다', () => {
  const rows = sampleRows();
  rows[0].asisVat = 'NULL';
  rows[1].asisFee = rows[1].asisVat = rows[1].asisPayout = '';
  const report = reconcileAsis(rate, rows);
  assert.equal(report.results[0].status, 'partial');
  assert.equal(report.results[0].metrics.vat.asis, '');
  assert.equal(report.results[1].status, 'calculated');
  const zero = reconcileAsis(rate, [
    { amount: '0', feeValue: '0', asisFee: '0', asisVat: '0', asisPayout: '0' },
  ]);
  assert.equal(zero.results[0].status, 'match');
});

test('CALRATE와 AUTHRATE가 같이 있어도 정액 상품은 AUTHRATE를 선택한다', () => {
  const rows = importRows(
    'TID,AMT,CALRATE,AUTHRATE,CPFEE,CPVAT,JAMT\n00123,-9900,0,100,100,10,-10010',
    fixed,
  );
  assert.equal(rows[0].id, '00123');
  assert.equal(rows[0].feeValue, '100');
  const report = reconcileAsis(fixed, rows);
  assert.equal(report.results[0].status, 'match');
});

test('상품 변경 시 요율·건수의 자동 매핑만 갱신하고 직접 선택한 매핑은 보존한다', () => {
  const headers = ['AMT', 'CALRATE', 'AUTHRATE', 'SCOUNT', 'TCOUNT', 'CPFEE'];
  const mapping = detectAsisMapping(headers, rate);
  const next = productFieldMapping(headers, mapping, fixed);
  assert.equal(next.feeValue, headers.indexOf('AUTHRATE'));
  assert.equal(next.asisFee, mapping.asisFee);
  assert.equal(mapping.feeValue, headers.indexOf('CALRATE'));
  const manual = productFieldMapping(headers, mapping, fixed, new Set(['feeValue']));
  assert.equal(manual.feeValue, mapping.feeValue);
  const totalCount = { ...fixed, expected: { ...fixed.expected, FRIM_BASE_DVCD: 'TCOUNT' } };
  assert.equal(productFieldMapping(headers, mapping, totalCount).count, headers.indexOf('TCOUNT'));
  assert.equal(
    productFieldMapping(headers, mapping, totalCount, new Set(['count'])).count,
    mapping.count,
  );
});

test('소수 비율과 퍼센트 입력을 명시한 단위로 해석하고 정액단가는 나누지 않는다', () => {
  const rows = sampleRows();
  rows[0].feeValue = '1.5';
  assert.equal(reconcileAsis(rate, [rows[0]], { rateUnit: 'percent' }).results[0].status, 'match');
  assert.equal(reconcileAsis(rate, [rows[0]], { rateUnit: 'ratio' }).results[0].status, 'mismatch');
  const fixedRow = {
    amount: '-9900',
    feeValue: '100',
    asisFee: '100',
    asisVat: '10',
    asisPayout: '-10010',
  };
  assert.equal(
    reconcileAsis(fixed, [fixedRow], { rateUnit: 'percent' }).results[0].status,
    'match',
  );
});

test('CSV의 BOM·따옴표·줄바꿈·천 단위 쉼표와 TSV의 큰 정수 식별값을 보존한다', () => {
  const rows = importRows(
    '\uFEFFTID,AMT,CPRATE,CPFEE,CPVAT,JAMT\r\n"거래,""A""\n취소","-9,900",0.015,148,14,"-10,062"\r\n',
  );
  assert.equal(rows[0].id, '거래,"A"\n취소');
  assert.equal(cleanNumber(rows[0].amount), '-9900');
  assert.equal(reconcileAsis(rate, rows).results[0].status, 'match');
  const id = '202609101031083952291490';
  assert.equal(importRows(`TID\tAMT\tCPRATE\n${id}\t-9900\t0.015`)[0].id, id);
  assert.throws(() => cleanNumber('9,90'), /쉼표/);
});

test('중복 헤더·컬럼 수 불일치·깨진 따옴표·최대 행 초과를 거부한다', () => {
  for (const text of ['AMT,AMT\n1,2', 'AMT,RATE\n1,2,3', 'AMT,RATE\n"1,2'])
    assert.throws(() => parseAsisTable(text));
  assert.throws(
    () => parseAsisTable('AMT,CPRATE\n' + '1,0.1\n'.repeat(MAX_ASIS_ROWS + 1)),
    /500행/,
  );
  assert.throws(() => reconcileAsis(rate, []), /1~500행/);
  assert.throws(() => reconcileAsis(null, sampleRows()), /상품을 선택/);
});

test('직접 지정한 컬럼 매핑으로 알려지지 않은 조회 컬럼을 사용할 수 있다', () => {
  const table = parseAsisTable(
    '식별자,원금,수수료율,기존수수료,기존세금,기존지급\nx,-9900,0.015,148,14,-10062',
  );
  const mapping = {
    ...detectAsisMapping(table.headers, rate),
    id: 0,
    amount: 1,
    feeValue: 2,
    asisFee: 3,
    asisVat: 4,
    asisPayout: 5,
  };
  assert.equal(reconcileAsis(rate, mapAsisRows(table, mapping)).results[0].status, 'match');
});

test('계산대상금액과 원래 거래금액의 부호·지급액을 구분한다', () => {
  const product = productByCode.get('MOBILE-BASIC-EACH');
  const row = {
    amount: '-9900',
    targetAmount: '5000',
    feeValue: '0.015',
    asisFee: '-75',
    asisVat: '-7',
    asisPayout: '-9818',
  };
  const report = reconcileAsis(product, [row]);
  assert.equal(report.results[0].status, 'match');
  assert.equal(report.results[0].metrics.fee.calculated, '-75');
  row.targetAmount = '';
  row.asisFee = '-148';
  row.asisVat = '-14';
  row.asisPayout = '-9738';
  assert.equal(reconcileAsis(product, [row]).results[0].status, 'match');
});

test('합산 상품을 선택하면 검증 단위를 요구하고 전체·GROUP_KEY별 합계를 대조한다', () => {
  const product = productByCode.get('MOBILE-BASIC-SUM');
  const rows = [
    {
      amount: '99',
      feeValue: '0.015',
      asisFee: '1',
      asisVat: '0',
      asisPayout: '98',
      groupKey: 'A',
    },
    {
      amount: '99',
      feeValue: '0.015',
      asisFee: '1',
      asisVat: '0',
      asisPayout: '98',
      groupKey: 'A',
    },
  ];
  assert.throws(() => reconcileAsis(product, rows, { scope: '' }), /검증 단위/);
  assert.equal(reconcileAsis(product, rows, { scope: 'all' }).results[0].status, 'match');
  const grouped = reconcileAsis(product, [...rows, { ...rows[0], groupKey: 'B' }], {
    scope: 'groups',
  });
  assert.equal(grouped.results.length, 2);
  assert.equal(grouped.results[0].count, 2);
  assert.equal(grouped.results[0].metrics.fee.calculated, '2');
  assert.equal(grouped.results[1].metrics.fee.calculated, '1');
});

test('합산 시 일부 행의 AS-IS 값이 없으면 부분 합계를 전체 기대값으로 쓰지 않는다', () => {
  const rows = sampleRows();
  rows[1].asisVat = '';
  const report = reconcileAsis(rate, rows, { scope: 'all' });
  assert.equal(report.results[0].metrics.vat.asis, '');
  assert.equal(report.results[0].metrics.vat.missing, 1);
  assert.equal(report.results[0].status, 'partial');
});

test('요율·가맹점·기간·통화 및 승인/취소가 다른 정산 단위의 혼합을 막는다', () => {
  const rows = sampleRows();
  rows[1].feeValue = '0.02';
  assert.match(reconcileAsis(rate, rows, { scope: 'all' }).results[0].reasons[0], /요율/);
  rows[1].feeValue = rows[0].feeValue;
  rows[0].merchant = 'A';
  rows[1].merchant = 'B';
  assert.match(reconcileAsis(rate, rows, { scope: 'all' }).results[0].reasons[0], /가맹점/);
  const product = productByCode.get('MOBILE-BASIC-SUM');
  assert.match(
    reconcileAsis(
      product,
      [
        { amount: '9900', feeValue: '0.015' },
        { amount: '-9900', feeValue: '0.015' },
      ],
      { scope: 'all' },
    ).results[0].reasons[0],
    /승인과 취소/,
  );
  assert.equal(reconcileAsis(rate, sampleRows(), { scope: 'groups' }).results[0].status, 'error');
});

test('합산 검증에서 0원은 승인·취소 혼합으로 보지 않고 실제 양수·음수만 구분한다', () => {
  const product = structuredClone(rate);
  Object.assign(product.expected, {
    FEE_SMT_CALC_BASE_DVCD: 'SUM',
    VAT_SMT_CALC_BASE_DVCD: 'SUM',
    SIGN_APLY_LOCT_DVCD: 'AFTER',
  });
  for (const [amount, fee] of [
    ['10000', '150'],
    ['-10000', '-150'],
    ['0', '0'],
  ]) {
    const report = reconcileAsis(
      product,
      [
        { amount, feeValue: '0.015' },
        { amount: '0', feeValue: '0.015' },
      ],
      { scope: 'all' },
    );
    assert.equal(report.results[0].status, 'calculated');
    assert.equal(report.results[0].metrics.fee.calculated, fee);
  }
  const mixed = reconcileAsis(
    product,
    [
      { amount: '10000', feeValue: '0.015' },
      { amount: '-10000', feeValue: '0.015' },
    ],
    { scope: 'all' },
  );
  assert.match(mixed.results[0].reasons[0], /승인과 취소/);
});

test('면세 상품의 사용하지 않는 VAT 합산 설정은 건별 상품을 합산 대상으로 만들지 않는다', () => {
  const product = structuredClone(rate);
  Object.assign(product.expected, {
    VAT_DVCD: 'ZERO',
    VAT_SMT_CALC_BASE_DVCD: 'SUM',
    VAT_CALC_TRGT_DVCD: 'NONE',
  });
  assert.equal(needsAggregation(product), false);
  assert.notEqual(
    reconcileAsis(product, [{ amount: '10000', feeValue: '0.015' }], { scope: null }).results[0]
      .status,
    'error',
  );
  product.expected.FEE_SMT_CALC_BASE_DVCD = 'SUM';
  assert.equal(needsAggregation(product), true);
});

test('기본은 선택 상품으로 계산하고 옵션을 선택할 때만 행별 상품코드를 따른다', () => {
  const row = { ...sampleRows()[0], productCode: 'UNKNOWN' };
  assert.equal(reconcileAsis(rate, [row]).results[0].status, 'match');
  assert.ok(
    reconcileAsis(rate, [row]).results[0].reasons.some((reason) =>
      reason.includes('원본 상품코드'),
    ),
  );
  assert.equal(
    reconcileAsis(null, [row], { useRowProducts: true, products: productByCode }).results[0].status,
    'error',
  );
  const mixed = [
    { ...sampleRows()[0] },
    {
      productCode: fixed.code,
      amount: '-9900',
      feeValue: '100',
      asisFee: '100',
      asisVat: '10',
      asisPayout: '-10010',
    },
  ];
  assert.equal(
    reconcileAsis(null, mixed, { useRowProducts: true, products: productByCode }).summary.match,
    2,
  );
});

test('특이상품·미입력 요율·잘못된 AS-IS 값은 행 오류로 남기고 나머지는 계속 비교한다', () => {
  const rows = sampleRows();
  rows[0].feeValue = '';
  const report = reconcileAsis(rate, rows);
  assert.equal(report.summary.error, 1);
  assert.equal(report.summary.match, 1);
  assert.match(report.results[0].reasons[0], /요율/);
  assert.equal(
    reconcileAsis(productByCode.get('MOBILE-COUPANG'), sampleRows(), { scope: 'rows' }).results[0]
      .status,
    'error',
  );
  rows[0].feeValue = '0.015';
  rows[0].asisFee = '잘못된 값';
  assert.equal(reconcileAsis(rate, rows).results[0].status, 'error');
});

test('검증 결과를 원본 거래번호·AS-IS·계산값·차이·판정과 함께 CSV로 내보낸다', () => {
  const rows = sampleRows();
  rows[0].id = '=FORMULA';
  const csv = exportReconciliation(reconcileAsis(rate, rows).results);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('"DIFF_FEE"'));
  assert.ok(csv.includes('"\'=FORMULA"'));
  assert.ok(csv.includes('"-10062"'));
  assert.equal(parseAsisTable(csv).records.length, 2);
  assert.equal(ASIS_TEMPLATE.split('\t').length, 7);
});
