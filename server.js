import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { browserAssets, contentTypes } from './scripts/assets.js';
import {
  validateServerConfig,
  loadServerConfig,
  acceptsHost,
  authenticated,
} from './server-config.js';

const root = fileURLToPath(new URL('./public/', import.meta.url));
const files = new Map([['/', 'index.html'], ...browserAssets.map((file) => ['/' + file, file])]);
export function createApp({ config = {} } = {}) {
  config = validateServerConfig(config);
  return http.createServer(async (req, res) => {
    const send = (status, data) => {
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify(data));
    };
    const host = req.headers.host ?? '';
    if (!acceptsHost(host, config)) return send(403, { error: '로컬 주소로 접속해 주세요.' });
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'none'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'",
    );
    const path = new URL(req.url, `http://${host}`).pathname;
    if (req.method === 'GET' && path === '/healthz') return send(200, { ok: true });
    if (!authenticated(req.headers.authorization, config)) {
      res.setHeader('WWW-Authenticate', 'Basic realm="Formula Studio", charset="UTF-8"');
      return send(401, { error: '접속 계정을 확인해 주세요.' });
    }
    if (req.method === 'GET' && files.has(path)) {
      try {
        const file = files.get(path),
          content = await readFile(resolve(root, file));
        res.writeHead(200, {
          'Content-Type': contentTypes[file.split('.').at(-1)],
          'Cache-Control': 'no-store',
        });
        res.end(content);
      } catch {
        send(500, { error: '화면 파일을 읽지 못했어요. 서버 파일을 확인해 주세요.' });
      }
      return;
    }
    send(404, { error: '요청 경로를 찾지 못했어요.' });
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = loadServerConfig();
  const { port, host } = config;
  const server = createApp({ config });
  server.on('error', (e) => {
    console.error(
      e.code === 'EADDRINUSE'
        ? '포트가 사용 중입니다. .env의 PORT를 변경해 주세요.'
        : '서버 시작에 실패했습니다.',
    );
    process.exitCode = 1;
  });
  server.listen(port, host, () =>
    console.log(
      `다날 정산 상품 생성기: ${config.publicOrigin ?? `http://127.0.0.1:${port}`}\n종료: Ctrl+C`,
    ),
  );
}
