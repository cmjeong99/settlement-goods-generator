import { $, make } from './dom.js';
import { HISTORY_KEY, createHistoryStore, historySnapshot } from '../history.js';
import { PRODUCT_COLUMNS, productTable } from '../product-table.js';
import { INSERT_FIELDS } from '../product-insert.js';
import { NULL_OVERRIDE } from '../domain.js';

export function createHistory() {
  function store() {
    try {
      return createHistoryStore(window.localStorage);
    } catch {
      throw new Error('이 브라우저에서 로컬 저장소에 접근할 수 없어요.');
    }
  }
  function render() {
    const list = $('history-list');
    list.replaceChildren();
    $('history-status').textContent = '';
    $('history-count').textContent = '';
    try {
      const entries = store().read();
      $('history-empty').hidden = entries.length > 0;
      $('history-count').textContent = entries.length ? `${entries.length}개` : '';
      for (const entry of entries) {
        const detail = make('details', undefined, 'history-entry');
        const heading = make('summary');
        const title = make('span', entry.name?.name || '이름 없는 상품', 'history-entry-title');
        const date = make('time', new Date(entry.createdAt).toLocaleString('ko-KR'));
        date.dateTime = entry.createdAt;
        heading.append(title, date);
        detail.append(heading);
        let loaded = false;
        detail.ontoggle = () => {
          if (!detail.open || loaded) return;
          loaded = true;
          const scroll = make('div', undefined, 'table-scroll history-table'),
            table = make('table'),
            head = make('thead'),
            body = make('tbody'),
            headers = make('tr'),
            values = make('tr');
          for (const [key, label] of PRODUCT_COLUMNS) {
            const th = make('th', label);
            th.scope = 'col';
            th.title = key;
            headers.append(th);
          }
          for (const cell of productTable({ fields: entry.fields }, entry.name).cells)
            values.append(make('td', cell.value || '—'));
          head.append(headers);
          body.append(values);
          table.append(head, body);
          scroll.append(table);
          detail.append(scroll);
          const registration = INSERT_FIELDS.filter(([key]) => entry.registration?.[key]);
          if (registration.length) {
            const info = make('details', undefined, 'history-source');
            info.append(make('summary', 'INSERT 등록 정보'));
            for (const [key, label] of registration)
              info.append(
                make(
                  'p',
                  `${label}: ${entry.registration[key] === NULL_OVERRIDE ? 'NULL' : entry.registration[key]}`,
                ),
              );
            detail.append(info);
          }
          const sql = make('details', undefined, 'history-source');
          sql.append(make('summary', '수식'), make('pre', entry.sql));
          detail.append(sql);
          if (entry.tests.length) {
            const tests = make('details', undefined, 'history-source');
            tests.append(make('summary', `예시 ${entry.tests.length}개`));
            for (const test of entry.tests) {
              const record = make('div', undefined, 'history-test');
              record.append(make('p', `금액 ${test.amounts.join(', ')} · 요율·단가 ${test.rate}`));
              for (const metric of test.metrics)
                record.append(
                  make(
                    'p',
                    `${metric.key === 'fee' ? '수수료' : 'VAT'} · 원문 ${metric.original || '비교 불가'} / 상품 ${metric.calculated || '비교 불가'}`,
                  ),
                );
              tests.append(record);
            }
            detail.append(tests);
          }
        };
        list.append(detail);
      }
    } catch (error) {
      $('history-empty').hidden = true;
      $('history-status').textContent = error.message;
    }
  }
  $('history-workspace-tab').addEventListener('click', render);
  window.addEventListener('storage', (event) => {
    if (event.key === HISTORY_KEY || event.key === null) render();
  });
  render();
  return {
    save(draft, context) {
      try {
        store().add(historySnapshot(draft, context));
        render();
        return '';
      } catch (error) {
        return error.message.startsWith('복사는 완료했지만')
          ? error.message
          : `복사는 완료했지만 이력을 저장하지 못했어요. ${error.message}`;
      }
    },
  };
}
