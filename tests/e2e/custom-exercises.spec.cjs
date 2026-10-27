const { test, expect } = require('@playwright/test');
const model = require('../../miniprogram/utils/model');

async function ready(page) {
  await page.goto('/');
  await expect(page.locator('.greeting-title')).toBeVisible();
}

async function persisted(page) {
  return page.evaluate((key) => {
    const stored = JSON.parse(localStorage.getItem(key));
    return typeof stored === 'string' ? JSON.parse(stored) : stored;
  }, model.STORAGE_KEY);
}

async function startShoulders(page, isDemo = true) {
  await page.locator('.hero-button').click();
  await page.locator('.muscle-option[data-muscle="肩部"]').click();
  await page.locator('.sheet-primary').click();
  if (isDemo) {
    await expect(page.locator('#native-dialog')).toBeVisible();
    await page.locator('#dialog-confirm').click();
  }
  await expect(page.locator('.active-title')).toHaveText('肩部训练');
}

function exerciseCard(page, name) {
  return page.locator('.exercise-card').filter({ has: page.getByText(name, { exact: true }) });
}

async function ensureShoulder(page, name) {
  if (await exerciseCard(page, name).count()) return;
  await page.locator('.add-exercise-button').click();
  await page.locator('.filter-chip[data-muscle="肩部"]').click();
  const option = page.locator('.exercise-option').filter({ hasText: name });
  await expect(option).toBeEnabled();
  await option.click();
  await expect(exerciseCard(page, name)).toHaveCount(1);
}

async function saveNamedExercise(page, name, kind = 'weighted') {
  await page.locator('.editor-input').fill(name);
  await page.locator('.editor-chip[data-muscle="肩部"]').click();
  const kindOption = page.locator(`[data-kind="${kind}"]`);
  if (await kindOption.count() && await kindOption.isEnabled()) await kindOption.click();
  await page.locator('.sheet-primary').click();
  await expect(page.locator('.modal-backdrop')).toHaveCount(0);
}

async function closeAllSheets(page) {
  for (let count = 0; count < 3 && await page.locator('.modal-backdrop').count(); count += 1) {
    await page.locator('.close-button').click();
  }
  await expect(page.locator('.modal-backdrop')).toHaveCount(0);
}

