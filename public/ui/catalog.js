import { $, make } from './dom.js';
import { display } from '../domain.js';
import { compareProduct, groupProducts } from '../catalog.js';
import { PRODUCT_EXAMPLES, PRODUCT_SNAPSHOT_DATE } from '../product-examples.js';

export function populateExamples(examples) {
  return createProductPicker({
    service: $('example-service'),
    select: $('example'),
    products: () => PRODUCT_EXAMPLES,
    examples,
  });
}

export function createProductPicker({ service, select, products, examples = {} }) {
  function groups() {
    const grouped = groupProducts(products());
    if (Object.keys(examples).length)
      grouped.push({
        code: 'examples',
        label: '계산 방식 예제',
        products: Object.keys(examples).map((name) => ({ code: name, name })),
      });
    return grouped;
  }
  function refresh(value = select.value, filter = service.value) {
    const all = groups();
    service.replaceChildren(
      new Option('전체 서비스', ''),
      ...all.map((group) => new Option(`${group.label} (${group.products.length})`, group.code)),
    );
    service.value = all.some((group) => group.code === filter) ? filter : '';
    select.replaceChildren(new Option('상품·예제 선택', ''));
    for (const group of all) {
      const visible = !service.value || group.code === service.value;
      const items = visible ? group.products : group.products.filter((p) => p.code === value);
      if (!items.length) continue;
      const optgroup = make('optgroup');
      optgroup.label = visible ? group.label : `현재 선택 유지 · ${group.label}`;
      for (const product of items)
        optgroup.append(
          new Option(
            group.code === 'examples' ? product.name : `${product.name} · ${product.code}`,
            product.code,
          ),
        );
      select.append(optgroup);
    }
    select.value = value;
    if (select.selectedIndex < 0) select.value = '';
  }
  function setValue(value) {
    const group = groups().find((group) => group.products.some((p) => p.code === value));
    refresh(value, group?.code ?? service.value);
  }
  service.addEventListener('change', () => refresh());
  select.addEventListener('change', () => setValue(select.value));
  refresh();
  return {
    setValue,
    clear() {
      refresh('');
    },
  };
}

export function renderProductContext(product, result) {
  $('product-context').hidden = !product;
  $('product-comparison').hidden = !product || !result;
  if (!product) return;
  $('product-title').textContent = `${product.name} · ${product.code}`;
  $('product-source').textContent =
    `DB 조회 ${PRODUCT_SNAPSHOT_DATE} · 서비스 ${product.serviceCode}/${product.detailServiceCode} · ${product.engine} 계산기`;
  $('product-flow').textContent = product.calculation?.summary ?? '';
  $('product-unresolved').textContent = product.calculation?.unresolved ?? '';
  $('product-unresolved').hidden = !$('product-unresolved').textContent;
  $('product-references').replaceChildren(
    ...product.sources.map((source) => {
      const item = make('li');
      item.append(
        make(
          'strong',
          `${source.stage ?? '계산식'}${source.active === false ? ' · 주석 참고' : ''}`,
        ),
        make('code', `${source.name}:${source.line}`),
        make('p', source.note),
      );
      if (source.groupBy) item.append(make('pre', source.groupBy, 'quote'));
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
        make(
          'td',
          {
            match: '일치',
            different: '차이 있음',
            unconfirmed: '미확정',
            'not-applicable': '미적용',
          }[item.status],
        ),
      );
      return row;
    }),
  );
}
