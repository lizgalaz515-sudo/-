const model = require('../../utils/model');

const pad = (value) => String(value).padStart(2, '0');
const number = (value) => model.formatVolume(value);
const dateFromKey = (key) => new Date(`${key}T12:00:00`);
const keyOf = (value) => model.localDate(value);
const addDays = (date, count) => {
  const next = new Date(date);
  next.setDate(next.getDate() + count);
  return next;
};
const names = new Map(model.EXERCISES.map((exercise) => [exercise.id, exercise]));
const recoveryPointerKey = `${model.STORAGE_KEY}.recovery.latest`;
const templateIds = {
  '背部': ['lat-pulldown', 'seated-row', 'barbell-row'],
  '腿部': ['squat', 'leg-press', 'romanian-deadlift'],
  '胸部': ['bench-press', 'incline-dumbbell-press'],
  '肩部': ['shoulder-press', 'lateral-raise'],
  '手臂': ['biceps-curl', 'triceps-pushdown'],
  '核心': ['crunch', 'hanging-leg-raise']
};

function decorateWorkout(workout) {
  if (!workout) return null;
  const exercises = workout.exercises.map((exercise) => {
    const definition = names.get(exercise.exerciseId) || { name: '自定义动作', muscle: '其他', kind: 'weighted' };
    return {
      ...exercise,
      name: definition.name,
      muscle: definition.muscle,
      kind: definition.kind,
      sets: exercise.sets.map((set, index) => ({ ...set, index: index + 1 }))
    };
  });
  const date = dateFromKey(workout.date);
  return {
    ...workout,
    exercises,
    dateLabel: `${date.getMonth() + 1}月${date.getDate()}日`,
    dayLabel: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][date.getDay()],
    muscles: [...new Set(exercises.map((exercise) => exercise.muscle))].join(' / '),
    exerciseCount: exercises.length,
    setCount: model.workoutSetCount(workout),
    volumeLabel: number(model.workoutVolume(workout)),
    durationLabel: `${workout.durationMinutes} 分钟`
  };
}

