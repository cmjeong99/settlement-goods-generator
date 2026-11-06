import { $, make } from './dom.js';
import { reconcileAsis, needsAggregation } from '../calculation/reconciliation.js';

export function verificationProduct(result, dbProduct) {
  if (!result) return null;
  if (dbProduct) return dbProduct;
  return {
    code: 'CURRENT-ANALYSIS',
    name: '현재 수식 분석 설정',
    engine: 'COMMON',
    source: 'analysis',
    expected: Object.fromEntries(
      Object.entries(result.fields).map(([key, field]) => [
        key,
        field.status === 'known' ? field.value : null,
      ]),
    ),
  };
}

export function createQuickVerification({ onContinue, onSummary }) {
  let product = null,
    signature = '';
  const input = () => ({
    amount: $('quick-amount').value,
    feeValue: $('quick-rate').value,
    count: product?.expected.FEE_TYPE_DVCD === 'FIXED' ? $('quick-count').value : '1',
    asisFee: $('quick-fee').value,
    asisVat: $('quick-vat').value,
    asisPayout: $('quick-payout').value,
    sourceRow: 1,
  });
  function syncActions() {
    const ready = !!product && !!input().amount.trim() && !!input().feeValue.trim();
    $('quick-run').disabled = $('quick-calculator').disabled = !ready;
  }
  function invalidate() {
    $('quick-results').hidden = true;
    $('quick-status').textContent = '';
    onSummary('선택 사항');
    syncActions();
  }
  $('quick-form').addEventListener('input', invalidate);
  $('quick-form').onsubmit = (event) => {
    event.preventDefault();
    try {
      const result = reconcileAsis(product, [input()]).results[0];
      if (result.status === 'error') throw new Error(result.reasons[0]);
      $('quick-results').replaceChildren(
        ...[
          ['fee', '수수료'],
          ['vat', 'VAT'],
          ['payout', '지급액'],
        ].map(([key, label]) => {
          const metric = result.metrics[key];
          const card = make('div', undefined, 'quick-metric');
          card.append(make('span', label), make('strong', metric.calculated || '—'));
          if (metric.asis !== '')
            card.append(
              make('small', `기존 ${metric.asis} · 차이 ${metric.difference || '비교 불가'}`),
            );
          if (metric.match === false) card.classList.add('has-difference');
          return card;
        }),
      );
      $('quick-results').hidden = false;
      const comparing = ['asisFee', 'asisVat', 'asisPayout'].some((key) => input()[key].trim());
      $('quick-status').textContent = comparing
        ? result.reasons.join(' ')
        : result.metrics.payout.calculated === ''
          ? '이 상품은 수수료와 VAT만 확인할 수 있어요. 지급 방식이 확인된 선취·지급 상품만 지급액을 계산해요.'
          : '';
      onSummary(result.status === 'mismatch' ? '기존 금액과 차이 있음' : '간단 계산 완료');
    } catch (error) {
      $('quick-results').hidden = true;
      $('quick-status').textContent = error.message;
      onSummary('입력·설정 확인 필요');
    }
  };
  $('quick-calculator').onclick = () => onContinue(product, input());
  return {
    setResult(result, dbProduct) {
      const next = verificationProduct(result, dbProduct);
      const nextSignature = JSON.stringify(next);
      if (signature === nextSignature) return;
      signature = nextSignature;
      product = next;
      const fixed = product?.expected.FEE_TYPE_DVCD === 'FIXED';
      $('quick-rate-label').textContent = fixed ? '단가' : '요율';
      $('quick-rate').placeholder = fixed ? '예: 100' : '예: 1.5% 또는 0.015';
      $('quick-count-wrap').hidden = !fixed;
      $('quick-product').textContent = product
        ? `${product.name} · ${product.source === 'analysis' ? '수식에서 확인된 설정' : 'DB 상품 설정'}으로 한 건을 계산해요.${needsAggregation(product) ? ' 합산 상품은 합산된 금액을 입력하세요.' : ''}`
        : '수식을 먼저 분석해 주세요.';
      invalidate();
    },
  };
}
