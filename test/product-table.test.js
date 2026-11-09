import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PRODUCT_COLUMNS,
  productTable,
  exportProductTable,
  productInsertErrors,
} from '../public/product-table.js';
import { analyze } from '../public/analyzer.js';
import { EXAMPLES } from '../public/examples.js';
import { buildFinalProduct } from '../public/final-product.js';
import { PRODUCT_EXAMPLES } from '../public/product-examples.js';

test('수식에서 도출한 값은 재선택 없이 처음부터 표에 그대로 표시한다', () => {
  const source = analyze(EXAMPLES['오픈뱅킹 정률']).results[0];
  const table = productTable(source);
  assert.equal(table.inferred, 12);
  assert.equal(table.pending, 0);
  assert.equal(table.resolved, 12);
  assert.equal(table.cells.find((c) => c.key === 'SIGN_APLY_LOCT_DVCD').value, 'NONE');
  assert.equal(table.cells.find((c) => c.key === 'FEE_SMT_CALC_UNIT_VAL').value, '0');
  for (const product of PRODUCT_EXAMPLES) {
    const result = analyze(product.sql).results[0];
    const cells = productTable(result).cells;
    for (const [key, cell] of Object.entries(result.fields))
      if (cell.status === 'known') {
        assert.equal(
          cells.find((c) => c.key === key).value,
          String(cell.value),
          `${product.code}/${key}`,
        );
        assert.equal(cells.find((c) => c.key === key).status, 'inferred');
      }
  }
});

test('같은 열 순서에서 미확정 값 하나만 직접 확정되고 다른 도출값은 유지된다', () => {
  const source = analyze(EXAMPLES['오픈뱅킹 정액']).results[0];
  const initial = productTable(source);
  assert.equal(initial.pending, 1);
  const draft = buildFinalProduct(source, { FRIM_BASE_DVCD: 'SCOUNT' });
  const decided = productTable(draft.result, { code: 'MY-PRODUCT', name: '내 상품' });
  assert.equal(decided.pending, 0);
  assert.equal(decided.chosen, 1);
  assert.deepEqual(
    initial.cells.map((c) => c.key),
    decided.cells.map((c) => c.key),
  );
  for (const cell of initial.cells.slice(2).filter((c) => c.key !== 'FRIM_BASE_DVCD'))
    assert.deepEqual(
      decided.cells.find((c) => c.key === cell.key),
      cell,
    );
  const deferred = productTable(buildFinalProduct(source, { FRIM_BASE_DVCD: '__defer__' }).result);
  assert.equal(deferred.pending, 1);
  assert.equal(deferred.cells.find((c) => c.key === 'FRIM_BASE_DVCD').value, '미확정');
});

test('화면과 Markdown·엑셀 복사는 상품명 입력 전후에도 같은 14개 열과 값을 사용한다', () => {
  const source = analyze(EXAMPLES['오픈뱅킹 정률']).results[0];
  for (const name of [null, { code: 'MY-PRODUCT', name: '내 상품' }]) {
    const table = productTable(source, name);
    const [headers, values] = exportProductTable(source, 'tsv', name)
      .split('\n')
      .map((line) => line.split('\t'));
    assert.deepEqual(
      headers,
      PRODUCT_COLUMNS.map(([key]) => key),
    );
    assert.equal(headers.length, 14);
    assert.deepEqual(
      values,
      table.cells.map((cell) => cell.value),
    );
    assert.equal(
      exportProductTable(source, 'markdown', name).split('\n')[0],
      `| ${headers.join(' | ')} |`,
    );
  }
});