function buildView(store, selectedDate, monthKey, selectedMuscle) {
  const today = new Date();
  const todayDate = keyOf(today);
  const monday = addDays(dateFromKey(todayDate), -((today.getDay() + 6) % 7));
  const mondayKey = keyOf(monday);
  const nextMondayKey = keyOf(addDays(monday, 7));
  const sorted = store.workouts.map((workout, index) => ({ workout, index })).sort((a, b) => b.workout.date.localeCompare(a.workout.date) || b.index - a.index).map((item) => item.workout);
  const byDate = {};
  sorted.forEach((workout) => { byDate[workout.date] = (byDate[workout.date] || 0) + 1; });
  const weekly = sorted.filter((workout) => workout.date >= mondayKey && workout.date < nextMondayKey);
  const weekDays = Array.from({ length: 7 }, (_, index) => {
    const date = addDays(monday, index);
    const key = keyOf(date);
    return { date: key, day: date.getDate(), label: ['一', '二', '三', '四', '五', '六', '日'][index], isToday: key === todayDate, done: Boolean(byDate[key]), count: byDate[key] || 0 };
  });
  const month = dateFromKey(`${monthKey}-01`);
  const leading = (month.getDay() + 6) % 7;
  const monthLength = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const calendar = Array.from({ length: Math.ceil((leading + monthLength) / 7) * 7 }, (_, index) => {
    const day = index - leading + 1;
    if (day < 1 || day > monthLength) return { date: `empty-${index}`, empty: true, day: '', count: 0, selected: false, isToday: false, level: 0 };
    const date = `${monthKey}-${pad(day)}`;
    const count = byDate[date] || 0;
    return { date, day, count, empty: false, selected: date === selectedDate, isToday: date === todayDate, level: Math.min(3, count) };
  });
  const rawBars = Array.from({ length: 7 }, (_, index) => {
    const start = addDays(monday, (index - 6) * 7);
    const end = keyOf(addDays(start, 7));
    const included = sorted.filter((workout) => workout.date >= keyOf(start) && workout.date < end);
    const value = included.reduce((sum, workout) => sum + model.workoutVolume(workout), 0);
    return { label: `${start.getMonth() + 1}/${start.getDate()}`, value, volumeLabel: number(value), isCurrent: index === 6 };
  });
  const peak = Math.max(1, ...rawBars.map((bar) => bar.value));
  const bars = rawBars.map((bar) => ({ ...bar, height: bar.value ? Math.max(3, Math.round(bar.value / peak * 100)) : 0 }));
  const heatmap = Array.from({ length: 84 }, (_, index) => {
    const date = keyOf(addDays(dateFromKey(todayDate), index - 83));
    return { date, count: byDate[date] || 0, level: Math.min(3, byDate[date] || 0) };
  });
  const muscleCounts = model.MUSCLE_GROUPS.map((muscle) => ({
    name: muscle,
    count: sorted.reduce((sum, workout) => sum + workout.exercises.filter((exercise) => names.get(exercise.exerciseId)?.muscle === muscle).reduce((sets, exercise) => sets + exercise.sets.filter((set) => set.completed).length, 0), 0)
  }));
  const maxMuscle = Math.max(1, ...muscleCounts.map((item) => item.count));
  let streak = 0;
  let cursor = dateFromKey(todayDate);
  if (!byDate[todayDate]) cursor = addDays(cursor, -1);
  while (byDate[keyOf(cursor)]) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  const active = decorateWorkout(store.activeWorkout);
  if (active) active.exercises.forEach((exercise) => {
    const previous = model.previousExercise(store.workouts, exercise.exerciseId);
    const completed = previous ? previous.sets.filter((set) => set.completed) : [];
    const best = completed.reduce((result, set) => !result || set.weight > result.weight || set.weight === result.weight && set.reps > result.reps ? set : result, null);
    exercise.previousLabel = best ? `上次参考 · ${exercise.kind === 'bodyweight' ? '自重' : `${best.weight} kg`} × ${best.reps} 次` : '第一次记录，从这一组开始';
  });
  const options = model.EXERCISES.filter((exercise) => exercise.muscle === selectedMuscle).map((exercise) => ({
    ...exercise,
    selected: Boolean(store.activeWorkout && store.activeWorkout.exercises.some((item) => item.exerciseId === exercise.id))
  }));
  return {
    demo: store.demo,
    todayDate,
    dateLabel: `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日 ${['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][today.getDay()]}`,
    greeting: today.getHours() < 11 ? '早上好，训练者' : today.getHours() < 18 ? '下午好，训练者' : '晚上好，训练者',
    weekLabel: `${monday.getMonth() + 1}.${monday.getDate()} — ${addDays(monday, 6).getMonth() + 1}.${addDays(monday, 6).getDate()}`,
    summary: {
      weekWorkouts: weekly.length,
      weekVolume: number(weekly.reduce((sum, workout) => sum + model.workoutVolume(workout), 0)),
      weekSets: weekly.reduce((sum, workout) => sum + model.workoutSetCount(workout), 0),
      streak,
      totalWorkouts: sorted.length,
      totalVolume: number(sorted.reduce((sum, workout) => sum + model.workoutVolume(workout), 0)),
      totalSets: sorted.reduce((sum, workout) => sum + model.workoutSetCount(workout), 0)
    },
    weekDays,
    calendar,
    calendarLabel: `${month.getFullYear()}年${month.getMonth() + 1}月`,
    recentWorkouts: sorted.slice(0, 3).map(decorateWorkout),
    historyWorkouts: sorted.filter((workout) => workout.date === selectedDate).map(decorateWorkout),
    selectedDateLabel: `${dateFromKey(selectedDate).getMonth() + 1}月${dateFromKey(selectedDate).getDate()}日`,
    active,
    exerciseOptions: options,
    bars,
    heatmap,
    muscleStats: muscleCounts.map((muscle) => ({ ...muscle, percent: Math.round(muscle.count / maxMuscle * 100) }))
  };
}

function toast(title) {
  wx.showToast({ title, icon: 'none', duration: 2200 });
}

function confirm(title, content, callback) {
  wx.showModal({ title, content, confirmText: '确定', cancelText: '取消', success: (result) => { if (result.confirm) callback(); } });
}

function inputNumber(raw, field) {
  const text = String(raw).trim();
  const pattern = field === 'weight' ? /^(?:\d+(?:\.\d*)?|\.\d+)$/ : /^\d+$/;
  if (!pattern.test(text)) return null;
  const value = Number(text);
  const minimum = field === 'weight' ? 0 : 1;
  const maximum = field === 'weight' ? 2000 : 1000;
  return Number.isFinite(value) && value >= minimum && value <= maximum && (field === 'weight' || Number.isInteger(value)) ? value : null;
}

