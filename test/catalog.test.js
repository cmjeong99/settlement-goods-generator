import test from 'node:test';
import assert from 'node:assert/strict';
import { PRODUCT_EXAMPLES } from '../public/product-examples.js';
import { compareProduct } from '../public/catalog.js';
import { FIELDS } from '../public/domain.js';
import { analyze } from '../public/analyzer.js';
import { extract } from '../public/parser.js';

test('DB에서 조회한 55개 상품 모두 출처와 입력 가능한 SP 예제를 가진다', () => {
  assert.equal(PRODUCT_EXAMPLES.length, 55);
  assert.equal(new Set(PRODUCT_EXAMPLES.map((product) => product.code)).size, 55);
  for (const product of PRODUCT_EXAMPLES) {
    assert.deepEqual(
      Object.keys(product.expected),
      FIELDS.map(([key]) => key),
    );
    assert.ok(product.sources.length > 0, product.code);
    for (const source of product.sources) {
      assert.ok(source.line > 0);
      assert.match(source.hash, /^[a-f0-9]{64}$/);
      assert.ok(product.sql.includes(source.name));
    }
    const blocks = extract(product.sql);
    assert.ok(blocks.length > 0, product.code);
    assert.ok(
      blocks.every((block) => block.errors.length === 0),
      `${product.code}: ${JSON.stringify(blocks.flatMap((block) => block.errors))}`,
    );
    assert.equal(analyze(product.sql).errors.length, 0, product.code);
    assert.doesNotMatch(product.sql, /'(?:AG\d{8}|\d{10})'/, product.code);
  }
});

test('DB와 분석의 차이·미확정·NULL을 구분하며 분석 결과를 덮어쓰지 않는다', () => {
  const product = PRODUCT_EXAMPLES.find((product) => product.code === 'OPENBANKING-RATE');
  const result = analyze(product.sql).results[0];
  const before = structuredClone(result);
  const comparisons = compareProduct(
    { ...product, expected: { ...product.expected, SIGN_APLY_LOCT_DVCD: 'BEFORE' } },
    result,
  );
  assert.equal(comparisons.find((item) => item.key === 'SIGN_APLY_LOCT_DVCD').status, 'different');
  assert.deepEqual(result, before);
  const unknown = analyze('SELECT OTHER(AMT) AS CPFEE').results[0];
  assert.ok(compareProduct(product, unknown).some((item) => item.status === 'unconfirmed'));
  assert.deepEqual(compareProduct(null, result), []);
});

test('CASE IN 구문을 보존해 본인확인과 해외 면세 분기를 분석한다', () => {
  const result = extract(
    "SELECT CASE WHEN CPID IN ('A','B') THEN 0 ELSE FLOOR(AMT*0.1) END AS CPVAT",
  );
  assert.equal(result[0].errors.length, 0);
  assert.equal(result[0].formulas.vat.branches[0].when.kind, 'in');
});
