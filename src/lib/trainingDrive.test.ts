import { beforeEach, describe, expect, it } from 'vitest'
import {
  createMemoryDriveTransport,
  deviceSnapshotFileName,
  isDriveBackupFileName,
  isDriveTrainingFileName,
  trainingSnapshotFileName,
  fetchDriveTrainingFiles,
  type DrivePageResponse,
} from './driveTransport'
import { closedTrainingHistory } from './training/persistenceFixtures.test-support'
import {
  MAX_TRAINING_DRIVE_BYTES,
  cleanupOwnTrainingRemoteBackups,
  createTrainingDriveBackup,
  parseTrainingDriveBackup,
  serializeTrainingDriveBackup,
  summarizeTrainingDriveBackup,
  trainingDriveBytes,
} from './trainingDrive'

describe('Training Drive file family', () => {
  it('accepts only Training snapshots and never solve files', () => {
    const training = trainingSnapshotFileName('device a')
    expect(training).toMatch(/^cubelab-training-device-a-[A-Za-z0-9-]+\.json$/)
    expect(isDriveTrainingFileName(training)).toBe(true)
    expect(isDriveTrainingFileName(deviceSnapshotFileName('device-a'))).toBe(false)
    expect(isDriveTrainingFileName('cubelab-backup.json')).toBe(false)
    expect(isDriveTrainingFileName('cubelab-backup-device-a.json')).toBe(false)
    expect(isDriveBackupFileName(training)).toBe(false)
    expect(isDriveTrainingFileName('notes.json')).toBe(false)
  })

  it('filters paginated Drive listings in both directions', async () => {
    const page = (files: unknown[]): DrivePageResponse => ({
      ok: true,
      status: 200,
      async json() {
        return { files }
      },
    })
    const files = await fetchDriveTrainingFiles(async () =>
      page([
        {
          id: 'training',
          name: trainingSnapshotFileName('device-a'),
          modifiedTime: '2026-01-02T00:00:00.000Z',
        },
        {
          id: 'solve',
          name: deviceSnapshotFileName('device-a'),
          modifiedTime: '2026-01-03T00:00:00.000Z',
        },
      ]),
    )
    expect(files.map((file) => file.id)).toEqual(['training'])
  })
})

describe('Training Drive envelope', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('round trips the complete checked Training store compactly', () => {
    const data = closedTrainingHistory()
    const backup = createTrainingDriveBackup(data, 'device-a', 1_800_000_000_000)
    const serialized = serializeTrainingDriveBackup(backup)
    expect(serialized.ok).toBe(true)
    if (!serialized.ok) return
    expect(serialized.raw).not.toContain('\n')
    const parsed = parseTrainingDriveBackup(serialized.raw)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.backup.training.data.attempts).toEqual(data.attempts)
    expect(parsed.backup.training.data.visits).toEqual(data.visits)
    expect(summarizeTrainingDriveBackup(parsed.backup)).toMatchObject({
      attempts: 1,
      sessions: 1,
      calibrations: 1,
    })
  })

  it('rejects wrong app, format, version, malformed JSON and invalid stores', () => {
    const backup = createTrainingDriveBackup(
      closedTrainingHistory(),
      'device-a',
    )
    const base = JSON.parse(JSON.stringify(backup)) as Record<string, unknown>
    expect(
      parseTrainingDriveBackup(JSON.stringify({ ...base, app: 'Other' })).ok,
    ).toBe(false)
    expect(
      parseTrainingDriveBackup(JSON.stringify({ ...base, format: 'other' })).ok,
    ).toBe(false)
    expect(
      parseTrainingDriveBackup(JSON.stringify({ ...base, version: 2 })).ok,
    ).toBe(false)
    expect(parseTrainingDriveBackup('{not json').ok).toBe(false)
    expect(
      parseTrainingDriveBackup(
        JSON.stringify({
          ...base,
          training: { version: 1, data: { version: 1 } },
        }),
      ).ok,
    ).toBe(false)
  })

  it('rejects an unfinished visit instead of resuming it', () => {
    const data = closedTrainingHistory()
    const open = {
      ...data,
      activeVisitId: data.visits[0]!.id,
      visits: data.visits.map((visit) => ({ ...visit, endedAt: null })),
    }
    const backup = createTrainingDriveBackup(
      closedTrainingHistory(),
      'device-a',
    )
    const raw = JSON.stringify({
      ...backup,
      training: { version: 1, data: open },
    })
    expect(parseTrainingDriveBackup(raw).ok).toBe(false)
  })

  it('rejects oversized input before parsing and from serialization', () => {
    const oversized = 'x'.repeat(MAX_TRAINING_DRIVE_BYTES + 1)
    expect(trainingDriveBytes(oversized)).toBeGreaterThan(
      MAX_TRAINING_DRIVE_BYTES,
    )
    expect(parseTrainingDriveBackup(oversized)).toMatchObject({
      ok: false,
      error: expect.stringContaining('exceeds'),
    })

    const backup = createTrainingDriveBackup(
      closedTrainingHistory(),
      'device-a',
    )
    const huge = {
      ...backup,
      sync: { padding: oversized },
    }
    const serialized = serializeTrainingDriveBackup(huge)
    expect(serialized.ok).toBe(false)
    if (!serialized.ok) {
      expect(serialized.error).toContain('limit')
    }
  })
})

