import { $ } from './dom.js';
import { buildFinalProduct } from '../final-product.js';
import { createInsertRegistration } from './insert-registration.js';

export function createFinalProduct({ onChange }) {
  let source = null,
    overrides = {},
    revision = 0;
  const registration = createInsertRegistration({ onChange: () => changed('registration') });
  const draft = () => ({
    ...buildFinalProduct(source, overrides, {
      code: $('final-code').value,
      name: $('final-name').value,
    }),
    registration: registration.read(),
  });
  function preview() {
    $('copy-success').hidden = true;
    const current = draft();
    $('final-errors').textContent = current.errors.join(' ');
    $('final-reset').disabled =
      !source || !Object.keys(overrides).some((key) => overrides[key] !== '');
    $('final-reset').hidden = $('final-reset').disabled;
    $('copy-hint').textContent = '';
  }
  function changed(kind) {
    revision++;
    preview();
    onChange(kind);
  }
  for (const id of ['final-code', 'final-name'])
    $(id).addEventListener('input', () => changed('identity'));
  $('final-reset').onclick = () => {
    overrides = {};
    changed('reset');
  };
  return {
    draft,
    get revision() {
      return revision;
    },
    get overrides() {
      return { ...overrides };
    },
    setField(key, value) {
      overrides[key] = value;
      changed('field');
    },
    setFields(changes) {
      overrides = { ...overrides, ...changes };
      changed('field');
    },
    clearCelebration() {
      $('copy-success').hidden = true;
    },
    celebrate(complete = false, format = 'tsv') {
      const identity = draft().name;
      const success = $('copy-success');
      success.classList.remove('is-celebrating');
      success.hidden = false;
      void success.offsetWidth;
      if (complete) success.classList.add('is-celebrating');
      $('copy-success-title').textContent =
        format === 'sql'
          ? 'INSERT 쿼리를 복사했어요'
          : complete
            ? '다날 정산 상품을 만들었어요!'
            : '현재 상품 표를 복사했어요';
      $('copy-success-description').textContent =
        format === 'sql'
          ? `${identity?.name ?? ''} (${identity?.code ?? ''})의 INSERT 쿼리예요.`
          : complete
            ? '복사했어요. 필요한 곳에 붙여넣으세요.'
            : '';
      success.scrollIntoView({ block: 'nearest' });
    },
    setName(name) {
      $('final-code').value = name?.code ?? '';
      $('final-name').value = name?.name ?? '';
      changed('identity');
    },
    setResult(result, product, { preserveEdits = false } = {}) {
      if (source === result) return;
      if (preserveEdits && source && result) {
        source = result;
        revision++;
        preview();
        return;
      }
      source = result;
      overrides = {};
      revision++;
      $('final-code').value = product?.code ?? '';
      $('final-name').value = product?.name ?? '';
      $('final-code').disabled = $('final-name').disabled = !source;
      registration.setProduct(!!source, product);
      preview();
    },
  };
}
