import { describe, expect, it } from 'vitest'
import { createMemoryDriveTransport } from './driveTransport'
import { createTrainingAttempt } from './training/records'
import { createEmptyTrainingData } from './training/storage'
import type { TrainingData } from './training/types'
import { NOW, setup } from './training/persistenceFixtures.test-support'
import { TrainingController } from './training/controller'
import { stageTrainingSnapshot } from './training/storage'
import type { StorageLike } from './storage'
import {
  createTrainingDriveBackup,
  parseTrainingDriveBackup,
  serializeTrainingDriveBackup,
  MAX_TRAINING_DRIVE_BYTES,
} from './trainingDrive'
import {
  mergeTrainingData,
  trainingSyncFingerprint,
} from './trainingSync'

const ATTEMPTS = 8_000

class MemoryStorage implements StorageLike {
  constructor(private raw: string | null = null) {}
  getItem(): string | null {
    return this.raw
  }
  setItem(_key: string, value: string): void {
    this.raw = value
  }
  removeItem(): void {
    this.raw = null
  }
}

function largeHistory(): TrainingData {
  const base = createEmptyTrainingData()
  const template = createTrainingAttempt({
    id: 'attempt-0',
    visitId: 'large-visit',
    setup: setup('oll', 'execution'),
    rawMs: 1_234,
    createdAt: NOW,
  })
  const attempts = Array.from({ length: ATTEMPTS }, (_, index) => ({
    ...template,
    id: `attempt-${index}`,
    createdAt: NOW + index,
  }))
  return {
    ...base,
    attempts,
    visits: [
      {
        version: 1,
        id: 'large-visit',
        startedAt: NOW,
        endedAt: NOW + ATTEMPTS + 10,
        startedCategoryId: 'oll:execution',
        categoryIds: ['oll:execution'],
        attemptIds: attempts.map((attempt) => attempt.id),
        summaryId: null,
      },
    ],
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]!
}

function summary(values: number[]): { median: number; min: number; max: number } {
  return {
    median: Math.round(median(values) * 100) / 100,
    min: Math.round(Math.min(...values) * 100) / 100,
    max: Math.round(Math.max(...values) * 100) / 100,
  }
}

describe('Training sync performance', () => {
  it('measures the 8,000-attempt upload, download, merge and adoption path', async () => {
    const local = largeHistory()
    const remote: TrainingData = {
      ...local,
      attempts: [
        ...local.attempts,
        {
          ...local.attempts[0]!,
          id: 'remote-extra',
          createdAt: NOW + ATTEMPTS,
        },
      ],
      visits: local.visits.map((visit) => ({
        ...visit,
        attemptIds: [...visit.attemptIds, 'remote-extra'],
      })),
    }
    const rounds = 5
    const mergeTimes: number[] = []
    const fingerprintTimes: number[] = []
    const serializeTimes: number[] = []
    const parseTimes: number[] = []
    const adoptionTimes: number[] = []
    const uploadTimes: number[] = []
    const downloadTimes: number[] = []
    const transport = createMemoryDriveTransport()
    await transport.connect()
    let merged: TrainingData | null = null
    let size = 0

    for (let round = 0; round < rounds; round += 1) {
      const mergeStart = performance.now()
      const result = mergeTrainingData({
        local,
        remote,
        localTombstones: [],
        remoteTombstones: [],
        localFieldUpdates: {},
        remoteFieldUpdates: {},
        resolvedConflicts: [],
        deviceId: 'perf-device',
        now: NOW + 1_000_000,
        manualConflictReview: false,
      })
      mergeTimes.push(performance.now() - mergeStart)
      if (!result.ok) console.log('MERGE_ERROR', result.error)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      merged = result.merged
      expect(result.merged.attempts).toHaveLength(ATTEMPTS + 1)

      const fingerprintStart = performance.now()
      trainingSyncFingerprint(result.merged, result.tombstones, result.fieldUpdates)
      fingerprintTimes.push(performance.now() - fingerprintStart)

      const serializeStart = performance.now()
      const backup = createTrainingDriveBackup(result.merged, 'perf-device', NOW)
      const serialized = serializeTrainingDriveBackup(backup)
      serializeTimes.push(performance.now() - serializeStart)
      expect(serialized.ok).toBe(true)
      if (!serialized.ok) return
      size = serialized.raw.length
      const uploadStart = performance.now()
      const uploaded = await transport.uploadTrainingBackup!(
        serialized.raw,
        `perf-device-${round}`,
      )
      uploadTimes.push(performance.now() - uploadStart)
      const downloadStart = performance.now()
      const downloaded = await transport.downloadBackup(uploaded.id)
      downloadTimes.push(performance.now() - downloadStart)
      expect(downloaded.length).toBe(serialized.raw.length)
      expect(new TextEncoder().encode(serialized.raw).byteLength).toBeLessThan(
        MAX_TRAINING_DRIVE_BYTES,
      )

      const parseStart = performance.now()
      const parsed = parseTrainingDriveBackup(serialized.raw)
      parseTimes.push(performance.now() - parseStart)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) return
      expect(parsed.backup.training.data.attempts).toHaveLength(ATTEMPTS + 1)

      const adoptionStart = performance.now()
      const storage = new MemoryStorage()
      const staged = stageTrainingSnapshot(result.merged, storage)
      expect(staged.ok).toBe(true)
      if (!staged.ok) return
      const controller = new TrainingController({ storage })
      expect(controller.adoptSavedTraining(result.merged, staged.raw)).toBe(true)
      adoptionTimes.push(performance.now() - adoptionStart)
    }

    const measurements = {
      attempts: ATTEMPTS + 1,
      compactBytes: size,
      mergeMs: summary(mergeTimes),
      fingerprintMs: summary(fingerprintTimes),
      serializeMs: summary(serializeTimes),
      parseMs: summary(parseTimes),
      stageAndAdoptMs: summary(adoptionTimes),
      uploadMs: summary(uploadTimes),
      downloadMs: summary(downloadTimes),
    }
    console.log('TRAINING_SYNC_PERF', JSON.stringify(measurements))
    expect(merged).not.toBeNull()
    expect(measurements.compactBytes).toBeLessThan(16 * 1024 * 1024)
    // Generous Node/jsdom guard, not a browser or physical-device threshold.
    expect(measurements.mergeMs.max).toBeLessThan(5_000)
  }, 120_000)
})
