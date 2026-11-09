import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { highlightSql, formatSql } from '../public/sql-tools.js';
import { tokenize } from '../public/parser.js';
import { PRODUCT_EXAMPLES } from '../public/product-examples.js';

// Exercise the same local distributions loaded by the browser, without a CDN.
const context = {};
for (const file of ['prism-core.min.js', 'prism-sql.min.js', 'sql-formatter.min.js'])
  runInNewContext(
    await readFile(new URL(`../public/vendor/${file}`, import.meta.url), 'utf8'),
    context,
  );
globalThis.Prism = context.Prism;
globalThis.sqlFormatter = context.sqlFormatter;

test('55개 실제 상품의 SQL 정렬 전후에 수식·상수·식별자 토큰을 보존한다', () => {
  const tokens = (sql) => tokenize(sql).map(({ kind, value }) => [kind, value]);
  for (const product of PRODUCT_EXAMPLES) {
    const formatted = formatSql(product.sql);
    assert.deepEqual(tokens(formatted), tokens(product.sql), product.code);
    assert.equal(formatSql(formatted), formatted, `${product.code}: 정렬의 멱등성`);
  }
});

test('MSSQL 정렬은 작은따옴표·대괄호 식별자·변수·주석의 내용을 유지한다', () => {
  const sql = "select [수수료 금액], N'내 ''상품''', @rate from #tmp where x=1 -- 내 주석\n";
  const formatted = formatSql(sql);
  assert.match(formatted, /^SELECT\n/);
  for (const text of ['[수수료 금액]', "N'내 ''상품'''", '@rate', '#tmp', '-- 내 주석'])
    assert.ok(formatted.includes(text), text);
  assert.throws(() => formatSql("select '닫히지 않은 문자열"));
});

test('SQL 강조는 HTML을 이스케이프하고 임시 테이블과 대괄호 식별자를 주석으로 취급하지 않는다', () => {
  const sql =
    "SELECT [상품 코드], @rate FROM #tmp; -- <img src=x onerror=alert(1)>\nSELECT '<script>bad()</script>'";
  const html = highlightSql(sql);
  assert.doesNotMatch(html, /<img|<script/);
  assert.match(html, /&lt;img/);
  assert.match(html, /token identifier">\[상품 코드\]/);
  assert.match(html, /token variable">@rate/);
  assert.match(html, /FROM<\/span> #tmp/);
  assert.match(html, /token string/);
});
