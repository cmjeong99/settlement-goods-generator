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
    value.sqlInteger = /^\d+$/.test(node.value) && value.n <= 2147483647n;
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
    calculated.sqlInteger = value.sqlInteger;
    return calculated;
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
    if (calculated) {
      calculated.sqlInteger = integer;
      return calculated;
    }
    if (node.op === '%') return first.sub(first.div(second).round('DOWN').mul(second));
  }
  if (node.kind !== 'call') throw new Error(`지원하지 않는 수식이에요: ${node.kind}`);
  if (aggregateNames.includes(node.name)) {
    if (aggregate(node.args[0])) throw new Error('집계 함수 안의 집계 함수는 지원하지 않아요.');
    if (node.name === 'COUNT' && node.args[0].kind === 'star') return Decimal.parse(rows.length);
    const values = rows
      .map((item) => evaluate(node.args[0], [item], item, budget))
      .filter((value) => value !== null);
    if (node.name === 'COUNT') return Decimal.parse(values.length);
    if (!values.length) return null;
    if (node.name === 'MAX' || node.name === 'MIN')
      return values.reduce((left, right) =>
        compare(left, right) * (node.name === 'MAX' ? 1 : -1) > 0 ? left : right,
      );
    const sum = values.reduce((sum, value) => sum.add(numeric(value)), Decimal.parse('0'));
    return node.name === 'AVG' ? sum.div(values.length) : sum;
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
  if (node.name === 'ABS') return value.abs();
  if (node.name === 'SIGN') return Decimal.parse(value.sign());
  if (node.name === 'FLOOR') return value.round('SIGNED_DOWN');
  if (node.name === 'CEILING') return value.round('CEILING');
  if (node.name === 'ROUND')
    return value.round(
      values[2] && numeric(values[2]).sign() !== 0 ? 'DOWN' : 'HALF_UP',
      Decimal.unit(Number(numeric(values[1]).toString())),
    );
  if (node.name === 'CAST' || node.name === 'CONVERT') {
    if (/^(BIGINT|INT|SMALLINT|TINYINT)$/.test(node.type)) {
      const integer = value.round('DOWN');
      integer.sqlInteger = true;
      return integer;
    }
    const type = node.type.match(/^(?:NUMERIC|DECIMAL)\((\d+),(\d+)\)$/);
    if (type) return value.round('HALF_UP', Decimal.unit(Number(type[2])));
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
