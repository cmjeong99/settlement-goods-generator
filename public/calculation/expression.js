import { children, walk } from '../parser.js';
import { Decimal } from './decimal.js';

const aggregateNames = ['SUM', 'COUNT', 'MAX', 'MIN', 'AVG'];
const aggregate = (node) =>
  walk(node, (item) => item.kind === 'call' && aggregateNames.includes(item.name));
const numeric = (value) => (value instanceof Decimal ? value : Decimal.parse(value));
const compare = (left, right) =>
  left instanceof Decimal || right instanceof Decimal
    ? numeric(left).compare(numeric(right))
    : String(left).localeCompare(String(right));

const integerBounds = {
  TINYINT: [0n, 255n],
  SMALLINT: [-32768n, 32767n],
  INT: [-2147483648n, 2147483647n],
  BIGINT: [-9223372036854775808n, 9223372036854775807n],
};
function sqlInteger(value, type = 'INT') {
  value.sqlInteger = true;
  value.sqlIntegerType = type;
  return value;
}
function retainType(value, original) {
  if (original.sqlInteger) sqlInteger(value, original.sqlIntegerType);
  if (Number.isInteger(original.sqlScale)) value.sqlScale = original.sqlScale;
  if (Number.isInteger(original.sqlPrecision)) value.sqlPrecision = original.sqlPrecision;
  return value;
}
function checkInteger(value, type) {
  const [minimum, maximum] = integerBounds[type];
  if (value.compare(new Decimal(minimum)) < 0 || value.compare(new Decimal(maximum)) > 0)
    throw new Error(`${type} 범위를 벗어났어요. 원문 타입과 입력값을 확인해 주세요.`);
  return sqlInteger(value, type);
}
function checkDecimal(value, precision, scale) {
  if (precision < 1 || precision > 38 || scale < 0 || scale > precision)
    throw new Error(
      'DECIMAL·NUMERIC의 전체 자릿수는 1~38, 소수 자릿수는 전체 자릿수 이하여야 해요.',
    );
  if (value.abs().compare(new Decimal(10n ** BigInt(precision - scale))) >= 0)
    throw new Error(
      `DECIMAL(${precision},${scale}) 범위를 벗어났어요. 원문 타입과 입력값을 확인해 주세요.`,
    );
  value.sqlScale = scale;
  value.sqlPrecision = precision;
  return value;
}
function mathResult(
  value,
  original,
  { precision = original.sqlPrecision, scale = original.sqlScale } = {},
) {
  if (original.sqlInteger)
    return checkInteger(value, original.sqlIntegerType === 'BIGINT' ? 'BIGINT' : 'INT');
  return Number.isInteger(precision) && Number.isInteger(scale)
    ? checkDecimal(value, precision, scale)
    : value;
}

export function referencedColumns(formulas) {
  const names = new Set();
  const visit = (node) => {
    if (!node) return;
    if (node.kind === 'id' && node.name !== 'NULL') names.add(node.name);
    for (const child of children(node)) visit(child);
  };
  for (const formula of Object.values(formulas)) visit(formula);
  return [...names].sort();
}

function inputValue(row, name) {
  if (name === 'NULL') return null;
  // Qualified columns require exact matches. A.CPFEE and B.CPFEE may differ.
  if (!Object.hasOwn(row, name)) throw new Error(`${name} 입력값이 필요해요.`);
  const value = row[name];
  if (value === null || String(value).toUpperCase() === 'NULL') return null;
  if (value === '') throw new Error(`${name} 값을 입력하거나 NULL로 지정해 주세요.`);
  return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(String(value))
    ? Decimal.parse(value)
    : String(value);
}

