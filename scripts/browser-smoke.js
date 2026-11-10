// Accepts an existing Playwright Page; no browser package is required by the site.
// A separate context and mocked clipboard keep checks isolated from user data.
export async function runBrowserSmoke(hostPage, { baseURL = 'http://127.0.0.1:4317' } = {}) {
  const context = await hostPage
    .context()
    .browser()
    .newContext({ viewport: { width: 1440, height: 1000 } });
  context.setDefaultTimeout(7000);
  const checks = [],
    errors = [];
  const check = (condition, name) => {
    if (!condition) throw new Error(`Browser smoke failed: ${name}`);
    checks.push(name);
  };
  const open = async (details) => {
    if (!(await details.evaluate((element) => element.open)))
      await details.locator(':scope > summary').click();
  };
  await context.addInitScript(() => {
    window.__smokeClipboard = '';
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text) => {
          window.__smokeClipboard = text;
        },
        readText: async () => '',
      },
    });
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(baseURL);
    await page.locator('#example').selectOption('OPENBANKING-RATE');
    const comparison = page.locator('#product-comparison');
    check(
      await comparison.evaluate((element) => element.parentElement.id !== 'review-details'),
      'DB comparison is visible outside supporting details',
    );
    await page.locator('[data-workflow-nav="0"]').click();
    await page.locator('#example').selectOption('OPENBANKING-FIXED');
    check(
      (await comparison.evaluate((element) => element.open)) &&
        (await comparison.getAttribute('data-state')) === 'different',
      'DB differences open automatically for a new product',
    );
    await page.locator('[data-workflow-nav="0"]').click();
    await page.locator('#example').selectOption('OPENBANKING-RATE');
    await page.locator('[data-product-field="SIGN_APLY_LOCT_DVCD"]').click();
    await page.locator('[data-decision-field="SIGN_APLY_LOCT_DVCD"]').selectOption('AFTER');
    check(
      (await page.locator('#product-comparison-rows tr').first().getAttribute('data-field')) ===
        'SIGN_APLY_LOCT_DVCD' &&
        (await page.locator('#product-comparison-title').textContent()).includes('차이 1개'),
      'edited DB mismatch moves to the top and updates count',
    );
    await page.locator('[data-decision-field="SIGN_APLY_LOCT_DVCD"]').selectOption('NONE');
    check(
      (await comparison.getAttribute('data-state')) === 'match',
      'restoring DB value clears mismatch immediately',
    );
    const step = (index) => page.locator(`[data-workflow-nav="${index}"]`).click();
    const quick = page.locator('#quick-dashboard');
    const quickMetric = (key) =>
      quick.locator(`[data-dashboard-metric="${key}"] strong`).textContent();
    await step(2);
    await page.locator('#quick-amount').fill('9900');
    await page.locator('#quick-rate').fill('1.5%');
    await page.locator('#quick-run').click();
    check(
      (await quickMetric('fee')) === '148' && (await quickMetric('payout')) === '9,738',
      'quick calculation',
    );
    await page.locator('#quick-run').click();
    check(
      (await page.locator('#workspace-test-card').textContent()).includes('1개 일치'),
      'duplicate tests do not inflate count',
    );
    await page.locator('#quick-amount').fill('-9900');
    check(
      (await page.locator('#workspace-test-card').textContent()).includes('재테스트'),
      'edited inputs become stale',
    );
    check((await quick.locator('.dashboard-card').count()) === 0, 'edited inputs clear dashboard');
    await page.locator('#quick-run').click();
    check((await quickMetric('payout')) === '-10,062', 'negative payout');
    await open(page.locator('#quick-history-wrap'));
    await open(page.locator('#quick-history > details').first());
    await page
      .locator('#quick-history > details')
      .first()
      .getByRole('button', { name: '이 예시 기록 제외', exact: true })
      .click();
    check(
      (await page.evaluate(() => document.activeElement.tagName)) === 'SUMMARY',
      'removing a test record keeps keyboard focus in history',
    );
    await page.locator('#quick-history-clear').click();
    check(
      (await page.evaluate(() => document.activeElement.id)) === 'quick-amount',
      'clearing test records focuses the next amount input',
    );

    await step(3);
    await page.locator('#show-insert-preview').click();
    check(
      (await page.locator('#insert-preview-status').textContent()).includes('등록자'),
      'missing author is explained',
    );
    await page.locator('#insert-REG_USER_ID').fill('browser-smoke');
    await page.locator('#final-code').fill("SMOKE'01");
    await page.locator('#final-name').fill("검증 '상품' <img src=x>");
    await page.locator('#insert-optional [data-null-field="RMK"]').click();
    const preview = await page.locator('#insert-preview-code').textContent();
    await page.locator('#copy-insert').click();
    check(
      preview === (await page.evaluate(() => window.__smokeClipboard)),
      'INSERT preview equals copied SQL',
    );
    check(
      preview.includes("SMOKE''01") &&
        preview.includes("검증 ''상품''") &&
        preview.includes('NULL'),
      'INSERT escaping and NULL',
    );
    check((await page.locator('#insert-preview img').count()) === 0, 'preview escapes HTML');
    await page.locator('#insert-REG_USER_ID').fill('');
    check(
      (await page.locator('#insert-preview-code').textContent()) === '' &&
        (await page.locator('#copy-insert').isDisabled()),
      'invalid metadata clears SQL preview',
    );
    await page.locator('#insert-REG_USER_ID').fill('browser-smoke');
    await page.locator('#insert-FEE_RCVG_DVCD').fill('POST');
    await step(2);
    await page.locator('#quick-run').click();
    check((await quickMetric('payout')) === '—', 'current collection method governs payout');
    await step(3);
    await page.locator('#insert-CALC_ENGE_DVCD').fill('CUSTOM');
    await step(2);
    await page.locator('#quick-run').click();
    check(
      (await quickMetric('fee')) === '—',
      'custom engine is not replaced by common calculation',
    );
    await step(3);
    await page.locator('#insert-CALC_ENGE_DVCD').fill('COMMON');
    await page.locator('#insert-FEE_RCVG_DVCD').fill('PRE');
    await step(2);
    await open(page.locator('#quick-options'));
    await open(page.locator('#quick-options > details').first());
    await page.locator('#quick-second-amount').fill('5000');
    await open(page.locator('#quick-source-panel'));
    const source = page.locator('[data-source-index="1"][data-source-column="AMT"]');
    await source.fill('7777');
    await page.locator('#quick-second-amount').fill('');
    await page.locator('#quick-second-amount').fill('5000');
    check((await source.inputValue()) === '7777', 'manual source input survives row removal');
    await page.locator('#quick-source-reset').click();
    check((await source.inputValue()) === '5000', 'source input reconnects to amount');

    await page.locator('#calculator-workspace-tab').click();
    const panel = page.locator('#verification-row-panel');
    const product = panel.locator('[data-verification="asis-product"]');
    const paste = panel.locator('[data-verification="asis-paste"]');
    const run = panel.locator('[data-verification="asis-run"]');
    const importData = async (text) => {
      await open(panel.locator('[data-verification="asis-import-panel"]'));
      await paste.fill(text);
      await panel.locator('[data-verification="asis-import"]').click();
    };
    await product.selectOption('OPENBANKING-RATE');
    await panel.locator('[data-verification="asis-add-row"]').click();
    check(
      (await page.evaluate(() => document.activeElement.dataset.field)) === 'amount',
      'adding a row focuses its amount',
    );
    await panel.getByRole('button', { name: '2행 삭제', exact: true }).click();
    check(
      (await page.evaluate(() => document.activeElement.dataset.field)) === 'amount',
      'removing a row focuses the remaining amount',
    );
    await panel.getByRole('button', { name: '1행 삭제', exact: true }).click();
    check(
      (await page.evaluate(() => document.activeElement.dataset.verification)) === 'asis-add-row',
      'removing the final row focuses add-row',
    );
    await panel.locator('[data-verification="asis-add-row"]').click();
    await importData('AMT\tCALRATE\tAUTHRATE\n9900\t0.015\t100');
    await product.selectOption('OPENBANKING-FIXED');
    check(
      (await panel.locator('[data-field="feeValue"]').inputValue()) === '100',
      'product change remaps fixed fee',
    );
    await panel.locator('[data-field="feeValue"]').fill('125');
    await product.selectOption('OPENBANKING-RATE');
    check(
      (await panel.locator('[data-field="feeValue"]').inputValue()) === '125',
      'manual fee survives product change',
    );
    await product.selectOption('');
    await importData(
      'SMT_GDS_CD\tAMT\tCALRATE\tAUTHRATE\nOPENBANKING-RATE\t9900\t0.015\t100\nOPENBANKING-FIXED\t9900\t0.015\t100',
    );
    const mixedValues = await panel
      .locator('[data-field="feeValue"]')
      .evaluateAll((inputs) => inputs.map((input) => input.value));
    check(mixedValues.join(',') === '0.015,100', 'row products choose their own rate columns');
    await open(panel.locator('[data-verification="asis-extra"]'));
    await panel.locator('[data-verification="asis-row-products"]').uncheck();
    await product.selectOption('OPENBANKING-RATE');
    await importData(
      'TID\tAMT\tCPRATE\tCURRENCY\n' +
        Array.from({ length: 25 }, (_, index) => `KRW-${index + 1}\t10000\t1.5%\tKRW`).join('\n') +
        '\nUSD-1\t100\t1.5%\tUSD',
    );
    await paste.fill('');
    await run.click();
    check(
      await panel.locator('[data-verification="asis-results"]').isVisible(),
      'empty paste keeps imported rows usable',
    );
    const board = panel.locator('[data-verification="dashboard"]');
    await open(board.locator('.beta-dashboard'));
    const metric = (key) => board.locator(`[data-dashboard-metric="${key}"] strong`).textContent();
    check((await metric('amount')) === '—', 'mixed currencies are not summed');
    await board.getByLabel('대시보드 통화 필터').selectOption('KRW');
    check((await metric('amount')) === '250,000', 'currency filter recomputes exact totals');
    const downloaded = page.waitForEvent('download');
    await board.getByRole('button', { name: '현재 필터 CSV', exact: true }).click();
    check(
      (await downloaded).suggestedFilename() === 'settlement-dashboard-beta.csv',
      'filtered CSV download',
    );
    await board.getByRole('button', { name: '다음', exact: true }).focus();
    await page.keyboard.press('Enter');
    check((await board.locator('tbody tr').count()) === 5, 'dashboard second page');
    check(
      (await page.evaluate(() => document.activeElement.textContent)) === '이전',
      'pagination retains keyboard focus',
    );
    await board.getByRole('button', { name: '필터 초기화', exact: true }).click();
    check(
      (await metric('amount')) === '—' && (await board.locator('tbody tr').count()) === 20,
      'filter reset also resets pagination',
    );
    await page.setViewportSize({ width: 390, height: 844 });
    check(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      'mobile page does not overflow',
    );
    await page.setViewportSize({ width: 1440, height: 1000 });

    await page.evaluate(() => {
      window.__smokeReads = {};
      window.__smokeStartFile = (id, amount) => {
        const input = document.querySelector(
          '#verification-row-panel [data-verification="asis-file"]',
        );
        const transfer = new DataTransfer();
        transfer.items.add(
          new File([`AMT\tCPRATE\n${amount}\t0.015`], id + '.csv', { type: 'text/csv' }),
        );
        input.files = transfer.files;
        const file = input.files[0];
        file.arrayBuffer = () =>
          new Promise((resolve) => {
            window.__smokeReads[id] = async () =>
              resolve(await Blob.prototype.arrayBuffer.call(file));
          });
        input.dispatchEvent(new Event('change', { bubbles: true }));
      };
      window.__smokeFinishFile = async (id) => {
        await window.__smokeReads[id]();
        await new Promise(requestAnimationFrame);
      };
    });
    await page.evaluate(() => window.__smokeStartFile('delayed', 20000));
    check(await run.isDisabled(), 'calculation waits for active file read');
    await panel.locator('[data-field="amount"]').first().fill('15000');
    await page.evaluate(() => window.__smokeFinishFile('delayed'));
    check(
      (await panel.locator('[data-field="amount"]').first().inputValue()) === '15000',
      'stale file cannot overwrite edited rows',
    );
    check(
      (await panel
        .locator('[data-verification="asis-file"]')
        .evaluate((input) => input.files.length)) === 0,
      'canceled file selection is cleared for retry',
    );
    await page.evaluate(() => {
      window.__smokeStartFile('older', 30000);
      window.__smokeStartFile('newer', 40000);
    });
    await page.evaluate(() => window.__smokeFinishFile('older'));
    check(await run.isDisabled(), 'older file cannot release newer file loading state');
    await page.evaluate(() => window.__smokeFinishFile('newer'));
    check(
      (await panel.locator('[data-field="amount"]').inputValue()) === '40000',
      'newest file wins',
    );
    await page.locator('#verification-sum-tab').click();
    const sumPanel = page.locator('#verification-sum-panel');
    await sumPanel
      .locator('[data-verification="asis-product"]')
      .selectOption('BOOKNLIFEGIFT-BASIC');
    await open(sumPanel.locator('[data-verification="asis-import-panel"]'));
    await sumPanel.locator('[data-verification="asis-paste"]').fill('10000\t0.015\n0\t0.015');
    await sumPanel.locator('[data-verification="asis-run"]').click();
    check(
      (await sumPanel
        .locator('[data-verification="asis-result-rows"] tr')
        .first()
        .getAttribute('data-status')) !== 'error',
      'zero amount does not invalidate aggregate approval',
    );
    await sumPanel.locator('[data-field="amount"]').nth(1).fill('-10000');
    await sumPanel.locator('[data-verification="asis-run"]').click();
    check(
      (
        await sumPanel.locator('[data-verification="asis-calculation-rows"]').textContent()
      ).includes('승인과 취소'),
      'aggregate approval/cancel mixture is explained',
    );
    await sumPanel.locator('[data-field="amount"]').first().fill('0.0000000000000000001');
    await sumPanel.locator('[data-field="amount"]').nth(1).fill('0');
    for (const input of await sumPanel.locator('[data-field="feeValue"]').all())
      await input.fill('0');
    await sumPanel.locator('[data-verification="asis-run"]').click();
    const sumBoard = sumPanel.locator('[data-verification="dashboard"]');
    await open(sumBoard.locator('.beta-dashboard'));
    check(
      (await sumBoard.locator('[data-dashboard-metric="amount"] strong').textContent()) ===
        '0.0000000000000000001',
      'small finite amounts retain every supported digit',
    );
    for (const input of await sumPanel.locator('[data-field="amount"]').all())
      await input.fill('9'.repeat(120));
    await sumPanel.locator('[data-verification="asis-run"]').click();
    await page.setViewportSize({ width: 390, height: 844 });
    check(
      (await sumBoard.locator('[data-dashboard-metric="amount"] strong').textContent()).replaceAll(
        ',',
        '',
      ).length === 121 &&
        (await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)),
      'large aggregate results survive charting and mobile layout',
    );
    await page.locator('#product-workspace-tab').click();
    await page.locator('[data-workflow-nav="1"]').click();
    await page.locator('#edit-calculation').click();
    await open(page.locator('.rounding-custom-details'));
    await page.getByLabel('처리 단위 직접 지정').fill('0');
    check(await page.locator('#rounding-apply').isDisabled(), 'invalid rounding unit blocks apply');
    await page.locator('#code-proof [data-null-field="FEE_SMT_CALC_UNIT_VAL"]').click();
    check(
      (await page.locator('#code-proof .field-error').textContent()) === '',
      'NULL unit clears previous input error',
    );
    await page.locator('#rounding-apply').click();
    const applied = await page.locator('#code-proof .rounding-feedback').evaluate((element) => ({
      text: element.textContent,
      color: getComputedStyle(element).color,
    }));
    check(
      applied.text.includes('반영') && applied.color === 'rgb(9, 105, 239)',
      'rounding success uses Danal blue feedback',
    );
    check(
      (await page
        .locator('#product-comparison-rows tr[data-field="FEE_SMT_CALC_UNIT_VAL"]')
        .getAttribute('data-status')) === 'different',
      'NULL selection is compared against the DB value',
    );
    await step(2);
    await open(page.locator('#quick-options'));
    await open(page.locator('#quick-source-panel'));
    const manualSource = page.locator('[data-source-index="0"][data-source-column="AMT"]');
    await manualSource.fill('7777');
    await step(3);
    await page.locator('#final-code').fill('FORMAT-KEEP');
    await page.locator('#final-name').fill('정렬 보존 상품');
    await page.locator('#insert-SRVC_CD').fill('11111');
    await page.locator('#insert-REG_USER_ID').fill('format-user');
    await step(0);
    const originalSql = await page.locator('#sql').inputValue();
    await page.locator('#format-sql').click();
    check(
      (await page.locator('#example').inputValue()) === 'OPENBANKING-RATE',
      'SQL formatting keeps selected DB product',
    );
    check(
      (await page.locator('#final-name').inputValue()) === '정렬 보존 상품' &&
        (await page.locator('#insert-SRVC_CD').inputValue()) === '11111' &&
        (await page.locator('#insert-REG_USER_ID').inputValue()) === 'format-user',
      'SQL formatting preserves identity and registration edits',
    );
    check(
      (await page.locator('[data-product-field="FEE_SMT_CALC_UNIT_VAL"] strong').textContent()) ===
        'NULL' && (await manualSource.inputValue()) === '7777',
      'SQL formatting preserves decisions and manual test bindings',
    );
    await page.locator('#analyze').click();
    check(
      (await page.locator('#final-code').inputValue()) === 'FORMAT-KEEP',
      'unchanged SQL reanalysis keeps edits',
    );
    await step(0);
    await page.locator('#undo-format-sql').click();
    check(
      (await page.locator('#sql').inputValue()) === originalSql &&
        (await page.locator('#final-name').inputValue()) === '정렬 보존 상품',
      'format undo restores text without losing edits',
    );
    await page.locator('#sql').fill(originalSql + '\n-- 직접 수정');
    check(
      (await page.locator('#example').inputValue()) === '' &&
        (await page.locator('#copy-insert').isDisabled()),
      'manual SQL editing still invalidates analysis',
    );
    check(errors.length === 0, 'no browser runtime errors');
    return { baseURL, passed: checks.length, checks };
  } finally {
    await context.close();
  }
}

export function browserSmokeCode(baseURL = 'http://127.0.0.1:4317') {
  return `async (page) => { const run = ${runBrowserSmoke.toString()}; return await run(page, { baseURL: ${JSON.stringify(baseURL)} }); }`;
}

if (process.argv[2] === '--print-code')
  process.stdout.write(JSON.stringify({ code: browserSmokeCode(process.argv[3]) }));
