const { describe, it, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const {
  createInitialData, emptyData, exerciseVolume, formatVolume, loadData,
  localDate, parseImport, previousExercise, saveData, STORAGE_KEY,
  workoutSetCount, workoutVolume, EXERCISES, exerciseDefinitions, resolveExercise,
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
    ['unsupported version', JSON.stringify({ ...data(), version: 2 })],
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
    const snapshot = JSON.stringify(legacy)
    const migrated = parseImport(snapshot)
    assert.deepEqual(migrated, { ...legacy, customExercises: [] })
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
