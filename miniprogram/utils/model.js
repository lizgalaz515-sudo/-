const STORAGE_KEY = 'lianji.fitness.v1'

const MUSCLE_GROUPS = ['背部', '腿部', '胸部', '肩部', '手臂', '核心']

const EXERCISES = [
  { id: 'lat-pulldown', name: '高位下拉', muscle: '背部', kind: 'weighted' },
  { id: 'seated-row', name: '坐姿划船', muscle: '背部', kind: 'weighted' },
  { id: 'barbell-row', name: '杠铃划船', muscle: '背部', kind: 'weighted' },
  { id: 'pull-up', name: '引体向上', muscle: '背部', kind: 'bodyweight' },
  { id: 'leg-press', name: '倒蹬腿举', muscle: '腿部', kind: 'weighted' },
  { id: 'squat', name: '杠铃深蹲', muscle: '腿部', kind: 'weighted' },
  { id: 'romanian-deadlift', name: '罗马尼亚硬拉', muscle: '腿部', kind: 'weighted' },
  { id: 'leg-extension', name: '坐姿腿屈伸', muscle: '腿部', kind: 'weighted' },
  { id: 'leg-curl', name: '俯卧腿弯举', muscle: '腿部', kind: 'weighted' },
  { id: 'bench-press', name: '杠铃卧推', muscle: '胸部', kind: 'weighted' },
  { id: 'incline-dumbbell-press', name: '上斜哑铃卧推', muscle: '胸部', kind: 'weighted' },
  { id: 'cable-fly', name: '绳索夹胸', muscle: '胸部', kind: 'weighted' },
  { id: 'push-up', name: '俯卧撑', muscle: '胸部', kind: 'bodyweight' },
  { id: 'shoulder-press', name: '哑铃推肩', muscle: '肩部', kind: 'weighted' },
  { id: 'barbell-shoulder-press', name: '杠铃推肩', muscle: '肩部', kind: 'weighted' },
  { id: 'lateral-raise', name: '哑铃侧平举', muscle: '肩部', kind: 'weighted' },
  { id: 'face-pull', name: '绳索面拉', muscle: '肩部', kind: 'weighted' },
  { id: 'biceps-curl', name: '哑铃弯举', muscle: '手臂', kind: 'weighted' },
  { id: 'triceps-pushdown', name: '绳索下压', muscle: '手臂', kind: 'weighted' },
  { id: 'hammer-curl', name: '锤式弯举', muscle: '手臂', kind: 'weighted' },
  { id: 'crunch', name: '卷腹', muscle: '核心', kind: 'bodyweight' },
  { id: 'hanging-leg-raise', name: '悬垂举腿', muscle: '核心', kind: 'bodyweight' },
  { id: 'cable-crunch', name: '绳索卷腹', muscle: '核心', kind: 'weighted' },
]

function exerciseDefinitions(customExercises = []) {
  return [...EXERCISES, ...customExercises]
}

function resolveExercise(exerciseId, customExercises = []) {
  return EXERCISES.find((definition) => definition.id === exerciseId) || customExercises.find((definition) => definition.id === exerciseId)
}

function uid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
}

/** Calendar dates are local, so a late-night workout never lands on tomorrow. */
function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function normalizeNickname(value) {
  if (typeof value !== 'string') throw new Error('昵称必须是文字。')
  if (/[\u0000-\u001f\u007f]/.test(value)) throw new Error('昵称不能包含换行或控制字符。')
  const nickname = value.trim()
  if (nickname.length > 20) throw new Error('昵称最多 20 个字符。')
  return nickname
}

function emptyData() {
  return { version: 1, workouts: [], activeWorkout: null, restSeconds: 90, demo: false, customExercises: [], nickname: '' }
}

/** Demo workouts are explicitly marked and can be removed together before recording. */
function createInitialData(now = new Date()) {
  const workouts = []
  const plans = [
    { title: '背部训练', exercises: ['lat-pulldown', 'seated-row', 'barbell-row', 'pull-up'], weights: [40, 45, 40, 0], reps: [10, 12, 10, 8] },
    { title: '腿部训练', exercises: ['leg-press', 'squat', 'romanian-deadlift', 'leg-extension'], weights: [90, 50, 45, 35], reps: [15, 8, 10, 12] },
    { title: '胸肩训练', exercises: ['bench-press', 'incline-dumbbell-press', 'cable-fly', 'lateral-raise'], weights: [40, 17.5, 10, 5], reps: [10, 10, 12, 15] },
  ]
  const daysAgo = [47, 45, 43, 40, 38, 36, 33, 31, 29, 26, 24, 22, 19, 17, 15, 12, 10, 8, 5, 3, 1]
  daysAgo.forEach((days, index) => {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    date.setDate(date.getDate() - days)
    const plan = plans[index % plans.length]
    const progress = Math.floor(index / 6) * 2.5
    workouts.push({
      id: uid(),
      date: localDate(date),
      title: plan.title,
      notes: index === daysAgo.length - 1 ? '今天状态不错，下次继续保持。' : '',
      durationMinutes: 42 + (index % 5) * 4,
      exercises: plan.exercises.map((exerciseId, exerciseIndex) => ({
        id: uid(),
        exerciseId,
        sets: Array.from({ length: exerciseId === 'pull-up' ? 3 : 4 }, (_, setIndex) => ({
          id: uid(),
          weight: plan.weights[exerciseIndex] === 0 ? 0 : plan.weights[exerciseIndex] + progress,
          reps: plan.reps[exerciseIndex] - (setIndex === 3 ? 2 : 0),
          completed: true,
        })),
      })),
    })
  })
  return { version: 1, workouts, activeWorkout: null, restSeconds: 90, demo: true, customExercises: [], nickname: '' }
}

