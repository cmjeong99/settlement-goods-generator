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
}

let comparisonSource = null;
export function renderProductComparison(product, result, source = result) {
  const panel = $('product-comparison');
  panel.hidden = !product || !result;
  if (!product || !result) {
    comparisonSource = null;
    return;
  }
  const comparisons = compareProduct(product, result);
  const differences = comparisons.filter((row) => row.status === 'different').length;
  const unconfirmed = comparisons.filter((row) => row.status === 'unconfirmed').length;
  const state = differences ? 'different' : unconfirmed ? 'unconfirmed' : 'match';
  panel.dataset.state = state;
  if (comparisonSource !== source) panel.open = differences > 0;
  comparisonSource = source;
  const title = $('product-comparison-title');
  title.replaceChildren(
    make('span', 'DB 상품 설정 대조'),
    make(
      'strong',
      differences ? `차이 ${differences}개` : unconfirmed ? '차이 없음' : '모두 일치',
      'comparison-count',
    ),
    make('span', unconfirmed ? `미확정 ${unconfirmed}개` : '', 'comparison-pending'),
  );
  title.setAttribute(
    'aria-label',
    `DB 상품 설정 대조. 차이 ${differences}개. 미확정 ${unconfirmed}개.`,
  );
  const priority = { different: 0, unconfirmed: 1, match: 2, 'not-applicable': 2 };
  $('product-comparison-rows').replaceChildren(
    ...comparisons
      .sort((left, right) => priority[left.status] - priority[right.status])
      .map((item) => {
        const row = make('tr');
        row.dataset.status = item.status;
        row.dataset.field = item.key;
        const heading = make('th', item.label);
        heading.scope = 'row';
        heading.append(make('small', item.key, 'comparison-column'));
        const expected = make('td');
        expected.append(
          make('code', item.expected === null ? 'NULL' : String(item.expected), 'comparison-value'),
        );
        const actual = make('td');
        const value =
          item.actual.status === 'not-applicable' ? 'NULL (미적용)' : display(item.actual);
        actual.append(
          make('code', `${item.status === 'different' ? '→ ' : ''}${value}`, 'comparison-value'),
        );
        const status = make('td');
        status.append(
          make(
            'span',
            {
              match: '일치',
              different: '차이 있음',
              unconfirmed: '미확정',
              'not-applicable': '일치 · 미적용',
            }[item.status],
            'comparison-badge',
          ),
        );
        row.append(heading, expected, actual, status);
        return row;
      }),
  );
}
