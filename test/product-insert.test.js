import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { exportProductTable, productInsertErrors } from '../public/product-table.js';
import { INSERT_FIELDS } from '../public/product-insert.js';
import { analyze } from '../public/analyzer.js';
import { tokenize } from '../public/parser.js';
import { EXAMPLES } from '../public/examples.js';
import { FIELDS, NULL_OVERRIDE, NULLABLE_FIELDS, explainCalculation } from '../public/domain.js';
import { verifyCalculation } from '../public/calculation/verify.js';
import { buildFinalProduct } from '../public/final-product.js';
import { PRODUCT_EXAMPLES } from '../public/product-examples.js';

const schema = JSON.parse(
  await readFile(new URL('./fixtures/product-insert-schema.json', import.meta.url)),
);
const source = () => analyze(EXAMPLES['오픈뱅킹 정률']).results[0];
const name = { code: 'MY-01', name: '내 상품' };
const registration = () => ({
  ...PRODUCT_EXAMPLES.find((p) => p.code === 'OPENBANKING-RATE').registration,
  REG_USER_ID: 'tester',
});

function inserted(sql) {
  const tokens = tokenize(sql).filter((t) => t.kind !== 'eof');
  const begin = tokens.findIndex((t) => t.value === '(');
  const end = tokens.findIndex((t, i) => i > begin && t.value === ')');
  const columns = tokens
    .slice(begin + 1, end)
    .filter((t) => t.value !== ',')
    .map((t) => t.value);
  const values = tokens.slice(end + 3, -1).filter((t) => t.value !== ',');
  assert.equal(values.length, columns.length);
  return Object.fromEntries(columns.map((column, i) => [column, values[i]]));
}

test('NULL 선택 가능 컬럼은 실제 DB의 nullable 계산 컬럼과 일치한다', () => {
  assert.deepEqual(
    [...NULLABLE_FIELDS].sort(),
    schema.columns
      .filter((c) => c.nullable && FIELDS.some(([key]) => key === c.column))
      .map((c) => c.column)
      .sort(),
  );
});

test('DB의 모든 nullable 컬럼은 NULL 선택으로 빠짐없이 INSERT에 포함된다', () => {
  const nullable = schema.columns.filter((column) => column.nullable).map((c) => c.column);
  const optional = INSERT_FIELDS.filter(([, , , required]) => !required).map(([key]) => key);
  assert.deepEqual([...NULLABLE_FIELDS, ...optional].sort(), [...nullable].sort());
  const draft = buildFinalProduct(
    source(),
    Object.fromEntries(NULLABLE_FIELDS.map((key) => [key, NULL_OVERRIDE])),
  );
  assert.deepEqual(draft.errors, []);
  const row = inserted(
    exportProductTable(draft.result, 'sql', name, {
      ...registration(),
      ...Object.fromEntries(optional.map((key) => [key, NULL_OVERRIDE])),
    }),
  );
  for (const key of nullable) {
    assert.equal(row[key]?.kind, 'id', key);
    assert.equal(row[key]?.value, 'NULL', key);
  }
  for (const column of schema.columns.filter((c) => !c.nullable)) {
    assert.ok(row[column.column], column.column);
    assert.notEqual(row[column.column].value, 'NULL', column.column);
  }
});

test('필수 계산·등록 컬럼은 NULL 선택으로 우회할 수 없다', () => {
  for (const [key] of FIELDS.filter(([key]) => !NULLABLE_FIELDS.includes(key))) {
    const draft = buildFinalProduct(source(), { [key]: NULL_OVERRIDE });
    assert.equal(draft.settingErrors.length, 1, key);
  }
  for (const [key, label, , required] of INSERT_FIELDS) {
    if (!required) continue;
    assert.ok(
      productInsertErrors(source(), name, { ...registration(), [key]: NULL_OVERRIDE }).some(
        (error) => error.includes(label) && error.includes('NULL'),
      ),
      key,
    );
  }
});

