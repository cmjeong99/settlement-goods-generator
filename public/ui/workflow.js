import { $ } from './dom.js';

export function createTabs(tablist) {
  const tabs = [...tablist.querySelectorAll('[role="tab"]')];
  let active = 0;
  function select(index) {
    active = index;
    tabs.forEach((tab, i) => {
      tab.setAttribute('aria-selected', String(i === active));
      tab.tabIndex = i === active ? 0 : -1;
      $(tab.getAttribute('aria-controls')).hidden = i !== active;
    });
  }
  tabs.forEach((tab, index) => {
    tab.onclick = () => select(index);
    tab.onkeydown = (event) => {
      const next = {
        ArrowRight: (index + 1) % tabs.length,
        ArrowLeft: (index + tabs.length - 1) % tabs.length,
        Home: 0,
        End: tabs.length - 1,
      }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      select(next);
      tabs[next].focus();
    };
  });
  return {
    select,
    get active() {
      return active;
    },
  };
}

export function createWorkflow({ onStepChange = () => {} } = {}) {
  const workspace = createTabs(document.querySelector('.workspace-tabs'));
  const cards = [...document.querySelectorAll('[data-workflow-step]')];
  const navigation = [...document.querySelectorAll('[data-workflow-nav]')];
  const guidance = [
    [
      '수식을 준비하세요',
      '서비스별 예제를 선택하거나 수수료·부가세 수식을 입력하고 분석해 주세요.',
      '상품 설정으로 →',
    ],
    [
      '계산 기준을 확인하세요',
      '설정값을 누르면 수식의 근거를 볼 수 있어요. 미확정 항목을 확인한 뒤 예시로 검증해 보세요.',
      '예시 테스트로 →',
    ],
    [
      '같은 예시로 비교하세요',
      '거래금액과 요율을 입력하면 원문 수식과 상품 설정의 계산 결과를 나란히 확인할 수 있어요.',
      '완성·복사로 →',
    ],
    [
      '상품을 완성하세요',
      '상품코드와 이름을 정해 주세요. INSERT를 복사하려면 등록 정보와 등록자 ID도 확인해 주세요.',
      '',
    ],
  ];
  let available = false,
    activeStep = 0;
  const desktop = window.matchMedia('(min-width: 1061px)');
  function placeCopyActions() {
    const inRail = desktop.matches && activeStep === 3;
    const actions = $('product-copy-actions');
    const destination = $(inRail ? 'copy-actions-rail' : 'copy-actions-main');
    const focused = actions.contains(document.activeElement) ? document.activeElement : null;
    $('copy-actions-rail').hidden = !inRail;
    if (actions.parentElement !== destination) {
      destination.append(actions);
      if (focused && focused.getClientRects().length) focused.focus({ preventScroll: true });
    }
    document.querySelector('.workbench-sidebar').dataset.step = String(activeStep);
  }
  desktop.addEventListener('change', placeCopyActions);
  function go(index, { focus = false } = {}) {
    if (index > 0 && !available) return;
    activeStep = index;
    cards.forEach((card, i) => {
      card.open = i === index;
      const heading = card.querySelector('summary');
      if (i === index) heading.setAttribute('aria-current', 'step');
      else heading.removeAttribute('aria-current');
    });
    navigation.forEach((button, i) => {
      if (i === index) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
    });
    const [title, text, action] = guidance[index];
    $('workflow-guide-title').textContent = title;
    $('workflow-guide-text').textContent = text;
    $('workflow-next').hidden = index === 3;
    $('workflow-next').dataset.goStep = String(Math.min(index + 1, 3));
    $('workflow-next').textContent = action;
    $('workflow-next').disabled = !available;
    placeCopyActions();
    onStepChange(index);
    if (focus) {
      cards[index].querySelector('summary').focus({ preventScroll: true });
      cards[index].scrollIntoView({ block: 'start' });
    }
  }
  cards.forEach((card, index) => {
    card.querySelector('summary').onclick = (event) => {
      event.preventDefault();
      go(index);
    };
  });
  for (const button of document.querySelectorAll('[data-go-step]')) {
    button.onclick = () => go(Number(button.dataset.goStep), { focus: true });
  }
  function setSummary(index, text) {
    for (const summary of document.querySelectorAll(`[data-step-summary="${index}"]`))
      summary.textContent = text;
  }
  function openCalculator() {
    workspace.select(1);
    $('calculator-workspace-tab').focus({ preventScroll: true });
    $('calculator-workspace').scrollIntoView({ block: 'start' });
  }
  $('open-calculator').onclick = openCalculator;
  return {
    go,
    setSummary,
    setAvailable(value) {
      available = value;
      cards.forEach((card, index) => {
        card.querySelector('summary').setAttribute('aria-disabled', String(index > 0 && !value));
      });
      for (const button of document.querySelectorAll('[data-go-step]'))
        button.disabled = Number(button.dataset.goStep) > 0 && !value;
      if (!value) {
        go(0);
        setSummary(0, '');
        setSummary(1, '');
        setSummary(2, '');
        setSummary(3, '');
      } else {
        setSummary(0, '입력 완료');
        setSummary(1, '도출 완료');
      }
    },
    openCalculator,
  };
}