const draftKey = (exerciseId, setId, field) => JSON.stringify([exerciseId, setId, field]);

Page({
  data: {
    tab: 'today',
    sheet: '',
    store: null,
    active: null,
    detail: null,
    demo: false,
    recoveryWarning: false,
    muscles: model.MUSCLE_GROUPS,
    selectedMuscle: '背部',
    selectedDate: keyOf(new Date()),
    monthKey: keyOf(new Date()).slice(0, 7),
    summary: {},
    weekDays: [],
    calendar: [],
    recentWorkouts: [],
    historyWorkouts: [],
    bars: [],
    heatmap: [],
    muscleStats: [],
    exerciseOptions: [],
    importText: '',
    restSeconds: 90,
    restRemaining: 90,
    restLabel: '01:30',
    restRunning: false
  },

  onLoad() {
    this._setDrafts = Object.create(null);
    this._pendingCorrupt = null;
    this._recoveryRaw = null;
    if (typeof wx.getStorageSync === 'function') {
      try {
        const pointer = wx.getStorageSync(recoveryPointerKey);
        if (pointer) this._recoveryRaw = wx.getStorageSync(pointer) || null;
        const raw = wx.getStorageSync(model.STORAGE_KEY);
        if (raw) {
          const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
          try { model.parseImport(text); }
          catch (_) {
            this._pendingCorrupt = text;
            this._recoveryRaw = text;
          }
        }
      } catch (_) {}
    }
    this._store = model.loadData();
    this._startedAt = this._store.activeWorkout ? Date.now() : null;
    this._durationBase = this._store.activeWorkout ? this._store.activeWorkout.durationMinutes : 0;
    this._deadline = 0;
    this._restInterval = null;
    this._refresh();
    this._setRestRemaining(this._store.restSeconds);
    this.setData({ restSeconds: this._store.restSeconds, recoveryWarning: Boolean(this._recoveryRaw) });
    if (this._pendingCorrupt) toast('旧记录无法读取，原始数据已保留，请先导出');
  },

  onShow() {
    if (!this._store) return;
    if (this._store.activeWorkout && !this._startedAt) this._startedAt = Date.now();
    this._refresh();
    if (this._deadline) this._runRestInterval();
  },

  onHide() {
    this._clearRestInterval();
    if (this._store.activeWorkout) {
      this._store.activeWorkout.durationMinutes = this._elapsedMinutes();
      this._durationBase = this._store.activeWorkout.durationMinutes;
      this._startedAt = null;
      this._commit();
    }
  },

  onUnload() {
    this._clearRestInterval();
  },

  _refresh() {
    const view = buildView(this._store, this.data.selectedDate, this.data.monthKey, this.data.selectedMuscle);
    if (view.active) {
      view.active.exercises.forEach((exercise) => exercise.sets.forEach((set) => {
        ['weight', 'reps'].forEach((field) => {
          const key = draftKey(exercise.id, set.id, field);
          if (Object.prototype.hasOwnProperty.call(this._setDrafts, key)) set[field] = this._setDrafts[key];
        });
      }));
    } else this._setDrafts = Object.create(null);
    this.setData(view);
  },

  _commit() {
    if (this._store.activeWorkout) this._store.activeWorkout.durationMinutes = this._elapsedMinutes();
    if (this._pendingCorrupt) {
      this._refresh();
      toast('旧记录已保留，请先导出原始备份');
      return false;
    }
    const saved = model.saveData(this._store);
    this._refresh();
    if (!saved) toast('本机保存失败，请导出备份后重试');
    return saved;
  },

  _preserveRecovery() {
    if (!this._pendingCorrupt) return true;
    try {
      const key = `${model.STORAGE_KEY}.recovery.${Date.now()}`;
      wx.setStorageSync(key, this._pendingCorrupt);
      wx.setStorageSync(recoveryPointerKey, key);
      this._pendingCorrupt = null;
      return true;
    } catch (_) {
      toast('原始备份保存失败，请先导出；旧记录未被覆盖');
      return false;
    }
  },

  _findExercise(id) {
    return this._store.activeWorkout && this._store.activeWorkout.exercises.find((exercise) => exercise.id === id);
  },

  _elapsedMinutes() {
    const elapsed = this._startedAt ? (Date.now() - this._startedAt) / 60000 : 0;
    return Math.min(1440, Math.max(0, Math.round((this._durationBase || 0) + elapsed)));
  },

  _makeExercise(definition) {
    const previous = model.previousExercise(this._store.workouts, definition.id);
    const lastSets = previous && previous.sets.filter((set) => set.completed);
    const sets = lastSets && lastSets.length ? lastSets : Array.from({ length: 3 }, () => ({ weight: definition.kind === 'bodyweight' ? 0 : 20, reps: 10 }));
    return {
      id: model.uid(),
      exerciseId: definition.id,
      sets: sets.map((set) => ({ id: model.uid(), weight: definition.kind === 'bodyweight' ? 0 : set.weight, reps: set.reps, completed: false }))
    };
  },

  switchTab(event) {
    const tab = event.currentTarget.dataset.tab;
    if (!['today', 'history', 'insights', 'settings'].includes(tab)) return;
    this.setData({ tab, sheet: '' });
    this._refresh();
  },

  openStart() {
    if (this._store.activeWorkout) {
      this.setData({ tab: 'today', sheet: '' });
      return;
    }
    this.setData({ sheet: 'start' });
  },

  selectMuscle(event) {
    const muscle = event.currentTarget.dataset.muscle;
    if (!model.MUSCLE_GROUPS.includes(muscle)) return;
    this.setData({ selectedMuscle: muscle });
    this._refresh();
  },

  startWorkout() {
    if (this._store.activeWorkout) return this.openStart();
    if (this._store.demo) {
      confirm('开始自己的记录？', '示例数据会被清空，接下来只记录你自己的训练。当前画面是功能示例，不是你的历史成绩。', () => {
        if (!this._preserveRecovery()) return;
        const restSeconds = this._store.restSeconds;
        this._store = { ...model.emptyData(), restSeconds };
        this.startWorkout();
      });
      return;
    }
    const muscle = this.data.selectedMuscle;
    const preferred = templateIds[muscle] || [];
    let definitions = preferred.map((id) => names.get(id)).filter(Boolean);
    if (!definitions.length) definitions = model.EXERCISES.filter((exercise) => exercise.muscle === muscle).slice(0, 3);
    this._store.activeWorkout = {
      id: model.uid(),
      date: keyOf(new Date()),
      title: `${muscle}训练`,
      notes: '',
      exercises: definitions.map((definition) => this._makeExercise(definition)),
      durationMinutes: 0
    };
    this._startedAt = Date.now();
    this._durationBase = 0;
    this.setData({ tab: 'today', sheet: '' });
    this._commit();
  },

  closeSheet() {
    this.setData({ sheet: '', detail: null });
  },

  noop() {},

  openExercisePicker() {
    if (!this._store.activeWorkout) return;
    this.setData({ sheet: 'exercise' });
    this._refresh();
  },

  chooseExercise(event) {
    if (!this._store.activeWorkout) return;
    const definition = names.get(event.currentTarget.dataset.id);
    if (!definition) return;
    if (this._store.activeWorkout.exercises.some((exercise) => exercise.exerciseId === definition.id)) return toast('这个动作已经添加了');
    this._store.activeWorkout.exercises.push(this._makeExercise(definition));
    this.setData({ sheet: '' });
    this._commit();
  },

  addSet(event) {
    const exercise = this._findExercise(event.currentTarget.dataset.exercise);
    if (!exercise) return;
    if (exercise.sets.length >= 30) return toast('每个动作最多记录 30 组');
    const previous = exercise.sets[exercise.sets.length - 1];
    exercise.sets.push({ id: model.uid(), weight: previous ? previous.weight : 0, reps: previous ? previous.reps : 10, completed: false });
    this._commit();
  },

  removeSet(event) {
    const exercise = this._findExercise(event.currentTarget.dataset.exercise);
    if (!exercise) return;
    if (exercise.sets.length === 1) {
      confirm('移除动作？', '这是该动作的最后一组，移除后可随时重新添加。', () => {
        this._store.activeWorkout.exercises = this._store.activeWorkout.exercises.filter((item) => item.id !== exercise.id);
        this._commit();
      });
      return;
    }
    exercise.sets = exercise.sets.filter((set) => set.id !== event.currentTarget.dataset.set);
    this._commit();
  },

  changeSet(event) {
    const { exercise: exerciseId, set: setId, field } = event.currentTarget.dataset;
    const exercise = this._findExercise(exerciseId);
    const set = exercise && exercise.sets.find((item) => item.id === setId);
    if (!set || !['weight', 'reps'].includes(field)) return;
    if (field === 'weight' && names.get(exercise.exerciseId)?.kind === 'bodyweight') return;
    const raw = String(event.detail.value);
    this._setDrafts[draftKey(exerciseId, setId, field)] = raw;
    const value = inputNumber(raw, field);
    if (value === null) {
      this._refresh();
      return;
    }
    set[field] = value;
    this._commit();
  },

  normalizeSet(event) {
    const dataset = event && event.currentTarget && event.currentTarget.dataset;
    if (!dataset) {
      this._setDrafts = Object.create(null);
      this._refresh();
      return;
    }
    const { exercise: exerciseId, set: setId, field } = dataset;
    if (!['weight', 'reps'].includes(field)) return;
    const key = draftKey(exerciseId, setId, field);
    const raw = this._setDrafts[key];
    delete this._setDrafts[key];
    if (raw !== undefined && raw.trim() && inputNumber(raw, field) === null) {
      toast(field === 'weight' ? '重量需在 0–2000 kg 之间' : '次数需为 1–1000 的整数');
    }
    this._refresh();
  },

  toggleSet(event) {
    const exercise = this._findExercise(event.currentTarget.dataset.exercise);
    const set = exercise && exercise.sets.find((item) => item.id === event.currentTarget.dataset.set);
    if (!set) return;
    set.completed = !set.completed;
    this._commit();
  },

  changeWorkoutDate(event) {
    if (!this._store.activeWorkout) return;
    const value = String(event.detail.value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || keyOf(dateFromKey(value)) !== value) return;
    if (value > keyOf(new Date())) return toast('训练日期不能晚于今天');
    this._store.activeWorkout.date = value;
    this._commit();
  },

  updateNotes(event) {
    if (!this._store.activeWorkout) return;
    this._store.activeWorkout.notes = String(event.detail.value).slice(0, 2000);
    this._commit();
  },

  finishWorkout() {
    const active = this._store.activeWorkout;
    if (!active) return;
    const exercises = active.exercises.map((exercise) => ({ ...exercise, sets: exercise.sets.filter((set) => set.completed) })).filter((exercise) => exercise.sets.length);
    if (!exercises.length) return toast('先勾选至少一组已完成的训练');
    confirm('完成这次训练？', `已完成 ${model.workoutSetCount(active)} 组；未勾选的组不会保存到历史。`, () => {
      const elapsed = Math.max(1, this._elapsedMinutes());
      this._store.workouts.push({ ...active, exercises, durationMinutes: elapsed });
      this._store.activeWorkout = null;
      this._startedAt = null;
      this._durationBase = 0;
      this.resetRest();
      this.setData({ tab: 'history', selectedDate: active.date, monthKey: active.date.slice(0, 7), sheet: '' });
      if (this._commit()) toast('训练已保存，今天又进步了一点！');
    });
  },

  discardWorkout() {
    if (!this._store.activeWorkout) return;
    confirm('放弃本次训练？', '未完成的训练记录将被删除，历史记录不受影响。', () => {
      this._store.activeWorkout = null;
      this._startedAt = null;
      this._durationBase = 0;
      this.resetRest();
      this._commit();
    });
  },

  onDateChange(event) {
    const date = event.detail.value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || keyOf(dateFromKey(date)) !== date) return;
    this.setData({ selectedDate: date, monthKey: date.slice(0, 7), tab: 'history' });
    this._refresh();
  },

  selectDate(event) {
    const date = event.currentTarget.dataset.date;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    this.setData({ selectedDate: date, monthKey: date.slice(0, 7), tab: 'history' });
    this._refresh();
  },

  _moveMonth(delta) {
    const current = dateFromKey(`${this.data.monthKey}-01`);
    current.setMonth(current.getMonth() + delta);
    this.setData({ monthKey: keyOf(current).slice(0, 7) });
    this._refresh();
  },

  previousMonth() { this._moveMonth(-1); },
  nextMonth() { this._moveMonth(1); },

  showWorkout(event) {
    const workout = this._store.workouts.find((item) => item.id === event.currentTarget.dataset.id);
    if (workout) this.setData({ detail: decorateWorkout(workout), sheet: 'detail' });
  },

  deleteWorkout(event) {
    const id = event.currentTarget.dataset.id;
    if (!this._store.workouts.some((workout) => workout.id === id)) return;
    confirm('删除这次训练？', '删除后无法撤销，建议先导出一份备份。', () => {
      this._store.workouts = this._store.workouts.filter((workout) => workout.id !== id);
      this.setData({ sheet: '', detail: null });
      if (this._commit()) toast('这次训练已删除');
    });
  },

  exportData() {
    wx.setClipboardData({
      data: JSON.stringify(this._store, null, 2),
      success: () => toast('备份已复制，请粘贴到备忘录保存'),
      fail: () => toast('复制失败，请重试')
    });
  },

  exportRecovery() {
    if (!this._recoveryRaw) return;
    wx.setClipboardData({
      data: this._recoveryRaw,
      success: () => toast('原始备份已复制，请粘贴保存'),
      fail: () => toast('复制失败，旧记录仍保留在本机')
    });
  },

  openImport() {
    this.setData({ sheet: 'import', importText: '' });
  },

  updateImport(event) {
    this.setData({ importText: String(event.detail.value) });
  },

  confirmImport() {
    let incoming;
    try {
      incoming = model.parseImport(this.data.importText);
    } catch (error) {
      return toast('备份格式不正确，请粘贴完整的练记备份');
    }
    confirm('导入并替换记录？', `备份包含 ${incoming.workouts.length} 次训练。现有记录将被替换，请先导出备份。`, () => {
      if (!this._preserveRecovery()) return;
      this.resetRest();
      this._store = incoming;
      this._startedAt = incoming.activeWorkout ? Date.now() : null;
      this._durationBase = incoming.activeWorkout ? incoming.activeWorkout.durationMinutes : 0;
      this.setData({ sheet: '', importText: '', restSeconds: incoming.restSeconds, tab: 'today' });
      this._setRestRemaining(incoming.restSeconds);
      if (this._commit()) toast('备份导入成功');
    });
  },

  clearDemo() {
    if (!this._store.demo) return;
    confirm('清除全部示例记录？', '这会同时清空示例模式下新增的记录与进行中的训练。请先导出需要保留的数据。', () => {
      if (!this._preserveRecovery()) return;
      this.resetRest();
      this._store = model.emptyData();
      this._startedAt = null;
      this._durationBase = 0;
      this.setData({ tab: 'today', sheet: '', detail: null, restSeconds: this._store.restSeconds });
      this._setRestRemaining(this._store.restSeconds);
      if (this._commit()) toast('已清空示例，开始你的第一练吧');
    });
  },

  _clearRestInterval() {
    if (this._restInterval) clearInterval(this._restInterval);
    this._restInterval = null;
  },

  _setRestRemaining(seconds) {
    const remaining = Math.max(0, Math.ceil(seconds));
    this.setData({ restRemaining: remaining, restLabel: `${pad(Math.floor(remaining / 60))}:${pad(remaining % 60)}` });
  },

  _tickRest() {
    if (!this._deadline) return;
    const remaining = Math.max(0, Math.ceil((this._deadline - Date.now()) / 1000));
    this._setRestRemaining(remaining);
    if (!remaining) {
      this._deadline = 0;
      this._clearRestInterval();
      this.setData({ restRunning: false });
      toast('休息结束，准备下一组');
    }
  },

  _runRestInterval() {
    this._clearRestInterval();
    this._tickRest();
    if (this._deadline) this._restInterval = setInterval(() => this._tickRest(), 250);
  },

  setRest(event) {
    const seconds = Number(event.currentTarget.dataset.seconds);
    if (![60, 90, 120, 180].includes(seconds)) return;
    this._store.restSeconds = seconds;
    this.setData({ restSeconds: seconds });
    this.resetRest();
    this._commit();
  },

  toggleRest() {
    if (this.data.restRunning) {
      this._tickRest();
      this._deadline = 0;
      this._clearRestInterval();
      this.setData({ restRunning: false });
      return;
    }
    if (!this.data.restRemaining) this._setRestRemaining(this.data.restSeconds);
    this._deadline = Date.now() + this.data.restRemaining * 1000;
    this.setData({ restRunning: true });
    this._runRestInterval();
  },

  resetRest() {
    this._deadline = 0;
    this._clearRestInterval();
    this.setData({ restRunning: false });
    this._setRestRemaining(this.data.restSeconds);
  }
});
