import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../public/analyzer.js';
import { tokenize, Parser } from '../public/parser.js';
import { EXAMPLES } from '../public/examples.js';
import { FIELDS, describeField, exportRow } from '../public/domain.js';
const result = (sql) => analyze(sql).results[0];
const value = (r, k) => r.fields[k].value;
test('제휴간편결제: 건별 반올림한 수수료로 VAT 계산', () => {
  const r = result(EXAMPLES['제휴간편결제']);
  assert.equal(value(r, 'FEE_SMT_CALC_MHOD_DVCD'), 'HALF_UP');
  assert.equal(value(r, 'VAT_CALC_TRGT_DVCD'), 'FEE');
  assert.equal(value(r, 'VAT_SMT_CALC_MHOD_DVCD'), 'DOWN');
  assert.equal(value(r, 'SIGN_APLY_LOCT_DVCD'), 'AFTER');
  assert.equal(value(r, 'ABS_PROCS_YN'), 'Y');
  assert.equal(r.fields.VAT_CALC_TRGT_DVCD.evidence[0].line, 3);
});
test('페이코인: 수수료 절사 / 반올림 전 금액 기반 VAT', () => {
  const r = result(EXAMPLES['페이코인']);
  assert.equal(value(r, 'FEE_SMT_CALC_MHOD_DVCD'), 'DOWN');
  assert.equal(value(r, 'VAT_CALC_TRGT_DVCD'), 'AMOUNT');
  assert.equal(value(r, 'SIGN_APLY_LOCT_DVCD'), 'AFTER');
});
test('모바일상품권 SELECT 별칭과 CAST 보존', () => {
  const r = result(EXAMPLES['모바일상품권']);
  assert.equal(value(r, 'FEE_SMT_CALC_BASE_DVCD'), 'SUM');
  assert.equal(value(r, 'VAT_SMT_CALC_BASE_DVCD'), 'SUM');
  assert.equal(value(r, 'VAT_CALC_TRGT_DVCD'), 'FEE');
  assert.equal(value(r, 'VAT_SMT_CALC_MHOD_DVCD'), 'HALF_UP');
  assert.ok(r.notices.some((n) => n.includes('CAST')));
});
test('주석, 대소문자, 테이블 별칭, 대괄호, AS 별칭', () => {
  const r = result(
    '-- 설명\nselect floor(a.[amt] * a.[cprate]) as [ramt], floor(a.[amt]*a.[cprate]*.1) as [vamt] from bill a;',
  );
  assert.equal(value(r, 'VAT_CALC_TRGT_DVCD'), 'AMOUNT');
  assert.equal(r.fields.FEE_TYPE_DVCD.evidence[0].line, 2);
});
test('SUM 밖 반올림과 SUM 안 반올림의 계산 단위를 구분', () => {
  assert.equal(value(result('CPFEE=ROUND(SUM(AMT)*CPRATE,0)'), 'FEE_SMT_CALC_BASE_DVCD'), 'SUM');
  assert.equal(value(result('CPFEE=SUM(ROUND(AMT*CPRATE,0))'), 'FEE_SMT_CALC_BASE_DVCD'), 'EACH');
});
test('ROUND 자리수는 GDS 계산단위로 변환', () => {
  for (const [digits, unit] of [
    [0, 0],
    [2, 2],
    [-2, -2],
  ])
    assert.equal(value(result(`CPFEE=ROUND(AMT*CPRATE,${digits})`), 'FEE_SMT_CALC_UNIT_VAL'), unit);
  assert.equal(
    value(result('CPFEE=ROUND(ABS(AMT)*CPRATE,-1,1)'), 'FEE_SMT_CALC_MHOD_DVCD'),
    'DOWN',
  );
});
test('ROUND 이전 부호 적용 위치', () => {
  const r = result('CPFEE=ROUND(ABS(AMT)*CPRATE*CASE WHEN AMT<0 THEN -1 ELSE 1 END,0)');
  assert.equal(value(r, 'SIGN_APLY_LOCT_DVCD'), 'BEFORE');
});
test('카드 조건식과 비자 차감식은 일반 VAT 반올림으로 확정하지 않음', () => {
  for (const name of ['카드', '비자사이버소스']) {
    const r = result(EXAMPLES[name]);
    assert.equal(r.fields.VAT_SMT_CALC_MHOD_DVCD.status, 'custom');
    assert.equal(value(r, 'VAT_CALC_TRGT_DVCD'), null);
  }
});
test('여러 UPDATE는 각각 반환하며 같은 UPDATE의 CPFEE 참조는 미확정', () => {
  assert.equal(analyze(EXAMPLES['여러 계산 구문']).results.length, 2);
  const r = result('UPDATE A SET CPFEE=ROUND(AMT*CPRATE,0), CPVAT=FLOOR(CPFEE*.1)');
  assert.equal(value(r, 'VAT_CALC_TRGT_DVCD'), null);
});
test('미지원 함수/CASE 수수료는 별도 계산', () => {
  const r = result('CPFEE=CASE WHEN AMT>1000 THEN ROUND(AMT*CPRATE,0) ELSE 100 END');
  assert.equal(r.fields.FEE_SMT_CALC_MHOD_DVCD.status, 'custom');
});
test('CONVERT 타입의 precision/scale과 ISNULL 함수 AST', () => {
  const p = new Parser(tokenize('ROUND(CONVERT(NUMERIC(18,2),ISNULL(AMT_R,AMT))*CPRATE,0)'));
  const ast = p.expr();
  assert.equal(ast.args[0].left.type, 'NUMERIC(18,2)');
  assert.equal(ast.args[0].left.args[0].name, 'ISNULL');
});
test('정액·집계 건수는 추측으로 SCOUNT를 부여하지 않음', () => {
  assert.equal(value(result('CPFEE=AUTHRATE'), 'FEE_TYPE_DVCD'), 'FIXED');
  const r = result('SELECT COUNT(*)*COST RAMT');
  assert.equal(value(r, 'FEE_TYPE_DVCD'), 'FIXED');
  assert.equal(value(r, 'FRIM_BASE_DVCD'), null);
});
test('상수 VAT 0', () => {
  const r = result('CPFEE=FLOOR(AMT*CPRATE), CPVAT=0');
  assert.equal(value(r, 'VAT_DVCD'), 'ZERO');
  assert.equal(value(r, 'VAT_CALC_TRGT_DVCD'), 'NONE');
});
test('불완전한 수식은 부분 AST를 정상 결과로 확정하지 않음', () => {
  const r = result('CPFEE=ROUND(AMT*CPRATE,');
  assert.ok(r.notices.length);
  assert.equal(value(r, 'FEE_SMT_CALC_MHOD_DVCD'), null);
  assert.ok(analyze("CPFEE='unterminated").errors.length);
  assert.ok(analyze('/* open').errors.length);
});
test('빈 입력과 과도한 중첩은 오류 반환', () => {
  assert.ok(analyze('').errors.length);
  assert.ok(analyze('CPFEE=' + '('.repeat(150) + '1' + ')'.repeat(150)).results[0].notices.length);
});
test('Markdown/TSV와 선택적 상품명', () => {
  const r = result(EXAMPLES['페이코인']);
  assert.match(exportRow(r), /FEE_SMT_CALC_MHOD_DVCD/);
  assert.equal(exportRow(r, 'tsv').split('\n').length, 2);
  assert.ok(!exportRow(r).includes('SMT_GDS_CD'));
  assert.ok(
    exportRow(r, 'tsv', { code: 'PAYCOIN-BASIC', name: '페이코인_일반' }).includes('SMT_GDS_CD'),
  );
});