test('INSERT는 최종 설정과 따옴표가 포함된 상품 정보를 SQL 리터럴로 내보낸다', () => {
  const source = analyze(EXAMPLES['오픈뱅킹 정률']).results[0];
  const draft = buildFinalProduct(
    source,
    { FEE_SMT_CALC_MHOD_DVCD: 'HALF_UP', FEE_SMT_CALC_UNIT_VAL: '0.01' },
    { code: " MY'01 ", name: " 내 '정산' 상품 " },
  );
  assert.deepEqual(productInsertErrors(draft.result, draft.name), []);
  const sql = exportProductTable(draft.result, 'sql', draft.name);
  assert.equal(
    sql,
    `INSERT INTO TB_SSI_MERC_SMT_GDS_M (
  SMT_GDS_CD,
  SMT_GDS_NM,
  FRIM_BASE_DVCD,
  FEE_TYPE_DVCD,
  FEE_SMT_CALC_BASE_DVCD,
  FEE_SMT_CALC_MHOD_DVCD,
  FEE_SMT_CALC_UNIT_VAL,
  VAT_DVCD,
  VAT_CALC_TRGT_DVCD,
  VAT_SMT_CALC_BASE_DVCD,
  VAT_SMT_CALC_MHOD_DVCD,
  VAT_SMT_CALC_UNIT_VAL,
  ABS_PROCS_YN,
  SIGN_APLY_LOCT_DVCD
) VALUES (
  'MY''01',
  '내 ''정산'' 상품',
  'AMOUNT',
  'RATE',
  'EACH',
  'HALF_UP',
  0.01,
  'SEPARATED',
  'AMOUNT',
  'EACH',
  'DOWN',
  0,
  'Y',
  'NONE'
)`,
  );
  assert.equal(source.fields.FEE_SMT_CALC_MHOD_DVCD.value, 'DOWN');
});

test('Oracle 단일 문장 실행용 SQL은 종결자와 문자열 밖의 특수 공백을 포함하지 않는다', () => {
  const source = analyze(EXAMPLES['오픈뱅킹 정률']).results[0];
  const sql = exportProductTable(source, 'sql', { code: 'MY-01', name: '내\u00a0상품; 원본' });
  const syntax = sql.replace(/'(?:''|[^'])*'/g, "''");
  assert.ok(sql.endsWith(')'));
  assert.doesNotMatch(syntax, /[;\u00a0\u200b\ufeff]/);
  assert.match(sql, /'내\u00a0상품; 원본'/);
});

test('면세의 미적용 설정은 NULL로 내보내고 코드 NONE과 숫자 0은 보존한다', () => {
  const source = analyze('SELECT FLOOR(ABS(AMT) * RATE) AS CPFEE, 0 AS CPVAT').results[0];
  const sql = exportProductTable(source, 'sql', { code: 'ZERO', name: '면세 상품' });
  assert.match(sql, /'DOWN',\n  0,\n  'ZERO',\n  'NONE',\n  'EACH',\n  'NONE',\n  NULL/);
  assert.doesNotMatch(sql, /미적용|미확정|별도 계산 필요|undefined/);
});

test('상품 정보가 없거나 미확정·보류·별도 계산 설정이 남으면 INSERT 복사를 막는다', () => {
  const source = analyze(EXAMPLES['오픈뱅킹 정률']).results[0];
  const name = { code: 'MY-01', name: '내 상품' };
  for (const identity of [null, { code: 'MY-01' }, { name: '내 상품' }, { code: ' ', name: ' ' }])
    assert.throws(() => exportProductTable(source, 'sql', identity), /상품코드와 상품명/);
  assert.throws(() => exportProductTable(null, 'sql', name), /수식을 먼저 분석/);
  const deferred = buildFinalProduct(source, { FEE_TYPE_DVCD: '__defer__' });
  assert.throws(() => exportProductTable(deferred.result, 'sql', name), /수수료 타입/);
  const custom = analyze('SELECT OTHER(AMT) AS CPFEE').results[0];
  assert.throws(() => exportProductTable(custom, 'sql', name), /확정해 주세요/);
  assert.doesNotThrow(() => exportProductTable(deferred.result, 'tsv', null));
});
