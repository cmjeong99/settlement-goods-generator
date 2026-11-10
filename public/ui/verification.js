import { $, make } from './dom.js';
import { PRODUCT_SNAPSHOT_DATE } from '../product-examples.js';
import { productByCode } from '../catalog.js';
import { describeField } from '../domain.js';
import { createTabs } from './workflow.js';
import { createProductPicker } from './catalog.js';
import { createDashboard } from './dashboard.js';
import { reconciliationDashboard } from '../calculation/dashboard.js';
import {
  ASIS_FIELDS,
  MAX_ASIS_ROWS,
  parseAsisInput,
  detectAsisMapping,
  mapAsisRows,
  ASIS_TEMPLATE,
  OPENBANKING_ASIS_SAMPLE,
} from '../calculation/asis-data.js';
import {
  reconcileAsis,
  exportReconciliation,
  needsAggregation,
  RECONCILIATION_LABELS,
} from '../calculation/reconciliation.js';

function download(text, name, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = make('a');
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function metricCell(metric) {
  const cell = make('td');
  if (!metric) {
    cell.textContent = '—';
    return cell;
  }
  cell.className = metric.match === false ? 'asis-difference' : '';
  cell.append(make('strong', metric.calculated || '—'));
  if (metric.asis !== '')
    cell.append(
      make(
        'small',
        `기존 ${metric.asis}${metric.match === false ? ` · 차이 ${metric.difference}` : ''}`,
      ),
    );
  if (metric.missing) cell.title = '기존 금액 미입력';
  return cell;
}

export function createVerification() {
  const tabs = createTabs(document.querySelector('.verification-tabs'));
  const panels = [$('verification-row-panel'), $('verification-sum-panel')];
  const controllers = panels.map((panel, index) => {
    panel.append($('verification-form').content.cloneNode(true));
    return createVerificationPanel(panel, { aggregate: index === 1 });
  });
  return {
    loadInput(product, input) {
      const index = needsAggregation(product) ? 1 : 0;
      tabs.select(index);
      controllers[index].loadInput(product, input);
    },
  };
}

function createVerificationPanel(root, { aggregate }) {
  const $ = (id) => root.querySelector(`[data-verification="${id}"]`);
  const dashboard = createDashboard($('dashboard'));
  const availableProducts = new Map(productByCode);
  let rows = [{ amount: '', feeValue: '', sourceRow: 1 }],
    sourceTable = null,
    mapping = {},
    report = null,
    fileRevision = 0,
    pendingPaste = false;
  const selectedProduct = () => availableProducts.get($('asis-product').value);
  $('asis-identity-heading').textContent = aggregate ? '합계' : '행';
  function status(text, kind = 'info') {
    $('asis-status').textContent = text;
    $('asis-status').dataset.kind = kind;
  }
  function invalidate() {
    dashboard.update(null);
    report = null;
    $('asis-results').hidden = true;
    $('asis-export').disabled = true;
    status('');
    syncActions();
  }
  function syncActions() {
    $('asis-run').disabled =
      (!rows.length && !(pendingPaste && $('asis-paste').value.trim())) ||
      (!selectedProduct() && !$('asis-row-products').checked);
    $('asis-add-row').disabled = rows.length >= MAX_ASIS_ROWS;
    $('asis-row-count').textContent = `입력 ${rows.length}건`;
  }
  const picker = createProductPicker({
    service: $('asis-service'),
    select: $('asis-product'),
    products: () => [...availableProducts.values()],
  });

  function updateProduct() {
    const product = selectedProduct();
    const fieldLabel = (key) =>
      describeField(key, {
        value: product.expected[key],
        status: product.expected[key] === null ? 'unknown' : 'known',
      });
    $('asis-product-info').textContent = product
      ? `${product.name} · ${fieldLabel('FEE_TYPE_DVCD')} · 수수료 ${fieldLabel('FEE_SMT_CALC_BASE_DVCD')} / VAT ${product.expected.VAT_DVCD === 'ZERO' ? '0원 (면세)' : fieldLabel('VAT_SMT_CALC_BASE_DVCD')} · ${['analysis', 'draft'].includes(product.source) ? '직접 판단한 상품 설정' : `${PRODUCT_SNAPSHOT_DATE} DB 설정`}${product.engine !== 'COMMON' ? ' · 특이 계산 미지원' : ''}`
      : '검증할 상품을 선택하세요. SQL 분석 없이 AS-IS 데이터만 입력해도 돼요.';
    $('asis-scope-help').textContent = !product
      ? ''
      : aggregate
        ? '같은 가맹점·정산기간·요율의 거래를 합산해요.'
        : needsAggregation(product)
          ? '각 행을 독립된 정산 단위로 계산해요. 거래 원장은 합산 검증을 사용하세요.'
          : '';
    renderInputs();
    invalidate();
  }

  function visibleFields() {
    const fields = [];
    if (rows.some((row) => row.id)) fields.push(['id', '거래번호']);
    if ($('asis-row-products').checked) fields.push(['productCode', '원본 상품코드']);
    fields.push(['amount', '거래금액']);
    if ($('asis-show-target').checked) fields.push(['targetAmount', '계산대상금액']);
    fields.push([
      'feeValue',
      selectedProduct()?.expected.FEE_TYPE_DVCD === 'FIXED' ? '단가' : '요율',
    ]);
    if (selectedProduct()?.expected.FEE_TYPE_DVCD === 'FIXED' || $('asis-row-products').checked)
      fields.push(['count', '과금건수']);
    if ($('asis-compare').checked)
      fields.push(
        ['asisFee', 'AS-IS 수수료'],
        ['asisVat', 'AS-IS VAT'],
        ['asisPayout', 'AS-IS 지급액'],
      );
    return fields;
  }

  function renderInputs() {
    const fields = visibleFields(),
      head = make('tr');
    for (const [, label] of fields) head.append(make('th', label));
    head.append(make('th', ''));
    $('asis-input-head').replaceChildren(head);
    $('asis-input-container').hidden = !rows.length;
    $('asis-input-empty').hidden = !!rows.length;
    $('asis-input-rows').replaceChildren(
      ...rows.map((row, index) => {
        const tr = make('tr');
        for (const [key, label] of fields) {
          const td = make('td'),
            input = make('input');
          input.value = row[key] ?? '';
          input.maxLength = 120;
          input.setAttribute('aria-label', `${index + 1}행 ${label}`);
          input.dataset.field = key;
          if (!['id', 'productCode'].includes(key)) input.inputMode = 'decimal';
          if (key === 'targetAmount') input.placeholder = '비어 있으면 거래금액';
          if (key === 'count') input.placeholder = '1';
          if (key === 'feeValue' && selectedProduct()?.expected.FEE_TYPE_DVCD !== 'FIXED')
            input.placeholder = '0.015 또는 1.5%';
          input.addEventListener('input', () => {
            fileRevision++;
            row[key] = input.value;
            invalidate();
          });
          td.append(input);
          tr.append(td);
        }
        const remove = make('button', '삭제');
        remove.setAttribute('aria-label', `${index + 1}행 삭제`);
        remove.onclick = () => {
          fileRevision++;
          rows.splice(index, 1);
          updateProduct();
        };
        const td = make('td');
        td.append(remove);
        tr.append(td);
        return tr;
      }),
    );
    syncActions();
  }

  function renderMapping() {
    $('asis-mapping').hidden = !sourceTable;
    if (!sourceTable) return;
    $('asis-mapping-rows').replaceChildren(
      ...ASIS_FIELDS.filter(([key]) => key !== 'groupKey').map(([key, label]) => {
        const tr = make('tr'),
          td = make('td'),
          select = make('select');
        select.dataset.mapping = key;
        select.setAttribute('aria-label', `${label} 원본 컬럼`);
        select.append(
          new Option('사용 안 함', '-1'),
          ...sourceTable.headers.map((header, index) => new Option(header, index)),
        );
        select.value = String(mapping[key]);
        td.append(select);
        tr.append(make('th', label), td);
        return tr;
      }),
    );
  }

  function applyRows() {
    rows = mapAsisRows(sourceTable, mapping);
    $('asis-filter').value = 'all';
    $('asis-compare').checked = rows.some((row) =>
      ['asisFee', 'asisVat', 'asisPayout'].some((key) => row[key] !== ''),
    );
    if (rows.some((row) => row.targetAmount)) $('asis-show-target').checked = true;
    if (!selectedProduct()) {
      const codes = [...new Set(rows.map((row) => row.productCode).filter(Boolean))];
      if (codes.length === 1 && availableProducts.has(codes[0])) picker.setValue(codes[0]);
      else if (codes.length > 1) $('asis-row-products').checked = true;
    }
    $('asis-import-info').textContent = `${rows.length}행`;
    $('asis-mapping').open = mapping.amount < 0 || mapping.feeValue < 0;
    if ($('asis-mapping').open) $('asis-import-panel').open = true;
    updateProduct();
  }

  function importText(text) {
    const table = parseAsisInput(text);
    sourceTable = table;
    mapping = detectAsisMapping(table.headers, selectedProduct());
    // When no product was chosen, use a single input product to select fixed/rate columns correctly.
    const firstMapped = mapAsisRows(table, mapping);
    const codes = [...new Set(firstMapped.map((row) => row.productCode).filter(Boolean))];
    if (!selectedProduct() && codes.length === 1 && availableProducts.has(codes[0])) {
      picker.setValue(codes[0]);
      mapping = detectAsisMapping(table.headers, selectedProduct());
    }
    renderMapping();
    applyRows();
    pendingPaste = false;
    syncActions();
  }

  $('asis-import').onclick = () => {
    fileRevision++;
    try {
      importText($('asis-paste').value);
    } catch (error) {
      invalidate();
      status(error.message, 'error');
    }
  };
  $('asis-file').onchange = async () => {
    const file = $('asis-file').files[0];
    if (!file) return;
    const revision = ++fileRevision;
    status('파일을 읽고 있어요.');
    try {
      if (file.size > 2_000_000) throw new Error('파일은 2MB 이내로 나눠 주세요.');
      const bytes = await file.arrayBuffer();
      let text;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch {
        text = new TextDecoder('euc-kr', { fatal: true }).decode(bytes);
      }
      if (revision !== fileRevision) return;
      importText(text);
      $('asis-paste').value = '';
    } catch (error) {
      if (revision === fileRevision) {
        invalidate();
        status(error.message, 'error');
      }
    } finally {
      if (revision === fileRevision) $('asis-file').value = '';
    }
  };
  $('asis-apply-mapping').onclick = () => {
    fileRevision++;
    if (!sourceTable) return;
    for (const select of $('asis-mapping-rows').querySelectorAll('select'))
      mapping[select.dataset.mapping] = Number(select.value);
    applyRows();
  };
  $('asis-product').onchange = () => {
    fileRevision++;
    updateProduct();
  };
  $('asis-row-products').onchange = () => {
    fileRevision++;
    updateProduct();
  };
  $('asis-show-target').onchange = () => {
    fileRevision++;
    renderInputs();
    invalidate();
  };
  $('asis-compare').onchange = () => {
    fileRevision++;
    renderInputs();
    invalidate();
  };
  $('asis-rate-unit').onchange = () => {
    fileRevision++;
    invalidate();
  };
  $('asis-paste').addEventListener('input', () => {
    fileRevision++;
    pendingPaste = true;
    invalidate();
  });
  $('asis-paste').addEventListener('paste', (event) => {
    const text = event.clipboardData?.getData('text/plain');
    if (!text) return;
    event.preventDefault();
    $('asis-paste').value = text;
    fileRevision++;
    pendingPaste = true;
    try {
      importText(text);
    } catch (error) {
      invalidate();
      status(error.message, 'error');
    }
  });
  $('asis-add-row').onclick = () => {
    fileRevision++;
    if (rows.length >= MAX_ASIS_ROWS) return;
    rows.push(Object.fromEntries(ASIS_FIELDS.map(([key]) => [key, ''])));
    rows.at(-1).sourceRow = rows.length;
    updateProduct();
  };
  $('asis-clear').onclick = () => {
    fileRevision++;
    pendingPaste = false;
    rows = [{ amount: '', feeValue: '', sourceRow: 1 }];
    sourceTable = null;
    mapping = {};
    $('asis-paste').value = '';
    $('asis-file').value = '';
    $('asis-import-info').textContent = '';
    $('asis-filter').value = 'all';
    renderMapping();
    updateProduct();
  };
  $('asis-sample').onclick = () => {
    fileRevision++;
    picker.setValue('OPENBANKING-RATE');
    $('asis-rate-unit').value = 'ratio';
    $('asis-row-products').checked = false;
    $('asis-paste').value = OPENBANKING_ASIS_SAMPLE;
    importText(OPENBANKING_ASIS_SAMPLE);
  };
  $('asis-template').onclick = () =>
    download(
      '\uFEFF' + ASIS_TEMPLATE + '\r\n',
      'asis-settlement-template.tsv',
      'text/tab-separated-values;charset=utf-8',
    );

  function renderReport() {
    if (!report) return;
    const counts = report.summary;
    const comparing = $('asis-compare').checked;
    const showVerdict = comparing || counts.error > 0;
    $('asis-verdict-heading').hidden = !showVerdict;
    $('asis-summary').textContent = [
      ['일치', counts.match],
      ['차이', counts.mismatch],
      ['일부 비교', counts.partial],
      ['계산 불가', counts.error],
    ]
      .filter(([, count]) => count)
      .map(([label, count]) => `${label} ${count}건`)
      .join(' · ');
    $('asis-summary').hidden = !$('asis-summary').textContent;
    $('asis-export').disabled = false;
    const filter = $('asis-filter').value;
    const filtered = report.results.filter(
      (result) =>
        filter === 'all' ||
        (filter === 'uncompared' && ['partial', 'calculated'].includes(result.status)) ||
        result.status === filter,
    );
    $('asis-result-rows').replaceChildren(
      ...filtered.map((result) => {
        const tr = make('tr');
        tr.dataset.status = result.status;
        const identity = make('th', result.key);
        identity.scope = 'row';
        identity.title = `${result.productCode} · 입력 ${result.count}행`;
        const state = make('td');
        state.className = 'asis-verdict';
        state.append(
          make(
            'strong',
            result.status === 'calculated' ? '—' : RECONCILIATION_LABELS[result.status],
          ),
        );
        if (result.status === 'error') state.append(make('small', result.reasons[0]));
        else state.title = result.reasons.join(' ');
        tr.append(
          identity,
          ...['fee', 'vat', 'payout'].map((key) => metricCell(result.metrics?.[key])),
        );
        if (showVerdict) tr.append(state);
        return tr;
      }),
    );
    if (!filtered.length) {
      const tr = make('tr'),
        td = make('td', '해당하는 결과가 없어요.');
      td.colSpan = showVerdict ? 5 : 4;
      tr.append(td);
      $('asis-result-rows').append(tr);
    }
    $('asis-calculation-rows').replaceChildren(
      ...filtered.map((result) => {
        const detail = make('details');
        detail.append(make('summary', `${result.key} · 입력 ${result.count}행`));
        const b = result.breakdown;
        if (b) {
          detail.append(
            make('p', `거래금액 합계 ${b.amount} · 계산대상금액 합계 ${b.targetAmount}`),
            make(
              'p',
              `수수료: 부호·단수 처리 전 합계 ${b.rawFee} → 결과 ${b.fee} · ${b.feeCalculationCount}개 단위로 계산`,
            ),
            make(
              'p',
              `VAT: 부호·단수 처리 전 합계 ${b.rawVat} → 결과 ${b.vat}${b.vatCalculationCount ? ` · ${b.vatCalculationCount}개 단위로 계산` : ' · 면세'}`,
            ),
          );
          if (result.metrics.payout.calculated !== '')
            detail.append(make('p', `지급액: ${b.amount} − (${b.fee}) − (${b.vat}) = ${b.payout}`));
        }
        for (const reason of result.reasons) detail.append(make('p', reason));
        return detail;
      }),
    );
    $('asis-results').hidden = false;
  }
  $('asis-run').onclick = () => {
    try {
      if (pendingPaste) importText($('asis-paste').value);
      const inputRows = $('asis-compare').checked
        ? rows
        : rows.map((row) => ({ ...row, asisFee: '', asisVat: '', asisPayout: '' }));
      report = reconcileAsis(selectedProduct(), inputRows, {
        scope: aggregate ? 'all' : 'rows',
        rateUnit: $('asis-rate-unit').value,
        useRowProducts: $('asis-row-products').checked,
        products: availableProducts,
      });
      renderReport();
      dashboard.update(
        reconciliationDashboard(report, inputRows, {
          aggregate,
          title: $('asis-row-products').checked ? '행별 상품 설정' : selectedProduct()?.name,
        }),
      );
      status('');
    } catch (error) {
      invalidate();
      status(error.message, 'error');
    }
  };
  $('asis-filter').onchange = renderReport;
  $('asis-export').onclick = () => {
    if (report)
      download(
        exportReconciliation(report.results),
        `asis-settlement-${aggregate ? 'sum' : 'rows'}-comparison.csv`,
      );
  };
  updateProduct();
  return {
    loadInput(product, input) {
      fileRevision++;
      availableProducts.set(product.code, product);
      picker.setValue(product.code);
      rows = structuredClone(Array.isArray(input) ? input : [input]);
      sourceTable = null;
      mapping = {};
      pendingPaste = false;
      $('asis-paste').value = '';
      $('asis-file').value = '';
      $('asis-import-info').textContent = '';
      $('asis-filter').value = 'all';
      $('asis-row-products').checked = false;
      $('asis-rate-unit').value = 'ratio';
      $('asis-show-target').checked = rows.some((row) => row.targetAmount);
      $('asis-compare').checked = rows.some((row) =>
        ['asisFee', 'asisVat', 'asisPayout'].some((key) => row[key]?.trim()),
      );
      renderMapping();
      updateProduct();
    },
  };
}
