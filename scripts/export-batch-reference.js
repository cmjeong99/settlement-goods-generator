// Read the batch revision without modifying its checkout; run its arithmetic on the JVM.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const batch = resolve(
  process.argv[2] || fileURLToPath(new URL('../../daon-settlement-batch/', import.meta.url)),
);
const git = (...args) => execFileSync('git', ['-C', batch, ...args], { encoding: 'utf8' });
const revision = git('rev-parse', 'HEAD').trim();
const sourceRoot = 'src/main/java/kr/co/danal/';
const customRoot = `${sourceRoot}settlement/batch/business/common/calculator/merchant/custom/sum/`;
const definitions = [
  [
    'mobileRate',
    'MOBILE-RATE-INCL',
    `${customRoot}mobile/MobileRateIncludeVatMerchantSumCalculator.java`,
  ],
  ['timonet', 'MOBILE-TIMONET', `${customRoot}mobile/MobileTmonetMerchantSumCalculator.java`],
  [
    'government',
    'MOBILE-GOVERNMENT',
    `${customRoot}mobile/MobileGovernmentOfficeMerchantSumCalculator.java`,
  ],
  [
    'self',
    'SELF-STANDARD-SCNT-INCL',
    `${customRoot}selfconfirm/SelfConfirmIncludeVatMerchantSumCalculator.java`,
  ],
];
const sources = {};
const read = (path) => {
  const contents = git('show', `${revision}:${path}`);
  sources[path] = createHash('sha256').update(contents).digest('hex');
  return contents;
};
const methods = definitions.map(([name, , path]) => {
  const source = read(path);
  const method = source.slice(source.indexOf('public MerchantCalculationResult calculate('));
  const body = method
    .slice(method.indexOf('{') + 1, method.indexOf('return new MerchantCalculationResult'))
    .replaceAll('request.getFeeVal()', 'feeValue');
  if (!body.includes('recalculatedFee') || !body.includes('recalculatedVat'))
    throw new Error(`Review the changed batch method before regenerating: ${path}`);
  return `static BigDecimal[] ${name}(BigDecimal amount, BigDecimal feeAmount, BigDecimal poutScheduledAmount, Integer txCount, BigDecimal feeValue) {
    ${body}
    return new BigDecimal[]{recalculatedFee, recalculatedVat};
  }`;
});
const customCases = [];
for (const grossFee of ['110', '-110', '149', '-149', '0', '1.0999995', '-1.0999995'])
  for (const method of ['mobileRate', 'timonet'])
    customCases.push({
      method,
      amount: grossFee.startsWith('-') ? '-1000' : '1000',
      grossFee,
      count: '1',
      feeValue: '0',
      scheduledPayout: '0',
    });
for (const [amount, scheduledPayout] of [
  ['1000', '835'],
  ['-1000', '-835'],
  ['1000', '851'],
  ['-1000', '-851'],
])
  customCases.push({
    method: 'government',
    amount,
    scheduledPayout,
    grossFee: '0',
    count: '1',
    feeValue: '0',
  });
for (const [count, feeValue] of [
  ['1', '1'],
  ['2', '55'],
  ['100', '15.5'],
  ['0', '100'],
])
  customCases.push({
    method: 'self',
    amount: '0',
    count,
    feeValue,
    grossFee: '0',
    scheduledPayout: '0',
  });
const roundingCases = [
  ['1234.56', '-1', 'HALF_UP'],
  ['-1234', '-1', 'SIGNED_DOWN'],
  ['1234.56', '-2', 'HALF_UP'],
  ['1234.567', '2', 'DOWN'],
  ['-1234.567', '2', 'SIGNED_DOWN'],
  ['123.456', '0', 'NONE'],
];
const java = `import java.math.*;
class BatchReference {
  static final BigDecimal DIVISOR = new BigDecimal("1.1");
  ${methods.join('\n')}
  public static void main(String[] args) {
    ${customCases
      .map(
        (c, index) => `{
      BigDecimal amount = new BigDecimal("${c.amount}");
      BigDecimal[] result = ${c.method}(amount, new BigDecimal("${c.grossFee}"), new BigDecimal("${c.scheduledPayout}"), ${c.count}, new BigDecimal("${c.feeValue}"));
      System.out.println("custom:${index}|" + result[0].toPlainString() + "|" + result[1].toPlainString() + "|" + amount.subtract(result[0]).subtract(result[1]).toPlainString());
    }`,
      )
      .join('\n')}
    ${roundingCases.map(([value, scale, rule], index) => `System.out.println("round:${index}|" + RoundingRule.${rule}.apply(new BigDecimal("${value}"), new BigDecimal("${scale}")).toPlainString());`).join('\n')}
  }
}`;
const workRoot = resolve(root, '../_workspace');
await mkdir(workRoot, { recursive: true });
const work = await mkdtemp(resolve(workRoot, 'batch-calculator-jvm-'));
const rounding = read(`${sourceRoot}core/calculator/common/code/RoundingRule.java`).replace(
  /^package [^;]+;\s*/m,
  '',
);
await writeFile(resolve(work, 'RoundingRule.java'), rounding);
await writeFile(resolve(work, 'BatchReference.java'), java);
execFileSync('javac', ['-encoding', 'UTF-8', 'RoundingRule.java', 'BatchReference.java'], {
  cwd: work,
  stdio: 'pipe',
});
const output = execFileSync('java', ['-cp', work, 'BatchReference'], { encoding: 'utf8' });
const results = new Map(
  output
    .trim()
    .split(/\r?\n/)
    .map((line) => {
      const [key, ...values] = line.split('|');
      return [key, values];
    }),
);
const fixture = {
  repository: 'daon-settlement-batch',
  revision,
  sources,
  custom: customCases.map((c, index) => ({
    ...c,
    productCode: definitions.find(([method]) => method === c.method)[1],
    expected: Object.fromEntries(
      ['fee', 'vat', 'payout'].map((key, i) => [key, results.get(`custom:${index}`)[i]]),
    ),
  })),
  rounding: roundingCases.map(([value, scale, rule], index) => ({
    value,
    scale: Number(scale),
    rule,
    expected: results.get(`round:${index}`)[0],
  })),
};
const destination = resolve(root, 'test/fixtures/batch-calculator-jvm.json');
await writeFile(destination, JSON.stringify(fixture, null, 2) + '\n');
console.log(
  `JVM reference: ${customCases.length} custom + ${roundingCases.length} rounding cases, ${revision}`,
);
