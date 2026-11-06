import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createApp } from '../server.js';
import { FIELDS } from '../public/domain.js';
import { analyze } from '../public/analyzer.js';
import { reviewWithJev, validateReview, encodeJevRequest, suggestNames } from '../ai.js';
const sql = 'CPFEE=FLOOR(AMT*CPRATE)';
const answer = () => ({
  type: 'choice',
  choice: 'supported',
  confidence: 0.85,
  probabilities: { supported: 0.85, verify_more: 0.1, unsupported: 0.05 },
});
const envelope = (keys) => ({
  model: 'jev-1.14.0',
  answers: Object.fromEntries(keys.map((k) => [k, answer()])),
  usage: { input_tokens: 100, output_tokens: 20 },
});
const mock = async (url, opts) => ({
  ok: true,
  json: async () => envelope(Object.keys(JSON.parse(opts.body).questions)),
});

// Layout assertions should not depend on formatter whitespace.
async function readContractSource(path) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
  if (path.endsWith('.css')) return source.replace(/\s+/g, '');
  if (path.endsWith('.html')) {
    return source
      .replace(/\s+/g, ' ')
      .replace(/\s+>/g, '>')
      .replace(/>\s+</g, '><')
      .replace(/>\s+/g, '>');
  }
  return source;
}
test('AI 전송 전 개인정보·업체정보 확인과 제거 방법을 구체적으로 안내', async () => {
  const [html, app] = await Promise.all(
    ['index.html', 'app.js'].map((path) => readContractSource(`public/${path}`)),
  );
  assert.match(html, /id="ai-privacy">개인정보·업체정보를 지운 뒤 요청하세요\./);
  assert.match(html, /이름·연락처·계좌번호·업체명·가맹점번호/);
  assert.match(html, /제거하거나 식별할 수 없는 값으로 바꿔 주세요/);
  assert.match(
    html,
    /id="ai-transfer">선택한 수식과 분석 근거를 TypeSafe로 보내요\. 설정값은 유지돼요\./,
  );
  assert.match(html, /<details class="ai-checklist"><summary>전송 전 확인사항<\/summary>/);
  assert.match(html, /정보를 수정했다면 수식을 다시 분석해 주세요/);
  assert.match(html, /aria-describedby="ai-privacy ai-transfer ai-help"/);
  assert.match(app, /\$\('ai-help'\)\.hidden\s*=\s*!\$\('ai-help'\)\.textContent/);
  assert.doesNotMatch(app, /개인정보·업체정보를 확인한 뒤/);
  assert.doesNotMatch(app, /전송해도 되는 SQL인지/);
});
test('다날 생성기 화이트톤 브랜딩·장식 제거·본문과 버튼 명암 대비', async () => {
  const [html, css, launcher, server] = await Promise.all(
    ['public/index.html', 'public/styles.css', 'start.cmd', 'server.js'].map(readContractSource),
  );
  assert.match(html, /<title>다날 정산 상품 생성기<\/title>/);
  assert.match(html, /<a class="brand"[^>]*>.*다날 정산 상품 생성기/);
  assert.match(html, /<footer><span>다날 정산 상품 생성기<\/span>/);
  assert.match(html, /정산 수식을, 상품 설정으로\./);
  assert.match(html, /상품을 DB에 직접 등록하지 않아요/);
  assert.match(launcher, /title Danal Settlement Product Generator/);
  assert.match(server, /다날 정산 상품 생성기:/);
  assert.doesNotMatch(html, /Settlement Formula Studio/);
  assert.doesNotMatch(html, /class="mark"/);
  assert.doesNotMatch(css, /--green|--deep-blue|--red|linear-gradient|\.mark\{/);
  assert.match(css, /header\{[^}]*background:#fff/);
  assert.match(css, /\.panel\{[^}]*background:#fff[^}]*border-radius:6px/);
  assert.match(css, /\.code-output\{[^}]*background:#fff/);
  const color = (key) => {
    const match = css.match(new RegExp(`--${key}:(#[0-9a-f]{6})`));
    assert.ok(match, `palette ${key}`);
    return match[1];
  };
  assert.equal(color('blue'), '#0f71ff');
  assert.equal(color('action'), '#0969ef');
  assert.equal(color('action-hover'), '#0958d9');
  assert.equal(color('selected'), '#eff5ff');
  assert.equal(color('ink'), '#253041');
  assert.equal(color('soft'), '#f8f9fb');
  const luminance = (hex) => {
    const rgb = [1, 3, 5]
      .map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  for (const [fg, bg] of [
    [color('action'), '#ffffff'],
    [color('action-hover'), '#ffffff'],
    [color('ink'), color('selected')],
    [color('ink'), color('soft')],
    [color('muted'), color('soft')],
  ]) {
    const a = luminance(fg),
      b = luminance(bg);
    assert.ok((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 4.5, `${fg} on ${bg}`);
  }
  assert.ok(
    (luminance(color('selected')) + 0.05) / (luminance(color('blue')) + 0.05) >= 3,
    'selected border contrast',
  );
  assert.doesNotMatch(css, /#0081cc|#006fae|#00588b/);
});
test('설정 확인 단계는 코드 표를 먼저 보여 주고 복사는 마지막 단계에 제공', async () => {
  const html = await readContractSource('public/index.html');
  assert.match(html, /<div id="result-content" hidden>\s*<section id="code-details"/);
  assert.doesNotMatch(html, /<details[^>]*id="code-details"/);
  assert.match(html, /<details id="explanation-details" class="details-block">/);
  assert.ok(html.indexOf('id="result-table"') < html.indexOf('id="explanation-details"'));
  const output = html.slice(
    html.indexOf('<section id="code-details"'),
    html.indexOf('<div class="summary-line"'),
  );
  for (const id of ['result-table', 'code-proof']) {
    assert.ok(output.includes(`id="${id}"`), id);
    assert.equal(html.split(`id="${id}"`).length - 1, 1, `${id} must be unique`);
  }
  const copyStep = html.slice(
    html.indexOf('id="workflow-copy"'),
    html.indexOf('id="calculator-workspace"'),
  );
  for (const id of ['tsv', 'markdown', 'copy-hint']) {
    assert.ok(copyStep.includes(`id="${id}"`), id);
    assert.equal(html.split(`id="${id}"`).length - 1, 1, `${id} must be unique`);
  }
  assert.match(output, /1원 단위의 설정 코드는 0/);
  assert.match(output, /좌우로 밀어/);
});
test('작업 중심 배치·넓은 표·접힌 보조 근거·움직임 감소 설정', async () => {
  const [html, css, app] = await Promise.all(
    ['index.html', 'styles.css', 'ui/dom.js'].map((path) => readContractSource(`public/${path}`)),
  );
  assert.match(html, /<div class="intro-copy">/);
  assert.ok(html.indexOf('class="editor-footer"') < html.indexOf('class="advanced-input"'));
  assert.match(html, /<details class="panel evidence-panel" aria-labelledby="evidence-title">/);
  const output = html.slice(
    html.indexOf('id="code-details"'),
    html.indexOf('id="explanation-details"'),
  );
  assert.match(output, /id="next-action"/);
  assert.ok(output.indexOf('id="result-table"') < output.indexOf('id="next-action"'));
  assert.doesNotMatch(css, /main\{[^}]*max-width/);
  assert.match(css, /#result-table\{table-layout:auto/);
  assert.match(css, /\.inline-proof\{display:block/);
  assert.match(
    css,
    /@media\(prefers-reduced-motion:reduce\)\{button\{transition:none;transform:none!important/,
  );
  assert.match(app, /new ResizeObserver\(syncTableOverflow\)\.observe\(tableScroll\)/);
  assert.match(app, /tableScroll\.scrollWidth\s*<=\s*tableScroll\.clientWidth/);
});
test('TypeSafe systemone 요청·모델·근거·서버 재파싱과 미확정 보존', async () => {
  const local = analyze(sql).results[0];
  const result = await reviewWithJev(
    { sql, fields: { VAT_DVCD: { value: 'ZERO' } } },
    { key: 'mock-key' },
    async (url, opts) => {
      assert.equal(url, 'https://api.typesafe.ai/v1/systemone');
      assert.equal(opts.headers.Authorization, 'Bearer mock-key');
      assert.equal(opts.redirect, 'error');
      assert.ok(opts.signal);
      const request = JSON.parse(opts.body);
      assert.equal(request.state.sql, sql);
      assert.equal(request.state.candidates.FEE_TYPE_DVCD.value, 'RATE');
      assert.equal(request.state.candidates.FEE_TYPE_DVCD.evidence[0].quote, 'FLOOR(AMT*CPRATE)');
      assert.equal(request.state.candidates.VAT_DVCD, undefined);
      assert.equal(request.questions.FEE_TYPE_DVCD.type, 'choice');
      assert.match(
        request.questions.FEE_TYPE_DVCD.instructions,
        /state\.candidates\.FEE_TYPE_DVCD 하나/,
      );
      assert.match(
        request.questions.FRIM_BASE_DVCD.instructions,
        /state\.candidates\.FRIM_BASE_DVCD 하나/,
      );
      assert.notEqual(
        request.questions.FEE_TYPE_DVCD.instructions,
        request.questions.FRIM_BASE_DVCD.instructions,
      );
      assert.equal(request.model, 'jev-latest');
      assert.equal(request.messages, undefined);
      return mock(url, opts);
    },
  );
  assert.deepEqual(result.fields, local.fields);
  assert.equal(result.fields.VAT_DVCD.status, 'unknown');
  assert.equal(result.reviews.VAT_DVCD, undefined);
  assert.equal(result.reviews.FEE_TYPE_DVCD.decision, 'supported');
});
test('TypeSafe 최상위 answers·모델·choice 타입·확률·신뢰도 검증', () => {
  const key = 'FEE_TYPE_DVCD',
    good = () => envelope([key]);
  assert.equal(validateReview(good(), [key])[key].confidence, 0.85);
  for (const decision of ['supported', 'verify_more', 'unsupported']) {
    const data = good();
    data.answers[key].choice = decision;
    assert.equal(validateReview(data, [key])[key].decision, decision);
  }
  const mutations = [
    (e) => delete e.model,
    (e) => (e.model = ''),
    (e) => (e.answers = {}),
    (e) => (e.answers[key].choice = 'invented'),
    (e) => (e.answers[key].type = 'score'),
    (e) => delete e.answers[key].type,
    (e) => (e.answers[key].confidence = 1.1),
    (e) => (e.answers[key].confidence = '0.8'),
    (e) => (e.answers[key].probabilities.supported = -1),
    (e) => (e.answers[key].probabilities.supported = 0.2),
    (e) => delete e.answers[key].probabilities.verify_more,
    (e) => (e.answers.extra = answer()),
  ];
  for (const mutate of mutations) {
    const data = good();
    mutate(data);
    assert.throws(() => validateReview(data, [key]), /검증/);
  }
  for (const data of [null, {}, [], { code: 0, data: { answers: { [key]: answer() } } }])
    assert.throws(() => validateReview(data, [key]), /검증/);
});
test('JEV 미설정·인증·요청 제한·타임아웃·비정상 JSON 오류', async () => {
  let calls = 0;
  const never = async () => {
    calls++;
    throw Error('must not fetch');
  };
  await assert.rejects(reviewWithJev({ sql }, {}, never), /JEV_API_KEY/);
  assert.equal(calls, 0);
  for (const [status, pattern] of [
    [400, /문맥 길이/],
    [401, /인증/],
    [403, /권한/],
    [413, /32 MiB/],
    [422, /질문 형식/],
    [429, /한도/],
    [529, /과부하/],
    [500, /HTTP 500/],
  ])
    await assert.rejects(
      reviewWithJev({ sql }, { key: 'test' }, async () => ({ ok: false, status })),
      pattern,
    );
  for (const name of ['TimeoutError', 'TypeError'])
    await assert.rejects(
      reviewWithJev({ sql }, { key: 'test' }, async () => {
        const e = new Error('private upstream text');
        e.name = name;
        throw e;
      }),
      name === 'TimeoutError' ? /60초/ : /연결하지 못했어요/,
    );
  await assert.rejects(
    reviewWithJev({ sql }, { key: 'test' }, async () => ({
      ok: true,
      json: async () => {
        throw Error('bad json');
      },
    })),
    /검증/,
  );
  await assert.rejects(
    reviewWithJev({ sql }, { key: 'test' }, async () => ({
      ok: true,
      json: async () => ({ code: 1, message: 'secret upstream' }),
    })),
    /검증/,
  );
});
test('JEV 연결 차단·DNS·인증서·시간 초과를 구분하고 내부 오류 내용은 노출하지 않는다', async () => {
  for (const [code, status, pattern] of [
    ['EACCES', 502, /외부 연결이 차단/],
    ['EPERM', 502, /외부 연결이 차단/],
    ['ENOTFOUND', 502, /주소를 찾지 못/],
    ['EAI_AGAIN', 502, /DNS/],
    ['SELF_SIGNED_CERT_IN_CHAIN', 502, /인증서/],
    ['UND_ERR_CONNECT_TIMEOUT', 504, /연결하는 동안 시간이 초과/],
    ['ECONNRESET', 502, /연결하지 못/],
  ]) {
    const cause = Object.assign(new Error('private upstream text'), { code });
    const error = new TypeError('private upstream text', { cause: new AggregateError([cause]) });
    await assert.rejects(
      reviewWithJev({ sql }, { key: 'test' }, async () => {
        throw error;
      }),
      (failure) => {
        assert.equal(failure.status, status);
        assert.match(failure.message, pattern);
        assert.doesNotMatch(failure.message, /private upstream text/);
        return true;
      },
    );
  }
  await assert.rejects(
    reviewWithJev({ sql }, { key: 'test' }, async () => ({
      ok: true,
      json: async () => {
        throw new DOMException('private upstream text', 'TimeoutError');
      },
    })),
    (failure) => {
      assert.equal(failure.status, 504);
      assert.match(failure.message, /60초/);
      return true;
    },
  );
});

test('32 KiB 초과 SQL도 공식 32 MiB 제한 내에서는 원문 그대로 전송', async () => {
  let calls = 0;
  const inspect = async (url, opts) => {
    calls++;
    assert.ok(Buffer.byteLength(opts.body, 'utf8') <= 32 * 1024 * 1024);
    return mock(url, opts);
  };
  await reviewWithJev({ sql: sql + ' --' + 'a'.repeat(17000) }, { key: 'test' }, inspect);
  assert.equal(calls, 1);
  const largeSql = sql + ' --' + '가'.repeat(17000);
  await reviewWithJev({ sql: largeSql }, { key: 'test' }, async (url, opts) => {
    assert.ok(Buffer.byteLength(opts.body, 'utf8') > 32768);
    assert.equal(JSON.parse(opts.body).state.sql, largeSql);
    return inspect(url, opts);
  });
  assert.equal(calls, 2);
});
test('전체 JSON 본문의 32 MiB UTF-8 바이트 경계를 정확히 검증', () => {
  const limit = 32 * 1024 * 1024,
    overhead = Buffer.byteLength(JSON.stringify({ state: '' }));
  const atLimit = 'x'.repeat(limit - overhead);
  assert.equal(Buffer.byteLength(encodeJevRequest({ state: atLimit })), limit);
  assert.throws(
    () => encodeJevRequest({ state: atLimit + 'x' }),
    (e) => e.status === 413 && /전송하지/.test(e.message),
  );
  assert.throws(
    () => encodeJevRequest({ state: '가'.repeat(Math.ceil(limit / 3)) }),
    (e) => e.status === 413,
  );
});
test('검토 입력은 단일 구문·컬럼 설정을 검증하며 임의 확정값을 생성하지 않음', async () => {
  const config = { key: 'test' };
  for (const body of [
    { sql: '' },
    { sql: 'x'.repeat(100001) },
    { sql: 'SELECT AMT FROM BILL' },
    { sql: 'CPFEE=ROUND(AMT,' },
    { sql: sql + '; UPDATE X SET CPFEE=1' },
    { sql, columns: { feeColumn: 'a.b' } },
  ])
    await assert.rejects(reviewWithJev(body, config, mock), (e) => e.status === 400);
  const result = await reviewWithJev(
    {
      sql: 'SELECT ROUND(AMT*CPRATE,0) 수수료, 0 부가세',
      columns: { feeColumn: '수수료', vatColumn: '부가세' },
    },
    config,
    mock,
  );
  assert.equal(result.fields.VAT_DVCD.value, 'ZERO');
});
test('이름 추천은 키·외부 호출 없이 선택 계산설정으로 3개 생성·검증', () => {
  const data = suggestNames({ sql, description: '페이코인' });
  assert.equal(data.candidates.length, 3);
  assert.equal(new Set(data.candidates.map((c) => c.code)).size, 3);
  for (const c of data.candidates) {
    assert.match(c.code, /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/);
    assert.ok(c.code.length <= 20);
    assert.ok([...c.name].length <= 20);
    assert.match(c.name, /페이코인/);
  }
  const changed = suggestNames({ sql, fields: { FEE_TYPE_DVCD: { value: 'FIXED' } } });
  assert.match(changed.candidates[0].code, /FIXED/);
  assert.ok(!JSON.stringify(suggestNames({ sql })).includes('페이코인'));
  for (const body of [
    { sql: 'CPFEE=ROUND(AMT,' },
    { sql, description: 42 },
    { sql, description: 'x'.repeat(2001) },
    { sql, fields: [] },
    { sql, fields: { FEE_TYPE_DVCD: { value: 'INVALID' } } },
    { sql, fields: { FEE_TYPE_DVCD: {} } },
  ])
    assert.throws(
      () => suggestNames(body),
      (e) => e.status === 400,
    );
});
test('HTTP 화면·설정·검토·로컬 이름 추천·잘못된 입력', async (t) => {
  let calls = 0;
  const server = createApp({
    config: { key: 'secret-not-for-browser' },
    fetchImpl: async (...args) => {
      calls++;
      return mock(...args);
    },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}`;
  const page = await fetch(url);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /AI 검토 요청/);
  assert.equal(calls, 0);
  const config = await (await fetch(url + '/api/config')).text();
  assert.ok(!config.includes('secret-not-for-browser'));
  assert.deepEqual(JSON.parse(config), { aiEnabled: true, provider: 'JEV', localNames: true });
  const post = (path, body, extra = {}) =>
    fetch(url + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...extra },
      body: JSON.stringify(body),
    });
  assert.equal((await post('/api/analyze-ai', { sql })).status, 200);
  assert.equal(calls, 1);
  assert.equal((await post('/api/suggest-names', { sql })).status, 200);
  assert.equal(calls, 1);
  assert.equal(
    (await post('/api/analyze-ai', { sql }, { Origin: 'http://evil.example' })).status,
    403,
  );
  assert.equal((await post('/api/analyze-ai', { sql: '' })).status, 400);
  assert.equal((await post('/api/analyze-ai', null)).status, 400);
  assert.equal(
    (await post('/api/analyze-ai', { sql }, { 'Content-Type': 'text/plain' })).status,
    415,
  );
  assert.equal((await fetch(url + '/.env')).status, 404);
});
test('JEV 미설정이어도 HTTP 로컬 이름 추천과 화면 사용 가능', async (t) => {
  const server = createApp({
    config: {},
    fetchImpl: async () => {
      throw Error('must not fetch');
    },
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await (await fetch(url + '/api/config')).json()).aiEnabled, false);
  for (const [path, status] of [
    ['/api/analyze-ai', 503],
    ['/api/suggest-names', 200],
  ])
    assert.equal(
      (
        await fetch(url + path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sql }),
        })
      ).status,
      status,
    );
});
