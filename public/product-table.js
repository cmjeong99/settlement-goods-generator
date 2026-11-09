import { FIELDS, display, describeField, exportRow } from './domain.js';

export const PRODUCT_COLUMNS = [['SMT_GDS_CD', '상품코드'], ['SMT_GDS_NM', '상품명'], ...FIELDS];

export function productTable(result, name) {
  const cells = PRODUCT_COLUMNS.map(([key, label]) => {
    if (key === 'SMT_GDS_CD' || key === 'SMT_GDS_NM') {
      const value = name?.[key === 'SMT_GDS_CD' ? 'code' : 'name'] ?? '';
      return {
        key,
        label,
        value,
        description: value ? '입력한 상품 정보' : '상품 완성 단계에서 입력',
        status: value ? 'named' : 'empty',
      };
    }
    const cell = result?.fields[key];
    return {
      key,
      label,
      value: cell ? String(display(cell)) : '',
      description: cell ? describeField(key, cell) : '',
      status: !cell
        ? 'empty'
        : cell.status === 'known'
          ? cell.source === 'user'
            ? 'chosen'
            : cell.source === 'context'
              ? 'context'
              : 'inferred'
          : cell.status === 'not-applicable'
            ? 'unused'
            : 'pending',
    };
  });
  const settings = cells.slice(2);
  return {
    cells,
    inferred: settings.filter((c) => c.status === 'inferred').length,
    context: settings.filter((c) => c.status === 'context').length,
    chosen: settings.filter((c) => c.status === 'chosen').length,
    pending: settings.filter((c) => c.status === 'pending').length,
    unused: settings.filter((c) => c.status === 'unused').length,
    resolved: settings.filter((c) => ['inferred', 'context', 'chosen', 'unused'].includes(c.status))
      .length,
  };
}

export function exportProductTable(result, format, name) {
  if (format === 'sql') {
    const errors = productInsertErrors(result, name);
    if (errors.length) throw new Error(errors.join(' '));
    const literal = (value) => `'${String(value).replace(/'/g, "''")}'`;
    const values = [
      literal(name.code.trim()),
      literal(name.name.trim()),
      ...FIELDS.map(([key, , options]) => {
        const cell = result.fields[key];
        if (cell.status === 'not-applicable') return 'NULL';
        return options ? literal(cell.value) : String(cell.value);
      }),
    ];
    // Oracle statement execution expects SQL without a client-side terminator.
    return `INSERT INTO TB_SSI_MERC_SMT_GDS_M (\n  ${PRODUCT_COLUMNS.map(([key]) => key).join(',\n  ')}\n) VALUES (\n  ${values.join(',\n  ')}\n)`;
  }
  return exportRow(result, format, name ?? { code: '', name: '' });
}

export function productInsertErrors(result, name) {
  if (!result) return ['수식을 먼저 분석해 주세요.'];
  const errors = [];
  if (!name?.code?.trim() || !name?.name?.trim()) errors.push('상품코드와 상품명을 입력해 주세요.');
  const pending = FIELDS.filter(([key, , options]) => {
    const cell = result.fields[key];
    if (cell?.status === 'not-applicable') return false;
    if (cell?.status !== 'known') return true;
    return options ? !options.includes(cell.value) : !Number.isFinite(cell.value) || cell.value < 0;
  });
  if (pending.length)
    errors.push(`다음 설정을 확정해 주세요: ${pending.map(([, label]) => label).join(', ')}.`);
  return errors;
}
