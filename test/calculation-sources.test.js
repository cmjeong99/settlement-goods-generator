import test from 'node:test';
import assert from 'node:assert/strict';
import { PRODUCT_EXAMPLES } from '../public/product-examples.js';
import { analyze } from '../public/analyzer.js';
import { tokenize } from '../public/parser.js';

const byCode = new Map(PRODUCT_EXAMPLES.map((p) => [p.code, p]));

test('55개 상품에 실제 계산 단계·확인 상태·출처를 기록하고 NULL을 확정값으로 표시하지 않는다', () => {
  assert.equal(byCode.size, 55);
  for (const product of PRODUCT_EXAMPLES) {
    assert.ok(
      ['verified', 'conditional', 'unverified'].includes(product.calculation.status),
      product.code,
    );
    assert.ok(product.calculation.summary);
    assert.ok(product.sources.some((source) => source.active));
    for (const source of product.sources) {
      assert.equal(typeof source.active, 'boolean');
      assert.ok(source.stage);
      assert.ok(product.sql.includes(source.name));
    }
    for (const result of analyze(product.sql, { inputScope: product.inputScope }).results)
      for (const [key, field] of Object.entries(result.fields))
        if (field.status === 'known') assert.notEqual(field.value, null, product.code + '/' + key);
  }
});

test('금액 합산 상품의 거래내역 식은 주석이며 집계·지급 계산이 본문이다', () => {
  for (const code of [
    'BOOKNLIFEGIFT-BASIC',
    'CULTUREGIFT-BASIC',
    'CULTUREGIFT-OVERSEAS',
    'MOBILEGIFT-BASIC',
    'MOBILE-BASIC-SUM',
  ]) {
    const product = byCode.get(code);
    assert.ok(
      product.sources.some((s) => s.stage.includes('거래 계산') && !s.active),
      code,
    );
    assert.ok(
      product.sources.some((s) => s.active && s.stage === '집계 계산'),
      code,
    );
    const result = analyze(product.sql, { inputScope: product.inputScope }).results[0];
    if (!code.startsWith('MOBILE-BASIC'))
      assert.equal(result.fields.FEE_SMT_CALC_BASE_DVCD.value, 'SUM', code);
  }
});

test('휴대폰 후처리의 주석 거래식이 별도 결과로 재분석되지 않고 현행 출처를 사용한다', () => {
  for (const code of [
    'MOBILE-EACH-VAT-RND',
    'MOBILE-EACH-VAT-SUM',
    'MOBILE-TIMONET',
    'MOBILE-FIXED-INCL',
    'MOBILE-RATE-INCL',
  ]) {
    const product = byCode.get(code);
    assert.equal(analyze(product.sql).results.length, 1, code);
    assert.ok(
      product.sources.some((s) => s.stage.includes('거래 계산') && !s.active),
      code,
    );
    const activeTokens = tokenize(product.sql)
      .map((t) => t.value)
      .join(' ');
    assert.ok(activeTokens.includes('SUM') || code === 'MOBILE-FIXED-INCL', code);
  }
  const monthly = byCode.get('MOBILE-BASIC-SUM');
  assert.ok(
    monthly.sources.some(
      (s) => s.active && s.name === 'JUNGSAN.dbo.JOB_TB_BILL_STATUS_4_REGMON_TELEDIT',
    ),
  );
  assert.ok(monthly.sources.filter((s) => s.name.includes('DV_')).every((s) => !s.active));
});

test('다른 서비스와 비활성 분기를 실제 집계 근거로 대체하지 않고 미확인 사항을 남긴다', () => {
  const overseas = byCode.get('CULTUREGIFT-OVERSEAS');
  assert.ok(overseas.sources.every((s) => s.name !== 'ACCOUNT.dbo.fms_inMonSale'));
  assert.equal(overseas.calculation.status, 'conditional');
  for (const p of PRODUCT_EXAMPLES.filter(
    (p) =>
      p.code.startsWith('BOKU-') || p.code.startsWith('ALIPAYPLUS-') || p.code === 'WECHAT-OFFLINE',
  )) {
    assert.equal(p.calculation.status, 'unverified');
    assert.ok(p.calculation.unresolved);
  }
});
