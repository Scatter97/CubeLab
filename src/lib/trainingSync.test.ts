import { describe, expect, it } from 'vitest'
import { algorithmSnapshotFor } from './training/algorithmSelection'
import { builtInAlgorithmForCase } from './training/catalog/defaultAlgorithms'
import { calibration, NOW, setup } from './training/persistenceFixtures.test-support'
import {
  appendTrainingAttempt,
  createTrainingAttempt,
  finishTrainingVisit,
} from './training/records'
import { createEmptyTrainingData } from './training/storage'
import type {
  TrainingAttempt,
  TrainingData,
  TrainingPreset,
} from './training/types'
import { acknowledgeTrainingReport, beginTrainingSession } from './training/visits'
import {
  createTrainingSyncEnvelope,
  mergeTrainingData,
  parseTrainingSyncEnvelope,
  trainingSyncFingerprint,
} from './trainingSync'
import type { TrainingTombstone } from './trainingSyncStorage'

function history(input: {
  sessionId: string
  attemptId: string
  name: string
  at?: number
}): TrainingData {
  const at = input.at ?? NOW
  const caseId = 'oll:27'
  const algorithm = algorithmSnapshotFor(builtInAlgorithmForCase(caseId)!)
  const base = setup('oll', 'execution')
  const attemptSetup = {
    ...base,
    generatorAlgorithm: algorithm,
    generated: {
      ...base.generated,
      targetAlgorithmId: algorithm.id,
      targetAlgorithmNotation: algorithm.notation!,
    },
  }
  let data = beginTrainingSession(createEmptyTrainingData(), {
    id: input.sessionId,
    at,
    categoryId: 'oll:execution',
    session: {
      version: 1,
      name: input.name,
      cases: [{ caseId, algorithm }],
    },
  })
  data = appendTrainingAttempt(
    data,
    createTrainingAttempt({
      id: input.attemptId,
      setup: attemptSetup,
      visitId: input.sessionId,
      rawMs: 1_000,
      createdAt: at + 1_000,
    }),
  )
  data = finishTrainingVisit(data, input.sessionId, at + 2_000, 'manual')
  return acknowledgeTrainingReport(data, input.sessionId, 'session')
}

function trainingPenalty(attempt: TrainingAttempt): string {
  return attempt.result.status === 'valid' ? attempt.result.penalty : 'invalid'
}

function merge(
  local: TrainingData,
  remote: TrainingData,
  options: {
    localTombstones?: TrainingTombstone[]
    remoteTombstones?: TrainingTombstone[]
    localFieldUpdates?: Parameters<typeof mergeTrainingData>[0]['localFieldUpdates']
    remoteFieldUpdates?: Parameters<typeof mergeTrainingData>[0]['remoteFieldUpdates']
    resolvedConflicts?: Parameters<typeof mergeTrainingData>[0]['resolvedConflicts']
    manualConflictReview?: boolean
  } = {},
) {
  return mergeTrainingData({
    local,
    remote,
    localTombstones: options.localTombstones ?? [],
    remoteTombstones: options.remoteTombstones ?? [],
    localFieldUpdates: options.localFieldUpdates ?? {},
    remoteFieldUpdates: options.remoteFieldUpdates ?? {},
    resolvedConflicts: options.resolvedConflicts ?? [],
    deviceId: 'device-a',
    now: NOW + 10_000,
    manualConflictReview: options.manualConflictReview ?? false,
  })
}

function preset(updatedAt: number, name = 'Preset'): TrainingPreset {
  return {
    version: 1,
    id: 'preset-1',
    name,
    setId: 'oll',
    caseIds: ['oll:27'],
    includeSetupMoves: false,
    kind: 'user',
    createdAt: NOW,
    updatedAt,
  }
}


