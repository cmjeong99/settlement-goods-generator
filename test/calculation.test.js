import test from 'node:test';
import assert from 'node:assert/strict';
import { Decimal } from '../public/calculation/decimal.js';
import { evaluateFormula, referencedColumns } from '../public/calculation/expression.js';
import { calculateSettings, verifyCalculation } from '../public/calculation/verify.js';
import { analyze } from '../public/analyzer.js';
import { EXAMPLES } from '../public/examples.js';
import { PRODUCT_EXAMPLES } from '../public/product-examples.js';

const result = (sql) => analyze(sql).results[0];
const evaluate = (sql, rows) =>
  evaluateFormula(result(`SELECT ${sql} AS CPFEE`).formulas.fee, rows).map(
    (value) => value?.toString() ?? null,
  );

test('소수 금액을 이진 부동소수점 오차 없이 계산하고 음수 단수 처리를 구분한다', () => {
  assert.equal(Decimal.parse('0.29').mul('100').round('SIGNED_DOWN').toString(), '29');
  for (const [method, expected] of [
    ['DOWN', '-148'],
    ['SIGNED_DOWN', '-149'],
    ['CEILING', '-148'],
    ['HALF_UP', '-149'],
    ['HALF_DOWN', '-148'],
  ])
    assert.equal(Decimal.parse('-148.5').round(method).toString(), expected);
  assert.equal(Decimal.parse('105').round('HALF_UP', '10').toString(), '110');
  assert.equal(Decimal.parse('1.005').round('HALF_UP', '0.01').toString(), '1.01');
  assert.throws(() => Decimal.parse('Infinity'));
  assert.throws(() => Decimal.parse('1e100000'));
});

test('지원하는 유한 소수 38자리까지 표시·재입력 때 값을 보존하고 순환소수만 생략한다', () => {
  for (const text of [
    '0.0000000000000000001',
    '-0.0000000000000000001',
    '0.' + '0'.repeat(37) + '1',
  ]) {
    const value = Decimal.parse(text);
    assert.equal(value.toString(), text);
    assert.equal(Decimal.parse(value.toString()).compare(value), 0);
  }
  assert.equal(Decimal.parse('1').div('3').toString(), '0.333333333333333333…');
  assert.throws(() => Decimal.parse('9'.repeat(121)), /120자/);
  assert.equal(Decimal.parse('9'.repeat(121), { maxLength: 1000 }).toString(), '9'.repeat(121));
});

for (const [amount, fee, vat, payout] of [
  ['-9900', '148', '14', '-10062'],
  ['-55000', '825', '82', '-55907'],
  ['9900', '148', '14', '9738'],
]) {
  test(`오픈뱅킹 ${amount}원 원문·설정·기대값을 대조한다`, () => {
    const r = result(EXAMPLES['오픈뱅킹 정률']);
    const verified = verifyCalculation(r, [{ AMT: amount, CPRATE: '0.015' }], {
      amountColumn: 'AMT',
      feeValue: '0.015',
      expected: { fee, vat, payout },
    });
    assert.deepEqual(verified.errors, []);
    for (const comparison of verified.comparisons) {
      assert.equal(comparison.settingsMatch, true);
      assert.equal(comparison.expectedMatch, true);
    }
  });
}

test('오픈뱅킹 정액은 취소에도 양수 수수료를 부과하고 DB 건수 설정으로 비교한다', () => {
  const product = PRODUCT_EXAMPLES.find((product) => product.code === 'OPENBANKING-FIXED');
  const fields = Object.fromEntries(
    Object.entries(product.expected).map(([key, value]) => [
      key,
      { status: value === null ? 'unknown' : 'known', value },
    ]),
  );
  const verified = verifyCalculation(
    result(EXAMPLES['오픈뱅킹 정액']),
    [{ AMT: '-9900', AUTHRATE: '100' }],
    { fields, amountColumn: 'AMT', feeValue: '100', countPerRow: '1' },
  );
  assert.deepEqual(
    verified.comparisons.map((row) => row.sql),
    ['100', '10', '-10010'],
  );
  assert.ok(verified.comparisons.every((row) => row.settingsMatch === true));
});

test('건별 단수 처리 후 합산과 합산 후 단수 처리는 서로 다른 결과를 낸다', () => {
  const rows = [
    { AMT: '99', CPRATE: '0.015' },
    { AMT: '99', CPRATE: '0.015' },
  ];
  assert.deepEqual(evaluate('SUM(FLOOR(AMT*CPRATE))', rows), ['2']);
  assert.deepEqual(evaluate('FLOOR(SUM(AMT)*CPRATE)', rows), ['2']);
  assert.deepEqual(evaluate('SUM(ROUND(AMT*CPRATE,0))', rows), ['2']);
  assert.deepEqual(evaluate('ROUND(SUM(AMT)*CPRATE,0)', rows), ['3']);
  assert.throws(
    () => evaluate('SUM(AMT)*CPRATE', [...rows.slice(0, 1), { AMT: '99', CPRATE: '0.02' }]),
    /행마다 달라/,
  );
});

