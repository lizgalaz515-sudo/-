const { describe, it, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const {
  createInitialData, emptyData, exerciseVolume, formatVolume, loadData,
  localDate, parseImport, previousExercise, saveData, STORAGE_KEY,
  workoutSetCount, workoutVolume, EXERCISES, exerciseDefinitions, resolveExercise, normalizeNickname, setStages, setVolume,
} = require('../miniprogram/utils/model.js')

function fixture() {
  return {
    id: 'workout', date: '2026-10-23', title: '练背', notes: '', durationMinutes: 45,
    exercises: [
      { id: 'row', exerciseId: 'seated-row', sets: [
        { id: 'set-1', weight: 40, reps: 10, completed: true },
        { id: 'set-2', weight: 45, reps: 8, completed: true },
        { id: 'set-3', weight: 50, reps: 10, completed: false },
      ] },
      { id: 'pullup', exerciseId: 'pull-up', sets: [{ id: 'set-4', weight: 0, reps: 8, completed: true }] },
    ],
  }
}

function data() {
  return { ...emptyData(), workouts: [fixture()] }
}

describe('workout statistics', () => {
  it('counts only completed weighted sets in volume and includes completed bodyweight sets in set count', () => {
    const workout = fixture()
    assert.equal(exerciseVolume(workout.exercises[0]), 760)
    assert.equal(exerciseVolume(workout.exercises[1]), 0)
    assert.equal(workoutVolume(workout), 760)
    assert.equal(workoutSetCount(workout), 3)
    assert.equal(formatVolume(12480), '12,480')
    assert.equal(formatVolume(12480.25), '12,480.3')
    assert.equal(formatVolume(0), '0')
  })

  it('finds the most recent completed exercise, independent of array order', () => {
    const older = fixture()
    const latest = { ...fixture(), id: 'latest', date: '2026-10-25' }
    const incomplete = { ...fixture(), id: 'incomplete', date: '2026-10-26', exercises: [{ id: 'uncompleted-row', exerciseId: 'seated-row', sets: [{ id: 'todo', weight: 80, reps: 8, completed: false }] }] }
    assert.equal(previousExercise([latest, older, incomplete], 'seated-row'), latest.exercises[0])
    assert.equal(previousExercise([older], 'squat'), undefined)
  })
})

describe('calendar and sample data', () => {
  it('formats local calendar dates without converting to UTC', () => {
    assert.equal(localDate(new Date(2026, 0, 2, 0, 30)), '2026-01-02')
    assert.equal(localDate(new Date(2026, 9, 26, 23, 59)), '2026-10-26')
  })

  it('creates recent, realistic, explicitly labeled sample data that validates as a backup', () => {
    const sample = createInitialData(new Date(2026, 9, 26))
    assert.equal(sample.demo, true)
    assert.equal(sample.activeWorkout, null)
    assert.equal(sample.workouts.length, 21)
    assert.equal(sample.workouts.at(-1).date, '2026-10-25')
    assert.equal(sample.workouts[0].date, '2026-09-09')
    assert.equal(new Set(sample.workouts.map((workout) => workout.title)).size, 3)
    assert.deepEqual(parseImport(JSON.stringify(sample)), sample)
    assert.equal(emptyData().demo, false)
  })
})

describe('backup validation', () => {
  it('round-trips records and an incomplete active workout', () => {
    const source = { ...data(), activeWorkout: { ...fixture(), id: 'active', exercises: [] } }
    assert.deepEqual(parseImport(JSON.stringify(source)), source)
  })

  const invalidExamples = [
    ['invalid JSON', '{'],
    ['unsupported version', JSON.stringify({ ...data(), version: 3 })],
    ['bad schema', JSON.stringify({ ...data(), workouts: null })],
    ['prototype keys', '{"version":1,"__proto__":{},"workouts":[],"activeWorkout":null,"restSeconds":90,"demo":false}'],
    ['negative timer', JSON.stringify({ ...data(), restSeconds: -1 })],
  ]
  for (const [label, source] of invalidExamples) {
    it(`rejects ${label}`, () => assert.throws(() => parseImport(source), /无法导入/))
  }

  it('rejects nonexistent dates, invalid numbers, unknown exercises, and duplicate IDs', () => {
    const invalid = data()
    invalid.workouts[0].date = '2026-02-30'
    assert.throws(() => parseImport(JSON.stringify(invalid)), /日期不存在/)
    invalid.workouts[0].date = '2026-10-23'
    invalid.workouts[0].exercises[0].sets[0].weight = -5
    assert.throws(() => parseImport(JSON.stringify(invalid)), /重量/)
    invalid.workouts[0].exercises[0].sets[0].weight = 40
    invalid.workouts[0].exercises[0].sets[0].reps = 2.5
    assert.throws(() => parseImport(JSON.stringify(invalid)), /次数/)
    invalid.workouts[0].exercises[0].sets[0].reps = 10
    invalid.workouts[0].exercises[0].exerciseId = 'unknown'
    assert.throws(() => parseImport(JSON.stringify(invalid)), /不支持的动作/)
    invalid.workouts[0].exercises[0].exerciseId = 'seated-row'
    invalid.workouts[0].exercises[0].sets[1].id = 'set-1'
    assert.throws(() => parseImport(JSON.stringify(invalid)), /重复/)
  })

  it('validates leap days and excludes unexpected fields from imported objects', () => {
    const source = data()
    source.workouts[0].date = '2028-02-29'
    assert.deepEqual(parseImport(JSON.stringify({ ...source, ignored: 'extra' })), source)
    source.workouts[0].date = '2027-02-29'
    assert.throws(() => parseImport(JSON.stringify(source)), /日期不存在/)
  })

  it('rejects weighted bodyweight exercises and excessive file sizes', () => {
    const source = data()
    source.workouts[0].exercises[1].sets[0].weight = 10
    assert.throws(() => parseImport(JSON.stringify(source)), /自重动作/)
    assert.throws(() => parseImport(' '.repeat(10_000_001)), /文件过大/)
  })
})

describe('custom exercise catalogs and backward-compatible backups', () => {
  function catalog() {
    return [
      { id: 'custom-machine-press', name: '史密斯推肩', muscle: '肩部', kind: 'weighted' },
      { id: 'custom-band-pullup', name: '弹力带引体向上', muscle: '背部', kind: 'bodyweight' },
    ]
  }

  function customData() {
    const source = data()
    source.customExercises = catalog()
    source.workouts[0].exercises[0].exerciseId = 'custom-machine-press'
    source.workouts[0].exercises[1].exerciseId = 'custom-band-pullup'
    source.activeWorkout = {
      id: 'draft', date: '2026-10-27', title: '肩部训练', notes: '下次接着练', durationMinutes: 12,
      exercises: [{
        id: 'draft-press', exerciseId: 'custom-machine-press',
        sets: [{ id: 'draft-set', weight: 22.5, reps: 12, completed: false }],
      }],
    }
    return source
  }

  it('migrates old version 1 local storage and JSON without changing weights, history, active records, or storage key', () => {
    const legacy = data()
    legacy.activeWorkout = {
      id: 'legacy-draft', date: '2026-10-26', title: '肩部训练', notes: '旧草稿', durationMinutes: 18,
      exercises: [{
        id: 'legacy-press', exerciseId: 'shoulder-press',
        sets: [{ id: 'legacy-set', weight: 17.5, reps: 9, completed: false }],
      }],
    }
    delete legacy.customExercises
    delete legacy.nickname
    const snapshot = JSON.stringify(legacy)
    const migrated = parseImport(snapshot)
    assert.deepEqual(migrated, { ...legacy, customExercises: [], nickname: '' })
    assert.deepEqual(migrated.workouts, legacy.workouts)
    assert.deepEqual(migrated.activeWorkout, legacy.activeWorkout)
    let usedKey
    assert.deepEqual(loadData({ getItem: (key) => { usedKey = key; return snapshot } }), migrated)
    assert.equal(usedKey, 'lianji.fitness.v1')
    assert.equal(STORAGE_KEY, 'lianji.fitness.v1')
    assert.equal(JSON.stringify(legacy), snapshot)
  })

  it('keeps dumbbell shoulder press stable and offers a separate barbell definition', () => {
    assert.deepEqual(resolveExercise('shoulder-press'), { id: 'shoulder-press', name: '哑铃推肩', muscle: '肩部', kind: 'weighted' })
    assert.deepEqual(resolveExercise('barbell-shoulder-press'), { id: 'barbell-shoulder-press', name: '杠铃推肩', muscle: '肩部', kind: 'weighted' })
    assert.deepEqual(emptyData().customExercises, [])
    assert.deepEqual(createInitialData().customExercises, [])
  })

  it('resolves built-in and custom definitions without changing either catalog', () => {
    const custom = catalog()
    const snapshot = JSON.stringify(custom)
    const combined = exerciseDefinitions(custom)
    assert.equal(combined.length, EXERCISES.length + custom.length)
    assert.equal(resolveExercise('custom-machine-press', custom), custom[0])
    assert.equal(resolveExercise('custom-missing', custom), undefined)
    assert.equal(resolveExercise('custom-machine-press'), undefined)
    combined.pop()
    assert.equal(JSON.stringify(custom), snapshot)
    assert.equal(exerciseDefinitions().length, EXERCISES.length)
  })

  it('round-trips custom completed workouts, unfinished drafts, and local storage', () => {
    const source = customData()
    const decoded = parseImport(JSON.stringify(source))
    assert.deepEqual(decoded, source)
    let stored
    assert.equal(saveData(source, { setItem: (key, value) => { assert.equal(key, STORAGE_KEY); stored = value } }), true)
    assert.deepEqual(loadData({ getItem: () => stored }), source)
    assert.equal(decoded.activeWorkout.exercises[0].sets[0].completed, false)
    assert.equal(decoded.activeWorkout.exercises[0].sets[0].weight, 22.5)
  })

  it('preserves historical names when a new catalog entry renames only an active exercise', () => {
    const source = customData()
    source.customExercises.push({ id: 'custom-renamed-press', name: '史密斯坐姿推肩', muscle: '肩部', kind: 'weighted' })
    source.activeWorkout.exercises[0].exerciseId = 'custom-renamed-press'
    const restored = parseImport(JSON.stringify(source))
    assert.equal(resolveExercise(restored.workouts[0].exercises[0].exerciseId, restored.customExercises).name, '史密斯推肩')
    assert.equal(resolveExercise(restored.activeWorkout.exercises[0].exerciseId, restored.customExercises).name, '史密斯坐姿推肩')
    assert.deepEqual(restored.workouts[0].exercises[0].sets, fixture().exercises[0].sets)
  })

  it('excludes custom bodyweight exercises and incomplete sets from weighted volume', () => {
    const source = customData()
    assert.equal(exerciseVolume(source.workouts[0].exercises[0], source.customExercises), 760)
    assert.equal(exerciseVolume(source.workouts[0].exercises[1], source.customExercises), 0)
    assert.equal(workoutVolume(source.workouts[0], source.customExercises), 760)
    assert.equal(workoutVolume(source.activeWorkout, source.customExercises), 0)
    assert.equal(workoutSetCount(source.workouts[0]), 3)
    // An aggregation caller can pass an unvalidated object; the catalog still
    // prevents counting self-weight as external training volume.
    const bodyweight = { ...source.workouts[0].exercises[1], sets: [{ id: 'not-imported', weight: 10, reps: 8, completed: true }] }
    assert.equal(exerciseVolume(bodyweight, source.customExercises), 0)
    source.workouts[0].exercises[1].sets[0].weight = 10
    assert.throws(() => parseImport(JSON.stringify(source)), /自重动作/)
  })

  it('trims custom exercise names and accepts at most 500 definitions', () => {
    const source = { ...emptyData(), customExercises: [{ ...catalog()[0], name: '  史密斯推肩  ' }] }
    assert.equal(parseImport(JSON.stringify(source)).customExercises[0].name, '史密斯推肩')
    source.customExercises = Array.from({ length: 500 }, (_, index) => ({ ...catalog()[0], id: `custom-exercise-${index}` }))
    assert.equal(parseImport(JSON.stringify(source)).customExercises.length, 500)
    source.customExercises.push({ ...catalog()[0], id: 'custom-exercise-500' })
    assert.throws(() => parseImport(JSON.stringify(source)), /自定义动作列表/)
  })

  it('rejects duplicate IDs, built-in shadowing, unknown references, invalid enums, names, and catalog shapes', () => {
    const invalidDefinitions = [
      [catalog()[0], { ...catalog()[0] }],
      [{ ...catalog()[0], id: 'shoulder-press' }],
      [{ ...catalog()[0], id: 'custom-' }],
      [{ ...catalog()[0], name: '   ' }],
      [{ ...catalog()[0], name: '练'.repeat(61) }],
      [{ ...catalog()[0], muscle: '全身' }],
      [{ ...catalog()[0], kind: 'duration' }],
      [{ ...catalog()[0], id: '__proto__' }],
      null,
      {},
    ]
    for (const customExercises of invalidDefinitions) {
      assert.throws(() => parseImport(JSON.stringify({ ...emptyData(), customExercises })), /无法导入/)
    }
    const unknown = customData()
    unknown.customExercises.pop()
    assert.throws(() => parseImport(JSON.stringify(unknown)), /不支持的动作/)
  })
})

describe('personal nickname and compatible profile backups', () => {
  it('starts with an empty nickname and accepts trimmed Chinese, emoji, and punctuation', () => {
    assert.equal(emptyData().nickname, '')
    assert.equal(createInitialData().nickname, '')
    assert.equal(normalizeNickname('  小李  '), '小李')
    assert.equal(normalizeNickname('阿夏🏋️ · Lift!'), '阿夏🏋️ · Lift!')
    assert.equal(normalizeNickname('今天练腿💪'), '今天练腿💪')
    assert.equal(normalizeNickname(''), '')
    assert.equal(normalizeNickname('　   '), '')
  })

  it('enforces 20 UTF-16 code units, matching the native input maxlength', () => {
    assert.equal(normalizeNickname('练'.repeat(20)), '练'.repeat(20))
    assert.equal(normalizeNickname('💪'.repeat(10)), '💪'.repeat(10))
    assert.throws(() => normalizeNickname('练'.repeat(21)), /昵称最多 20/)
    assert.throws(() => normalizeNickname('💪'.repeat(11)), /昵称最多 20/)
  })

  it('rejects nonstring shapes and every ASCII control character without silently removing them', () => {
    for (const value of [null, undefined, 12, true, {}, [], ['小李']]) {
      assert.throws(() => normalizeNickname(value), /昵称必须是文字/)
    }
    for (const code of [...Array.from({ length: 32 }, (_, index) => index), 127]) {
      assert.throws(() => normalizeNickname(`昵称${String.fromCharCode(code)}`), /昵称不能包含/)
    }
    assert.throws(() => normalizeNickname('\n小李\n'), /昵称不能包含/)
  })

  it('round-trips nicknames through JSON backups and the existing local storage key', () => {
    const source = data()
    source.nickname = '小李💪'
    source.customExercises.push({ id: 'custom-profile-row', name: '器械单侧划船', muscle: '背部', kind: 'weighted' })
    source.activeWorkout = {
      id: 'profile-draft', date: '2026-10-27', title: '背部训练', notes: '保留草稿', durationMinutes: 10,
      exercises: [{ id: 'profile-exercise', exerciseId: 'custom-profile-row', sets: [{ id: 'profile-set', weight: 22.5, reps: 8, completed: false }] }],
    }
    assert.deepEqual(parseImport(JSON.stringify(source)), source)
    let savedKey
    let raw
    assert.equal(saveData(source, { setItem: (key, value) => { savedKey = key; raw = value } }), true)
    assert.equal(savedKey, 'lianji.fitness.v1')
    assert.deepEqual(loadData({ getItem: (key) => key === savedKey ? raw : null }), source)
    const reset = { ...source, nickname: normalizeNickname('  ') }
    assert.deepEqual(parseImport(JSON.stringify(reset)), reset)
  })

  it('migrates backups from before nicknames while preserving existing custom catalogs and active sets', () => {
    const legacy = data()
    legacy.customExercises.push({ id: 'custom-old-row', name: '胸托划船', muscle: '背部', kind: 'weighted' })
    legacy.activeWorkout = {
      id: 'old-profile-draft', date: '2026-10-26', title: '背部训练', notes: '不能丢失', durationMinutes: 8,
      exercises: [{ id: 'old-profile-exercise', exerciseId: 'custom-old-row', sets: [{ id: 'old-profile-set', weight: 17.5, reps: 12, completed: true }] }],
    }
    delete legacy.nickname
    const snapshot = JSON.stringify(legacy)
    assert.deepEqual(parseImport(snapshot), { ...legacy, nickname: '' })
    assert.deepEqual(loadData({ getItem: () => snapshot }), { ...legacy, nickname: '' })
    assert.equal(JSON.stringify(legacy), snapshot)
  })

  it('trims valid imported nicknames and rejects invalid backup profile values', () => {
    assert.equal(parseImport(JSON.stringify({ ...data(), nickname: '  阿强💪  ' })).nickname, '阿强💪')
    for (const nickname of [null, 3, {}, [], '太'.repeat(21), '小李\n', '小李\u007f']) {
      assert.throws(() => parseImport(JSON.stringify({ ...data(), nickname })), /昵称/)
    }
  })
})

describe('drop sets preserve one group with multiple weighted stages', () => {
  function dropSet(completed = true) {
    return {
      id: 'drop-parent', weight: 7.5, reps: 12, completed,
      drops: [{ id: 'drop-a', weight: 5, reps: 10 }, { id: 'drop-b', weight: 2.5, reps: 8 }],
    }
  }

  function dropData() {
    const source = data()
    source.version = 2
    source.workouts[0].exercises = [{ id: 'row', exerciseId: 'lateral-raise', sets: [dropSet()] }]
    return source
  }

  it('records 7.5×12 → 5×10 → 2.5×8 as one completed group, 30 repetitions, and 160 kg of volume', () => {
    const source = dropData()
    const set = source.workouts[0].exercises[0].sets[0]
    assert.deepEqual(setStages(set), [
      { id: 'drop-parent', weight: 7.5, reps: 12 },
      { id: 'drop-a', weight: 5, reps: 10 },
      { id: 'drop-b', weight: 2.5, reps: 8 },
    ])
    assert.equal(setStages(set).reduce((total, stage) => total + stage.reps, 0), 30)
    assert.equal(setVolume(set), 160)
    assert.equal(exerciseVolume(source.workouts[0].exercises[0]), 160)
    assert.equal(workoutVolume(source.workouts[0]), 160)
    assert.equal(workoutSetCount(source.workouts[0]), 1)
    assert.deepEqual(parseImport(JSON.stringify(source)), source)
  })

  it('excludes every stage of an unfinished parent from workout totals while exposing its raw volume', () => {
    const source = dropData()
    const set = source.workouts[0].exercises[0].sets[0]
    set.completed = false
    assert.equal(setVolume(set), 160)
    assert.equal(workoutVolume(source.workouts[0]), 0)
    assert.equal(workoutSetCount(source.workouts[0]), 0)
    assert.deepEqual(parseImport(JSON.stringify(source)), source)
  })

  it('combines normal and drop sets without multiplying dumbbell weight or counting stages as groups', () => {
    const source = dropData()
    source.workouts[0].exercises[0].sets.push(
      { id: 'normal-completed', weight: 10, reps: 8, completed: true },
      { id: 'normal-incomplete', weight: 15, reps: 12, completed: false },
    )
    assert.equal(workoutVolume(source.workouts[0]), 240)
    assert.equal(workoutSetCount(source.workouts[0]), 2)
    assert.equal(setVolume(source.workouts[0].exercises[0].sets[1]), 80)
  })

  it('keeps ordinary historical set shapes unchanged and returns independent flat stage objects', () => {
    const legacy = data()
    const before = JSON.stringify(legacy)
    assert.deepEqual(parseImport(before), legacy)
    assert.equal(Object.prototype.hasOwnProperty.call(parseImport(before).workouts[0].exercises[0].sets[0], 'drops'), false)
    const normal = legacy.workouts[0].exercises[0].sets[0]
    assert.deepEqual(setStages(normal), [{ id: 'set-1', weight: 40, reps: 10 }])
    const set = dropSet()
    const stages = setStages(set)
    stages[0].weight = 100
    stages[1].reps = 100
    assert.equal(set.weight, 7.5)
    assert.equal(set.drops[0].reps, 10)
    assert.equal(JSON.stringify(legacy), before)
  })

  it('round-trips custom exercise drop sets and unfinished drafts with nickname through storage and JSON', () => {
    const source = dropData()
    source.nickname = '小李💪'
    source.customExercises.push({ id: 'custom-dumbbell-drop', name: '坐姿哑铃侧平举', muscle: '肩部', kind: 'weighted' })
    source.workouts[0].exercises[0].exerciseId = 'custom-dumbbell-drop'
    source.activeWorkout = {
      id: 'drop-draft', date: '2026-10-27', title: '肩部训练', notes: '递减组还没完成', durationMinutes: 12,
      exercises: [{ id: 'drop-draft-exercise', exerciseId: 'custom-dumbbell-drop', sets: [{
        id: 'draft-parent', weight: 7.5, reps: 12, completed: false,
        drops: [{ id: 'draft-a', weight: 5, reps: 10 }, { id: 'draft-b', weight: 2.5, reps: 8 }],
      }] }],
    }
    assert.deepEqual(parseImport(JSON.stringify(source)), source)
    let stored
    assert.equal(saveData(source, { setItem: (key, value) => { assert.equal(key, 'lianji.fitness.v1'); stored = value } }), true)
    const restored = loadData({ getItem: () => stored })
    assert.deepEqual(restored, source)
    assert.equal(workoutVolume(restored.workouts[0], restored.customExercises), 160)
    assert.equal(workoutVolume(restored.activeWorkout, restored.customExercises), 0)
    assert.equal(setVolume(restored.activeWorkout.exercises[0].sets[0]), 160)
  })

  it('accepts ten total stages and the same weight and repetition boundaries as ordinary sets', () => {
    const source = dropData()
    const set = source.workouts[0].exercises[0].sets[0]
    set.drops = Array.from({ length: 9 }, (_, index) => ({ id: `limit-drop-${index}`, weight: index % 2 ? 0 : 2000, reps: index % 2 ? 1 : 1000 }))
    const restored = parseImport(JSON.stringify(source))
    assert.equal(setStages(restored.workouts[0].exercises[0].sets[0]).length, 10)
    assert.equal(workoutSetCount(restored.workouts[0]), 1)
  })

  it('rejects empty, excessive, malformed, or nested additional stages instead of discarding them', () => {
    const invalidDrops = [
      [], null, {}, '5kg×10', [null], [5], [{}],
      Array.from({ length: 10 }, (_, index) => ({ id: `too-many-${index}`, weight: 5, reps: 10 })),
      [{ id: 'nested-a', weight: 5, reps: 10, drops: [] }],
      [{ id: 'nested-b', weight: 5, reps: 10, drops: null }],
      [{ id: 'nested-c', weight: 5, reps: 10, drops: [{ id: 'nested-d', weight: 2.5, reps: 8 }] }],
    ]
    for (const drops of invalidDrops) {
      const source = dropData()
      source.workouts[0].exercises[0].sets[0].drops = drops
      assert.throws(() => parseImport(JSON.stringify(source)), /无法导入/)
    }
  })

  it('rejects stage IDs duplicated by another stage, parent set, exercise, workout, or later set', () => {
    for (const duplicate of ['drop-b', 'drop-parent', 'row', 'workout', 'later-set']) {
      const source = dropData()
      source.workouts[0].exercises[0].sets[0].drops[0].id = duplicate
      source.workouts[0].exercises[0].sets.push({ id: 'later-set', weight: 5, reps: 10, completed: true })
      assert.throws(() => parseImport(JSON.stringify(source)), /重复/)
    }
    const source = dropData()
    source.activeWorkout = { id: 'drop-a', date: '2026-10-27', title: '草稿', notes: '', durationMinutes: 0, exercises: [] }
    assert.throws(() => parseImport(JSON.stringify(source)), /重复/)
  })

  it('rejects additional stages on built-in and custom bodyweight movements even when all stage weights are zero', () => {
    for (const custom of [false, true]) {
      const source = dropData()
      if (custom) source.customExercises.push({ id: 'custom-selfweight-drop', name: '靠墙倒立撑', muscle: '肩部', kind: 'bodyweight' })
      const exercise = source.workouts[0].exercises[0]
      exercise.exerciseId = custom ? 'custom-selfweight-drop' : 'pull-up'
      exercise.sets[0].weight = 0
      exercise.sets[0].drops.forEach((stage) => { stage.weight = 0 })
      assert.throws(() => parseImport(JSON.stringify(source)), /自重动作不能使用递减组/)
    }
  })

  it('validates stage IDs and numeric values without coercing strings or fractional repetition counts', () => {
    const invalidStages = [
      { id: '', weight: 5, reps: 10 },
      { id: 12, weight: 5, reps: 10 },
      { id: 'invalid', weight: -1, reps: 10 },
      { id: 'invalid', weight: 2000.1, reps: 10 },
      { id: 'invalid', weight: '5', reps: 10 },
      { id: 'invalid', weight: Infinity, reps: 10 },
      { id: 'invalid', weight: 5, reps: 0 },
      { id: 'invalid', weight: 5, reps: 1001 },
      { id: 'invalid', weight: 5, reps: 8.5 },
      { id: 'invalid', weight: 5, reps: '10' },
      { id: 'invalid', weight: 5, reps: null },
    ]
    for (const stage of invalidStages) {
      const source = dropData()
      source.workouts[0].exercises[0].sets[0].drops = [stage]
      assert.throws(() => parseImport(JSON.stringify(source)), /无法导入/)
    }
  })

  it('upgrades incoming version-1 records with historical or active drop sets to protected format 2', () => {
    const historical = { ...dropData(), version: 1 }
    assert.deepEqual(parseImport(JSON.stringify(historical)), { ...historical, version: 2 })
    const active = {
      ...emptyData(),
      activeWorkout: { ...historical.workouts[0], id: 'active-format-guard' },
    }
    assert.deepEqual(parseImport(JSON.stringify(active)), { ...active, version: 2 })
    assert.equal(historical.version, 1)
    assert.equal(active.version, 1)
  })

  it('retains format 2 after the last drop stage is removed and keeps ordinary backups on format 1', () => {
    const protectedData = { ...data(), version: 2 }
    assert.deepEqual(parseImport(JSON.stringify(protectedData)), protectedData)
    assert.deepEqual(parseImport(JSON.stringify(data())), data())
    assert.equal(emptyData().version, 1)
    assert.equal(createInitialData().version, 1)
    let stored
    assert.equal(saveData(protectedData, { setItem: (_, value) => { stored = value } }), true)
    assert.equal(JSON.parse(stored).version, 2)
    assert.equal(saveData(data(), { setItem: (_, value) => { stored = value } }), true)
    assert.equal(JSON.parse(stored).version, 1)
  })

  it('protects raw version-1 drop records on save without mutating caller data or changing the storage key', () => {
    const source = { ...dropData(), version: 1 }
    const snapshot = JSON.stringify(source)
    let savedKey
    let stored
    assert.equal(saveData(source, { setItem: (key, value) => { savedKey = key; stored = value } }), true)
    assert.equal(savedKey, 'lianji.fitness.v1')
    assert.equal(JSON.parse(stored).version, 2)
    assert.deepEqual(parseImport(stored), { ...source, version: 2 })
    assert.equal(JSON.stringify(source), snapshot)
    assert.equal(source.version, 1)
  })
})

describe('storage persistence', () => {
  afterEach(() => { delete global.wx })

  it('restores valid data and uses the shared storage key', () => {
    const saved = data()
    const storage = { getItem: (key) => key === STORAGE_KEY ? JSON.stringify(saved) : null }
    assert.deepEqual(loadData(storage), saved)
  })

  it('recovers from missing, corrupt, or inaccessible storage with clearly marked examples', () => {
    assert.equal(loadData({ getItem: () => null }).demo, true)
    assert.equal(loadData({ getItem: () => '{' }).demo, true)
    assert.equal(loadData({ getItem: () => { throw new Error('blocked') } }).demo, true)
  })

  it('reports quota failures and writes recoverable JSON when storage works', () => {
    const saved = data()
    assert.equal(saveData(saved, { setItem: () => { throw new Error('quota') } }), false)
    let output = ''
    let key = ''
    assert.equal(saveData(saved, { setItem: (name, value) => { key = name; output = value } }), true)
    assert.equal(key, STORAGE_KEY)
    assert.deepEqual(parseImport(output), saved)
  })

  it('uses native WeChat synchronous storage without browser APIs', () => {
    const values = new Map()
    global.wx = {
      getStorageSync: (key) => values.get(key),
      setStorageSync: (key, value) => values.set(key, value),
    }
    assert.equal(loadData().demo, true)
    assert.equal(saveData(data()), true)
    assert.deepEqual(loadData(), data())
  })
})
