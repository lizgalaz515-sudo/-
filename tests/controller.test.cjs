const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const model = require('../miniprogram/utils/model');

const source = fs.readFileSync(path.join(__dirname, '../miniprogram/pages/index/index.js'), 'utf8');
const event = (dataset = {}, value) => ({ currentTarget: { dataset }, detail: { value } });

function launch(initial = model.emptyData(), options = {}) {
  let definition;
  let saved;
  let clipboard;
  const toasts = [];
  const dialogs = [];
  const intervals = new Set();
  const local = options.local || new Map();
  let intervalId = 0;
  const context = {
    require: () => ({
      ...model,
      loadData: () => structuredClone(initial),
      saveData: (value) => {
        saved = structuredClone(value);
        return !options.storageFails;
      }
    }),
    Page: (value) => { definition = value; },
    wx: {
      showToast: (payload) => toasts.push(payload.title),
      showModal: (payload) => { dialogs.push(payload); payload.success({ confirm: options.confirm !== false }); },
      setClipboardData: (payload) => { clipboard = payload.data; payload.success(); },
      getStorageSync: (key) => {
        if (options.readFails && key === model.STORAGE_KEY) throw new Error('read unavailable');
        return local.get(key);
      },
      setStorageSync: (key, value) => {
        if (options.recoveryFails) throw new Error('quota');
        local.set(key, value);
      }
    },
    setInterval: () => { intervals.add(++intervalId); return intervalId; },
    clearInterval: (id) => intervals.delete(id),
    Date,
    console
  };
  vm.runInNewContext(source, context, { filename: 'pages/index/index.js' });
  const page = { ...definition, data: structuredClone(definition.data), setData(patch) { Object.assign(this.data, patch); } };
  page.onLoad();
  return { page, toasts, dialogs, intervals, local, saved: () => saved, clipboard: () => clipboard };
}

test('starts an editable template and persists each completed set', () => {
  const { page, saved } = launch();
  page.openStart();
  assert.equal(page.data.sheet, 'start');
  page.startWorkout();
  assert.equal(page.data.tab, 'today');
  assert.equal(page.data.sheet, '');
  assert.equal(page.data.active.exercises.length, 3);
  const exercise = page.data.active.exercises[0];
  const set = exercise.sets[0];
  page.changeSet(event({ exercise: exercise.id, set: set.id, field: 'weight' }, '42.5'));
  page.changeSet(event({ exercise: exercise.id, set: set.id, field: 'reps' }, '8'));
  page.toggleSet(event({ exercise: exercise.id, set: set.id }));
  assert.equal(page.data.active.setCount, 1);
  assert.equal(page.data.active.volumeLabel, '340');
  assert.equal(saved().activeWorkout.exercises[0].sets[0].weight, 42.5);
  assert.doesNotThrow(() => model.parseImport(JSON.stringify(saved())));
});

test('finish requires completed sets and saves only checked sets into history', () => {
  const { page, toasts } = launch();
  page.startWorkout();
  page.finishWorkout();
  assert.equal(page._store.workouts.length, 0);
  assert.match(toasts.at(-1), /至少一组/);
  const exercise = page.data.active.exercises[0];
  page.toggleSet(event({ exercise: exercise.id, set: exercise.sets[0].id }));
  page.finishWorkout();
  assert.equal(page._store.activeWorkout, null);
  assert.equal(page._store.workouts.length, 1);
  assert.equal(page._store.workouts[0].exercises.length, 1);
  assert.equal(page._store.workouts[0].exercises[0].sets.length, 1);
  assert.equal(page.data.tab, 'history');
  assert.equal(page.data.historyWorkouts.length, 1);
  assert.ok(page._store.workouts[0].durationMinutes >= 1);
});

test('canceling finish preserves the active workout and creates no history', () => {
  const { page } = launch(model.emptyData(), { confirm: false });
  page.startWorkout();
  const exercise = page.data.active.exercises[0];
  page.toggleSet(event({ exercise: exercise.id, set: exercise.sets[0].id }));
  page.finishWorkout();
  assert.ok(page._store.activeWorkout);
  assert.equal(page._store.workouts.length, 0);
});

