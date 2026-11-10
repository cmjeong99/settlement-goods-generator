import { make } from './dom.js';
import { Decimal } from '../calculation/decimal.js';
import {
  summarizeDashboard,
  formatDashboardNumber as format,
  dashboardBarWidth,
} from '../calculation/dashboard.js';

const statuses = {
  match: '일치',
  mismatch: '차이 있음',
  unavailable: '비교 불가',
  error: '계산 불가',
  calculated: '계산 완료',
  partial: '일부 비교',
};

export function createDashboard(root) {
  let model = null,
    page = 0;
  const detail = make('details', undefined, 'beta-dashboard');
  const summary = make('summary');
  summary.append(make('span', '가상 대시보드'), make('span', 'BETA', 'beta-badge'));
  const caption = make(
    'p',
    '테스트를 실행하면 입력 데이터로 가상 대시보드를 볼 수 있어요.',
    'dashboard-caption',
  );
  const body = make('div', undefined, 'dashboard-body');
  const toolbar = make('div', undefined, 'dashboard-toolbar');
  const direction = make('select'),
    status = make('select');
  for (const [value, label] of [
    ['all', '전체 거래'],
    ['positive', '양수 거래'],
    ['negative', '음수 거래'],
    ['zero', '0원 거래'],
    ['mixed', '양수·음수 혼합 단위'],
  ])
    direction.append(new Option(label, value));
  for (const [value, label] of [
    ['all', '전체 결과'],
    ['attention', '확인 필요'],
    ['match', '일치'],
    ['calculated', '계산 완료'],
    ['partial', '일부 비교'],
  ])
    status.append(new Option(label, value));
  direction.setAttribute('aria-label', '대시보드 거래 필터');
  status.setAttribute('aria-label', '대시보드 결과 필터');
  toolbar.append(direction, status);
  const content = make('div');
  body.append(toolbar, content);
  detail.append(summary, caption, body);
  root.append(detail);

  function render() {
    body.hidden = !model;
    if (!model) {
      caption.textContent =
        '테스트를 실행하면 입력 데이터로 가상 대시보드를 볼 수 있어요. 입력이나 설정을 바꾸면 다시 테스트해 주세요.';
      content.replaceChildren();
      return;
    }
    const data = summarizeDashboard(model.entries, {
      direction: direction.value,
      status: status.value,
    });
    const currency =
      data.currencies.length === 1 && data.currencies[0] !== '미지정'
        ? `통화 ${data.currencies[0]}`
        : '금액 단위는 입력 데이터 기준';
    caption.textContent = `${model.title} · ${model.scope} · ${currency} · 이번 실행 결과만 표시해요. 필터는 계산 단위 기준이에요.`;
    content.replaceChildren();
    const cards = make('div', undefined, 'dashboard-cards');
    const card = (label, value, note, key) => {
      const item = make('div', undefined, 'dashboard-card');
      item.dataset.dashboardMetric = key;
      item.append(make('span', label), make('strong', value), make('small', note));
      cards.append(item);
    };
    card(
      '입력 거래',
      `${data.count}건`,
      `${data.entries.length}개 계산 단위 · 확인 필요 ${data.attention}개`,
      'count',
    );
    card(
      '거래금액 합계',
      format(data.amount),
      `${data.invalidAmounts ? `금액 오류 ${data.invalidAmounts}건 제외` : '양수·음수를 합산한 순금액'}`,
      'amount',
    );
    for (const [key, label] of [
      ['fee', '수수료'],
      ['vat', '부가세'],
      ['payout', '지급액'],
    ])
      card(
        label,
        format(data.metrics[key].value),
        `${data.metrics[key].count}/${data.entries.length}개 단위 계산${key === 'payout' ? ' · 선취·지급 상품' : ''}`,
        key,
      );
    content.append(cards);
    if (data.mixedCurrencies)
      content.append(
        make(
          'p',
          '통화가 다른 거래가 함께 있어 금액 합계와 차트를 표시하지 않아요. 같은 통화끼리 나누어 테스트해 주세요.',
          'dashboard-notice',
        ),
      );
    if (data.errors)
      content.append(
        make(
          'p',
          `계산 불가 ${data.errors}개 단위는 수수료·부가세·지급액 합계에서 제외했어요. 아래 상세에서 원인을 확인하세요.`,
          'dashboard-notice',
        ),
      );
    const grid = make('div', undefined, 'dashboard-grid');
    const distribution = make('section', undefined, 'dashboard-section');
    distribution.append(make('h3', '거래 구성'));
    const split = make('div', undefined, 'dashboard-split');
    for (const [label, count, amount, type] of [
      ['양수 거래', data.positive, data.positiveAmount, 'positive'],
      ['음수 거래', data.negative, data.negativeAmount, 'negative'],
      ['0원 거래', data.zero, data.mixedCurrencies ? null : '0', 'zero'],
    ]) {
      const item = make('div');
      item.dataset.direction = type;
      item.append(make('span', label), make('strong', `${count}건`), make('small', format(amount)));
      split.append(item);
    }
    distribution.append(split);
    grid.append(distribution);
    const chart = make('section', undefined, 'dashboard-section');
    chart.append(
      make('h3', '계산 단위별 거래금액'),
      make(
        'p',
        '절댓값이 큰 순서로 최대 8개를 표시해요. 음수 금액은 부호를 유지해요.',
        'dashboard-caption',
      ),
    );
    const amounts = data.mixedCurrencies
      ? []
      : data.entries
          .filter((item) => item.amount !== null)
          .slice()
          .sort((a, b) => Decimal.parse(b.amount).abs().compare(Decimal.parse(a.amount).abs()))
          .slice(0, 8);
    for (const item of amounts) {
      const row = make('div', undefined, 'dashboard-bar-row');
      row.title = item.key;
      const track = make('div', undefined, 'dashboard-bar-track');
      const bar = make('span');
      bar.style.width = `${dashboardBarWidth(item.amount, amounts[0].amount)}%`;
      bar.dataset.negative = String(Decimal.parse(item.amount).sign() < 0);
      track.append(bar);
      row.append(make('span', item.key), track, make('strong', format(item.amount)));
      chart.append(row);
    }
    if (!amounts.length) chart.append(make('p', '표시할 금액이 없어요.', 'dashboard-caption'));
    grid.append(chart);
    content.append(grid);
    const section = make('section', undefined, 'dashboard-section');
    section.append(make('h3', '계산 단위별 상세'));
    const scroll = make('div', undefined, 'table-scroll');
    scroll.tabIndex = 0;
    scroll.setAttribute('role', 'region');
    scroll.setAttribute('aria-label', '대시보드 계산 상세');
    const table = make('table'),
      head = make('thead'),
      tr = make('tr'),
      tbody = make('tbody');
    for (const label of [
      '계산 단위',
      '입력 건수',
      '거래금액',
      '수수료',
      '부가세',
      '지급액',
      '결과',
    ]) {
      const th = make('th', label);
      th.scope = 'col';
      tr.append(th);
    }
    head.append(tr);
    const selected = data.entries.slice(page * 20, (page + 1) * 20);
    for (const item of selected) {
      const row = make('tr');
      const key = make('th', item.key);
      key.scope = 'row';
      row.append(key, make('td', `${item.inputs.length}건`));
      for (const name of ['amount', 'fee', 'vat', 'payout'])
        row.append(make('td', format(item[name])));
      const state = make('td');
      state.append(make('span', statuses[item.status] || item.status, 'dashboard-status'));
      if (item.reasons.length) {
        const reasons = make('details');
        reasons.append(make('summary', '확인사항'));
        for (const reason of item.reasons) reasons.append(make('p', reason));
        state.append(reasons);
      }
      row.dataset.status = item.status;
      row.append(state);
      tbody.append(row);
    }
    table.append(head, tbody);
    scroll.append(table);
    section.append(scroll);
    if (!selected.length) section.append(make('p', '해당하는 결과가 없어요.', 'dashboard-caption'));
    const pagination = make('div', undefined, 'dashboard-pagination');
    const previous = make('button', '이전'),
      next = make('button', '다음');
    previous.type = next.type = 'button';
    previous.disabled = page === 0;
    next.disabled = (page + 1) * 20 >= data.entries.length;
    previous.onclick = () => {
      page--;
      render();
    };
    next.onclick = () => {
      page++;
      render();
    };
    pagination.append(
      previous,
      make(
        'span',
        `${data.entries.length ? page * 20 + 1 : 0}–${Math.min((page + 1) * 20, data.entries.length)} / ${data.entries.length}개 단위`,
      ),
      next,
    );
    section.append(pagination);
    content.append(section);
  }
  direction.onchange = status.onchange = () => {
    page = 0;
    render();
  };
  render();
  return {
    setTitle(title) {
      if (!model || !title || model.title === title) return;
      model = { ...model, title };
      render();
    },
    update(next) {
      model = next;
      page = 0;
      direction.value = status.value = 'all';
      render();
    },
  };
}
