import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { reviewWithJev, suggestNames, ApiError } from './ai.js';
import { browserAssets, contentTypes } from './scripts/assets.js';
import {
  validateServerConfig,
  loadServerConfig,
  acceptsHost,
  authenticated,
} from './server-config.js';

const root = fileURLToPath(new URL('./public/', import.meta.url));
const files = new Map([['/', 'index.html'], ...browserAssets.map((file) => ['/' + file, file])]);
export function createApp({ config = { key: process.env.JEV_API_KEY }, fetchImpl = fetch } = {}) {
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
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'",
    );
    const path = new URL(req.url, `http://${host}`).pathname;
    if (req.method === 'GET' && path === '/healthz') return send(200, { ok: true });
    if (!authenticated(req.headers.authorization, config)) {
      res.setHeader('WWW-Authenticate', 'Basic realm="Formula Studio", charset="UTF-8"');
      return send(401, { error: '접속 계정을 확인해 주세요.' });
    }
    if (req.method === 'GET' && path === '/api/config')
      return send(200, { aiEnabled: !!config.key, provider: 'JEV', localNames: true });
    if (req.method === 'GET' && path === '/runtime-config.js') {
      res.writeHead(200, { 'Content-Type': contentTypes.js, 'Cache-Control': 'no-store' });
      res.end(
        `export const runtime = Object.freeze(${JSON.stringify({ mode: config.shared ? 'shared' : 'local', aiEnabled: !!config.key })});`,
      );
      return;
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
    if (req.method !== 'POST' || !['/api/analyze-ai', '/api/suggest-names'].includes(path))
      return send(404, { error: '요청 경로를 찾지 못했어요. 주소를 확인해 주세요.' });
    if (
      req.headers.origin &&
      req.headers.origin !== (config.shared ? config.publicOrigin : `http://${host}`)
    )
      return send(403, { error: '로컬 화면에서 다시 요청해 주세요.' });
    if (!req.headers['content-type']?.startsWith('application/json'))
      return send(415, { error: 'JSON 형식으로 요청해 주세요.' });
    try {
      let size = 0;
      const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 512000) throw new ApiError(413, '입력이 너무 커요. 계산 구문을 나눠 주세요.');
        chunks.push(chunk);
      }
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        throw new ApiError(400, 'JSON 형식을 확인해 주세요.');
      }
      if (!body || typeof body !== 'object' || Array.isArray(body))
        throw new ApiError(400, '요청 형식을 확인해 주세요.');
      send(
        200,
        path === '/api/analyze-ai'
          ? await reviewWithJev(body, config, fetchImpl)
          : suggestNames(body),
      );
    } catch (e) {
      send(e.status ?? 500, {
        error:
          e instanceof ApiError
            ? e.message
            : '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.',
      });
    }
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
