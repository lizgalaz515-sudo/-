const { test, expect } = require('@playwright/test');

async function ready(page) {
  await page.goto('/');
  await expect(page.locator('.greeting-title')).toBeVisible();
}

async function startPersonal(page) {
  await page.locator('.hero-button').click();
  await expect(page.locator('.modal-sheet')).toBeVisible();
  await page.locator('.sheet-primary').click();
  await expect(page.locator('#native-dialog')).toBeVisible();
  await page.locator('#dialog-confirm').click();
  await expect(page.locator('.active-title')).toHaveText('背部训练');
}

test('mobile and desktop overview, calendar and insights remain usable without console errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', entry => { if (entry.type() === 'error') errors.push(entry.text()); });
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await ready(page);
    await expect(page.locator('.demo-pill')).toHaveText('示例数据');
    await expect(page.locator('.workout-row')).toHaveCount(3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const nav = width < 900 ? '.bottom-nav' : '.sidebar';
    await page.locator(`${nav} [data-tab="history"]`).click();
    await expect(page.locator('.calendar-grid')).toBeVisible();
    await page.locator('.month-controls button').first().click();
    await page.locator('.month-controls button').last().click();
    await page.locator(`${nav} [data-tab="insights"]`).click();
    await expect(page.locator('.heatmap .heat-cell')).toHaveCount(84);
    await expect(page.locator('.trend-bar-column')).toHaveCount(7);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator(`${nav} [data-tab="settings"]`).click();
    await expect(page.locator('.privacy-note')).toContainText('当前设备');
  }
  expect(errors).toEqual([]);
});

test('first personal workout clears samples only on confirmation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  await page.locator('.hero-button').click();
  await page.locator('.sheet-primary').click();
  await page.locator('#dialog-cancel').click();
  expect(await page.evaluate(() => window.__lianji.data.active)).toBeNull();
  expect(await page.evaluate(() => window.__lianji.data.summary.totalWorkouts)).toBe(21);
  await page.locator('.sheet-primary').click();
  await page.locator('#dialog-confirm').click();
  expect(await page.evaluate(() => window.__lianji.data.summary.totalWorkouts)).toBe(0);
  await expect(page.locator('.demo-pill')).toHaveCount(0);
});

test('edits, autosaves, resumes, completes, backs up and restores a real workout through the UI', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read','clipboard-write']);
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  await startPersonal(page);
  await page.locator('.finish-button').click();
  await expect(page.locator('#toast')).toContainText('至少一组');
  const first = page.locator('.exercise-card').first();
  await first.locator('[data-field="weight"]').first().fill('');
  await first.locator('[data-field="weight"]').first().pressSequentially('42.5');
  await first.locator('[data-field="reps"]').first().fill('8');
  await first.locator('.add-set-button').click();
  await expect(first.locator('.set-row')).toHaveCount(4);
  await first.locator('.set-check').first().click();
  await page.locator('.workout-notes').fill('今天动作更稳了。');
  const previousDate = await page.evaluate(() => { const d = new Date(); d.setDate(d.getDate()-1); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; });
  await page.locator('.native-picker input[type="date"]').fill(previousDate);
  await page.locator('.native-picker input[type="date"]').dispatchEvent('change');
  await page.reload();
  await expect(page.locator('.active-title')).toHaveText('背部训练');
  await expect(page.locator('.exercise-card').first().locator('[data-field="weight"]').first()).toHaveValue('42.5');
  await expect(page.locator('.workout-notes')).toHaveValue('今天动作更稳了。');
  expect(await page.evaluate(() => window.__lianji.data.active.volumeLabel)).toBe('340');
  expect(await page.evaluate(() => window.__lianji.data.active.date)).toBe(previousDate);
  await page.locator('.finish-button').click();
  await page.locator('#dialog-confirm').click();
  await expect(page.locator('.history-list .workout-row')).toHaveCount(1);
  await page.locator('.history-list .workout-row').click();
  await expect(page.locator('.detail-set')).toHaveCount(1);
  await expect(page.locator('.detail-set')).toContainText('42.5 kg');
  await expect(page.locator('.detail-set')).toContainText('8 次');
  await expect(page.locator('.detail-note')).toContainText('今天动作更稳了。');
  await page.locator('.close-button').click();
  await page.locator('.bottom-nav [data-tab="settings"]').click();
  await page.getByRole('button', { name: /导出训练记录/ }).click();
  const backup = await page.evaluate(() => navigator.clipboard.readText());
  expect(JSON.parse(backup).workouts).toHaveLength(1);
  await page.locator('.bottom-nav [data-tab="history"]').click();
  await page.locator('.history-list .workout-row').click();
  await page.locator('.delete-workout-button').click();
  await page.locator('#dialog-confirm').click();
  await expect(page.locator('.history-list .workout-row')).toHaveCount(0);
  await page.locator('.bottom-nav [data-tab="settings"]').click();
  await page.getByRole('button', { name: /恢复备份/ }).click();
  await page.locator('.import-textarea').fill('not valid json');
  await page.locator('.sheet-primary').click();
  await expect(page.locator('#toast')).toContainText('备份格式不正确');
  await page.locator('.import-textarea').fill(backup);
  await page.locator('.sheet-primary').click();
  await page.locator('#dialog-confirm').click();
  await expect(page.locator('.recent-card .workout-row')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('.recent-card .workout-row')).toHaveCount(1);
  expect(await page.evaluate(() => window.__lianji.data.summary.totalVolume)).toBe('340');
});

test('exercise picker and real rest countdown work on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  await startPersonal(page);
  await page.locator('.add-exercise-button').click();
  await page.locator('.filter-chip[data-muscle="核心"]').click();
  await page.locator('.exercise-option').filter({ hasText: '卷腹' }).first().click();
  await expect(page.locator('.exercise-card')).toHaveCount(4);
  const last = page.locator('.exercise-card').last();
  await expect(last.locator('[data-field="weight"]').first()).toBeDisabled();
  await last.locator('.set-check').first().click();
  expect(await page.evaluate(() => window.__lianji.data.active.setCount)).toBe(1);
  expect(await page.evaluate(() => window.__lianji.data.active.volumeLabel)).toBe('0');
  await page.locator('.rest-toggle').click();
  await expect.poll(() => page.evaluate(() => window.__lianji.data.restRemaining)).toBeLessThan(90);
  await page.locator('.rest-toggle').click();
  expect(await page.evaluate(() => window.__lianji.data.restRunning)).toBe(false);
  await page.locator('.rest-reset').click();
  await expect(page.locator('.rest-time')).toHaveText('01:30');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
