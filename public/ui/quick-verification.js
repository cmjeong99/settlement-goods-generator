import { $, make } from './dom.js';
import {
  compareSample,
  sampleRate,
  suggestSampleColumns,
} from '../calculation/sample-verification.js';
import { cleanNumber } from '../calculation/asis-data.js';
import { quickDashboard } from '../calculation/dashboard.js';
import { createDashboard } from './dashboard.js';
import { currentProductContext, commonCalculationErrors } from '../calculation/product-context.js';
import {
  rememberSample,
  sampleTestState,
  SAMPLE_HISTORY_LIMIT,
} from '../calculation/sample-session.js';

export function verificationProduct(result, dbProduct, context) {
  if (!result) return null;
  return {
    ...currentProductContext(dbProduct, context),
    code: dbProduct ? `DRAFT-${dbProduct.code}` : 'CURRENT-ANALYSIS',
    source: 'draft',
    expected: Object.fromEntries(
      Object.entries(result.fields).map(([key, field]) => [
        key,
        field.status === 'known' ? field.value : null,
      ]),
    ),
  };
}

export function createQuickVerification({ onContinue, onSummary, onReport }) {
  const dashboard = createDashboard($('quick-dashboard'));
  let source = null,
    draft = null,
    product = null,
    signature = '',
    settingErrors = [],
    history = [],
    dirty = false;
  let state = { status: 'untested', count: 0, text: '테스트 전' };
  let columns = { columns: [] },
    sourceControls = [],
    manual = new Map(),
    sourceCount = 0;
  const fixed = () => product?.expected.FEE_TYPE_DVCD === 'FIXED';
  const inputRows = () =>
    [$('quick-amount').value, $('quick-second-amount').value]
      .filter((value, index) => index === 0 || value.trim())
      .map((amount) => ({
        amount: cleanNumber(amount),
        targetAmount: cleanNumber($('quick-target').value),
        count: cleanNumber($('quick-count').value) || '1',
      }));
  function publish() {
    onReport(state);
    onSummary(state.text);
  }
  function syncActions() {
    const ready =
      !!product &&
      !settingErrors.length &&
      !!$('quick-amount').value.trim() &&
      !!$('quick-rate').value.trim();
    $('quick-run').disabled = $('quick-calculator').disabled = !ready;
  }
  function defaultValue(column, row) {
    if (column === columns.amount) return row.amount;
    if (column === columns.count) return row.count;
    if (column === columns.rate) {
      try {
        return sampleRate($('quick-rate').value, fixed());
      } catch {
        return '';
      }
    }
    return '';
  }
  function syncSourceInputs() {
    let rows;
    try {
      rows = inputRows();
    } catch {
      rows = [{ amount: '', count: '1' }];
    }
    if (
      sourceCount !== rows.length ||
      sourceControls.length !== rows.length * columns.columns.length
    ) {
      sourceControls = [];
      $('quick-source-inputs').replaceChildren(
        ...rows.map((row, index) => {
          const group = make('fieldset');
          group.append(make('legend', `${index + 1}행 원문 입력값`));
          const grid = make('div', undefined, 'quick-source-fields');
          group.append(grid);
          for (const column of columns.columns) {
            const label = make('label'),
              input = make('input'),
              key = `${index}:${column}`;
            input.maxLength = 120;
            input.dataset.sourceColumn = column;
            input.dataset.sourceIndex = index;
            input.setAttribute('aria-label', `${index + 1}행 원문 ${column}`);
            if (manual.has(key)) input.value = manual.get(key);
            const binding = make('small', undefined, 'source-binding');
            label.append(make('span', column), input, binding);
            grid.append(label);
            sourceControls.push({ input, column, index, key, binding });
          }
          return group;
        }),
      );
      sourceCount = rows.length;
    }
    for (const item of sourceControls) {
      if (!manual.has(item.key)) item.input.value = defaultValue(item.column, rows[item.index]);
      const linked = [columns.amount, columns.rate, columns.count].includes(item.column);
      item.binding.textContent = manual.has(item.key)
        ? '직접 입력값'
        : linked
          ? '자동 연결'
          : '직접 입력 필요';
      item.input.placeholder = item.input.value ? '' : '원문에 대입할 값 또는 NULL';
    }
    $('quick-source-reset').disabled = !sourceControls.some(
      (item) =>
        manual.has(item.key) && [columns.amount, columns.rate, columns.count].includes(item.column),
    );
    if (
      sourceControls.some(
        (item) =>
          !item.input.value.trim() &&
          ![columns.amount, columns.rate, columns.count].includes(item.column),
      )
    ) {
      $('quick-source-panel').open = true;
      $('quick-options').open = true;
    }
    $('quick-bindings').textContent = sourceControls.length
      ? sourceControls
          .slice(0, columns.columns.length)
          .map((item) => `${item.column} = ${item.input.value || '입력 필요'}`)
          .join(' · ')
      : '원문에 입력할 컬럼이 없어요.';
  }
  function invalidateCurrent({ inputChanged = false } = {}) {
    dashboard.update(null);
    $('quick-results').hidden = true;
    $('quick-status').textContent = settingErrors.join(' ');
    syncActions();
    if (inputChanged) {
      dirty = history.length > 0 || dirty;
      updateReportState();
      publish();
    }
  }
  function renderHistory() {
    $('quick-history').replaceChildren(
      ...history.map((record, index) => {
        const detail = make('details'),
          summary = make(
            'summary',
            `${index + 1}. 금액 ${record.amounts.join(', ')} / 요율·단가 ${record.rate} — ${record.status === 'match' ? '원문과 일치' : record.status === 'mismatch' ? '차이 있음' : '비교 불가'}`,
          );
        detail.append(summary, make('pre', JSON.stringify(record.sourceRows, null, 2)));
        for (const metric of record.metrics)
          detail.append(
            make(
              'p',
              `${metric.key === 'fee' ? '수수료' : '부가세'}: 원문 ${metric.original || '비교 불가'} / 내 상품 ${metric.calculated || '비교 불가'}${metric.expected !== '' ? ` / 기대값 ${metric.expected}` : ''}`,
            ),
          );
        const remove = make('button', '이 예시 기록 제외');
        remove.onclick = () => {
          history = history.filter((item) => item !== record);
          updateReportState();
          renderHistory();
          publish();
          const next = $('quick-history').children[Math.min(index, history.length - 1)];
          (next?.querySelector('summary') || $('quick-amount')).focus();
        };
        detail.append(remove);
        return detail;
      }),
    );
    $('quick-history-wrap').hidden = !history.length;
  }
  function updateReportState() {
    state = sampleTestState(history, { dirty });
  }
  $('quick-form').addEventListener('input', (event) => {
    if (event.target.dataset.sourceColumn)
      manual.set(
        `${event.target.dataset.sourceIndex}:${event.target.dataset.sourceColumn}`,
        event.target.value,
      );
    syncSourceInputs();
    invalidateCurrent({ inputChanged: true });
  });
  $('quick-source-reset').onclick = () => {
    for (const item of sourceControls)
      if ([columns.amount, columns.rate, columns.count].includes(item.column))
        manual.delete(item.key);
    syncSourceInputs();
    invalidateCurrent({ inputChanged: true });
  };
  $('quick-form').onsubmit = (event) => {
    event.preventDefault();
    try {
      if (settingErrors.length) throw new Error(settingErrors.join(' '));
      const rows = inputRows(),
        feeValue = sampleRate($('quick-rate').value, fixed());
      const sourceRows = rows.map(() => ({}));
      for (const item of sourceControls) {
        if (!item.input.value.trim())
          throw new Error(
            `원문 ${item.column}의 ${item.index + 1}행 값을 입력해 주세요. NULL도 직접 지정할 수 있어요.`,
          );
        sourceRows[item.index][item.column] = item.input.value.trim();
      }
      const expected = { fee: $('quick-fee').value, vat: $('quick-vat').value };
      const report = compareSample(source, draft, {
        rows,
        sourceRows,
        feeValue,
        engine: product.engine,
        contextErrors: commonCalculationErrors(product),
        expected,
      });
      const table = make('table'),
        head = make('thead'),
        body = make('tbody'),
        tr = make('tr');
      for (const label of ['항목', '원문 수식', '내 상품', '차이', '판정'])
        tr.append(make('th', label));
      head.append(tr);
      table.append(head, body);
      for (const metric of report.metrics) {
        const row = make('tr');
        row.dataset.match = String(metric.match);
        for (const value of [
          metric.key === 'fee' ? '수수료' : '부가세',
          metric.original || '계산 불가',
          metric.calculated || '계산 불가',
          metric.difference || '—',
          metric.match === null ? '비교 불가' : metric.match ? '일치' : '차이 있음',
        ])
          row.append(make('td', value));
        body.append(row);
      }
      const scroll = make('div', undefined, 'table-scroll');
      scroll.append(table);
      $('quick-results').replaceChildren(scroll);
      for (const metric of report.metrics.filter((item) => item.expected !== ''))
        $('quick-results').append(
          make(
            'p',
            `${metric.key === 'fee' ? '수수료' : '부가세'} 기대값 ${metric.expected} · ${metric.expectedMatch === null ? '비교 불가' : metric.expectedMatch ? '내 상품과 일치' : '내 상품과 차이 있음'}`,
          ),
        );
      const breakdown = make('details', undefined, 'sample-breakdown');
      breakdown.append(make('summary', '계산 과정'));
      const b = report.breakdown;
      if (b)
        breakdown.append(
          make(
            'p',
            `내 상품 계산: 수수료 ${b.rawFee} → ${b.fee}, 부가세 ${b.rawVat} → ${b.vat} (부호·단수 처리 전 → 후)`,
          ),
        );
      if (
        b &&
        product.settlement?.paymentMethod === 'PAYOUT' &&
        product.settlement?.feeCollection === 'PRE'
      )
        breakdown.append(
          make('p', `상품 지급액: ${b.amount} − (${b.fee}) − (${b.vat}) = ${b.payout}`),
        );
      if (b) $('quick-results').append(breakdown);
      $('quick-results').hidden = false;
      dashboard.update(quickDashboard(report, rows, product));
      $('quick-status').textContent = report.errors.join(' ');
      history = rememberSample(history, {
        input: { rows, sourceRows, feeValue, expected },
        status: report.status,
        amounts: rows.map((row) => row.amount),
        rate: $('quick-rate').value,
        sourceRows,
        metrics: report.metrics,
      });
      dirty = false;
      if (history.length === SAMPLE_HISTORY_LIMIT)
        $('quick-status').textContent += ` 예시 기록 ${SAMPLE_HISTORY_LIMIT}개를 보관 중이에요.`;
      updateReportState();
      renderHistory();
      publish();
    } catch (error) {
      invalidateCurrent({ inputChanged: true });
      $('quick-status').textContent = error.message;
    }
  };
  for (const [id, amount] of [
    ['quick-approval', '9900'],
    ['quick-cancel', '-9900'],
  ])
    $(id).onclick = () => {
      $('quick-amount').value = amount;
      $('quick-second-amount').value = '';
      if (!$('quick-rate').value.trim()) $('quick-rate').value = fixed() ? '100' : '1.5%';
      manual.clear();
      syncSourceInputs();
      invalidateCurrent({ inputChanged: true });
    };
  $('quick-history-clear').onclick = () => {
    history = [];
    dirty = false;
    state = { status: 'untested', count: 0, text: '테스트 전' };
    renderHistory();
    invalidateCurrent();
    publish();
    $('quick-amount').focus();
  };
  $('quick-calculator').onclick = () => {
    try {
      const rows = inputRows();
      onContinue(
        product,
        rows.map((row, index) => ({
          ...row,
          feeValue: $('quick-rate').value,
          asisFee: rows.length === 1 ? $('quick-fee').value : '',
          asisVat: rows.length === 1 ? $('quick-vat').value : '',
          asisPayout: '',
          sourceRow: index + 1,
        })),
      );
    } catch (error) {
      $('quick-status').textContent = error.message;
    }
  };
  return {
    get state() {
      return state;
    },
    get history() {
      return structuredClone(history);
    },
    setResult(result, currentDraft, dbProduct, errors = [], context) {
      const next = verificationProduct(currentDraft, dbProduct, context);
      const nextSignature = JSON.stringify([
        result?.formulas,
        next?.expected,
        next?.engine,
        next?.settlement,
        commonCalculationErrors(next),
        errors,
      ]);
      product = next;
      dashboard.setTitle(next?.name);
      if (source === result && signature === nextSignature) return;
      const changed = history.length > 0 || state.status === 'stale',
        newSource = source !== result;
      source = result;
      draft = currentDraft;
      signature = nextSignature;
      settingErrors = errors;
      history = [];
      dirty = !newSource && changed;
      updateReportState();
      if (newSource && !context?.preserveSourceInputs) {
        $('quick-options').open = false;
        $('quick-source-panel').open = false;
        manual.clear();
        sourceControls = [];
        sourceCount = 0;
      }
      columns = source ? suggestSampleColumns(source) : { columns: [] };
      $('quick-source-panel').hidden = !columns.columns.length;
      $('quick-rate-label').textContent = fixed() ? '단가' : '요율';
      $('quick-count-wrap').hidden = !fixed() && !columns.count;
      $('quick-rate').placeholder = fixed() ? '예: 100' : '예: 1.5% 또는 0.015';
      $('quick-product').textContent = source
        ? '2단계에서 판단한 설정으로 원문 수식과 내 상품을 비교해요.'
        : '수식을 먼저 분석해 주세요.';
      syncSourceInputs();
      renderHistory();
      invalidateCurrent();
      publish();
    },
  };
}
