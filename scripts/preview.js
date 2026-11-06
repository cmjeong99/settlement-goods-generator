import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { browserAssets, contentTypes } from './assets.js';
import { outputDirectory } from './build.js';

export function createPreview({ basePath = '/' } = {}) {
  if (!/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(basePath)) {
    throw new Error('미리보기 경로는 / 또는 /저장소명/ 형식이어야 합니다.');
  }
  const routes = new Map(browserAssets.map((name) => [basePath + name, name]));
  routes.set(basePath, 'index.html');
  return http.createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    if (request.method === 'GET' && basePath !== '/' && pathname === basePath.slice(0, -1)) {
      response.writeHead(308, { Location: basePath });
      response.end();
      return;
    }
    const file = routes.get(pathname);
    if (request.method !== 'GET' || !file) {
      response.writeHead(404);
      response.end('Not found');
      return;
    }
    try {
      const content = await readFile(new URL(file, outputDirectory));
      response.writeHead(200, { 'Content-Type': contentTypes[file.split('.').at(-1)] });
      response.end(content);
    } catch {
      response.writeHead(500);
      response.end('Build the site with npm run build first.');
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const basePath = process.argv[2] || '/';
  const port = Number(process.env.PORT || 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('PORT는 1~65535의 정수여야 합니다.');
  const server = createPreview({ basePath });
  server.on('error', (error) => {
    console.error(
      error.code === 'EADDRINUSE'
        ? '포트가 사용 중입니다. PORT를 변경해 주세요.'
        : '미리보기 서버 시작에 실패했습니다.',
    );
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () =>
    console.log(`정적 사이트 미리보기: http://127.0.0.1:${port}${basePath}`),
  );
}
