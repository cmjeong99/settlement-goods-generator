import { $, make } from './dom.js';
import { PRODUCT_COLUMNS, productTable, exportProductTable } from '../product-table.js';

const statusLabels = {
  inferred: '수식에서 도출',
  context: '입력 기준 반영',
  chosen: '직접 확정',
  pending: '판단 필요',
  unused: '미적용',
  named: '입력 완료',
  empty: '미입력',
};

export function createProductTable({ onSelect }) {
  const head = make('tr'),
    row = make('tr'),
    controls = new Map();
  for (const [key, label] of PRODUCT_COLUMNS) {
    const th = make('th', label);
    th.scope = 'col';
    th.title = key;
    th.append(make('code', key, 'sr-only'));
    head.append(th);
    const td = make('td'),
      button = make('button', undefined, 'product-cell');
    button.type = 'button';
    button.dataset.productField = key;
    const value = make('strong'),
      description = make('small'),
      badge = make('span', undefined, 'product-cell-status');
    button.append(value, description, badge);
    td.append(button);
    row.append(td);
    button.onclick = () => onSelect(key);
    controls.set(key, { td, button, value, description, badge });
  }
  $('result-table').tHead.replaceChildren(head);
  $('result-table').tBodies[0].replaceChildren(row);
  let selected = null,
    current = null;
  $('next-pending').onclick = () => {
    const pending = current?.cells.filter((cell) => cell.status === 'pending') ?? [];
    const index = pending.findIndex((cell) => cell.key === selected);
    if (pending.length) onSelect(pending[(index + 1) % pending.length].key);
  };
  $('edit-calculation').onclick = () => onSelect('FEE_SMT_CALC_MHOD_DVCD');
  return {
    mount(step) {
      $('product-progress').dataset.step = step;
      const slot = $(
        step === 2
          ? 'product-table-test'
          : step === 3
            ? 'product-table-final'
            : 'product-table-review',
      );
      if (slot && $('product-progress').parentElement !== slot) slot.append($('product-progress'));
    },
    select(key) {
      selected = key;
      for (const [name, item] of controls)
        item.button.setAttribute('aria-pressed', String(name === key));
      controls.get(key)?.td.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    },
    render(result, name, trial) {
      const previous = current;
      current = productTable(result, name);
      $('product-progress').hidden = !result;
      const confirmation = `${current.resolved}/12${current.chosen ? ` · 수정 ${current.chosen}` : ''}`;
      if ($('product-confirmation').textContent !== confirmation)
        $('product-confirmation').textContent = confirmation;
      $('product-confirmation').setAttribute(
        'aria-label',
        `설정 ${current.resolved}/12 · 수식 도출 ${current.inferred} · 입력 기준 ${current.context} · 직접 확정 ${current.chosen} · 미확정 ${current.pending} · 미적용 ${current.unused}`,
      );
      $('product-test-state').textContent = {
        untested: '테스트 전',
        stale: '재테스트 필요',
        match: `${trial.count}개 일치`,
        mismatch: '차이 있음',
        unavailable: '비교 불가',
      }[trial.status];
      $('product-test-state').title = trial.text;
      $('product-test-state').dataset.state = trial.status;
      $('next-pending').hidden = current.pending === 0;
      $('next-pending').textContent = `확인 필요 ${current.pending}`;
      for (const cell of current.cells) {
        const item = controls.get(cell.key);
        const prior = previous?.cells.find((c) => c.key === cell.key);
        if (prior?.status === 'pending' && cell.status === 'chosen') {
          item.td.classList.remove('just-confirmed');
          void item.td.offsetWidth;
          item.td.classList.add('just-confirmed');
        }
        item.td.dataset.state = cell.status;
        item.value.textContent = cell.value || '미입력';
        item.description.textContent = cell.description;
        item.description.hidden = ['named', 'empty', 'unused', 'pending'].includes(cell.status);
        item.badge.textContent = ['chosen', 'named'].includes(cell.status) ? '✓' : '';
        item.badge.hidden = !item.badge.textContent;
        item.badge.setAttribute('aria-hidden', 'true');
        item.button.title = `${cell.key} · ${statusLabels[cell.status]}`;
        item.button.disabled = !result;
        item.button.setAttribute(
          'aria-label',
          `${cell.label}: ${cell.value || '미입력'}. ${statusLabels[cell.status]}. 눌러서 근거 확인·수정`,
        );
      }
      $('product-markdown').textContent = result
        ? exportProductTable(result, 'markdown', name)
        : '';
    },
  };
}
