import { describe, expect, it } from 'vitest'
import type { Session, SessionsData, Settings, Solve } from '../types'
import { DEFAULT_SETTINGS } from './storage'
import {
  createMemoryDriveTransport,
  type DriveTransport,
} from './driveTransport'
import { createBackup } from './backup'
import {
  createSyncEnvelope,
  mergeSessionsData,
  mergeTombstones,
} from './sync'
import { mergeSettingsData } from './settingsMerge'
import {
  findOwnSnapshots,
  listRemoteBackups,
  mergeRemoteBackupSnapshots,
  readRemoteBackups,
} from './remoteBackups'
import type {
  SettingsFieldKey,
  SettingsFieldUpdates,
  Tombstone,
} from './syncStorage'

interface DeviceState {
  id: string
  sessions: SessionsData
  settings: Settings
  settingsFieldUpdates: SettingsFieldUpdates
  tombstones: Tombstone[]
  revision: number
}

function solve(id: string, createdAt: number, overrides: Partial<Solve> = {}): Solve {
  return {
    id,
    event: '333',
    rawMs: 10_000 + createdAt,
    penalty: 'none',
    scramble: "R U R' U'",
    comment: '',
    createdAt,
    ...overrides,
  }
}

function sharedSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    name: 'Shared',
    event: '333',
    createdAt: 1,
    updatedAt: 100,
    fieldUpdates: {
      name: { updatedAt: 100, editorId: 'seed' },
      event: { updatedAt: 100, editorId: 'seed' },
    },
    solves: [],
    ...overrides,
  }
}

function deviceState(
  id: string,
  solves: Solve[] = [],
  settings: Partial<Settings> = {},
): DeviceState {
  return {
    id,
    sessions: {
      activeSessionId: 'session-1',
      sessions: [sharedSession({ solves })],
    },
    settings: {
      ...DEFAULT_SETTINGS,
      statVisibility: { ...DEFAULT_SETTINGS.statVisibility, single: true, ao5: true },
      customAverages: [],
      ...settings,
    },
    settingsFieldUpdates: {
      accentColor: { updatedAt: 100, editorId: 'seed' },
      alertVolume: { updatedAt: 100, editorId: 'seed' },
    },
    tombstones: [],
    revision: 0,
  }
}

function replaceSession(
  device: DeviceState,
  update: (session: Session) => Session,
): void {
  device.sessions = {
    ...device.sessions,
    sessions: device.sessions.sessions.map((session) =>
      session.id === 'session-1' ? update(session) : session,
    ),
  }
}

function addSolves(device: DeviceState, solves: Solve[]): void {
  replaceSession(device, (session) => ({
    ...session,
    solves: [...session.solves, ...solves],
  }))
}

function deleteSolve(device: DeviceState, id: string, deletedAt: number): void {
  replaceSession(device, (session) => ({
    ...session,
    solves: session.solves.filter((solve) => solve.id !== id),
  }))
  device.tombstones = [
    ...device.tombstones,
    {
      kind: 'solve',
      id,
      sessionId: 'session-1',
      deletedAt,
      deletedByDeviceId: device.id,
    },
  ]
}

function restoreDeletedSolve(
  device: DeviceState,
  removed: Solve,
  restoredAt: number,
): void {
  addSolves(device, [removed])
  device.tombstones = device.tombstones.map((tombstone) =>
    tombstone.kind === 'solve' && tombstone.id === removed.id
      ? {
          ...tombstone,
          restoredAt: Math.max(restoredAt, tombstone.deletedAt + 1),
        }
      : tombstone,
  )
}

function editSolve(
  device: DeviceState,
  id: string,
  editedAt: number,
  update: Partial<Solve>,
): void {
  replaceSession(device, (session) => ({
    ...session,
    solves: session.solves.map((solve) =>
      solve.id === id
        ? {
            ...solve,
            ...update,
            updatedAt: editedAt,
            fieldUpdates: {
              ...solve.fieldUpdates,
              ...(update.penalty !== undefined
                ? { penalty: { updatedAt: editedAt, editorId: device.id } }
                : {}),
              ...(update.comment !== undefined
                ? { comment: { updatedAt: editedAt, editorId: device.id } }
                : {}),
            },
          }
        : solve,
    ),
  }))
}

function renameSession(device: DeviceState, name: string, editedAt: number): void {
  replaceSession(device, (session) => ({
    ...session,
    name,
    updatedAt: editedAt,
    fieldUpdates: {
      ...session.fieldUpdates,
      name: { updatedAt: editedAt, editorId: device.id },
    },
  }))
}

