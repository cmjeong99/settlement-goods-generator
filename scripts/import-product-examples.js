import { readFile, writeFile } from 'node:fs/promises';
import { buildProductExamples } from './product-example-builder.js';

const args = process.argv.slice(2);
const snapshotArgument = args.find((arg) => arg.startsWith('--snapshot-date='));
const snapshotDate =
  snapshotArgument?.slice('--snapshot-date='.length) ??
  new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate))
  throw new Error('snapshot-date는 YYYY-MM-DD 형식입니다.');
const [productPath, ...procedurePaths] = args.filter((arg) => arg !== snapshotArgument);
if (!productPath || !procedurePaths.length)
  throw new Error(
    '사용법: node scripts/import-product-examples.js products.json procedures.json [extra.json] [--snapshot-date=YYYY-MM-DD]',
  );
const products = JSON.parse(await readFile(productPath, 'utf8'));
const procedures = (
  await Promise.all(procedurePaths.map(async (path) => JSON.parse(await readFile(path, 'utf8'))))
).flat();
const result = buildProductExamples(products, procedures);
if (new Set(result.map((row) => row.code)).size !== result.length)
  throw new Error('중복 상품코드가 있습니다.');
const module = `// Generated from read-only DB exports. Run scripts/import-product-examples.js to refresh.\nexport const PRODUCT_SNAPSHOT_DATE = '${snapshotDate}';\nexport const PRODUCT_EXAMPLES = ${JSON.stringify(result, null, 2)};\n`;
await writeFile(new URL('../public/product-examples.js', import.meta.url), module);
console.log(`상품 ${result.length}개 예제 생성 완료`);
