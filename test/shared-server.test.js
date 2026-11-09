import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server.js';
import { loadServerConfig, acceptsHost } from '../server-config.js';

test('로컬 실행은 유지하고 외부 수신에는 HTTPS 주소와 접속 계정 설정을 요구한다', () => {
  assert.equal(loadServerConfig({}).host, '127.0.0.1');
  assert.throws(() => loadServerConfig({ HOST: '0.0.0.0' }));
  for (const publicOrigin of [
    'http://app.example.com',
    'https://app.example.com/path',
    'https://user:pass@app.example.com',
  ])
    assert.throws(() =>
      loadServerConfig({
        PUBLIC_ORIGIN: publicOrigin,
        ACCESS_USERNAME: 'team',
        ACCESS_PASSWORD: 'test',
      }),
    );
  assert.throws(() => loadServerConfig({ PUBLIC_ORIGIN: 'https://app.example.com' }));
  const config = loadServerConfig({
    RENDER_EXTERNAL_URL: 'https://app.example.com',
    ACCESS_USERNAME: 'team',
    ACCESS_PASSWORD: 'test',
  });
  assert.equal(config.host, '0.0.0.0');
  assert.equal(acceptsHost('app.example.com', config), true);
  assert.equal(acceptsHost('evil.example.com', config), false);
});

test('공유 정적 화면은 로그인 후 제공하고 접속 비밀번호를 브라우저에 보내지 않는다', async (t) => {
  const server = createApp({
    config: {
      publicOrigin: 'https://app.example.com',
      accessUser: 'team',
      accessPassword: 'synthetic-login-secret',
    },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.address().port}`;
  const headers = {
    Authorization: 'Basic ' + Buffer.from('team:synthetic-login-secret').toString('base64'),
  };
  for (const path of ['/', '/history.js', '/product-examples.js']) {
    const anonymous = await fetch(origin + path);
    assert.equal(anonymous.status, 401, path);
    assert.match(anonymous.headers.get('www-authenticate'), /^Basic/);
    const authorized = await fetch(origin + path, { headers });
    assert.equal(authorized.status, 200, path);
    const content = await authorized.text();
    assert.ok(!content.includes('synthetic-login-secret'));
  }
  assert.equal((await fetch(origin + '/healthz')).status, 200);
  assert.equal(
    (await fetch(origin + '/api/history', { method: 'POST', headers, body: 'private history' }))
      .status,
    404,
  );
});
