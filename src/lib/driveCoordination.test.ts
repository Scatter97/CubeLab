import { describe, expect, it, vi } from 'vitest'
import type { DriveFile } from './driveTransport'
import {
  DRIVE_WRITE_LOCK_NAME,
  ownSnapshotChanged,
  runWithDriveWriteLock,
  type DriveLockManager,
} from './driveCoordination'

function file(overrides: Partial<DriveFile> = {}): DriveFile {
  return {
    id: 'drive-file-1',
    name: 'cubelab-backup-device-a.json',
    modifiedTime: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

/** Minimal exclusive lock queue that mirrors the Web Locks contract. */
function createQueueLockManager(): DriveLockManager & {
  active: number
  maxActive: number
} {
  const tails = new Map<string, Promise<void>>()
  const manager = {
    active: 0,
    maxActive: 0,
    request<T>(
      name: string,
      _options: { mode?: 'exclusive' | 'shared'; ifAvailable?: boolean },
      callback: (lock: unknown) => Promise<T>,
    ): Promise<T> {
      const previous = tails.get(name) ?? Promise.resolve()
      let release!: () => void
      const current = new Promise<void>((resolve) => {
        release = resolve
      })
      tails.set(name, previous.then(() => current))
      return previous.then(async () => {
        manager.active += 1
        manager.maxActive = Math.max(manager.maxActive, manager.active)
        try {
          return await callback({ name })
        } finally {
          manager.active -= 1
          release()
        }
      })
    },
  }
  return manager
}

describe('runWithDriveWriteLock', () => {
  it('runs the task under the shared write lock name', async () => {
    const request = vi.fn(async (_name, _options, callback) => callback({}))
    const manager: DriveLockManager = { request }

    await expect(runWithDriveWriteLock(async () => 'done', manager)).resolves.toBe(
      'done',
    )
    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.calls[0]?.[0]).toBe(DRIVE_WRITE_LOCK_NAME)
    expect(request.mock.calls[0]?.[1]).toMatchObject({ mode: 'exclusive' })
  })

  it('serializes overlapping writes instead of interleaving them', async () => {
    const manager = createQueueLockManager()
    const order: string[] = []
    let releaseFirst!: () => void
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })

    const first = runWithDriveWriteLock(async () => {
      order.push('first:start')
      await firstGate
      order.push('first:end')
    }, manager)
    const second = runWithDriveWriteLock(async () => {
      order.push('second:start')
      order.push('second:end')
    }, manager)

    await Promise.resolve()
    await Promise.resolve()
    expect(order).toEqual(['first:start'])
    releaseFirst()
    await Promise.all([first, second])
    expect(order).toEqual([
      'first:start',
      'first:end',
      'second:start',
      'second:end',
    ])
    expect(manager.maxActive).toBe(1)
  })

  it('releases the lock when the task rejects so the next write can run', async () => {
    const manager = createQueueLockManager()
    const first = runWithDriveWriteLock(async () => {
      throw new Error('upload failed')
    }, manager)

    await expect(first).rejects.toThrow('upload failed')
    await expect(
      runWithDriveWriteLock(async () => 'recovered', manager),
    ).resolves.toBe('recovered')
    expect(manager.active).toBe(0)
  })

  it('still runs the task when Web Locks are unavailable', async () => {
    await expect(
      runWithDriveWriteLock(async () => 'best effort', null),
    ).resolves.toBe('best effort')
  })
})

describe('ownSnapshotChanged', () => {
  it('treats two missing snapshots as unchanged', () => {
    expect(ownSnapshotChanged(undefined, null)).toBe(false)
  })

  it('treats a snapshot appearing or disappearing as a change', () => {
    expect(ownSnapshotChanged(undefined, file())).toBe(true)
    expect(ownSnapshotChanged(file(), null)).toBe(true)
  })

  it('ignores an identical snapshot', () => {
    expect(ownSnapshotChanged(file(), file())).toBe(false)
  })

  it('detects a replaced file, renamed snapshot, or newer modification time', () => {
    expect(ownSnapshotChanged(file(), file({ id: 'drive-file-2' }))).toBe(true)
    expect(
      ownSnapshotChanged(file(), file({ name: 'cubelab-backup-device-b.json' })),
    ).toBe(true)
    expect(
      ownSnapshotChanged(
        file(),
        file({ modifiedTime: '2026-01-01T00:00:01.000Z' }),
      ),
    ).toBe(true)
  })

  it('treats a missing modification time on one side as a change', () => {
    expect(
      ownSnapshotChanged(file({ modifiedTime: null }), file()),
    ).toBe(true)
    expect(
      ownSnapshotChanged(file(), file({ modifiedTime: null })),
    ).toBe(true)
  })
})