test('절대값 N·부호 위치 NULL을 확정하면 INSERT와 음수 예시 계산이 가능하다', () => {
  const original = analyze(
    'SELECT ROUND(AMT * RATE, 0) AS CPFEE, ROUND(AMT * RATE * 0.1, 0) AS CPVAT',
  ).results[0];
  const deferred = buildFinalProduct(original, {
    ABS_PROCS_YN: 'N',
    SIGN_APLY_LOCT_DVCD: '__defer__',
  });
  assert.throws(
    () => exportProductTable(deferred.result, 'sql', name, registration()),
    /부호 적용 위치/,
  );
  const draft = buildFinalProduct(original, {
    ABS_PROCS_YN: 'N',
    SIGN_APLY_LOCT_DVCD: NULL_OVERRIDE,
  });
  const row = inserted(exportProductTable(draft.result, 'sql', name, registration()));
  assert.equal(row.SIGN_APLY_LOCT_DVCD.kind, 'id');
  assert.equal(row.SIGN_APLY_LOCT_DVCD.value, 'NULL');
  assert.equal(row.ABS_PROCS_YN.value, 'N');
  assert.match(explainCalculation(draft.result)[2], /NULL\(미적용\)/);
  assert.doesNotMatch(explainCalculation(draft.result)[2], /확정할 수 없어요/);
  const verified = verifyCalculation(original, [{ AMT: '-9900', RATE: '0.015' }], {
    fields: draft.result.fields,
    amountColumn: 'AMT',
    feeValue: '0.015',
  });
  assert.deepEqual(verified.errors, []);
  assert.ok(verified.comparisons.every((c) => c.settingsMatch));
});

test('선택 등록 정보의 NULL은 DB 기본값 생략·문자열 NULL과 구분한다', () => {
  const row = inserted(
    exportProductTable(source(), 'sql', name, {
      ...registration(),
      FEE_RCVG_DVCD: NULL_OVERRIDE,
      MERC_PMT_CURN_CD: NULL_OVERRIDE,
      RMK: 'NULL',
    }),
  );
  for (const key of ['FEE_RCVG_DVCD', 'MERC_PMT_CURN_CD']) {
    assert.equal(row[key].value, 'NULL');
    assert.equal(row[key].kind, 'id');
  }
  assert.equal(row.RMK.kind, 'string');
  assert.equal(row.RMK.value, 'NULL');
  assert.throws(
    () => exportProductTable(source(), 'sql', name, { ...registration(), SRVC_CD: NULL_OVERRIDE }),
    /NULL로 지정할 수 없어요/,
  );
});

test('INSERT는 사용자 최종값·따옴표와 필수 등록·변경 정보를 함께 내보낸다', () => {
  const original = source();
  const draft = buildFinalProduct(
    original,
    { FEE_SMT_CALC_MHOD_DVCD: 'HALF_UP', FEE_SMT_CALC_UNIT_VAL: '10' },
    { code: " MY'01 ", name: " 내 '정산' 상품 " },
  );
  const sql = exportProductTable(draft.result, 'sql', draft.name, registration());
  const row = inserted(sql);
  assert.match(sql, /'MY''01'/);
  assert.equal(row.SMT_GDS_NM.value, "내 '정산' 상품");
  assert.equal(row.SRVC_CD.value, '10603');
  assert.equal(row.FEE_SMT_CALC_MHOD_DVCD.value, 'HALF_UP');
  assert.equal(row.FEE_SMT_CALC_UNIT_VAL.kind, 'number');
  assert.equal(row.FEE_SMT_CALC_UNIT_VAL.value, '10');
  for (const key of ['FRST_REG_USER_ID', 'LAST_CHNG_USER_ID'])
    assert.equal(row[key].value, 'tester');
  for (const key of ['FRST_REG_PROG_NM', 'LAST_CHNG_PROG_NM'])
    assert.equal(row[key].value, 'settlement-formula-studio');
  for (const key of ['FRST_REG_DTTM', 'LAST_CHNG_DTTM'])
    assert.equal(row[key].value, 'SYSTIMESTAMP');
  assert.equal(original.fields.FEE_SMT_CALC_MHOD_DVCD.value, 'DOWN');
});

test('55개 상품의 등록 정보를 복사할 때 DB 필수 컬럼과 서비스·통화·엔진 값을 보존한다', () => {
  for (const product of PRODUCT_EXAMPLES) {
    const result = source();
    const row = inserted(
      exportProductTable(result, 'sql', product, {
        ...product.registration,
        REG_USER_ID: 'tester',
      }),
    );
    for (const column of schema.columns) {
      if (!column.nullable && !column.defaultValue) {
        assert.ok(row[column.column], `${product.code}/${column.column}: 필수 컬럼 누락`);
        assert.notEqual(row[column.column].value, 'NULL', `${product.code}/${column.column}: NULL`);
      }
      if (row[column.column]?.kind === 'string')
        assert.ok(
          Array.from(row[column.column].value).length <= column.length,
          `${product.code}/${column.column}: 길이`,
        );
    }
    assert.equal(row.SRVC_CD.value, product.serviceCode);
    assert.equal(row.DTLS_SRVC_CD.value, product.detailServiceCode);
    assert.equal(row.CALC_ENGE_DVCD.value, product.engine);
    for (const key of [
      'MERC_PMT_CURN_CD',
      'ORCM_APRV_CURN_CD',
      'ORCM_SMT_CURN_CD',
      'MERC_SMT_CURN_CD',
    ])
      assert.equal(row[key].value, product.registration[key]);
  }
});

