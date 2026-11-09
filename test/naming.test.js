import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestNames } from '../public/naming.js';
import { resolveServiceIdentity } from '../public/service-catalog.js';
import { analyze } from '../public/analyzer.js';
import { buildFinalProduct } from '../public/final-product.js';
import { exportProductTable } from '../public/product-table.js';
import { PRODUCT_EXAMPLES } from '../public/product-examples.js';
import { EXAMPLES } from '../public/examples.js';

const sql = EXAMPLES['오픈뱅킹 정률'];
const source = () => analyze(sql).results[0];

test('문서의 서비스·세부서비스 명칭과 등록 코드를 상품명 추천에 반영한다', () => {
  for (const [SRVC_CD, DTLS_SRVC_CD, expectedName] of [
    ['10603', '00', '오픈뱅킹_건별정률_기본'],
    ['10602', '02', '계좌이체_케이뱅크_건별정률_기본'],
    ['12801', '04', '제휴간편결제_페이코포인트_건별정률_기본'],
    ['51102', 'HKG', '알리페이플러스_홍콩_건별정률_기본'],
  ]) {
    const [candidate] = suggestNames({ sql, registration: { SRVC_CD, DTLS_SRVC_CD } }).candidates;
    assert.equal(candidate.name, expectedName);
    assert.ok(candidate.code.startsWith(`${SRVC_CD}-${DTLS_SRVC_CD}-`));
    assert.ok(Array.from(candidate.name).length <= 100);
  }
});

test('선택한 추천명과 이후 직접 수정한 이름을 INSERT·엑셀·Markdown에 그대로 반영한다', () => {
  const product = PRODUCT_EXAMPLES.find((p) => p.code === 'OPENBANKING-RATE');
  const registration = { ...product.registration, REG_USER_ID: 'tester' };
  const [candidate] = suggestNames({ sql, registration }).candidates;
  for (const identity of [candidate, { ...candidate, name: '내가 수정한 상품명' }]) {
    const draft = buildFinalProduct(source(), {}, identity);
    for (const format of ['sql', 'tsv', 'markdown']) {
      const exported = exportProductTable(draft.result, format, draft.name, registration);
      assert.ok(exported.includes(identity.name), format);
      assert.ok(exported.includes(identity.code), format);
      assert.ok(!exported.includes('직접 만든 상품'), format);
    }
  }
});

test('사용자가 입력한 서비스 설명을 우선하고 문서에서 모호한 서비스명은 임의로 확정하지 않는다', () => {
  const [candidate] = suggestNames({
    sql,
    description: '나의 오픈뱅킹',
    registration: { SRVC_CD: '10603', DTLS_SRVC_CD: '00' },
  }).candidates;
  assert.equal(candidate.name, '나의 오픈뱅킹_건별정률_기본');
  for (const code of ['51104', '12052', '99999']) {
    const context = resolveServiceIdentity({ SRVC_CD: code, DTLS_SRVC_CD: '01' });
    assert.equal(context.serviceName, '');
    assert.ok(context.warning);
  }
  assert.equal(
    resolveServiceIdentity({ SRVC_CD: '12502', DTLS_SRVC_CD: '01' }).detailName,
    '헥토파이낸셜',
  );
});