function evaluate(node, rows, row, budget) {
  if (--budget.remaining < 0) throw new Error('계산 횟수를 넘었어요. 행과 수식을 나눠 주세요.');
  const run = (child) => evaluate(child, rows, row, budget);
  if (node.kind === 'number') {
    const value = Decimal.parse(node.value);
    if (/^\d+$/.test(node.value) && value.n <= 2147483647n) sqlInteger(value);
    return value;
  }
  if (node.kind === 'string') return node.value;
  if (node.kind === 'id') {
    const value = inputValue(row, node.name);
    if (
      rows.length > 1 &&
      !rows.every((other) => {
        const candidate = inputValue(other, node.name);
        return value === null
          ? candidate === null
          : candidate !== null && compare(value, candidate) === 0;
      })
    )
      throw new Error(
        `집계 밖 ${node.name} 값이 행마다 달라요. 같은 그룹·요율의 거래만 입력해 주세요.`,
      );
    return value;
  }
  if (node.kind === 'unary') {
    const value = run(node.arg);
    if (value === null) return null;
    const calculated = node.op === '-' ? numeric(value).neg() : numeric(value);
    return retainType(calculated, value);
  }
  if (node.kind === 'case') {
    const base = node.base ? run(node.base) : null;
    for (const branch of node.branches) {
      const condition = run(branch.when);
      if (
        node.base
          ? base !== null && condition !== null && compare(base, condition) === 0
          : condition === true
      )
        return run(branch.then);
    }
    return node.otherwise ? run(node.otherwise) : null;
  }
  if (node.kind === 'in') {
    const value = run(node.arg);
    if (value === null) return null;
    let unknown = false;
    for (const item of node.values) {
      const candidate = run(item);
      if (candidate === null) unknown = true;
      else if (compare(value, candidate) === 0) return true;
    }
    return unknown ? null : false;
  }
  if (node.kind === 'binary') {
    const left = run(node.left),
      right = run(node.right);
    if (node.op === 'AND')
      return left === false || right === false
        ? false
        : left === null || right === null
          ? null
          : !!left && !!right;
    if (node.op === 'OR')
      return left === true || right === true
        ? true
        : left === null || right === null
          ? null
          : !!left || !!right;
    if (left === null || right === null) return null;
    const comparison = () => compare(left, right);
    if (['=', '<>', '!=', '<', '>', '<=', '>='].includes(node.op))
      return {
        '=': () => comparison() === 0,
        '<>': () => comparison() !== 0,
        '!=': () => comparison() !== 0,
        '<': () => comparison() < 0,
        '>': () => comparison() > 0,
        '<=': () => comparison() <= 0,
        '>=': () => comparison() >= 0,
      }[node.op]();
    const first = numeric(left),
      second = numeric(right);
    const integer = first.sqlInteger && second.sqlInteger;
    let calculated;
    if (node.op === '+') calculated = first.add(second);
    if (node.op === '-') calculated = first.sub(second);
    if (node.op === '*') calculated = first.mul(second);
    if (node.op === '/') calculated = integer ? first.div(second).round('DOWN') : first.div(second);
    if (node.op === '%') calculated = first.sub(first.div(second).round('DOWN').mul(second));
    if (calculated)
      return integer
        ? sqlInteger(
            calculated,
            [first, second].some((value) => value.sqlIntegerType === 'BIGINT') ? 'BIGINT' : 'INT',
          )
        : calculated;
  }
  if (node.kind !== 'call') throw new Error(`지원하지 않는 수식이에요: ${node.kind}`);
  if (aggregateNames.includes(node.name)) {
    if (aggregate(node.args[0])) throw new Error('집계 함수 안의 집계 함수는 지원하지 않아요.');
    if (node.name === 'COUNT' && node.args[0].kind === 'star')
      return sqlInteger(Decimal.parse(rows.length));
    const values = rows
      .map((item) => evaluate(node.args[0], [item], item, budget))
      .filter((value) => value !== null);
    if (node.name === 'COUNT') return sqlInteger(Decimal.parse(values.length));
    if (!values.length) return null;
    if (node.name === 'MAX' || node.name === 'MIN')
      return values.reduce((left, right) =>
        compare(left, right) * (node.name === 'MAX' ? 1 : -1) > 0 ? left : right,
      );
    const allIntegers = values.every((value) => value.sqlInteger);
    const integerType = values.some((value) => value.sqlIntegerType === 'BIGINT')
      ? 'BIGINT'
      : 'INT';
    const sum = values.reduce((sum, value) => {
      const next = sum.add(numeric(value));
      return allIntegers ? checkInteger(next, integerType) : next;
    }, Decimal.parse('0'));
    if (allIntegers)
      return checkInteger(
        node.name === 'AVG' ? sum.div(values.length).round('DOWN') : sum,
        integerType,
      );
    const scale = values.every((value) => Number.isInteger(value.sqlScale))
      ? Math.max(...values.map((value) => value.sqlScale), node.name === 'AVG' ? 6 : 0)
      : null;
    const calculated = node.name === 'AVG' ? sum.div(values.length) : sum;
    if (scale !== null) checkDecimal(sum, 38, scale);
    return scale === null
      ? calculated
      : checkDecimal(calculated.round('HALF_UP', Decimal.unit(scale)), 38, scale);
  }
  if (node.name === 'ISNULL' || node.name === 'COALESCE') {
    for (const arg of node.args) {
      const value = run(arg);
      if (value !== null) return value;
    }
    return null;
  }
  if (node.name === 'IIF')
    return run(node.args[0]) === true ? run(node.args[1]) : run(node.args[2]);
  const values = node.args.map(run);
  if (node.name === 'NULLIF')
    return values[0] === null || (values[1] !== null && compare(values[0], values[1]) === 0)
      ? null
      : values[0];
  if (values.some((value) => value === null)) return null;
  if (node.name === 'RIGHT') {
    const count = Number(numeric(values[1]).toString());
    if (!Number.isInteger(count) || count < 0 || count > 1000)
      throw new Error('RIGHT 길이를 확인해 주세요.');
    return String(values[0]).slice(-count || Infinity);
  }
  const value = numeric(values[0]);
  if (node.name === 'ABS') {
    const absolute = value.abs();
    return mathResult(absolute, value, { precision: 38 });
  }
  if (node.name === 'SIGN') return mathResult(Decimal.parse(value.sign()), value, { scale: 0 });
  if (node.name === 'FLOOR') return mathResult(value.round('SIGNED_DOWN'), value, { scale: 0 });
  if (node.name === 'CEILING') return mathResult(value.round('CEILING'), value, { scale: 0 });
  if (node.name === 'ROUND')
    return mathResult(
      value.round(
        values[2] && numeric(values[2]).sign() !== 0 ? 'DOWN' : 'HALF_UP',
        Decimal.unit(Number(numeric(values[1]).toString())),
      ),
      value,
    );
  if (node.name === 'CAST' || node.name === 'CONVERT') {
    if (/^(BIGINT|INT|SMALLINT|TINYINT)$/.test(node.type)) {
      if (typeof values[0] === 'string' && !/^[+-]?\d+$/.test(values[0].trim()))
        throw new Error(`${node.type}로 변환할 정수 문자열을 확인해 주세요.`);
      return checkInteger(value.round('DOWN'), node.type);
    }
    const type = node.type.match(/^(?:NUMERIC|DECIMAL)(?:\((\d+)(?:,(\d+))?\))?$/);
    if (type) {
      const precision = Number(type[1] ?? 18),
        scale = Number(type[2] ?? 0);
      checkDecimal(Decimal.parse('0'), precision, scale);
      return checkDecimal(value.round('HALF_UP', Decimal.unit(scale)), precision, scale);
    }
    throw new Error(`${node.type} 타입 변환은 실제 DB에서 확인해 주세요.`);
  }
  throw new Error(`${node.name} 함수는 아직 계산 검증을 지원하지 않아요.`);
}

export function evaluateFormula(formula, rows) {
  if (!rows.length || rows.length > 100) throw new Error('검증할 거래를 1~100행 입력해 주세요.');
  const budget = { remaining: 100000 };
  return aggregate(formula)
    ? [evaluate(formula, rows, rows[0], budget)]
    : rows.map((row) => evaluate(formula, [row], row, budget));
}
