export const SAMPLE_HISTORY_LIMIT = 50;

export function rememberSample(history, record) {
  const fingerprint = JSON.stringify(record.input);
  const existing = history.findIndex((item) => JSON.stringify(item.input) === fingerprint);
  if (existing < 0 && history.length >= SAMPLE_HISTORY_LIMIT)
    throw new Error(
      `예시 기록은 ${SAMPLE_HISTORY_LIMIT}개까지 보관해요. 불필요한 기록을 제외한 뒤 다시 테스트해 주세요.`,
    );
  const next = [...history];
  if (existing < 0) next.push(record);
  else next[existing] = record;
  return next;
}

export function sampleTestState(history, { dirty = false } = {}) {
  const status = dirty
    ? 'stale'
    : !history.length
      ? 'untested'
      : history.some((record) => record.status === 'mismatch')
        ? 'mismatch'
        : history.some((record) => record.status === 'unavailable')
          ? 'unavailable'
          : 'match';
  return {
    status,
    count: history.length,
    text: dirty
      ? `${history.length ? `${history.length}개 기록 · ` : ''}현재 입력 재테스트 필요`
      : history.length
        ? `${history.length}개 테스트 · ${status === 'match' ? '일치' : status === 'mismatch' ? '차이 있음' : '비교 불가'}`
        : '테스트 전',
  };
}