function setStages(set) {
  return [
    { id: set.id, weight: set.weight, reps: set.reps },
    ...(set.drops || []).map((stage) => ({ id: stage.id, weight: stage.weight, reps: stage.reps })),
  ]
}

/** A drop set is one group; its external load is the sum of all its stages. */
function setVolume(set) {
  return setStages(set).reduce((total, stage) => total + stage.weight * stage.reps, 0)
}

function exerciseVolume(exercise, customExercises = []) {
  if (resolveExercise(exercise.exerciseId, customExercises)?.kind === 'bodyweight') return 0
  return exercise.sets.reduce((total, set) => total + (set.completed ? setVolume(set) : 0), 0)
}

function workoutVolume(workout, customExercises = []) {
  return workout.exercises.reduce((total, exercise) => total + exerciseVolume(exercise, customExercises), 0)
}

function workoutSetCount(workout) {
  return workout.exercises.reduce((total, exercise) => total + exercise.sets.filter((set) => set.completed).length, 0)
}

function formatVolume(value) {
  const rounded = Math.round(value * 10) / 10
  const parts = String(rounded).split('.')
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return parts.join('.')
}

function previousExercise(workouts, exerciseId) {
  const ordered = workouts.map((workout, index) => ({ workout, index })).sort((a, b) => b.workout.date.localeCompare(a.workout.date) || b.index - a.index)
  for (const { workout } of ordered) {
    const exercise = workout.exercises.find((item) => item.exerciseId === exerciseId && item.sets.some((set) => set.completed))
    if (exercise) return exercise
  }
  return undefined
}

function fail(message) {
  throw new Error(`无法导入：${message}`)
}

