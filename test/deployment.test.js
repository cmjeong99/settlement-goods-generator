import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { buildSite, outputDirectory } from '../scripts/build.js';
import { browserAssets } from '../scripts/assets.js';
import { createPreview } from '../scripts/preview.js';
import { suggestNames } from '../public/naming.js';
import { EXAMPLES } from '../public/examples.js';

before(buildSite);

async function serve(t, server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}

test('배포 결과에는 지정한 브라우저 파일만 포함하고 이전 빌드의 잔여 파일을 제거한다', async () => {
  await writeFile(new URL('stale.js', outputDirectory), 'old build');
  await buildSite();
  const entries = (await readdir(outputDirectory, { recursive: true, withFileTypes: true })).filter(
    (entry) => entry.isFile(),
  );
  // Use the public asset paths themselves for cross-platform file assertions.
  const files = await Promise.all(
    [...browserAssets, '.nojekyll'].map(async (name) => {
      await readFile(new URL(name, outputDirectory));
      return name;
    }),
  );
  assert.equal(entries.length, files.length);
  for (const excluded of ['.env', 'ai.js', 'server.js', 'confluence-macro.html', 'stale.js']) {
    await assert.rejects(readFile(new URL(excluded, outputDirectory)), { code: 'ENOENT' });
  }
});

for (const basePath of ['/', '/formula-studio/', '/renamed-repository/']) {
  test(`${basePath} 경로에서 HTML·스타일·전체 모듈을 API 없이 제공한다`, async (t) => {
    const origin = await serve(t, createPreview({ basePath }));
    const pageUrl = new URL(basePath, origin);
    const html = await (await fetch(pageUrl)).text();
    assert.match(html, /href="\.\/styles.css"/);
    assert.match(html, /href="\.\/"/);
    assert.match(html, /src="\.\/app.js"/);
    assert.doesNotMatch(html, /(?:href|src)="\/(?!\/)/);
    for (const asset of browserAssets) {
      const url = new URL(asset, pageUrl);
      const response = await fetch(url);
      assert.equal(response.status, 200, asset);
      const source = await response.text();
      if (!asset.endsWith('.js')) continue;
      assert.match(response.headers.get('content-type'), /javascript/);
      for (const [, dependency] of source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
        assert.ok(dependency.startsWith('.'), `${asset}: ${dependency} must be relative`);
        const dependencyUrl = new URL(dependency, url);
        assert.ok(dependencyUrl.pathname.startsWith(basePath));
        assert.equal((await fetch(dependencyUrl)).status, 200, dependencyUrl.href);
      }
    }
    for (const path of [
      'api/config',
      'api/analyze-ai',
      '.env',
      'server.js',
      'confluence-macro.html',
    ]) {
      assert.equal((await fetch(new URL(path, pageUrl))).status, 404, path);
    }
    if (basePath !== '/') {
      const redirect = await fetch(origin + basePath.slice(0, -1), { redirect: 'manual' });
      assert.equal(redirect.status, 308);
      assert.equal(redirect.headers.get('location'), basePath);
      assert.equal((await fetch(origin + '/app.js')).status, 404);
    }
  });
}

test('이름 추천은 외부 요청 없이 브라우저 모듈에서 생성한다', () => {
  assert.equal(suggestNames({ sql: EXAMPLES['오픈뱅킹 정률'] }).candidates.length, 3);
});