test('add set copies the previous weight and reps with a fresh id and unchecked state', () => {
  const { page } = launch();
  page.startWorkout();
  const exercise = page.data.active.exercises[0];
  const last = exercise.sets.at(-1);
  page.changeSet(event({ exercise: exercise.id, set: last.id, field: 'weight' }, '62.5'));
  page.changeSet(event({ exercise: exercise.id, set: last.id, field: 'reps' }, '6'));
  page.toggleSet(event({ exercise: exercise.id, set: last.id }));
  page.addSet(event({ exercise: exercise.id }));
  const added = page._store.activeWorkout.exercises[0].sets.at(-1);
  assert.equal(added.weight, 62.5);
  assert.equal(added.reps, 6);
  assert.equal(added.completed, false);
  assert.notEqual(added.id, last.id);
});

test('invalid numeric input never enters persisted workout data', () => {
  const { page, toasts } = launch();
  page.startWorkout();
  const exercise = page.data.active.exercises[0];
  const set = exercise.sets[0];
  page.changeSet(event({ exercise: exercise.id, set: set.id, field: 'reps' }, '-1'));
  page.normalizeSet(event({ exercise: exercise.id, set: set.id, field: 'reps' }, '-1'));
  page.changeSet(event({ exercise: exercise.id, set: set.id, field: 'weight' }, 'Infinity'));
  page.normalizeSet(event({ exercise: exercise.id, set: set.id, field: 'weight' }, 'Infinity'));
  page.changeSet(event({ exercise: exercise.id, set: set.id, field: 'reps' }, '2.5'));
  page.normalizeSet(event({ exercise: exercise.id, set: set.id, field: 'reps' }, '2.5'));
  assert.equal(page._store.activeWorkout.exercises[0].sets[0].reps, 10);
  assert.equal(page._store.activeWorkout.exercises[0].sets[0].weight, 20);
  assert.equal(toasts.length, 3);
});

test('bodyweight template uses zero weight and records completed sets without invented volume', () => {
  const { page } = launch();
  page.selectMuscle(event({ muscle: '核心' }));
  page.startWorkout();
  const exercise = page.data.active.exercises[0];
  const set = exercise.sets[0];
  page.changeSet(event({ exercise: exercise.id, set: set.id, field: 'weight' }, '40'));
  page.toggleSet(event({ exercise: exercise.id, set: set.id }));
  assert.equal(page._store.activeWorkout.exercises[0].sets[0].weight, 0);
  assert.equal(page.data.active.setCount, 1);
  assert.equal(page.data.active.volumeLabel, '0');
});

test('exercise picker filters by muscle, prevents duplicates and allows new exercises', () => {
  const { page, toasts } = launch();
  page.startWorkout();
  page.openExercisePicker();
  assert.equal(page.data.sheet, 'exercise');
  page.chooseExercise(event({ id: 'lat-pulldown' }));
  assert.match(toasts.at(-1), /已经添加/);
  assert.equal(page.data.active.exercises.length, 3);
  page.selectMuscle(event({ muscle: '胸部' }));
  assert.ok(page.data.exerciseOptions.every((item) => item.muscle === '胸部'));
  page.chooseExercise(event({ id: 'bench-press' }));
  assert.equal(page.data.active.exercises.length, 4);
  assert.equal(page.data.sheet, '');
});

test('a previous completed workout pre-fills the next session with fresh unchecked sets', () => {
  const initial = model.emptyData();
  initial.workouts = [model.createInitialData().workouts.find((workout) => workout.title === '背部训练')];
  const { page } = launch(initial);
  page.startWorkout();
  const previous = initial.workouts[0].exercises[0];
  const current = page._store.activeWorkout.exercises[0];
  assert.equal(current.sets[0].weight, previous.sets[0].weight);
  assert.notEqual(current.id, previous.id);
  assert.notEqual(current.sets[0].id, previous.sets[0].id);
  assert.equal(current.sets[0].completed, false);
  assert.match(page.data.active.exercises[0].previousLabel, /kg/);
  assert.doesNotThrow(() => model.parseImport(JSON.stringify(page._store)));
});

test('export is a restorable backup and import replaces data only after confirmation', () => {
  const { page, clipboard } = launch(model.createInitialData());
  page.exportData();
  assert.equal(model.parseImport(clipboard()).workouts.length, 21);
  page.openImport();
  page.updateImport(event({}, JSON.stringify(model.emptyData())));
  page.confirmImport();
  assert.equal(page._store.workouts.length, 0);
  assert.equal(page._store.demo, false);
  assert.equal(page.data.sheet, '');
});

