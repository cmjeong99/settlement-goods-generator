import { createHash } from 'node:crypto';
import { extract, lineAt } from '../public/parser.js';
import { FIELDS } from '../public/domain.js';
import { INSERT_FIELDS } from '../public/product-insert.js';
import { calculationForProduct } from './product-calculation-map.js';

export function buildProductExamples(products, procedures) {
  const definitions = new Map(
    procedures.map((row) => [
      `${row.database_name}.${row.schema_name ?? 'dbo'}.${row.procedure_name}`,
      row.definition,
    ]),
  );
  return products.map((product) => {
    const profile = calculationForProduct(product.SMT_GDS_CD);
    let identifier = 0;
    const identifiers = new Map();
    const sanitize = (sql) =>
      sql.replace(/'(?:''|[^'])*'/g, (literal) => {
        if (!/^[A-Z0-9-]{9,}$/i.test(literal.slice(1, -1))) return literal;
        if (!identifiers.has(literal)) identifiers.set(literal, `'EXAMPLE_CP_${++identifier}'`);
        return identifiers.get(literal);
      });
    const prepared = profile.references.map((reference) => {
      const definition = definitions.get(reference.source);
      if (!definition) throw new Error(`SP 없음: ${reference.source}`);
      const lines = definition.split(/\r?\n/);
      const slice = ([start, end]) => {
        if (
          !Number.isInteger(start) ||
          !Number.isInteger(end) ||
          start < 1 ||
          end < start ||
          end > lines.length
        )
          throw new Error(`SP 범위 불일치: ${reference.source}:${start}-${end}`);
        return lines
          .slice(start - 1, end)
          .join('\n')
          .trim();
      };
      let sql, formulas;
      if (reference.rawLines) sql = slice(reference.rawLines);
      else {
        if (reference.projection) {
          for (const expression of Object.values(reference.projection))
            if (!lines[reference.line - 1]?.includes(expression))
              throw new Error(`SELECT 위치 불일치: ${reference.source}:${reference.line}`);
          formulas = reference.projection;
        } else {
          const input = reference.selectLines
            ? 'SELECT\n' + slice(reference.selectLines).replace(/^\s*,/, '')
            : definition;
          const block = extract(input, reference.columns).find((block) =>
            reference.selectLines
              ? Object.keys(block.formulas).length > 0
              : Object.values(block.formulas).some(
                  (node) => lineAt(definition, node.start) === reference.line,
                ),
          );
          if (!block || block.errors.length)
            throw new Error(`수식 추출 실패: ${reference.source}:${reference.line}`);
          formulas = Object.fromEntries(
            Object.entries(block.formulas)
              .filter(([key]) => !reference.vatOnly || key === 'vat')
              .map(([key, node]) => [key, input.slice(node.start, node.end)]),
          );
        }
        sql = projection(formulas);
      }
      if (reference.active) {
        const blocks = extract(sql);
        if (!blocks.length || blocks.some((b) => b.errors.length))
          throw new Error(
            `본문 계산식 오류: ${product.SMT_GDS_CD}/${reference.source}:${reference.line}`,
          );
      }
      let groupBy;
      if (reference.groupByLine) {
        groupBy = lines[reference.groupByLine - 1]?.trim();
        if (!/^GROUP BY /i.test(groupBy))
          throw new Error(`집계 기준 위치 불일치: ${reference.source}:${reference.groupByLine}`);
      }
      const source = {
        name: reference.source,
        line: reference.line,
        stage: reference.stage,
        active: reference.active,
        note: reference.note ?? '',
        hash: createHash('sha256').update(definition).digest('hex'),
        ...(groupBy ? { groupBy, groupByLine: reference.groupByLine } : {}),
      };
      return { sql, formulas, source };
    });
    const header = (item) =>
      `-- ${item.source.stage}\n-- ${item.source.name}:${item.source.line}${item.source.note ? '\n-- ' + item.source.note : ''}${item.source.groupBy ? '\n-- ' + item.source.groupBy : ''}`;
    const active = prepared.filter((item) => item.source.active),
      inactive = prepared.filter((item) => !item.source.active);
    const main = profile.mergeActive
      ? active.map(header).join('\n') +
        '\n' +
        projection(Object.assign({}, ...active.map((item) => item.formulas)))
      : active.map((item) => header(item) + '\n' + item.sql).join('\n\n');
    const sql = sanitize(
      [
        `-- ${profile.summary}`,
        ...(profile.unresolved ? [`-- 확인 필요: ${profile.unresolved}`] : []),
        main,
        ...inactive.map(
          (item) =>
            header(item) +
            '\n' +
            item.sql
              .split('\n')
              .map((line) => '-- ' + line)
              .join('\n'),
        ),
      ].join('\n\n'),
    );
    const { references, mergeActive, inputScope, ...calculation } = profile;
    return {
      code: product.SMT_GDS_CD,
      name: product.SMT_GDS_NM,
      serviceCode: product.SRVC_CD,
      detailServiceCode: product.DTLS_SRVC_CD,
      engine: product.CALC_ENGE_DVCD,
      ...(inputScope ? { inputScope } : {}),
      calculation,
      settlement: { paymentMethod: product.PAYM_MHOD_DVCD, feeCollection: product.FEE_RCVG_DVCD },
      registration: Object.fromEntries(
        INSERT_FIELDS.filter(([key]) => key !== 'REG_USER_ID').map(([key]) => [
          key,
          product[key] ?? null,
        ]),
      ),
      expected: Object.fromEntries(
        FIELDS.map(([key, , values]) => [
          key,
          product[key] === null ? null : values ? product[key] : Number(product[key]),
        ]),
      ),
      sources: prepared.map((item) => item.source),
      sql,
    };
  });
}

function projection(formulas) {
  return (
    'SELECT\n  ' +
    Object.entries(formulas)
      .map(([key, expression]) => `${expression} AS ${key === 'fee' ? 'CPFEE' : 'CPVAT'}`)
      .join(',\n  ') +
    ';'
  );
}
