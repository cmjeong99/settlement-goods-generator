export const $ = (id) => document.getElementById(id);

export function make(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

export function observeTableOverflow() {
  const tableScroll = document.querySelector('.table-scroll');
  function syncTableOverflow() {
    $('table-scroll-hint').hidden = tableScroll.scrollWidth <= tableScroll.clientWidth;
  }
  new ResizeObserver(syncTableOverflow).observe(tableScroll);
  return syncTableOverflow;
}
