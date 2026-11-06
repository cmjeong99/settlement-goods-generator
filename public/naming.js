import { FIELDS } from './domain.js';
import { parseInput, InputError, isObject } from './input.js';

export function suggestNames(body) {
  const result = parseInput(body);
  if (typeof (body.description ?? '') !== 'string' || (body.description ?? '').length > 2000)
    throw new InputError(400, '서비스 설명은 2,000자 이내로 입력해 주세요.');
  if (body.fields !== undefined && !isObject(body.fields))
    throw new InputError(400, '계산설정 값을 확인해 주세요.');
  const fields = {};
  for (const [key, , values] of FIELDS) {
    const cell = body.fields?.[key];
    if (cell !== undefined && !isObject(cell))
      throw new InputError(400, '계산설정 값을 확인해 주세요.');
    const value = cell === undefined ? result.fields[key].value : cell.value;
    if (
      value !== null &&
      (values
        ? !values.includes(value)
        : typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1e12)
    )
      throw new InputError(400, '계산설정 값을 확인해 주세요.');
    fields[key] = value;
  }
  const type = fields.FEE_TYPE_DVCD,
    base = fields.FEE_SMT_CALC_BASE_DVCD;
  const method = fields.FEE_SMT_CALC_MHOD_DVCD;
  const code = [
    type ?? 'REVIEW',
    base ?? 'CHECK',
    { HALF_UP: 'ROUND', SIGNED_DOWN: 'FLOOR' }[method] ?? method ?? 'CUSTOM',
  ].join('-');
  const description = (body.description ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  const label = [
    base === 'SUM' ? '합산' : base === 'EACH' ? '건별' : '검토',
    type === 'RATE' ? '정률' : type === 'FIXED' ? '정액' : '계산',
  ].join('');
  const prefix = [...description].slice(0, 8).join('');
  return {
    candidates: ['기본', '정산', '상품'].map((suffix, i) => ({
      code: `${code.slice(0, 18).replace(/-+$/, '')}-${i + 1}`,
      name: [...[prefix, label, suffix].filter(Boolean).join('_')].slice(0, 20).join(''),
      reason: description
        ? '입력한 설명과 계산설정으로 만든 이름이에요.'
        : '계산설정으로 만든 이름이에요.',
    })),
  };
}