test('invalid import and canceled import preserve existing records', () => {
  const { page, toasts } = launch(model.createInitialData());
  page.openImport();
  page.updateImport(event({}, '{invalid}'));
  page.confirmImport();
  assert.equal(page._store.workouts.length, 21);
  assert.match(toasts.at(-1), /备份格式/);
  const canceled = launch(model.createInitialData(), { confirm: false }).page;
  canceled.openImport();
  canceled.updateImport(event({}, JSON.stringify(model.emptyData())));
  canceled.confirmImport();
  assert.equal(canceled._store.workouts.length, 21);
});

test('demo reset and workout deletion update aggregates and local records', () => {
  const { page } = launch(model.createInitialData());
  const target = page._store.workouts[0];
  page.showWorkout(event({ id: target.id }));
  assert.equal(page.data.detail.id, target.id);
  page.deleteWorkout(event({ id: target.id }));
  assert.equal(page._store.workouts.length, 20);
  assert.equal(page.data.summary.totalWorkouts, 20);
  assert.equal(page.data.detail, null);
  page.clearDemo();
  assert.equal(page._store.workouts.length, 0);
  assert.equal(page.data.demo, false);
  assert.equal(page.data.summary.totalVolume, '0');
});

test('rest timer pauses, resumes, cleans intervals on hide and supports restarting', () => {
  const { page, intervals } = launch();
  page.setRest(event({ seconds: 60 }));
  assert.equal(page.data.restLabel, '01:00');
  page.toggleRest();
  assert.equal(page.data.restRunning, true);
  assert.equal(intervals.size, 1);
  page.onHide();
  assert.equal(intervals.size, 0);
  page.onShow();
  assert.equal(intervals.size, 1);
  page.toggleRest();
  assert.equal(intervals.size, 0);
  assert.equal(page.data.restRunning, false);
  page.resetRest();
  assert.equal(page.data.restRemaining, 60);
  page.onUnload();
  assert.equal(intervals.size, 0);
});

test('local storage failure is visible while keeping the in-memory record exportable', () => {
  const { page, toasts, clipboard } = launch(model.emptyData(), { storageFails: true });
  page.startWorkout();
  assert.ok(page._store.activeWorkout);
  assert.match(toasts.at(-1), /保存失败/);
  page.exportData();
  assert.ok(model.parseImport(clipboard()).activeWorkout);
});

test('backdated session saves on its chosen date; future date is rejected', () => {
  const { page } = launch();
  page.startWorkout();
  const date = new Date();
  date.setDate(date.getDate() - 1);
  const yesterday = model.localDate(date);
  page.changeWorkoutDate(event({}, yesterday));
  assert.equal(page.data.active.date, yesterday);
  page.changeWorkoutDate(event({}, '2099-01-01'));
  assert.equal(page.data.active.date, yesterday);
  const exercise = page.data.active.exercises[0];
  page.toggleSet(event({ exercise: exercise.id, set: exercise.sets[0].id }));
  page.finishWorkout();
  assert.equal(page._store.workouts[0].date, yesterday);
  assert.equal(page.data.selectedDate, yesterday);
});

test('first personal workout requires clearing demo records and never mixes in sample history', () => {
  const { page, dialogs } = launch(model.createInitialData());
  page.startWorkout();
  assert.match(dialogs[0].title, /自己的记录/);
  assert.equal(page._store.demo, false);
  assert.equal(page._store.workouts.length, 0);
  assert.ok(page._store.activeWorkout);
  const canceled = launch(model.createInitialData(), { confirm: false }).page;
  canceled.startWorkout();
  assert.equal(canceled._store.demo, true);
  assert.equal(canceled._store.workouts.length, 21);
  assert.equal(canceled._store.activeWorkout, null);
});

test('corrupt old storage stays exportable and is archived before explicit replacement', () => {
  const raw = '{"old-data": invalid';
  const local = new Map([[model.STORAGE_KEY, raw]]);
  const { page, clipboard } = launch(model.createInitialData(), { local });
  assert.equal(page.data.recoveryWarning, true);
  page.exportRecovery();
  assert.equal(clipboard(), raw);
  page.startWorkout();
  assert.equal(page._store.demo, false);
  const pointer = local.get(`${model.STORAGE_KEY}.recovery.latest`);
  assert.equal(local.get(pointer), raw);
  assert.equal(page._pendingCorrupt, null);
});

