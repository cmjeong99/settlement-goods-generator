import { $, make } from './dom.js';
import { FIELDS, display, describeField, NULL_OVERRIDE, NULLABLE_FIELDS } from '../domain.js';
import { proofNodes } from './views.js';
import { createRoundingEditor } from './rounding-editor.js';

export function createDecisionReview({ onDecide, onSetFields }) {
  let source = null,
    draft = null,
    overrides = {},
    errors = [],
    selected = null,
    control = null,
    view = 'field';
  const rounding = createRoundingEditor({
    onApply: onSetFields,
    onClose() {
      $('code-proof').hidden = true;
      selected = null;
    },
  });
  function refresh() {
    if (!selected || !source) return;
    if (view === 'rounding') {
      rounding.sync(draft);
      return;
    }
    const current = draft.fields[selected],
      original = source.fields[selected];
    $('cell-current').textContent = `${display(current)} · ${describeField(selected, current)}`;
    $('cell-edit-error').textContent = errors.join(' ');
    if (document.activeElement !== control) {
      const value = overrides[selected] ?? (original.status === 'known' ? original.value : '');
      control.value = control.tagName === 'INPUT' && value === '__defer__' ? '' : String(value);
    }
  }
  function open(key) {
    if (!source) return;
    selected = key;
    if (/^(FEE|VAT)_SMT_CALC_(?:BASE_DVCD|MHOD_DVCD|UNIT_VAL)$/.test(key)) {
      view = 'rounding';
      rounding.open(key.startsWith('VAT') ? 'VAT' : 'FEE', source, draft);
      return;
    }
    view = 'field';
    delete $('code-proof').dataset.roundingPrefix;
    const [, label, values] = FIELDS.find(([name]) => name === key);
    const original = source.fields[key];
    const panel = $('code-proof');
    panel.replaceChildren();
    const heading = make('div', undefined, 'cell-editor-heading'),
      close = make('button', '닫기', 'text-button');
    close.type = 'button';
    close.onclick = () => {
      panel.hidden = true;
      selected = null;
    };
    heading.append(make('h3', label), close);
    panel.append(heading, make('strong', undefined, 'sr-only'));
    panel.lastElementChild.id = 'cell-current';
    const edit = make('div', undefined, 'cell-edit');
    const wrapper = make('label');
    wrapper.append(make('span', `${label} 설정`, 'sr-only'));
    control = make(values ? 'select' : 'input');
    control.dataset.decisionField = key;
    control.setAttribute('aria-label', `${label} 판단`);
    if (values)
      control.append(
        new Option(
          ['known', 'not-applicable'].includes(original.status)
            ? `수식 도출값 사용 · ${display(original)}`
            : '미확정 · 선택하세요',
          '',
        ),
        ...values.map((value) => new Option(`${describeField(key, { value })} · ${value}`, value)),
        ...(NULLABLE_FIELDS.includes(key) ? [new Option('NULL (미적용)', NULL_OVERRIDE)] : []),
        new Option('판단 보류', '__defer__'),
      );
    else {
      control.inputMode = 'decimal';
      control.maxLength = 120;
      control.placeholder = '0은 1원 단위';
    }
    control.addEventListener(values ? 'change' : 'input', () => onDecide(key, control.value));
    wrapper.append(control);
    edit.append(wrapper);
    const actions = make('div', undefined, 'cell-edit-actions');
    for (const [text, value] of [
      ['원래대로', ''],
      ['판단 보류', '__defer__'],
    ]) {
      const button = make('button', text);
      button.type = 'button';
      button.onclick = () => onDecide(key, value);
      actions.append(button);
    }
    edit.append(actions);
    panel.append(edit);
    const error = make('p', undefined, 'field-error');
    error.id = 'cell-edit-error';
    error.setAttribute('role', 'status');
    panel.append(error);
    const proof = make('details', undefined, 'rounding-proof');
    proof.append(make('summary', '근거'), make('p', original.reason), ...proofNodes(original));
    panel.append(proof);
    panel.hidden = false;
    refresh();
    panel.scrollIntoView({ block: 'nearest' });
  }
  return {
    open,
    render(result, current, changes, settingErrors = []) {
      if (source !== result) {
        selected = null;
        view = 'field';
        $('code-proof').hidden = true;
        $('code-proof').replaceChildren();
      }
      source = result;
      draft = current;
      overrides = changes;
      errors = settingErrors;
      refresh();
    },
  };
}
