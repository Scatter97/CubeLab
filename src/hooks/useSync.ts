import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import type { Session, SessionsData, Settings } from '../types'
import { countSolves, reconcileExternalSessions } from '../lib/sessions'
import { loadSessions, loadSettings, saveSessions } from '../lib/storage'
import { createBackup, serializeBackupChecked } from '../lib/backup'
import type { DriveTransport } from '../lib/driveTransport'
import { isDrivePreconditionError } from '../lib/driveTransport'
import {
  applyPendingSolveRestores,
  loadSolveRecovery,
  saveSolveRecovery,
} from '../lib/solveRecovery'
import {
  loadDriveBackupState,
  saveDriveBackupState,
} from '../lib/driveStorage'
import {
  loadSyncStorage,
  saveSyncStorage,
  SYNC_STORAGE_KEY,
  isActiveTombstone,
  MAX_CONFLICT_AUDIT_ENTRIES,
  type SyncPreferences,
  type SettingsFieldUpdates,
  type SyncStatus,
  type SyncStorageData,
  type SyncConflict,
  type ConflictAuditEntry,
} from '../lib/syncStorage'

import {
  createSyncEnvelope,
  findDuplicateSessionNames,
  mergeSessionsData,
  mergeTombstones,
  resolveRedirectConflicts,
  createTombstone,
} from '../lib/sync'
import { normalizeSessionRedirects } from '../lib/sessionRedirects'
import { mergeSettingsData, SETTINGS_FIELD_KEYS } from '../lib/settingsMerge'
import {
  createAdditiveImportSyncStorage,
  createResetBaseSyncStorage,
} from '../lib/syncBase'
import {
  loadReplacementJournal,
  pendingReplacementMessage,
  recoverPendingReplacement,
  replacementBlocksSync,
  REPLACEMENT_STORAGE_KEY,
} from '../lib/replacement'
import { syncStateFingerprint } from '../lib/syncFingerprint'
import {
  applyPendingCompletion,
  loadPendingCompletion,
} from '../lib/pendingCompletion'
import {
  findOwnSnapshots,
  listRemoteBackups,
  readRemoteBackups,
} from '../lib/remoteBackups'
import { cleanupRemoteSnapshots } from '../lib/snapshotRetention'
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
  /**
   * Fields just adopted from another tab's settings write. Their external
   * timestamps are authoritative, so they must not be stamped as new local
   * edits.
   */
  adoptedSettingsFieldsRef?: MutableRefObject<ReadonlySet<keyof Settings> | null>
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
  /** Local-only history of manual conflict decisions, newest first. */
  conflictAudit: ConflictAuditEntry[]
  duplicateNames: string[]
  /**
   * Records whole-session merge redirects before the local collection changes.
   * Returns false without changing sync storage when the write cannot be saved.
   */
  recordSessionMerges: (
    targetId: string,
    sourceIds: readonly string[],
  ) => boolean
  /** Rolls back redirects recorded by a merge that could not be saved locally. */
  removeSessionMerges: (
    targetId: string,
    sourceIds: readonly string[],
  ) => boolean
  resolveConflict: (
    id: string,
    field: string,
    resolution: 'local' | 'remote',
    kind?: SyncConflict['kind'],
  ) => void
  /**
   * Reverses a recorded decision. The stored approval flips; the next merge
   * applies the other version when it is still present in a cloud snapshot.
   * Returns an error instead of pretending a superseded decision was reversed.
   */
  undoConflictResolution: (
    auditId: string,
  ) => { ok: true } | { ok: false; error: string }
  /**
   * Clears only derived sync bookkeeping so the next run re-reads every remote
   * snapshot. Sessions, tombstones, redirects, conflicts, and audit history are
   * preserved.
   */
  repairSyncState: () => void
  preferences: SyncPreferences
  updatePreferences: (next: Partial<SyncPreferences>) => void
  syncNow: (reason?: string) => Promise<void>
  recordDeletion: (kind: 'solve' | 'session' | 'event', id: string, sessionId?: string) => boolean
  /**
   * Records a session tombstone and a durable solve tombstone for every solve
   * it currently contains. Used before a confirmed single-session delete so a
   * stale copy left in another session by a split cannot resurrect it.
   */
  recordSessionDeletion: (session: Session) => boolean
  /** Records many solve deletions in one durable sync-storage write. */
  recordDeletions: (
    entries: readonly { id: string; sessionId?: string }[],
  ) => boolean
  /**
   * Records durable tombstones for every supplied session and solve in one
   * write. Used by the destructive "delete all sessions" action.
   */
  recordAllSessionDeletions: (sessions: readonly Session[]) => boolean
  restoreDeletion: (kind: 'solve' | 'session' | 'event', id: string) => boolean
  /**
   * Marks an additive import as a local change without clearing tombstones,
   * redirects, approvals, field metadata or other review state.
   */
  recordAdditiveImport: (data: SessionsData) => void
  resetBase: (data: SessionsData) => void
  /** True while a sync run is active in this tab. */
  isSyncRunning: () => boolean
  /**
   * Publishes a replacement sync record and its data after the durable
   * replacement commit marker has already been written.
   */
  adoptCommittedReplacement: (
    next: SyncStorageData,
    data: SessionsData,
    settings: Settings,
  ) => void
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
 * Keeps one record per solve/session/settings/redirect field. A newly raised
 * conflict replaces an older resolution for the same field; otherwise user
 * resolutions survive a sync.
 *
 * Pending conflicts and the approvals needed to complete an active merge are
 * correctness state and are **never** evicted here. Records are deduplicated
 * by key, so the stored queue is bounded by the number of distinct fields that
 * ever diverged, not by the number of sync runs. Bounding what is *displayed* is
 * the UI's job (the Drive dialog pages its conflict list); a display or history
 * cap must never decide which conflicts block publication or which approvals
 * survive a reload.
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
  return [...records.values()].sort((left, right) => left.updatedAt - right.updatedAt)
}

function getRemoteFileId(): string | null {
  return loadDriveBackupState().remoteFileId
}

function createAuditId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `audit-${Date.now()}-${Math.random().toString(36).slice(2)}`
  }
}

