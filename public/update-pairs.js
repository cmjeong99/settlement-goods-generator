import { Parser, tokenize, walk } from './parser.js';

function updateScope(block) {
  if (block.errors.length || Object.keys(block.formulas).length !== 1) return null;
  try {
    const parser = new Parser(tokenize(block.sql));
    parser.expect('UPDATE');
    const name = () => {
      const parts = [];
      do {
        const token = parser.take();
        if (token?.kind !== 'id') throw new Error('identifier required');
        parts.push(token.value);
      } while (parser.accept('.'));
      return parts;
    };
    const table = JSON.stringify(name());
    parser.expect('SET');
    const writes = new Set();
    do {
      const column = name().at(-1);
      if (writes.has(column)) return null;
      writes.add(column);
      parser.expect('=');
      parser.expr();
    } while (parser.accept(','));
    let predicate = null,
      condition = '';
    if (parser.accept('WHERE')) {
      const start = parser.i;
      predicate = parser.expr();
      condition = JSON.stringify(
        parser.tokens.slice(start, parser.i).map(({ kind, value }) => [kind, value]),
      );
    }
    parser.accept(';');
    if (parser.peek().kind !== 'eof') return null;
    return { table, predicate, condition, writes };
  } catch {
    return null;
  }
}

// Only join adjacent, independent assignments for exactly the same rows.
// Procedural control flow, joins and reads of previously written columns stay separate.
export function pairUpdates(blocks, source) {
  let cases = 0;
  for (const token of tokenize(source)) {
    if (token.kind !== 'id') continue;
    if (token.value === 'CASE') cases++;
    else if (token.value === 'END' && cases) cases--;
    else if (
      !cases &&
      ['IF', 'ELSE', 'BEGIN', 'END', 'GO', 'EXEC', 'EXECUTE'].includes(token.value)
    )
      return blocks;
  }
  const result = [];
  for (let i = 0; i < blocks.length; i++) {
    const first = blocks[i],
      second = blocks[i + 1];
    const left = updateScope(first),
      right = second && updateScope(second);
    const adjacent = second && Number(second.id.slice(6)) === Number(first.id.slice(6)) + 1;
    const complementary =
      second && Object.keys(first.formulas)[0] !== Object.keys(second.formulas)[0];
    const dependent =
      left &&
      right &&
      [...left.writes].some((column) =>
        [...Object.values(second.formulas), right.predicate].some((node) =>
          walk(node, (n) => n.kind === 'id' && n.name.split('.').at(-1) === column),
        ),
      );
    if (
      adjacent &&
      complementary &&
      left &&
      right &&
      !dependent &&
      left.table === right.table &&
      left.condition === right.condition
    ) {
      result.push({
        ...first,
        end: second.end,
        sql: source.slice(first.start, second.end),
        formulas: { ...first.formulas, ...second.formulas },
        statements: [first, second].map(({ line, start, end }) => ({ line, start, end })),
      });
      i++;
    } else result.push(first);
  }
  return result;
}
