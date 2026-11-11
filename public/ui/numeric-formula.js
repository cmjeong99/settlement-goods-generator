import { make } from './dom.js';

const roundingNames = {
  NONE: '단수 처리 없음',
  DOWN: '절사',
  HALF_UP: '반올림',
  CEILING: '올림',
  HALF_DOWN: '절반이면 버림',
  SIGNED_DOWN: '음수도 작은 쪽으로 내림',
};

function token(text, kind, title) {
  const node = make('span', text, `formula-${kind}`);
  if (title) node.title = title;
  return node;
}

const operator = (text) => token(text, 'operator');
const number = (value, kind = 'input', title) => token(value, kind, title);
const equality = (value) => operator(value.includes('…') ? ' ≈ ' : ' = ');

function terms(root, values, title) {
  // Keep large aggregate expressions readable; the total still uses every input.
  values.slice(0, 4).forEach((value, index) => {
    if (index) root.append(operator(' + '));
    const negative = index > 0 && value.startsWith('-');
    if (negative) root.append(operator('('));
    root.append(number(value, 'input', title));
    if (negative) root.append(operator(')'));
  });
  if (values.length > 4) {
    const more = token(` + … (${values.length}개 합산)`, 'operator');
    more.title = values.join(' + ');
    root.append(more);
  }
}

function adjustmentLabel(step) {
  return step.kind === 'sign'
    ? '부호 적용'
    : step.kind === 'minimum'
      ? '최소 수수료'
      : roundingNames[step.method] || step.method;
}

export function numericStep(step, { compact = false } = {}) {
  const root = make('div', undefined, 'numeric-formula');
  const code = make('code', undefined, 'formula-equation');
  if (step.expression) {
    for (const item of step.expression) code.append(token(item.text, item.kind));
  } else {
    const absolute = step.absolute && step.inputTotal.startsWith('-');
    if (absolute) code.append(token('ABS', 'function', '절댓값'), operator('('));
    else if (step.inputs.length > 1) code.append(operator('('));
    terms(code, step.inputs, step.basis);
    if (absolute || step.inputs.length > 1) code.append(operator(')'));
    code.append(
      operator(' × '),
      number(step.multiplier, 'rate', step.basis === '과금건수' ? '단가' : '요율'),
    );
  }
  const changes = step.adjustments.filter((item) => item.input !== item.result);
  code.append(equality(step.raw), number(step.raw, changes.length ? 'intermediate' : 'result'));
  changes.forEach((item, index) => {
    code.append(
      operator(' → '),
      token(`${adjustmentLabel(item)} `, 'adjustment'),
      number(item.result, index === changes.length - 1 ? 'result' : 'intermediate'),
    );
  });
  root.append(code);
  if (!compact) {
    const notes = step.adjustments.map((item) =>
      item.kind === 'sign'
        ? `부호는 단수 처리 ${item.position === 'BEFORE' ? '전' : '후'}에 적용`
        : item.kind === 'minimum'
          ? '최소 수수료 적용'
          : item.method === 'NONE'
            ? roundingNames.NONE
            : `${item.unit}원 단위 ${adjustmentLabel(item)}`,
    );
    root.append(make('small', [step.basis, ...notes].join(' · '), 'formula-note'));
  }
  return root;
}

export function numericTotal(steps, total, { compact = false } = {}) {
  if (steps.length === 1) return numericStep(steps[0], { compact });
  const root = make('div', undefined, 'numeric-formula');
  const code = make('code', undefined, 'formula-equation');
  if (!steps.length) {
    code.append(token('면세', 'operator'), equality(total), number(total, 'result'));
  } else {
    terms(
      code,
      steps.map((step) => step.result),
      '각 계산 단위의 결과',
    );
    code.append(equality(total), number(total, 'result'));
  }
  root.append(code);
  return root;
}

export function numericPayout(breakdown) {
  const root = make('div', undefined, 'numeric-formula');
  const code = make('code', undefined, 'formula-equation');
  code.append(number(breakdown.amount, 'input', '거래금액 합계'));
  for (const [key, label] of [
    ['fee', '수수료'],
    ['vat', '부가세'],
  ]) {
    code.append(operator(' − '));
    const negative = breakdown[key].startsWith('-');
    if (negative) code.append(operator('('));
    code.append(number(breakdown[key], 'input', label));
    if (negative) code.append(operator(')'));
  }
  code.append(equality(breakdown.payout), number(breakdown.payout, 'result'));
  root.append(code);
  return root;
}

export function numericBreakdown(breakdown, { payout = false, metrics = null } = {}) {
  const root = make('div', undefined, 'numeric-breakdown');
  function metricSection(key, label) {
    const section = make('section', undefined, 'numeric-breakdown-metric');
    section.append(make('h4', label), make('strong', breakdown[key], 'numeric-metric-value'));
    const metric = metrics?.[key];
    if (metric) {
      section.dataset.comparison =
        metric.match === null ? 'unavailable' : metric.match ? 'match' : 'mismatch';
      section.append(
        make(
          'p',
          metric.asis === ''
            ? '기존 금액 없음 · 비교 제외'
            : `기존 ${metric.asis} · ${metric.match ? '일치' : `차이 ${metric.difference}`}`,
          'numeric-metric-comparison',
        ),
      );
    }
    root.append(section);
    return section;
  }
  for (const [key, label] of [
    ['fee', '수수료'],
    ['vat', '부가세'],
  ]) {
    const section = metricSection(key, label);
    const steps = breakdown.steps[key];
    if (steps.length > 1) {
      section.append(numericTotal(steps, breakdown[key]));
      const detail = make(steps.length > 5 ? 'details' : 'div', undefined, 'numeric-unit-steps');
      detail.append(
        make(steps.length > 5 ? 'summary' : 'p', `건별 계산 ${steps.length}건`, 'formula-note'),
      );
      for (const [index, step] of steps.entries()) {
        const item = numericStep(step, { compact: true });
        item.prepend(make('small', `${index + 1}번째 계산`, 'formula-note'));
        detail.append(item);
      }
      section.append(detail);
    } else if (steps.length) section.append(numericStep(steps[0], { compact: true }));
    else section.append(numericTotal(steps, breakdown[key]));
  }
  if (payout) {
    metricSection('payout', '지급액').append(numericPayout(breakdown));
  }
  if (breakdown.preparation?.length) {
    const preparation = make('section', undefined, 'numeric-preparation');
    preparation.append(make('h4', '계산 순서'));
    for (const step of breakdown.preparation) {
      preparation.append(
        make('p', step.label, 'formula-note'),
        numericStep(step, { compact: true }),
      );
    }
    root.append(preparation);
  }
  return root;
}