test('WHERE 비교식을 계산 할당으로 읽지 않음', () => {
  const r = result('UPDATE A SET CPFEE=ROUND(AMT*CPRATE,0) WHERE CPVAT=0');
  assert.equal(value(r, 'VAT_DVCD'), null);
  assert.equal(analyze('SELECT AMT FROM BILL WHERE CPFEE=100').results.length, 0);
});
test('테이블 별칭이 다른 계산을 같은 수수료로 단정하지 않음', () => {
  const r = result('SELECT ROUND(a.AMT*a.CPRATE,0) RAMT, FLOOR(ROUND(b.AMT*b.CPRATE,0)*.1) VAMT');
  assert.equal(value(r, 'VAT_CALC_TRGT_DVCD'), null);
});
test('음수 FLOOR는 Java DOWN 대신 SIGNED_DOWN', () => {
  assert.equal(value(result('CPFEE=FLOOR(AMT*CPRATE)'), 'FEE_SMT_CALC_MHOD_DVCD'), 'SIGNED_DOWN');
  assert.equal(value(result('CPFEE=FLOOR(ABS(AMT)*CPRATE)'), 'FEE_SMT_CALC_MHOD_DVCD'), 'DOWN');
  assert.equal(
    value(
      result('CPFEE=FLOOR(ABS(AMT)*CPRATE*CASE WHEN AMT<0 THEN -1 ELSE 1 END)'),
      'FEE_SMT_CALC_MHOD_DVCD',
    ),
    'SIGNED_DOWN',
  );
});
test('함수 인수가 빠지거나 초과한 식은 미확정', () => {
  for (const sql of ['CPFEE=FLOOR()', 'CPFEE=ROUND(AMT)', 'CPFEE=ABS(AMT,2)']) {
    const r = result(sql);
    assert.ok(r.notices.length);
    assert.ok(Object.values(r.fields).every((c) => c.status === 'unknown'));
  }
});
test('사용자 지정 결과 컬럼과 원문 근거·기본 별칭', () => {
  const sql = '-- 설명\nSELECT ROUND(a.AMT*a.CPRATE,0) AS [수수료], 0 AS [부가세] FROM BILL a;';
  const r = analyze(sql, { feeColumn: '수수료', vatColumn: '부가세' }).results[0];
  assert.equal(value(r, 'FEE_TYPE_DVCD'), 'RATE');
  assert.equal(value(r, 'VAT_DVCD'), 'ZERO');
  assert.equal(r.fields.FEE_TYPE_DVCD.evidence[0].line, 2);
  assert.equal(analyze(sql).results.length, 0);
  for (const options of [
    { feeColumn: 'A.FEE' },
    { feeColumn: 'FEE', vatColumn: 'fee' },
    { feeColumn: 'CPVAT' },
    { feeColumn: 123 },
    null,
  ])
    assert.ok(analyze(sql, options).errors.length);
  assert.equal(value(result('CPFEE=ROUND(AMT*CPRATE,0)'), 'FEE_TYPE_DVCD'), 'RATE');
  for (const sql of [
    'SELECT 1 FEE_AMT, 2 FEE_AMT, 0 VAT_AMT',
    'SELECT ROUND(AMT*CPRATE,0) FEE_AMT +100, 0 VAT_AMT',
  ]) {
    const invalid = analyze(sql, { feeColumn: 'FEE_AMT', vatColumn: 'VAT_AMT' }).results[0];
    assert.ok(invalid.notices.length);
    assert.ok(Object.values(invalid.fields).every((cell) => cell.status === 'unknown'));
  }
});
test('백분율 수수료와 VAT /10 표현·SIGN 위치', () => {
  const r = result(EXAMPLES['백분율·VAT 나눗셈']);
  assert.equal(value(r, 'FEE_TYPE_DVCD'), 'RATE');
  assert.equal(value(r, 'VAT_CALC_TRGT_DVCD'), 'FEE');
  assert.equal(value(r, 'SIGN_APLY_LOCT_DVCD'), 'AFTER');
  assert.equal(value(r, 'VAT_SMT_CALC_MHOD_DVCD'), 'DOWN');
  assert.ok(
    r.notices.includes(
      '정수 나눗셈은 5 ÷ 2가 2로 계산될 수 있어요. 소수점 결과와 0으로 나누는 경우를 확인해 주세요.',
    ),
  );
  const amount = result(
    'CPFEE=ROUND(ABS(AMT)*CPRATE/100.0,0), CPVAT=FLOOR(ABS(AMT)*CPRATE/100.0/10.0)',
  );
  assert.equal(value(amount, 'VAT_CALC_TRGT_DVCD'), 'AMOUNT');
  const percent = result('CPFEE=ROUND(ABS(AMT)*CPRATE,0), CPVAT=FLOOR(ABS(AMT)*CPRATE*10/100.0)');
  assert.equal(value(percent, 'VAT_CALC_TRGT_DVCD'), 'AMOUNT');
  for (const expr of ['ROUND(AMT*(CPRATE/100.0),0)', 'ROUND(AMT*(CPRATE*.01),0)'])
    assert.equal(value(result(`CPFEE=${expr}`), 'FEE_TYPE_DVCD'), 'RATE');
});
test('단위 보정은 역수 관계인 10의 거듭제곱만 인정', () => {
  for (const [expr, method, unit] of [
    ['FLOOR(ABS(AMT)*CPRATE/10.0)*10', 'DOWN', -1],
    ['10*CEILING(ABS(AMT)*CPRATE/10.0)', 'CEILING', -1],
    ['ROUND(AMT*CPRATE/100.0,0)*100', 'HALF_UP', -2],
    ['ROUND(AMT*CPRATE*100,0)/100.0', 'HALF_UP', 2],
    ['ROUND(AMT*CPRATE/100.0,1)*100', 'HALF_UP', -1],
    ['FLOOR(AMT*CPRATE/10.0)*10', 'SIGNED_DOWN', -1],
  ]) {
    const r = result(`CPFEE=${expr}`);
    assert.equal(value(r, 'FEE_SMT_CALC_MHOD_DVCD'), method, expr);
    assert.equal(value(r, 'FEE_SMT_CALC_UNIT_VAL'), unit, expr);
  }
  for (const expr of [
    'ROUND(AMT*CPRATE,0)*2',
    'FLOOR(AMT*CPRATE/5.0)*5',
    'FLOOR(AMT*CPRATE/10.0)*100',
    'FLOOR(AMT*CPRATE/10.0)*-10',
  ])
    assert.equal(result(`CPFEE=${expr}`).fields.FEE_SMT_CALC_MHOD_DVCD.status, 'custom', expr);
  assert.equal(value(result('CPFEE=ROUND(AMT*CPRATE/1e12,12)*1e12'), 'FEE_SMT_CALC_UNIT_VAL'), 0);
  assert.equal(
    value(result('CPFEE=ROUND(AMT*CPRATE/1e12,-12)*1e12'), 'FEE_SMT_CALC_UNIT_VAL'),
    -24,
  );
  assert.equal(
    value(result('CPFEE=SUM(FLOOR(AMT*CPRATE/10.0)*10)'), 'FEE_SMT_CALC_BASE_DVCD'),
    'EACH',
  );
  assert.equal(
    value(result('CPFEE=FLOOR(SUM(AMT)*CPRATE/10.0)*10'), 'FEE_SMT_CALC_BASE_DVCD'),
    'SUM',
  );
  assert.equal(
    value(result('CPFEE=FLOOR(SUM(ABS(AMT))*CPRATE/10.0)*10'), 'FEE_SMT_CALC_MHOD_DVCD'),
    'DOWN',
  );
});
test('NULL 처리·조건 함수는 AST에 보존하고 복합 계산은 보수적으로 처리', () => {
  const r = result(EXAMPLES['십원 단위·NULL 처리']);
  assert.equal(value(r, 'FEE_SMT_CALC_UNIT_VAL'), -1);
  assert.ok(r.notices.some((n) => n.includes('NULL')));
  assert.equal(
    value(result('CPFEE=ROUND(ISNULL(AMT,0)*CPRATE/NULLIF(100,0),0)'), 'FEE_TYPE_DVCD'),
    'RATE',
  );
  for (const expr of ['IIF(AMT>0,ROUND(AMT*CPRATE,0),100)', 'COALESCE(ROUND(AMT*CPRATE,0),100)'])
    assert.equal(result(`CPFEE=${expr}`).fields.FEE_SMT_CALC_MHOD_DVCD.status, 'custom');
  for (const expr of ['SIGN()', 'NULLIF(AMT)', 'COALESCE(AMT)', 'IIF(AMT>0,1)'])
    assert.ok(result(`CPFEE=${expr}`).notices.length);
  assert.equal(
    value(result('CPFEE=ROUND(ABS(AMT)*CPRATE*SIGN(AMT),0)'), 'SIGN_APLY_LOCT_DVCD'),
    'BEFORE',
  );
  assert.equal(
    value(result('CPFEE=FLOOR(ABS(AMT)*CPRATE*-1)'), 'FEE_SMT_CALC_MHOD_DVCD'),
    'SIGNED_DOWN',
  );
});
test('정률·정액 혼합 분기나 가산식을 단순 정률로 확정하지 않음', () => {
  for (const expr of [
    'IIF(AMT>0,ROUND(AMT*CPRATE,0),100)',
    'CASE WHEN AMT>0 THEN ROUND(AMT*CPRATE,0) ELSE COST END',
    'COALESCE(ROUND(AMT*CPRATE,0),100)',
    'ROUND(AMT*CPRATE+100,0)',
  ])
    assert.equal(value(result(`CPFEE=${expr}`), 'FEE_TYPE_DVCD'), null, expr);
});
test('화면의 한글 설명은 코드값과 내보내기 데이터를 바꾸지 않음', () => {
  const r = result(EXAMPLES['제휴간편결제']);
  const before = JSON.stringify(r),
    tsv = exportRow(r, 'tsv'),
    markdown = exportRow(r);
  assert.equal(describeField('FEE_SMT_CALC_MHOD_DVCD', r.fields.FEE_SMT_CALC_MHOD_DVCD), '반올림');
  assert.equal(describeField('VAT_CALC_TRGT_DVCD', r.fields.VAT_CALC_TRGT_DVCD), '계산된 수수료');
  assert.equal(
    describeField('FEE_SMT_CALC_BASE_DVCD', r.fields.FEE_SMT_CALC_BASE_DVCD),
    '건별 계산',
  );
  assert.equal(describeField('FEE_SMT_CALC_UNIT_VAL', r.fields.FEE_SMT_CALC_UNIT_VAL), '1원 단위');
  assert.equal(JSON.stringify(r), before);
  assert.equal(exportRow(r, 'tsv'), tsv);
  assert.equal(exportRow(r), markdown);
  assert.ok(tsv.includes('HALF_UP'));
  assert.ok(!tsv.includes('반올림'));
});
test('단위·부호·미확정·미적용을 구분하며 모든 코드값에 화면 설명 제공', () => {
  for (const [unit, label] of [
    [0, '1원 단위'],
    [-1, '10원 단위'],
    [2, '0.01원 단위'],
  ])
    assert.equal(describeField('FEE_SMT_CALC_UNIT_VAL', { value: unit }), label);
  for (const [status, label] of [
    ['unknown', '수식만으로 알 수 없어요'],
    ['custom', '따로 계산해야 해요'],
    ['not-applicable', '사용하지 않아요'],
  ])
    assert.equal(describeField('FEE_SMT_CALC_UNIT_VAL', { value: null, status }), label);
  assert.equal(
    describeField('SIGN_APLY_LOCT_DVCD', { value: 'AFTER' }),
    '반올림·절사 후 부호 적용',
  );
  assert.equal(describeField('ABS_PROCS_YN', { value: 'N' }), '절대값으로 바꾸지 않음');
  for (const [key, , values] of FIELDS)
    for (const value of values ?? [])
      assert.notEqual(describeField(key, { value }), value, `${key}: ${value}`);
});
