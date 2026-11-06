import { FIELDS } from './domain.js';
import { PRODUCT_EXAMPLES } from './product-examples.js';

export const productByCode = new Map(PRODUCT_EXAMPLES.map((product) => [product.code, product]));

export function compareProduct(product, result) {
  if (!product || !result) return [];
  return FIELDS.map(([key, label]) => {
    const cell = result.fields[key];
    const expected = product.expected[key];
    const status =
      cell.status === 'known' ? (cell.value === expected ? 'match' : 'different') : 'unconfirmed';
    return { key, label, expected, actual: cell, status };
  });
}
