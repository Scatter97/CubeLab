// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  prepareTrainingSetup,
  verifyCustomAlgorithm,
  algorithmSnapshot,
} from './runtime'
import { createEmptyTrainingData } from './storage'
import {
  applyAlgorithm,
  isF2lSolved,
  loadCube3Model,
  isFixedOllPreInsertionState,
} from './cube3'
import { assertCaseState } from './caseState'
import { STANDARD_CASE_BY_ID } from './catalog/standardCases'
import { builtInAlgorithmForCase } from './catalog/defaultAlgorithms'
import { availableAlgorithm } from './algorithmSelection'
import type { TrainingData } from './types'

function enableOnly(data: TrainingData, setId: 'oll' | 'pll', ids: string[]): TrainingData {
  return {
    ...data,
    preferences: {
      ...data.preferences,
      sets: {
        ...data.preferences.sets,
        [setId]: {
          ...data.preferences.sets[setId],
          enabledCaseIds: ids as TrainingData['preferences']['sets'][typeof setId]['enabledCaseIds'],
        },
      },
    },
  }
}

describe('built-in and user algorithm runtime', () => {
  it.each(['oll', 'pll'] as const)(
    'generates a verified %s setup from the built-in default without writing it to user data',
    async (set) => {
      const id = set === 'oll' ? 'oll:27' : 'pll:ua'
      const otherId = set === 'oll' ? 'oll:26' : 'pll:ub'
      const data = enableOnly(createEmptyTrainingData(), set, [id, otherId])
      expect(data.customAlgorithms).toEqual([])
      expect(data.preferences.preferredAlgorithms).toEqual([])

      const defaultAlgorithm = builtInAlgorithmForCase(id)!
      expect(availableAlgorithm(data, id)?.id).toBe(defaultAlgorithm.id)

      const execution = await prepareTrainingSetup(
        data,
        `${set}:execution`,
        null,
        id,
      )
      expect(execution.generated.caseId).toBe(id)
      expect(execution.generated.targetAlgorithmId).toBe(
        defaultAlgorithm.id,
      )
      expect(execution.generatorAlgorithm).toEqual(
        algorithmSnapshotForRecord(defaultAlgorithm),
      )
      expect(execution.generated.targetHidden).toBe(false)
      expect(
        isF2lSolved(
          applyAlgorithm(
            (await loadCube3Model()).solved,
            execution.generated.scramble,
          ),
        ),
      ).toBe(true)
      assertCaseState(
        applyAlgorithm(
          (await loadCube3Model()).solved,
          execution.generated.scramble,
        ),
        STANDARD_CASE_BY_ID.get(id)!,
      )

      const recognition = await prepareTrainingSetup(
        data,
        `${set}:recognition`,
        null,
        id,
      )
      expect(recognition.generated.caseId).toBe(id)
      expect(recognition.generated.targetHidden).toBe(true)
      expect(recognition.generated.precursor).not.toBeNull()
      expect(recognition.generatorAlgorithm.id).toBe(defaultAlgorithm.id)
      expect(data.customAlgorithms).toEqual([])
    },
  )

  it('uses an explicitly preferred custom algorithm over the built-in default', async () => {
    const id = 'oll:27'
    const custom = await verifyCustomAlgorithm(
      id,
      "R U R' U R U2 R'",
    )
    let data = enableOnly(createEmptyTrainingData(), 'oll', [id])
    data = {
      ...data,
      customAlgorithms: [custom],
      preferences: {
        ...data.preferences,
        preferredAlgorithms: [
          { caseId: id, algorithm: algorithmSnapshot(custom) },
        ],
      },
    }
    const execution = await prepareTrainingSetup(
      data,
      'oll:execution',
      null,
    )
    expect(execution.generated.caseId).toBe(id)
    expect(execution.generated.targetAlgorithmId).toBe(custom.id)
    expect(execution.generatorAlgorithm.id).toBe(custom.id)
    expect(execution.generatorVersion).toBe('verified-user-algorithm:v2')

    const revision = await verifyCustomAlgorithm(
      id,
      "R U R' U R U2 R'",
      custom,
    )
    expect(revision.version).toBe(2)
    expect(revision.replacesAlgorithmId).toBe(custom.id)
    expect(revision.id).not.toBe(custom.id)
  })

  it('allows a custom algorithm to replace the built-in default as a new revision', async () => {
    const id = 'pll:ua' as const
    const builtIn = builtInAlgorithmForCase(id)!
    const custom = await verifyCustomAlgorithm(
      id,
      "M2 U M U2 M' U M2",
      builtIn,
    )
    expect(custom.version).toBe(2)
    expect(custom.replacesAlgorithmId).toBe(builtIn.id)
    const base = enableOnly(createEmptyTrainingData(), 'pll', [id])
    const data = {
      ...base,
      customAlgorithms: [custom],
      preferences: {
        ...base.preferences,
        preferredAlgorithms: [
          { caseId: id, algorithm: algorithmSnapshot(custom) },
        ],
      },
    }
    const execution = await prepareTrainingSetup(
      data,
      'pll:execution',
      null,
    )
    expect(execution.generated.targetAlgorithmId).toBe(custom.id)
  })

  it('does not substitute a different case for bad notation or an exhausted pool', async () => {
    await expect(verifyCustomAlgorithm('oll:27', 'R')).rejects.toThrow()
    const empty = enableOnly(createEmptyTrainingData(), 'oll', [])
    await expect(
      prepareTrainingSetup(empty, 'oll:execution', null),
    ).rejects.toThrow(/Enable at least one case/)
    await expect(
      prepareTrainingSetup(empty, 'oll:recognition', null),
    ).rejects.toThrow(/two enabled cases/)
    const one = enableOnly(createEmptyTrainingData(), 'oll', ['oll:27'])
    await expect(
      prepareTrainingSetup(one, 'oll:recognition', null),
    ).rejects.toThrow(/two enabled cases/)
    await expect(
      prepareTrainingSetup(one, 'oll:execution', null, 'oll:28'),
    ).rejects.toThrow(/disabled or has no verified algorithm/)
  })

  it('varies only within the enabled verified pool and avoids an immediate repeat', async () => {
    const data = enableOnly(createEmptyTrainingData(), 'pll', [
      'pll:ua',
      'pll:ub',
    ])
    const model = await loadCube3Model()
    let previous: string | null = null
    for (let i = 0; i < 8; i += 1) {
      const setup = await prepareTrainingSetup(
        data,
        'pll:recognition',
        previous,
      )
      expect(setup.generated.caseId).not.toBe(previous)
      expect(['pll:ua', 'pll:ub']).toContain(setup.generated.caseId)
      const pre = applyAlgorithm(model.solved, setup.generated.scramble)
      expect(isF2lSolved(pre)).toBe(true)
      assertCaseState(
        applyAlgorithm(pre, setup.generated.precursor!),
        STANDARD_CASE_BY_ID.get(setup.generated.caseId)!,
      )
      expect(setup.generated.targetHidden).toBe(true)
      expect(setup.generatorAlgorithm.id).toMatch(/:alg:default-v1$/)
      previous = setup.generated.caseId
    }

    const oll = await prepareTrainingSetup(
      enableOnly(createEmptyTrainingData(), 'oll', ['oll:27', 'oll:26']),
      'oll:recognition',
      null,
    )
    const pre = applyAlgorithm(model.solved, oll.generated.scramble)
    expect(isFixedOllPreInsertionState(pre)).toBe(true)
    assertCaseState(
      applyAlgorithm(pre, oll.generated.precursor!),
      STANDARD_CASE_BY_ID.get(oll.generated.caseId)!,
    )
  })
})

function algorithmSnapshotForRecord(algorithm: {
  id: string
  version: number
  notation: string
}) {
  return {
    id: algorithm.id,
    revision: algorithm.version,
    notation: algorithm.notation,
  }
}
