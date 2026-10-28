import { describe, expect, it, vi } from 'vitest'
import {
  createMemoryDriveTransport,
  DRIVE_BACKUP_FILE_NAME,
  type DriveFile,
  type DriveTransport,
} from './driveTransport'
import {
  cleanupRemoteSnapshots,
  describeSnapshotOwner,
  groupRemoteSnapshots,
  newestSnapshotModifiedAt,
  selectSnapshotsForCleanup,
  SNAPSHOT_DAY_MS,
} from './snapshotRetention'

const NOW = Date.parse('2026-10-28T12:00:00.000Z')

function file(overrides: Partial<DriveFile> & { id: string }): DriveFile {
  return {
    name: `cubelab-backup-device-a-${overrides.id}.json`,
    modifiedTime: new Date(NOW).toISOString(),
    etag: null,
    ...overrides,
  }
}

function daysAgo(days: number): string {
  return new Date(NOW - days * SNAPSHOT_DAY_MS).toISOString()
}

function snapshotAt(id: string, days: number, deviceId?: string): DriveFile {
  return file({
    id,
    name: `cubelab-backup-${deviceId ?? 'device-a'}-${id}.json`,
    modifiedTime: daysAgo(days),
    appProperties: deviceId ? { deviceId } : undefined,
  })
}

describe('snapshot ownership', () => {
  it('groups snapshots by app-private device metadata and marks this device', () => {
    const own = snapshotAt('own-1', 1, 'device-a')
    const other = snapshotAt('other-1', 2, 'device-b')
    const localDeviceId = 'device-a'

    expect(describeSnapshotOwner(own, localDeviceId)).toMatchObject({
      label: 'This device',
      own: true,
      legacy: false,
      deviceId: 'device-a',
    })
    expect(describeSnapshotOwner(other, localDeviceId).label).toBe(
      'Device device-b',
    )

    const groups = groupRemoteSnapshots([other, own], localDeviceId)
    expect(groups.map((group) => group.key)).toEqual([
      'device:device-a',
      'device:device-b',
    ])
    expect(groups[0]!.owner.own).toBe(true)
  })

  it('falls back to the sanitized file name for older snapshots', () => {
    const older = file({
      id: 'older',
      name: 'cubelab-backup-device-a-0f8fad5b-d9cb-469f-a165-70867728950e.json',
    })
    const legacyName = file({
      id: 'legacy-name',
      name: 'cubelab-backup-device-a.json',
    })

    expect(describeSnapshotOwner(older, 'device-a')).toMatchObject({
      label: 'This device',
      own: true,
      deviceId: 'device-a',
    })
    expect(describeSnapshotOwner(legacyName, 'device-a').own).toBe(true)

    const groups = groupRemoteSnapshots([older, legacyName], 'device-a')
    expect(groups).toHaveLength(1)
    expect(groups[0]!.files).toHaveLength(2)
  })

  it('does not treat the mutable legacy file as an owned snapshot', () => {
    const legacy = file({
      id: 'legacy',
      name: DRIVE_BACKUP_FILE_NAME,
      modifiedTime: daysAgo(400),
    })
    expect(describeSnapshotOwner(legacy, 'device-a')).toMatchObject({
      label: 'Legacy shared backup',
      own: false,
      legacy: true,
    })
    expect(selectSnapshotsForCleanup([legacy], {
      keepPerDevice: 1,
      maxAgeDays: 1,
      now: NOW,
      localDeviceId: 'device-a',
    })).toEqual([])
  })

  it('labels unknown older snapshots without claiming ownership', () => {
    const unknown = file({ id: 'unknown', name: 'cubelab-backup.json.bak' })
    expect(describeSnapshotOwner(unknown, 'device-a')).toMatchObject({
      label: 'Older device snapshot',
      own: false,
      legacy: false,
    })
  })
})

