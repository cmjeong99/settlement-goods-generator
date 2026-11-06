import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { extract, lineAt } from '../public/parser.js';
import { FIELDS } from '../public/domain.js';
import { sourcesForProduct } from './product-source-map.js';

const [productPath, ...procedurePaths] = process.argv.slice(2);
if (!productPath || !procedurePaths.length)
  throw new Error(
    '사용법: node scripts/import-product-examples.js products.json procedures.json [extra.json]',
  );
const products = JSON.parse(await readFile(productPath, 'utf8'));
const procedures = (
  await Promise.all(procedurePaths.map(async (path) => JSON.parse(await readFile(path, 'utf8'))))
).flat();
const sourceMap = new Map(
  procedures.map((row) => [`${row.database_name}.dbo.${row.procedure_name}`, row.definition]),
);

function expressionAt(reference) {
  const definition = sourceMap.get(reference.source);
  if (!definition) throw new Error(`SP 없음: ${reference.source}`);
  if (reference.projection) {
    for (const expression of Object.values(reference.projection)) {
      if (!definition.split(/\r?\n/)[reference.line - 1]?.includes(expression))
        throw new Error(`SELECT 위치 불일치: ${reference.source}:${reference.line}`);
    }
    return reference.projection;
  }
  const source = reference.selectLines
    ? 'SELECT\n' +
      definition
        .split(/\r?\n/)
        .slice(reference.selectLines[0] - 1, reference.selectLines[1])
        .join('\n')
        .replace(/^\s*,/, '')
    : definition;
  const blocks = extract(source, reference.columns);
  const block = reference.selectLines
    ? blocks.find((block) => block.formulas.fee)
    : blocks.find((block) =>
        Object.values(block.formulas).some(
          (node) => lineAt(definition, node.start) === reference.line,
        ),
      );
  if (!block || block.errors.length)
    throw new Error(`수식 추출 실패: ${reference.source}:${reference.line}`);
  const entries = Object.entries(block.formulas).filter(
    ([key]) => !reference.vatOnly || key === 'vat',
  );
  return Object.fromEntries(
    entries.map(([key, node]) => [key, source.slice(node.start, node.end)]),
  );
}

const result = products.map((product) => {
  const references = sourcesForProduct(product.SMT_GDS_CD);
  if (!references) throw new Error(`출처 매핑 없음: ${product.SMT_GDS_CD}`);
  let identifier = 0;
  const sources = references.map((reference) => ({
    name: reference.source,
    line: reference.line,
    note: reference.note ?? '',
    hash: createHash('sha256').update(sourceMap.get(reference.source)).digest('hex'),
  }));
  const sql = references
    .map((reference, index) => {
      const formulas = expressionAt(reference);
      const expressions = Object.entries(formulas).map(
        ([key, expression]) =>
          `${expression.replace(/'[A-Z0-9]{9,}'/g, () => `'EXAMPLE_CP_${++identifier}'`)} AS ${key === 'fee' ? 'CPFEE' : 'CPVAT'}`,
      );
      return `-- ${reference.source}:${reference.line}\n-- ${reference.note ?? ''}\nSELECT\n  ${expressions.join(',\n  ')};`;
    })
    .join('\n\n');
  return {
    code: product.SMT_GDS_CD,
    name: product.SMT_GDS_NM,
    serviceCode: product.SRVC_CD,
    detailServiceCode: product.DTLS_SRVC_CD,
    engine: product.CALC_ENGE_DVCD,
    settlement: { paymentMethod: product.PAYM_MHOD_DVCD, feeCollection: product.FEE_RCVG_DVCD },
    expected: Object.fromEntries(
      FIELDS.map(([key, , values]) => [
        key,
        product[key] === null ? null : values ? product[key] : Number(product[key]),
      ]),
    ),
    sources,
    sql,
  };
});
if (new Set(result.map((row) => row.code)).size !== result.length)
  throw new Error('중복 상품코드가 있습니다.');
const snapshotDate = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
const module = `// Generated from read-only DB exports. Run scripts/import-product-examples.js to refresh.\nexport const PRODUCT_SNAPSHOT_DATE = '${snapshotDate}';\nexport const PRODUCT_EXAMPLES = ${JSON.stringify(result, null, 2)};\n`;
await writeFile(new URL('../public/product-examples.js', import.meta.url), module);
console.log(`상품 ${result.length}개 예제 생성 완료`);
