import test from 'node:test';
import assert from 'node:assert/strict';
import {
  rememberSample,
  sampleTestState,
  SAMPLE_HISTORY_LIMIT,
} from '../public/calculation/sample-session.js';

const record = (amount, status = 'match', expected = '') => ({
  input: {
    rows: [{ amount, count: '1', targetAmount: '' }],
    sourceRows: [{ AMT: amount }],
    feeValue: '0.015',
    expected: { fee: expected, vat: '' },
  },
  status,
});

test('동일한 예시를 반복 실행해도 검증 건수가 늘지 않고 결과만 갱신된다', () => {
  const first = record('9900');
  const history = rememberSample([], first);
  const next = rememberSample(history, record('9900', 'mismatch'));
  assert.equal(next.length, 1);
  assert.equal(next[0].status, 'mismatch');
  assert.equal(history[0], first);
  assert.equal(history[0].status, 'match');
});

test('계산대상·건수·원문 입력·기대값이 다른 테스트는 독립된 예시로 보관한다', () => {
  const first = record('9900');
  const variants = [
    record('9900', 'match', '148'),
    {
      ...first,
      input: { ...first.input, rows: [{ amount: '9900', count: '2', targetAmount: '' }] },
    },
    {
      ...first,
      input: { ...first.input, rows: [{ amount: '9900', count: '1', targetAmount: '5000' }] },
    },
    { ...first, input: { ...first.input, sourceRows: [{ AMT: '5000' }] } },
  ];
  let history = rememberSample([], first);
  for (const variant of variants) history = rememberSample(history, variant);
  assert.equal(history.length, 5);
});

test('입력을 수정하면 이전 일치 기록을 유지하면서 현재 입력은 재테스트 상태가 된다', () => {
  const history = [record('9900')];
  assert.equal(sampleTestState(history).status, 'match');
  const stale = sampleTestState(history, { dirty: true });
  assert.equal(stale.status, 'stale');
  assert.equal(stale.count, 1);
  assert.match(stale.text, /현재 입력 재테스트 필요/);
  assert.equal(sampleTestState([], { dirty: true }).status, 'stale');
  assert.equal(sampleTestState([]).status, 'untested');
});

test('새 예시가 일치해도 기존 불일치·비교 불가 기록을 숨기지 않는다', () => {
  assert.equal(sampleTestState([record('1', 'mismatch'), record('2')]).status, 'mismatch');
  assert.equal(sampleTestState([record('1', 'unavailable'), record('2')]).status, 'unavailable');
});

test('기록 한도를 넘겨도 기존 불일치 기록을 지우지 않고 같은 예시는 갱신할 수 있다', () => {
  let history = [];
  for (let index = 0; index < SAMPLE_HISTORY_LIMIT; index++)
    history = rememberSample(history, record(String(index), index === 0 ? 'mismatch' : 'match'));
  assert.equal(history.length, SAMPLE_HISTORY_LIMIT);
  assert.throws(() => rememberSample(history, record('new')), /50개/);
  assert.equal(history[0].status, 'mismatch');
  history = rememberSample(history, record('49'));
  assert.equal(history.length, SAMPLE_HISTORY_LIMIT);
  assert.equal(sampleTestState(history).status, 'mismatch');
});
