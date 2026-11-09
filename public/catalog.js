import { FIELDS } from './domain.js';
import { PRODUCT_EXAMPLES } from './product-examples.js';
import { SERVICES } from './service-catalog.js';

export const productByCode = new Map(PRODUCT_EXAMPLES.map((product) => [product.code, product]));

const serviceNames = Object.fromEntries(SERVICES);

export function groupProducts(products) {
  const groups = new Map();
  for (const product of products) {
    const code = product.serviceCode || 'custom';
    if (!groups.has(code))
      groups.set(code, {
        code,
        label: code === 'custom' ? '직접 만든 설정' : `${serviceNames[code] || '서비스'} · ${code}`,
        products: [],
      });
    groups.get(code).products.push(product);
  }
  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label, 'ko'));
}

export function compareProduct(product, result) {
  if (!product || !result) return [];
  return FIELDS.map(([key, label]) => {
    const cell = result.fields[key];
    const expected = product.expected[key];
    const status =
      cell.status === 'not-applicable'
        ? 'not-applicable'
        : cell.status === 'known'
          ? cell.value === expected
            ? 'match'
            : 'different'
          : 'unconfirmed';
    return { key, label, expected, actual: cell, status };
  });
}
