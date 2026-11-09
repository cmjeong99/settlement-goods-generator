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
  let available = false;
  function go(index, { focus = false } = {}) {
    if (index > 0 && !available) return;
    cards.forEach((card, i) => {
      card.open = i === index;
      const heading = card.querySelector('summary');
      if (i === index) heading.setAttribute('aria-current', 'step');
      else heading.removeAttribute('aria-current');
    });
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
    document.querySelector(`[data-step-summary="${index}"]`).textContent = text;
  }
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
    openCalculator() {
      workspace.select(1);
      $('calculator-workspace-tab').focus({ preventScroll: true });
      $('calculator-workspace').scrollIntoView({ block: 'start' });
    },
  };
}
