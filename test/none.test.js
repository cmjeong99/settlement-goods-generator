import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Script, runInNewContext } from 'node:vm';
import { analyze } from '../public/analyzer.js';
import { FIELDS, describeField, exportRow } from '../public/domain.js';
import { EXAMPLES } from '../public/examples.js';
import { reviewWithJev, suggestNames } from '../ai.js';

const result = (sql) => analyze(sql).results[0];
const value = (r, key) => r.fields[key].value;

test('오픈뱅킹 정률은 절댓값 계산 후 부호를 재적용하지 않는 Y/NONE', () => {
  const r = result(EXAMPLES['오픈뱅킹 정률']);
  assert.equal(value(r, 'ABS_PROCS_YN'), 'Y');
  assert.equal(value(r, 'SIGN_APLY_LOCT_DVCD'), 'NONE');
  assert.equal(value(r, 'FEE_TYPE_DVCD'), 'RATE');
  assert.equal(value(r, 'FEE_SMT_CALC_MHOD_DVCD'), 'DOWN');
  assert.equal(value(r, 'VAT_SMT_CALC_MHOD_DVCD'), 'DOWN');
  assert.equal(value(r, 'VAT_CALC_TRGT_DVCD'), 'AMOUNT');
  assert.equal(r.fields.SIGN_APLY_LOCT_DVCD.status, 'known');
  assert.match(r.fields.SIGN_APLY_LOCT_DVCD.evidence[0].text, /ABS\(AMT\)/);
});

test('오픈뱅킹 정액은 거래 부호와 무관한 양수 단가를 Y/NONE으로 표현', () => {
  const r = result(EXAMPLES['오픈뱅킹 정액']);
  assert.equal(value(r, 'ABS_PROCS_YN'), 'Y');
  assert.equal(value(r, 'SIGN_APLY_LOCT_DVCD'), 'NONE');
  assert.equal(value(r, 'FEE_TYPE_DVCD'), 'FIXED');
  assert.equal(value(r, 'FRIM_BASE_DVCD'), null);
  assert.equal(value(r, 'FEE_SMT_CALC_MHOD_DVCD'), 'NONE');
  assert.equal(value(r, 'VAT_CALC_TRGT_DVCD'), 'FEE');
  assert.equal(value(r, 'VAT_SMT_CALC_MHOD_DVCD'), 'DOWN');
  assert.match(r.fields.ABS_PROCS_YN.reason, /정액 단가/);
});

test('수수료만 입력하거나 VAT가 0이어도 명시된 절댓값과 NONE을 인식', () => {
  for (const sql of ['CPFEE=FLOOR(ABS(AMT)*CPRATE)', 'CPFEE=FLOOR(ABS(AMT)*CPRATE), CPVAT=0']) {
    const r = result(sql);
    assert.equal(value(r, 'ABS_PROCS_YN'), 'Y');
    assert.equal(value(r, 'SIGN_APLY_LOCT_DVCD'), 'NONE');
  }
});

test('양수 결과를 입증할 수 없는 식을 부호 미적용으로 단정하지 않음', () => {
  for (const sql of [
    'CPFEE=FLOOR(AMT*CPRATE), CPVAT=FLOOR(AMT*CPRATE*.1)',
    'CPFEE=FLOOR(ABS(AMT)*CPRATE), CPVAT=FLOOR(ABS(AMT)*CPRATE*.1)*SIGN(AMT)',
    'CPFEE=FLOOR(COALESCE(ABS(AMT),-1)*CPRATE)',
    'CPFEE=CASE WHEN AMT<0 THEN -1 ELSE ABS(AMT)*CPRATE END',
    'CPFEE=FLOOR(ABS(AMT)*CPRATE), CPVAT=FLOOR(CPFEE*.1)',
  ])
    assert.equal(value(result(sql), 'SIGN_APLY_LOCT_DVCD'), null, sql);
});