describe('Training merge', () => {
  it('unions attempts and visits added on two devices', () => {
    const local = history({ sessionId: 'a', attemptId: 'a-1', name: 'A' })
    const remote = history({
      sessionId: 'b',
      attemptId: 'b-1',
      name: 'B',
      at: NOW + 20_000,
    })
    const result = merge(local, remote)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.merged.attempts.map((attempt) => attempt.id).sort()).toEqual([
      'a-1',
      'b-1',
    ])
    expect(result.merged.visits.map((visit) => visit.id).sort()).toEqual([
      'a',
      'b',
    ])
    expect(result.pendingConflicts).toHaveLength(0)
  })

  it('deduplicates identical attempts and resolves corrections by timestamp', () => {
    const base = history({ sessionId: 'a', attemptId: 'a-1', name: 'A' })
    const identical = merge(base, structuredClone(base))
    expect(identical.ok).toBe(true)
    if (identical.ok) {
      expect(identical.merged.attempts).toHaveLength(1)
      expect(identical.conflicts).toHaveLength(0)
    }

    const attempt = base.attempts[0]!
    const correctedLocal: TrainingData = {
      ...base,
      attempts: [
        {
          ...attempt,
          result: { status: 'valid', penalty: 'dnf' },
          resultCorrectedAt: NOW + 5_000,
        },
      ],
    }
    const correctedRemote: TrainingData = {
      ...base,
      attempts: [
        {
          ...attempt,
          result: { status: 'valid', penalty: 'none' },
          resultCorrectedAt: NOW + 6_000,
        },
      ],
    }
    const result = merge(correctedLocal, correctedRemote)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.merged.attempts[0]!.resultCorrectedAt).toBe(NOW + 6_000)
    expect(trainingPenalty(result.merged.attempts[0]!)).toBe('none')
  })

  it('requires approval for an equal-time correction when manual review is on', () => {
    const base = history({ sessionId: 'a', attemptId: 'a-1', name: 'A' })
    const attempt = base.attempts[0]!
    const local: TrainingData = {
      ...base,
      attempts: [
        {
          ...attempt,
          result: { status: 'valid', penalty: 'dnf' },
          resultCorrectedAt: NOW + 5_000,
        },
      ],
    }
    const remote: TrainingData = {
      ...base,
      attempts: [
        {
          ...attempt,
          result: { status: 'valid', penalty: 'none' },
          resultCorrectedAt: NOW + 5_000,
        },
      ],
    }
    const pending = merge(local, remote, { manualConflictReview: true })
    expect(pending.ok).toBe(true)
    if (!pending.ok) return
    expect(pending.pendingConflicts).toHaveLength(1)
    expect(pending.conflicts[0]).toMatchObject({
      kind: 'attempt',
      field: 'correction',
      resolution: 'manual-pending',
    })
    expect(trainingPenalty(pending.merged.attempts[0]!)).toBe('dnf')
  })

  it('applies an exact prior approval instead of asking again', () => {
    const base = history({ sessionId: 'a', attemptId: 'a-1', name: 'A' })
    const attempt = base.attempts[0]!
    const localAttempt = {
      ...attempt,
      result: { status: 'valid' as const, penalty: 'dnf' as const },
      resultCorrectedAt: NOW + 5_000,
    }
    const remoteAttempt = {
      ...attempt,
      result: { status: 'valid' as const, penalty: 'none' as const },
      resultCorrectedAt: NOW + 5_000,
    }
    const local: TrainingData = { ...base, attempts: [localAttempt] }
    const remote: TrainingData = { ...base, attempts: [remoteAttempt] }
    const approval = {
      id: attempt.id,
      kind: 'attempt' as const,
      field: 'correction',
      localValue: localAttempt,
      remoteValue: remoteAttempt,
      localUpdatedAt: NOW + 5_000,
      remoteUpdatedAt: NOW + 5_000,
      resolution: 'remote' as const,
      updatedAt: NOW + 7_000,
    }
    const result = merge(local, remote, {
      manualConflictReview: true,
      resolvedConflicts: [approval],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.pendingConflicts).toHaveLength(0)
    expect(trainingPenalty(result.merged.attempts[0]!)).toBe('none')
  })


  it('applies an exact local approval and keeps this device value', () => {
    const base = history({ sessionId: 'a', attemptId: 'a-1', name: 'A' })
    const attempt = base.attempts[0]!
    const localAttempt = {
      ...attempt,
      result: { status: 'valid' as const, penalty: 'dnf' as const },
      resultCorrectedAt: NOW + 5_000,
    }
    const remoteAttempt = {
      ...attempt,
      result: { status: 'valid' as const, penalty: 'none' as const },
      resultCorrectedAt: NOW + 5_000,
    }
    const local: TrainingData = { ...base, attempts: [localAttempt] }
    const remote: TrainingData = { ...base, attempts: [remoteAttempt] }
    const approval = {
      id: attempt.id,
      kind: 'attempt' as const,
      field: 'correction',
      localValue: localAttempt,
      remoteValue: remoteAttempt,
      localUpdatedAt: NOW + 5_000,
      remoteUpdatedAt: NOW + 5_000,
      resolution: 'local' as const,
      updatedAt: NOW + 7_000,
    }
    const result = merge(local, remote, {
      manualConflictReview: true,
      resolvedConflicts: [approval],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.pendingConflicts).toHaveLength(0)
    expect(trainingPenalty(result.merged.attempts[0]!)).toBe('dnf')
  })

  it('keeps a deletion tombstone authoritative and lets Undo restore the row', () => {
    const withoutAttempt = history({ sessionId: 'a', attemptId: 'a-1', name: 'A' })
    const remote = structuredClone(withoutAttempt)
    const deleted: TrainingData = {
      ...withoutAttempt,
      attempts: [],
      visits: withoutAttempt.visits.map((visit) => ({
        ...visit,
        attemptIds: [],
      })),
    }
    const tombstone: TrainingTombstone = {
      kind: 'attempt',
      id: 'a-1',
      visitId: 'a',
      deletedAt: NOW + 5_000,
      deletedByDeviceId: 'device-a',
    }
    const merged = merge(deleted, remote, { localTombstones: [tombstone] })
    expect(merged.ok).toBe(true)
    if (!merged.ok) return
    expect(merged.merged.attempts).toHaveLength(0)
    expect(merged.merged.visits[0]!.attemptIds).toEqual([])

    const restored = merge(deleted, remote, {
      localTombstones: [{ ...tombstone, restoredAt: NOW + 6_000 }],
    })
    expect(restored.ok).toBe(true)
    if (!restored.ok) return
    expect(restored.merged.attempts.map((attempt) => attempt.id)).toEqual([
      'a-1',
    ])
    expect(restored.merged.visits[0]!.attemptIds).toEqual(['a-1'])
  })

  it('removes a visit and all of its attempts for a session tombstone', () => {
    const remote = history({ sessionId: 'a', attemptId: 'a-1', name: 'A' })
    const local: TrainingData = {
      ...createEmptyTrainingData(),
    }
    const merged = merge(local, remote, {
      localTombstones: [
        {
          kind: 'visit',
          id: 'a',
          attemptIds: ['a-1'],
          deletedAt: NOW + 5_000,
          deletedByDeviceId: 'device-a',
        },
      ],
    })
    expect(merged.ok).toBe(true)
    if (!merged.ok) return
    expect(merged.merged.visits).toHaveLength(0)
    expect(merged.merged.attempts).toHaveLength(0)
  })

  it('keeps report acknowledgement monotonic true to false', () => {
    const local = history({ sessionId: 'a', attemptId: 'a-1', name: 'A' })
    const remote = structuredClone(local)
    const pendingLocal: TrainingData = {
      ...local,
      visits: local.visits.map((visit) => ({
        ...visit,
        lifecycle: { ...visit.lifecycle!, reportPending: true },
      })),
    }
    const merged = merge(pendingLocal, remote)
    expect(merged.ok).toBe(true)
    if (!merged.ok) return
    expect(merged.merged.visits[0]!.lifecycle?.reportPending).toBe(false)
  })

  it('unions calibrations and conflicts on same-ID differences', () => {
    const base = createEmptyTrainingData()
    const localCalibration = calibration()
    const remoteCalibration = {
      ...calibration(),
      samplesMs: [500, 600, 700, 800, 900, 1000, 1100] as const,
      medianMs: 800,
    }
    const local: TrainingData = {
      ...base,
      calibrations: [localCalibration],
    }
    const remote: TrainingData = {
      ...createEmptyTrainingData(),
      calibrations: [
        { ...localCalibration, id: 'calibration-other' },
        remoteCalibration,
      ],
    }
    const result = merge(local, remote, { manualConflictReview: true })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.merged.calibrations.map((entry) => entry.id).sort()).toEqual([
      'calibration-oll',
      'calibration-other',
    ])
    expect(result.pendingConflicts.some((conflict) => conflict.kind === 'calibration')).toBe(true)
  })

  it('uses preset updatedAt and tombstone deletion', () => {
    const base = createEmptyTrainingData()
    const local = { ...base, presets: [preset(NOW + 1_000, 'Older')] }
    const remote = { ...base, presets: [preset(NOW + 2_000, 'Newer')] }
    const merged = merge(local, remote)
    expect(merged.ok).toBe(true)
    if (!merged.ok) return
    expect(merged.merged.presets[0]!.name).toBe('Newer')

    const deleted = merge(local, remote, {
      localTombstones: [
        {
          kind: 'preset',
          id: 'preset-1',
          deletedAt: NOW + 3_000,
          deletedByDeviceId: 'device-a',
        },
      ],
    })
    expect(deleted.ok).toBe(true)
    if (!deleted.ok) return
    expect(deleted.merged.presets).toHaveLength(0)
  })

  it('adopts remote preferences on a genuinely fresh device', () => {
    const local = createEmptyTrainingData()
    const remote = {
      ...createEmptyTrainingData(),
      preferences: {
        ...createEmptyTrainingData().preferences,
        selectedSetId: 'pll' as const,
      },
    }
    const result = mergeTrainingData({
      local,
      remote,
      localTombstones: [],
      remoteTombstones: [],
      localFieldUpdates: {},
      remoteFieldUpdates: {},
      resolvedConflicts: [],
      deviceId: 'fresh-device',
      now: NOW,
      manualConflictReview: true,
      localStoreAbsent: true,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.merged.preferences.selectedSetId).toBe('pll')
    expect(result.pendingConflicts).toHaveLength(0)
    expect(result.fieldUpdates.preferences).toMatchObject({
      updatedAt: NOW,
      editorId: 'fresh-device',
    })
  })

  it('preserves unknown additive fields through a merge', () => {
    const local = history({ sessionId: 'session', attemptId: 'attempt', name: 'Session' })
    const remote = history({ sessionId: 'session', attemptId: 'attempt', name: 'Session' })
    const localVisit = local.visits[0]!
    const remoteVisit = remote.visits[0]!
    const localWithUnknown = {
      ...local,
      recognitionCounts: { oll: 1, pll: 0, future: 7 },
      visits: [{ ...localVisit, futureVisitField: 'local' }],
    } as unknown as TrainingData
    const remoteWithUnknown = {
      ...remote,
      recognitionCounts: { oll: 1, pll: 0, futureRemote: 9 },
      visits: [{ ...remoteVisit, futureRemoteVisitField: 'remote' }],
      futureTopLevel: { enabled: true },
    } as unknown as TrainingData
    const result = mergeTrainingData({
      local: localWithUnknown,
      remote: remoteWithUnknown,
      localTombstones: [],
      remoteTombstones: [],
      localFieldUpdates: {},
      remoteFieldUpdates: {},
      resolvedConflicts: [],
      deviceId: 'device',
      now: NOW,
      manualConflictReview: false,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect((result.merged as unknown as Record<string, unknown>).futureTopLevel).toEqual({ enabled: true })
    expect(result.merged.recognitionCounts).toMatchObject({
      oll: 1,
      pll: 0,
      future: 7,
      futureRemote: 9,
    })
    expect(result.merged.visits[0]).toMatchObject({
      futureVisitField: 'local',
      futureRemoteVisitField: 'remote',
    })
  })

  it('resolves coarse preferences by timestamp and requires review on manual', () => {
    const local = history({ sessionId: 'a', attemptId: 'a-1', name: 'A' })
    const remote = history({ sessionId: 'b', attemptId: 'b-1', name: 'B', at: NOW + 20_000 })
    const localPrefs = { ...local.preferences, selectedSetId: 'oll' as const }
    const remotePrefs = { ...remote.preferences, selectedSetId: 'pll' as const }
    const localData = { ...local, preferences: localPrefs }
    const remoteData = { ...remote, preferences: remotePrefs }

    const automatic = merge(localData, remoteData, {
      localFieldUpdates: { preferences: { updatedAt: NOW + 1_000, editorId: 'a' } },
      remoteFieldUpdates: { preferences: { updatedAt: NOW + 2_000, editorId: 'b' } },
    })
    expect(automatic.ok).toBe(true)
    if (!automatic.ok) return
    expect(automatic.merged.preferences.selectedSetId).toBe('pll')

    const manual = merge(localData, remoteData, {
      localFieldUpdates: { preferences: { updatedAt: NOW + 2_000, editorId: 'a' } },
      remoteFieldUpdates: { preferences: { updatedAt: NOW + 2_000, editorId: 'b' } },
      manualConflictReview: true,
    })
    expect(manual.ok).toBe(true)
    if (!manual.ok) return
    expect(manual.pendingConflicts.some((conflict) => conflict.kind === 'preferences')).toBe(true)
    expect(manual.merged.preferences.selectedSetId).toBe('oll')
  })

  it('keeps recognition counts as a high-water maximum', () => {
    const local = history({ sessionId: 'a', attemptId: 'a-1', name: 'A' })
    const remote = history({ sessionId: 'b', attemptId: 'b-1', name: 'B', at: NOW + 20_000 })
    const result = merge(
      { ...local, recognitionCounts: { oll: 5, pll: 0 } },
      { ...remote, recognitionCounts: { oll: 9, pll: 2 } },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.merged.recognitionCounts).toEqual({ oll: 9, pll: 2 })
  })

  it('rejects an open remote visit or an invalid source store', () => {
    const base = createEmptyTrainingData()
    const open = {
      ...base,
      activeVisitId: 'open',
      visits: [
        {
          version: 1 as const,
          id: 'open',
          startedAt: NOW,
          endedAt: null,
          startedCategoryId: 'oll:execution' as const,
          categoryIds: ['oll:execution' as const],
          attemptIds: [],
          summaryId: null,
        },
      ],
    }
    const result = merge(base, open)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/open or unfinished/)

    const invalid = merge(base, { ...base, version: 2 } as unknown as TrainingData)
    expect(invalid.ok).toBe(false)
  })

  it('parses Phase 1 snapshots as a base with no sync metadata', () => {
    expect(parseTrainingSyncEnvelope(undefined)).toBeNull()
    const envelope = createTrainingSyncEnvelope({
      deviceId: 'device-a',
      revision: 3,
      tombstones: [],
      fieldUpdates: {},
      conflicts: [],
      updatedAt: NOW,
    })
    expect(parseTrainingSyncEnvelope(envelope)).toEqual(envelope)
    expect(
      parseTrainingSyncEnvelope({ ...envelope, version: 2 }),
    ).toBeNull()
  })


  it('merges conflicting legacy visits without inventing a lifecycle object', () => {
    const base = createEmptyTrainingData()
    const visit = {
      version: 1 as const,
      id: 'legacy',
      startedAt: NOW,
      endedAt: NOW + 1_000,
      startedCategoryId: 'oll:execution' as const,
      categoryIds: ['oll:execution' as const],
      attemptIds: [],
      summaryId: null,
    }
    const local: TrainingData = { ...base, visits: [visit] }
    const remote: TrainingData = {
      ...base,
      visits: [{ ...visit, endedAt: NOW + 2_000 }],
    }
    const result = merge(local, remote)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.merged.visits[0]!.endedAt).toBe(NOW + 2_000)
    expect('lifecycle' in result.merged.visits[0]!).toBe(false)
  })

  it('produces an order-independent fingerprint', () => {
    const local = history({ sessionId: 'a', attemptId: 'a-1', name: 'A' })
    const remote = history({ sessionId: 'b', attemptId: 'b-1', name: 'B', at: NOW + 20_000 })
    const first = merge(local, remote)
    const second = merge(remote, local)
    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    expect(
      trainingSyncFingerprint(first.merged, first.tombstones, first.fieldUpdates),
    ).toBe(
      trainingSyncFingerprint(second.merged, second.tombstones, second.fieldUpdates),
    )
  })
})
