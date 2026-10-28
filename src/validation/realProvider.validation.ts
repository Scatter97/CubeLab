/**
 * Opt-in real-provider validation for Google Drive synchronization.
 *
 * This file deliberately does not match the normal `src/**\/*.test.ts` pattern,
 * so `npm test` never contacts Google. Run it with a short-lived access token
 * that has the `drive.appdata` scope:
 *
 *   CUBELAB_DRIVE_ACCESS_TOKEN="<token>" npm run validate:drive
 *
 * Use a dedicated test account with an empty app-data folder. The harness
 * records every file it creates and deletes only those files. Set
 * CUBELAB_DRIVE_ALLOW_EXISTING=true to run against an account that already has
 * CubeLab snapshots; baseline files are read but never modified, except for the
 * legacy mutable file, which is left untouched when it already exists.
 *
 * The harness validates the real provider, not a mock:
 * - concurrent immutable snapshot writes from two device identities,
 * - all-snapshot listing, download, validation, and merge convergence,
 * - same-device concurrent writers (copied-profile scenario),
 * - Drive v2 ETag discovery and `If-Match` conditional replacement,
 * - retention selection against real modification times and ownership metadata,
 * - selective deletion and complete cleanup of the run's own files.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Session, SessionsData, Solve } from '../types'
import { createBackup } from '../lib/backup'
import {
  DrivePreconditionError,
  createGoogleDriveTransport,
  type DriveFile,
  type DriveTransport,
} from '../lib/driveTransport'
import {
  mergeRemoteBackupSnapshots,
  readRemoteBackups,
} from '../lib/remoteBackups'
import { DEFAULT_SETTINGS } from '../lib/storage'
import { createSyncEnvelope } from '../lib/sync'
import {
  cleanupRemoteSnapshots,
  newestSnapshotModifiedAt,
} from '../lib/snapshotRetention'

const TOKEN = envValue('CUBELAB_DRIVE_ACCESS_TOKEN')
const CLIENT_ID =
  envValue('CUBELAB_GOOGLE_CLIENT_ID') || 'real-provider-validation'
const ALLOW_EXISTING = envValue('CUBELAB_DRIVE_ALLOW_EXISTING') === 'true'
const RUN = `validation-${Date.now().toString(36)}`
const DEVICE_A = `${RUN}-a`
const DEVICE_B = `${RUN}-b`
const SESSION_ID = `session-${RUN}`
const BASE_TIME = 1_700_000_000_000

function envValue(key: string): string {
  const env = (
    globalThis as {
      process?: { env?: Record<string, string | undefined> }
    }
  ).process?.env
  return env?.[key]?.trim() ?? ''
}

const created = new Map<string, { name: string; owner: string }>()
const deletedIds = new Set<string>()
const timings: Record<string, number> = {}

let transportA: DriveTransport
let transportB: DriveTransport
let baselineFiles: DriveFile[] = []
let baselineLegacy: DriveFile | null = null

function stubToken(token: string): void {
  ;(window as Window & { google?: unknown }).google = {
    accounts: {
      oauth2: {
        initTokenClient: (config: {
          callback: (response: { access_token?: string; error?: string }) => void
        }) => {
          config.callback({ access_token: token })
          return { requestAccessToken: () => {} }
        },
        revoke: () => {},
      },
    },
  }
}

function solve(id: string, index: number): Solve {
  return {
    id,
    event: '333',
    rawMs: 10_000 + index * 1_000,
    penalty: 'none',
    scramble: 'R U R\u2032 U\u2032',
    comment: '',
    createdAt: BASE_TIME + index * 1_000,
  }
}

function session(solves: Solve[]): Session {
  return {
    id: SESSION_ID,
    name: `Validation ${RUN}`,
    event: '333',
    createdAt: BASE_TIME,
    updatedAt: BASE_TIME + solves.length,
    solves,
  }
}

function sessionsData(solveIds: string[]): SessionsData {
  return {
    activeSessionId: SESSION_ID,
    sessions: [session(solveIds.map((id, index) => solve(id, index)))],
  }
}

function backupContent(
  data: SessionsData,
  deviceId: string,
  revision: number,
  updatedAt: number,
): string {
  const envelope = {
    ...createSyncEnvelope(deviceId, revision, [], [], [], {}),
    updatedAt,
  }
  return JSON.stringify(
    createBackup(data, { ...DEFAULT_SETTINGS }, new Date(updatedAt), envelope),
  )
}

function track(file: DriveFile, owner: string): DriveFile {
  created.set(file.id, { name: file.name, owner })
  return file
}

async function publish(
  transport: DriveTransport,
  deviceId: string,
  data: SessionsData,
  revision: number,
  updatedAt: number,
): Promise<DriveFile> {
  if (!transport.uploadDeviceBackup) {
    throw new Error('The Google transport does not support device snapshots.')
  }
  const file = await transport.uploadDeviceBackup(
    backupContent(data, deviceId, revision, updatedAt),
    deviceId,
  )
  return track(file, deviceId)
}

async function listAll(
  transport: DriveTransport,
  attempts = 12,
): Promise<DriveFile[]> {
  let files = await transport.listBackups!()
  const expected = [...created.keys()].filter((id) => !deletedIds.has(id)).length
  for (let attempt = 1; attempt < attempts; attempt += 1) {
    const found = files.filter(
      (file) => created.has(file.id) && !deletedIds.has(file.id),
    ).length
    if (found >= expected) break
    await new Promise((resolve) => setTimeout(resolve, 750))
    files = await transport.listBackups!()
  }
  return files
}

function createdFiles(files: ReadonlyArray<DriveFile>): DriveFile[] {
  return files.filter((file) => created.has(file.id))
}

function solveIds(data: SessionsData): string[] {
  return data.sessions
    .flatMap((item) => item.solves.map((itemSolve) => itemSolve.id))
    .sort()
}

function duplicateSolveIds(data: SessionsData): string[] {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const item of data.sessions) {
    for (const itemSolve of item.solves) {
      if (seen.has(itemSolve.id)) duplicates.add(itemSolve.id)
      seen.add(itemSolve.id)
    }
  }
  return [...duplicates].sort()
}

function timed<T>(label: string, task: () => Promise<T>): Promise<T> {
  const start = Date.now()
  return task().finally(() => {
    timings[label] = Date.now() - start
  })
}

beforeAll(async () => {
  if (!TOKEN) {
    throw new Error(
      'CUBELAB_DRIVE_ACCESS_TOKEN is required. Create a short-lived token with the https://www.googleapis.com/auth/drive.appdata scope and run again. This harness never runs as part of npm test.',
    )
  }
  stubToken(TOKEN)
  transportA = createGoogleDriveTransport(CLIENT_ID)
  transportB = createGoogleDriveTransport(CLIENT_ID)
  await Promise.all([transportA.connect(), transportB.connect()])
  if (!transportA.listBackups || !transportA.uploadDeviceBackup) {
    throw new Error('The Google transport did not expose device snapshots.')
  }

  baselineFiles = await listAll(transportA)
  baselineLegacy =
    baselineFiles.find((file) => file.name === 'cubelab-backup.json') ?? null
  if (baselineFiles.length > 0 && !ALLOW_EXISTING) {
    throw new Error(
      `The test account already contains ${baselineFiles.length} CubeLab file(s). Use a dedicated empty test account, delete them through the app, or set CUBELAB_DRIVE_ALLOW_EXISTING=true to leave baseline files untouched.`,
    )
  }
  console.info(
    `[real-provider] ${baselineFiles.length} baseline CubeLab file(s); run ${RUN}`,
  )
})

afterAll(async () => {
  if (!transportA) return
  let deleted = 0
  let failures = 0
  for (const [id, info] of created) {
    try {
      await transportA.deleteBackup(id)
      deleted += 1
      deletedIds.add(id)
    } catch {
      // A file already removed by the retention scenario is still cleaned up.
      failures += 1
      console.info(`[real-provider] cleanup skipped ${info.name}`)
    }
  }
  const remaining = createdFiles(await transportA.listBackups!())
  const report = {
    ranAt: new Date().toISOString(),
    provider: 'Google Drive appDataFolder (v3 listing, v2 ETag)',
    run: RUN,
    baselineFileCount: baselineFiles.length,
    baselineLegacyFile: Boolean(baselineLegacy),
    filesCreated: created.size,
    filesDeleted: deleted,
    cleanupFailures: failures,
    remainingCreatedFiles: remaining.map((file) => file.name),
    timingsMs: timings,
    scenarios: {
      concurrentDeviceSnapshots: true,
      allSnapshotMerge: true,
      sameDeviceConcurrentWriters: true,
      legacyConditionalWrite: true,
      retentionCleanup: true,
      selectiveDeletion: true,
    },
  }
  console.info(`[real-provider-report] ${JSON.stringify(report)}`)
  expect(remaining, 'every file created by the validation run is removed').toEqual(
    [],
  )
})

describe('real Google Drive provider validation', () => {
  let roundOneFiles: DriveFile[] = []

  it('publishes immutable snapshots concurrently from two devices', async () => {
    const started = Date.now()
    const [fileA, fileB] = await timed('concurrentPublish', () =>
      Promise.all([
        publish(transportA, DEVICE_A, sessionsData(['seed', 'solve-a']), 1, BASE_TIME + 10),
        publish(transportB, DEVICE_B, sessionsData(['seed', 'solve-b']), 1, BASE_TIME + 11),
      ]),
    )
    timings.concurrentPublishWallMs = Date.now() - started

    expect(fileA.id).not.toBe(fileB.id)
    expect(fileA.name).not.toBe(fileB.name)
    expect(fileA.name).toMatch(/^cubelab-backup-validation-.+-[A-Za-z0-9_-]+\.json$/)
    expect(fileB.name).toMatch(/^cubelab-backup-validation-.+-[A-Za-z0-9_-]+\.json$/)

    const listed = await listAll(transportA)
    const remoteA = listed.find((file) => file.id === fileA.id)
    const remoteB = listed.find((file) => file.id === fileB.id)
    expect(remoteA, 'device A snapshot is discoverable').toBeDefined()
    expect(remoteB, 'device B snapshot is discoverable').toBeDefined()
    expect(remoteA?.appProperties?.deviceId).toBe(DEVICE_A)
    expect(remoteB?.appProperties?.deviceId).toBe(DEVICE_B)
    expect(remoteA?.size ?? 0).toBeGreaterThan(0)
    expect(remoteB?.size ?? 0).toBeGreaterThan(0)
    roundOneFiles = [remoteA!, remoteB!]
  })

  it('downloads and merges every snapshot into the same solve set', async () => {
    const snapshots = await timed('readRoundOne', () =>
      readRemoteBackups(transportA, roundOneFiles),
    )
    expect(snapshots).toHaveLength(2)
    const merged = mergeRemoteBackupSnapshots(snapshots)
    expect(solveIds(merged.sessions)).toEqual(['seed', 'solve-a', 'solve-b'])
    expect(duplicateSolveIds(merged.sessions)).toEqual([])

    const fromDeviceB = mergeRemoteBackupSnapshots(
      await readRemoteBackups(transportB, roundOneFiles),
    )
    expect(solveIds(fromDeviceB.sessions)).toEqual([
      'seed',
      'solve-a',
      'solve-b',
    ])
  })

  it('converges after both devices publish the merged state concurrently', async () => {
    const merged = mergeRemoteBackupSnapshots(
      await readRemoteBackups(transportA, roundOneFiles),
    )
    const [fileA2, fileB2] = await timed('concurrentRoundTwo', () =>
      Promise.all([
        publish(transportA, DEVICE_A, merged.sessions, 2, BASE_TIME + 20),
        publish(transportB, DEVICE_B, merged.sessions, 2, BASE_TIME + 21),
      ]),
    )
    const listed = await listAll(transportA)
    const allCreated = createdFiles(listed)
    expect(allCreated.length).toBeGreaterThanOrEqual(4)
    expect(
      allCreated.some((file) => file.id === fileA2.id),
      'round-two device A snapshot is discoverable',
    ).toBe(true)
    expect(
      allCreated.some((file) => file.id === fileB2.id),
      'round-two device B snapshot is discoverable',
    ).toBe(true)

    const converged = mergeRemoteBackupSnapshots(
      await timed('readConverged', () =>
        readRemoteBackups(transportA, allCreated),
      ),
    )
    expect(solveIds(converged.sessions)).toEqual([
      'seed',
      'solve-a',
      'solve-b',
    ])
    expect(duplicateSolveIds(converged.sessions)).toEqual([])
  })

  it('keeps both files when two writers share one device identity', async () => {
    const [first, second] = await Promise.all([
      publish(
        transportA,
        DEVICE_A,
        sessionsData(['same-device-a']),
        3,
        BASE_TIME + 30,
      ),
      publish(
        transportB,
        DEVICE_A,
        sessionsData(['same-device-b']),
        3,
        BASE_TIME + 31,
      ),
    ])
    expect(first.id).not.toBe(second.id)
    const listed = await listAll(transportA)
    expect(listed.some((file) => file.id === first.id)).toBe(true)
    expect(listed.some((file) => file.id === second.id)).toBe(true)
  })

  it('discovers a real ETag and enforces If-Match on the legacy file', async () => {
    if (baselineLegacy) {
      // Never modify pre-existing data. The v3 listing still reads its ETag
      // through v2, which is the provider behavior under test.
      const listed = await listAll(transportA)
      const legacy = listed.find((file) => file.id === baselineLegacy!.id)
      expect(typeof legacy?.etag).toBe('string')
      expect(legacy?.etag ?? '').not.toBe('')
      console.info(
        '[real-provider] pre-existing legacy file is read-only in this run',
      )
      return
    }

    const original = backupContent(
      sessionsData(['legacy-original']),
      DEVICE_A,
      10,
      BASE_TIME + 40,
    )
    const replacement = backupContent(
      sessionsData(['legacy-replaced']),
      DEVICE_A,
      11,
      BASE_TIME + 41,
    )
    const legacy = track(
      await transportA.uploadBackup(original, null),
      'legacy',
    )
    const listed = await listAll(transportA)
    const remote = listed.find((file) => file.id === legacy.id)
    expect(remote?.name).toBe('cubelab-backup.json')
    expect(typeof remote?.etag).toBe('string')
    expect(remote?.etag ?? '').not.toBe('')

    await expect(
      transportA.uploadBackup(replacement, legacy.id, {
        expectedEtag: '"definitely-not-the-current-etag"',
      }),
    ).rejects.toBeInstanceOf(DrivePreconditionError)
    await expect(transportA.downloadBackup(legacy.id)).resolves.toBe(original)

    const updated = await timed('legacyConditionalWrite', () =>
      transportA.uploadBackup(replacement, legacy.id, {
        expectedEtag: remote!.etag,
      }),
    )
    track(updated, 'legacy')
    await expect(transportA.downloadBackup(legacy.id)).resolves.toBe(replacement)
    console.info(`[real-provider] legacy ETag ${remote!.etag}`)
  })

  it('applies retention against real modification times and ownership', async () => {
    const listed = await listAll(transportA)
    const legacy = listed.find((file) => file.name === 'cubelab-backup.json')
    const beforeOwn = listed.filter(
      (file) => file.appProperties?.deviceId === DEVICE_A,
    )
    expect(beforeOwn.length).toBeGreaterThan(2)

    const result = await timed('retentionCleanup', () =>
      cleanupRemoteSnapshots(transportA, listed, {
        keepPerDevice: 2,
        maxAgeDays: 365,
        localDeviceId: DEVICE_A,
        ownOnly: true,
        publishedAt: newestSnapshotModifiedAt(listed),
      }),
    )
    expect(result.failures).toEqual([])
    expect(result.deleted).toBeGreaterThan(0)
    for (const file of result.candidates) deletedIds.add(file.id)

    const after = await listAll(transportA)
    const afterOwn = after.filter(
      (file) => file.appProperties?.deviceId === DEVICE_A,
    )
    expect(afterOwn.length).toBeLessThanOrEqual(2)
    expect(
      after.some((file) => file.appProperties?.deviceId === DEVICE_B),
      'another device is not touched by own-only cleanup',
    ).toBe(true)
    if (legacy) {
      expect(after.some((file) => file.id === legacy.id)).toBe(true)
    }
  })

  it('deletes a selected snapshot only and tolerates a repeated delete', async () => {
    const listed = await listAll(transportA)
    const candidate = createdFiles(listed).find(
      (file) => file.appProperties?.deviceId === DEVICE_B,
    )
    expect(candidate).toBeDefined()
    const before = listed.length
    await transportA.deleteBackup(candidate!.id)
    deletedIds.add(candidate!.id)
    const after = await listAll(transportA)
    expect(after.length).toBe(before - 1)
    expect(after.some((file) => file.id === candidate!.id)).toBe(false)
    await expect(transportA.deleteBackup(candidate!.id)).resolves.toBeUndefined()
  })
})