function editSetting(
  device: DeviceState,
  key: SettingsFieldKey,
  value: Settings[SettingsFieldKey],
  editedAt: number,
): void {
  device.settings = { ...device.settings, [key]: value }
  device.settingsFieldUpdates = {
    ...device.settingsFieldUpdates,
    [key]: { updatedAt: editedAt, editorId: device.id },
  }
}

function snapshotRevision(envelope: { revision?: number } | undefined): number {
  return typeof envelope?.revision === 'number' ? envelope.revision : 0
}

/**
 * Mirrors the pure merge path used by useSync: read every device snapshot,
 * merge sessions and settings, then publish only this device's own file.
 */
async function syncDevice(
  device: DeviceState,
  transport: DriveTransport,
): Promise<void> {
  const files = await listRemoteBackups(transport)
  const snapshots = await readRemoteBackups(transport, files)
  const tombstones = mergeTombstones(
    device.tombstones,
    ...snapshots.map((snapshot) => snapshot.backup.sync?.tombstones ?? []),
  )

  let sessions = device.sessions
  for (const snapshot of snapshots) {
    sessions = mergeSessionsData({
      local: sessions,
      remote: snapshot.backup.sessions,
      tombstones,
      deviceId: device.id,
      manualConflictReview: false,
    }).merged
  }

  let remoteSettings: Settings | null = snapshots[0]?.backup.settings ?? null
  let remoteSettingsUpdates: SettingsFieldUpdates =
    snapshots[0]?.backup.sync?.settingsFieldUpdates ?? {}
  for (const snapshot of snapshots.slice(1)) {
    const merged = mergeSettingsData({
      local: remoteSettings!,
      remote: snapshot.backup.settings,
      localFieldUpdates: remoteSettingsUpdates,
      remoteFieldUpdates: snapshot.backup.sync?.settingsFieldUpdates ?? {},
      remoteUpdatedAt: snapshot.updatedAt,
      lastSyncAt: 1,
      manualConflictReview: false,
    })
    remoteSettings = merged.settings
    remoteSettingsUpdates = merged.fieldUpdates
  }

  let settings = device.settings
  let settingsFieldUpdates = device.settingsFieldUpdates
  if (remoteSettings) {
    const merged = mergeSettingsData({
      local: device.settings,
      remote: remoteSettings,
      localFieldUpdates: device.settingsFieldUpdates,
      remoteFieldUpdates: remoteSettingsUpdates,
      remoteUpdatedAt: snapshots.reduce(
        (newest, snapshot) => Math.max(newest, snapshot.updatedAt),
        0,
      ),
      lastSyncAt: 1,
      manualConflictReview: false,
      localEditorId: device.id,
    })
    settings = merged.settings
    settingsFieldUpdates = merged.fieldUpdates
  }

  const revision =
    Math.max(
      device.revision,
      ...snapshots.map((snapshot) => snapshotRevision(snapshot.backup.sync)),
    ) + 1
  // Immutable uniquely named snapshot: every upload adds a file. A concurrent
  // writer sharing this device ID can never be overwritten.
  const backup = createBackup(
    sessions,
    settings,
    new Date(),
    createSyncEnvelope(
      device.id,
      revision,
      tombstones,
      [],
      [],
      settingsFieldUpdates,
    ),
  )
  await transport.uploadDeviceBackup!(JSON.stringify(backup), device.id)

  device.sessions = sessions
  device.settings = settings
  device.settingsFieldUpdates = settingsFieldUpdates
  device.tombstones = tombstones
  device.revision = revision
}

function allSolveIds(data: SessionsData): string[] {
  return data.sessions.flatMap((session) => session.solves.map((solve) => solve.id))
}

function sessionById(data: SessionsData, id: string): Session | undefined {
  return data.sessions.find((session) => session.id === id)
}