test('반올림·ROUND 세 번째 인수·명시적 정수 나눗셈·소수 나눗셈을 구분한다', () => {
  assert.deepEqual(evaluate('ROUND(-1.15,1)', [{}]), ['-1.2']);
  assert.deepEqual(evaluate('ROUND(-1.15,1,1)', [{}]), ['-1.1']);
  assert.deepEqual(evaluate('5/2', [{}]), ['2']);
  assert.deepEqual(evaluate('-5/2', [{}]), ['-2']);
  assert.deepEqual(evaluate('5/2.0', [{}]), ['2.5']);
  assert.deepEqual(evaluate('CAST(5 AS INT)/CAST(2 AS INT)', [{}]), ['2']);
  assert.deepEqual(evaluate('CONVERT(NUMERIC(18,2),1.005)', [{}]), ['1.01']);
  assert.throws(() => evaluate('1/0', [{}]), /0으로/);
});

test('CASE·IN·RIGHT·NULL·집계가 포함된 카드와 본인확인 표현식을 계산한다', () => {
  const card = result(EXAMPLES['카드']);
  assert.equal(
    evaluateFormula(card.formulas.vat, [{ AMT: '10400', CPRATE: '0.015' }])[0].toString(),
    '16',
  );
  assert.deepEqual(
    evaluate("CASE WHEN CNT_TYPE IN ('S','T') THEN CNT*RATE ELSE 0 END", [
      { CNT_TYPE: 'S', CNT: '3', RATE: '10' },
    ]),
    ['30'],
  );
  assert.deepEqual(evaluate('ISNULL(AMT_R,AMT)', [{ AMT_R: null, AMT: '-10' }]), ['-10']);
  assert.deepEqual(evaluate('SUM(AMT)', [{ AMT: null }, { AMT: '10' }]), ['10']);
  assert.deepEqual(evaluate('SUM(AMT)', [{ AMT: null }]), [null]);
  assert.deepEqual(evaluate('NULLIF(AMT,0)', [{ AMT: '0' }]), [null]);
});

test('정수 함수·집계 이후 나눗셈에서도 SQL 정수 타입을 유지한다', () => {
  for (const expression of ['ABS(5)/2', 'FLOOR(5)/2', 'CEILING(5)/2', 'ROUND(5,0)/2', '(5%3)/2'])
    assert.deepEqual(
      evaluate(expression, [{}]),
      [expression.includes('%') ? '1' : '2'],
      expression,
    );
  const rows = [{ AMT: '1' }, { AMT: '2' }, { AMT: '2' }];
  assert.deepEqual(evaluate('COUNT(*)/2', rows), ['1']);
  assert.deepEqual(evaluate('COUNT(AMT)/2', rows), ['1']);
  assert.deepEqual(evaluate('SUM(CAST(AMT AS INT))/2', rows), ['2']);
  assert.deepEqual(evaluate('AVG(CAST(AMT AS INT))', rows), ['1']);
  assert.deepEqual(evaluate('AVG(CAST(AMT AS INT))', [{ AMT: '-1' }, { AMT: '-2' }]), ['-1']);
  assert.deepEqual(evaluate('AVG(CAST(AMT AS DECIMAL(18,2)))', rows), ['1.666667']);
  assert.deepEqual(evaluate('ABS(5.0)/2', [{}]), ['2.5']);
  assert.deepEqual(evaluate('ABS(CAST(-32768 AS SMALLINT))', [{}]), ['32768']);
  assert.deepEqual(evaluate('ROUND(CAST(255 AS TINYINT),-1)', [{}]), ['260']);
});

