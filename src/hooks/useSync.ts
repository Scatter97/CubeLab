import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
} from '../lib/syncStorage'
import {
  createSyncEnvelope,
  mergeSessionsData,
  mergeSettings,
  parseRemoteSyncEnvelope,
  createTombstone,
} from '../lib/sync'

interface UseSyncOptions {
  transport: DriveTransport | null
  sessions: SessionsData
  settings: Settings
  storageOk: boolean
  timerActive: boolean
  onReplaceSessions: (data: SessionsData) => void
  onReplaceSettings: (settings: Settings) => void
  onNotify: (message: string) => void
}

export interface UseSyncResult {
  phase: SyncStatus
  lastSyncAt: number | null
  pendingCount: number
  error: string | null
  conflictsCount: number
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
  const backoffRef = useRef(1_000)
  const fallbackTimerRef = useRef<number | null>(null)
  const retryTimerRef = useRef<number | null>(null)

  useEffect(() => {
    sessionsRef.current = sessions
  }, [sessions])
  useEffect(() => {
    settingsRef.current = settings
  }, [settings])
  useEffect(() => {
    syncRef.current = sync
  }, [sync])
  useEffect(() => {
    timerActiveRef.current = timerActive
  }, [timerActive])

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
      for (const id of previousSessionIds) {
        if (!currentSessionIds.has(id)) {
          const already = syncRef.current.runtime.tombstones.some(
            (tombstone) => tombstone.kind === 'session' && tombstone.id === id,
          )
          if (!already) {
            const next = {
              ...syncRef.current,
              runtime: {
                ...syncRef.current.runtime,
                tombstones: [
                  ...syncRef.current.runtime.tombstones,
                  createTombstone('session', id, undefined, syncRef.current.runtime.deviceId),
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
      const next = {
        ...syncRef.current,
        runtime: {
          ...syncRef.current.runtime,
          tombstones: [
            ...syncRef.current.runtime.tombstones,
            createTombstone(kind, id, sessionId, syncRef.current.runtime.deviceId),
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
      if (!leaderRef.current && !timerActiveRef.current) {
        // Followers primarily mirror; only the coordinator syncs.
      }
      if (!leaderRef.current) {
        // Avoid a silent no-op if tab leadership was never resolved.
        leaderRef.current = true
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

          const local = sessionsRef.current
          const merged = mergeSessionsData({
            local,
            remote: remoteSessions,
            tombstones: [...syncRef.current.runtime.tombstones, ...(remoteEnvelope?.tombstones ?? [])],
            deviceId: syncRef.current.runtime.deviceId,
            manualConflictReview: syncRef.current.preferences.manualConflictReview,
          })

          // Settings merge.
          const mergedSettings = mergeSettings(
            settingsRef.current,
            remoteSettings,
            remoteEnvelope?.updatedAt ?? 0,
            syncRef.current.runtime.lastSyncAt,
          )

          const beforeCount = countSolvesInData(local)


          onReplaceSessions(merged.merged)
          onReplaceSettings(mergedSettings)

          const mergedTombstones = merged.mergedTombstones
          const remoteRevision = remoteEnvelope?.revision ?? 0
          const nextRevision = Math.max(remoteRevision, syncRef.current.runtime.lastRemoteRevision ?? 0) + 1
          const envelope = createSyncEnvelope(
            syncRef.current.runtime.deviceId,
            nextRevision,
            mergedTombstones,
            merged.conflicts,
          )

          const backup = createBackup(merged.merged, mergedSettings, new Date(), envelope)
          const existingFileId = remoteFile?.id ?? getRemoteFileId()
          const result = await transport.uploadBackup(JSON.stringify(backup), existingFileId)

          const now = Date.now()
          const updatedConflicts =
            syncRef.current.preferences.manualConflictReview
              ? [...syncRef.current.runtime.conflicts, ...merged.conflicts]
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
            },
          }
          persist(next)
          lastSyncedSessionsRef.current = merged.merged

          const total = countSolvesInData(merged.merged)
          const addedRemote = total > beforeCount ? total - beforeCount : 0

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
            if (merged.addedSolves > 0) messages.push(`${merged.addedSolves} new local solve${merged.addedSolves === 1 ? '' : 's'} uploaded`)
            if (addedRemote > 0) messages.push(`${addedRemote} cloud solve${addedRemote === 1 ? '' : 's'} merged`)
            if (merged.conflicts.length > 0 && !syncRef.current.preferences.manualConflictReview) {
              messages.push(`${merged.conflicts.length} conflict${merged.conflicts.length === 1 ? '' : 's'} automatically resolved`)
            }
            if (messages.length > 0) {
              onNotify(messages.join(' · ') + '.')
            } else if (reason === 'manual') {
              onNotify('Synchronization complete.')
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
    [persist, transport, onReplaceSessions, onReplaceSettings, onNotify],
  )

  useEffect(() => {
    syncNowRef.current = syncNow
  }, [syncNow])

  // Leader election via Web Locks.
  useEffect(() => {
    let released = false
    const locks = (navigator as any).locks
    if (!locks) {
      leaderRef.current = true
      return () => {
        leaderRef.current = false
      }
    }
    const leaderTimeout = window.setTimeout(() => {
      leaderRef.current = true
    }, 1_000)
    void locks.request('cubelab-sync-leader', { ifAvailable: true }, async (lock: any) => {
      window.clearTimeout(leaderTimeout)
      if (!lock) {
        leaderRef.current = true
        return
      }
      if (!lock || released) return
      leaderRef.current = true
      // Startup sync.
      if (syncRef.current.preferences.enabled && syncRef.current.preferences.syncOnStartup) {
        window.setTimeout(() => void syncNow('startup'), 0)
      }
      await new Promise<void>(() => {
        // Hold the lock for the lifetime of the tab.
      })
    })
    return () => {
      released = true
      leaderRef.current = false
    }
  }, [syncNow])

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

  const pendingCount = useMemo(() => {
    if (!sync.preferences.enabled) return 0
    return Math.max(0, countSolvesInData(sessions) - sync.runtime.solveCountAtLastSync)
  }, [sessions, sync.preferences.enabled, sync.runtime.solveCountAtLastSync])

  const conflictsCount = sync.runtime.conflicts.filter((c) => c.resolution === 'manual-pending').length

  return {
    phase: sync.preferences.enabled ? sync.runtime.lastSyncStatus : 'disabled',
    lastSyncAt: sync.runtime.lastSyncAt,
    pendingCount,
    error: sync.runtime.lastError,
    conflictsCount,
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
  }
}
