const { test, expect } = require('@playwright/test');
const model = require('../../miniprogram/utils/model');

async function ready(page) {
  await page.goto('/');
  await expect(page.locator('.greeting-title')).toBeVisible();
}

async function openSettings(page) {
  await page.locator('.bottom-nav [data-tab="settings"]').click();
  await expect(page.locator('.nickname-settings-row')).toBeVisible();
}

async function saveNickname(page, nickname) {
  await page.locator('.nickname-settings-row').click();
  await expect(page.locator('.nickname-input')).toBeVisible();
  await page.locator('.nickname-input').fill(nickname);
  await page.locator('.nickname-save-button, .modal-sheet .sheet-primary').first().click();
  await expect(page.locator('.modal-backdrop')).toHaveCount(0);
}

async function persisted(page) {
  return page.evaluate((key) => {
    const raw = JSON.parse(localStorage.getItem(key));
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  }, model.STORAGE_KEY);
}

test('manual nickname updates greetings, survives demo-to-personal start, and clears back to the default', async ({ page }) => {
  await page.setViewportSize({ width: 402, height: 874 });
  await ready(page);
  await openSettings(page);
  await saveNickname(page, '  小周  ');
  await expect(page.locator('.profile-card')).toContainText('小周');
  await page.locator('.bottom-nav [data-tab="today"]').click();
  await expect(page.locator('.greeting-row')).toContainText('小周');
  expect((await persisted(page)).nickname).toBe('小周');

  await page.reload();
  await expect(page.locator('.greeting-row')).toContainText('小周');
  await expect(page.locator('.demo-pill')).toHaveText('示例数据');
  await page.locator('.hero-button').click();
  await page.locator('.sheet-primary').click();
  await expect(page.locator('#native-dialog')).toBeVisible();
  await page.locator('#dialog-confirm').click();
  await expect(page.locator('.active-title')).toBeVisible();
  await expect(page.locator('.greeting-row')).toContainText('小周');
  let state = await persisted(page);
  expect(state.demo).toBe(false);
  expect(state.workouts).toHaveLength(0);
  expect(state.nickname).toBe('小周');
  expect(state.activeWorkout).not.toBeNull();

  await openSettings(page);
  await saveNickname(page, '   ');
  await page.locator('.bottom-nav [data-tab="today"]').click();
  await expect(page.locator('.greeting-row')).toContainText('训练者');
  await expect(page.locator('.greeting-row')).not.toContainText('小周');
  state = await persisted(page);
  expect(state.nickname).toBe('');
  expect(state.activeWorkout).not.toBeNull();
});

