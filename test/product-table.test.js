import test from 'node:test';
import assert from 'node:assert/strict';
import { PRODUCT_COLUMNS, productTable, exportProductTable } from '../public/product-table.js';
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