test('필수 등록값을 비우면 복사를 막고 선택값을 비우면 DB 기본값을 덮어쓰지 않는다', () => {
  for (const [key, label, , required] of INSERT_FIELDS) {
    if (!required) continue;
    assert.ok(
      productInsertErrors(source(), name, { ...registration(), [key]: ' ' }).some((error) =>
        error.includes(label),
      ),
      key,
    );
    assert.throws(() =>
      exportProductTable(source(), 'sql', name, { ...registration(), [key]: '' }),
    );
  }
  const optional = { ...registration(), FEE_RCVG_DVCD: '', MERC_PMT_CURN_CD: '' };
  const row = inserted(exportProductTable(source(), 'sql', name, optional));
  assert.equal(row.FEE_RCVG_DVCD, undefined);
  assert.equal(row.MERC_PMT_CURN_CD, undefined);
  assert.equal(row.ORCM_SMT_CURN_CD.value, 'KRW');
});

test('DB 문자열 길이와 NUMBER(3,0)을 검사하되 표·계산기에서의 소수 단위는 유지한다', () => {
  for (const unit of ['0.01', '1000']) {
    const draft = buildFinalProduct(source(), { FEE_SMT_CALC_UNIT_VAL: unit });
    assert.throws(
      () => exportProductTable(draft.result, 'sql', name, registration()),
      /NUMBER\(3,0\)/,
    );
    assert.doesNotThrow(() => exportProductTable(draft.result, 'tsv', name));
  }
  assert.throws(
    () => exportProductTable(source(), 'sql', { ...name, name: '가'.repeat(101) }, registration()),
    /100자/,
  );
  assert.throws(
    () => exportProductTable(source(), 'sql', name, { ...registration(), SRVC_CD: '106030' }),
    /5자/,
  );
});

test('미적용 NULL·코드 NONE·숫자 0을 구분하고 SQL 문장 밖에 특수 공백과 종결자를 넣지 않는다', () => {
  const result = analyze('SELECT FLOOR(ABS(AMT) * RATE) AS CPFEE, 0 AS CPVAT').results[0];
  const sql = exportProductTable(
    result,
    'sql',
    { code: 'ZERO', name: '내\u00a0상품; 원본' },
    registration(),
  );
  const row = inserted(sql);
  assert.equal(row.FEE_SMT_CALC_UNIT_VAL.value, '0');
  assert.equal(row.VAT_SMT_CALC_UNIT_VAL.value, 'NULL');
  assert.equal(row.VAT_CALC_TRGT_DVCD.value, 'NONE');
  assert.ok(sql.endsWith(')'));
  assert.doesNotMatch(sql.replace(/'(?:''|[^'])*'/g, "''"), /[;\u00a0\u200b\ufeff]/);
});

test('미확정·별도 계산·필수 컬럼의 미적용 값으로는 INSERT를 만들지 않는다', () => {
  for (const identity of [null, { code: 'MY-01' }, { name: '내 상품' }])
    assert.throws(
      () => exportProductTable(source(), 'sql', identity, registration()),
      /상품코드와 상품명/,
    );
  assert.throws(() => exportProductTable(null, 'sql', name, registration()), /수식을 먼저 분석/);
  const deferred = buildFinalProduct(source(), { FEE_TYPE_DVCD: '__defer__' });
  assert.throws(
    () => exportProductTable(deferred.result, 'sql', name, registration()),
    /수수료 타입/,
  );
  const custom = analyze('SELECT OTHER(AMT) AS CPFEE').results[0];
  assert.throws(() => exportProductTable(custom, 'sql', name, registration()), /확정해 주세요/);
  const invalid = source();
  invalid.fields.FRIM_BASE_DVCD = { status: 'not-applicable', value: null };
  assert.throws(() => exportProductTable(invalid, 'sql', name, registration()), /과금 기준/);
});
