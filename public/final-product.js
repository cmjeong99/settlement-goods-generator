import { FIELDS } from './domain.js';

export function buildFinalProduct(source, overrides = {}, identity = {}) {
  if (!source)
    return { result: null, name: null, errors: [], settingErrors: [], changedFields: [] };
  const fields = { ...source.fields },
    errors = [],
    changedFields = [];
  for (const [key, label, values] of FIELDS) {
    const raw = String(overrides[key] ?? '').trim();
    if (!raw) continue;
    if (raw === '__defer__') {
      fields[key] = {
        value: null,
        status: 'unknown',
        source: 'user',
        evidence: [],
        reason: '사용자가 판단을 보류한 항목입니다.',
      };
      changedFields.push(key);
      continue;
    }
    const value = values ? raw : Number(raw);
    if (
      values
        ? !values.includes(value)
        : !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw) || !Number.isFinite(value) || value > 1e12
    ) {
      errors.push(
        `${label}을 확인해 주세요.${values ? '' : ' 0 이상 1조 이하의 숫자로 입력하세요.'}`,
      );
      continue;
    }
    if (source.fields[key].status === 'known' && source.fields[key].value === value) continue;
    fields[key] = {
      value,
      status: 'known',
      source: 'user',
      evidence: [],
      reason: '최종 복사본에서 사용자가 지정한 값입니다.',
    };
    changedFields.push(key);
  }
  const settingErrors = [...errors];
  const code = (identity.code ?? '').trim(),
    name = (identity.name ?? '').trim();
  if (!!code !== !!name) errors.push('상품코드와 상품명을 함께 입력하거나 둘 다 비워 주세요.');
  return {
    result: { ...source, fields },
    name: code || name ? { code, name } : null,
    errors,
    settingErrors,
    changedFields,
  };
}
