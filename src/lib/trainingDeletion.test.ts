import { beforeEach, describe, expect, it } from 'vitest'
import { TrainingController } from './training/controller'
import { createEmptyTrainingData } from './training/storage'
import { closedTrainingHistory, NOW, setup } from './training/persistenceFixtures.test-support'
import {
  appendTrainingAttempt,
  createTrainingAttempt,
  createTrainingVisit,
  finishTrainingVisit,
} from './training/records'
import type { TrainingData } from './training/types'
import type { StorageLike } from './storage'
import {
  createTrainingDeletionLedger,
} from './trainingDeletion'
import { loadTrainingSyncStorage, resetTrainingDeviceIdCacheForTests } from './trainingSyncStorage'

class MemoryStorage implements StorageLike {
  constructor(private raw: string) {}
  fail = false
  getItem(): string | null {
    return this.raw
  }
  setItem(_key: string, value: string): void {
    if (this.fail) throw new Error('quota')
    this.raw = value
  }
  removeItem(): void {
    this.raw = ''
  }
}

function legacyHistory(): TrainingData {
  const visit = createTrainingVisit('oll:execution', NOW, 'legacy-visit')
  let data: TrainingData = {
    ...createEmptyTrainingData(),
    visits: [visit],
    activeVisitId: visit.id,
  }
  data = appendTrainingAttempt(
    data,
    createTrainingAttempt({
      id: 'legacy-attempt',
      setup: setup('oll', 'execution'),
      visitId: visit.id,
      rawMs: 1_000,
      createdAt: NOW + 1_000,
    }),
  )
  return finishTrainingVisit(data, visit.id, NOW + 2_000, 'navigation')
}

function presetData(): TrainingData {
  return {
    ...createEmptyTrainingData(),
    presets: [
      {
        version: 1,
        id: 'preset-1',
        name: 'Preset',
        setId: 'oll',
        caseIds: ['oll:27'],
        includeSetupMoves: false,
        kind: 'user',
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
  }
}

describe('Training deletion ledger integration', () => {
  beforeEach(() => {
    localStorage.clear()
    resetTrainingDeviceIdCacheForTests()
  })

  it('records an attempt tombstone before deletion and revokes it on Undo', () => {
    const storage = new MemoryStorage(JSON.stringify(legacyHistory()))
    const controller = new TrainingController({ storage })
    let token: Parameters<TrainingController['undoDeleteAttempt']>[0] | null = null
    expect(
      controller.deleteAttempt('legacy-attempt', (deleted) => {
        token = deleted
      }),
    ).toBe(true)
    const active = loadTrainingSyncStorage().runtime.tombstones
    expect(active).toHaveLength(1)
    expect(active[0]).toMatchObject({
      kind: 'attempt',
      id: 'legacy-attempt',
      visitId: 'legacy-visit',
    })
    expect(active[0]!.restoredAt).toBeUndefined()

    expect(controller.undoDeleteAttempt(token!)).toBe(true)
    const restored = loadTrainingSyncStorage().runtime.tombstones
    expect(restored[0]!.restoredAt).toBeGreaterThan(restored[0]!.deletedAt)
  })

  it('records the archived session and all of its attempt IDs', () => {
    const data = closedTrainingHistory()
    const controller = new TrainingController({
      storage: new MemoryStorage(JSON.stringify(data)),
    })
    expect(controller.deleteArchivedSession('fixture-session')).toBe(true)
    const tombstones = loadTrainingSyncStorage().runtime.tombstones
    expect(
      tombstones.find((tombstone) => tombstone.kind === 'visit'),
    ).toMatchObject({
      id: 'fixture-session',
      attemptIds: ['fixture-attempt'],
    })
    expect(
      tombstones.some(
        (tombstone) =>
          tombstone.kind === 'attempt' && tombstone.id === 'fixture-attempt',
      ),
    ).toBe(true)
  })

  it('records preset deletion and revokes it when the local write fails', () => {
    const storage = new MemoryStorage(JSON.stringify(presetData()))
    const controller = new TrainingController({ storage })
    storage.fail = true
    controller.deletePreset('preset-1')
    const tombstones = loadTrainingSyncStorage().runtime.tombstones
    expect(tombstones[0]).toMatchObject({ kind: 'preset', id: 'preset-1' })
    expect(tombstones[0]!.restoredAt).toBeGreaterThan(
      tombstones[0]!.deletedAt,
    )

    storage.fail = false
    controller.retrySave()
    expect(loadTrainingSyncStorage().runtime.tombstones[0]!.restoredAt).toBeUndefined()
    const saved = JSON.parse(storage.getItem()!) as TrainingData
    expect(saved.presets).toHaveLength(0)
  })

  it('writes an archived-session deletion as one atomic ledger update', () => {
    const ledgerStorage = new MemoryStorage('')
    const controller = new TrainingController({
      storage: new MemoryStorage(JSON.stringify(closedTrainingHistory())),
      deletionLedger: createTrainingDeletionLedger(ledgerStorage),
    })
    expect(controller.deleteArchivedSession('fixture-session')).toBe(true)
    const tombstones = loadTrainingSyncStorage(ledgerStorage).runtime.tombstones
    expect(tombstones).toHaveLength(2)
    expect(tombstones).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'visit', id: 'fixture-session' }),
        expect.objectContaining({ kind: 'attempt', id: 'fixture-attempt' }),
      ]),
    )
  })

  it('leaves no visit tombstone behind when the batch ledger write fails', () => {
    const ledgerStorage = new MemoryStorage('')
    ledgerStorage.fail = true
    const controller = new TrainingController({
      storage: new MemoryStorage(JSON.stringify(closedTrainingHistory())),
      deletionLedger: createTrainingDeletionLedger(ledgerStorage),
    })
    expect(controller.deleteArchivedSession('fixture-session')).toBe(false)
    expect(
      loadTrainingSyncStorage(ledgerStorage).runtime.tombstones,
    ).toEqual([])
    expect(
      controller.getSnapshot().data?.visits.some(
        (visit) => visit.id === 'fixture-session',
      ),
    ).toBe(true)
  })

  it('revokes a new attempt tombstone when the Training write fails', () => {
    const storage = new MemoryStorage(JSON.stringify(legacyHistory()))
    const controller = new TrainingController({ storage })
    storage.fail = true
    expect(controller.deleteAttempt('legacy-attempt')).toBe(false)
    const tombstones = loadTrainingSyncStorage().runtime.tombstones
    expect(tombstones[0]!.restoredAt).toBeGreaterThan(
      tombstones[0]!.deletedAt,
    )
    expect(JSON.parse(storage.getItem()!).attempts).toHaveLength(1)
  })
})
