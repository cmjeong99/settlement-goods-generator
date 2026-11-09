import { FIELDS } from './domain.js';
import { PRODUCT_EXAMPLES } from './product-examples.js';

export const productByCode = new Map(PRODUCT_EXAMPLES.map((product) => [product.code, product]));

const serviceNames = {
  10101: '휴대폰결제',
  10602: '계좌이체',
  10603: '오픈뱅킹',
  10901: '컬처랜드상품권',
  10903: '도서문화상품권',
  11515: '상품권발행',
  12001: '본인확인',
  12204: '특수한도카드',
  12206: '신용카드',
  12502: '가상계좌',
  12801: '제휴간편결제',
  50415: '위챗페이 오프라인',
  50601: '위챗페이 학비결제',
  50602: '위챗페이 학비결제',
  50802: '비자사이버소스',
  51001: '페이코인',
  51101: '보쿠',
  51102: '알리페이플러스',
  51401: '페이팔',
};

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
