import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { createApp } from '../server.js';
import { browserAssets } from '../scripts/assets.js';

test('정적 파일만 제공하고 데이터 API·환경 파일을 제공하지 않는다', async (t) => {
  const server = createApp();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const origin = 'http://127.0.0.1:' + server.address().port;
  for (const file of browserAssets) {
    const response = await fetch(origin + '/' + file);
    assert.equal(response.status, 200, file);
    assert.match(response.headers.get('content-security-policy'), /connect-src 'none'/);
  }
  for (const path of [
    '/api/config',
    '/api/analyze-ai',
    '/api/suggest-names',
    '/runtime-config.js',
    '/.env',
    '/server.js',
  ])
    assert.equal((await fetch(origin + path)).status, 404, path);
  assert.equal(
    (await fetch(origin + '/api/history', { method: 'POST', body: 'private history' })).status,
    404,
  );
  const status = await new Promise((resolve, reject) => {
    http
      .get(origin, { headers: { Host: 'evil.example.com' } }, (response) => {
        response.resume();
        resolve(response.statusCode);
      })
      .on('error', reject);
  });
  assert.equal(status, 403);
});
