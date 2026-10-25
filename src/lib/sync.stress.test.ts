import { describe, expect, it } from 'vitest'
import type { Session, SessionsData, Settings, Solve } from '../types'
import { DEFAULT_SETTINGS } from './storage'
import {
  createMemoryDriveTransport,
  deviceBackupFileName,
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
  listRemoteBackups,
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
  const ownFile = files.find(
    (file) => file.name === deviceBackupFileName(device.id),
  )
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
  await transport.uploadDeviceBackup!(
    JSON.stringify(backup),
    device.id,
    ownFile?.id,
  )

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
    expect(files.map((file) => file.name).sort()).toEqual(
      devices.map((device) => deviceBackupFileName(device.id)).sort(),
    )
    const snapshots = await readRemoteBackups(transport, files)
    expect(snapshots).toHaveLength(3)
    for (const snapshot of snapshots) {
      expect(allSolveIds(snapshot.backup.sessions)).toHaveLength(1)
    }
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
      expect(device.tombstones.some((tombstone) => tombstone.id === 'seed')).toBe(true)
    }

    const files = await listRemoteBackups(transport)
    expect(files.map((file) => file.name).sort()).toEqual(
      devices.map((device) => deviceBackupFileName(device.id)).sort(),
    )
    const snapshots = await readRemoteBackups(transport, files)
    for (const snapshot of snapshots) {
      const ids = allSolveIds(snapshot.backup.sessions)
      expect([...ids].sort()).toEqual(expectedSolveIds)
      expect(snapshot.backup.settings.accentColor).toBe('blue')
      expect(snapshot.backup.settings.alertVolume).toBe(55)
      expect(sessionById(snapshot.backup.sessions, 'session-1')?.name).toBe(
        'Phone Session',
      )
      expect(
        snapshot.backup.sync?.tombstones.some(
          (tombstone) => tombstone.id === 'seed',
        ),
      ).toBe(true)
    }

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
})