test('정수 CAST와 SUM의 타입 범위를 넘으면 계산 불가로 처리한다', () => {
  for (const expression of [
    'CAST(256 AS TINYINT)',
    'CAST(-1 AS TINYINT)',
    'CAST(32768 AS SMALLINT)',
    'CAST(2147483648 AS INT)',
    'CAST(9223372036854775808 AS BIGINT)',
    'ABS(CAST(-2147483648 AS INT))',
  ])
    assert.throws(() => evaluate(expression, [{}]), /범위를 벗어났어요/, expression);
  assert.deepEqual(evaluate('CAST(255 AS TINYINT)', [{}]), ['255']);
  assert.deepEqual(evaluate('CAST(-9223372036854775808 AS BIGINT)', [{}]), [
    '-9223372036854775808',
  ]);
  assert.throws(() => evaluate("CAST('1.2' AS INT)", [{}]), /정수 문자열/);
  assert.throws(
    () => evaluate('SUM(CAST(AMT AS INT))', [{ AMT: '2147483647' }, { AMT: '1' }]),
    /범위를 벗어났어요/,
  );
  assert.deepEqual(evaluate('SUM(CAST(AMT AS BIGINT))', [{ AMT: '2147483647' }, { AMT: '1' }]), [
    '2147483648',
  ]);
});

test('DECIMAL 정밀도·소수 자릿수와 반올림 후 범위를 검증한다', () => {
  for (const expression of [
    'CAST(1 AS DECIMAL(0,0))',
    'CAST(1 AS DECIMAL(39,0))',
    'CAST(1 AS DECIMAL(3,4))',
  ])
    assert.throws(() => evaluate(expression, [{}]), /자릿수/, expression);
  for (const expression of ['CAST(1000 AS DECIMAL(3,0))', 'CAST(99.999 AS DECIMAL(4,2))'])
    assert.throws(() => evaluate(expression, [{}]), /범위를 벗어났어요/, expression);
  assert.deepEqual(evaluate('CAST(99.994 AS DECIMAL(4,2))', [{}]), ['99.99']);
  assert.deepEqual(evaluate('CAST(1.5 AS DECIMAL)', [{}]), ['2']);
  assert.deepEqual(evaluate('CAST(1.5 AS DECIMAL(3))', [{}]), ['2']);
  assert.throws(() => evaluate('ROUND(CAST(748.58 AS DECIMAL(5,2)),-3)', [{}]), /범위를/);
});

test('별칭이 다른 입력과 갱신 전 수수료 참조는 독립된 값으로 취급한다', () => {
  const r = result('UPDATE A SET CPFEE=FLOOR(A.AMT*A.CPRATE),CPVAT=FLOOR(A.CPFEE*0.1)');
  assert.deepEqual(referencedColumns(r.formulas), ['A.AMT', 'A.CPFEE', 'A.CPRATE']);
  assert.equal(
    evaluateFormula(r.formulas.vat, [
      { 'A.AMT': '9900', 'A.CPRATE': '0.015', 'A.CPFEE': '100' },
    ])[0].toString(),
    '10',
  );
  assert.throws(() => evaluateFormula(r.formulas.fee, [{ AMT: '9900', CPRATE: '0.015' }]), /A.AMT/);
});

test('미확정·특이 계산기·미지원 함수·빠진 입력을 임의 값으로 계산하지 않는다', () => {
  const r = result('SELECT OTHER(AMT) AS CPFEE,0 AS CPVAT');
  const output = verifyCalculation(r, [{ AMT: '100' }], { amountColumn: 'AMT', feeValue: '0.015' });
  assert.equal(output.comparisons[0].sql, '계산 불가');
  assert.ok(output.errors.some((error) => error.includes('OTHER')));
  assert.throws(
    () =>
      calculateSettings({}, [{ AMT: '10' }], {
        amountColumn: 'AMT',
        feeValue: '1',
        engine: 'CUSTOM',
      }),
    /특이 계산기/,
  );
  assert.throws(() => evaluate('MISSING+1', [{}]), /입력값/);
  assert.throws(
    () =>
      evaluate(
        'AMT',
        [...Array(101)].map(() => ({ AMT: '1' })),
      ),
    /100행/,
  );
  const nullOutput = verifyCalculation(result('SELECT AMT AS CPFEE,0 AS CPVAT'), [{ AMT: null }], {
    feeValue: '1',
  });
  assert.equal(nullOutput.comparisons[0].sql, 'NULL');
});

test('BEFORE·AFTER·NONE에 따른 음수 FLOOR 차이를 원문과 대조한다', () => {
  for (const sql of [
    'FLOOR(ABS(AMT)*CPRATE)*SIGN(AMT)',
    'FLOOR(ABS(AMT)*CPRATE*SIGN(AMT))',
    'FLOOR(ABS(AMT)*CPRATE)',
  ]) {
    const r = result(`SELECT ${sql} AS CPFEE,0 AS CPVAT`);
    const output = verifyCalculation(r, [{ AMT: '-9900', CPRATE: '0.015' }], {
      amountColumn: 'AMT',
      feeValue: '0.015',
    });
    assert.equal(output.comparisons[0].settingsMatch, true, sql);
  }
});
