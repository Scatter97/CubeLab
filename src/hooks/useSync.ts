import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { SessionsData, Settings } from '../types'
import { countSolves } from '../lib/sessions'
import { loadSessions } from '../lib/storage'
import { createBackup } from '../lib/backup'
import type { DriveTransport } from '../lib/driveTransport'
import {
  loadDriveBackupState,
  saveDriveBackupState,
} from '../lib/driveStorage'
import {
  loadSyncStorage,
  saveSyncStorage,
  SYNC_STORAGE_KEY,
  isActiveTombstone,
  type SyncPreferences,
  type SettingsFieldUpdates,
  type SyncStatus,
  type SyncStorageData,
  type SyncConflict,
} from '../lib/syncStorage'

import {
  createSyncEnvelope,
  findDuplicateSessionNames,
  mergeSessionsData,
  mergeTombstones,
  resolveRedirectConflicts,
  createTombstone,
} from '../lib/sync'
import { normalizeSessionRedirects, applySessionRedirects } from '../lib/sessionRedirects'
import { mergeSettingsData, SETTINGS_FIELD_KEYS } from '../lib/settingsMerge'
import { syncStateFingerprint } from '../lib/syncFingerprint'
import {
  deviceBackupFileName,
} from '../lib/driveTransport'
import {
  findDeviceBackup,
  listRemoteBackups,
  readRemoteBackups,
} from '../lib/remoteBackups'
import {
  ownSnapshotChanged,
  runWithDriveWriteLock,
} from '../lib/driveCoordination'

interface UseSyncOptions {
  transport: DriveTransport | null
  sessions: SessionsData
  settings: Settings
  storageOk: boolean
  timerActive: boolean
  onReplaceSessions: (data: SessionsData) => void
  onReplaceSettings: (settings: Settings) => void
  onNotify: (message: string) => void
  /**
   * Receives duplicate names plus an optional full summary. The summary lets the
   * app show one actionable toast instead of replacing the Review Merge action
   * with a second, plain status toast.
   */
  onDuplicateSessionDetected?: (names: string[], summary?: string) => void
}

export interface UseSyncResult {
  phase: SyncStatus
  lastSyncAt: number | null
  newSolvesSinceLastSync: number
  hasPendingChanges: boolean
  error: string | null
  conflictsCount: number
  pendingConflicts: SyncConflict[]
  duplicateNames: string[]
  approveSessionMerge: (sourceId: string, targetId: string) => void
  resolveConflict: (
    id: string,
    field: string,
    resolution: 'local' | 'remote',
    kind?: SyncConflict['kind'],
  ) => void
  preferences: SyncPreferences
  updatePreferences: (next: Partial<SyncPreferences>) => void
  syncNow: (reason?: string) => Promise<void>
  recordDeletion: (kind: 'solve' | 'session', id: string, sessionId?: string) => void
  restoreDeletion: (kind: 'solve' | 'session', id: string) => void
  resetBase: (data: SessionsData) => void
}

const MAX_BACKOFF_MS = 30_000
const MAX_SYNC_RETRIES = 5

function toMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return 'Synchronization failed.'
}

function settingsStateFingerprint(settings: Settings): string {
  return JSON.stringify(settings)
}

function changedSettingFields(previous: Settings, next: Settings): (keyof Settings)[] {
  return SETTINGS_FIELD_KEYS.filter(
    (key) => JSON.stringify(previous[key]) !== JSON.stringify(next[key]),
  )
}

function countSolvesInData(data: SessionsData): number {
  return countSolves(data.sessions)
}

/**
 * Keeps one record per solve/field. A newly raised conflict replaces an older
 * resolution for the same field; otherwise user resolutions survive a sync.
 */
function mergeConflictRecords(
  existing: readonly SyncConflict[],
  incoming: readonly SyncConflict[],
): SyncConflict[] {
  const records = new Map<string, SyncConflict>()
  for (const conflict of existing) {
    records.set(`${conflict.kind}:${conflict.id}:${conflict.field}`, conflict)
  }
  for (const conflict of incoming) {
    records.set(`${conflict.kind}:${conflict.id}:${conflict.field}`, conflict)
  }
  return [...records.values()].sort((left, right) => left.updatedAt - right.updatedAt).slice(-100)
}

function getRemoteFileId(): string | null {
  return loadDriveBackupState().remoteFileId
}

