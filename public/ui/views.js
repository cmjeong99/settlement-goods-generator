import { FIELDS, describeField, explainCalculation } from '../domain.js';
import { $, make } from './dom.js';

export const labels = Object.fromEntries(
  FIELDS.map(([key, label]) => [key, label.replace('VAT', '부가세').replace('타입', '유형')]),
);
const reviewLabels = {
  unsupported: '재확인 필요',
  verify_more: '판단 보류',
  supported: '근거 일치',
};
const reviewOrder = { unsupported: 0, verify_more: 1, supported: 2 };
export function proofNodes(cell) {
  const quotes = [];
  for (const e of cell.evidence ?? [])
    quotes.push(
      make(
        'div',
        e.line === e.endLine ? `원문 ${e.line}행` : `원문 ${e.line}–${e.endLine}행`,
        'quote-label',
      ),
      make('pre', e.text, 'quote'),
    );
  if (!quotes.length)
    quotes.push(make('p', '수식에서 이 항목의 근거를 찾지 못했어요.', 'empty-proof'));
  return quotes;
}
export function inlineProof(key, cell) {
  const proof = make('div', undefined, 'inline-proof');
  proof.append(
    make('h4', `${labels[key]} · 판단 근거`),
    make('p', cell.reason),
    ...proofNodes(cell),
  );
  return proof;
}
export function renderExplanation(r) {
  $('calculation-explanation').replaceChildren(
    ...explainCalculation(r).map((text) => make('p', text)),
  );
}
export function renderProposal(proposal, result, evidence) {
  if (!proposal) return;
  const reviews = Object.values(proposal.reviews),
    counts = (d) => reviews.filter((r) => r.decision === d).length;
  $('review-summary').textContent =
    `재확인 ${counts('unsupported')}개 · 보류 ${counts('verify_more')}개 · 근거 일치 ${counts('supported')}개`;
  const ordered = [...FIELDS].sort(
    ([a], [b]) =>
      (reviewOrder[proposal.reviews[a]?.decision] ?? 3) -
      (reviewOrder[proposal.reviews[b]?.decision] ?? 3),
  );
  const cards = ordered.map(([key]) => {
    const cell = result.fields[key],
      review = proposal.reviews[key];
    const article = make('article', undefined, 'review-card ' + (review?.decision ?? 'unreviewed'));
    const head = make('div', undefined, 'review-card-head');
    head.append(
      make('h3', labels[key]),
      make('span', review ? reviewLabels[review.decision] : 'AI 검토 대상 아님', 'review-status'),
    );
    article.append(head, make('p', `현재 설정: ${describeField(key, cell)}`, 'review-value'));
    if (review) {
      article.append(
        make('p', `판단 확신도 ${(review.confidence * 100).toFixed(0)}%`, 'confidence'),
      );
      const details = make('details', undefined, 'probabilities');
      details.append(make('summary', '판정별 확률 보기'));
      for (const decision of ['unsupported', 'verify_more', 'supported'])
        details.append(
          make(
            'p',
            `${reviewLabels[decision]} · ${(review.probabilities[decision] * 100).toFixed(1)}%`,
          ),
        );
      article.append(details);
    } else article.append(make('p', '수식에서 확인한 값만 AI가 검토해요.'));
    const proof = make('button', '원문과 이유 보기');
    proof.onclick = () => evidence(key, proof);
    article.append(proof);
    return { article, attention: review && review.decision !== 'supported' };
  });
  $('review-list').replaceChildren(...cards.filter((c) => c.attention).map((c) => c.article));
  $('review-list').hidden = !cards.some((c) => c.attention);
  const remaining = cards.filter((c) => !c.attention);
  $('review-more').hidden = !remaining.length;
  $('review-more-title').textContent = `나머지 ${remaining.length}개 항목 보기`;
  $('review-more-list').replaceChildren(...remaining.map((c) => c.article));
}