describe('snapshot cleanup selection', () => {
  it('always keeps the newest snapshot of every device group', () => {
    const files = [
      snapshotAt('a-new', 400, 'device-a'),
      snapshotAt('a-old', 500, 'device-a'),
      snapshotAt('b-new', 600, 'device-b'),
      snapshotAt('b-old', 700, 'device-b'),
    ]

    const selected = selectSnapshotsForCleanup(files, {
      keepPerDevice: 1,
      maxAgeDays: 1,
      now: NOW,
      localDeviceId: 'device-a',
    })
    expect(selected.map((entry) => entry.id).sort()).toEqual(['a-old', 'b-old'])
  })

  it('removes snapshots beyond the per-device count even when they are recent', () => {
    const files = Array.from({ length: 6 }, (_, index) =>
      snapshotAt(`snapshot-${index}`, index, 'device-a'),
    )

    const selected = selectSnapshotsForCleanup(files, {
      keepPerDevice: 3,
      maxAgeDays: 365,
      now: NOW,
      localDeviceId: 'device-a',
    })
    expect(selected.map((entry) => entry.id)).toEqual([
      'snapshot-3',
      'snapshot-4',
      'snapshot-5',
    ])
  })

  it('removes snapshots older than the age threshold even under the count', () => {
    const files = [
      snapshotAt('recent', 1, 'device-a'),
      snapshotAt('old', 40, 'device-a'),
      snapshotAt('older', 90, 'device-a'),
    ]

    const selected = selectSnapshotsForCleanup(files, {
      keepPerDevice: 10,
      maxAgeDays: 30,
      now: NOW,
      localDeviceId: 'device-a',
    })
    expect(selected.map((entry) => entry.id)).toEqual(['old', 'older'])
  })

  it('keeps the just-published snapshot and anything newer than the merge', () => {
    const files = [
      snapshotAt('published', 2, 'device-a'),
      snapshotAt('newer-than-merge', 1, 'device-a'),
      snapshotAt('superseded', 3, 'device-a'),
    ]

    const selected = selectSnapshotsForCleanup(files, {
      keepPerDevice: 1,
      maxAgeDays: 1,
      now: NOW,
      localDeviceId: 'device-a',
      publishedFileId: 'published',
      publishedAt: NOW - 2 * SNAPSHOT_DAY_MS,
    })
    // The group's newest file is `newer-than-merge`, so `published` is not
    // index 0 and must be protected explicitly.
    expect(selected.map((entry) => entry.id)).toEqual(['superseded'])
  })

  it('ignores a malformed publication boundary instead of disabling cleanup', () => {
    const files = [
      snapshotAt('published', 2, 'device-a'),
      snapshotAt('older', 3, 'device-a'),
      snapshotAt('oldest', 4, 'device-a'),
    ]

    const selected = selectSnapshotsForCleanup(files, {
      keepPerDevice: 1,
      maxAgeDays: 365,
      now: NOW,
      localDeviceId: 'device-a',
      publishedFileId: 'published',
      publishedAt: Number.NaN,
    })
    expect(selected.map((entry) => entry.id)).toEqual(['older', 'oldest'])
  })

  it('restricts manual cleanup to this device when ownOnly is set', () => {
    const files = [
      snapshotAt('own-new', 1, 'device-a'),
      snapshotAt('own-old', 2, 'device-a'),
      snapshotAt('foreign-new', 1, 'device-b'),
      snapshotAt('foreign-old', 2, 'device-b'),
    ]

    const selected = selectSnapshotsForCleanup(files, {
      keepPerDevice: 1,
      maxAgeDays: 1,
      now: NOW,
      localDeviceId: 'device-a',
      ownOnly: true,
    })
    expect(selected.map((entry) => entry.id)).toEqual(['own-old'])
  })

  it('does not judge a snapshot without a parseable date by age', () => {
    const undated = file({
      id: 'undated',
      name: 'cubelab-backup-device-a-undated.json',
      modifiedTime: null,
      appProperties: { deviceId: 'device-a' },
    })
    const newest = file({
      id: 'newest',
      name: 'cubelab-backup-device-a-newest.json',
      modifiedTime: daysAgo(1),
      appProperties: { deviceId: 'device-a' },
    })

    // Under the count threshold an undated snapshot is kept: age cannot make
    // it a candidate.
    expect(
      selectSnapshotsForCleanup([newest, undated], {
        keepPerDevice: 2,
        maxAgeDays: 1,
        now: NOW,
        localDeviceId: 'device-a',
      }),
    ).toEqual([])

    // The count threshold still bounds a group that contains undated files.
    expect(
      selectSnapshotsForCleanup([newest, undated], {
        keepPerDevice: 1,
        maxAgeDays: 1,
        now: NOW,
        localDeviceId: 'device-a',
      }).map((entry) => entry.id),
    ).toEqual(['undated'])
  })

  it('reports the newest modification time across a listing', () => {
    expect(
      newestSnapshotModifiedAt([
        snapshotAt('one', 5, 'device-a'),
        snapshotAt('two', 1, 'device-b'),
        file({ id: 'undated', modifiedTime: null }),
      ]),
    ).toBe(NOW - SNAPSHOT_DAY_MS)
    expect(newestSnapshotModifiedAt([file({ id: 'none', modifiedTime: null })])).toBeNull()
  })
})