test('기존 BEFORE와 AFTER 및 부호가 있는 수수료의 VAT 0을 구분', () => {
  assert.equal(
    value(result('CPFEE=ROUND(ABS(AMT)*CPRATE*SIGN(AMT),0)'), 'SIGN_APLY_LOCT_DVCD'),
    'BEFORE',
  );
  assert.equal(
    value(result('CPFEE=ROUND(ABS(AMT)*CPRATE,0)*SIGN(AMT)'), 'SIGN_APLY_LOCT_DVCD'),
    'AFTER',
  );
  assert.equal(
    value(result('CPFEE=ROUND(ABS(AMT)*CPRATE,0)*SIGN(AMT), CPVAT=0'), 'SIGN_APLY_LOCT_DVCD'),
    'AFTER',
  );
});

test('NONE의 화면 설명과 표 복사는 부호 미적용을 나타내며 원본 코드를 보존', () => {
  assert.ok(FIELDS.find(([key]) => key === 'SIGN_APLY_LOCT_DVCD')[2].includes('NONE'));
  const r = result(EXAMPLES['오픈뱅킹 정률']);
  assert.equal(
    describeField('SIGN_APLY_LOCT_DVCD', r.fields.SIGN_APLY_LOCT_DVCD),
    '부호를 다시 적용하지 않음',
  );
  const [headers, values] = exportRow(r, 'tsv')
    .split('\n')
    .map((row) => row.split('\t'));
  assert.equal(values[headers.indexOf('SIGN_APLY_LOCT_DVCD')], 'NONE');
  assert.match(exportRow(r), /\| NONE \|/);
  assert.equal(value(r, 'SIGN_APLY_LOCT_DVCD'), 'NONE');
});

test('로컬 상품명 추천은 NONE 설정을 유효한 값으로 받음', () => {
  const sql = EXAMPLES['오픈뱅킹 정률'];
  const fields = result(sql).fields;
  assert.equal(suggestNames({ sql, fields, description: '오픈뱅킹' }).candidates.length, 3);
});

test('JEV 검토는 NONE 후보와 단수 처리 유지 규칙을 전달', async () => {
  const sql = EXAMPLES['오픈뱅킹 정률'];
  let calls = 0;
  const response = await reviewWithJev({ sql }, { key: 'test' }, async (url, options) => {
    calls++;
    const request = JSON.parse(options.body);
    assert.equal(request.state.candidates.SIGN_APLY_LOCT_DVCD.value, 'NONE');
    assert.equal(request.state.candidates.ABS_PROCS_YN.value, 'Y');
    assert.match(request.state.rules, /NONE.*단수 처리는 유지/);
    assert.equal(request.state.sql, sql);
    return {
      ok: true,
      json: async () => ({
        model: 'jev-test',
        answers: Object.fromEntries(
          Object.keys(request.questions).map((key) => [
            key,
            {
              type: 'choice',
              choice: 'supported',
              confidence: 1,
              probabilities: { supported: 1, verify_more: 0, unsupported: 0 },
            },
          ]),
        ),
      }),
    };
  });
  assert.equal(calls, 1);
  assert.equal(response.fields.SIGN_APLY_LOCT_DVCD.value, 'NONE');
});

test('Confluence 매크로도 오픈뱅킹 정액과 정률을 NONE으로 내보냄', async () => {
  const html = await readFile(new URL('../public/confluence-macro.html', import.meta.url), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.doesNotThrow(() => new Script(script));
  const end = script.indexOf('const EXAMPLES =');
  assert.ok(end > 0);
  const context = {};
  runInNewContext(script.slice(0, end) + '\nglobalThis.api={analyze,exportRow,FIELDS};', context);
  assert.ok(context.api.FIELDS.find(([key]) => key === 'SIGN_APLY_LOCT_DVCD')[2].includes('NONE'));
  for (const name of ['오픈뱅킹 정액', '오픈뱅킹 정률']) {
    const outcome = context.api.analyze(EXAMPLES[name]);
    assert.equal(outcome.errors.length, 0);
    assert.equal(value(outcome.results[0], 'ABS_PROCS_YN'), 'Y');
    assert.equal(value(outcome.results[0], 'SIGN_APLY_LOCT_DVCD'), 'NONE');
    assert.ok(context.api.exportRow(outcome.results[0], 'tsv').endsWith('\tNONE'));
  }
});