test('failed recovery preservation prevents any overwrite of unreadable old records', () => {
  const raw = '{not-valid';
  const local = new Map([[model.STORAGE_KEY, raw]]);
  const { page, saved, toasts } = launch(model.createInitialData(), { local, recoveryFails: true });
  page.startWorkout();
  assert.equal(local.get(model.STORAGE_KEY), raw);
  assert.equal(saved(), undefined);
  assert.equal(page._store.activeWorkout, null);
  assert.match(toasts.at(-1), /旧记录未被覆盖/);
});

test('failed persistence during finish is not hidden by a success message', () => {
  const { page, toasts } = launch(model.emptyData(), { storageFails: true });
  page.startWorkout();
  const exercise = page.data.active.exercises[0];
  page.toggleSet(event({ exercise: exercise.id, set: exercise.sets[0].id }));
  page.finishWorkout();
  assert.match(toasts.at(-1), /保存失败/);
  assert.equal(page._store.workouts.length, 1);
});

test('same-day last session supplies previous weights and appears first in recent history', () => {
  const seed = model.createInitialData();
  const first = seed.workouts[0];
  const second = seed.workouts[3];
  first.date = model.localDate();
  second.date = first.date;
  first.exercises[0].sets.forEach((set) => { set.weight = 10; });
  second.exercises[0].sets.forEach((set) => { set.weight = 90; });
  const initial = { ...model.emptyData(), workouts: [first, second] };
  const { page } = launch(initial);
  assert.equal(page.data.recentWorkouts[0].id, second.id);
  page.startWorkout();
  assert.equal(page.data.active.exercises[0].sets[0].weight, 90);
  assert.match(page.data.active.exercises[0].previousLabel, /90 kg/);
});

test('weight input retains an intermediate decimal point and normalizes only on blur', () => {
  const { page, saved } = launch();
  page.startWorkout();
  const exercise = page.data.active.exercises[0];
  const set = exercise.sets[0];
  const dataset = { exercise: exercise.id, set: set.id, field: 'weight' };
  page.changeSet(event(dataset, '42.'));
  assert.equal(page.data.active.exercises[0].sets[0].weight, '42.');
  assert.equal(saved().activeWorkout.exercises[0].sets[0].weight, 42);
  page.changeSet(event(dataset, '42.5'));
  assert.equal(page.data.active.exercises[0].sets[0].weight, '42.5');
  assert.equal(saved().activeWorkout.exercises[0].sets[0].weight, 42.5);
  page.normalizeSet(event(dataset, '42.5'));
  assert.equal(page.data.active.exercises[0].sets[0].weight, 42.5);
  assert.equal(typeof saved().activeWorkout.exercises[0].sets[0].weight, 'number');
});

test('cleared and invalid input stay editable while persisted numbers remain valid', () => {
  const { page, saved, toasts } = launch();
  page.startWorkout();
  const exercise = page.data.active.exercises[0];
  const set = exercise.sets[0];
  const dataset = { exercise: exercise.id, set: set.id, field: 'reps' };
  page.changeSet(event(dataset, ''));
  assert.equal(page.data.active.exercises[0].sets[0].reps, '');
  assert.equal(saved().activeWorkout.exercises[0].sets[0].reps, 10);
  page.normalizeSet(event(dataset, ''));
  assert.equal(page.data.active.exercises[0].sets[0].reps, 10);
  assert.equal(toasts.length, 0);
  page.changeSet(event(dataset, '2.5'));
  assert.equal(page.data.active.exercises[0].sets[0].reps, '2.5');
  assert.equal(toasts.length, 0);
  assert.equal(saved().activeWorkout.exercises[0].sets[0].reps, 10);
  page.normalizeSet(event(dataset, '2.5'));
  assert.equal(page.data.active.exercises[0].sets[0].reps, 10);
  assert.match(toasts.at(-1), /整数/);
});

