import { $, make } from './dom.js';
import { display } from '../domain.js';
import { compareProduct } from '../catalog.js';
import { PRODUCT_EXAMPLES, PRODUCT_SNAPSHOT_DATE } from '../product-examples.js';

export function populateExamples(examples) {
  const products = make('optgroup');
  products.label = `DB 상품 ${PRODUCT_EXAMPLES.length}개 · ${PRODUCT_SNAPSHOT_DATE}`;
  for (const product of PRODUCT_EXAMPLES) {
    products.append(new Option(`${product.code} · ${product.name}`, product.code));
  }
  const general = make('optgroup');
  general.label = '계산 방식 예제';
  for (const name of Object.keys(examples)) general.append(new Option(name, name));
  $('example').append(products, general);
}

export function renderProductContext(product, result) {
  $('product-context').hidden = !product;
  $('product-comparison').hidden = !product || !result;
  if (!product) return;
  $('product-title').textContent = `${product.name} · ${product.code}`;
  $('product-source').textContent =
    `DB 조회 ${PRODUCT_SNAPSHOT_DATE} · 서비스 ${product.serviceCode}/${product.detailServiceCode} · ${product.engine} 계산기`;
  $('product-references').replaceChildren(
    ...product.sources.map((source) => {
      const item = make('li');
      item.append(make('code', `${source.name}:${source.line}`), make('p', source.note));
      return item;
    }),
  );
  if (!result) return;
  const comparisons = compareProduct(product, result);
  const differences = comparisons.filter((row) => row.status === 'different').length;
  const unconfirmed = comparisons.filter((row) => row.status === 'unconfirmed').length;
  $('product-comparison-title').textContent =
    `DB 상품 설정 대조 · 차이 ${differences}개 · 미확정 ${unconfirmed}개`;
  $('product-comparison-rows').replaceChildren(
    ...comparisons.map((item) => {
      const row = make('tr');
      row.append(
        make('th', item.label),
        make('td', item.expected === null ? 'NULL' : String(item.expected)),
        make('td', display(item.actual)),
        make('td', { match: '일치', different: '차이 있음', unconfirmed: '미확정' }[item.status]),
      );
      return row;
    }),
  );
}
