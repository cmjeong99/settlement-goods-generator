import { analyze } from './analyzer.js';
import { FIELDS, explainCalculation } from './domain.js';
import { exportProductTable, productInsertErrors } from './product-table.js';
import { EXAMPLES } from './examples.js';
import { suggestNames } from './naming.js';
import { $, make, observeTableOverflow } from './ui/dom.js';
import { renderExplanation } from './ui/views.js';
import { productByCode } from './catalog.js';
import { populateExamples, renderProductContext } from './ui/catalog.js';
import { createVerification } from './ui/verification.js';
import { createWorkflow } from './ui/workflow.js';
import { createQuickVerification } from './ui/quick-verification.js';
import { createFinalProduct } from './ui/final-product.js';
import { createDecisionReview } from './ui/decision-review.js';
import { createProductTable } from './ui/product-table.js';
import { createHistory } from './ui/history.js';
import { createSqlEditor } from './ui/sql-editor.js';
import { renderWorkspaceSummary } from './ui/workspace-summary.js';

const syncTableOverflow = observeTableOverflow();
const sqlEditor = createSqlEditor({ onMessage: message });
const workflow = createWorkflow({
  onStepChange(step) {
    progressTable.mount(step);
  },
});
const verification = createVerification();
const productHistory = createHistory();
const finalProduct = createFinalProduct({
  onChange(kind) {
    workflow.setSummary(3, '수정됨');
    namingError = '';
    if (kind !== 'identity') $('names-panel').hidden = true;
    syncDraft();
    syncActions();
  },
});
const quickVerification = createQuickVerification({
  onContinue(product, row) {
    verification.loadInput(product, row);
    workflow.openCalculator();
  },
  onSummary(text) {
    workflow.setSummary(2, text);
  },
  onReport() {
    finalProduct.clearCelebration();
    renderReadiness();
  },
});
const decisions = createDecisionReview({
  onDecide(key, value) {
    finalProduct.setField(key, value);
  },
  onSetFields(changes) {
    finalProduct.setFields(changes);
  },
});
const progressTable = createProductTable({ onSelect: evidence });
let results = [];
let index = 0;
let namingError = '';
const base = () => results[index];
const columns = () => ({
  feeColumn: $('fee-column').value,
  vatColumn: $('vat-column').value,
  inputScope: $('input-scope').value,
});
const needsAttention = (cell) => ['unknown', 'custom'].includes(cell.status);
function message(text, kind = 'info') {
  $('message').textContent = text;
  $('message').dataset.kind = kind;
}
function pendingFields() {
  const result = finalProduct.draft().result;
  return result ? FIELDS.filter(([key]) => needsAttention(result.fields[key])) : [];
}
function completedProduct() {
  const draft = finalProduct.draft();
  return (
    !draft.errors.length &&
    !!draft.name?.code &&
    !!draft.name?.name &&
    !pendingFields().length &&
    quickVerification.state.status === 'match'
  );
}
function renderReadiness() {
  const pending = pendingFields(),
    state = quickVerification.state;
  $('final-test-status').textContent =
    `${pending.length ? `미확정 ${pending.length}개 · ` : ''}${state.text}`;
  $('tsv').textContent = '엑셀 복사';
  $('markdown').textContent = 'Markdown 복사';
  const draft = finalProduct.draft();
  progressTable.render(draft.result, draft.name, state);
  renderWorkspaceSummary(draft.result, draft.name, state, draft.settingErrors);
  syncTableOverflow();
}
function syncDraft() {
  const r = base(),
    draft = finalProduct.draft();
  renderExplanation(draft.result);
  if (r && draft.result) {
    $('final-understanding').replaceChildren(
      ...explainCalculation(draft.result).map((text) => make('p', text)),
    );
  } else $('final-understanding').replaceChildren();
  decisions.render(r, draft.result, finalProduct.overrides, draft.settingErrors);
  quickVerification.setResult(
    r,
    draft.result,
    productByCode.get($('example').value),
    draft.settingErrors,
    { registration: draft.registration, identity: draft.name },
  );
  renderReadiness();
}
function syncActions() {
  const r = base(),
    usable = r && Object.values(r.fields).some((c) => c.status !== 'unknown');
  $('analyze').disabled = !$('sql').value.trim();
  const draft = finalProduct.draft();
  $('markdown').disabled = $('tsv').disabled = !r || draft.errors.length > 0;
  const insertErrors = productInsertErrors(draft.result, draft.name, draft.registration);
  $('copy-insert').disabled = !r || draft.errors.length > 0 || insertErrors.length > 0;
  $('copy-hint').dataset.kind = r && insertErrors.length ? 'error' : 'info';
  $('copy-hint').textContent = !r
    ? '분석 결과가 나오면 복사할 수 있어요.'
    : insertErrors.length
      ? `INSERT 복사: ${insertErrors.join(' ')}`
      : '';
  $('suggest-name').disabled = !usable || draft.errors.length > 0;
  for (const button of $('names').children)
    button.setAttribute(
      'aria-pressed',
      String(draft.name?.code === button.dataset.code && draft.name?.name === button.dataset.name),
    );
  $('name-help').dataset.kind = namingError ? 'error' : 'info';
  $('name-help').textContent =
    namingError ||
    (usable
      ? ''
      : !r
        ? '수식을 먼저 분석해 주세요.'
        : '확인된 설정이 없어요. 수식이나 컬럼명을 확인해 주세요.');
}
function resetResults() {
  results = [];
  index = 0;

  namingError = '';
  $('names-panel').hidden = true;
  $('code-proof').hidden = true;
  $('code-proof').replaceChildren();
  render();
}
function syncLines() {
  const count = $('sql').value.split('\n').length;
  $('gutter').textContent = Array.from({ length: count }, (_, i) => i + 1).join('\n');
  $('input-info').textContent = `${count}행 · ${$('sql').value.length.toLocaleString()}자`;
  sqlEditor.sync();
}
$('sql').addEventListener('input', () => {
  if (productByCode.get($('example').value)?.inputScope) $('input-scope').value = 'row';
  examplePicker.clear();
  resetResults();
  syncLines();
  message('');
});
$('description').addEventListener('input', () => {
  namingError = '';
  $('names-panel').hidden = true;
  render();
});
for (const id of ['fee-column', 'vat-column'])
  $(id).addEventListener('input', () => {
    resetResults();
    message('컬럼명이 바뀌었어요. 수식을 다시 분석해 주세요.');
  });