function record(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${label}格式不正确。`)
  const result = value
  if (Object.keys(result).some((key) => key === '__proto__' || key === 'prototype' || key === 'constructor')) fail(`${label}含有无效字段。`)
  return result
}

function text(value, label, maximum, allowEmpty = false) {
  if (typeof value !== 'string' || value.length > maximum || (!allowEmpty && !value.trim())) fail(`${label}格式不正确。`)
  return value
}

function number(value, label, minimum, maximum, integer = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum || (integer && !Number.isInteger(value))) fail(`${label}超出有效范围。`)
  return value
}

function list(value, label, maximum) {
  if (!Array.isArray(value) || value.length > maximum) fail(`${label}格式不正确或数量过多。`)
  return value
}

function boolean(value, label) {
  if (typeof value !== 'boolean') fail(`${label}格式不正确。`)
  return value
}

function validDate(value) {
  const date = text(value, '日期', 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail('日期格式应为 YYYY-MM-DD。')
  const parsed = new Date(`${date}T00:00:00.000Z`)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) fail('日期不存在。')
  return date
}

function hasDropSets(data) {
  const workoutHasDrops = (workout) => workout.exercises.some((exercise) => exercise.sets.some((set) => Object.prototype.hasOwnProperty.call(set, 'drops')))
  return data.workouts.some(workoutHasDrops) || Boolean(data.activeWorkout && workoutHasDrops(data.activeWorkout))
}

function parseImport(source) {
  if (source.length > 10_000_000) fail('文件过大，请使用 10 MB 以内的备份。')
  let parsed
  try {
    parsed = JSON.parse(source)
  } catch {
    fail('这不是有效的 JSON 备份文件。')
  }
  const data = record(parsed, '备份')
  if (data.version !== 1 && data.version !== 2) fail('备份版本不受支持。')
  // Version 1 backups predating custom exercises omitted this field. Preserve all
  // their existing workout/set IDs and values, adding only an empty catalog.
  const definitionIds = new Set(EXERCISES.map((definition) => definition.id))
  const customExercises = data.customExercises === undefined ? [] : list(data.customExercises, '自定义动作列表', 500).map((value) => {
    const definition = record(value, '自定义动作')
    const identifier = text(definition.id, '自定义动作标识', 100)
    if (!/^custom-[A-Za-z0-9][A-Za-z0-9_-]*$/.test(identifier)) fail('自定义动作标识应以 custom- 开头且仅使用字母、数字、连字符或下划线。')
    if (definitionIds.has(identifier)) fail('动作标识重复。')
    definitionIds.add(identifier)
    const name = text(typeof definition.name === 'string' ? definition.name.trim() : definition.name, '自定义动作名称', 60)
    if (!MUSCLE_GROUPS.includes(definition.muscle)) fail('自定义动作的训练部位不受支持。')
    if (!['weighted', 'bodyweight'].includes(definition.kind)) fail('自定义动作的类型不受支持。')
    return { id: identifier, name, muscle: definition.muscle, kind: definition.kind }
  })
  const definitions = new Map(exerciseDefinitions(customExercises).map((definition) => [definition.id, definition]))
  const identifiers = new Set ()
  const id = (value) => {
    const identifier = text(value, '记录标识', 128)
    if (identifiers.has(identifier)) fail('记录标识重复。')
    identifiers.add(identifier)
    return identifier
  }
  const parseWorkout = (value) => {
    const workout = record(value, '训练')
    const result = {
      id: id(workout.id),
      date: validDate(workout.date),
      title: text(workout.title, '训练名称', 100),
      notes: text(workout.notes, '训练备注', 5000, true),
      durationMinutes: number(workout.durationMinutes, '训练时长', 0, 1440, true),
      exercises: list(workout.exercises, '动作列表', 100).map((value) => {
        const exercise = record(value, '动作')
        const exerciseId = text(exercise.exerciseId, '动作名称', 100)
        const definition = definitions.get(exerciseId)
        if (!definition) fail('备份包含不支持的动作。')
        return {
          id: id(exercise.id),
          exerciseId,
          sets: list(exercise.sets, '组数', 100).map((value) => {
            const set = record(value, '训练组')
            const weight = number(set.weight, '重量', 0, 2000)
            if (definition.kind === 'bodyweight' && weight !== 0) fail('自重动作的重量应为 0。')
            const result = {
              id: id(set.id),
              weight,
              reps: number(set.reps, '次数', 1, 1000, true),
              completed: boolean(set.completed, '完成状态'),
            }
            if (Object.prototype.hasOwnProperty.call(set, 'drops')) {
              if (definition.kind === 'bodyweight') fail('自重动作不能使用递减组。')
              const drops = list(set.drops, '递减阶段', 9)
              if (!drops.length) fail('递减组至少需要一个追加阶段。')
              result.drops = drops.map((value) => {
                const stage = record(value, '递减阶段')
                if (Object.prototype.hasOwnProperty.call(stage, 'drops')) fail('递减阶段不能再次嵌套递减组。')
                return {
                  id: id(stage.id),
                  weight: number(stage.weight, '递减阶段重量', 0, 2000),
                  reps: number(stage.reps, '递减阶段次数', 1, 1000, true),
                }
              })
            }
            return result
          }),
        }
      }),
    }
    return result
  }
  const result = {
    version: data.version,
    workouts: list(data.workouts, '训练记录', 5000).map(parseWorkout),
    activeWorkout: data.activeWorkout === null ? null : parseWorkout(data.activeWorkout),
    restSeconds: number(data.restSeconds, '休息时长', 0, 1800, true),
    demo: boolean(data.demo, '示例数据标识'),
    customExercises,
    nickname: data.nickname === undefined ? '' : normalizeNickname(data.nickname),
  }
  // Old version-1 clients silently ignore unknown set fields. Mark drop-set
  // backups as version 2 so those clients reject and retain the original data.
  if (hasDropSets(result)) result.version = 2
  return result
}

function defaultStorage() {
  try {
    if (typeof wx !== 'undefined' && typeof wx.getStorageSync === 'function') {
      return {
        getItem: (key) => {
          const value = wx.getStorageSync(key)
          return typeof value === 'string' ? value : value ? JSON.stringify(value) : null
        },
        setItem: (key, value) => wx.setStorageSync(key, value),
      }
    }
    if (typeof localStorage !== 'undefined') return localStorage
    return undefined
  } catch {
    return undefined
  }
}

function loadData(storage = defaultStorage()) {
  try {
    const stored = storage?.getItem(STORAGE_KEY)
    return stored ? parseImport(stored) : createInitialData()
  } catch {
    return createInitialData()
  }
}

/** A false result lets the UI tell users storage is unavailable instead of silently losing data. */
function saveData(data, storage = defaultStorage()) {
  if (!storage) return false
  try {
    const stored = data.version === 1 && hasDropSets(data) ? { ...data, version: 2 } : data
    storage.setItem(STORAGE_KEY, JSON.stringify(stored))
    return true
  } catch {
    return false
  }
}

module.exports = { STORAGE_KEY, MUSCLE_GROUPS, EXERCISES, exerciseDefinitions, resolveExercise, uid, localDate, normalizeNickname, emptyData, createInitialData, setStages, setVolume, exerciseVolume, workoutVolume, workoutSetCount, formatVolume, previousExercise, parseImport, loadData, saveData }
