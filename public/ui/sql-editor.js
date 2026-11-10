import { $ } from './dom.js';
import { formatSql, highlightSql } from '../sql-tools.js';

export function createSqlEditor({ onMessage, onTransform }) {
  const input = $('sql'),
    surface = $('sql-highlight'),
    code = $('sql-highlight-code'),
    format = $('format-sql'),
    undo = $('undo-format-sql');
  let previous = null,
    rendered = null;

  function syncScroll() {
    surface.scrollTop = $('gutter').scrollTop = input.scrollTop;
    surface.scrollLeft = input.scrollLeft;
  }
  function sync() {
    // A trailing newline needs a final visible line in the mirrored <pre>.
    if (rendered !== input.value) {
      code.innerHTML = highlightSql(input.value + '\n');
      rendered = input.value;
    }
    format.disabled = !input.value.trim();
    syncScroll();
  }
  function replace(value, selection) {
    input.focus({ preventScroll: true });
    input.setRangeText(value, 0, input.value.length, 'start');
    if (selection) input.setSelectionRange(...selection);
    if (onTransform) return onTransform();
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return false;
  }
  function formatInput() {
    if (format.disabled || input.matches(':disabled')) return;
    const snapshot = {
      text: input.value,
      selection: [input.selectionStart, input.selectionEnd],
      scrollTop: input.scrollTop,
      scrollLeft: input.scrollLeft,
    };
    let formatted;
    try {
      formatted = formatSql(snapshot.text);
    } catch {
      onMessage(
        'SQL을 정렬하지 못했어요. 미완성 구문이나 지원하지 않는 문법이 있는지 확인해 주세요. 입력은 그대로 유지했어요.',
        'error',
      );
      return;
    }
    if (formatted === snapshot.text) {
      onMessage('이미 정렬된 SQL이에요.');
      return;
    }
    const retained = replace(formatted);
    previous = snapshot;
    undo.hidden = false;
    onMessage(
      retained
        ? 'SQL을 정렬하고 다시 분석했어요. 상품 설정·등록 정보·테스트 입력은 유지했어요. 예시는 다시 테스트해 주세요.'
        : 'SQL을 정렬했어요. 수식을 다시 분석해 주세요.',
    );
  }
  format.onclick = formatInput;
  undo.onclick = () => {
    if (!previous) return;
    const snapshot = previous;
    const retained = replace(snapshot.text, snapshot.selection);
    input.scrollTop = snapshot.scrollTop;
    input.scrollLeft = snapshot.scrollLeft;
    syncScroll();
    onMessage(
      retained
        ? '정렬 전 SQL로 되돌리고 다시 분석했어요. 상품 설정과 입력값은 유지했어요.'
        : '정렬 전 SQL로 되돌렸어요.',
    );
  };
  input.addEventListener('input', () => {
    previous = null;
    undo.hidden = true;
    sync();
  });
  input.addEventListener('scroll', syncScroll);
  input.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      if (!event.isComposing) formatInput();
    }
  });
  // Programmatic changes (examples and clear) also invalidate the undo snapshot.
  return {
    sync() {
      previous = null;
      undo.hidden = true;
      sync();
    },
  };
}
