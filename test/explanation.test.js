import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../public/analyzer.js';
import { explainCalculation, exportRow } from '../public/domain.js';
import { EXAMPLES } from '../public/examples.js';

const result = (sql) => analyze(sql).results[0];

test('오픈뱅킹 정률 풀이에 단수 처리 전 VAT와 부호 미적용을 문장으로 설명', () => {
  const r = result(EXAMPLES['오픈뱅킹 정률']);
  const before = JSON.stringify(r),
    copied = exportRow(r, 'tsv');
  const [fee, vat, sign] = explainCalculation(r);
  assert.match(fee, /거래마다.*요율.*수수료/);
  assert.match(fee, /1원 단위로 절사/);
  assert.match(vat, /단수 처리를 하기 전.*요율과 10%/);
  assert.match(sign, /절댓값/);
  assert.match(sign, /부호는 다시 붙이지 않아요/);
  assert.equal(JSON.stringify(r), before);
  assert.equal(exportRow(r, 'tsv'), copied);
});

test('정액의 미확정 건수와 반올림 NONE은 계산 생략으로 설명하지 않음', () => {
  const [fee, vat] = explainCalculation(result(EXAMPLES['오픈뱅킹 정액']));
  assert.match(fee, /정해진 단가/);
  assert.match(fee, /성공 건수인지 시도 건수인지는 추가 확인/);
  assert.match(fee, /별도 반올림이나 절사는 적용하지 않아요/);
  assert.doesNotMatch(fee, /수수료를 계산하지/);
  assert.match(vat, /계산된 수수료에 10%/);
});

test('합산 후 계산과 건별 단수 처리 후 합산을 구분', () => {
  const [sumFee, sumVat] = explainCalculation(result(EXAMPLES['모바일상품권']));
  assert.match(sumFee, /합산한 뒤 요율/);
  assert.match(sumVat, /합산 기준으로 계산된 수수료/);
  assert.doesNotMatch(sumVat, /거래별로 계산한 수수료를 합산/);
  const [eachFee] = explainCalculation(result('SELECT SUM(ROUND(ABS(AMT)*CPRATE,0)) AS RAMT'));
  assert.match(eachFee, /거래마다/);
  assert.ok(eachFee.indexOf('반올림해요') < eachFee.indexOf('마지막에 합산'));
});

test('소수 단위와 VAT 0을 설정 그대로 설명', () => {
  const [fee, vat] = explainCalculation(result('CPFEE=ROUND(ABS(AMT)*CPRATE,2), CPVAT=0'));
  assert.match(fee, /0\.01원 단위로 반올림/);
  assert.equal(vat, '부가세는 0원으로 처리해요.');
});

test('미확정·별도 계산 항목에 계산 방식이나 기본 단위를 만들어 넣지 않음', () => {
  const [fee] = explainCalculation(
    result('CPFEE=CASE WHEN AMT>0 THEN ROUND(AMT*CPRATE,0) ELSE 100 END'),
  );
  assert.match(fee, /확정할 수 없어요/);
  assert.match(fee, /별도 계산/);
  assert.doesNotMatch(fee, /거래마다|1원 단위/);
});

test('기존 BEFORE와 AFTER를 서로 다른 적용 순서로 설명', () => {
  const before = explainCalculation(result('CPFEE=ROUND(ABS(AMT)*CPRATE*SIGN(AMT),0)'))[2];
  const after = explainCalculation(result('CPFEE=ROUND(ABS(AMT)*CPRATE,0)*SIGN(AMT)'))[2];
  assert.match(before, /반올림·절사 전에 적용/);
  assert.match(after, /반올림·절사 후에 적용/);
});
