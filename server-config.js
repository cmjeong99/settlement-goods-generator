import { createHash, timingSafeEqual } from 'node:crypto';

export function validateServerConfig(config) {
  if (!config.publicOrigin) return { ...config, shared: false };
  let url;
  try {
    url = new URL(config.publicOrigin);
  } catch {
    throw new Error('PUBLIC_ORIGIN에 HTTPS 사이트 주소를 입력해 주세요.');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error('PUBLIC_ORIGIN은 경로 없는 HTTPS 사이트 주소여야 합니다.');
  if (!config.accessUser || !config.accessPassword || config.accessUser.includes(':'))
    throw new Error('공유 서버에는 ACCESS_USERNAME과 ACCESS_PASSWORD를 설정해 주세요.');
  return { ...config, publicOrigin: url.origin, shared: true };
}

export function loadServerConfig(env = process.env) {
  const config = validateServerConfig({
    key: env.JEV_API_KEY,
    publicOrigin: env.PUBLIC_ORIGIN || env.RENDER_EXTERNAL_URL,
    accessUser: env.ACCESS_USERNAME,
    accessPassword: env.ACCESS_PASSWORD,
  });
  const host = env.HOST || (config.shared ? '0.0.0.0' : '127.0.0.1');
  if (!['127.0.0.1', '0.0.0.0'].includes(host) || (host !== '127.0.0.1' && !config.shared))
    throw new Error('외부 수신에는 HTTPS PUBLIC_ORIGIN과 접속 계정 설정이 필요합니다.');
  const port = Number(env.PORT || 4317);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('PORT는 1~65535의 정수여야 합니다.');
  return { ...config, host, port };
}

export function acceptsHost(host, config) {
  return (
    /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host) ||
    (config.shared && host === new URL(config.publicOrigin).host)
  );
}

export function authenticated(header, config) {
  if (!config.shared) return true;
  const expected =
    'Basic ' + Buffer.from(`${config.accessUser}:${config.accessPassword}`).toString('base64');
  const digest = (value) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(header ?? ''), digest(expected));
}
