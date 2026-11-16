// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  algorithmSnapshotFor,
  availableAlgorithm,
  availableAlgorithms,
  preferredAlgorithmSnapshot,
  resolvePreferredAlgorithm,
} from './algorithmSelection'
import { builtInAlgorithmForCase } from './catalog/defaultAlgorithms'
import { prepareTrainingSetup } from './runtime'
import { createEmptyTrainingData } from './storage'
import { beginTrainingSession } from './visits'
import type { TrainingCustomAlgorithm, TrainingData } from './types'

function customOll27(): TrainingCustomAlgorithm {
  return {
    id: 'oll:27:user:test',
    version: 1,
    setId: 'oll',
    caseId: 'oll:27',
    source: 'user',
    notation: "R U R' U R U2 R'",
    normalizedNotation: "R U R' U R U2 R'",
    label: 'My Sune',
    createdAt: 1,
    verification: {
      status: 'verified',
      method: 'cube-state',
      verifiedAt: '2026-11-10',
      frameNormalized: true,
      solvesCase: true,
      checkedAufs: [''],
    },
  }
}

function withPreference(
  data: TrainingData,
  caseId: TrainingData['preferences']['preferredAlgorithms'][number]['caseId'],
  algorithm: TrainingData['preferences']['preferredAlgorithms'][number]['algorithm'],
): TrainingData {
  return {
    ...data,
    preferences: {
      ...data.preferences,
      preferredAlgorithms: [{ caseId, algorithm }],
    },
  }
}

describe('built-in algorithm preference resolution', () => {
  it('prepares the captured case and revision after the enabled pool and preference change', async () => {
    const custom = customOll27()
    const capture = algorithmSnapshotFor(builtInAlgorithmForCase('oll:27')!)
    const initial = createEmptyTrainingData()
    const data = withPreference({ ...initial, customAlgorithms: [custom], preferences: {
      ...initial.preferences, sets: { ...initial.preferences.sets,
        oll: { ...initial.preferences.sets.oll, enabledCaseIds: ['oll:26'] },
      },
    } }, 'oll:27', algorithmSnapshotFor(custom))
    const active = beginTrainingSession(data, { id: 'session', at: 1000, categoryId: 'oll:execution',
      session: { version: 1, name: 'Fixed pool', cases: [{ caseId: 'oll:27', algorithm: capture }] } })
    expect(resolvePreferredAlgorithm(active, 'oll:27')?.snapshot.id).toBe(custom.id)
    const prepared = await prepareTrainingSetup(active, 'oll:execution', null)
    expect(prepared.generated.caseId).toBe('oll:27')
    expect(prepared.generatorAlgorithm).toEqual(capture)
  })

  it('uses the built-in default when the user has no stored preference', () => {
    const data = createEmptyTrainingData()
    const selected = resolvePreferredAlgorithm(data, 'oll:27')
    expect(selected?.source).toBe('built-in')
    expect(selected?.record.id).toBe('oll:27:alg:default-v1')
    expect(selected?.snapshot).toEqual({
      id: 'oll:27:alg:default-v1',
      revision: 1,
      notation: builtInAlgorithmForCase('oll:27')!.notation,
    })
    expect(preferredAlgorithmSnapshot(data, 'oll:27')).toEqual(
      selected?.snapshot,
    )
  })

  it('preserves an explicitly preferred custom algorithm', () => {
    const custom = customOll27()
    const data = withPreference(
      { ...createEmptyTrainingData(), customAlgorithms: [custom] },
      'oll:27',
      algorithmSnapshotFor(custom),
    )
    const selected = resolvePreferredAlgorithm(data, 'oll:27')
    expect(selected?.source).toBe('custom')
    expect(selected?.record.id).toBe(custom.id)
    expect(selected?.record.notation).toBe(custom.notation)
    expect(availableAlgorithm(data, 'oll:27')?.id).toBe(custom.id)

    const choices = availableAlgorithms(data, 'oll:27')
    expect(choices.map((choice) => choice.record.id)).toEqual([
      custom.id,
      'oll:27:alg:default-v1',
    ])
  })

  it('does not let an unselected custom algorithm replace the default preference', () => {
    const custom = customOll27()
    const data = { ...createEmptyTrainingData(), customAlgorithms: [custom] }
    expect(resolvePreferredAlgorithm(data, 'oll:27')?.source).toBe(
      'built-in',
    )
    expect(
      availableAlgorithms(data, 'oll:27').map(
        (choice) => choice.record.id,
      ),
    ).toEqual(['oll:27:alg:default-v1', custom.id])
  })

  it('preserves an explicitly stored built-in choice', () => {
    const builtIn = builtInAlgorithmForCase('pll:ua')!
    const custom = customOll27()
    const data = withPreference(
      { ...createEmptyTrainingData(), customAlgorithms: [custom] },
      'pll:ua',
      algorithmSnapshotFor(builtIn),
    )
    expect(resolvePreferredAlgorithm(data, 'pll:ua')?.record.id).toBe(
      builtIn.id,
    )
    expect(resolvePreferredAlgorithm(data, 'pll:ua')?.source).toBe(
      'built-in',
    )
  })

  it('falls back to the built-in default for an unknown stored reference', () => {
    const data = withPreference(createEmptyTrainingData(), 'oll:27', {
      id: 'missing',
      revision: 9,
      notation: null,
    })
    expect(resolvePreferredAlgorithm(data, 'oll:27')?.record.id).toBe(
      'oll:27:alg:default-v1',
    )
  })

  it('exposes every valid alternative while excluding unverified customs', () => {
    const verified = customOll27()
    const unverified: TrainingCustomAlgorithm = {
      ...customOll27(),
      id: 'oll:27:user:unverified',
      verification: null,
    }
    const data = {
      ...createEmptyTrainingData(),
      customAlgorithms: [verified, unverified],
    }
    const choices = availableAlgorithms(data, 'oll:27')
    expect(choices).toHaveLength(2)
    expect(choices.map((choice) => choice.record.id)).toEqual([
      'oll:27:alg:default-v1',
      verified.id,
    ])
  })
})
