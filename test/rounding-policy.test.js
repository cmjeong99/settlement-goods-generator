import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../public/analyzer.js';
import { EXAMPLES } from '../public/examples.js';
import { buildFinalProduct } from '../public/final-product.js';
import { NULL_OVERRIDE } from '../public/domain.js';
import {
  unitCode,
  readRoundingPolicy,
  roundingChanges,
  roundingPreview,
} from '../public/rounding-policy.js';

test('사용자가 고른 원 단위를 상품 코드로 바꾸며 잘못된 금액은 거부한다', () => {
  assert.equal(unitCode('1'), 0);
  assert.equal(unitCode('1,000'), 1000);
  assert.equal(unitCode('0.01'), 0.01);
  for (const input of ['', '0', '-1', 'NaN', 'Infinity', '1000000000001'])
    assert.throws(() => unitCode(input));
});

test('선택한 수수료 계산 방식만 함께 적용하고 원문과 부가세 설정은 유지한다', () => {
  const source = analyze(EXAMPLES['오픈뱅킹 정률']).results[0];
  const before = structuredClone(source);
  const initial = readRoundingPolicy(source.fields, 'FEE');
  assert.deepEqual(initial, { method: 'DOWN', unit: 0, base: 'EACH' });
  assert.deepEqual(roundingChanges(source.fields, 'FEE', initial), {});
  const policy = { method: 'HALF_UP', unit: unitCode('10'), base: 'SUM' };
  const changes = roundingChanges(source.fields, 'FEE', policy);
  assert.deepEqual(changes, {
    FEE_SMT_CALC_MHOD_DVCD: 'HALF_UP',
    FEE_SMT_CALC_BASE_DVCD: 'SUM',
    FEE_SMT_CALC_UNIT_VAL: '10',
  });
  const current = buildFinalProduct(source, changes);
  assert.deepEqual(current.errors, []);
  assert.deepEqual(readRoundingPolicy(current.result.fields, 'FEE'), policy);
  for (const key of Object.keys(source.fields).filter((key) => !(key in changes)))
    assert.deepEqual(current.result.fields[key], source.fields[key]);
  assert.deepEqual(source, before);
});

test('단수 처리 없음은 미사용 단위를 새로 확정하거나 덮어쓰지 않는다', () => {
  const source = analyze(EXAMPLES['오픈뱅킹 정률']).results[0];
  const changes = roundingChanges(source.fields, 'VAT', {
    method: 'NONE',
    unit: null,
    base: null,
  });
  assert.deepEqual(changes, { VAT_SMT_CALC_MHOD_DVCD: 'NONE' });
  assert.deepEqual(roundingPreview({ method: 'NONE', unit: null }, '148.5'), {
    positive: '148.5',
    negative: '-148.5',
  });
  const unknown = { FEE_SMT_CALC_MHOD_DVCD: { status: 'unknown', value: null } };
  assert.deepEqual(readRoundingPolicy(unknown, 'FEE'), { method: null, unit: null, base: null });
  assert.deepEqual(roundingChanges(unknown, 'FEE', { method: null, unit: null, base: null }), {});
  assert.equal(roundingPreview({ method: 'DOWN', unit: null }, '148.5'), null);
});

test('방식·단위·VAT 기준의 명시적 NULL을 미선택이나 코드 NONE으로 바꾸지 않는다', () => {
  const source = analyze(EXAMPLES['오픈뱅킹 정률']).results[0];
  const changes = roundingChanges(source.fields, 'VAT', {
    method: NULL_OVERRIDE,
    unit: NULL_OVERRIDE,
    base: NULL_OVERRIDE,
  });
  assert.deepEqual(changes, {
    VAT_SMT_CALC_MHOD_DVCD: NULL_OVERRIDE,
    VAT_SMT_CALC_BASE_DVCD: NULL_OVERRIDE,
    VAT_SMT_CALC_UNIT_VAL: NULL_OVERRIDE,
  });
  const draft = buildFinalProduct(source, changes);
  assert.deepEqual(draft.errors, []);
  assert.deepEqual(readRoundingPolicy(draft.result.fields, 'VAT'), {
    method: NULL_OVERRIDE,
    unit: NULL_OVERRIDE,
    base: NULL_OVERRIDE,
  });
  assert.deepEqual(
    roundingChanges(draft.result.fields, 'VAT', readRoundingPolicy(draft.result.fields, 'VAT')),
    {},
  );
  assert.equal(roundingPreview({ method: NULL_OVERRIDE, unit: NULL_OVERRIDE }, '148.5'), null);
  assert.equal(roundingPreview({ method: 'DOWN', unit: NULL_OVERRIDE }, '148.5'), null);
  assert.deepEqual(
    roundingChanges(source.fields, 'FEE', { method: 'NONE', unit: NULL_OVERRIDE, base: 'EACH' }),
    { FEE_SMT_CALC_MHOD_DVCD: 'NONE', FEE_SMT_CALC_UNIT_VAL: NULL_OVERRIDE },
  );
});

test('양수와 음수 예시로 절사·반올림·올림의 차이를 보여준다', () => {
  const expected = {
    DOWN: ['148', '-148'],
    HALF_UP: ['149', '-149'],
    CEILING: ['149', '-148'],
    HALF_DOWN: ['148', '-148'],
    SIGNED_DOWN: ['148', '-149'],
  };
  for (const [method, [positive, negative]] of Object.entries(expected))
    assert.deepEqual(roundingPreview({ method, unit: 0 }, '148.5'), { positive, negative });
  assert.deepEqual(roundingPreview({ method: 'HALF_UP', unit: 10 }, '148.5'), {
    positive: '150',
    negative: '-150',
  });
  assert.deepEqual(roundingPreview({ method: 'DOWN', unit: 0.01 }, '148.599'), {
    positive: '148.59',
    negative: '-148.59',
  });
  assert.throws(() => roundingPreview({ method: 'DOWN', unit: 0 }, '금액 오류'));
});