test('a shoulder workout accepts four built-in exercises and additional custom exercises', () => {
  const { page, saved } = launch();
  page.selectMuscle(event({ muscle: '肩部' }));
  page.startWorkout();
  page.chooseExercise(event({ id: 'barbell-shoulder-press' }));
  page.chooseExercise(event({ id: 'face-pull' }));
  assert.equal(page.data.active.exercises.length, 4);
  page.openCustomExercise();
  page.updateExerciseName(event({}, '  器械反向飞鸟  '));
  page.saveCustomExercise();
  assert.equal(page.data.active.exercises.length, 5);
  assert.equal(page.data.active.exercises[4].name, '器械反向飞鸟');
  assert.equal(saved().customExercises.length, 1);
  assert.equal(saved().customExercises[0].muscle, '肩部');
  assert.doesNotThrow(() => model.parseImport(JSON.stringify(saved())));
  const reopened = launch(saved()).page;
  reopened.openExercisePicker();
  reopened.selectMuscle(event({ muscle: '肩部' }));
  assert.ok(reopened.data.exerciseOptions.some((definition) => definition.name === '器械反向飞鸟' && definition.selected));
});

test('renaming an exercise to barbell shoulder press retains sets and does not rewrite earlier history', () => {
  const initial = model.emptyData();
  initial.workouts = [{ id: 'previous', date: '2026-10-23', title: '肩部训练', notes: '', durationMinutes: 40, exercises: [{ id: 'previous-exercise', exerciseId: 'shoulder-press', sets: [{ id: 'previous-set', weight: 17.5, reps: 8, completed: true }] }] }];
  const { page, saved } = launch(initial);
  page.selectMuscle(event({ muscle: '肩部' }));
  page.startWorkout();
  const before = structuredClone(page._store.activeWorkout.exercises[0]);
  page.startRenameExercise(event({ exercise: before.id }));
  assert.equal(page.data.editorName, '哑铃推肩');
  page.updateExerciseName(event({}, '杠铃推肩'));
  page.saveCustomExercise();
  const after = saved().activeWorkout.exercises[0];
  assert.equal(after.exerciseId, 'barbell-shoulder-press');
  assert.equal(after.id, before.id);
  assert.deepEqual(after.sets, before.sets);
  assert.deepEqual(saved().workouts, initial.workouts);
  assert.equal(saved().customExercises.length, 0);
  page.showWorkout(event({ id: 'previous' }));
  assert.equal(page.data.detail.exercises[0].name, '哑铃推肩');
});

test('renaming a custom exercise creates a separate definition and leaves its historical name intact', () => {
  const initial = model.emptyData();
  const definition = { id: 'custom-previous-press', name: '器械推肩', muscle: '肩部', kind: 'weighted' };
  initial.customExercises.push(definition);
  initial.workouts = [{ id: 'custom-history', date: '2026-10-23', title: '肩部训练', notes: '', durationMinutes: 30, exercises: [{ id: 'historical-custom', exerciseId: definition.id, sets: [{ id: 'historical-custom-set', weight: 30, reps: 10, completed: true }] }] }];
  const { page, saved } = launch(initial);
  page.selectMuscle(event({ muscle: '肩部' }));
  page.startWorkout();
  page.chooseExercise(event({ id: definition.id }));
  const before = structuredClone(page._store.activeWorkout.exercises.at(-1));
  page.startRenameExercise(event({ exercise: before.id }));
  page.updateExerciseName(event({}, '单侧器械推肩'));
  page.saveCustomExercise();
  const after = saved().activeWorkout.exercises.at(-1);
  assert.notEqual(after.exerciseId, before.exerciseId);
  assert.deepEqual(after.sets, before.sets);
  assert.equal(saved().customExercises.length, 2);
  assert.equal(saved().customExercises[0].name, '器械推肩');
  page.showWorkout(event({ id: 'custom-history' }));
  assert.equal(page.data.detail.exercises[0].name, '器械推肩');
  assert.doesNotThrow(() => model.parseImport(JSON.stringify(saved())));
});

test('empty and duplicate custom exercise names never change the current workout', () => {
  const { page } = launch();
  page.selectMuscle(event({ muscle: '肩部' }));
  page.startWorkout();
  const before = JSON.stringify(page._store);
  page.openCustomExercise();
  page.updateExerciseName(event({}, '   '));
  page.saveCustomExercise();
  assert.match(page.data.editorError, /动作名称/);
  assert.equal(JSON.stringify(page._store), before);
  page.updateExerciseName(event({}, '哑铃推肩'));
  page.saveCustomExercise();
  assert.match(page.data.editorError, /已经/);
  assert.equal(JSON.stringify(page._store), before);
});

