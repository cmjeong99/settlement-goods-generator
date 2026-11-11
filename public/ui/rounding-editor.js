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
import { NULL_OVERRIDE, NULLABLE_FIELDS } from '../domain.js';
import { roundingUnit, roundingUnitLabel } from '../calculation/rounding-unit.js';

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
    const noRounding = ['NONE', NULL_OVERRIDE].includes(policy.method);
    for (const [value, button] of refs.methods)
      button.setAttribute('aria-pressed', String(policy.method === value));
    for (const [value, button] of refs.units) {
      button.setAttribute('aria-pressed', String(policy.unit === value));
      button.disabled = noRounding && value !== NULL_OVERRIDE;
      button.hidden = noRounding && value !== NULL_OVERRIDE;
    }
    for (const [value, button] of refs.bases)
      button.setAttribute('aria-pressed', String(policy.base === value));
    refs.custom.disabled = noRounding;
    refs.customDetails.hidden = noRounding;
    refs.custom.setAttribute('aria-invalid', String(unitError && !noRounding));
    refs.error.textContent =
      unitError && !noRounding ? '단위를 0보다 큰 금액으로 입력해 주세요.' : '';
    refs.feedback.textContent = '';
    const method =
      {
        DOWN: '절사해요',
        HALF_UP: '반올림해요',
        CEILING: '올려요',
        HALF_DOWN: '절반이면 버려요',
        SIGNED_DOWN: '음수도 아래로 내려요',
        [NULL_OVERRIDE]: 'NULL(미적용)',
      }[policy.method] || '처리 방식을 선택하세요';
    const unit =
      policy.unit === NULL_OVERRIDE
        ? '단위 NULL (배치 기본 1원)'
        : policy.unit === null
          ? '단위 미선택'
          : roundingUnitLabel(policy.unit);
    const baseLabel =
      policy.base === NULL_OVERRIDE
        ? '계산 기준 NULL(미적용)'
        : policy.base === 'SUM'
          ? '합산 후 계산'
          : policy.base === 'EACH'
            ? '건별 계산'
            : '계산 기준 미확정';
    const methodLabel =
      policy.method === NULL_OVERRIDE
        ? '반올림·절사 방식 NULL(미적용)'
        : policy.method === 'NONE'
          ? '단수 처리 안 함'
          : `${unit}로 ${method}`;
    refs.sentence.textContent = `${prefix === 'FEE' ? '수수료' : '부가세'}: ${baseLabel} · ${methodLabel}`;
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
      (unitError && !noRounding) ||
      !!(policy.method && !noRounding && policy.unit === null);
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
    const nullChoice = (property, suffix, choices, buttons) => {
      const key = `${prefix}_SMT_CALC_${suffix}`;
      if (!NULLABLE_FIELDS.includes(key)) return;
      const button = make('button', 'NULL (미적용)');
      button.type = 'button';
      button.dataset.nullField = key;
      button.onclick = () => {
        policy[property] = NULL_OVERRIDE;
        if (property === 'unit') {
          unitError = false;
          refs.custom.value = '';
        }
        update();
      };
      buttons.push([NULL_OVERRIDE, button]);
      choices.append(button);
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
    nullChoice('base', 'BASE_DVCD', bases, refs.bases);
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
    nullChoice('method', 'MHOD_DVCD', methods, refs.methods);
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
        refs.custom.value = roundingUnit(value).toString();
        refs.error.textContent = '';
        update();
      };
      refs.units.push([value, button]);
      units.append(button);
    }
    nullChoice('unit', 'UNIT_VAL', units, refs.units);
    const customDetails = make('details', undefined, 'rounding-custom-details'),
      custom = make('label', undefined, 'rounding-custom');
    customDetails.open =
      ![null, NULL_OVERRIDE].includes(policy.unit) &&
      !ROUNDING_UNITS.some(([value]) => value === policy.unit);
    refs.customDetails = customDetails;
    customDetails.append(make('summary', '직접 입력'));
    custom.append(make('span', '원'));
    refs.custom = make('input');
    refs.custom.inputMode = 'decimal';
    refs.custom.maxLength = 120;
    refs.custom.value = [null, NULL_OVERRIDE].includes(policy.unit)
      ? ''
      : Math.abs(policy.unit) <= 38
        ? roundingUnit(policy.unit).toString()
        : '';
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
    refs.feedback = make('p', undefined, 'rounding-feedback');
    refs.feedback.setAttribute('role', 'status');
    panel.append(refs.feedback);
    refs.apply = make('button', '적용', 'primary');
    refs.apply.type = 'button';
    refs.apply.id = 'rounding-apply';
    refs.apply.onclick = () => {
      onApply(roundingChanges(draft.fields, prefix, policy));
      update();
      refs.feedback.textContent = '설정에 반영했어요.';
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
        refs.custom.value = [null, NULL_OVERRIDE].includes(policy.unit)
          ? ''
          : String(policy.unit === 0 ? 1 : policy.unit);
        update();
      }
    },
  };
}
