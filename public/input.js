import { analyze } from './analyzer.js';
import { columnNames } from './parser.js';

// Validation for browser-side analysis and product naming.
export class InputError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'InputError';
    this.status = status;
  }
}

export const isObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export function parseInput(body) {
  if (
    !isObject(body) ||
    typeof body.sql !== 'string' ||
    !body.sql.trim() ||
    body.sql.length > 100000
  ) {
    throw new InputError(400, '분석할 수식을 100,000자 이내로 입력해 주세요.');
  }
  try {
    columnNames(body.columns);
  } catch (error) {
    throw new InputError(400, error.message);
  }
  const parsed = analyze(body.sql, body.columns);
  if (
    parsed.errors.length ||
    parsed.results.length !== 1 ||
    Object.values(parsed.results[0].fields).every((cell) => cell.status === 'unknown')
  ) {
    throw new InputError(
      400,
      '분석 가능한 계산 구문 하나를 선택해 주세요. 컬럼명과 구문 오류를 확인해 주세요.',
    );
  }
  return parsed.results[0];
}
