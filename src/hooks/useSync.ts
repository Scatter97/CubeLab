import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { SessionsData, Settings } from '../types'
import { countSolves } from '../lib/sessions'
import { loadSessions } from '../lib/storage'
import { createBackup, parseBackup } from '../lib/backup'
import type { DriveTransport } from '../lib/driveTransport'
import {
  loadDriveBackupState,
  saveDriveBackupState,
} from '../lib/driveStorage'
import {
  loadSyncStorage,
  saveSyncStorage,
  SYNC_STORAGE_KEY,
  type SyncPreferences,
  type SyncStatus,
  type SyncStorageData,
  type SyncConflict,
} from '../lib/syncStorage'
import {
  createSyncEnvelope,
  mergeSessionsData,
  mergeSettings,
  parseRemoteSyncEnvelope,
  createTombstone,
} from '../lib/sync'
import { normalizeSessionRedirects, applySessionRedirects } from '../lib/sessionRedirects'

interface UseSyncOptions {
  transport: DriveTransport | null
  sessions: SessionsData
  settings: Settings
  storageOk: boolean
  timerActive: boolean
  onReplaceSessions: (data: SessionsData) => void
  onReplaceSettings: (settings: Settings) => void
  onNotify: (message: string) => void
  onDuplicateSessionDetected?: (names: string[]) => void
}

export interface UseSyncResult {
  phase: SyncStatus
  lastSyncAt: number | null
  newSolvesSinceLastSync: number
  error: string | null
  conflictsCount: number
  pendingConflicts: SyncConflict[]
  duplicateNames: string[]
  approveSessionMerge: (sourceId: string, targetId: string) => void
  resolveConflict: (id: string, field: string, resolution: 'local' | 'remote') => void
  preferences: SyncPreferences
  updatePreferences: (next: Partial<SyncPreferences>) => void
  syncNow: (reason?: string) => Promise<void>
  recordDeletion: (kind: 'solve' | 'session', id: string, sessionId?: string) => void
  clearDeletion: (kind: 'solve' | 'session', id: string) => void
  resetBase: (data: SessionsData) => void
}

const MAX_BACKOFF_MS = 30_000

function toMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return 'Synchronization failed.'
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
  const lastSyncedSessionsRef = useRef<SessionsData | null>(null)
  const knownSessionsRef = useRef<SessionsData | null>(null)
  const leaderRef = useRef(false)
  const locksSupportedRef = useRef(typeof navigator !== 'undefined' && Boolean(navigator.locks))
  const backoffRef = useRef(1_000)
  const fallbackTimerRef = useRef<number | null>(null)
  const retryTimerRef = useRef<number | null>(null)

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
            (tombstone) => tombstone.kind === 'solve' && tombstone.id === id,
          )
          if (!already) {
            const next = {
              ...syncRef.current,
              runtime: {
                ...syncRef.current.runtime,
                tombstones: [
                  ...syncRef.current.runtime.tombstones,
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
            (tombstone) => tombstone.kind === 'session' && tombstone.id === id,
          )
          if (!already) {
            const deletedSession = previous.sessions.find((session) => session.id === id)
            const next = {
              ...syncRef.current,
              runtime: {
                ...syncRef.current.runtime,
                tombstones: [
                  ...syncRef.current.runtime.tombstones,
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
      const already = syncRef.current.runtime.tombstones.some(
        (tombstone) => tombstone.kind === kind && tombstone.id === id,
      )
      if (already) return
      const deletedSession =
        kind === 'session'
          ? sessionsRef.current.sessions.find((session) => session.id === id)
          : undefined
      const next = {
        ...syncRef.current,
        runtime: {
          ...syncRef.current.runtime,
          tombstones: [
            ...syncRef.current.runtime.tombstones,
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

  const clearDeletion = useCallback(
    (kind: 'solve' | 'session', id: string) => {
      const next = {
        ...syncRef.current,
        runtime: {
          ...syncRef.current.runtime,
          tombstones: syncRef.current.runtime.tombstones.filter(
            (tombstone) => !(tombstone.kind === kind && tombstone.id === id),
          ),
        },
      }
      persist(next)
    },
    [persist],
  )

  const resetBase = useCallback(
    (data: SessionsData) => {
      const next = {
        ...syncRef.current,
        runtime: {
          ...syncRef.current.runtime,
          tombstones: [],
          conflicts: [],
          solveCountAtLastSync: countSolvesInData(data),
          lastSyncStatus:
            syncRef.current.preferences.enabled ? 'synced' as SyncStatus : syncRef.current.runtime.lastSyncStatus,
        },
      }
      persist(next)
      lastSyncedSessionsRef.current = data
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
      lastSyncedSessionsRef.current = redirectedSessions
      knownSessionsRef.current = redirectedSessions
      sessionsRef.current = redirectedSessions
      onReplaceSessions(redirectedSessions)

      persist({
        ...syncRef.current,
        runtime: {
          ...syncRef.current.runtime,
          sessionRedirects: combined,
          pendingDuplicateNames: (syncRef.current.runtime.pendingDuplicateNames ?? []).filter(
            (name) =>
              name !== redirectedSessions.sessions.find((session) => session.id === targetId)?.name,
          ),
        },
      })

      window.setTimeout(() => void syncNowRef.current?.('merge'), 0)
    },
    [onReplaceSessions, persist],
  )

  const resolveConflict = useCallback(
    (id: string, field: string, resolution: 'local' | 'remote') => {
      const conflicts = syncRef.current.runtime.conflicts.map((conflict) => {
        if (
          conflict.kind !== 'solve' ||
          conflict.id !== id ||
          conflict.field !== field ||
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

  const syncNow = useCallback(
    async (reason?: string) => {
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
          // Defer application until idle, but try once more shortly.
          window.setTimeout(() => void syncNowRef.current?.(reason), 500)
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

          const remoteFile = await transport.findBackup()
          let remoteSessions: SessionsData | null = null
          let remoteSettings: Settings | null = null
          let remoteEnvelope = null
          if (remoteFile) {
            const raw = await transport.downloadBackup(remoteFile.id)
            if (raw.length > 10 * 1024 * 1024) throw new Error('Remote backup is too large to synchronize.')
            const parsed = parseBackup(raw)
            if (!parsed.ok) throw new Error(parsed.error)
            remoteSessions = parsed.backup.sessions
            remoteSettings = parsed.backup.settings
            remoteEnvelope = parsed.backup.sync ?? parseRemoteSyncEnvelope(parsed.backup.sync)
          }

          const existingRedirects = syncRef.current.runtime.sessionRedirects ?? []
          const combinedRedirects = normalizeSessionRedirects([
            ...existingRedirects,
            ...(remoteEnvelope?.sessionRedirects ?? []),
          ])
          const local = sessionsRef.current
          const localSettings = settingsRef.current
          const merged = mergeSessionsData({
            local,
            remote: remoteSessions,
            tombstones: [...syncRef.current.runtime.tombstones, ...(remoteEnvelope?.tombstones ?? [])],
            sessionRedirects: combinedRedirects,
            deviceId: syncRef.current.runtime.deviceId,
            manualConflictReview: syncRef.current.preferences.manualConflictReview,
            resolvedConflicts: syncRef.current.runtime.conflicts,
          })

          // Settings merge.
          const mergedSettings = mergeSettings(
            localSettings,
            remoteSettings,
            remoteEnvelope?.updatedAt ?? 0,
            syncRef.current.runtime.lastSyncAt,
          )

          const localIds = new Set(local.sessions.flatMap((session) => session.solves.map((solve) => solve.id)))
          const remoteIds = new Set((remoteSessions?.sessions ?? []).flatMap((session) => session.solves.map((solve) => solve.id)))
          const mergedIds = new Set(merged.merged.sessions.flatMap((session) => session.solves.map((solve) => solve.id)))
          const uploadedSolves = [...localIds].filter(
            (id) => !remoteIds.has(id) && mergedIds.has(id),
          ).length
          const importedSolves = [...mergedIds].filter((id) => !localIds.has(id)).length

          // Never publish a provisional resolution when the user requested
          // approval. Preserve local data and the conflict record for review.
          const pendingConflicts = merged.conflicts.filter((conflict) => conflict.resolution === 'manual-pending')
          if (pendingConflicts.length > 0) {
            persist({
              ...syncRef.current,
              runtime: {
                ...syncRef.current.runtime,
                conflicts: mergeConflictRecords(syncRef.current.runtime.conflicts, pendingConflicts),
                lastSyncStatus: 'conflict',
                lastError: 'Resolve same-field conflicts before publishing a cloud backup. Local and cloud data were not overwritten.',
              },
            })
            onNotify('Synchronization paused: conflicting edits need review. Neither local nor cloud data was replaced.')
            return
          }

          // A user may record a solve while the download is in flight. Never
          // replace that newer snapshot with the earlier merge result.
          if (sessionsRef.current !== local || settingsRef.current !== localSettings) {
            throw new Error('Local data changed during synchronization. Please sync again to merge the newest changes.')
          }

          const mergedTombstones = merged.mergedTombstones
          const remoteRevision = remoteEnvelope?.revision ?? 0
          const nextRevision = Math.max(remoteRevision, syncRef.current.runtime.lastRemoteRevision ?? 0) + 1
          const envelope = createSyncEnvelope(
            syncRef.current.runtime.deviceId,
            nextRevision,
            mergedTombstones,
            merged.conflicts,
            merged.sessionRedirects,
          )

          const backup = createBackup(merged.merged, mergedSettings, new Date(), envelope)
          // Capture an in-flight edit rather than silently committing stale
          // merged state. The remote transport still needs real CAS protection.
          if (sessionsRef.current !== local || settingsRef.current !== localSettings) {
            throw new Error('Local data changed before upload. Synchronization was cancelled safely.')
          }
          const existingFileId = remoteFile?.id ?? getRemoteFileId()
          const result = await transport.uploadBackup(JSON.stringify(backup), existingFileId)

          // Do not overwrite solves added while the network upload was in progress.
          // Schedule a follow-up merge instead of treating the uploaded state as
          // completely synchronized. Keep the local state as the source of truth.
          if (sessionsRef.current !== local || settingsRef.current !== localSettings) {
            persist({ ...syncRef.current, runtime: {
              ...syncRef.current.runtime,
              lastSyncStatus: 'pending',
              lastError: 'New local changes occurred during upload; another sync is needed.',
            } })
            window.setTimeout(() => void syncNowRef.current?.('retry'), 0)
            return
          }

          // Publish only after upload success; failed writes cannot cause an
          // adopted snapshot to erase unsaved local work.
          knownSessionsRef.current = merged.merged
          sessionsRef.current = merged.merged
          onReplaceSessions(merged.merged)
          onReplaceSettings(mergedSettings)

          const now = Date.now()
          const updatedConflicts =
            syncRef.current.preferences.manualConflictReview
              ? mergeConflictRecords(syncRef.current.runtime.conflicts, merged.conflicts)
              : syncRef.current.runtime.conflicts.filter((c) => c.resolution !== 'local' && c.resolution !== 'remote').concat(
                  merged.conflicts.map((conflict) => ({ ...conflict, resolution: conflict.resolution === 'manual-pending' ? 'local' : conflict.resolution })),
                )

          // Prune conflicts older than 100 for maintainability.
          const trimmedConflicts = updatedConflicts.slice(-100)

          const next = {
            ...syncRef.current,
            runtime: {
              ...syncRef.current.runtime,
              lastSyncAt: now,
              lastSyncStatus: trimmedConflicts.some((c) => c.resolution === 'manual-pending')
                ? ('conflict' as SyncStatus)
                : ('synced' as SyncStatus),
              lastError: null,
              solveCountAtLastSync: countSolvesInData(merged.merged),
              lastRemoteRevision: nextRevision,
              tombstones: mergedTombstones,
              conflicts: trimmedConflicts,
              sessionRedirects: merged.sessionRedirects,
              pendingDuplicateNames: merged.duplicateSessionNames,
            },
          }
          persist(next)
          lastSyncedSessionsRef.current = merged.merged

          const addedRemote = importedSolves

          backoffRef.current = 1_000

          // Drive metadata compatibility.
          const driveState = loadDriveBackupState()
          saveDriveBackupState({
            ...driveState,
            remoteFileId: result.id,
            remoteModifiedTime: result.modifiedTime,
            lastBackupAt: now,
            lastRestoreAt: driveState.lastRestoreAt,
            connectedAccountLabel: transport.accountLabel || driveState.connectedAccountLabel,
          })

          if (reason === 'reconnect' || reason === 'manual') {
            const messages: string[] = []
            if (merged.adoptedLocalDefault) {
              messages.push('Cloud sessions imported')
            }
            if (uploadedSolves > 0) messages.push(`${uploadedSolves} new local solve${uploadedSolves === 1 ? '' : 's'} uploaded`)
            if (merged.duplicateSessionNames.length > 0 && onDuplicateSessionDetected) {
              onDuplicateSessionDetected(merged.duplicateSessionNames)
            }
            if (merged.duplicateSessionNames.length > 0) {
              messages.push(
                `CubeLab found two separate sessions named ${merged.duplicateSessionNames
                  .map((name) => `'${name}'`)
                  .join(', ')}.`,
              )
            }
            if (addedRemote > 0) messages.push(`${addedRemote} cloud solve${addedRemote === 1 ? '' : 's'} merged`)
            if (merged.recoveredSolves > 0) {
              messages.push(
                `${merged.recoveredSolves} solve${merged.recoveredSolves === 1 ? '' : 's'} recovered from a deleted session`,
              )
            }
            if (merged.conflicts.length > 0 && !syncRef.current.preferences.manualConflictReview) {
              messages.push(`${merged.conflicts.length} conflict${merged.conflicts.length === 1 ? '' : 's'} automatically resolved`)
            }
            if (messages.length > 0) {
              onNotify(messages.join(' · ') + '.')
            } else if (reason === 'manual') {
              onNotify('Synchronization complete. No new solves were exchanged.')
            }
          }
        } catch (caught) {
          const message = toMessage(caught)
          const authRequired = message.toLowerCase().includes('authorization') || message.toLowerCase().includes('connect')
          persist({
            ...syncRef.current,
            runtime: {
              ...syncRef.current.runtime,
              lastSyncStatus: authRequired ? 'auth-required' : 'failed',
              lastError: message,
            },
          })
          // Retry with backoff.
          backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF_MS)
          if (retryTimerRef.current !== null) window.clearTimeout(retryTimerRef.current)
          retryTimerRef.current = window.setTimeout(() => void syncNowRef.current?.('retry'), backoffRef.current)
        }
      })()

      runningRef.current = promise
      await promise.finally(() => {
        runningRef.current = null
      })
    },
    [persist, transport, onReplaceSessions, onReplaceSettings, onNotify, onDuplicateSessionDetected],
  )

  useEffect(() => {
    syncNowRef.current = syncNow
  }, [syncNow])

  // Web Locks guarantees one syncing tab. Followers never self-elect while
  // a lock holder exists, and lock ownership ends on unmount.
  useEffect(() => {
    const locks = navigator.locks
    if (!locks) {
      leaderRef.current = true
      return () => { leaderRef.current = false }
    }
    locksSupportedRef.current = true
    let released = false
    let releaseLock: (() => void) | undefined
    void locks.request('cubelab-sync-leader', async () => {
      if (released) return
      leaderRef.current = true
      if (syncRef.current.preferences.enabled && syncRef.current.preferences.syncOnStartup) {
        window.setTimeout(() => void syncNowRef.current?.('startup'), 0)
      }
      await new Promise<void>((resolve) => { releaseLock = resolve })
      leaderRef.current = false
    })
    return () => {
      released = true
      leaderRef.current = false
      releaseLock?.()
    }
  }, [])

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

  // Time-based and solve-count scheduling.
  useEffect(() => {
    if (!syncRef.current.preferences.enabled) return

    const intervalMs = syncRef.current.preferences.intervalMinutes * 60 * 1000

    const runScheduled = () => {
      if (timerActiveRef.current) {
        window.setTimeout(runScheduled, 1_000)
        return
      }
      void syncNow('scheduled')
    }

    // Automatic synchronization is intentionally always combined.
    let intervalId: number | null = null
    intervalId = window.setInterval(runScheduled, intervalMs)

    return () => {
      if (intervalId !== null) window.clearInterval(intervalId)
    }
  }, [sync.preferences.enabled, sync.preferences.mode, sync.preferences.intervalMinutes, syncNow])

  // Solve-count trigger + non-solve fallback.
  useEffect(() => {
    if (!syncRef.current.preferences.enabled) return
    if (timerActiveRef.current) return

    const pendingSolves = Math.max(0, countSolvesInData(sessions) - syncRef.current.runtime.solveCountAtLastSync)
    const shouldSolveSync =
      pendingSolves >= syncRef.current.preferences.solveThreshold

    if (shouldSolveSync) {
      window.setTimeout(() => {
        if (!timerActiveRef.current) void syncNow('solve-count')
      }, 0)
      return
    }

    // Non-solve fallback when dirty.
    if (fallbackTimerRef.current === null) {
      fallbackTimerRef.current = window.setTimeout(() => {
        fallbackTimerRef.current = null
        if (!syncRef.current.preferences.enabled || timerActiveRef.current) return
        void syncNow('fallback')
      }, Math.max(60_000, syncRef.current.preferences.intervalMinutes * 60 * 1000))
    }
  }, [
    sessions,
    sync.preferences.enabled,
    sync.preferences.mode,
    sync.preferences.solveThreshold,
    sync.runtime.solveCountAtLastSync,
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

  return {
    phase: sync.preferences.enabled ? sync.runtime.lastSyncStatus : 'disabled',
    lastSyncAt: sync.runtime.lastSyncAt,
    newSolvesSinceLastSync,
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
    clearDeletion,
    resetBase,
    approveSessionMerge,
    resolveConflict,
  }
}
