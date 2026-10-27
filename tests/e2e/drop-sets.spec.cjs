const { test, expect } = require('@playwright/test');
const model = require('../../miniprogram/utils/model');

async function ready(page) {
  await page.goto('/');
  await expect(page.locator('.greeting-title')).toBeVisible();
}

async function startPersonal(page) {
  await page.locator('.hero-button').click();
  await page.locator('.sheet-primary').click();
  await page.locator('#dialog-confirm').click();
  await expect(page.locator('.active-title')).toHaveText('背部训练');
}

async function persisted(page) {
  return page.evaluate((key) => {
    const raw = JSON.parse(localStorage.getItem(key));
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  }, model.STORAGE_KEY);
}

function firstExercise(page) {
  return page.locator('.exercise-card').first();
}

function firstGroup(page) {
  return firstExercise(page).locator('.set-group').first();
}

async function enterExample(page) {
  const group = firstGroup(page);
  await group.locator('.set-row [data-field="weight"]').first().fill('7.5');
  await group.locator('.set-row [data-field="reps"]').first().fill('12');
  await group.locator('.add-drop-stage').click();
  await group.locator('.add-drop-stage').click();
  await expect(group.locator('.drop-stage-row')).toHaveCount(2);
  await group.locator('.drop-stage-row').nth(0).locator('[data-field="weight"]').fill('5');
  await group.locator('.drop-stage-row').nth(0).locator('[data-field="reps"]').fill('10');
  await group.locator('.drop-stage-row').nth(1).locator('[data-field="weight"]').fill('2.5');
  await group.locator('.drop-stage-row').nth(1).locator('[data-field="reps"]').fill('8');
  await group.locator('.drop-set-info').click();
  await expect(group.locator('.drop-set-info')).toContainText(/3\s*段/);
  await expect(group.locator('.drop-set-info')).toContainText(/30\s*次/);
}

test('three-stage drop set counts as one group and preserves all stages across history, backup restore and the next session', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.setViewportSize({ width: 402, height: 874 });
  await ready(page);
  await startPersonal(page);
  await enterExample(page);
  await page.reload();
  await expect(firstGroup(page).locator('.drop-stage-row')).toHaveCount(2);
  expect(await page.evaluate(() => window.__lianji.data.active.setCount)).toBe(0);
  await firstGroup(page).locator('.set-check').click();
  expect(await page.evaluate(() => window.__lianji.data.active.setCount)).toBe(1);
  expect(await page.evaluate(() => window.__lianji.data.active.volumeLabel)).toBe('160');
  await page.reload();
  await expect(firstGroup(page).locator('.set-check')).toHaveClass(/checked/);
  expect(await page.evaluate(() => window.__lianji.data.active.setCount)).toBe(1);
  expect(await page.evaluate(() => window.__lianji.data.active.volumeLabel)).toBe('160');

  await page.locator('.finish-button').click();
  await page.locator('#dialog-confirm').click();
  await page.locator('.history-list .workout-row').click();
  await expect(page.locator('.detail-set')).toHaveCount(1);
  await expect(page.locator('.detail-drop-stage')).toHaveCount(3);
  await expect(page.locator('.detail-drop-stage')).toContainText(['7.5 kg', '5 kg', '2.5 kg']);
  await expect(page.locator('.detail-drop-stage').nth(0)).toContainText(/12\s*次/);
  await expect(page.locator('.detail-drop-stage').nth(1)).toContainText(/10\s*次/);
  await expect(page.locator('.detail-drop-stage').nth(2)).toContainText(/8\s*次/);
  await page.locator('.close-button').click();
  await page.locator('.bottom-nav [data-tab="settings"]').click();
  await page.getByRole('button', { name: /导出训练记录/ }).click();
  const backup = await page.evaluate(() => navigator.clipboard.readText());
  const exported = model.parseImport(backup);
  const recorded = exported.workouts[0].exercises[0].sets[0];
  expect(recorded).toMatchObject({ weight: 7.5, reps: 12, completed: true });
  expect(recorded.drops).toEqual([
    expect.objectContaining({ weight: 5, reps: 10 }),
    expect.objectContaining({ weight: 2.5, reps: 8 })
  ]);

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
  await expect(page.locator('.recent-card .workout-row')).toHaveCount(1);
  let state = await persisted(page);
  expect(state.workouts[0].exercises[0].sets[0]).toEqual(recorded);
  expect(await page.evaluate(() => window.__lianji.data.summary.totalVolume)).toBe('160');
  await page.locator('.recent-card .workout-row').click();
  await expect(page.locator('.detail-drop-stage')).toHaveCount(3);
  await page.locator('.close-button').click();
  await page.locator('.hero-button').click();
  await page.locator('.sheet-primary').click();
  await expect(firstGroup(page).locator('.drop-stage-row')).toHaveCount(2);
  state = await persisted(page);
  const next = state.activeWorkout.exercises[0].sets[0];
  expect(next).toMatchObject({ weight: 7.5, reps: 12, completed: false });
  expect(next.id).not.toBe(recorded.id);
  expect(next.drops.map(({ weight, reps }) => ({ weight, reps }))).toEqual(recorded.drops.map(({ weight, reps }) => ({ weight, reps })));
  expect(next.drops.every((drop, index) => drop.id !== recorded.drops[index].id)).toBe(true);
  await expect(firstExercise(page).locator('.previous-label')).toContainText('7.5');
  await expect(firstExercise(page).locator('.previous-label')).toContainText('2.5');
});

