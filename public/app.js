import { analyze } from './analyzer.js';
import { FIELDS, display, describeField, exportRow } from './domain.js';
import { EXAMPLES } from './examples.js';
import { suggestNames } from './naming.js';
import { runtime } from './runtime-config.js';
import { reviewFormula } from './api.js';
import { $, make, observeTableOverflow } from './ui/dom.js';
import { labels, proofNodes, inlineProof, renderExplanation, renderProposal } from './ui/views.js';
import { productByCode } from './catalog.js';
import { populateExamples, renderProductContext } from './ui/catalog.js';
import { createVerification } from './ui/verification.js';
import { createWorkflow } from './ui/workflow.js';
import { createQuickVerification } from './ui/quick-verification.js';

const syncTableOverflow = observeTableOverflow();
const workflow = createWorkflow();
const verification = createVerification();
const quickVerification = createQuickVerification({
  onContinue(product, row) {
    verification.loadInput(product, row);
    workflow.openCalculator();
  },
  onSummary(text) {
    workflow.setSummary(2, text);
  },
});
const aiConfigured = runtime.aiEnabled;
let results = [];
let index = 0;
let proposal = null;
let chosenName = null;
let namingError = '';
let selectedField = null;
let revision = 0;
let busy = false;
const base = () => results[index];
const columns = () => ({ feeColumn: $('fee-column').value, vatColumn: $('vat-column').value });
const needsAttention = (cell) => ['unknown', 'custom'].includes(cell.status);
function message(text, kind = 'info') {
  $('message').textContent = text;
  $('message').dataset.kind = kind;
}
function syncActions() {
  const r = base(),
    usable = r && Object.values(r.fields).some((c) => c.status !== 'unknown');
  const reviewable =
    r && Object.values(r.fields).some((c) => c.status === 'known' && c.evidence.length);
  $('analyze').disabled = !$('sql').value.trim();
  $('markdown').disabled = $('tsv').disabled = !r;
  $('ai-analyze').disabled = busy || !reviewable || aiConfigured !== true;
  $('ai-names').disabled = busy || !usable;
  $('ai-analyze').textContent = busy ? 'AI 검토 중…' : 'AI 검토 요청';
  $('ai-area').setAttribute('aria-busy', String(busy));
  $('ai-help').textContent = aiHelpText(r, reviewable);
  $('ai-help').hidden = !$('ai-help').textContent;
  $('name-help').dataset.kind = namingError ? 'error' : 'info';
  $('name-help').textContent =
    namingError ||
    (usable
      ? '이름을 선택하면 복사할 표에 상품코드·상품명을 추가해요.'
      : !r
        ? '수식을 먼저 분석해 주세요.'
        : '확인된 설정이 없어요. 수식이나 컬럼명을 확인해 주세요.');
  document.querySelector('.evidence-panel').hidden = !r;
}
function aiHelpText(result, reviewable) {
  if (busy) return '최대 60초가 걸릴 수 있어요.';
  if (!result) return '수식을 먼저 분석해 주세요.';
  if (!reviewable) return '검토할 항목이 없어요. 수식이나 컬럼명을 확인해 주세요.';
  if (!aiConfigured)
    return runtime.mode === 'shared'
      ? 'AI 키가 설정되지 않았어요. 운영자에게 문의해 주세요.'
      : 'AI 키가 없어요. 아래 ‘AI 연결 설정’을 확인해 주세요.';
  return '';
}
function resetResults() {
  revision++;
  results = [];
  index = 0;
  proposal = null;
  chosenName = null;
  namingError = '';
  selectedField = null;
  $('names-panel').hidden = true;
  $('evidence-content').hidden = true;
  $('evidence-empty').hidden = false;
  $('code-proof').hidden = true;
  $('code-proof').replaceChildren();
  $('evidence-kind').textContent = '';
  render();
}
function syncLines() {
  const count = $('sql').value.split('\n').length;
  $('gutter').textContent = Array.from({ length: count }, (_, i) => i + 1).join('\n');
  $('input-info').textContent = `${count}행 · ${$('sql').value.length.toLocaleString()}자`;
}
$('sql').addEventListener('input', () => {
  $('example').value = '';
  resetResults();
  syncLines();
  message('');
});
$('description').addEventListener('input', () => {
  revision++;
  chosenName = null;
  namingError = '';
  $('names-panel').hidden = true;
  workflow.setSummary(3, '이름은 선택 사항');
  render();
});
for (const id of ['fee-column', 'vat-column'])
  $(id).addEventListener('input', () => {
    resetResults();
    message('컬럼명이 바뀌었어요. 수식을 다시 분석해 주세요.');
  });
