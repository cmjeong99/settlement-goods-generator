import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createHistoryStore,
  historySnapshot,
  HISTORY_KEY,
  HISTORY_LIMIT,
} from '../public/history.js';
import { analyze } from '../public/analyzer.js';
import { EXAMPLES } from '../public/examples.js';
import { buildFinalProduct } from '../public/final-product.js';

function fixture() {
  const data = new Map();
  let sequence = 0;
  const storage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
  };
  const options = { id: () => String(++sequence), now: () => '2026-11-09T01:00:00.000Z' };
  const source = analyze(EXAMPLES['오픈뱅킹 정률']).results[0];
  const draft = buildFinalProduct(
    source,
    { FEE_SMT_CALC_MHOD_DVCD: 'HALF_UP' },
    { code: 'MY-01', name: '내 상품' },
  );
  const snapshot = historySnapshot(draft, { sql: EXAMPLES['오픈뱅킹 정률'], tests: [] });
  return { data, storage, options, snapshot, draft };
}

test('등록 정보도 독립된 이력에 보관하고 서비스나 등록자가 달라지면 새 이력으로 남긴다', () => {
  const { storage, options, draft } = fixture();
  draft.registration = { SRVC_CD: '10603', REG_USER_ID: 'tester' };
  const history = createHistoryStore(storage, options);
  history.add(historySnapshot(draft, { sql: 'SELECT 1' }));
  draft.registration.SRVC_CD = '10602';
  assert.equal(history.read()[0].registration.SRVC_CD, '10603');
  history.add(historySnapshot(draft, { sql: 'SELECT 1' }));
  assert.equal(history.read().length, 2);
  assert.equal(history.read()[0].registration.REG_USER_ID, 'tester');
});

test('복사 시점의 최종 설정과 수식을 독립된 이력으로 저장하고 새 인스턴스에서도 읽는다', () => {
  const { storage, options, snapshot, draft } = fixture();
  const history = createHistoryStore(storage, options);
  const entry = history.add(snapshot);
  draft.result.fields.FEE_SMT_CALC_MHOD_DVCD.value = 'CEILING';
  assert.equal(
    createHistoryStore(storage).read()[0].fields.FEE_SMT_CALC_MHOD_DVCD.value,
    'HALF_UP',
  );
  assert.equal(entry.name.code, 'MY-01');
  assert.equal(entry.sql, EXAMPLES['오픈뱅킹 정률']);
  const read = history.read();
  read[0].name.name = '수정';
  assert.equal(history.read()[0].name.name, '내 상품');
});

test('같은 연속 복사는 중복을 만들지 않고 설정·이름·예시가 바뀌면 새 이력을 만든다', () => {
  const { storage, options, snapshot } = fixture();
  const history = createHistoryStore(storage, options);
  const original = history.add(snapshot);
  assert.equal(history.add(structuredClone(snapshot)).id, original.id);
  assert.equal(history.read().length, 1);
  const named = structuredClone(snapshot);
  named.name.name = '새 이름';
  history.add(named);
  const changed = structuredClone(named);
  changed.fields.SIGN_APLY_LOCT_DVCD.value = 'AFTER';
  history.add(changed);
  assert.equal(history.read().length, 3);
});

test('최신 50개만 보관하고 다른 localStorage 키를 읽거나 변경하지 않는다', () => {
  const { storage, options, snapshot, data } = fixture();
  data.set('unrelated', 'keep');
  const history = createHistoryStore(storage, options);
  for (let i = 0; i < HISTORY_LIMIT + 2; i++)
    history.add({ ...snapshot, name: { code: String(i), name: '상품' } });
  const entries = history.read();
  assert.equal(entries.length, HISTORY_LIMIT);
  assert.equal(entries[0].name.code, String(HISTORY_LIMIT + 1));
  assert.equal(entries.at(-1).name.code, '2');
  assert.equal(data.get('unrelated'), 'keep');
  assert.equal(data.size, 2);
});

test('저장 공간·접근 오류는 알리고 기존 이력을 덮어쓰지 않는다', () => {
  const { storage, options, snapshot, data } = fixture();
  const history = createHistoryStore(storage, options);
  history.add(snapshot);
  const original = data.get(HISTORY_KEY);
  const blocked = {
    ...storage,
    setItem() {
      throw new Error('quota');
    },
  };
  assert.throws(
    () => createHistoryStore(blocked, options).add({ ...snapshot, name: null }),
    /복사는 완료했지만/,
  );
  assert.equal(data.get(HISTORY_KEY), original);
  assert.throws(
    () =>
      createHistoryStore({
        getItem() {
          throw new Error('disabled');
        },
      }).read(),
    /읽을 수 없어요/,
  );
});

test('손상된 JSON·버전·필드·예시를 조용히 초기화하지 않는다', () => {
  const { storage, options, snapshot, data } = fixture();
  const history = createHistoryStore(storage, options);
  history.add(snapshot);
  const valid = JSON.parse(data.get(HISTORY_KEY));
  const badVersion = structuredClone(valid);
  badVersion.version = 2;
  const badField = structuredClone(valid);
  badField.entries[0].fields.FEE_TYPE_DVCD.value = 'INVALID';
  const badTest = structuredClone(valid);
  badTest.entries[0].tests = [{}];
  for (const raw of [
    'broken',
    JSON.stringify(badVersion),
    JSON.stringify(badField),
    JSON.stringify(badTest),
  ]) {
    data.set(HISTORY_KEY, raw);
    assert.throws(() => history.add(snapshot));
    assert.equal(data.get(HISTORY_KEY), raw);
  }
});
