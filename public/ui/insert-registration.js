import { $, make } from './dom.js';
import { INSERT_FIELDS, normalizeRegistration } from '../product-insert.js';
import { PRODUCT_EXAMPLES } from '../product-examples.js';

export function createInsertRegistration({ onChange }) {
  const inputs = new Map();
  for (const [key, label, maxLength, required, placeholder] of INSERT_FIELDS) {
    const control = make('label', `${label}${required ? ' *' : ''}`);
    const input = make('input');
    input.id = `insert-${key}`;
    input.maxLength = maxLength;
    input.placeholder = placeholder ?? '선택';
    input.spellcheck = false;
    input.disabled = true;
    input.setAttribute('aria-required', String(required));
    input.addEventListener('input', onChange);
    inputs.set(key, input);
    control.append(input);
    const suggestions = [
      ...new Set(PRODUCT_EXAMPLES.map((p) => p.registration?.[key]).filter(Boolean)),
    ];
    if (suggestions.length && key !== 'RMK') {
      const list = make('datalist');
      list.id = `${input.id}-options`;
      list.append(...suggestions.map((value) => new Option(value, value)));
      input.setAttribute('list', list.id);
      control.append(list);
    }
    $(required ? 'insert-required' : 'insert-optional').append(control);
  }
  return {
    read() {
      return normalizeRegistration(
        Object.fromEntries([...inputs].map(([key, input]) => [key, input.value])),
      );
    },
    setProduct(available, product) {
      for (const [key, input] of inputs) {
        if (key !== 'REG_USER_ID') input.value = product?.registration?.[key] ?? '';
        input.disabled = !available;
      }
    },
  };
}
