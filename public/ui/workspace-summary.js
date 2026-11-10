import { $ } from './dom.js';
import { productTable } from '../product-table.js';

export function renderWorkspaceSummary(result, name, trial, settingErrors = []) {
  const table = productTable(result, name);
  $('workspace-product-name').textContent = name?.name || '새 정산 상품';
  $('workspace-product-name').title = name?.name || '새 정산 상품';
  $('workspace-product-code').textContent =
    name?.code ||
    (result ? '완성 단계에서 상품 이름을 정할 수 있어요' : '수식을 입력하거나 예제를 선택하세요');
  $('workspace-settings').textContent = !result
    ? '—'
    : settingErrors.length
      ? '입력 확인'
      : `${table.resolved} / 12`;
  $('workspace-settings-detail').textContent = !result
    ? '수식 분석 후 표시돼요'
    : settingErrors.length
      ? `입력값 ${settingErrors.length}개를 확인해 주세요`
      : table.pending
        ? `확인할 설정 ${table.pending}개`
        : '모든 설정이 정해졌어요';
  $('workspace-verification').textContent = {
    untested: '테스트 전',
    stale: '다시 확인',
    match: `${trial.count}개 일치`,
    mismatch: '차이 있음',
    unavailable: '비교 불가',
  }[trial.status];
  $('workspace-verification-detail').textContent =
    trial.status === 'untested' ? '현재 설정의 계산 결과를 확인하세요' : trial.text;
  $('workspace-test-card').dataset.state = trial.status;
}