describe('multi-device synchronization stress', () => {
  it('keeps concurrent per-device uploads isolated', async () => {
    const transport = createMemoryDriveTransport()
    await transport.connect()
    const devices = [
      deviceState('laptop', [solve('laptop-1', 1_000)]),
      deviceState('phone', [solve('phone-1', 2_000)]),
      deviceState('tablet', [solve('tablet-1', 3_000)]),
    ]

    await Promise.all(devices.map((device) => syncDevice(device, transport)))

    const files = await listRemoteBackups(transport)
    // Each concurrent upload produced its own immutable file; no writer
    // replaced another writer's snapshot.
    expect(files).toHaveLength(3)
    expect(new Set(files.map((file) => file.name)).size).toBe(3)
    const snapshots = await readRemoteBackups(transport, files)
    expect(snapshots).toHaveLength(3)
    for (const snapshot of snapshots) {
      // Isolation: each snapshot carries only its own writer's solve.
      expect(allSolveIds(snapshot.backup.sessions)).toHaveLength(1)
    }
  })

  it('keeps both writers when two writers share one device ID', async () => {
    const transport = createMemoryDriveTransport()
    await transport.connect()
    // Two browser profiles copied between machines share one device ID and
    // therefore one "own snapshot" name. Both add a different new solve.
    const writerA = deviceState('shared', [solve('writer-a-1', 1_000)])
    const writerB = deviceState('shared', [solve('writer-b-1', 2_000)])

    // Both writers run a full merge and upload; with immutable unique names
    // neither write can destroy the other's snapshot.
    await Promise.all([
      syncDevice(writerA, transport),
      syncDevice(writerB, transport),
    ])

    const files = await listRemoteBackups(transport)
    expect(files).toHaveLength(2)
    const snapshots = await readRemoteBackups(transport, files)
    // Both solves remain discoverable remotely.
    expect(
      snapshots
        .flatMap((snapshot) => allSolveIds(snapshot.backup.sessions))
        .sort(),
    ).toEqual(['writer-a-1', 'writer-b-1'])

    // A subsequent sync on either writer converges on both solves.
    await syncDevice(writerA, transport)
    await syncDevice(writerB, transport)
    expect(allSolveIds(writerA.sessions).sort()).toEqual([
      'writer-a-1',
      'writer-b-1',
    ])
    expect(allSolveIds(writerB.sessions).sort()).toEqual([
      'writer-a-1',
      'writer-b-1',
    ])
  })

  it('converges solves, deletions, names, and settings across three devices', async () => {
    const transport = createMemoryDriveTransport()
    await transport.connect()
    const laptop = deviceState('laptop', [solve('seed', 100)])
    const phone = deviceState('phone')
    const tablet = deviceState('tablet')
    const devices = [laptop, phone, tablet]

    // Each device publishes its own file first, then folds every snapshot in.
    for (let round = 0; round < 2; round += 1) {
      await Promise.all(devices.map((device) => syncDevice(device, transport)))
    }
    for (const device of devices) {
      expect(allSolveIds(device.sessions).sort()).toEqual(['seed'])
    }

    addSolves(laptop, [solve('laptop-1', 2_001), solve('laptop-2', 2_002)])
    deleteSolve(laptop, 'seed', 9_000)
    editSetting(laptop, 'accentColor', 'blue', 20_000)

    addSolves(phone, [solve('phone-1', 3_001)])
    // This edit races a deletion and must not resurrect the tombstoned solve.
    editSolve(phone, 'seed', 6_000, { penalty: '+2' })
    renameSession(phone, 'Phone Session', 6_000)
    editSetting(phone, 'alertVolume', 55, 30_000)

    addSolves(tablet, [solve('tablet-1', 4_001)])
    renameSession(tablet, 'Tablet Session', 5_000)
    editSetting(tablet, 'accentColor', 'violet', 10_000)
    editSetting(laptop, 'averageTrimBetter', '1', 11_000)
    editSetting(phone, 'averageTrimWorse', 'p10', 12_000)

    for (let round = 0; round < 5; round += 1) {
      await Promise.all(devices.map((device) => syncDevice(device, transport)))
    }

    const expectedSolveIds = ['laptop-1', 'laptop-2', 'phone-1', 'tablet-1']
    for (const device of devices) {
      const ids = allSolveIds(device.sessions)
      expect([...ids].sort()).toEqual(expectedSolveIds)
      expect(new Set(ids).size).toBe(ids.length)
      expect(ids).not.toContain('seed')
      expect(sessionById(device.sessions, 'session-1')?.name).toBe('Phone Session')
      expect(device.settings.accentColor).toBe('blue')
      expect(device.settings.alertVolume).toBe(55)
      expect(device.settings.averageTrimBetter).toBe('1')
      expect(device.settings.averageTrimWorse).toBe('p10')
      expect(device.tombstones.some((tombstone) => tombstone.id === 'seed')).toBe(true)
    }

    // Immutable snapshots accumulate: every write adds a file instead of
    // replacing the device's previous one, so the store carries the full
    // history of every device's published states.
    const files = await listRemoteBackups(transport)
    expect(files.length).toBeGreaterThan(devices.length)
    const snapshots = await readRemoteBackups(transport, files)
    for (const device of devices) {
      const own = findOwnSnapshots(snapshots, device.id)
      expect(own.length).toBeGreaterThan(0)
      // Each device's newest snapshot reflects the converged state.
      const newest = own.at(-1)!
      const ids = allSolveIds(newest.backup.sessions)
      expect([...ids].sort()).toEqual(expectedSolveIds)
      expect(newest.backup.settings.accentColor).toBe('blue')
      expect(newest.backup.settings.alertVolume).toBe(55)
      expect(newest.backup.settings.averageTrimBetter).toBe('1')
      expect(newest.backup.settings.averageTrimWorse).toBe('p10')
      expect(sessionById(newest.backup.sessions, 'session-1')?.name).toBe(
        'Phone Session',
      )
      expect(
        newest.backup.sync?.tombstones.some(
          (tombstone) => tombstone.id === 'seed',
        ),
      ).toBe(true)
    }
    // The full merged view across every immutable snapshot converges too:
    // stale files stay readable, and tombstones/newest-field metadata win.
    const mergedView = mergeRemoteBackupSnapshots(snapshots)
    expect(
      mergedView.sessions.sessions
        .flatMap((session) => session.solves.map((solve) => solve.id))
        .sort(),
    ).toEqual(expectedSolveIds)
    expect(mergedView.settings.accentColor).toBe('blue')
    expect(mergedView.settings.alertVolume).toBe(55)

    // Repeating the merge without edits is idempotent and does not reintroduce
    // deleted or duplicate solves.
    const finalCounts = devices.map((device) => allSolveIds(device.sessions).length)
    await Promise.all(devices.map((device) => syncDevice(device, transport)))
    expect(devices.map((device) => allSolveIds(device.sessions).length)).toEqual(
      finalCounts,
    )
    for (const device of devices) {
      expect(new Set(allSolveIds(device.sessions)).size).toBe(4)
    }
  })

  it('propagates a durable undo through delayed three-device snapshots', async () => {
    const transport = createMemoryDriveTransport()
    await transport.connect()
    const laptop = deviceState('laptop', [solve('seed', 100)])
    const phone = deviceState('phone')
    const tablet = deviceState('tablet')
    const devices = [laptop, phone, tablet]

    for (let round = 0; round < 2; round += 1) {
      await Promise.all(devices.map((device) => syncDevice(device, transport)))
    }
    for (const device of devices) {
      expect(allSolveIds(device.sessions)).toEqual(['seed'])
    }

    const removed = sessionById(laptop.sessions, 'session-1')?.solves.find(
      (item) => item.id === 'seed',
    )
    if (!removed) throw new Error('seed solve is missing')
    deleteSolve(laptop, 'seed', 9_000)
    await syncDevice(laptop, transport)
    await syncDevice(phone, transport)
    // This device has not seen the deletion yet, so its stale snapshot still
    // contains the solve and an older view of the tombstone set.
    expect(allSolveIds(tablet.sessions)).toEqual(['seed'])

    restoreDeletedSolve(laptop, removed, 10_000)
    await syncDevice(laptop, transport)

    for (let round = 0; round < 3; round += 1) {
      await Promise.all(devices.map((device) => syncDevice(device, transport)))
    }
    for (const device of devices) {
      expect(allSolveIds(device.sessions)).toEqual(['seed'])
      const tombstone = device.tombstones.find(
        (item) => item.kind === 'solve' && item.id === 'seed',
      )
      expect(tombstone?.restoredAt).toBe(10_000)
    }

    // A later deliberate deletion wins over the propagated restoration.
    deleteSolve(tablet, 'seed', 20_000)
    for (let round = 0; round < 3; round += 1) {
      await Promise.all(devices.map((device) => syncDevice(device, transport)))
    }
    for (const device of devices) {
      expect(allSolveIds(device.sessions)).toEqual([])
      const tombstone = device.tombstones.find(
        (item) => item.kind === 'solve' && item.id === 'seed',
      )
      expect(tombstone?.deletedAt).toBe(20_000)
      expect(tombstone?.restoredAt).toBeUndefined()
    }
  })
})
