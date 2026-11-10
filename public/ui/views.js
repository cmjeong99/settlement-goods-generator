import { FIELDS, describeField, explainCalculation } from '../domain.js';
import { $, make } from './dom.js';

export const labels = Object.fromEntries(
  FIELDS.map(([key, label]) => [key, label.replace('VAT', '부가세').replace('타입', '유형')]),
);
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
    ...(r ? explainCalculation(r) : []).map((text, index) => {
      const item = make('div', undefined, 'calculation-explanation-item');
      item.append(
        make('h4', ['수수료 계산', '부가세 계산', '금액·부호 처리'][index]),
        make('p', text),
      );
      return item;
    }),
  );
}
