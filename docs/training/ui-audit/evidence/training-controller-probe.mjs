import { createServer } from '/home/joshua/cube-lab/node_modules/vite/dist/node/index.js'
import assert from 'node:assert/strict'

const app = await createServer({
  root: '/home/joshua/cube-lab', configFile: false,
  cacheDir: '/tmp/cubelab-training-audit-vite-cache',
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
})
try {
  const { TrainingController } = await app.ssrLoadModule('/src/lib/training/controller.ts')
  const { createEmptyTrainingData } = await app.ssrLoadModule('/src/lib/training/storage.ts')
  const { NOW, setup } = await app.ssrLoadModule('/src/lib/training/persistenceFixtures.test-support.ts')
  const fixture = ({ emptyPll = false, delayed = false } = {}) => {
    let data = createEmptyTrainingData()
    if (emptyPll) data = { ...data, preferences: { ...data.preferences, sets: { ...data.preferences.sets, pll: { ...data.preferences.sets.pll, enabledCaseIds: [] } } } }
    let raw = JSON.stringify(data), now = NOW, writes = 0, fail = false
    let resolve
    const generations = []
    const c = new TrainingController({
      storage: { getItem: () => raw, setItem: (_key, value) => { if (fail) throw Error("quota"); raw = value; writes++ } },
      now: () => now,
      generate: async (_data, category, previous, retryCase) => {
        generations.push({ category, previous, retryCase })
        const value = setup(category.startsWith('oll:') ? 'oll' : 'pll', category.endsWith(':recognition') ? 'recognition' : 'execution')
        return delayed ? new Promise(settle => { resolve = () => settle(value) }) : value
      },
    })
    return { c, resolve: () => resolve(), raw: () => JSON.parse(raw), time: t => { now = t }, writes: () => writes, fail: value => { fail = value }, generations }
  }

  const invalidSwitch = fixture({ emptyPll: true, delayed: true })
  const pending = invalidSwitch.c.selectCategory('oll:execution')
  assert.equal(invalidSwitch.c.getSnapshot().preparing, true)
  await invalidSwitch.c.selectCategory('pll:execution')
  invalidSwitch.resolve()
  await pending
  const invalid = invalidSwitch.c.getSnapshot()
  assert.equal(invalid.category, 'pll:execution')
  assert.equal(invalid.setup, null)
  assert.equal(invalid.preparing, true)
  console.log('Invalid destination after in-flight setup leaves preparing=true: ' + invalid.error)

  const inactivity = fixture({ delayed: true })
  const ongoing = inactivity.c.selectCategory('oll:execution')
  inactivity.time(NOW + 86_400_000)
  inactivity.c.tick()
  assert.equal(inactivity.c.getSnapshot().data.activeVisitId, null)
  inactivity.resolve()
  await ongoing
  assert.equal(inactivity.c.getSnapshot().setup.generated.caseId, 'oll:27')
  assert.equal(inactivity.c.getSnapshot().data.activeVisitId, null)
  console.log('An in-flight setup resolves and re-enables readiness after visit inactivity, with no active visit.')

  const actions = fixture()
  await actions.c.selectCategory('oll:execution')
  const original = actions.c.getSnapshot().data.activeVisitId
  const beforeNext = actions.writes()
  await actions.c.prepare()
  assert.equal(actions.writes(), beforeNext)
  assert.equal(actions.generations.at(-1).previous, 'oll:27')
  const beforeRestart = actions.writes()
  await actions.c.selectCategory('oll:execution')
  assert.equal(actions.writes() - beforeRestart, 2)
  assert.equal(actions.c.getSnapshot().data.activeVisitId, original)
  assert.equal(actions.generations.at(-1).previous, null)
  actions.time(NOW + 86_400_000)
  actions.c.tick()
  assert.equal(actions.c.getSnapshot().category, 'oll:execution')
  assert.equal(actions.c.getSnapshot().data.activeVisitId, null)
  const beforeIdleNext = actions.writes()
  await actions.c.prepare()
  assert.equal(actions.writes(), beforeIdleNext)
  assert.equal(actions.c.getSnapshot().data.activeVisitId, null)
  await actions.c.selectCategory('oll:execution')
  assert.notEqual(actions.c.getSnapshot().data.activeVisitId, original)
  console.log('Next writes zero, forwards visible previous case, and leaves an expired visit inactive; Restart writes twice, discards visible previous-case input, keeps the active visit, and starts a new visit after expiry.')
  const interruptedSwitch = fixture()
  await interruptedSwitch.c.selectCategory('oll:execution')
  interruptedSwitch.fail(true)
  await interruptedSwitch.c.selectCategory('pll:execution')
  assert.equal(interruptedSwitch.c.getSnapshot().pendingSave, true)
  interruptedSwitch.fail(false)
  interruptedSwitch.c.retrySave()
  await Promise.resolve()
  await Promise.resolve()
  const interrupted = interruptedSwitch.c.getSnapshot()
  assert.equal(interruptedSwitch.raw().preferences.selectedSetId, 'pll')
  assert.equal(interrupted.pendingSave, false)
  assert.equal(interrupted.category, 'oll:execution')
  assert.equal(interrupted.setup.generated.setId, 'oll')
  assert.equal(interrupted.data.visits.at(-1).startedCategoryId, 'oll:execution')
  console.log('Retry after category preference write failure saves PLL selection but leaves OLL category, visit and prepared scramble.')
} finally {
  await app.close()
}