test('copying drop groups creates fresh unchecked stages, editing decimals is stable and removing stages restores an ordinary group', async ({ page }) => {
  await page.setViewportSize({ width: 402, height: 874 });
  await ready(page);
  await startPersonal(page);
  while (await firstExercise(page).locator('.set-group').count() > 1) {
    await firstExercise(page).locator('.set-group').last().locator('.set-row .remove-set').click();
  }
  await enterExample(page);
  await firstGroup(page).locator('.set-check').click();
  const original = (await persisted(page)).activeWorkout.exercises[0].sets[0];
  await firstExercise(page).locator('.add-set-button').click();
  await expect(firstExercise(page).locator('.set-group')).toHaveCount(2);
  let state = await persisted(page);
  const copied = state.activeWorkout.exercises[0].sets[1];
  expect(copied).toMatchObject({ weight: 7.5, reps: 12, completed: false });
  expect(copied.id).not.toBe(original.id);
  expect(copied.drops.map(({ weight, reps }) => ({ weight, reps }))).toEqual(original.drops.map(({ weight, reps }) => ({ weight, reps })));
  expect(copied.drops.every((drop, index) => drop.id !== original.drops[index].id)).toBe(true);

  const secondGroup = firstExercise(page).locator('.set-group').nth(1);
  const dropWeight = secondGroup.locator('.drop-stage-row').first().locator('[data-field="weight"]');
  await dropWeight.fill('');
  await dropWeight.pressSequentially('2.');
  await expect(dropWeight).toHaveValue('2.');
  await dropWeight.pressSequentially('5');
  await expect(dropWeight).toHaveValue('2.5');
  await secondGroup.locator('.drop-set-info').click();
  expect((await persisted(page)).activeWorkout.exercises[0].sets[1].drops[0].weight).toBe(2.5);
  expect((await persisted(page)).activeWorkout.exercises[0].sets[0].drops[0].weight).toBe(5);

  await firstGroup(page).locator('.add-drop-stage').click();
  state = await persisted(page);
  expect(state.activeWorkout.exercises[0].sets[0].completed).toBe(false);
  expect(await page.evaluate(() => window.__lianji.data.active.setCount)).toBe(0);
  await firstGroup(page).locator('.remove-drop-stage').last().click();
  while (await secondGroup.locator('.drop-stage-row').count()) await secondGroup.locator('.remove-drop-stage').last().click();
  await expect(secondGroup.locator('.drop-set-info')).toHaveCount(0);
  state = await persisted(page);
  expect(state.activeWorkout.exercises[0].sets[1].drops || []).toHaveLength(0);
  expect(state.activeWorkout.exercises[0].sets[1]).toMatchObject({ weight: 7.5, reps: 12, completed: false });
  await page.reload();
  await expect(page.locator('.active-title')).toBeVisible();
  await expect(firstExercise(page).locator('.set-group').nth(1).locator('.drop-stage-row')).toHaveCount(0);
});

test('ten-stage active and history views fit narrow iPhone widths with simulated native mini-button defaults', async ({ page }) => {
  const fixture = model.emptyData();
  fixture.version = 2;
  fixture.customExercises = [{ id: 'custom-drop-layout', name: '哑铃飞鸟（递减训练）', muscle: '胸部', kind: 'weighted' }];
  const set = (prefix, completed) => ({
    id: `${prefix}-set`, weight: 7.5, reps: 12, completed,
    drops: Array.from({ length: 9 }, (_, index) => ({ id: `${prefix}-drop-${index}`, weight: 7 - index * 0.5, reps: 10 }))
  });
  fixture.activeWorkout = {
    id: 'drop-layout-active', date: model.localDate(), title: '胸部训练', notes: '', durationMinutes: 6,
    exercises: [{ id: 'drop-layout-active-exercise', exerciseId: 'custom-drop-layout', sets: [set('drop-active', true)] }]
  };
  fixture.workouts = [{
    id: 'drop-layout-history', date: '2026-10-23', title: '胸部训练', notes: '', durationMinutes: 42,
    exercises: [{ id: 'drop-layout-history-exercise', exerciseId: 'custom-drop-layout', sets: [set('drop-history', true)] }]
  }];
  await page.addInitScript(({ key, data }) => localStorage.setItem(key, JSON.stringify(data)), { key: model.STORAGE_KEY, data: fixture });
  for (const width of [402, 375, 390, 430]) {
    await page.setViewportSize({ width, height: 874 });
    await ready(page);
    await page.addStyleTag({ content: 'button[size="default"]:not([plain]),button:not([size]):not([plain]){width:184px;margin-left:auto;margin-right:auto}button[size="mini"]{display:inline-block;padding:0 1.32em;line-height:2.3;font-size:13px}' });
    await expect(firstGroup(page).locator('.drop-stage-row')).toHaveCount(9);
    await assertControlsFit(page, `${width}px active ten-stage drop group`);
    const add = firstGroup(page).locator('.add-drop-stage');
    if (await add.count() && await add.isEnabled()) await add.click();
    await expect(firstGroup(page).locator('.drop-stage-row')).toHaveCount(9);
    await page.locator('.recent-card .workout-row').click();
    await expect(page.locator('.detail-set')).toHaveCount(1);
    await expect(page.locator('.detail-drop-stage')).toHaveCount(10);
    await assertControlsFit(page, `${width}px ten-stage history`);
    await page.locator('.close-button').click();
  }
});

async function assertControlsFit(page, label) {
  await expect(page.locator('#app button:not([size="mini"])'), `${label}: explicit native button sizing`).toHaveCount(0);
  const overflow = await page.locator('#app button, #app input, #app textarea, .set-group, .detail-set').evaluateAll((elements) => elements.flatMap((element) => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    if (!box.width || !box.height || style.display === 'none' || style.visibility === 'hidden') return [];
    return box.left < -1 || box.right > innerWidth + 1 ? [{ className: element.className, left: box.left, right: box.right }] : [];
  }));
  expect(overflow, `${label}: controls and groups stay within viewport`).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label}: document width`).toBe(true);
}
