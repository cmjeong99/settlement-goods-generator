import { FIELDS } from './domain.js';

export const HISTORY_KEY = 'danal.settlement.history.v1';
export const HISTORY_LIMIT = 50;

export function historySnapshot({ result, name }, { sql, tests = [] }) {
  return {
    name: name ? { code: name.code, name: name.name } : null,
    sql,
    inputScope: result.inputScope ?? 'row',
    fields: Object.fromEntries(
      FIELDS.map(([key]) => {
        const cell = result.fields[key];
        return [key, { value: cell.value, status: cell.status, source: cell.source }];
      }),
    ),
    tests: structuredClone(tests),
  };
}

function validEntry(entry) {
  return (
    entry &&
    typeof entry === 'object' &&
    typeof entry.id === 'string' &&
    typeof entry.createdAt === 'string' &&
    Number.isFinite(Date.parse(entry.createdAt)) &&
    typeof entry.sql === 'string' &&
    entry.sql.length <= 100000 &&
    ['row', 'settlement'].includes(entry.inputScope) &&
    (entry.name === null ||
      (entry.name && typeof entry.name.code === 'string' && typeof entry.name.name === 'string')) &&
    entry.fields &&
    FIELDS.every(([key, , values]) => {
      const cell = entry.fields[key];
      return (
        cell &&
        ['known', 'unknown', 'custom', 'not-applicable'].includes(cell.status) &&
        ['parser', 'user', 'context'].includes(cell.source) &&
        (cell.value === null ||
          (values
            ? values.includes(cell.value)
            : typeof cell.value === 'number' &&
              Number.isFinite(cell.value) &&
              cell.value >= 0 &&
              cell.value <= 1e12))
      );
    }) &&
    Array.isArray(entry.tests) &&
    entry.tests.every(
      (test) =>
        test &&
        Array.isArray(test.amounts) &&
        test.amounts.every((amount) => typeof amount === 'string') &&
        typeof test.rate === 'string' &&
        ['match', 'mismatch', 'unavailable'].includes(test.status) &&
        Array.isArray(test.metrics) &&
        test.metrics.every(
          (metric) =>
            metric &&
            ['fee', 'vat'].includes(metric.key) &&
            typeof metric.original === 'string' &&
            typeof metric.calculated === 'string',
        ),
    )
  );
}

export function createHistoryStore(
  storage,
  { now = () => new Date().toISOString(), id = () => crypto.randomUUID() } = {},
) {
  function read() {
    let document;
    try {
      const raw = storage.getItem(HISTORY_KEY);
      if (raw === null) return [];
      document = JSON.parse(raw);
    } catch {
      throw new Error('이 브라우저의 이력을 읽을 수 없어요. 브라우저 저장소 설정을 확인해 주세요.');
    }
    if (
      document?.version !== 1 ||
      !Array.isArray(document.entries) ||
      document.entries.length > HISTORY_LIMIT ||
      !document.entries.every(validEntry)
    )
      throw new Error('저장된 이력 형식을 읽을 수 없어요. 기존 데이터는 유지했어요.');
    return document.entries;
  }
  return {
    read,
    add(snapshot) {
      const entries = read();
      const record = { ...snapshot, id: id(), createdAt: now() };
      if (!validEntry(record)) throw new Error('이력에 저장할 상품 정보를 확인해 주세요.');
      const contents = ({ id, createdAt, ...entry }) => JSON.stringify(entry);
      if (entries[0] && contents(entries[0]) === contents(record)) return entries[0];
      try {
        storage.setItem(
          HISTORY_KEY,
          JSON.stringify({ version: 1, entries: [record, ...entries].slice(0, HISTORY_LIMIT) }),
        );
      } catch {
        throw new Error(
          '복사는 완료했지만 이력을 저장하지 못했어요. 브라우저 저장 공간·권한을 확인해 주세요.',
        );
      }
      return record;
    },
  };
}