test('custom bodyweight exercises keep zero weight and participate in completed set statistics', () => {
  const { page, saved, clipboard } = launch();
  page.startWorkout();
  page.openCustomExercise();
  page.updateExerciseName(event({}, '靠墙倒立撑'));
  page.selectEditorMuscle(event({ muscle: '肩部' }));
  page.setExerciseKind(event({ kind: 'bodyweight' }));
  page.saveCustomExercise();
  const exercise = page._store.activeWorkout.exercises.at(-1);
  assert.equal(exercise.sets[0].weight, 0);
  page.changeSet(event({ exercise: exercise.id, set: exercise.sets[0].id, field: 'weight' }, '50'));
  page.toggleSet(event({ exercise: exercise.id, set: exercise.sets[0].id }));
  assert.equal(page.data.active.setCount, 1);
  assert.equal(page.data.active.volumeLabel, '0');
  assert.equal(saved().activeWorkout.exercises.at(-1).sets[0].weight, 0);
  page.finishWorkout();
  assert.equal(page.data.summary.totalSets, 1);
  assert.equal(page.data.summary.totalVolume, '0');
  page.exportData();
  const imported = model.parseImport(clipboard());
  assert.equal(imported.customExercises[0].name, '靠墙倒立撑');
  assert.equal(imported.workouts[0].exercises[0].exerciseId, imported.customExercises[0].id);
});

test('old version-1 records without a catalog resume with their exact active sets', () => {
  const legacy = model.emptyData();
  delete legacy.customExercises;
  legacy.activeWorkout = { id: 'legacy-active', date: '2026-10-23', title: '肩部训练', notes: '保留备注', durationMinutes: 7, exercises: [{ id: 'legacy-exercise', exerciseId: 'shoulder-press', sets: [{ id: 'legacy-set', weight: 22.5, reps: 12, completed: true }] }] };
  const { page } = launch(legacy);
  assert.equal(page.data.demo, false);
  assert.deepEqual(page._store.activeWorkout, legacy.activeWorkout);
  assert.equal(Array.isArray(page._store.customExercises), true);
  assert.equal(page._store.customExercises.length, 0);
  assert.equal(page.data.active.exercises[0].name, '哑铃推肩');
  assert.equal(page.data.active.volumeLabel, '270');
});

test('failed custom exercise persistence remains exportable and keeps the failure message visible', () => {
  const { page, clipboard, toasts } = launch(model.emptyData(), { storageFails: true });
  page.startWorkout();
  page.openCustomExercise();
  page.updateExerciseName(event({}, '单侧绳索划船'));
  page.saveCustomExercise();
  assert.match(toasts.at(-1), /保存失败/);
  page.exportData();
  const imported = model.parseImport(clipboard());
  assert.equal(imported.customExercises[0].name, '单侧绳索划船');
});

test('storage read failures block replacements until a successful reread restores existing workouts', () => {
  const real = model.emptyData();
  real.workouts.push(model.createInitialData().workouts[0]);
  const raw = JSON.stringify(real);
  const options = { readFails: true, local: new Map([[model.STORAGE_KEY, raw]]) };
  const { page, local, saved, toasts } = launch(model.createInitialData(), options);
  assert.equal(page.data.storageReadFailed, true);
  page.startWorkout();
  page.clearDemo();
  page.openImport();
  page.updateImport(event({}, JSON.stringify(model.emptyData())));
  page.confirmImport();
  assert.equal(saved(), undefined);
  assert.equal(local.get(model.STORAGE_KEY), raw);
  assert.match(toasts.at(-1), /未被覆盖/);
  options.readFails = false;
  page.retryStorageRead();
  assert.equal(page.data.storageReadFailed, false);
  assert.equal(page.data.summary.totalWorkouts, 1);
  assert.deepEqual(page._store.workouts, real.workouts);
  page.startWorkout();
  assert.deepEqual(saved().workouts, real.workouts);
});

test('a verified native read is used directly rather than replacing records with a fallback demo', () => {
  const real = model.emptyData();
  real.workouts.push(model.createInitialData().workouts[0]);
  const { page } = launch(model.createInitialData(), { local: new Map([[model.STORAGE_KEY, JSON.stringify(real)]]) });
  assert.equal(page.data.demo, false);
  assert.equal(page.data.summary.totalWorkouts, 1);
  assert.deepEqual(page._store.workouts, real.workouts);
});