describe('Training Drive transport and cleanup', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('uploads a new immutable Training file for every write', async () => {
    const transport = createMemoryDriveTransport()
    await transport.connect()
    const content = serializeTrainingDriveBackup(
      createTrainingDriveBackup(closedTrainingHistory(), 'device-a'),
    )
    expect(content.ok).toBe(true)
    if (!content.ok) return
    const first = await transport.uploadTrainingBackup!(content.raw, 'device-a')
    const second = await transport.uploadTrainingBackup!(content.raw, 'device-a')
    expect(first.id).not.toBe(second.id)
    expect(first.name).not.toBe(second.name)
    const files = await transport.listTrainingBackups!()
    expect(files).toHaveLength(2)
    expect(await transport.downloadBackup(first.id)).toBe(content.raw)
    expect(await transport.listBackups!()).toHaveLength(0)
  })

  it('retains the newest own Training files and tolerates delete failures', async () => {
    const memory = createMemoryDriveTransport()
    await memory.connect()
    for (let index = 0; index < 7; index += 1) {
      const content = serializeTrainingDriveBackup(
        createTrainingDriveBackup(closedTrainingHistory(), 'device-a'),
      )
      if (!content.ok) throw new Error(content.error)
      await memory.uploadTrainingBackup!(content.raw, 'device-a')
    }
    const other = serializeTrainingDriveBackup(
      createTrainingDriveBackup(closedTrainingHistory(), 'other-device'),
    )
    if (!other.ok) throw new Error(other.error)
    await memory.uploadTrainingBackup!(other.raw, 'other-device')

    const files = await memory.listTrainingBackups!()
    expect(files).toHaveLength(8)
    const own = files.filter((file) => file.appProperties?.deviceId === 'device-a')
    expect(own).toHaveLength(7)
    const tolerant = {
      ...memory,
      deleteBackup: async (fileId: string) => {
        if (fileId === own[6]!.id) throw new Error('delete failed')
        return memory.deleteBackup(fileId)
      },
    }
    const result = await cleanupOwnTrainingRemoteBackups(
      tolerant,
      files,
      'device-a',
      5,
    )
    expect(result.deleted).toBe(1)
    expect(result.failures).toHaveLength(1)
    const remaining = await memory.listTrainingBackups!()
    // Five newest own files plus the untouched other-device file, minus the
    // one successful deletion of an old own file.
    expect(remaining).toHaveLength(7)
    expect(
      remaining.some(
        (file) => file.appProperties?.deviceId === 'other-device',
      ),
    ).toBe(true)
  })
})