$('input-scope').onchange = () => {
  resetResults();
  message('입력 기준이 바뀌었어요. 수식을 다시 분석해 주세요.');
};
$('sql').addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    run();
  }
});
const examplePicker = populateExamples(EXAMPLES);
$('example').addEventListener('change', () => {
  if (!$('example').value) return;
  $('sql').value = productByCode.get($('example').value)?.sql ?? EXAMPLES[$('example').value];
  $('fee-column').value = $('vat-column').value = '';
  $('input-scope').value = productByCode.get($('example').value)?.inputScope ?? 'row';
  syncLines();
  run();
});
$('clear').onclick = () => {
  $('sql').value = '';
  $('input-scope').value = 'row';
  examplePicker.clear();
  resetResults();
  syncLines();
  message('입력을 지웠어요.');
  $('sql').focus();
};
$('analyze').onclick = run;
function run() {
  resetResults();
  const outcome = analyze($('sql').value, columns());
  results = outcome.results;
  message(outcome.errors.join(' '), outcome.errors.length ? 'error' : 'info');
  render();
  if (base()) workflow.go(1, { focus: true });
}
$('blocks').onchange = () => {
  index = Number($('blocks').value);

  namingError = '';
  $('names-panel').hidden = true;
  $('code-proof').hidden = true;
  $('code-proof').replaceChildren();
  message('선택한 계산 구문의 결과예요.');
  render();
};
function evidence(key) {
  if (!base()) return;
  if (key === 'SMT_GDS_CD' || key === 'SMT_GDS_NM') {
    workflow.go(3, { focus: true });
    $(key === 'SMT_GDS_CD' ? 'final-code' : 'final-name').focus();
    return;
  }
  progressTable.select(key);
  decisions.open(key);
}
function render() {
  const r = base();
  finalProduct.setResult(r, productByCode.get($('example').value));
  renderProductContext(productByCode.get($('example').value), r);
  workflow.setAvailable(!!r);
  syncDraft();
  syncActions();
  $('result-empty').hidden = !!r;
  $('result-content').hidden = !r;
  $('blocks').hidden = $('blocks-label').hidden = results.length < 2;
  $('blocks').replaceChildren(
    ...results.map((r, i) => new Option(`${i + 1}번 구문 · 원문 ${r.line}행`, i)),
  );
  $('blocks').value = String(index);
  $('result-source').textContent = r ? '수식 분석 결과' : '입력 대기';
  if (!r) return;
  $('notices-panel').hidden = !r.notices.length;
  $('notices-title').textContent = `계산 전에 확인할 점 ${r.notices.length}개`;
  $('notices').replaceChildren(...r.notices.map((n) => make('li', n)));
}
async function copy(format) {
  const draft = finalProduct.draft();
  if (!draft.result || draft.errors.length) return;
  if (format === 'sql' && productInsertErrors(draft.result, draft.name, draft.registration).length)
    return;
  const copiedRevision = finalProduct.revision;
  const historyContext = { sql: $('sql').value, tests: quickVerification.history };
  finalProduct.clearCelebration();
  try {
    await navigator.clipboard.writeText(
      exportProductTable(draft.result, format, draft.name, draft.registration),
    );
    const historyError = productHistory.save(draft, historyContext);
    if (finalProduct.revision !== copiedRevision) {
      message('복사 요청 후 상품이 변경됐어요. 수정한 최종값을 다시 복사해 주세요.');
      return;
    }
    workflow.setSummary(3, '복사 완료');
    finalProduct.celebrate(completedProduct(), format);
    message(historyError, historyError ? 'error' : 'info');
  } catch {
    message(
      '복사하지 못했어요. HTTPS 또는 로컬 주소 접속과 브라우저의 클립보드 권한을 확인해 주세요.',
      'error',
    );
  }
}
$('markdown').onclick = () => copy('markdown');
$('tsv').onclick = () => copy('tsv');
$('copy-insert').onclick = () => copy('sql');
function suggestProductNames() {
  if ($('suggest-name').disabled || !base()) return;
  namingError = '';
  try {
    const result = finalProduct.draft().result;
    const { candidates } = suggestNames({
      sql: result.sql,
      columns: columns(),
      description: $('description').value,
      fields: result.fields,
      registration: finalProduct.draft().registration,
    });
    $('names-panel').hidden = false;
    $('names').replaceChildren();
    for (const candidate of candidates) {
      const button = make('button');
      button.dataset.code = candidate.code;
      button.dataset.name = candidate.name;
      button.setAttribute(
        'aria-pressed',
        String(
          finalProduct.draft().name?.code === candidate.code &&
            finalProduct.draft().name?.name === candidate.name,
        ),
      );
      button.append(
        make('strong', candidate.name),
        make('code', candidate.code),
        make('small', candidate.reason),
      );
      button.onclick = () => {
        finalProduct.setName(candidate);
        workflow.setSummary(3, '상품명 선택 완료');
        for (const item of $('names').children)
          item.setAttribute('aria-pressed', String(item === button));
        render();
      };
      $('names').append(button);
    }
    syncActions();
  } catch (error) {
    namingError = error.message;
    syncActions();
  }
}

$('suggest-name').onclick = suggestProductNames;
$('remove-name').onclick = () => {
  finalProduct.setName(null);
  workflow.setSummary(3, '최종값 확인');
  for (const b of $('names').children) b.setAttribute('aria-pressed', 'false');
  render();
};
syncLines();
render();
