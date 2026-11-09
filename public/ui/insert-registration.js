import { $, make } from './dom.js';
import { INSERT_FIELDS, normalizeRegistration } from '../product-insert.js';
import { PRODUCT_EXAMPLES } from '../product-examples.js';
import { SERVICES, detailServiceOptions, resolveServiceIdentity } from '../service-catalog.js';

export function createInsertRegistration({ onChange }) {
  const inputs = new Map();
  let authorError;
  function syncAuthor() {
    const input = inputs.get('REG_USER_ID');
    const invalid = !input.disabled && !input.value.trim();
    input.setAttribute('aria-invalid', String(invalid));
    $('insert-author').dataset.invalid = String(invalid);
    const message = invalid ? '등록자 ID를 입력해야 INSERT를 복사할 수 있어요.' : '';
    if (authorError.textContent !== message) authorError.textContent = message;
  }
  function syncService() {
    const service = resolveServiceIdentity(
      Object.fromEntries([...inputs].map(([key, input]) => [key, input.value])),
    );
    $('insert-service-name').textContent =
      service.warning ||
      [
        service.serviceName,
        service.detailName || (service.detailCode ? `세부서비스 ${service.detailCode}` : ''),
      ]
        .filter(Boolean)
        .join(' · ');
    const list = $('insert-DTLS_SRVC_CD-options');
    if (list) {
      const values = new Map(detailServiceOptions(service.serviceCode));
      for (const product of PRODUCT_EXAMPLES.filter((p) => p.serviceCode === service.serviceCode))
        if (!values.has(product.detailServiceCode))
          values.set(product.detailServiceCode, product.detailServiceCode);
      list.replaceChildren(...[...values].map(([value, label]) => new Option(label, value)));
    }
  }
  for (const [key, label, maxLength, required, placeholder] of INSERT_FIELDS) {
    const control = make('label', `${label}${required ? ' *' : ''}`);
    const input = make('input');
    input.id = `insert-${key}`;
    input.maxLength = maxLength;
    input.placeholder = placeholder ?? '선택';
    input.spellcheck = false;
    input.disabled = true;
    input.setAttribute('aria-required', String(required));
    input.addEventListener('input', () => {
      if (key === 'SRVC_CD' || key === 'DTLS_SRVC_CD') syncService();
      if (key === 'REG_USER_ID') syncAuthor();
      onChange();
    });
    inputs.set(key, input);
    control.append(input);
    const suggestions = new Map(
      PRODUCT_EXAMPLES.map((p) => p.registration?.[key])
        .filter(Boolean)
        .map((value) => [value, value]),
    );
    if (key === 'SRVC_CD') for (const [value, label] of SERVICES) suggestions.set(value, label);
    if (key === 'DTLS_SRVC_CD') suggestions.set('00', '일반');
    if (suggestions.size && key !== 'RMK') {
      const list = make('datalist');
      list.id = `${input.id}-options`;
      list.append(...[...suggestions].map(([value, label]) => new Option(label, value)));
      input.setAttribute('list', list.id);
      control.append(list);
    }
    if (key === 'REG_USER_ID') {
      const title = make('span', `${label} `);
      title.append(make('span', '필수', 'required-badge'));
      authorError = make('span', '', 'field-error');
      authorError.id = `${input.id}-error`;
      authorError.setAttribute('role', 'status');
      authorError.setAttribute('aria-live', 'polite');
      input.required = true;
      input.placeholder = '등록자 이름 또는 ID를 입력하세요';
      input.setAttribute('aria-describedby', authorError.id);
      control.replaceChildren(title, input);
      $('insert-author').append(control, authorError);
    } else $(required ? 'insert-required' : 'insert-optional').append(control);
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
      syncService();
      syncAuthor();
    },
  };
}
