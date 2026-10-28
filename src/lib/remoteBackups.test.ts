import { describe, expect, it } from 'vitest'
import type { Session, SessionsData, Solve } from '../types'
import { createBackup, MAX_BACKUP_BYTES } from './backup'
import {
  createMemoryDriveTransport,
  type DriveFile,
  type DriveTransport,
} from './driveTransport'
import {
  deleteAllRemoteBackups,
  listRemoteBackups,
  mergeRemoteBackupSnapshots,
  readRemoteBackups,
} from './remoteBackups'
import { createSyncEnvelope } from './sync'
import { DEFAULT_SETTINGS } from './storage'

function solve(overrides: Partial<Solve> = {}): Solve {
  return {
    id: 'solve-1',
    event: '333',
    rawMs: 12_340,
    penalty: 'none',
    scramble: "R U R' U'",
    comment: '',
    createdAt: 1_700_000_000_000,
    ...overrides,
  }
}

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    name: 'Session 1',
    event: '333',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    solves: [],
    ...overrides,
  }
}

function sessionsData(overrides: Partial<SessionsData> = {}): SessionsData {
  return {
    activeSessionId: 'session-1',
    sessions: [session()],
    ...overrides,
  }
}

describe('remote backup snapshots', () => {
  it('reads and orders every device snapshot by envelope time', async () => {
    const transport = createMemoryDriveTransport()
    await transport.connect()

    const older = createBackup(
      sessionsData({ sessions: [session({ solves: [solve({ id: 'older' })] })] }),
      DEFAULT_SETTINGS,
      new Date('2026-01-01T00:00:00.000Z'),
      {
        ...createSyncEnvelope('device-a', 1, [], []),
        updatedAt: 100,
      },
    )
    const newer = createBackup(
      sessionsData({ sessions: [session({ solves: [solve({ id: 'newer' })] })] }),
      DEFAULT_SETTINGS,
      new Date('2026-01-02T00:00:00.000Z'),
      {
        ...createSyncEnvelope('device-b', 1, [], []),
        updatedAt: 200,
      },
    )

    await transport.uploadDeviceBackup!(JSON.stringify(newer), 'device-b')
    await transport.uploadDeviceBackup!(JSON.stringify(older), 'device-a')

    const files = await listRemoteBackups(transport)
    expect(files).toHaveLength(2)
    const snapshots = await readRemoteBackups(transport, files)
    expect(snapshots.map((snapshot) => snapshot.backup.sync?.deviceId)).toEqual([
      'device-a',
      'device-b',
    ])
    const snapshotsForB = snapshots.filter(
      (snapshot) => snapshot.backup.sync?.deviceId === 'device-b',
    )
    expect(snapshotsForB).toHaveLength(1)
    expect(snapshotsForB[0]!.file.name.startsWith('cubelab-backup-device-b-')).toBe(
      true,
    )
  })

  it('merges solves and newest settings across snapshots', async () => {
    const transport = createMemoryDriveTransport()
    await transport.connect()

    const a = createBackup(
      sessionsData({ sessions: [session({ solves: [solve({ id: 'A' })] })] }),
      { ...DEFAULT_SETTINGS, accentColor: 'blue' },
      new Date('2026-01-01T00:00:00.000Z'),
      {
        ...createSyncEnvelope('device-a', 1, [], [], [], {
          accentColor: { updatedAt: 100, editorId: 'device-a' },
        }),
        updatedAt: 100,
      },
    )
    const b = createBackup(
      sessionsData({ sessions: [session({ solves: [solve({ id: 'B' })] })] }),
      { ...DEFAULT_SETTINGS, accentColor: 'amber' },
      new Date('2026-01-02T00:00:00.000Z'),
      {
        ...createSyncEnvelope('device-b', 1, [], [], [], {
          accentColor: { updatedAt: 200, editorId: 'device-b' },
        }),
        updatedAt: 200,
      },
    )
    await transport.uploadDeviceBackup!(JSON.stringify(a), 'device-a')
    await transport.uploadDeviceBackup!(JSON.stringify(b), 'device-b')

    const merged = mergeRemoteBackupSnapshots(await readRemoteBackups(transport))
    expect(
      merged.sessions.sessions.flatMap((item) => item.solves.map((item) => item.id)).sort(),
    ).toEqual(['A', 'B'])
    expect(merged.settings.accentColor).toBe('amber')
  })

  it('applies tombstones while merging snapshots', async () => {
    const transport = createMemoryDriveTransport()
    await transport.connect()
    const tombstone = {
      kind: 'solve' as const,
      id: 'A',
      deletedAt: 300,
      deletedByDeviceId: 'device-b',
    }
    const a = createBackup(
      sessionsData({
        sessions: [session({ solves: [solve({ id: 'A' }), solve({ id: 'C' })] })],
      }),
      DEFAULT_SETTINGS,
      new Date('2026-01-01T00:00:00.000Z'),
      {
        ...createSyncEnvelope('device-a', 1, [], []),
        updatedAt: 100,
      },
    )
    const b = createBackup(
      sessionsData({ sessions: [session({ solves: [solve({ id: 'B' })] })] }),
      DEFAULT_SETTINGS,
      new Date('2026-01-02T00:00:00.000Z'),
      {
        ...createSyncEnvelope('device-b', 2, [tombstone], []),
        updatedAt: 200,
      },
    )
    await transport.uploadDeviceBackup!(JSON.stringify(a), 'device-a')
    await transport.uploadDeviceBackup!(JSON.stringify(b), 'device-b')

    const merged = mergeRemoteBackupSnapshots(await readRemoteBackups(transport))
    expect(
      merged.sessions.sessions.flatMap((item) => item.solves.map((item) => item.id)).sort(),
    ).toEqual(['B', 'C'])
  })

  it('deletes every snapshot, including the legacy file', async () => {
    const transport = createMemoryDriveTransport()
    await transport.connect()
    await transport.uploadDeviceBackup!(
      JSON.stringify(createBackup(sessionsData(), DEFAULT_SETTINGS)),
      'device-a',
    )
    await transport.uploadBackup(
      JSON.stringify(createBackup(sessionsData(), DEFAULT_SETTINGS)),
      null,
    )

    await expect(deleteAllRemoteBackups(transport)).resolves.toBe(2)
    await expect(transport.listBackups!()).resolves.toHaveLength(0)
  })

  it('rejects an invalid snapshot before merging', async () => {
    const transport = createMemoryDriveTransport()
    await transport.connect()
    await transport.uploadBackup('{not valid json', null)
    await expect(readRemoteBackups(transport)).rejects.toThrow(/valid JSON/)
  })

  it('rejects oversized and failed-delete snapshots', async () => {
    const oversized: DriveFile = {
      id: 'big',
      name: 'cubelab-backup-big.json',
      modifiedTime: null,
    }
    const bigTransport: DriveTransport = {
      configured: true,
      accountLabel: null,
      connect: async () => {},
      disconnect: () => {},
      isConnected: () => true,
      findBackup: async () => oversized,
      uploadBackup: async () => oversized,
      downloadBackup: async () => 'x'.repeat(MAX_BACKUP_BYTES + 1),
      deleteBackup: async () => {},
    }
    await expect(readRemoteBackups(bigTransport)).rejects.toThrow(/too large/)

    const failing: DriveTransport = {
      ...bigTransport,
      findBackup: async () => ({ ...oversized, name: 'cubelab-backup-device.json' }),
      downloadBackup: async () => '',
      deleteBackup: async () => {
        throw new Error('permission denied')
      },
      listBackups: async () => [oversized],
    }
    await expect(deleteAllRemoteBackups(failing)).rejects.toThrow(/could not be removed/)
  })
})
