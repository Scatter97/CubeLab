// @vitest-environment node
import { beforeAll, expect, it } from 'vitest'
import { loadCube3Model, type Cube3Model } from './cube3'
import { STANDARD_CASE_BY_ID } from './catalog/standardCases'
import type { TrainingAlgorithmRecord } from './catalog/types'
import { generateTrainingSetup } from './setupGeneration'
import { appendTrainingAttempt, createTrainingAttempt, createTrainingVisit, correctTrainingAttribution } from './records'
import { createEmptyTrainingData, deserializeTrainingData, loadTraining, saveTraining, serializeTrainingData } from './storage'
import { TRAINING_CATEGORIES } from './types'
import { NOW, calibration } from './persistenceFixtures.test-support'
import { builtInAlgorithmForCase } from './catalog/defaultAlgorithms'
import { algorithmSnapshotFor, availableAlgorithm } from './algorithmSelection'
import { verifyCustomAlgorithm, algorithmSnapshot } from './runtime'

let model: Cube3Model
beforeAll(async () => { model = await loadCube3Model() })

it.each(TRAINING_CATEGORIES)('persists actual verified generator output for %s', (categoryId) => {
  const setId = categoryId.startsWith('oll:') ? 'oll' : 'pll'
  const mode = categoryId.endsWith(':recognition') ? 'recognition' : 'execution'
  const caseId = setId === 'oll' ? 'oll:27' : 'pll:ua'
  // Existing mathematical test examples, not a default algorithm dataset.
  const notation = setId === 'oll' ? "R U R' U R U2 R'" : "M2 U M U2 M' U M2"
  const algorithm: TrainingAlgorithmRecord = {
    id: `${caseId}:fixture`, version: 1, caseId, setId, source: 'user',
    notation, normalizedNotation: notation, immutable: true,
    provenance: { sourceKind: 'user', normalizedNotation: notation, redistribution: 'not-applicable' },
    verification: { status: 'verified', method: 'cube-state', verifiedAt: 'fixture', frameNormalized: true, solvesCase: true, checkedAufs: [''] },
  }
  const definition = { ...STANDARD_CASE_BY_ID.get(caseId)!, generatorAlgorithmId: algorithm.id }
  const generated = generateTrainingSetup({ model, caseDefinition: definition, algorithms: [algorithm], mode, auf: 'U2' })
  const visit = createTrainingVisit(categoryId, NOW)
  const attempt = createTrainingAttempt({
    setup: { version: 1, generatedAt: NOW, generatorVersion: 'phase-2b', generatorAlgorithm: { id: algorithm.id, revision: algorithm.version, notation }, generated },
    preferredAlgorithm: { id: 'user:preferred', revision: 2, notation },
    calibration: mode === 'recognition' ? calibration(setId) : null,
    visitId: visit.id, rawMs: 2345.6789, createdAt: NOW + 100,
  })
  const data = appendTrainingAttempt({ ...createEmptyTrainingData(), visits: [visit], activeVisitId: visit.id }, attempt)
  const values = new Map<string, string>()
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, raw: string) => { values.set(key, raw) } }
  const saved = saveTraining(data, null, storage)
  expect(saved.ok).toBe(true)
  const loaded = loadTraining(storage)
  expect(loaded.ok && loaded.data).toEqual(data)
  const correction = correctTrainingAttribution(attempt, null, NOW + 200)
  if (!saved.ok) throw Error(saved.error)
  expect(saveTraining({ ...data, attempts: [correction] }, saved.raw, storage).ok).toBe(true)
  expect(deserializeTrainingData(serializeTrainingData(data)).attempts[0]!.rawMs).toBe(2345.6789)
})

it('retains custom algorithms and stored preferences without copying defaults into storage', async () => {
  const custom = await verifyCustomAlgorithm('oll:27', "R U R' U R U2 R'")
  const data = {
    ...createEmptyTrainingData(),
    customAlgorithms: [custom],
    preferences: {
      ...createEmptyTrainingData().preferences,
      preferredAlgorithms: [
        { caseId: 'oll:27' as const, algorithm: algorithmSnapshot(custom) },
      ],
    },
  }
  const loaded = deserializeTrainingData(serializeTrainingData(data))
  expect(loaded).toEqual(data)
  expect(loaded.customAlgorithms.map((algorithm) => algorithm.id)).toEqual([
    custom.id,
  ])
  expect(loaded.preferences.preferredAlgorithms).toEqual([
    { caseId: 'oll:27', algorithm: algorithmSnapshot(custom) },
  ])
  expect(loaded.customAlgorithms.some((algorithm) => algorithm.id.includes('default-v1'))).toBe(false)
  expect(availableAlgorithm(loaded, 'oll:27')?.id).toBe(custom.id)
  expect(availableAlgorithm(loaded, 'oll:28')?.id).toBe(
    'oll:28:alg:default-v1',
  )
})

it('round-trips a stored built-in preference and its historical attribution snapshot', async () => {
  const caseId = 'oll:27' as const
  const algorithm = builtInAlgorithmForCase(caseId)!
  const definition = { ...STANDARD_CASE_BY_ID.get(caseId)!, defaultAlgorithmId: algorithm.id, generatorAlgorithmId: algorithm.id }
  const generated = generateTrainingSetup({ model, caseDefinition: definition, algorithms: [algorithm], mode: 'execution', auf: '' })
  const visit = createTrainingVisit('oll:execution', NOW)
  const attempt = createTrainingAttempt({
    setup: { version: 1, generatedAt: NOW, generatorVersion: 'verified-built-in-algorithm:v1', generatorAlgorithm: algorithmSnapshotFor(algorithm), generated },
    preferredAlgorithm: algorithmSnapshotFor(algorithm), visitId: visit.id, rawMs: 1234, createdAt: NOW + 100,
  })
  const data = appendTrainingAttempt({ ...createEmptyTrainingData(), visits: [visit], activeVisitId: visit.id }, attempt)
  const values = new Map<string, string>()
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, raw: string) => { values.set(key, raw) } }
  expect(saveTraining(data, null, storage).ok).toBe(true)
  const loaded = loadTraining(storage)
  if (!loaded.ok) throw Error(loaded.error)
  expect(loaded.data).toEqual(data)
  expect(loaded.data.attempts[0]!.preferredAlgorithmAtStart).toEqual(
    algorithmSnapshotFor(algorithm),
  )
  expect(loaded.data.attempts[0]!.attribution).toEqual({
    kind: 'assumed-preferred',
    algorithm: algorithmSnapshotFor(algorithm),
  })
  expect(loaded.data.customAlgorithms).toEqual([])
})
