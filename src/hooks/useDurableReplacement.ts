import { useCallback } from 'react'
import type { MutableRefObject } from 'react'
import type { SessionsData, Settings } from '../types'
import type { TimerState } from '../timer/machine'
import type { UseSyncResult } from './useSync'
import type { DriveBackupState } from '../lib/driveStorage'
import type { SyncStorageData } from '../lib/syncStorage'
import type {
  ReplacementKind,
  ReplacementKey,
} from '../lib/replacement'
import {
  beginReplacement,
  clearReplacementJournal,
  loadReplacementJournal,
  markReplacementCommitted,
  pendingReplacementMessage,
  recoverPendingReplacement,
  rollbackReplacement,
} from '../lib/replacement'
import { runWithDriveWriteLock } from '../lib/driveCoordination'
import { loadSolveRecovery } from '../lib/solveRecovery'
import { saveDriveBackupState } from '../lib/driveStorage'
import { countSolves } from '../lib/sessions'
import {
  applyPendingCompletion,
  acknowledgePendingCompletion,
  loadPendingCompletion,
} from '../lib/pendingCompletion'
import {
  loadSyncStorage,
  saveSyncStorage,
  type Tombstone,
} from '../lib/syncStorage'

export interface DurableReplacementPlan {
  kind: ReplacementKind
  sessionsData: SessionsData
  settingsData?: Settings
  syncStorage: SyncStorageData
  driveState?: DriveBackupState
  successMessage: string
  failurePrefix: string
  onSuccess: () => void
}

export interface UseDurableReplacementOptions {
  sync: UseSyncResult
  timerStatusRef: MutableRefObject<TimerState['status']>
  settings: Settings
  stageSessions: (data: SessionsData) => boolean
  stageSettings: (settings: Settings) => boolean
  replaceSessions: (data: SessionsData) => void
  replaceSettings: (settings: Settings) => void
  onNotify: (message: string) => void
}

/**
 * Durable coordinator for native import, Drive restore and additive import.
 *
 * The order is deliberate: validate the current guards, capture every previous
 * committed value in a journal, write every candidate key, record the commit
 * marker, then publish React state and success metadata. A prepared journal is
 * rolled back by startup recovery; a committed journal is rolled forward.
 */
export function useDurableReplacement(
  options: UseDurableReplacementOptions,
): (plan: DurableReplacementPlan) => Promise<boolean> {
  const {
    sync,
    timerStatusRef,
    settings,
    stageSessions,
    stageSettings,
    replaceSessions,
    replaceSettings,
    onNotify,
  } = options

  return useCallback(
    async (plan: DurableReplacementPlan): Promise<boolean> => {
      if (timerStatusRef.current !== 'idle') {
        onNotify(`${plan.failurePrefix}: wait for the timer to return to idle.`)
        return false
      }
      if (sync.isSyncRunning()) {
        onNotify(
          `${plan.failurePrefix}: wait for the current synchronization to finish.`,
        )
        return false
      }
      const existing = loadReplacementJournal()
      if (existing.status === 'invalid') {
        onNotify(existing.message)
        return false
      }
      if (existing.status === 'ok' && existing.journal.phase === 'prepared') {
        onNotify(
          'Another replacement is still being committed. Reload or retry after it finishes.',
        )
        return false
      }
      if (existing.status === 'ok') {
        const recovery = recoverPendingReplacement()
        const message = pendingReplacementMessage(recovery)
        if (message) {
          onNotify(message)
          return false
        }
      }
      if (loadSolveRecovery().operations.length > 0) {
        onNotify(
          `${plan.failurePrefix}: finish the pending Undo recovery first. It is retried automatically after storage recovers or on reload.`,
        )
        return false
      }

      return runWithDriveWriteLock(async () => {
        if (timerStatusRef.current !== 'idle' || sync.isSyncRunning()) {
          onNotify(
            `${plan.failurePrefix}: timing or synchronization started before the replacement could commit.`,
          )
          return false
        }

        const pendingCompletion = loadPendingCompletion()
        if (pendingCompletion.status === 'invalid') {
          onNotify(pendingCompletion.message)
          return false
        }
        const completion =
          pendingCompletion.status === 'ok'
            ? pendingCompletion.completion
            : null
        let tombstones: readonly Tombstone[]
        try {
          tombstones = loadSyncStorage().runtime.tombstones
        } catch {
          onNotify(
            `${plan.failurePrefix}: the deletion records could not be read.`,
          )
          return false
        }
        // A completion accepted by another tab while this candidate was being
        // prepared belongs to the replacement outcome too. Apply it before the
        // candidate is staged so the commit is complete on disk.
        const sessionsData = completion
          ? applyPendingCompletion(plan.sessionsData, completion, tombstones)
          : plan.sessionsData
        const syncStorage = completion
          ? {
              ...plan.syncStorage,
              runtime: {
                ...plan.syncStorage.runtime,
                solveCountAtLastSync: countSolves(sessionsData.sessions),
              },
            }
          : plan.syncStorage

        const keys: ReplacementKey[] = ['sessions', 'sync']
        if (plan.settingsData) keys.push('settings')
        if (plan.driveState !== undefined) keys.push('drive')
        const begun = beginReplacement(plan.kind, keys)
        if (!begun.ok) {
          onNotify(`${plan.failurePrefix}: ${begun.error}`)
          return false
        }
        const journal = begun.journal
        const fail = (detail: string): false => {
          const rolledBack = rollbackReplacement(journal)
          if (rolledBack) clearReplacementJournal()
          onNotify(
            rolledBack
              ? `${plan.failurePrefix}: ${detail} Nothing was replaced.`
              : `${plan.failurePrefix}: ${detail} The previous state could not be fully restored. A recovery record was kept; synchronization and new imports stay paused until reload or storage recovery.`,
          )
          return false
        }

        if (!stageSessions(sessionsData)) {
          return fail('the sessions could not be saved.')
        }
        if (plan.settingsData && !stageSettings(plan.settingsData)) {
          return fail('the settings could not be saved.')
        }
        if (!saveSyncStorage(syncStorage)) {
          return fail('the synchronization metadata could not be saved.')
        }
        if (plan.driveState && !saveDriveBackupState(plan.driveState)) {
          return fail('the Drive backup status could not be saved.')
        }
        if (!markReplacementCommitted(journal)) {
          return fail('the durable commit marker could not be saved.')
        }

        // Commit point passed. Publish the complete committed state in memory.
        const committedSettings = plan.settingsData ?? settings
        sync.adoptCommittedReplacement(
          syncStorage,
          sessionsData,
          committedSettings,
        )
        replaceSessions(sessionsData)
        if (plan.settingsData) replaceSettings(plan.settingsData)
        plan.onSuccess()

        // The committed collection is durable. Remove only the exact buffered
        // solve versions that were incorporated; a later append stays pending.
        const completionAcknowledged = completion
          ? acknowledgePendingCompletion(completion, {
              data: sessionsData,
              tombstones,
            })
          : true
        const cleaned = clearReplacementJournal()
        onNotify(
          cleaned && completionAcknowledged
            ? plan.successMessage
            : `${plan.successMessage}. Recovery cleanup is pending; synchronization will finish it automatically.`,
        )
        return true
      })
    },
    [
      onNotify,
      replaceSessions,
      replaceSettings,
      settings,
      stageSessions,
      stageSettings,
      sync,
      timerStatusRef,
    ],
  )
}