export function useSync({
  transport,
  sessions,
  settings,
  storageOk,
  timerActive,
  onReplaceSessions,
  onReplaceSettings,
  onNotify,
  onDuplicateSessionDetected,
}: UseSyncOptions): UseSyncResult {
  const [sync, setSync] = useState<SyncStorageData>(() => loadSyncStorage())
  const sessionsRef = useRef(sessions)
  const settingsRef = useRef(settings)
  const syncRef = useRef(sync)
  const timerActiveRef = useRef(timerActive)
  const runningRef = useRef<Promise<void> | null>(null)
  const syncNowRef = useRef<((reason?: string) => Promise<void>) | null>(null)
  const knownSessionsRef = useRef<SessionsData | null>(null)
  const leaderRef = useRef(false)
  const locksSupportedRef = useRef(typeof navigator !== 'undefined' && Boolean(navigator.locks))
  const backoffRef = useRef(1_000)
  const retryAttemptRef = useRef(0)
  const deferredSyncRef = useRef(false)
  const fallbackTimerRef = useRef<number | null>(null)
  const retryTimerRef = useRef<number | null>(null)
  const previousSettingsRef = useRef<Settings | null>(null)
  const replacementSettingsFingerprintRef = useRef<string | null>(null)

  // Keep the latest props available before the browser yields. A sync request
  // can finish while a local edit is being committed; the in-flight guards
  // must compare against the newest committed snapshot, not a stale one.
  useLayoutEffect(() => {
    sessionsRef.current = sessions
    settingsRef.current = settings
    timerActiveRef.current = timerActive
  }, [sessions, settings, timerActive])

  useEffect(() => {
    syncRef.current = sync
  }, [sync])

  const persist = useCallback((next: SyncStorageData) => {
    setSync(next)
    syncRef.current = next
    if (storageOk) saveSyncStorage(next)
  }, [storageOk])

  // Global settings are a plain values object. Stamp changed top-level fields
  // here so synchronization can merge independent edits without changing the
  // settings storage schema. A merge that we just applied is acknowledged by
  // fingerprint and never recorded as a new local edit.
  useLayoutEffect(() => {
    const previous = previousSettingsRef.current
    previousSettingsRef.current = settings
    const fingerprint = settingsStateFingerprint(settings)
    if (replacementSettingsFingerprintRef.current === fingerprint) {
      replacementSettingsFingerprintRef.current = null
      return
    }
    if (!previous) return
    const changed = changedSettingFields(previous, settings)
    if (changed.length === 0) return

    const now = Date.now()
    const editorId = syncRef.current.runtime.deviceId
    const settingsFieldUpdates: SettingsFieldUpdates = {
      ...syncRef.current.runtime.settingsFieldUpdates,
    }
    for (const key of changed) {
      settingsFieldUpdates[key] = { updatedAt: now, editorId }
    }
    persist({
      ...syncRef.current,
      runtime: {
        ...syncRef.current.runtime,
        settingsFieldUpdates,
      },
    })
  }, [persist, settings])

  // Track deletions locally through storage changes.
  useEffect(() => {
    const previous = knownSessionsRef.current
    if (previous) {
      const previousSolveIds = new Map<string, string>()
      for (const session of previous.sessions) {
        for (const solve of session.solves) previousSolveIds.set(solve.id, session.id)
      }
      const currentSolveIds = new Set<string>()
      for (const session of sessions.sessions) {
        for (const solve of session.solves) currentSolveIds.add(solve.id)
      }
      for (const [id, sessionId] of previousSolveIds.entries()) {
        if (!currentSolveIds.has(id)) {
          // Deletion will be recorded when sync runs if not already present.
          const already = syncRef.current.runtime.tombstones.some(
            (tombstone) =>
              tombstone.kind === 'solve' &&
              tombstone.id === id &&
              isActiveTombstone(tombstone),
          )
          if (!already) {
            const next = {
              ...syncRef.current,
              runtime: {
                ...syncRef.current.runtime,
                tombstones: [
                  ...syncRef.current.runtime.tombstones.filter(
                    (tombstone) => !(tombstone.kind === 'solve' && tombstone.id === id),
                  ),
                  createTombstone('solve', id, sessionId, syncRef.current.runtime.deviceId),
                ],
              },
            }
            persist(next)
          }
        }
      }

      const previousSessionIds = new Set(previous.sessions.map((s) => s.id))
      const currentSessionIds = new Set(sessions.sessions.map((s) => s.id))
      const redirectedIds = new Set((syncRef.current.runtime.sessionRedirects ?? []).map((redirect) => redirect.fromId))
      for (const id of previousSessionIds) {
        if (!currentSessionIds.has(id) && !redirectedIds.has(id)) {
          const already = syncRef.current.runtime.tombstones.some(
            (tombstone) =>
              tombstone.kind === 'session' &&
              tombstone.id === id &&
              isActiveTombstone(tombstone),
          )
          if (!already) {
            const deletedSession = previous.sessions.find((session) => session.id === id)
            const next = {
              ...syncRef.current,
              runtime: {
                ...syncRef.current.runtime,
                tombstones: [
                  ...syncRef.current.runtime.tombstones.filter(
                    (tombstone) => !(tombstone.kind === 'session' && tombstone.id === id),
                  ),
                  createTombstone(
                    'session',
                    id,
                    undefined,
                    syncRef.current.runtime.deviceId,
                    undefined,
                    deletedSession?.solves.map((solve) => solve.id),
                  ),
                ],
              },
            }
            persist(next)
          }
        }
      }
    }
    knownSessionsRef.current = sessions
  }, [sessions, persist])

  const recordDeletion = useCallback(
    (kind: 'solve' | 'session', id: string, sessionId?: string) => {
      const existing = syncRef.current.runtime.tombstones.find(
        (tombstone) => tombstone.kind === kind && tombstone.id === id,
      )
      if (existing && isActiveTombstone(existing)) return
      const deletedSession =
        kind === 'session'
          ? sessionsRef.current.sessions.find((session) => session.id === id)
          : undefined
      const next = {
        ...syncRef.current,
        runtime: {
          ...syncRef.current.runtime,
          tombstones: [
            ...syncRef.current.runtime.tombstones.filter(
              (tombstone) => !(tombstone.kind === kind && tombstone.id === id),
            ),
            createTombstone(
              kind,
              id,
              sessionId,
              syncRef.current.runtime.deviceId,
              undefined,
              deletedSession?.solves.map((solve) => solve.id),
            ),
          ],
        },
      }
      persist(next)
    },
    [persist],
  )

  /**
   * Undo is durable: the tombstone is retained with a newer `restoredAt`
   * revocation timestamp. Every device merges that record, so an already
   * published deletion cannot remove the solve again. A later deliberate
   * deletion gets a newer `deletedAt` and wins deterministically.
   */
  const restoreDeletion = useCallback(
    (kind: 'solve' | 'session', id: string) => {
      const now = Date.now()
      let changed = false
      const tombstones = syncRef.current.runtime.tombstones.map((tombstone) => {
        if (tombstone.kind !== kind || tombstone.id !== id) return tombstone
        if (tombstone.restoredAt !== undefined && tombstone.restoredAt >= now) {
          return tombstone
        }
        changed = true
        return {
          ...tombstone,
          restoredAt: Math.max(now, tombstone.deletedAt + 1),
        }
      })
      if (!changed) return
      persist({
        ...syncRef.current,
        runtime: {
          ...syncRef.current.runtime,
          tombstones,
        },
      })
    },
    [persist],
  )

  const resetBase = useCallback(
    (data: SessionsData) => {
      // A local import or Drive restore is an explicit local edit. Stamp every
      // global setting so the next merge cannot silently replace imported
      // values with an older cloud field.
      const now = Date.now()
      const editorId = syncRef.current.runtime.deviceId
      const settingsFieldUpdates: SettingsFieldUpdates = {}
      for (const key of SETTINGS_FIELD_KEYS) {
        settingsFieldUpdates[key] = { updatedAt: now, editorId }
      }
      const next = {
        ...syncRef.current,
        runtime: {
          ...syncRef.current.runtime,
          tombstones: [],
          conflicts: [],
          sessionRedirects: [],
          pendingDuplicateNames: [],
          settingsFieldUpdates,
          // Force the next run to publish the explicit replacement instead of
          // treating it as already confirmed.
          lastSyncedFingerprint: null,
          solveCountAtLastSync: countSolvesInData(data),
          lastSyncStatus:
            syncRef.current.preferences.enabled ? 'pending' as SyncStatus : syncRef.current.runtime.lastSyncStatus,
        },
      }
      persist(next)
      knownSessionsRef.current = data
    },
    [persist],
  )

  const approveSessionMerge = useCallback(
    (sourceId: string, targetId: string) => {
      const now = Date.now()
      const combined = normalizeSessionRedirects([
        ...(syncRef.current.runtime.sessionRedirects ?? []),
        {
          fromId: sourceId,
          toId: targetId,
          approvedAt: now,
          byDeviceId: syncRef.current.runtime.deviceId,
        },
      ])
      const redirectedSessions = applySessionRedirects(sessionsRef.current, combined)
      knownSessionsRef.current = redirectedSessions
      sessionsRef.current = redirectedSessions
      onReplaceSessions(redirectedSessions)

      persist({
        ...syncRef.current,
        runtime: {
          ...syncRef.current.runtime,
          sessionRedirects: combined,
          // Recompute against the post-merge collection. Merging one pair must
          // not hide a third session that still shares the same name.
          pendingDuplicateNames: findDuplicateSessionNames(
            redirectedSessions.sessions,
          ),
        },
      })

      window.setTimeout(() => void syncNowRef.current?.('merge'), 0)
    },
    [onReplaceSessions, persist],
  )

  const resolveConflict = useCallback(
    (
      id: string,
      field: string,
      resolution: 'local' | 'remote',
      kind?: SyncConflict['kind'],
    ) => {
      const conflicts = syncRef.current.runtime.conflicts.map((conflict) => {
        if (
          conflict.id !== id ||
          conflict.field !== field ||
          (kind !== undefined && conflict.kind !== kind) ||
          conflict.resolution !== 'manual-pending'
        ) {
          return conflict
        }
        // The approval must outrank both reviewed versions, including a remote
        // timestamp that is ahead because of clock skew.
        return {
          ...conflict,
          resolution,
          updatedAt: Math.max(
            Date.now(),
            conflict.updatedAt,
            conflict.localUpdatedAt,
            conflict.remoteUpdatedAt,
          ),
        }
      })
      const stillPending = conflicts.some((conflict) => conflict.resolution === 'manual-pending')
      persist({
        ...syncRef.current,
        runtime: {
          ...syncRef.current.runtime,
          conflicts,
          lastSyncStatus: stillPending ? 'conflict' : 'pending',
          lastError: stillPending
            ? syncRef.current.runtime.lastError
            : null,
        },
      })

      if (!stillPending) {
        window.setTimeout(() => void syncNowRef.current?.('conflict-resolution'), 0)
      }
    },
    [persist],
  )

  const updatePreferences = useCallback(
    (next: Partial<SyncPreferences>) => {
      const enabled = next.enabled ?? syncRef.current.preferences.enabled
      const nextStatus =
        enabled
          ? syncRef.current.runtime.lastSyncStatus === 'disabled'
            ? 'pending'
            : syncRef.current.runtime.lastSyncStatus
          : 'disabled'
      persist({
        ...syncRef.current,
        preferences: { ...syncRef.current.preferences, ...next },
        runtime: { ...syncRef.current.runtime, lastSyncStatus: nextStatus },
      })
    },
    [persist],
  )

  // Retries are bounded so a broken transport or a constantly edited timer
  // cannot spin forever. Any external trigger (manual, startup, interval,
  // reconnect) starts a fresh budget.
  const queueRetry = useCallback(
    (delay: number) => {
      if (retryAttemptRef.current >= MAX_SYNC_RETRIES) {
        const runtime = syncRef.current.runtime
        if (runtime.lastSyncStatus !== 'conflict') {
          persist({
            ...syncRef.current,
            runtime: {
              ...runtime,
              lastSyncStatus: 'failed',
              lastError: runtime.lastError?.includes('Automatic retries paused')
                ? runtime.lastError
                : `${runtime.lastError ?? 'Synchronization failed.'} Automatic retries paused; use Sync now.`,
            },
          })
        }
        return
      }
      retryAttemptRef.current += 1
      if (retryTimerRef.current !== null) window.clearTimeout(retryTimerRef.current)
      retryTimerRef.current = window.setTimeout(() => {
        retryTimerRef.current = null
        void syncNowRef.current?.('retry')
      }, delay)
    },
    [persist],
  )

  const syncNow = useCallback(
    async (reason?: string) => {
      // A user, startup, interval, reconnect, or exit trigger starts a fresh
      // bounded retry budget. Only an automatic retry keeps the current budget.
      if (reason !== 'retry') {
        retryAttemptRef.current = 0
        backoffRef.current = 1_000
        if (retryTimerRef.current !== null) {
          window.clearTimeout(retryTimerRef.current)
          retryTimerRef.current = null
        }
      }
      if (!syncRef.current.preferences.enabled) {
        if (reason === 'manual') onNotify('Enable automatic synchronization first.')
        return
      }
      if (locksSupportedRef.current && !leaderRef.current) {
        // Another tab owns the lock. Never silently promote a follower.
        if (reason === 'manual') onNotify('Another CubeLab tab is handling synchronization.')
        return
      }
      if (runningRef.current) {
        await runningRef.current
        return
      }

      const promise = (async () => {
        if (timerActiveRef.current) {
          // Never replace data or start network work while the timer is armed,
          // running, or inspecting. An idle transition retries once, so a long
          // session cannot exhaust the automatic retry budget.
          deferredSyncRef.current = true
          persist({
            ...syncRef.current,
            runtime: {
              ...syncRef.current.runtime,
              lastSyncStatus: 'pending',
              lastError: 'Synchronization will resume when the timer is idle.',
            },
          })
          return
        }

        persist({ ...syncRef.current, runtime: { ...syncRef.current.runtime, lastSyncStatus: 'syncing', lastError: null } })

        try {
          if (!transport) throw new Error('Google Drive is not configured.')
          if (!transport.isConnected()) {
            if (reason === 'manual') {
              try {
                await transport.connect()
              } catch (caughtError) {
                const authError =
                  toMessage(caughtError).toLowerCase().includes('connect') ||
                  toMessage(caughtError).toLowerCase().includes('cancel')
                  ? 'Google Drive connection required.'
                  : toMessage(caughtError)
                persist({
                  ...syncRef.current,
                  runtime: {
                    ...syncRef.current.runtime,
                    lastSyncStatus: 'auth-required',
                    lastError: authError,
                  },
                })
                onNotify('Connect Google Drive first.')
                return
              }
            } else {
              persist({
                ...syncRef.current,
                runtime: {
                  ...syncRef.current.runtime,
                  lastSyncStatus: 'auth-required',
                  lastError: 'Google Drive connection required.',
                },
              })
              return
            }
          }

          const syncState = syncRef.current
          const deviceId = syncState.runtime.deviceId
          const local = sessionsRef.current
          const localSettings = settingsRef.current
          const previousDuplicateNames = syncState.runtime.pendingDuplicateNames ?? []
          const startFingerprint = syncStateFingerprint(local, localSettings)
          const isLocalUnchanged = () =>
            syncStateFingerprint(sessionsRef.current, settingsRef.current) === startFingerprint

          const remoteFiles = await listRemoteBackups(transport)
          const snapshots = await readRemoteBackups(transport, remoteFiles)
          const remoteRevision = snapshots.reduce(
            (highest, snapshot) => Math.max(highest, snapshot.backup.sync?.revision ?? 0),
            0,
          )
          const mergedTombstones = mergeTombstones(
            syncState.runtime.tombstones,
            ...snapshots.map((snapshot) => snapshot.backup.sync?.tombstones ?? []),
          )
          const redirectResult = resolveRedirectConflicts({
            local: syncState.runtime.sessionRedirects ?? [],
            remote: snapshots.flatMap(
              (snapshot) => snapshot.backup.sync?.sessionRedirects ?? [],
            ),
            manualConflictReview: syncState.preferences.manualConflictReview,
            resolvedConflicts: syncState.runtime.conflicts,
          })
          const sessionRedirects = redirectResult.sessionRedirects
          const conflicts: SyncConflict[] = [...redirectResult.conflicts]

          // Fold every device snapshot into one merged view. The merge is
          // commutative for solve identities, so file arrival order cannot lose
          // data; metadata fields use their own timestamps.
          let mergedSessions = local
          let adoptedLocalDefault = false
          let recoveredSolves = 0
          for (const snapshot of snapshots) {
            const result = mergeSessionsData({
              local: mergedSessions,
              remote: snapshot.backup.sessions,
              tombstones: mergedTombstones,
              sessionRedirects,
              deviceId,
              manualConflictReview: syncState.preferences.manualConflictReview,
              resolvedConflicts: syncState.runtime.conflicts,
            })
            mergedSessions = result.merged
            adoptedLocalDefault = adoptedLocalDefault || result.adoptedLocalDefault
            recoveredSolves += result.recoveredSolves
            conflicts.push(...result.conflicts)
          }
          // Duplicate names must be judged against the final collection. A later
          // snapshot without its own collision must not erase an earlier warning.
          const duplicateSessionNames = findDuplicateSessionNames(
            mergedSessions.sessions,
          )

          // Merge remote device settings with each other first, using their
          // field metadata, then merge the aggregate with this device so the
          // first-sync default policy applies exactly once.
          let aggregateRemoteSettings: Settings | null = null
          let aggregateRemoteSettingsUpdates: SettingsFieldUpdates = {}
          if (snapshots.length > 0) {
            aggregateRemoteSettings = snapshots[0]!.backup.settings
            aggregateRemoteSettingsUpdates =
              snapshots[0]!.backup.sync?.settingsFieldUpdates ?? {}
            for (const snapshot of snapshots.slice(1)) {
              const result = mergeSettingsData({
                local: aggregateRemoteSettings,
                remote: snapshot.backup.settings,
                localFieldUpdates: aggregateRemoteSettingsUpdates,
                remoteFieldUpdates: snapshot.backup.sync?.settingsFieldUpdates ?? {},
                remoteUpdatedAt: snapshot.updatedAt,
                lastSyncAt: 1,
                manualConflictReview: false,
              })
              aggregateRemoteSettings = result.settings
              aggregateRemoteSettingsUpdates = result.fieldUpdates
            }
          }

          let mergedSettings = localSettings
          let mergedSettingsUpdates = syncState.runtime.settingsFieldUpdates
          if (aggregateRemoteSettings) {
            const result = mergeSettingsData({
              local: localSettings,
              remote: aggregateRemoteSettings,
              localFieldUpdates: syncState.runtime.settingsFieldUpdates,
              remoteFieldUpdates: aggregateRemoteSettingsUpdates,
              remoteUpdatedAt: snapshots.reduce(
                (newest, snapshot) => Math.max(newest, snapshot.updatedAt),
                0,
              ),
              lastSyncAt: syncState.runtime.lastSyncAt,
              manualConflictReview: syncState.preferences.manualConflictReview,
              resolvedConflicts: syncState.runtime.conflicts,
              localEditorId: deviceId,
            })
            mergedSettings = result.settings
            mergedSettingsUpdates = result.fieldUpdates
            conflicts.push(...result.conflicts)
          }

          const deduplicatedConflicts = mergeConflictRecords([], conflicts)

          // Never publish a provisional resolution when the user requested
          // approval. Preserve local data and the conflict record for review.
          const pendingConflicts = deduplicatedConflicts.filter(
            (conflict) => conflict.resolution === 'manual-pending',
          )
          if (pendingConflicts.length > 0) {
            persist({
              ...syncRef.current,
              runtime: {
                ...syncRef.current.runtime,
                conflicts: mergeConflictRecords(
                  syncRef.current.runtime.conflicts.filter(
                    (conflict) => conflict.resolution !== 'manual-pending',
                  ),
                  pendingConflicts,
                ),
                lastSyncStatus: 'conflict',
                lastError: 'Resolve same-field conflicts before publishing a cloud backup. Local and cloud data were not overwritten.',
              },
            })
            onNotify('Synchronization paused: conflicting edits need review. Neither local nor cloud data was replaced.')
            return
          }

          // A user may record a solve or edit settings while the download /
          // merge is in flight. Never replace that newer snapshot with the
          // earlier merge result.
          if (!isLocalUnchanged()) {
            persist({
              ...syncRef.current,
              runtime: {
                ...syncRef.current.runtime,
                lastSyncStatus: 'pending',
                lastError: 'Local changes occurred during synchronization; another sync is needed.',
              },
            })
            queueRetry(500)
            return
          }

          const localIds = new Set(
            local.sessions.flatMap((session) => session.solves.map((solve) => solve.id)),
          )
          const remoteIds = new Set(
            snapshots.flatMap((snapshot) =>
              snapshot.backup.sessions.sessions.flatMap((session) =>
                session.solves.map((solve) => solve.id),
              ),
            ),
          )
          const mergedIds = new Set(
            mergedSessions.sessions.flatMap((session) =>
              session.solves.map((solve) => solve.id),
            ),
          )
          const uploadedSolves = [...localIds].filter(
            (id) => !remoteIds.has(id) && mergedIds.has(id),
          ).length
          const importedSolves = [...mergedIds].filter((id) => !localIds.has(id)).length
          const importedSessionNames = mergedSessions.sessions
            .filter((session) =>
              session.solves.some((solve) => !localIds.has(solve.id)),
            )
            .map((session) => session.name)
            .filter(
              (name, index, names) => names.indexOf(name) === index,
            )

          const mergedFingerprint = syncStateFingerprint(mergedSessions, mergedSettings)
          const baseRevision = Math.max(
            remoteRevision,
            syncState.runtime.lastRemoteRevision ?? 0,
          )
          const nextRevision = baseRevision + 1
          const ownName = deviceBackupFileName(deviceId)
          const ownFile = findDeviceBackup(remoteFiles, ownName)
          const remoteStateUnchanged =
            mergedFingerprint === syncRef.current.runtime.lastSyncedFingerprint &&
            remoteRevision <= (syncRef.current.runtime.lastRemoteRevision ?? 0) &&
            JSON.stringify(mergedTombstones) === JSON.stringify(syncRef.current.runtime.tombstones) &&
            JSON.stringify(sessionRedirects) ===
              JSON.stringify(syncRef.current.runtime.sessionRedirects ?? [])
          const remoteStorePresent = transport.uploadDeviceBackup
            ? Boolean(ownFile)
            : remoteFiles.length > 0

          let updatedConflicts = mergeConflictRecords(
            syncRef.current.runtime.conflicts.filter(
              (conflict) => conflict.resolution !== 'manual-pending',
            ),
            deduplicatedConflicts,
          )
          let lastRemoteRevision = baseRevision
          let remoteFileId: string | null = ownFile?.id ?? null
          let remoteModifiedTime: string | null = ownFile?.modifiedTime ?? null

          if (remoteStateUnchanged && remoteStorePresent) {
            // Nothing relevant changed since the last confirmed write. Avoid a
            // redundant upload while still refreshing the status timestamp.
          } else {
            const envelope = createSyncEnvelope(
              deviceId,
              nextRevision,
              mergedTombstones,
              updatedConflicts,
              sessionRedirects,
              mergedSettingsUpdates,
            )
            const backup = createBackup(
              mergedSessions,
              mergedSettings,
              new Date(),
              envelope,
            )

            // Re-check immediately before the remote write. The upload itself
            // cannot be atomic, but local data is never replaced by a stale
            // in-flight snapshot.
            if (!isLocalUnchanged()) {
              persist({
                ...syncRef.current,
                runtime: {
                  ...syncRef.current.runtime,
                  lastSyncStatus: 'pending',
                  lastError: 'Local data changed before upload. Synchronization was cancelled safely.',
                },
              })
              queueRetry(500)
              return
            }

            const expectedOwnFile = transport.uploadDeviceBackup
              ? ownFile
              : remoteFiles[0]
            const content = JSON.stringify(backup)
            const write = await runWithDriveWriteLock(async () => {
              // Another tab (or a copied profile with the same device ID) may
              // have replaced this device's snapshot after our read. Re-list
              // while holding the same-origin write lock; a changed file aborts
              // the write instead of silently overwriting newer data.
              const currentFiles = await listRemoteBackups(transport)
              const currentOwnFile = transport.uploadDeviceBackup
                ? findDeviceBackup(currentFiles, ownName)
                : currentFiles[0]
              if (ownSnapshotChanged(expectedOwnFile, currentOwnFile)) {
                return { status: 'remote-changed' as const }
              }
              if (!isLocalUnchanged()) {
                return { status: 'local-changed' as const }
              }
              const existingFileId = transport.uploadDeviceBackup
                ? currentOwnFile?.id
                : currentOwnFile?.id ?? getRemoteFileId()
              const result = transport.uploadDeviceBackup
                ? await transport.uploadDeviceBackup(
                    content,
                    deviceId,
                    existingFileId,
                  )
                : await transport.uploadBackup(content, existingFileId)
              return { status: 'uploaded' as const, result }
            })

            if (write.status === 'remote-changed') {
              persist({
                ...syncRef.current,
                runtime: {
                  ...syncRef.current.runtime,
                  lastSyncStatus: 'pending',
                  lastError:
                    "Another CubeLab writer changed this device's cloud snapshot. Synchronization will retry from the newer snapshot.",
                },
              })
              queueRetry(500)
              return
            }
            if (write.status === 'local-changed') {
              persist({
                ...syncRef.current,
                runtime: {
                  ...syncRef.current.runtime,
                  lastSyncStatus: 'pending',
                  lastError: 'Local data changed before upload. Synchronization was cancelled safely.',
                },
              })
              queueRetry(500)
              return
            }

            const result = write.result
            remoteFileId = result.id
            remoteModifiedTime = result.modifiedTime
            lastRemoteRevision = nextRevision

            // Do not overwrite solves added while the network upload was in
            // progress. The uploaded snapshot is now the confirmed remote
            // base, but local state remains authoritative and a follow-up run
            // merges the newer edits.
            if (!isLocalUnchanged()) {
              persist({
                ...syncRef.current,
                runtime: {
                  ...syncRef.current.runtime,
                  lastSyncedFingerprint: mergedFingerprint,
                  lastRemoteRevision: nextRevision,
                  lastSyncStatus: 'pending',
                  lastError: 'New local changes occurred during upload; another sync is needed.',
                },
              })
              queueRetry(500)
              return
            }
          }

          // Publish only after upload success; failed writes cannot cause an
          // adopted snapshot to erase unsaved local work.
          knownSessionsRef.current = mergedSessions
          sessionsRef.current = mergedSessions
          settingsRef.current = mergedSettings
          replacementSettingsFingerprintRef.current =
            settingsStateFingerprint(mergedSettings)
          onReplaceSessions(mergedSessions)
          onReplaceSettings(mergedSettings)

          const now = Date.now()
          updatedConflicts = mergeConflictRecords(
            updatedConflicts.filter(
              (conflict) => conflict.resolution !== 'manual-pending',
            ),
            [],
          )

          const next = {
            ...syncRef.current,
            runtime: {
              ...syncRef.current.runtime,
              lastSyncAt: now,
              lastSyncStatus: 'synced' as SyncStatus,
              lastError: null,
              solveCountAtLastSync: countSolvesInData(mergedSessions),
              lastRemoteRevision,
              tombstones: mergedTombstones,
              conflicts: updatedConflicts.slice(-100),
              sessionRedirects,
              pendingDuplicateNames: duplicateSessionNames,
              settingsFieldUpdates: mergedSettingsUpdates,
              lastSyncedFingerprint: mergedFingerprint,
            },
          }
          persist(next)

          backoffRef.current = 1_000
          retryAttemptRef.current = 0

          if (remoteFileId) {
            const driveState = loadDriveBackupState()
            saveDriveBackupState({
              ...driveState,
              remoteFileId,
              remoteModifiedTime,
              lastBackupAt: now,
              lastRestoreAt: driveState.lastRestoreAt,
              connectedAccountLabel:
                transport.accountLabel || driveState.connectedAccountLabel,
            })
          }

          if (reason === 'reconnect' || reason === 'manual') {
            const messages: string[] = []
            if (adoptedLocalDefault) {
              messages.push('Cloud sessions imported')
            }
            if (uploadedSolves > 0) {
              messages.push(
                `${uploadedSolves} new local solve${uploadedSolves === 1 ? '' : 's'} uploaded`,
              )
            }
            if (importedSolves > 0) {
              const where =
                importedSessionNames.length === 0
                  ? ''
                  : importedSessionNames.length === 1
                    ? ` into '${importedSessionNames[0]}'`
                    : ` into ${importedSessionNames
                        .map((name) => `'${name}'`)
                        .join(', ')}`
              messages.push(
                `${importedSolves} cloud solve${importedSolves === 1 ? '' : 's'} merged${where}`,
              )
            }
            if (recoveredSolves > 0) {
              messages.push(
                `${recoveredSolves} solve${recoveredSolves === 1 ? '' : 's'} recovered from a deleted session`,
              )
            }
            if (
              deduplicatedConflicts.length > 0 &&
              !syncRef.current.preferences.manualConflictReview
            ) {
              messages.push(
                `${deduplicatedConflicts.length} conflict${
                  deduplicatedConflicts.length === 1 ? '' : 's'
                } automatically resolved`,
              )
            }

            const duplicateMessage =
              duplicateSessionNames.length > 0
                ? `CubeLab found separate sessions named ${duplicateSessionNames
                    .map((name) => `'${name}'`)
                    .join(', ')}. They remain separate until you approve a merge.`
                : null
            const newlyDetectedDuplicateNames = duplicateSessionNames.filter(
              (name) => !previousDuplicateNames.includes(name),
            )

            if (
              duplicateMessage &&
              newlyDetectedDuplicateNames.length > 0 &&
              onDuplicateSessionDetected
            ) {
              // One actionable toast carries the full summary, so a second
              // status toast cannot replace the Review Merge action.
              onDuplicateSessionDetected(
                duplicateSessionNames,
                [...messages, duplicateMessage].join(' · '),
              )
            } else {
              if (duplicateMessage && !onDuplicateSessionDetected) {
                messages.push(duplicateMessage)
              }
              if (messages.length > 0) {
                onNotify(messages.join(' · ') + '.')
              } else if (reason === 'manual') {
                onNotify('Synchronization complete. No new solves were exchanged.')
              }
            }
          }
        } catch (caught) {
          const message = toMessage(caught)
          const authRequired =
            message.toLowerCase().includes('authorization') ||
            message.toLowerCase().includes('connect')
          persist({
            ...syncRef.current,
            runtime: {
              ...syncRef.current.runtime,
              lastSyncStatus: authRequired ? 'auth-required' : 'failed',
              lastError: message,
            },
          })
          if (!authRequired) {
            backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF_MS)
            queueRetry(backoffRef.current)
          }
        }
      })()

      runningRef.current = promise
      await promise.finally(() => {
        runningRef.current = null
      })
    },
    [
      persist,
      queueRetry,
      transport,
      onReplaceSessions,
      onReplaceSettings,
      onNotify,
      onDuplicateSessionDetected,
    ],
  )

  useEffect(() => {
    syncNowRef.current = syncNow
  }, [syncNow])

  // Resume a sync that was deferred by an active timer exactly once, when the
  // timer returns to idle.
  useEffect(() => {
    if (timerActive || !deferredSyncRef.current) return
    deferredSyncRef.current = false
    if (syncRef.current.preferences.enabled) {
      window.setTimeout(() => void syncNowRef.current?.('timer-idle'), 0)
    }
  }, [timerActive])

  // Web Locks guarantees one syncing tab. Followers never self-elect while
  // a lock holder exists, and lock ownership ends on unmount.
  useEffect(() => {
    const runStartup = () => {
      const current = syncRef.current
      if (!current.preferences.enabled) return
      if (current.runtime.lastSyncStatus === 'syncing') {
        // This status survived a reload, so the previous attempt never
        // completed. Resume it even when startup sync is disabled.
        persist({
          ...current,
          runtime: {
            ...current.runtime,
            lastSyncStatus: 'pending',
            lastError: null,
          },
        })
        window.setTimeout(() => void syncNowRef.current?.('resume'), 0)
        return
      }
      if (current.preferences.syncOnStartup) {
        window.setTimeout(() => void syncNowRef.current?.('startup'), 0)
      }
    }

    const locks = navigator.locks
    if (!locks) {
      leaderRef.current = true
      runStartup()
      return () => { leaderRef.current = false }
    }
    locksSupportedRef.current = true
    let released = false
    let releaseLock: (() => void) | undefined
    void locks.request('cubelab-sync-leader', async () => {
      if (released) return
      leaderRef.current = true
      runStartup()
      await new Promise<void>((resolve) => { releaseLock = resolve })
      leaderRef.current = false
    })
    return () => {
      released = true
      leaderRef.current = false
      releaseLock?.()
    }
  }, [persist])

  // Followers mirror storage changes.
  useEffect(() => {
    const handler = (event: StorageEvent) => {
      if (event.key === SYNC_STORAGE_KEY && syncRef.current?.preferences) {
        setSync(loadSyncStorage())
      }
      if (event.key === 'cubelab:sessions:v1') {
        try {
          const loaded = loadSessions()
          onReplaceSessions(loaded)
        } catch {
          // ignore follower parse failures
        }
      }
    }
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }, [onReplaceSessions])

  // Network listeners.
  useEffect(() => {
    const handleOnline = () => {
      if (syncRef.current.preferences.enabled && syncRef.current.preferences.syncOnReconnect) {
        persist({
          ...syncRef.current,
          runtime: { ...syncRef.current.runtime, lastSyncStatus: 'pending' },
        })
        window.setTimeout(() => void syncNow('reconnect'), 0)
      }
    }
    const handleOffline = () => {
      if (syncRef.current.preferences.enabled) {
        persist({
          ...syncRef.current,
          runtime: { ...syncRef.current.runtime, lastSyncStatus: 'offline' },
        })
      }
    }
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    if (!navigator.onLine && syncRef.current.preferences.enabled) {
      handleOffline()
    }
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [persist, syncNow])

  // Visibility / pagehide.
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden' && syncRef.current.preferences.enabled && syncRef.current.preferences.syncOnExit) {
        void syncNow('exit')
      }
    }
    const handlePageHide = () => {
      if (syncRef.current.preferences.enabled && syncRef.current.preferences.syncOnExit) {
        void syncNow('exit')
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('pagehide', handlePageHide)
    window.addEventListener('beforeunload', handlePageHide)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('pagehide', handlePageHide)
      window.removeEventListener('beforeunload', handlePageHide)
    }
  }, [syncNow])

  const localStateFingerprint = useMemo(
    () => syncStateFingerprint(sessions, settings),
    [sessions, settings],
  )
  const hasPendingChanges =
    sync.preferences.enabled &&
    sync.runtime.lastSyncedFingerprint !== localStateFingerprint

  useEffect(
    () => () => {
      if (fallbackTimerRef.current !== null) {
        window.clearTimeout(fallbackTimerRef.current)
        fallbackTimerRef.current = null
      }
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current)
        retryTimerRef.current = null
      }
    },
    [],
  )

  // Time-based scheduling. If the timer is active, the next interval tick
  // simply checks again rather than spinning a nested timeout.
  useEffect(() => {
    if (!syncRef.current.preferences.enabled) return

    const intervalMs = syncRef.current.preferences.intervalMinutes * 60 * 1000

    const runScheduled = () => {
      if (timerActiveRef.current) return
      void syncNow('scheduled')
    }

    // Automatic synchronization is intentionally always combined.
    let intervalId: number | null = null
    intervalId = window.setInterval(runScheduled, intervalMs)

    return () => {
      if (intervalId !== null) window.clearInterval(intervalId)
    }
  }, [sync.preferences.enabled, sync.preferences.intervalMinutes, syncNow])

  // Solve-count trigger + non-solve fallback for any dirty state (solves,
  // session metadata, preferences, or settings).
  useEffect(() => {
    if (!sync.preferences.enabled || !hasPendingChanges || timerActive) {
      if (fallbackTimerRef.current !== null) {
        window.clearTimeout(fallbackTimerRef.current)
        fallbackTimerRef.current = null
      }
      return
    }

    const pendingSolves = Math.max(
      0,
      countSolvesInData(sessions) - syncRef.current.runtime.solveCountAtLastSync,
    )
    const shouldSolveSync =
      pendingSolves >= syncRef.current.preferences.solveThreshold

    if (shouldSolveSync) {
      window.setTimeout(() => {
        if (!timerActiveRef.current) void syncNow('solve-count')
      }, 0)
      return
    }

    if (fallbackTimerRef.current === null) {
      fallbackTimerRef.current = window.setTimeout(() => {
        fallbackTimerRef.current = null
        if (!syncRef.current.preferences.enabled || timerActiveRef.current) return
        void syncNow('fallback')
      }, Math.max(60_000, syncRef.current.preferences.intervalMinutes * 60 * 1000))
    }
  }, [
    hasPendingChanges,
    sessions,
    sync.preferences.enabled,
    sync.preferences.solveThreshold,
    timerActive,
    syncNow,
  ])

  const newSolvesSinceLastSync = useMemo(() => {
    if (!sync.preferences.enabled) return 0
    return Math.max(0, countSolvesInData(sessions) - sync.runtime.solveCountAtLastSync)
  }, [sessions, sync.preferences.enabled, sync.runtime.solveCountAtLastSync])

  const pendingConflicts = useMemo(
    () => sync.runtime.conflicts.filter((conflict) => conflict.resolution === 'manual-pending'),
    [sync.runtime.conflicts],
  )
  const conflictsCount = pendingConflicts.length

  const phase: SyncStatus = sync.preferences.enabled
    ? sync.runtime.lastSyncStatus === 'synced' && hasPendingChanges
      ? 'pending'
      : sync.runtime.lastSyncStatus
    : 'disabled'

  return {
    phase,
    lastSyncAt: sync.runtime.lastSyncAt,
    newSolvesSinceLastSync,
    hasPendingChanges,
    error: sync.runtime.lastError,
    conflictsCount,
    pendingConflicts,
    duplicateNames: sync.runtime.pendingDuplicateNames ?? [],
    preferences: sync.preferences,
    updatePreferences,
    syncNow: async (reason?: string) => {
      try {
        await syncNow(reason ?? 'manual')
      } catch {
        // syncNow catches and records internal failures.
      }
    },
    recordDeletion,
    restoreDeletion,
    resetBase,
    approveSessionMerge,
    resolveConflict,
  }
}