describe('cleanupRemoteSnapshots', () => {
  it('deletes selected snapshots and reports the count', async () => {
    const memory = createMemoryDriveTransport()
    await memory.connect()
    const first = await memory.uploadDeviceBackup!('{}', 'device-a')
    const second = await memory.uploadDeviceBackup!('{}', 'device-a')

    const result = await cleanupRemoteSnapshots(memory, [first, second], {
      keepPerDevice: 1,
      maxAgeDays: 365,
      localDeviceId: 'device-a',
    })

    expect(result.candidates.map((entry) => entry.id)).toEqual([first.id])
    expect(result.deleted).toBe(1)
    expect(result.failures).toEqual([])
    expect((await memory.listBackups!()).map((entry) => entry.id)).toEqual([
      second.id,
    ])
  })

  it('reports partial failures instead of claiming a complete cleanup', async () => {
    const memory = createMemoryDriveTransport()
    await memory.connect()
    const removable = await memory.uploadDeviceBackup!('{}', 'device-a')
    const failing = await memory.uploadDeviceBackup!('{}', 'device-a')
    const newest = await memory.uploadDeviceBackup!('{}', 'device-a')

    const transport: DriveTransport = {
      ...memory,
      deleteBackup: vi.fn(async (fileId: string) => {
        if (fileId === failing.id) throw new Error('Drive write failed')
        return memory.deleteBackup(fileId)
      }),
    }

    const result = await cleanupRemoteSnapshots(
      transport,
      [newest, failing, removable],
      {
        keepPerDevice: 1,
        maxAgeDays: 365,
        localDeviceId: 'device-a',
      },
    )

    expect(result.deleted).toBe(1)
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]).toContain('Drive write failed')
    const remaining = await memory.listBackups!()
    expect(remaining.map((entry) => entry.id).sort()).toEqual(
      [newest.id, failing.id].sort(),
    )
  })

  it('treats an already-deleted snapshot as success without counting it', async () => {
    const memory = createMemoryDriveTransport()
    await memory.connect()
    const gone = await memory.uploadDeviceBackup!('{}', 'device-a')
    const newest = await memory.uploadDeviceBackup!('{}', 'device-a')

    const transport: DriveTransport = {
      ...memory,
      deleteBackup: vi.fn(async (fileId: string) => {
        if (fileId === gone.id) throw new Error('File not found')
        return memory.deleteBackup(fileId)
      }),
    }

    const result = await cleanupRemoteSnapshots(
      transport,
      [newest, gone],
      {
        keepPerDevice: 1,
        maxAgeDays: 365,
        localDeviceId: 'device-a',
      },
    )

    expect(result.deleted).toBe(0)
    expect(result.failures).toEqual([])
  })
})