$('sql').addEventListener('scroll', () => {
  $('gutter').scrollTop = $('sql').scrollTop;
});
$('sql').addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    run();
  }
});
populateExamples(EXAMPLES);
$('example').addEventListener('change', () => {
  if (!$('example').value) return;
  $('sql').value = productByCode.get($('example').value)?.sql ?? EXAMPLES[$('example').value];
  $('fee-column').value = $('vat-column').value = '';
  syncLines();
  run();
});
$('clear').onclick = () => {
  $('sql').value = '';
  $('example').value = '';
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
  revision++;
  index = Number($('blocks').value);
  proposal = null;
  chosenName = null;
  namingError = '';
  selectedField = null;
  $('names-panel').hidden = true;
  $('evidence-content').hidden = true;
  $('evidence-empty').hidden = false;
  $('code-proof').hidden = true;
  $('code-proof').replaceChildren();
  message('선택한 계산 구문의 결과예요.');
  render();
};
function evidence(key, anchor) {
  const cell = base()?.fields[key];
  if (!cell) return;
  selectedField = key;
  for (const button of document.querySelectorAll('button[data-field]'))
    button.setAttribute('aria-pressed', String(button.dataset.field === key));
  $('evidence-empty').hidden = true;
  $('evidence-content').hidden = false;
  $('evidence-label').textContent = `${labels[key]} · ${describeField(key, cell)}`;
  $('evidence-kind').textContent = '수식 분석';
  $('evidence-reason').textContent = cell.reason;
  $('evidence-quotes').replaceChildren(...proofNodes(cell));
  for (const proof of document.querySelectorAll('.inline-proof')) proof.remove();
  $('code-proof').hidden = true;
  const proof = inlineProof(key, cell);
  if (anchor?.closest('#result-table')) {
    $('code-proof').replaceChildren(proof);
    $('code-proof').hidden = false;
  } else if (anchor?.closest('.review-card')) anchor.after(proof);
  else if (anchor?.closest('#attention-fields')) $('next-action').append(proof);
}
function render() {
  const r = base();
  renderProductContext(productByCode.get($('example').value), r);
  workflow.setAvailable(!!r);
  quickVerification.setResult(r, productByCode.get($('example').value));
  syncActions();
  $('result-empty').hidden = !!r;
  $('result-content').hidden = !r;
  $('blocks').hidden = $('blocks-label').hidden = results.length < 2;
  $('blocks').replaceChildren(
    ...results.map((r, i) => new Option(`${i + 1}번 구문 · 원문 ${r.line}행`, i)),
  );
  $('blocks').value = String(index);
  $('result-source').textContent = r ? '수식 분석 결과' : '입력 대기';
  $('ai-candidates').hidden = !proposal;
  $('copy-hint').textContent = r ? '컬럼명과 코드값을 함께 복사해요.' : '';
  if (!r) return;
  const attention = FIELDS.filter(([key]) => needsAttention(r.fields[key]));
  const confirmed = Object.values(r.fields).filter((c) => c.status === 'known').length;
  const feeSummary = ['FEE_SMT_CALC_BASE_DVCD', 'FEE_SMT_CALC_MHOD_DVCD']
    .filter((key) => r.fields[key].status === 'known')
    .map((key) => describeField(key, r.fields[key]));
  $('summary').textContent = feeSummary.length
    ? `수수료: ${feeSummary.join(' · ')}`
    : '수수료 계산 방식 확인 필요';
  $('known-count').textContent = `수식에서 확인 ${confirmed}/${FIELDS.length}`;
  $('next-action').dataset.kind = attention.length ? 'warning' : 'success';
  $('next-title').textContent = attention.length
    ? `${attention.length}개 항목 확인 필요`
    : '복사 전 확인';
  $('next-detail').textContent = attention.length
    ? '항목을 눌러 근거를 확인하고, 부족한 정보는 따로 확인해 주세요.'
    : '원문과 대조하고 실제 데이터 타입·업무 조건을 확인해 주세요.';
  $('attention-fields').replaceChildren(
    ...attention.map(([key]) => {
      const b = make('button', labels[key], 'attention-link');
      b.onclick = () => evidence(key, b);
      return b;
    }),
  );
  for (const proof of $('next-action').querySelectorAll('.inline-proof')) proof.remove();
  if (attention.length) $('copy-hint').textContent = '‘미확정’·‘별도 계산 필요’도 그대로 복사돼요.';
  if (proposal && Object.values(proposal.reviews).some((r) => r.decision !== 'supported'))
    $('copy-hint').textContent += ' AI 재확인·보류 항목도 원래 설정값을 복사해요.';
  renderExplanation(r);
  const head = make('tr'),
    row = make('tr');
  $('result-table').classList.toggle('has-name', !!chosenName);
  if (chosenName)
    for (const [label, key, value] of [
      ['상품코드', 'SMT_GDS_CD', chosenName.code],
      ['상품명', 'SMT_GDS_NM', chosenName.name],
    ]) {
      const th = make('th', label);
      th.scope = 'col';
      th.append(make('code', key));
      head.append(th);
      row.append(make('td', value));
    }
  for (const [key] of FIELDS) {
    const th = make('th', labels[key]);
    th.scope = 'col';
    th.append(make('code', key));
    head.append(th);
    const cell = r.fields[key],
      td = make('td', undefined, cell.status),
      button = make('button', display(cell), 'code-cell');
    button.dataset.field = key;
    button.setAttribute('aria-pressed', String(selectedField === key));
    button.setAttribute('aria-label', `${labels[key]}: ${display(cell)}. 원문과 이유 보기`);
    button.onclick = () => evidence(key, button);
    td.append(button);
    row.append(td);
  }
  $('result-table').tHead.replaceChildren(head);
  $('result-table').tBodies[0].replaceChildren(row);
  syncTableOverflow();
  $('notices-panel').hidden = !r.notices.length;
  $('notices-title').textContent = `계산 전에 확인할 점 ${r.notices.length}개`;
  $('notices').replaceChildren(...r.notices.map((n) => make('li', n)));
  $('chosen-name').hidden = !chosenName;
  $('chosen-name').textContent = chosenName
    ? `선택한 상품명: ${chosenName.name} · ${chosenName.code}`
    : '';
  renderProposal(proposal, r, evidence);
}
async function copy(format) {
  const r = base();
  if (!r) return;
  try {
    await navigator.clipboard.writeText(exportRow(r, format, chosenName));
    workflow.setSummary(3, '복사 완료');
    message(
      format === 'tsv' ? '복사했어요. 엑셀에 붙여 넣으세요.' : 'Markdown 표를 복사했어요.',
      'success',
    );
  } catch {
    message(
      '복사하지 못했어요. HTTPS 또는 로컬 주소 접속과 브라우저의 클립보드 권한을 확인해 주세요.',
      'error',
    );
  }
}
$('markdown').onclick = () => copy('markdown');
$('tsv').onclick = () => copy('tsv');
function suggestProductNames() {
  if ($('ai-names').disabled || !base()) return;
  namingError = '';
  try {
    const result = base();
    const { candidates } = suggestNames({
      sql: result.sql,
      columns: columns(),
      description: $('description').value,
      fields: result.fields,
    });
    $('names-panel').hidden = false;
    $('names').replaceChildren();
    for (const candidate of candidates) {
      const button = make('button');
      button.setAttribute('aria-pressed', String(chosenName?.code === candidate.code));
      button.append(
        make('strong', candidate.name),
        make('code', candidate.code),
        make('small', candidate.reason),
      );
      button.onclick = () => {
        chosenName = candidate;
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

async function reviewWithAi() {
  if (busy || !base() || $('ai-analyze').disabled) return;
  const before = revision;
  busy = true;
  syncActions();
  $('ai-candidates').setAttribute('aria-busy', 'true');
  message('AI가 수식과 분석 근거를 검토하고 있어요.');
  try {
    const result = base();
    const data = await reviewFormula({ sql: result.sql, columns: columns() });
    // Editing input or changing the selected block invalidates an in-flight review.
    if (before !== revision) return;
    proposal = data;
    $('review-more').open = false;
    render();
    const count = Object.values(data.reviews).filter(
      (review) => review.decision !== 'supported',
    ).length;
    message(
      count
        ? `AI 검토 완료. 재확인·보류 ${count}개 항목을 아래에서 확인하세요.`
        : 'AI 검토 완료. 검토한 항목은 모두 ‘근거 일치’로 판단했어요.',
    );
  } catch (error) {
    if (before === revision) message(`${error.message} 수식 분석 결과는 그대로예요.`, 'error');
  } finally {
    busy = false;
    $('ai-candidates').setAttribute('aria-busy', 'false');
    syncActions();
  }
}
$('ai-analyze').onclick = reviewWithAi;
$('ai-names').onclick = suggestProductNames;
$('remove-name').onclick = () => {
  chosenName = null;
  workflow.setSummary(3, '이름은 선택 사항');
  for (const b of $('names').children) b.setAttribute('aria-pressed', 'false');
  render();
};
$('ai-area').hidden = runtime.mode === 'static';
$('local-ai-settings').hidden = runtime.mode !== 'local';
$('connection').textContent =
  runtime.mode === 'static'
    ? '브라우저에서 분석'
    : aiConfigured
      ? 'AI 검토 키 설정됨'
      : 'AI 검토 미설정';
syncLines();
render();
