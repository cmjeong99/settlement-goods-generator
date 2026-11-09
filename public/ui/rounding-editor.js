import { $, make } from './dom.js';
import {
  ROUNDING_METHODS,
  ROUNDING_UNITS,
  readRoundingPolicy,
  roundingChanges,
  roundingPreview,
  unitCode,
} from '../rounding-policy.js';
import { proofNodes } from './views.js';

export function createRoundingEditor({ onApply, onClose }) {
  let prefix = 'FEE',
    original = null,
    draft = null,
    policy = null,
    signature = '',
    refs = null,
    sample = '148.5',
    unitError = false;
  function update() {
    for (const [value, button] of refs.methods)
      button.setAttribute('aria-pressed', String(policy.method === value));
    for (const [value, button] of refs.units) {
      button.setAttribute('aria-pressed', String(policy.unit === value));
      button.disabled = policy.method === 'NONE';
    }
    for (const [value, button] of refs.bases)
      button.setAttribute('aria-pressed', String(policy.base === value));
    refs.custom.disabled = policy.method === 'NONE';
    refs.unitRow.hidden = policy.method === 'NONE';
    refs.custom.setAttribute('aria-invalid', String(unitError && policy.method !== 'NONE'));
    if (policy.method === 'NONE') refs.error.textContent = '';
    else if (unitError) refs.error.textContent = '단위를 0보다 큰 금액으로 입력해 주세요.';
    const method =
      {
        DOWN: '절사해요',
        HALF_UP: '반올림해요',
        CEILING: '올려요',
        HALF_DOWN: '절반이면 버려요',
        SIGNED_DOWN: '음수도 아래로 내려요',
      }[policy.method] || '처리 방식을 선택하세요';
    const unit =
      policy.unit === null ? '단위 미선택' : `${policy.unit === 0 ? 1 : policy.unit}원 단위`;
    refs.sentence.textContent = `${prefix === 'FEE' ? '수수료' : '부가세'}: ${policy.base === 'SUM' ? '합산 후 계산' : policy.base === 'EACH' ? '건별 계산' : '계산 기준 미확정'} · ${policy.method === 'NONE' ? '단수 처리 안 함' : `${unit}로 ${method}`}`;
    refs.note.hidden = !(prefix === 'VAT' && draft.fields.VAT_DVCD?.value === 'ZERO');
    refs.note.textContent = '부가세 0원 · 단수 처리 미적용';
    try {
      const preview = roundingPreview(policy, sample);
      refs.positive.textContent = preview?.positive ?? '—';
      refs.negative.textContent = preview?.negative ?? '—';
    } catch {
      refs.positive.textContent = refs.negative.textContent = '예시 금액을 확인하세요';
    }
    refs.apply.disabled =
      !Object.keys(roundingChanges(draft.fields, prefix, policy)).length ||
      (unitError && policy.method !== 'NONE') ||
      !!(policy.method && policy.method !== 'NONE' && policy.unit === null);
  }
  function open(nextPrefix, source, current) {
    prefix = nextPrefix;
    original = source;
    draft = current;
    policy = readRoundingPolicy(draft.fields, prefix);
    signature = JSON.stringify(policy);
    unitError = false;
    const panel = $('code-proof');
    panel.replaceChildren();
    panel.hidden = false;
    panel.dataset.roundingPrefix = prefix;
    const header = make('div', undefined, 'cell-editor-heading'),
      close = make('button', '닫기', 'text-button');
    close.type = 'button';
    close.onclick = onClose;
    header.append(make('h3', '계산 방식', 'sr-only'));
    panel.append(header);
    const tabs = make('div', undefined, 'rounding-tabs');
    for (const [key, label] of [
      ['FEE', '수수료'],
      ['VAT', '부가세'],
    ]) {
      const button = make('button', label);
      button.type = 'button';
      button.setAttribute('aria-pressed', String(prefix === key));
      button.onclick = () => open(key, original, draft);
      tabs.append(button);
    }
    header.append(tabs, close);
    refs = { methods: [], units: [], bases: [] };
    const group = (title) => {
      const field = make('fieldset', undefined, 'rounding-row'),
        choices = make('div', undefined, 'rounding-options'),
        label = make('span', title, 'rounding-label');
      label.setAttribute('aria-hidden', 'true');
      field.append(make('legend', title, 'sr-only'), label, choices);
      panel.append(field);
      return choices;
    };
    const bases = group('기준');
    for (const [value, label] of [
      ['EACH', '건별'],
      ['SUM', '합산 후'],
    ]) {
      const button = make('button', label);
      button.type = 'button';
      button.dataset.roundingBase = value;
      button.onclick = () => {
        policy.base = value;
        refs.error.textContent = '';
        update();
      };
      refs.bases.push([value, button]);
      bases.append(button);
    }
    const methods = group('방식'),
      advanced = make('details', undefined, 'rounding-advanced');
    advanced.open = ['HALF_DOWN', 'SIGNED_DOWN'].includes(policy.method);
    advanced.append(make('summary', '기타'));
    const extra = make('div');
    advanced.append(extra);
    ROUNDING_METHODS.forEach(([value, label], index) => {
      const button = make('button', label);
      button.type = 'button';
      button.dataset.roundingMethod = value;
      button.onclick = () => {
        policy.method = value;
        refs.error.textContent = '';
        update();
      };
      refs.methods.push([value, button]);
      (index < 4 ? methods : extra).append(button);
    });
    methods.append(advanced);
    const units = group('단위');
    refs.unitRow = units.parentElement;
    for (const [value, label] of ROUNDING_UNITS) {
      const button = make('button', label);
      button.type = 'button';
      button.dataset.roundingUnit = value;
      button.onclick = () => {
        policy.unit = value;
        unitError = false;
        refs.custom.value = value === 0 ? '1' : String(value);
        refs.error.textContent = '';
        update();
      };
      refs.units.push([value, button]);
      units.append(button);
    }
    const customDetails = make('details', undefined, 'rounding-custom-details'),
      custom = make('label', undefined, 'rounding-custom');
    customDetails.open =
      policy.unit !== null && !ROUNDING_UNITS.some(([value]) => value === policy.unit);
    customDetails.append(make('summary', '직접 입력'));
    custom.append(make('span', '원'));
    refs.custom = make('input');
    refs.custom.inputMode = 'decimal';
    refs.custom.maxLength = 120;
    refs.custom.value = policy.unit === null ? '' : String(policy.unit === 0 ? 1 : policy.unit);
    refs.custom.setAttribute('aria-label', '처리 단위 직접 지정');
    refs.custom.oninput = () => {
      try {
        policy.unit = unitCode(refs.custom.value);
        unitError = false;
        refs.error.textContent = '';
      } catch (error) {
        unitError = true;
        policy.unit = null;
        refs.error.textContent = error.message;
      }
      update();
    };
    custom.prepend(refs.custom);
    customDetails.append(custom);
    units.append(customDetails);
    refs.sentence = make('p', undefined, 'sr-only');
    panel.append(refs.sentence);
    const preview = make('div', undefined, 'rounding-preview'),
      input = make('input');
    input.inputMode = 'decimal';
    input.value = sample;
    input.setAttribute('aria-label', '단수 처리 예시 금액');
    input.maxLength = 120;
    input.oninput = () => {
      sample = input.value;
      update();
    };
    const label = make('label', '단수 처리 예시');
    label.append(input);
    preview.append(label);
    refs.positive = make('strong');
    refs.negative = make('strong');
    const positive = make('p', '양수 '),
      negative = make('p', '음수 ');
    positive.append(refs.positive);
    negative.append(refs.negative);
    preview.append(positive, negative);
    panel.append(preview);
    refs.note = make('p', undefined, 'rounding-note');
    panel.append(refs.note);
    refs.error = make('p', undefined, 'field-error');
    refs.error.setAttribute('role', 'status');
    panel.append(refs.error);
    refs.apply = make('button', '적용', 'primary');
    refs.apply.type = 'button';
    refs.apply.id = 'rounding-apply';
    refs.apply.onclick = () => {
      onApply(roundingChanges(draft.fields, prefix, policy));
      refs.error.textContent = '적용됨';
      update();
    };
    panel.append(refs.apply);
    const evidence = make('details', undefined, 'rounding-proof');
    evidence.append(
      make('summary', '근거'),
      ...(original.fields[`${prefix}_SMT_CALC_BASE_DVCD`]?.source === 'context'
        ? [make('p', original.fields[`${prefix}_SMT_CALC_BASE_DVCD`].reason)]
        : []),
      make('p', '절댓값·부호 적용을 제외한 단수 처리 예시입니다. 1원 단위의 상품 코드는 0입니다.'),
      ...proofNodes(original.fields[`${prefix}_SMT_CALC_MHOD_DVCD`]),
    );
    panel.append(evidence);
    update();
    panel.scrollIntoView({ block: 'nearest' });
  }
  return {
    open,
    sync(current) {
      if (!refs || !current) return;
      draft = current;
      const next = readRoundingPolicy(current.fields, prefix),
        nextSignature = JSON.stringify(next);
      if (signature !== nextSignature) {
        policy = next;
        unitError = false;
        signature = nextSignature;
        refs.custom.value = policy.unit === null ? '' : String(policy.unit === 0 ? 1 : policy.unit);
        update();
      }
    },
  };
}
