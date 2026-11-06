// A bounded T-SQL expression parser. SQL is never executed.
export class ParseError extends Error {
  constructor(message, token) {
    super(message);
    this.offset = token?.start ?? 0;
  }
}
export function tokenize(source) {
  const tokens = [];
  let i = 0;
  const push = (kind, value, start) => tokens.push({ kind, value, start, end: i });
  while (i < source.length) {
    const start = i,
      c = source[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (source.startsWith('--', i)) {
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }
    if (source.startsWith('/*', i)) {
      i += 2;
      let level = 1;
      while (i < source.length && level) {
        if (source.startsWith('/*', i)) {
          level++;
          i += 2;
        } else if (source.startsWith('*/', i)) {
          level--;
          i += 2;
        } else i++;
      }
      if (level) throw new ParseError('주석 끝에 */를 넣어 주세요.', { start });
      continue;
    }
    if (c === '[' || c === '"') {
      const close = c === '[' ? ']' : '"';
      i++;
      let value = '',
        closed = false;
      while (i < source.length) {
        if (source[i] === close) {
          i++;
          if (source[i] === close) {
            value += close;
            i++;
          } else {
            closed = true;
            break;
          }
        } else value += source[i++];
      }
      if (!closed) throw new ParseError(`컬럼명 끝에 ${close} 기호를 넣어 주세요.`, { start });
      push('id', value.toUpperCase(), start);
      continue;
    }
    if (c === "'") {
      i++;
      let value = '',
        closed = false;
      while (i < source.length) {
        if (source[i] === "'") {
          i++;
          if (source[i] === "'") {
            value += "'";
            i++;
          } else {
            closed = true;
            break;
          }
        } else value += source[i++];
      }
      if (!closed) throw new ParseError('문자열 끝에 닫는 따옴표를 넣어 주세요.', { start });
      push('string', value, start);
      continue;
    }
    const number = source.slice(i).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/);
    if (number) {
      i += number[0].length;
      push('number', number[0], start);
      continue;
    }
    const id = source.slice(i).match(/^[@#\p{L}_][@#$\p{L}\p{N}_]*/u);
    if (id) {
      i += id[0].length;
      push('id', id[0].toUpperCase(), start);
      continue;
    }
    const op = source.slice(i).match(/^(?:<=|>=|<>|!=|!<|!>)/);
    if (op) {
      i += op[0].length;
      push('op', op[0], start);
      continue;
    }
    i++;
    push('op', c, start);
  }
  tokens.push({ kind: 'eof', value: 'EOF', start: i, end: i });
  return tokens;
}
const precedence = {
  OR: 1,
  AND: 2,
  '=': 3,
  '<>': 3,
  '!=': 3,
  '<': 3,
  '>': 3,
  '<=': 3,
  '>=': 3,
  IN: 3,
  '+': 4,
  '-': 4,
  '*': 5,
  '/': 5,
  '%': 5,
};
export class Parser {
  constructor(tokens, index = 0) {
    this.tokens = tokens;
    this.i = index;
    this.depth = 0;
  }
  peek() {
    return this.tokens[this.i] ?? this.tokens.at(-1);
  }
  take() {
    return this.tokens[this.i++];
  }
  accept(value) {
    if (this.peek().value === value) return this.take();
    return null;
  }
  expect(value) {
    const t = this.take();
    if (t?.value !== value) throw new ParseError(`이 위치에 ${value} 입력이 필요해요.`, t);
    return t;
  }
  expr(min = 0) {
    if (++this.depth > 120)
      throw new ParseError('수식 중첩이 너무 깊어요. 계산 구문을 나눠 주세요.', this.peek());
    let left = this.primary();
    while ((precedence[this.peek().value] ?? -1) >= min) {
      const op = this.take().value,
        right = op === 'IN' ? null : this.expr(precedence[op] + 1);
      if (op === 'IN') {
        this.expect('(');
        const values = [this.expr()];
        while (this.accept(',')) values.push(this.expr());
        const end = this.expect(')');
        left = { kind: 'in', arg: left, values, start: left.start, end: end.end };
        continue;
      }
      left = { kind: 'binary', op, left, right, start: left.start, end: right.end };
    }
    this.depth--;
    return left;
  }
  primary() {
    const t = this.take();
    if (!t) throw new ParseError('계산식을 입력해 주세요.');
    if (t.value === '+' || t.value === '-') {
      const arg = this.expr(6);
      return { kind: 'unary', op: t.value, arg, start: t.start, end: arg.end };
    }
    if (t.value === '(') {
      const node = this.expr();
      const end = this.expect(')');
      return { ...node, start: t.start, end: end.end };
    }
    if (t.kind === 'number' || t.kind === 'string')
      return { kind: t.kind, value: t.value, start: t.start, end: t.end };
    if (t.value === 'CASE') {
      const base = this.peek().value === 'WHEN' ? null : this.expr();
      const branches = [];
      while (this.accept('WHEN')) {
        const when = this.expr();
        this.expect('THEN');
        branches.push({ when, then: this.expr() });
      }
      const otherwise = this.accept('ELSE') ? this.expr() : null,
        end = this.expect('END');
      if (!branches.length) throw new ParseError('CASE에 WHEN 조건을 넣어 주세요.', t);
      return { kind: 'case', base, branches, otherwise, start: t.start, end: end.end };
    }
    if (t.kind !== 'id' || ['EOF', 'FROM', 'WHERE', 'THEN', 'ELSE', 'END'].includes(t.value))
      throw new ParseError('수식을 읽지 못했어요. 값과 연산자를 확인해 주세요.', t);
    let name = t.value;
    while (this.accept('.')) {
      const next = this.take();
      if (next?.kind !== 'id') throw new ParseError('점 뒤에 컬럼명을 넣어 주세요.', next);
      name += '.' + next.value;
    }
    if (!this.accept('('))
      return { kind: 'id', name, start: t.start, end: this.tokens[this.i - 1].end };
    const args = [];
    let type = null;
    if (name === 'CAST') {
      args.push(this.expr());
      this.expect('AS');
      type = this.sqlType();
    } else if (name === 'CONVERT') {
      type = this.sqlType();
      this.expect(',');
      args.push(this.expr());
      if (this.accept(',')) args.push(this.expr());
    } else if (this.accept('*'))
      args.push({
        kind: 'star',
        start: this.tokens[this.i - 1].start,
        end: this.tokens[this.i - 1].end,
      });
    else if (this.peek().value !== ')') {
      args.push(this.expr());
      while (this.accept(',')) args.push(this.expr());
    }
    const end = this.expect(')');
    const arity = {
      ABS: [1],
      SIGN: [1],
      FLOOR: [1],
      CEILING: [1],
      ROUND: [2, 3],
      SUM: [1],
      COUNT: [1],
      CAST: [1],
      CONVERT: [1, 2],
      ISNULL: [2],
      NULLIF: [2],
      IIF: [3],
    };
    if (
      (arity[name] && !arity[name].includes(args.length)) ||
      (name === 'COALESCE' && args.length < 2)
    )
      throw new ParseError(`${name} 함수 인수 개수를 확인해 주세요.`, t);
    return { kind: 'call', name, args, type, start: t.start, end: end.end };
  }
  sqlType() {
    const t = this.take();
    if (t?.kind !== 'id') throw new ParseError('변환할 데이터 타입을 넣어 주세요.', t);
    let type = t.value;
    if (this.accept('(')) {
      type += '(';
      while (this.peek().value !== ')' && this.peek().kind !== 'eof') type += this.take().value;
      this.expect(')');
      type += ')';
    }
    return type;
  }
}
export const lineAt = (source, offset) => source.slice(0, offset).split('\n').length;
export function columnNames(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options))
    throw new ParseError('결과 컬럼 설정을 확인해 주세요.');
  const names = { fee: ['CPFEE', 'RAMT'], vat: ['CPVAT', 'VAMT'] };
  for (const kind of ['fee', 'vat']) {
    const value = options[`${kind}Column`] ?? '';
    if (
      typeof value !== 'string' ||
      value.length > 128 ||
      (value.trim() && !/^[\p{L}_][\p{L}\p{N}_$]*$/u.test(value.trim()))
    )
      throw new ParseError('테이블 별칭·괄호 없이 컬럼명만 128자 이내로 입력해 주세요.');
    if (value.trim()) names[kind] = [value.trim().toUpperCase()];
  }
  if (names.fee.some((name) => names.vat.includes(name)))
    throw new ParseError('수수료와 부가세는 서로 다른 결과 컬럼을 지정해 주세요.');
  return names;
}
export function extract(source, options = {}) {
  const names = columnNames(options);
  const outputKind = (name) =>
    names.fee.includes(name?.split('.').at(-1))
      ? 'fee'
      : names.vat.includes(name?.split('.').at(-1))
        ? 'vat'
        : null;
  const ts = tokenize(source),
    boundaries = [];
  let level = 0;
  for (let i = 0; i < ts.length - 1; i++) {
    if (ts[i].value === '(') level++;
    if (ts[i].value === ')') level--;
    if (level === 0 && ['UPDATE', 'SELECT'].includes(ts[i].value)) boundaries.push(i);
  }
  if (!boundaries.length || boundaries[0] > 0) boundaries.unshift(0);
  boundaries.push(ts.length - 1);
  const blocks = [];
  for (let b = 0; b < boundaries.length - 1; b++) {
    const begin = boundaries[b],
      end = boundaries[b + 1],
      local = [...ts.slice(begin, end), { ...ts[end], kind: 'eof', value: 'EOF' }];
    const formulas = {},
      errors = [],
      used = new Set();
    // Only inspect the SET/SELECT list, never predicates or assignments in subqueries.
    let limit = local.length - 1,
      depth = 0;
    const topLevel = new Set();
    for (let i = 0; i < local.length - 1; i++) {
      if (depth === 0 && ['FROM', 'WHERE', ';'].includes(local[i].value)) {
        limit = i;
        break;
      }
      if (depth === 0) topLevel.add(i);
      if (local[i].value === '(') depth++;
      if (local[i].value === ')') depth--;
    }
    for (let i = 0; i < limit; i++) {
      if (!topLevel.has(i)) continue;
      const k = outputKind(local[i].value);
      if (k && local[i + 1]?.value === '=') {
        try {
          const p = new Parser(local, i + 2),
            node = p.expr();
          if (
            ![',', ';', 'FROM', 'WHERE', 'EOF', 'GO', 'END', 'IF', 'BEGIN'].includes(p.peek().value)
          )
            throw new ParseError('수식 뒤의 구문을 확인해 주세요.', p.peek());
          if (formulas[k])
            throw new ParseError('결과 컬럼이 중복돼요. 계산 구문을 나눠 주세요.', local[i]);
          formulas[k] = node;
          used.add(i);
          i = p.i - 1;
        } catch (e) {
          errors.push({ message: e.message, offset: e.offset ?? local[i].start });
        }
      }
    }
    // SELECT expressions and bare "expression AS alias" fragments.
    for (let i = 0; i < limit; i++) {
      if (!topLevel.has(i)) continue;
      if (i === 0 && local[i].value === 'SELECT') continue;
      if (i !== 0 && ![',', 'SELECT'].includes(local[i - 1].value)) continue;
      if (used.has(i)) continue;
      try {
        const p = new Parser(local, i),
          node = p.expr();
        p.accept('AS');
        const alias = p.peek(),
          k = outputKind(alias.value);
        if (k) {
          if (formulas[k])
            errors.push({
              message: '결과 컬럼이 중복돼요. 계산 구문을 나눠 주세요.',
              offset: alias.start,
            });
          else if (
            ![',', ';', 'FROM', 'WHERE', 'EOF', 'GO', 'END', 'IF', 'BEGIN'].includes(
              local[p.i + 1]?.value,
            )
          )
            errors.push({ message: '결과 별칭 뒤의 구문을 확인해 주세요.', offset: alias.start });
          else formulas[k] = node;
          i = p.i;
        }
      } catch {
        /* Unrelated SELECT columns do not invalidate the target formulas. */
      }
    }
    const startOffset = local[0].start,
      endOffset = ts[end].start;
    if (Object.keys(formulas).length || errors.length)
      blocks.push({
        id: `block-${b}`,
        formulas,
        errors,
        start: startOffset,
        end: endOffset,
        line: lineAt(source, startOffset),
        sql: source.slice(startOffset, endOffset),
      });
  }
  return blocks;
}
export function children(n) {
  if (!n) return [];
  if (n.kind === 'binary') return [n.left, n.right];
  if (n.kind === 'unary') return [n.arg];
  if (n.kind === 'call') return n.args;
  if (n.kind === 'in') return [n.arg, ...n.values];
  if (n.kind === 'case')
    return [n.base, ...n.branches.flatMap((b) => [b.when, b.then]), n.otherwise].filter(Boolean);
  return [];
}
export const walk = (n, predicate) =>
  !!n && (predicate(n) || children(n).some((c) => walk(c, predicate)));
export function canonical(n) {
  if (!n) return '';
  if (n.kind === 'id') return n.name;
  if (n.kind === 'number') return String(Number(n.value));
  if (n.kind === 'string') return JSON.stringify(n.value);
  return JSON.stringify([
    n.kind,
    n.op ?? n.name ?? '',
    n.type ?? '',
    ...children(n).map(canonical),
  ]);
}
