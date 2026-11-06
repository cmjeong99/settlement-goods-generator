import { runtime } from './runtime-config.js';

export async function reviewFormula(body, { fetchImpl = fetch, baseUrl = document.baseURI } = {}) {
  if (!runtime.aiEnabled) {
    throw new Error('AI 검토는 API 키를 설정한 로컬 서버에서 사용할 수 있어요.');
  }
  let response;
  try {
    response = await fetchImpl(new URL('./api/analyze-ai', baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(65000),
    });
  } catch {
    throw new Error(
      'AI 검토 서버에 연결하지 못했거나 요청 시간을 넘겼어요. 서버 실행 상태를 확인해 주세요.',
    );
  }
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error('AI 검토 서버의 응답을 읽지 못했어요. 서버 실행 상태를 확인해 주세요.');
  }
  if (!response.ok)
    throw new Error(data.error || 'AI 검토를 처리하지 못했어요. 잠시 후 다시 시도해 주세요.');
  return data;
}
