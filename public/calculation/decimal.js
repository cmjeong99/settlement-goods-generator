// Exact fractions keep fee/VAT rounding independent of binary floating point.
// SQL column precision/scale must still be checked against the source schema.
const abs = (value) => (value < 0n ? -value : value);
const gcd = (a, b) => (b === 0n ? a : gcd(b, a % b));
const power = (scale) => {
  if (!Number.isInteger(scale) || Math.abs(scale) > 38)
    throw new Error('소수 자릿수는 -38~38 범위에서 검증할 수 있어요.');
  return 10n ** BigInt(Math.abs(scale));
};

export class Decimal {
  constructor(numerator, denominator = 1n) {
    if (denominator === 0n) throw new Error('0으로 나눌 수 없어요.');
    if (denominator < 0n) {
      numerator = -numerator;
      denominator = -denominator;
    }
    if (abs(numerator).toString().length > 1000 || denominator.toString().length > 1000)
      throw new Error('계산값이 너무 커요. 입력과 수식을 나눠 주세요.');
    const divisor = gcd(abs(numerator), denominator);
    this.n = numerator / divisor;
    this.d = denominator / divisor;
  }
  static parse(value) {
    if (value instanceof Decimal) return value;
    const text = String(value).trim();
    if (text.length > 120) throw new Error('숫자는 120자 이내로 입력해 주세요.');
    const match = text.match(/^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i);
    if (!match || !(match[2] || match[3])) throw new Error(`숫자를 확인해 주세요: ${text}`);
    const scale = (match[3]?.length ?? 0) - Number(match[4] ?? 0);
    const digits = BigInt((match[2] || '0') + (match[3] ?? '')) * (match[1] === '-' ? -1n : 1n);
    return scale >= 0 ? new Decimal(digits, power(scale)) : new Decimal(digits * power(scale));
  }
  add(other) {
    other = Decimal.parse(other);
    return new Decimal(this.n * other.d + other.n * this.d, this.d * other.d);
  }
  sub(other) {
    return this.add(Decimal.parse(other).neg());
  }
  mul(other) {
    other = Decimal.parse(other);
    return new Decimal(this.n * other.n, this.d * other.d);
  }
  div(other) {
    other = Decimal.parse(other);
    return new Decimal(this.n * other.d, this.d * other.n);
  }
  neg() {
    return new Decimal(-this.n, this.d);
  }
  abs() {
    return new Decimal(abs(this.n), this.d);
  }
  compare(other) {
    other = Decimal.parse(other);
    const difference = this.n * other.d - other.n * this.d;
    return difference < 0n ? -1 : difference > 0n ? 1 : 0;
  }
  sign() {
    return this.n < 0n ? -1 : this.n > 0n ? 1 : 0;
  }
  round(method = 'HALF_UP', unit = '1') {
    const step = Decimal.parse(unit);
    if (step.sign() <= 0) throw new Error('계산 단위는 0보다 커야 해요.');
    if (method === 'NONE') return this;
    const scaled = this.div(step);
    let integer = scaled.n / scaled.d;
    const remainder = abs(scaled.n % scaled.d);
    if (method === 'SIGNED_DOWN' && scaled.n < 0n && remainder) integer--;
    else if (method === 'CEILING' && scaled.n > 0n && remainder) integer++;
    else if (
      (method === 'HALF_UP' && remainder * 2n >= scaled.d) ||
      (method === 'HALF_DOWN' && remainder * 2n > scaled.d)
    )
      integer += BigInt(scaled.sign());
    else if (!['DOWN', 'HALF_UP', 'HALF_DOWN', 'SIGNED_DOWN', 'CEILING'].includes(method))
      throw new Error(`지원하지 않는 단수 처리예요: ${method}`);
    return new Decimal(integer).mul(step);
  }
  static unit(scale) {
    return scale >= 0 ? new Decimal(1n, power(scale)) : new Decimal(power(scale));
  }
  toString() {
    const integer = abs(this.n) / this.d;
    let remainder = abs(this.n) % this.d;
    let fraction = '';
    for (let i = 0; i < 18 && remainder; i++) {
      remainder *= 10n;
      fraction += (remainder / this.d).toString();
      remainder %= this.d;
    }
    return `${this.n < 0n ? '-' : ''}${integer}${fraction ? '.' + fraction : ''}${remainder ? '…' : ''}`;
  }
}