test('four different shoulder movements plus a custom fifth persist, complete and round-trip in a backup', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.setViewportSize({ width: 402, height: 874 });
  await ready(page);
  await startShoulders(page);
  for (const name of ['哑铃推肩', '杠铃推肩', '哑铃侧平举', '绳索面拉']) await ensureShoulder(page, name);
  await expect(page.locator('.exercise-card')).toHaveCount(4);

  await page.locator('.add-exercise-button').click();
  await page.locator('.custom-exercise-entry').click();
  const customName = '器械反向飞鸟';
  await saveNamedExercise(page, customName);
  await expect(page.locator('.exercise-card')).toHaveCount(5);
  const customId = await page.evaluate((name) => window.__lianji.data.active.exercises.find((exercise) => exercise.name === name).exerciseId, customName);
  expect(customId).toMatch(/^custom-/);
  const custom = exerciseCard(page, customName);
  await custom.locator('[data-field="weight"]').first().fill('12.5');
  await custom.locator('[data-field="reps"]').first().fill('12');
  await custom.locator('.set-check').first().click();
  for (const name of ['哑铃推肩', '杠铃推肩', '哑铃侧平举', '绳索面拉']) {
    await exerciseCard(page, name).locator('.set-check').first().click();
  }

  await page.reload();
  await expect(page.locator('.exercise-card')).toHaveCount(5);
  await expect(exerciseCard(page, customName).locator('[data-field="weight"]').first()).toHaveValue('12.5');
  await expect(exerciseCard(page, customName).locator('[data-field="reps"]').first()).toHaveValue('12');
  let state = await persisted(page);
  expect(state.customExercises.find((definition) => definition.id === customId)).toMatchObject({ name: customName, muscle: '肩部', kind: 'weighted' });
  expect(state.activeWorkout.exercises.find((exercise) => exercise.exerciseId === customId).sets[0]).toMatchObject({ weight: 12.5, reps: 12, completed: true });

  await page.locator('.finish-button').click();
  await page.locator('#dialog-confirm').click();
  await page.locator('.history-list .workout-row').click();
  await expect(page.locator('.detail-exercise')).toHaveCount(5);
  await expect(page.locator('.detail-exercise').filter({ hasText: customName })).toContainText('12.5 kg');
  await page.locator('.close-button').click();
  await page.locator('.bottom-nav [data-tab="settings"]').click();
  await page.getByRole('button', { name: /导出训练记录/ }).click();
  const backup = await page.evaluate(() => navigator.clipboard.readText());
  const exported = model.parseImport(backup);
  expect(exported.customExercises.find((definition) => definition.id === customId).name).toBe(customName);
  expect(exported.workouts[0].exercises).toHaveLength(5);

  await page.locator('.bottom-nav [data-tab="history"]').click();
  await page.locator('.history-list .workout-row').click();
  await page.locator('.delete-workout-button').click();
  await page.locator('#dialog-confirm').click();
  await expect(page.locator('.history-list .workout-row')).toHaveCount(0);
  await page.locator('.bottom-nav [data-tab="settings"]').click();
  await page.getByRole('button', { name: /恢复备份/ }).click();
  await page.locator('.import-textarea').fill(backup);
  await page.locator('.sheet-primary').click();
  await page.locator('#dialog-confirm').click();
  await page.reload();
  state = await persisted(page);
  expect(state.workouts).toHaveLength(1);
  expect(state.customExercises.find((definition) => definition.id === customId).name).toBe(customName);
  await page.locator('.recent-card .workout-row').click();
  await expect(page.locator('.detail-exercise')).toHaveCount(5);
  await expect(page.locator('.detail-exercise').filter({ hasText: customName })).toContainText('12 次');
});

test('renaming a current exercise keeps sets and leaves an old version-1 workout unchanged', async ({ page }) => {
  const fixture = model.emptyData();
  delete fixture.customExercises;
  fixture.workouts = [{
    id: 'legacy-shoulder-workout',
    date: '2026-10-23',
    title: '肩部训练',
    notes: '旧版已有的训练记录',
    durationMinutes: 42,
    exercises: [{ id: 'legacy-shoulder-exercise', exerciseId: 'shoulder-press', sets: [{ id: 'legacy-shoulder-set', weight: 17.5, reps: 8, completed: true }] }]
  }];
  await page.addInitScript(({ key, data }) => {
    if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify(data));
  }, { key: model.STORAGE_KEY, data: fixture });
  await page.setViewportSize({ width: 402, height: 874 });
  await ready(page);
  await expect(page.locator('.demo-pill')).toHaveCount(0);
  await startShoulders(page, false);
  const original = exerciseCard(page, '哑铃推肩');
  await original.locator('[data-field="weight"]').first().fill('22.5');
  await original.locator('[data-field="reps"]').first().fill('9');
  await original.locator('.set-check').first().click();
  const before = (await persisted(page)).activeWorkout.exercises.find((exercise) => exercise.exerciseId === 'shoulder-press');
  await original.locator('.rename-exercise').click();
  await expect(page.locator('.editor-input')).toHaveValue('哑铃推肩');
  const renamedName = '坐姿器械推肩（单侧）';
  await saveNamedExercise(page, renamedName);
  const after = (await persisted(page)).activeWorkout.exercises.find((exercise) => exercise.id === before.id);
  expect(after.sets).toEqual(before.sets);
  expect(after.exerciseId).toMatch(/^custom-/);
  expect(after.exerciseId).not.toBe('shoulder-press');
  expect((await persisted(page)).workouts).toEqual(fixture.workouts);
  await page.reload();
  await expect(exerciseCard(page, renamedName)).toHaveCount(1);
  await expect(exerciseCard(page, renamedName).locator('[data-field="weight"]').first()).toHaveValue('22.5');
  await expect(exerciseCard(page, renamedName).locator('[data-field="reps"]').first()).toHaveValue('9');
  await page.locator('.recent-card .workout-row').click();
  await expect(page.locator('.detail-exercise .exercise-name')).toHaveText('哑铃推肩');
  await expect(page.locator('.detail-set')).toContainText('17.5 kg');
  await expect(page.locator('.detail-set')).toContainText('8 次');
});