test('old backups without a nickname retain all records and custom exercises when saving and restoring a nickname', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.setViewportSize({ width: 402, height: 874 });
  const fixture = model.emptyData();
  delete fixture.nickname;
  fixture.customExercises = [{ id: 'custom-nickname-fixture', name: '单侧器械推肩', muscle: '肩部', kind: 'weighted' }];
  fixture.workouts = [{
    id: 'nickname-history-workout', date: '2026-10-23', title: '肩部训练', notes: '之前已经保存的训练', durationMinutes: 42,
    exercises: [{ id: 'nickname-history-exercise', exerciseId: 'custom-nickname-fixture', sets: [{ id: 'nickname-history-set', weight: 17.5, reps: 8, completed: true }] }]
  }];
  fixture.activeWorkout = {
    id: 'nickname-active-workout', date: model.localDate(), title: '肩部训练', notes: '还在进行的训练', durationMinutes: 6,
    exercises: [{ id: 'nickname-active-exercise', exerciseId: 'custom-nickname-fixture', sets: [
      { id: 'nickname-active-set-1', weight: 22.5, reps: 9, completed: true },
      { id: 'nickname-active-set-2', weight: 15, reps: 12, completed: false }
    ] }]
  };
  await page.addInitScript(({ key, data }) => {
    if (localStorage.getItem(key) === null) localStorage.setItem(key, JSON.stringify(data));
  }, { key: model.STORAGE_KEY, data: fixture });
  await ready(page);
  await expect(page.locator('.greeting-row')).toContainText('训练者');
  await expect(page.locator('.exercise-name')).toContainText('单侧器械推肩');
  await openSettings(page);
  await saveNickname(page, '器械训练小周');
  let state = await persisted(page);
  expect(state.nickname).toBe('器械训练小周');
  expect(state.workouts).toEqual(fixture.workouts);
  expect(state.activeWorkout).toEqual(fixture.activeWorkout);
  expect(state.customExercises).toEqual(fixture.customExercises);

  await page.getByRole('button', { name: /导出训练记录/ }).click();
  const backup = await page.evaluate(() => navigator.clipboard.readText());
  const exported = JSON.parse(backup);
  expect(exported.nickname).toBe('器械训练小周');
  expect(exported.customExercises).toEqual(fixture.customExercises);
  await saveNickname(page, '');
  await page.getByRole('button', { name: /恢复备份/ }).click();
  await page.locator('.import-textarea').fill(backup);
  await page.locator('.sheet-primary').click();
  await page.locator('#dialog-confirm').click();
  await expect(page.locator('.greeting-row')).toContainText('器械训练小周');
  await page.reload();
  await expect(page.locator('.greeting-row')).toContainText('器械训练小周');
  state = await persisted(page);
  expect(state.nickname).toBe('器械训练小周');
  expect(state.workouts).toEqual(fixture.workouts);
  expect(state.activeWorkout).toEqual(fixture.activeWorkout);
  expect(state.customExercises).toEqual(fixture.customExercises);
});

test('a 20-character nickname and its editor fit at iPhone 16 Pro width and survive clearing demo records', async ({ page }) => {
  await page.setViewportSize({ width: 402, height: 874 });
  await ready(page);
  await page.addStyleTag({ content: 'button[size="default"]:not([plain]),button:not([size]):not([plain]){width:184px;margin-left:auto;margin-right:auto}button[size="mini"]{display:inline-block;padding:0 1.32em;line-height:2.3;font-size:13px}' });
  const nickname = '每天认真记录训练进步的小陈同学'.repeat(2).slice(0, 20);
  expect(nickname).toHaveLength(20);
  await openSettings(page);
  await page.locator('.nickname-settings-row').click();
  await page.locator('.nickname-input').fill(nickname);
  await assertNarrowLayout(page, 'nickname editor');
  await page.locator('.nickname-save-button, .modal-sheet .sheet-primary').first().click();
  await expect(page.locator('.profile-card')).toContainText(nickname);
  await assertNarrowLayout(page, 'profile with long nickname');
  await page.locator('.demo-banner .small-primary-button').click();
  await page.locator('#dialog-confirm').click();
  await expect(page.locator('.demo-banner')).toHaveCount(0);
  expect((await persisted(page)).nickname).toBe(nickname);
  await page.locator('.bottom-nav [data-tab="today"]').click();
  await expect(page.locator('.greeting-row')).toContainText(nickname);
  await assertNarrowLayout(page, 'greeting with long nickname');
  await page.reload();
  await expect(page.locator('.greeting-row')).toContainText(nickname);
});

async function assertNarrowLayout(page, label) {
  await expect(page.locator('#app button:not([size="mini"])'), `${label}: explicit native button sizing`).toHaveCount(0);
  const overflow = await page.locator('#app button, #app input, #app textarea, .greeting-row, .profile-card').evaluateAll((elements) => elements.flatMap((element) => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    if (!box.width || !box.height || style.display === 'none' || style.visibility === 'hidden') return [];
    return box.left < -1 || box.right > innerWidth + 1 ? [{ className: element.className, left: box.left, right: box.right }] : [];
  }));
  expect(overflow, `${label}: controls and greeting stay within viewport`).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${label}: document width`).toBe(true);
}