/**
 * `undefined` is meaningful for a cleared session override, but JSON drops it
 * from an object property. Normalize audit display values so the history
 * survives a reload; the conflict record remains the source of truth.
 */
function auditValue(value: unknown): unknown {
  return value === undefined ? null : value
}

export function useSync({
  transport,
  sessions,
  settings,
  storageOk,
  timerActive,
  onReplaceSessions,
  onReplaceSettings,
  adoptedSettingsFieldsRef,
  onNotify,
  onDuplicateSessionDetected,
}: UseSyncOptions): UseSyncResult {
  const [sync, setSync] = useState<SyncStorageData>(() => loadSyncStorage())
  const sessionsRef = useRef(sessions)
  const settingsRef = useRef(settings)
  const syncRef = useRef(sync)
  const timerActiveRef = useRef(timerActive)
  const runningRef = useRef<Promise<void> | null>(null)
  const cancelledRef = useRef(false)
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
  const previousActiveSessionIdRef = useRef<string | null>(null)
  const onNotifyRef = useRef(onNotify)
  const recoveryNoticeRef = useRef<string | null>(null)
  const pendingReplacementRef = useRef<{
    sessions: SessionsData
    settings: Settings
    sync: SyncStorageData
    baseline: SessionsData
  } | null>(null)
  const replacementBaselineRef = useRef<SessionsData | null>(null)
  /**
   * A full solve reset must not let the immediately following publication prune
   * historical snapshots. Existing retention settings resume after that publish.
   */
  const preserveSnapshotsForResetRef = useRef(false)

  // Keep the latest props available before the browser yields. A sync request
  // can finish while a local edit is being committed; the in-flight guards
  // must compare against the newest committed snapshot, not a stale one.
  useLayoutEffect(() => {
    sessionsRef.current = sessions
    settingsRef.current = settings
    timerActiveRef.current = timerActive
  }, [sessions, settings, timerActive])

  useLayoutEffect(() => {
    onNotifyRef.current = onNotify
  }, [onNotify])

  // Keep the latest sync storage available to the settings metadata effect
  // before paint. An external settings write and its metadata can arrive in
  // the same render, and the adopted fields must retain the external
  // timestamps rather than receiving this tab's clock.
  useLayoutEffect(() => {
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
    const adopted = adoptedSettingsFieldsRef?.current ?? null
    if (adoptedSettingsFieldsRef) adoptedSettingsFieldsRef.current = null
    const fingerprint = settingsStateFingerprint(settings)
    if (replacementSettingsFingerprintRef.current === fingerprint) {
      replacementSettingsFingerprintRef.current = null
      return
    }
    if (!previous) return
    const changed = changedSettingFields(previous, settings).filter(
      (key) => !adopted?.has(key),
    )
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
  }, [persist, settings, adoptedSettingsFieldsRef])

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
      const previousEventIds = new Set(
        (previous.customEvents ?? []).map((definition) => definition.id),
      )
      const currentEventIds = new Set(
        (sessions.customEvents ?? []).map((definition) => definition.id),
      )
      for (const id of previousEventIds) {
        if (currentEventIds.has(id)) continue
        const already = syncRef.current.runtime.tombstones.some(
          (tombstone) =>
            tombstone.kind === 'event' &&
            tombstone.id === id &&
            isActiveTombstone(tombstone),
        )
        if (already) continue
        persist({
          ...syncRef.current,
          runtime: {
            ...syncRef.current.runtime,
            tombstones: [
              ...syncRef.current.runtime.tombstones.filter(
                (tombstone) => !(tombstone.kind === 'event' && tombstone.id === id),
              ),
              createTombstone('event', id, undefined, syncRef.current.runtime.deviceId),
            ],
          },
        })
      }
    }
    knownSessionsRef.current = sessions
  }, [sessions, persist])

  const recordDeletion = useCallback(
    (kind: 'solve' | 'session' | 'event', id: string, sessionId?: string): boolean => {
      const existing = syncRef.current.runtime.tombstones.find(
        (tombstone) => tombstone.kind === kind && tombstone.id === id,
      )
      if (existing && isActiveTombstone(existing)) return true
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
      // Deletion intent is the durability boundary. Do not publish it in memory
      // or let a caller claim success unless it reached storage.
      if (!storageOk) return false
      if (!saveSyncStorage(next)) return false
      setSync(next)
      syncRef.current = next
      return true
    },
    [storageOk],
  )

  const recordSessionDeletion = useCallback(
    (session: Session): boolean => {
      if (!session.id) return true
      const deviceId = syncRef.current.runtime.deviceId
      const solveIds = new Set(session.solves.map((solve) => solve.id))
      const tombstones = syncRef.current.runtime.tombstones.filter(
        (tombstone) =>
          !(tombstone.kind === 'session' && tombstone.id === session.id) &&
          !(tombstone.kind === 'solve' && solveIds.has(tombstone.id)),
      )
      tombstones.push(
        createTombstone(
          'session',
          session.id,
          undefined,
          deviceId,
          undefined,
          [...solveIds],
        ),
      )
      for (const solve of session.solves) {
        tombstones.push(
          createTombstone('solve', solve.id, session.id, deviceId),
        )
      }
      const next = {
        ...syncRef.current,
        runtime: {
          ...syncRef.current.runtime,
          tombstones,
        },
      }
      if (!storageOk) return false
      if (!saveSyncStorage(next)) return false
      setSync(next)
      syncRef.current = next
      return true
    },
    [storageOk],
  )

  const recordDeletions = useCallback(
    (entries: readonly { id: string; sessionId?: string }[]): boolean => {
      if (entries.length === 0) return true
      const byId = new Map<string, { id: string; sessionId?: string }>()
      for (const entry of entries) byId.set(entry.id, entry)
      const ids = new Set(byId.keys())
      const deviceId = syncRef.current.runtime.deviceId
      const tombstones = syncRef.current.runtime.tombstones.filter(
        (tombstone) => !(tombstone.kind === 'solve' && ids.has(tombstone.id)),
      )
      for (const entry of byId.values()) {
        tombstones.push(
          createTombstone('solve', entry.id, entry.sessionId, deviceId),
        )
      }
      const next = {
        ...syncRef.current,
        runtime: {
          ...syncRef.current.runtime,
          tombstones,
        },
      }
      // A rejected batch must not publish tombstones into memory: a later sync
      // would otherwise execute an operation the user was told was blocked.
      if (!storageOk) return false
      if (!saveSyncStorage(next)) return false
      setSync(next)
      syncRef.current = next
      preserveSnapshotsForResetRef.current = true
      return true
    },
    [storageOk],
  )

  const recordAllSessionDeletions = useCallback(
    (sessions: readonly Session[]): boolean => {
      if (sessions.length === 0) return true
      const deviceId = syncRef.current.runtime.deviceId
      const sessionIds = new Set(sessions.map((session) => session.id))
      const solveIds = new Set(
        sessions.flatMap((session) => session.solves.map((solve) => solve.id)),
      )
      const tombstones = syncRef.current.runtime.tombstones.filter(
        (tombstone) =>
          !(tombstone.kind === 'session' && sessionIds.has(tombstone.id)) &&
          !(tombstone.kind === 'solve' && solveIds.has(tombstone.id)),
      )
      for (const session of sessions) {
        tombstones.push(
          createTombstone(
            'session',
            session.id,
            undefined,
            deviceId,
            undefined,
            session.solves.map((solve) => solve.id),
          ),
        )
        for (const solve of session.solves) {
          tombstones.push(createTombstone('solve', solve.id, session.id, deviceId))
        }
      }
      const next = {
        ...syncRef.current,
        runtime: {
          ...syncRef.current.runtime,
          tombstones,
          lastSyncedFingerprint: null,
        },
      }
      if (!storageOk) return false
      if (!saveSyncStorage(next)) return false
      setSync(next)
      syncRef.current = next
      preserveSnapshotsForResetRef.current = true
      return true
    },
    [storageOk],
  )

  /**
   * Undo is durable: the tombstone is retained with a newer `restoredAt`
   * revocation timestamp. Every device merges that record, so an already
   * published deletion cannot remove the solve again. A later deliberate
   * deletion gets a newer `deletedAt` and wins deterministically.
   */
  const restoreDeletion = useCallback(
    (kind: 'solve' | 'session' | 'event', id: string): boolean => {
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
      if (!changed) return true
      const next = {
        ...syncRef.current,
        runtime: {
          ...syncRef.current.runtime,
          tombstones,
        },
      }
      // The revocation is provenance too: publish it only after it is durable.
      if (!storageOk) return false
      if (!saveSyncStorage(next)) return false
      setSync(next)
      syncRef.current = next
      return true
    },
    [storageOk],
  )

  const recordAdditiveImport = useCallback(
    (data: SessionsData) => {
      persist(createAdditiveImportSyncStorage(syncRef.current, data))
      knownSessionsRef.current = data
    },
    [persist],
  )

  const resetBase = useCallback(
    (data: SessionsData) => {
      persist(createResetBaseSyncStorage(syncRef.current, data))
      knownSessionsRef.current = data
    },
    [persist],
  )

  const isSyncRunning = useCallback((): boolean => runningRef.current !== null, [])

  const adoptCommittedReplacement = useCallback(
    (next: SyncStorageData, data: SessionsData, nextSettings: Settings) => {
      setSync(next)
      syncRef.current = next
      knownSessionsRef.current = data
      sessionsRef.current = data
      settingsRef.current = nextSettings
      replacementSettingsFingerprintRef.current =
        settingsStateFingerprint(nextSettings)
      previousActiveSessionIdRef.current = data.activeSessionId
      recoveryNoticeRef.current = null
    },
    [],
  )

  const recordSessionMerges = useCallback(
    (targetId: string, sourceIds: readonly string[]): boolean => {
      const current = syncRef.current
      const currentSessions = sessionsRef.current
      const targetExists = currentSessions.sessions.some(
        (session) => session.id === targetId,
      )
      const sourceIdSet = new Set(
        sourceIds.filter(
          (id) =>
            id !== targetId &&
            currentSessions.sessions.some((session) => session.id === id),
        ),
      )
      if (!targetExists || sourceIdSet.size === 0 || !storageOk) return false

      const existing = current.runtime.sessionRedirects ?? []
      const approvedAt = Math.max(
        Date.now(),
        ...existing.map((redirect) => redirect.approvedAt + 1),
      )
      const combined = normalizeSessionRedirects([
        ...existing,
        ...[...sourceIdSet].map((fromId) => ({
          fromId,
          toId: targetId,
          approvedAt,
          byDeviceId: current.runtime.deviceId,
        })),
      ])
      const next = {
        ...current,
        runtime: {
          ...current.runtime,
          sessionRedirects: combined,
          // The source sessions are about to disappear. Recompute against that
          // collection so a duplicate warning does not outlive its merge.
          pendingDuplicateNames: findDuplicateSessionNames(
            currentSessions.sessions.filter(
              (session) => !sourceIdSet.has(session.id),
            ),
          ),
        },
      }
      if (!saveSyncStorage(next)) return false
      setSync(next)
      syncRef.current = next
      return true
    },
    [storageOk],
  )

  const removeSessionMerges = useCallback(
    (targetId: string, sourceIds: readonly string[]): boolean => {
      const sourceIdSet = new Set(sourceIds)
      const current = syncRef.current
      const redirects = (current.runtime.sessionRedirects ?? []).filter(
        (redirect) =>
          !(redirect.toId === targetId && sourceIdSet.has(redirect.fromId)),
      )
      if (redirects.length === (current.runtime.sessionRedirects ?? []).length) {
        return true
      }
      const next = {
        ...current,
        runtime: {
          ...current.runtime,
          sessionRedirects: normalizeSessionRedirects(redirects),
          pendingDuplicateNames: findDuplicateSessionNames(
            sessionsRef.current.sessions,
          ),
        },
      }
      if (!saveSyncStorage(next)) return false
      setSync(next)
      syncRef.current = next
      return true
    },
    [],
  )

  const resolveConflict = useCallback(
    (
      id: string,
      field: string,
      resolution: 'local' | 'remote',
      kind?: SyncConflict['kind'],
    ) => {
      const audits: ConflictAuditEntry[] = []
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
        const updatedAt = Math.max(
          Date.now(),
          conflict.updatedAt,
          conflict.localUpdatedAt,
          conflict.remoteUpdatedAt,
        )
        audits.push({
          auditId: createAuditId(),
          kind: conflict.kind,
          id: conflict.id,
          sessionId: conflict.sessionId,
          field: conflict.field,
          localValue: auditValue(conflict.localValue),
          remoteValue: auditValue(conflict.remoteValue),
          localUpdatedAt: conflict.localUpdatedAt,
          remoteUpdatedAt: conflict.remoteUpdatedAt,
          resolution,
          resolvedAt: updatedAt,
          byDeviceId: syncRef.current.runtime.deviceId,
          remoteOnly: conflict.remoteOnly,
        })
        return {
          ...conflict,
          resolution,
          updatedAt,
        }
      })
      const stillPending = conflicts.some((conflict) => conflict.resolution === 'manual-pending')
      const conflictAudit =
        audits.length === 0
          ? syncRef.current.runtime.conflictAudit
          : [...audits].reverse().concat(syncRef.current.runtime.conflictAudit).slice(
              0,
              MAX_CONFLICT_AUDIT_ENTRIES,
            )
      persist({
        ...syncRef.current,
        runtime: {
          ...syncRef.current.runtime,
          conflicts,
          conflictAudit,
          lastSyncStatus: stillPending ? 'conflict' : 'pending',
          lastError: stillPending
            ? syncRef.current.runtime.lastError
            : null,
        },
      })

      if (!stillPending) {
        window.setTimeout(() => {
          if (cancelledRef.current) return
          void syncNowRef.current?.('conflict-resolution')
        }, 0)
      }
    },
    [persist],
  )

  /**
   * A decision is still reversible while its stored conflict record carries the
   * exact resolution and timestamp that the audit entry recorded. Flipping it
   * is enough: merges compare the reviewed pair, so the other value wins on the
   * next run whenever it still exists in a snapshot. Redirect merges are not
   * reversible because applying them has already restructured sessions.
   */
  const undoConflictResolution = useCallback(
    (auditId: string): { ok: true } | { ok: false; error: string } => {
      const entry = syncRef.current.runtime.conflictAudit.find(
        (candidate) => candidate.auditId === auditId,
      )
      if (!entry) {
        return { ok: false, error: 'That review decision is no longer in the history.' }
      }
      if (entry.undoneAt !== undefined) {
        return { ok: false, error: 'That review decision was already reversed.' }
      }
      if (entry.kind === 'redirect') {
        return {
          ok: false,
          error: 'Approved session merges cannot be reversed automatically.',
        }
      }
      if (entry.field === 'legacyRecovery' && entry.resolution === 'remote') {
        return {
          ok: false,
          error:
            'Legacy recovery cannot be reversed automatically after solves were restored.',
        }
      }
      const conflicts = [...syncRef.current.runtime.conflicts]
      const index = conflicts.findIndex(
        (conflict) =>
          conflict.kind === entry.kind &&
          conflict.id === entry.id &&
          conflict.field === entry.field,
      )
      const conflict = conflicts[index]
      if (
        !conflict ||
        conflict.resolution !== entry.resolution ||
        conflict.updatedAt !== entry.resolvedAt
      ) {
        return {
          ok: false,
          error:
            'The conflict changed after that decision, so it cannot be reversed safely.',
        }
      }

      const now = Math.max(
        Date.now(),
        conflict.updatedAt + 1,
        conflict.localUpdatedAt,
        conflict.remoteUpdatedAt,
      )
      const resolution = entry.resolution === 'local' ? 'remote' : 'local'
      conflicts[index] = {
        ...conflict,
        resolution,
        updatedAt: now,
        priorUpdatedAt: conflict.updatedAt,
      }
      const reversed: ConflictAuditEntry = {
        ...entry,
        auditId: createAuditId(),
        resolution,
        resolvedAt: now,
        undoOf: entry.auditId,
        undoneAt: undefined,
      }
      const conflictAudit = [
        reversed,
        ...syncRef.current.runtime.conflictAudit.map((candidate) =>
          candidate.auditId === entry.auditId
            ? { ...candidate, undoneAt: now }
            : candidate,
        ),
      ].slice(0, MAX_CONFLICT_AUDIT_ENTRIES)
      const stillPending = conflicts.some(
        (candidate) => candidate.resolution === 'manual-pending',
      )
      persist({
        ...syncRef.current,
        runtime: {
          ...syncRef.current.runtime,
          conflicts,
          conflictAudit,
          lastSyncStatus: stillPending ? 'conflict' : 'pending',
          lastError: stillPending ? syncRef.current.runtime.lastError : null,
        },
      })
      if (!stillPending) {
        window.setTimeout(() => {
          if (cancelledRef.current) return
          void syncNowRef.current?.('undo-conflict-resolution')
        }, 0)
      }
      return { ok: true }
    },
    [persist],
  )

  const repairSyncState = useCallback(() => {
    const enabled = syncRef.current.preferences.enabled
    persist({
      ...syncRef.current,
      runtime: {
        ...syncRef.current.runtime,
        lastSyncedFingerprint: null,
        lastRemoteRevision: null,
        lastSyncStatus: enabled ? 'pending' : 'disabled',
        lastError: null,
        blockedOutputFingerprint: null,
      },
    })
    if (enabled) {
      window.setTimeout(() => {
        if (cancelledRef.current) return
        void syncNowRef.current?.('repair')
      }, 0)
    }
  }, [persist])

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

  const recoverPendingSolveRestores = useCallback((): {
    ok: boolean
    recovered: number
    discarded: number
    aborted: number
  } => {
    const recovery = loadSolveRecovery()
    if (recovery.operations.length === 0) {
      return { ok: true, recovered: 0, discarded: 0, aborted: 0 }
    }
    const result = applyPendingSolveRestores({
      data: sessionsRef.current,
      tombstones: syncRef.current.runtime.tombstones,
      operations: recovery.operations,
    })
    if (result.data !== sessionsRef.current) {
      if (!saveSessions(result.data)) {
        return { ok: false, recovered: 0, discarded: 0, aborted: 0 }
      }
      sessionsRef.current = result.data
      onReplaceSessions(result.data)
    }
    if (
      !saveSolveRecovery({
        ...recovery,
        operations: result.remaining,
      })
    ) {
      return {
        ok: false,
        recovered: result.recovered.length,
        discarded: result.discarded.length,
        aborted: result.aborted.length,
      }
    }
    return {
      ok: result.remaining.length === 0,
      recovered: result.recovered.length,
      discarded: result.discarded.length,
      aborted: result.aborted.length,
    }
  }, [onReplaceSessions])

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
      const pendingJournal = loadReplacementJournal()
      let replacementMessage: string | null = null
      if (pendingJournal.status === 'invalid') {
        replacementMessage = pendingJournal.message
      } else if (
        pendingJournal.status === 'ok' &&
        pendingJournal.journal.phase === 'prepared'
      ) {
        // Another tab may still be staging its replacement. Never roll that
        // transaction back from a sync run; startup/main recovery handles an
        // abandoned prepared record.
        replacementMessage =
          'Synchronization paused while a backup replacement is being committed.'
      } else if (pendingJournal.status === 'ok') {
        const replacementRecovery = recoverPendingReplacement()
        replacementMessage = pendingReplacementMessage(replacementRecovery)
      }
      if (replacementMessage) {
        persist({
          ...syncRef.current,
          runtime: {
            ...syncRef.current.runtime,
            lastSyncStatus: 'failed',
            lastError: replacementMessage,
          },
        })
        if (reason === 'manual') onNotify(replacementMessage)
        return
      }
      const blockedFingerprint =
        syncRef.current.runtime.blockedOutputFingerprint ?? null
      if (
        reason !== 'manual' &&
        blockedFingerprint !== null &&
        blockedFingerprint ===
          syncStateFingerprint(sessionsRef.current, settingsRef.current)
      ) {
        // The complete payload is still the same known-oversized state. Do not
        // repeat downloads, serialization or notifications until data changes;
        // a manual retry remains available after the user reduces the data.
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

        const recovery = recoverPendingSolveRestores()
        if (!recovery.ok) {
          if (reason === 'manual') {
            onNotify(
              'Synchronization paused: an Undo recovery is still pending. Retry after browser storage is available.',
            )
          }
          return
        }
        if (recovery.recovered > 0) {
          onNotify(
            recovery.recovered === 1
              ? 'Recovered a pending Undo before synchronizing.'
              : `Recovered ${recovery.recovered} pending Undo operations before synchronizing.`,
          )
        } else if (recovery.discarded > 0 && reason === 'manual') {
          onNotify(
            'A pending Undo was discarded because the solve has a newer deletion.',
          )
        } else if (recovery.aborted > 0 && reason === 'manual') {
          onNotify(
            'An interrupted Undo had not committed and was not applied. The solve remains deleted.',
          )
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

          // Revalidate enabled/connection state after asynchronous boundaries.
          if (!syncRef.current.preferences.enabled) {
            persist({
              ...syncRef.current,
              runtime: {
                ...syncRef.current.runtime,
                lastSyncStatus: 'pending',
                lastError: 'Synchronization disabled.',
              },
            })
            return
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

          // Re-check timer activity after the network read. A sync started while
          // idle may finish after timing has begun; never merge or replace state
          // while the timer is armed, running, or inspecting.
          if (timerActiveRef.current) {
            persist({
              ...syncRef.current,
              runtime: {
                ...syncRef.current.runtime,
                lastSyncStatus: 'pending',
                lastError: 'Synchronization will resume when the timer is idle.',
              },
            })
            queueRetry(500)
            return
          }

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
          let mergedActiveSessionUpdate = syncState.runtime.activeSessionFieldUpdate
          for (const snapshot of snapshots) {
            const result = mergeSessionsData({
              local: mergedSessions,
              remote: snapshot.backup.sessions,
              tombstones: mergedTombstones,
              sessionRedirects,
              deviceId,
              manualConflictReview: syncState.preferences.manualConflictReview,
              resolvedConflicts: syncState.runtime.conflicts,
              localActiveSessionUpdate: mergedActiveSessionUpdate,
              remoteActiveSessionUpdate: snapshot.backup.sync?.activeSessionFieldUpdate,
            })
            mergedSessions = result.merged
            adoptedLocalDefault = adoptedLocalDefault || result.adoptedLocalDefault
            recoveredSolves += result.recoveredSolves
            conflicts.push(...result.conflicts)
            mergedActiveSessionUpdate = result.activeSessionFieldUpdate
          }
          // Duplicate names must be judged against the final collection. A later
          // snapshot without its own collision must not erase an earlier warning.
          const duplicateSessionNames = findDuplicateSessionNames(
            mergedSessions.sessions,
          )

          // Merge remote device settings with each other first, using their
          // field metadata, then merge the aggregate with this device so the
          // first-sync default policy applies exactly once.
          //
          // The pairwise fold still discards a losing alternative from the
          // aggregate, so with manual review enabled it must raise the
          // disagreement for approval *before* the value disappears. A device
          // whose local value already matches the automatic winner would
          // otherwise never see the remote snapshot that disagrees with it.
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
                manualConflictReview: syncState.preferences.manualConflictReview,
                resolvedConflicts: syncState.runtime.conflicts,
              })
              aggregateRemoteSettings = result.settings
              aggregateRemoteSettingsUpdates = result.fieldUpdates
              if (syncState.preferences.manualConflictReview) {
                conflicts.push(
                  ...result.conflicts.map((conflict) => ({
                    ...conflict,
                    remoteOnly: true,
                  })),
                )
              }
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
          const perDeviceTransport = Boolean(transport.uploadDeviceBackup)
          // Unique immutable snapshot names mean this device can own several
          // remote files. Identify our snapshots by envelope device ID; the
          // legacy fixed per-device name is only a fallback for pre-envelope
          // snapshots. Nothing here deletes or overwrites them.
          const ownSnapshots = findOwnSnapshots(snapshots, deviceId)
          const ownNewestFile = ownSnapshots.at(-1)?.file ?? null
          const remoteStateUnchanged =
            mergedFingerprint === syncRef.current.runtime.lastSyncedFingerprint &&
            remoteRevision <= (syncRef.current.runtime.lastRemoteRevision ?? 0) &&
            JSON.stringify(mergedTombstones) === JSON.stringify(syncRef.current.runtime.tombstones) &&
            JSON.stringify(sessionRedirects) ===
              JSON.stringify(syncRef.current.runtime.sessionRedirects ?? [])
          const remoteStorePresent = perDeviceTransport
            ? ownSnapshots.length > 0
            : remoteFiles.length > 0

          let updatedConflicts = mergeConflictRecords(
            syncRef.current.runtime.conflicts.filter(
              (conflict) => conflict.resolution !== 'manual-pending',
            ),
            deduplicatedConflicts,
          )
          let lastRemoteRevision = baseRevision
          let remoteFileId: string | null = ownNewestFile?.id ?? null
          let remoteModifiedTime: string | null = ownNewestFile?.modifiedTime ?? null
          // Set only when this run actually created a new immutable snapshot.
          // Cleanup is safe only after the merged state has been published.
          let publishedSnapshot: { id: string; modifiedTime: string | null } | null =
            null

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
              mergedActiveSessionUpdate,
            )
            const backup = createBackup(
              mergedSessions,
              mergedSettings,
              new Date(),
              envelope,
            )
            const serialized = serializeBackupChecked(backup, {
              preferCompact: true,
            })
            if (!serialized.ok) {
              const message = `Synchronization blocked: ${serialized.error} No cloud snapshot was written.`
              persist({
                ...syncRef.current,
                runtime: {
                  ...syncRef.current.runtime,
                  lastSyncStatus: 'failed',
                  lastError: message,
                  blockedOutputFingerprint: syncStateFingerprint(
                    sessionsRef.current,
                    settingsRef.current,
                  ),
                },
              })
              if (reason === 'manual') onNotify(message)
              return
            }

            // Re-check immediately before the remote write. The upload itself
            // cannot be atomic, but local data is never replaced by a stale
            // in-flight snapshot.
            if (timerActiveRef.current) {
              persist({
                ...syncRef.current,
                runtime: {
                  ...syncRef.current.runtime,
                  lastSyncStatus: 'pending',
                  lastError: 'Synchronization will resume when the timer is idle.',
                },
              })
              queueRetry(500)
              return
            }
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

            if (replacementBlocksSync()) {
              const message =
                'Synchronization paused while a replacement recovery record is pending.'
              persist({
                ...syncRef.current,
                runtime: {
                  ...syncRef.current.runtime,
                  lastSyncStatus: 'failed',
                  lastError: message,
                },
              })
              if (reason === 'manual') onNotify(message)
              return
            }
            const expectedLegacyFile = remoteFiles[0]
            const content = serialized.raw
            const write = await runWithDriveWriteLock(async () => {
              // Re-check timer activity after acquiring the shared write lock;
              // a timer may have started while waiting for the lock.
              if (timerActiveRef.current) {
                return { status: 'timer-active' as const }
              }
              // Per-device snapshots are immutable and uniquely named: this
              // upload creates a new file and cannot overwrite a concurrent
              // writer sharing this device ID, so no remote recheck can make
              // the write safe or unsafe — it is already non-destructive. The
              // optimistic recheck remains only for legacy single-file
              // transports whose fixed-name file is still mutable.
              if (!perDeviceTransport) {
                const currentFiles = await listRemoteBackups(transport)
                if (
                  ownSnapshotChanged(expectedLegacyFile, currentFiles[0] ?? null)
                ) {
                  return { status: 'remote-changed' as const }
                }
              }
              if (!isLocalUnchanged()) {
                return { status: 'local-changed' as const }
              }
              if (perDeviceTransport) {
                const result = await transport.uploadDeviceBackup!(
                  content,
                  deviceId,
                )
                return { status: 'uploaded' as const, result }
              }
              const existingFileId =
                expectedLegacyFile?.id ?? getRemoteFileId()
              try {
                const result = await transport.uploadBackup(
                  content,
                  existingFileId,
                  { expectedEtag: expectedLegacyFile?.etag ?? null },
                )
                return { status: 'uploaded' as const, result }
              } catch (error) {
                if (isDrivePreconditionError(error)) {
                  return { status: 'remote-changed' as const }
                }
                throw error
              }
            })

            if (write.status === 'timer-active') {
              persist({
                ...syncRef.current,
                runtime: {
                  ...syncRef.current.runtime,
                  lastSyncStatus: 'pending',
                  lastError: 'Synchronization will resume when the timer is idle.',
                },
              })
              queueRetry(500)
              return
            }
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
            publishedSnapshot = {
              id: result.id,
              modifiedTime: result.modifiedTime,
            }

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
          //
          // Re-check timer activity before applying state. A sync started while
          // idle may finish after timing has begun; never replace the session
          // collection or settings during a solve. Defer application and rerun
          // the merge against current local state once idle.
          if (timerActiveRef.current) {
            persist({
              ...syncRef.current,
              runtime: {
                ...syncRef.current.runtime,
                lastSyncStatus: 'pending',
                lastError: 'Synchronization will resume when the timer is idle.',
              },
            })
            queueRetry(500)
            return
          }
          if (replacementBlocksSync()) {
            const message =
              'Synchronization paused before applying data because a replacement recovery record is pending.'
            persist({
              ...syncRef.current,
              runtime: {
                ...syncRef.current.runtime,
                lastSyncStatus: 'failed',
                lastError: message,
              },
            })
            if (reason === 'manual') onNotify(message)
            return
          }

          knownSessionsRef.current = mergedSessions
          sessionsRef.current = mergedSessions
          settingsRef.current = mergedSettings
          replacementSettingsFingerprintRef.current =
            settingsStateFingerprint(mergedSettings)
          // This selection carries merged provenance, not a fresh local edit.
          previousActiveSessionIdRef.current = mergedSessions.activeSessionId
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
              conflicts: updatedConflicts,
              sessionRedirects,
              pendingDuplicateNames: duplicateSessionNames,
              settingsFieldUpdates: mergedSettingsUpdates,
              activeSessionFieldUpdate: mergedActiveSessionUpdate,
              lastSyncedFingerprint: mergedFingerprint,
              blockedOutputFingerprint: null,
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

          // The merged state is now published, so every snapshot read before
          // the write is superseded. Prune only beyond the configured count and
          // age thresholds; the newest snapshot of each device and the legacy
          // mutable file are always kept. Cleanup is best effort and never turns
          // a completed synchronization into a failure.
          let cleanupDeleted = 0
          let cleanupFailure: string | null = null
          if (
            publishedSnapshot &&
            perDeviceTransport &&
            preserveSnapshotsForResetRef.current
          ) {
            // Reset preserves every existing snapshot; routine retention resumes
            // on the next ordinary synchronization.
            preserveSnapshotsForResetRef.current = false
          } else if (
            publishedSnapshot &&
            perDeviceTransport &&
            syncRef.current.preferences.snapshotCleanupEnabled
          ) {
            const cleanup = await cleanupRemoteSnapshots(
              transport,
              remoteFiles,
              {
                keepPerDevice:
                  syncRef.current.preferences.snapshotKeepPerDevice,
                maxAgeDays: syncRef.current.preferences.snapshotMaxAgeDays,
                localDeviceId: deviceId,
                publishedFileId: publishedSnapshot.id,
                publishedAt: publishedSnapshot.modifiedTime
                  ? Date.parse(publishedSnapshot.modifiedTime)
                  : null,
                now,
              },
            )
            cleanupDeleted = cleanup.deleted
            if (cleanup.failures.length > 0) {
              cleanupFailure = `${cleanup.failures.length} old snapshot${
                cleanup.failures.length === 1 ? '' : 's'
              } could not be removed: ${cleanup.failures[0]}`
            }
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
            if (cleanupDeleted > 0) {
              messages.push(
                `${cleanupDeleted} old snapshot${
                  cleanupDeleted === 1 ? '' : 's'
                } removed`,
              )
            }
            if (cleanupFailure) messages.push(cleanupFailure)

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

          if (
            cleanupFailure &&
            reason !== 'reconnect' &&
            reason !== 'manual'
          ) {
            onNotify(`Synchronization completed, but ${cleanupFailure}`)
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
      recoverPendingSolveRestores,
    ],
  )

  useEffect(() => {
    syncNowRef.current = syncNow
  }, [syncNow])

  // Recover an interrupted Undo before startup/scheduled synchronization. The
  // journal is local-only, so a reload can complete it after storage recovers.
  // Retries follow mount/storage-health/timer-idle transitions, never unrelated
  // renders; notifications are deduplicated by the journal operation set.
  useEffect(() => {
    if (!storageOk || timerActive) return
    const recovery = loadSolveRecovery()
    if (recovery.operations.length === 0) return
    const operationIds = recovery.operations
      .map((operation) => operation.operationId)
      .join(',')
    const result = recoverPendingSolveRestores()
    let noticeKey: string | null = null
    let notice: string | null = null
    if (result.ok) {
      if (result.recovered > 0) {
        noticeKey = `recovered:${operationIds}`
        notice =
          result.recovered === 1
            ? 'Recovered a pending Undo after browser storage became available.'
            : `Recovered ${result.recovered} pending Undo operations after browser storage became available.`
      } else if (result.discarded > 0) {
        noticeKey = `discarded:${operationIds}`
        notice =
          'A pending Undo was discarded because the solve has a newer deletion.'
      } else if (result.aborted > 0) {
        noticeKey = `aborted:${operationIds}`
        notice =
          'An interrupted Undo was not applied because it had not committed. The solve remains deleted.'
      }
    } else {
      noticeKey = `pending:${operationIds}`
      notice =
        'An Undo recovery is pending. It will retry after browser storage is available; synchronization is paused until then.'
    }
    if (noticeKey && notice && recoveryNoticeRef.current !== noticeKey) {
      recoveryNoticeRef.current = noticeKey
      onNotifyRef.current(notice)
    }
  }, [recoverPendingSolveRestores, storageOk, timerActive])

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

  // Followers mirror storage changes. External session collection changes
  // are deferred while the timer is active so a solve cannot be redirected
  // into a different session/event mid-timing.
  const pendingExternalSessionsRef = useRef<{
    external: SessionsData
    baseline: SessionsData
  } | null>(null)

  useEffect(() => {
    const handler = (event: StorageEvent) => {
      if (event.key === REPLACEMENT_STORAGE_KEY) {
        const journal = loadReplacementJournal()
        if (journal.status === 'invalid') {
          onNotifyRef.current(journal.message)
          return
        }
        // A prepared transaction belongs to the writing tab. Followers must
        // ignore its intermediate keys until the commit marker or removal
        // arrives instead of rolling it back underneath the writer. Keep the
        // pre-deferral baseline so completions recorded after this point can
        // be reconciled with the final outcome.
        if (journal.status === 'ok' && journal.journal.phase === 'prepared') {
          if (!replacementBaselineRef.current) {
            replacementBaselineRef.current = sessionsRef.current
          }
          return
        }
        const recovery = recoverPendingReplacement()
        const committedCleanupPending =
          recovery.status === 'cleanup-pending' &&
          recovery.journal.phase === 'committed'
        const message = pendingReplacementMessage(recovery)
        if (message && !committedCleanupPending) {
          onNotifyRef.current(message)
          return
        }
        try {
          const nextSessions = loadSessions()
          const nextSettings = loadSettings()
          const nextSync = loadSyncStorage()
          if (timerActiveRef.current) {
            const previous = pendingReplacementRef.current
            pendingReplacementRef.current = {
              sessions: nextSessions,
              settings: nextSettings,
              sync: nextSync,
              // Retain the collection from before the first deferral. A later
              // event only updates the external outcome.
              baseline:
                previous?.baseline ??
                replacementBaselineRef.current ??
                sessionsRef.current,
            }
            return
          }
          const completion = loadPendingCompletion()
          const external =
            completion.status === 'ok'
              ? applyPendingCompletion(
                  nextSessions,
                  completion.completion,
                  nextSync.runtime.tombstones,
                )
              : nextSessions
          const reconciled = reconcileExternalSessions({
            external,
            local: sessionsRef.current,
            baseline:
              pendingReplacementRef.current?.baseline ??
              replacementBaselineRef.current ??
              sessionsRef.current,
          })
          pendingReplacementRef.current = null
          pendingExternalSessionsRef.current = null
          replacementBaselineRef.current = null
          // Publish collection, selection, settings and sync provenance as one
          // adopted outcome rather than letting pieces update independently.
          adoptCommittedReplacement(nextSync, reconciled, nextSettings)
          onReplaceSessions(reconciled)
          onReplaceSettings(nextSettings)
        } catch {
          // A follow-up reload will recover the durable outcome.
        }
        return
      }
      if (event.key === 'cubelab:sessions:v1') {
        // Replacement events own a prepared collection until their outcome has
        // been adopted. A committed outcome is safe for the ordinary follower
        // path even if only journal cleanup is still pending.
        const journal = loadReplacementJournal()
        if (
          replacementBaselineRef.current ||
          pendingReplacementRef.current ||
          journal.status === 'invalid' ||
          (journal.status === 'ok' && journal.journal.phase === 'prepared')
        ) {
          return
        }
        try {
          const loaded = loadSessions()
          if (timerActiveRef.current) {
            const previous = pendingExternalSessionsRef.current
            pendingExternalSessionsRef.current = {
              external: loaded,
              // The baseline is the local collection at the first deferral.
              // Only solves recorded after that point are merged back.
              baseline: previous?.baseline ?? sessionsRef.current,
            }
            return
          }
          onReplaceSessions(loaded)
        } catch {
          // ignore follower parse failures
        }
        return
      }
      if (replacementBlocksSync()) return
      if (event.key === SYNC_STORAGE_KEY && syncRef.current?.preferences) {
        setSync(loadSyncStorage())
      }
    }
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }, [
    adoptCommittedReplacement,
    onReplaceSessions,
    onReplaceSettings,
  ])

  // Apply any deferred external session collection change once the timer is
  // idle. Local solves recorded during the deferral are merged by stable ID so
  // a cross-tab active-session switch cannot drop them.
  useEffect(() => {
    if (timerActive) return
    const pending = pendingExternalSessionsRef.current
    if (!pending) return
    pendingExternalSessionsRef.current = null
    const reconciled = reconcileExternalSessions({
      external: pending.external,
      local: sessionsRef.current,
      baseline: pending.baseline,
    })
    onReplaceSessions(reconciled)
  }, [timerActive, onReplaceSessions])

  // Apply a deferred replacement only after the timer is idle, preserving any
  // solves recorded since the pre-deferral baseline and any buffered completion.
  useEffect(() => {
    if (timerActive) return
    const pending = pendingReplacementRef.current
    if (!pending) return
    pendingReplacementRef.current = null
    const completion = loadPendingCompletion()
    const external =
      completion.status === 'ok'
        ? applyPendingCompletion(
            pending.sessions,
            completion.completion,
            pending.sync.runtime.tombstones,
          )
        : pending.sessions
    const reconciled = reconcileExternalSessions({
      external,
      local: sessionsRef.current,
      baseline: pending.baseline,
    })
    pendingExternalSessionsRef.current = null
    replacementBaselineRef.current = null
    adoptCommittedReplacement(pending.sync, reconciled, pending.settings)
    onReplaceSessions(reconciled)
    onReplaceSettings(pending.settings)
  }, [
    adoptCommittedReplacement,
    timerActive,
    onReplaceSessions,
    onReplaceSettings,
  ])

  // Track active session selection changes so they can be field-merged across
  // devices instead of being silently overwritten.
  useEffect(() => {
    const currentId = sessions.activeSessionId
    if (previousActiveSessionIdRef.current === null) {
      previousActiveSessionIdRef.current = currentId
      return
    }
    if (previousActiveSessionIdRef.current === currentId) return
    previousActiveSessionIdRef.current = currentId
    if (!syncRef.current.preferences.enabled) return
    const deviceId = syncRef.current.runtime.deviceId
    persist({
      ...syncRef.current,
      runtime: {
        ...syncRef.current.runtime,
        activeSessionFieldUpdate: {
          updatedAt: Date.now(),
          editorId: deviceId,
        },
      },
    })
  }, [sessions.activeSessionId, persist])

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

  // Visibility / pagehide / freeze. Browsers may terminate a page before an
  // asynchronous network write finishes, so this remains best effort. Local
  // storage is the durability boundary; a `syncing` status left in storage is
  // resumed on the next startup. Duplicate lifecycle events are collapsed so a
  // visibility change followed by pagehide cannot start a second upload.
  const lastExitSyncAtRef = useRef(0)
  useEffect(() => {
    const requestExitSync = () => {
      if (!syncRef.current.preferences.enabled) return
      if (!syncRef.current.preferences.syncOnExit) return
      const now = Date.now()
      if (now - lastExitSyncAtRef.current < 2_000) return
      lastExitSyncAtRef.current = now
      void syncNow('exit')
    }
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') requestExitSync()
    }
    const freezeTarget = document as unknown as {
      addEventListener(type: string, listener: EventListener): void
      removeEventListener(type: string, listener: EventListener): void
    }
    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('pagehide', requestExitSync)
    freezeTarget.addEventListener('freeze', requestExitSync)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('pagehide', requestExitSync)
      freezeTarget.removeEventListener('freeze', requestExitSync)
    }
  }, [syncNow])

  const localStateFingerprint = useMemo(
    // UI pending-state detection is unused while disabled. Actual sync still
    // fingerprints current refs at its in-flight safety boundaries.
    () => sync.preferences.enabled ? syncStateFingerprint(sessions, settings) : null,
    [sessions, settings, sync.preferences.enabled],
  )
  const hasPendingChanges =
    sync.preferences.enabled &&
    sync.runtime.lastSyncedFingerprint !== localStateFingerprint

  useEffect(
    () => () => {
      cancelledRef.current = true
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
    conflictAudit: sync.runtime.conflictAudit ?? [],
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
    recordSessionDeletion,
    recordDeletions,
    recordAllSessionDeletions,
    restoreDeletion,
    recordAdditiveImport,
    resetBase,
    isSyncRunning,
    adoptCommittedReplacement,
    recordSessionMerges,
    removeSessionMerges,
    resolveConflict,
    undoConflictResolution,
    repairSyncState,
  }
}