async function expectControlsFit(page, label) {
  await expect(page.locator('#app button:not([size="mini"])'), `${label}: native buttons must explicitly opt out of default width`).toHaveCount(0);
  const overflow = await page.locator('#app button, #app input, #app textarea, #app [role="button"]').evaluateAll((elements) => elements.flatMap((element) => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    if (!box.width || !box.height || style.display === 'none' || style.visibility === 'hidden') return [];
    if (box.left >= -1 && box.right <= innerWidth + 1) return [];
    return [{ tag: element.tagName, className: element.className, label: element.getAttribute('aria-label') || element.textContent.trim().slice(0, 40), left: box.left, right: box.right, viewport: innerWidth }];
  }));
  expect(overflow, `${label}: visible controls must fit horizontally`).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label}: document width`).toBe(true);
}

test('iPhone-width active records, filters and editors fit with native default button sizing simulated', async ({ page }) => {
  const fixture = model.emptyData();
  const shoulders = ['shoulder-press', 'barbell-shoulder-press', 'lateral-raise', 'face-pull'];
  fixture.customExercises = Array.from({ length: 4 }, (_, index) => ({ id: `custom-layout-${index}`, name: `${index + 1}号器械单侧肩部训练动作（完整动作名称）`, muscle: '肩部', kind: 'weighted' }));
  fixture.activeWorkout = {
    id: 'layout-active-workout', date: model.localDate(), title: '肩部训练', notes: '', durationMinutes: 12,
    exercises: [...shoulders, ...fixture.customExercises.map((definition) => definition.id)].map((exerciseId, index) => ({
      id: `layout-exercise-${index}`, exerciseId,
      sets: Array.from({ length: 4 }, (_, set) => ({ id: `layout-set-${index}-${set}`, weight: 17.5, reps: 10, completed: set === 0 }))
    }))
  };
  await page.addInitScript(({ key, data }) => localStorage.setItem(key, JSON.stringify(data)), { key: model.STORAGE_KEY, data: fixture });
  for (const width of [402, 375, 390, 430]) {
    await page.setViewportSize({ width, height: 874 });
    await ready(page);
    await page.addStyleTag({ content: 'button[size="default"]:not([plain]),button:not([size]):not([plain]){width:184px;margin-left:auto;margin-right:auto}button[size="mini"]{display:inline-block;padding:0 1.32em;line-height:2.3;font-size:13px}' });
    await expect(page.locator('.exercise-card')).toHaveCount(8);
    await expectControlsFit(page, `${width}px active workout`);
    await page.locator('.add-exercise-button').click();
    await expectControlsFit(page, `${width}px exercise picker`);
    await page.locator('.custom-exercise-entry').click();
    await page.locator('.editor-input').fill('用于检查长名称仍能在手机里完整编辑的自定义肩部训练动作');
    await expectControlsFit(page, `${width}px custom exercise editor`);
    await closeAllSheets(page);
    await page.locator('.exercise-card').last().locator('.rename-exercise').click();
    await expectControlsFit(page, `${width}px rename editor`);
    await closeAllSheets(page);
    await page.locator('.bottom-nav [data-tab="history"]').click();
    await expectControlsFit(page, `${width}px training calendar`);
    await page.locator('.bottom-nav [data-tab="settings"]').click();
    await expectControlsFit(page, `${width}px settings`);
  }
});
