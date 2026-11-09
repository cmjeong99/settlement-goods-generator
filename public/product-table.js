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
  return exportRow(result, format, name ?? { code: '', name: '' });
}
