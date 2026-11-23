import { useEffect, useMemo, useRef, useState } from 'react'
import { useModalDialog } from '../hooks/useModalDialog'
import { useDriveBackup } from '../hooks/useDriveBackup'
import {
  useTrainingDriveBackup,
  type InvalidTrainingRemoteSnapshot,
} from '../hooks/useTrainingDriveBackup'
import { ConfirmDialog } from './ConfirmDialog'
import type { DriveFile, DriveTransport } from '../lib/driveTransport'
import type { UseSyncResult } from '../hooks/useSync'
import type { UseTrainingSyncResult } from '../hooks/useTrainingSync'
import type { MutableRefObject } from 'react'
import type { TimerState } from '../timer/machine'
import type {
  TrainingController,
  TrainingControllerState,
} from '../lib/training/controller'
import type { TrainingBackupSummary } from '../lib/training/backupSection'
import type { TrainingRemoteSnapshot } from '../lib/trainingDrive'
import { AVERAGE_TRIM_OPTIONS } from '../lib/averageTrimming'
import { CloseIcon } from './Icons'
import { Select } from './Select'
import type { SessionsData, Settings } from '../types'
import { loadDriveBackupState } from '../lib/driveStorage'
import type { SyncConflict } from '../lib/syncStorage'
import { getSyncDeviceId } from '../lib/syncStorage'
import {
  SNAPSHOT_KEEP_OPTIONS,
  SNAPSHOT_MAX_AGE_OPTIONS,
  describeSnapshotOwner,
  groupRemoteSnapshots,
  newestSnapshotModifiedAt,
  selectSnapshotsForCleanup,
  type SnapshotKeepPerDevice,
  type SnapshotMaxAgeDays,
} from '../lib/snapshotRetention'

const FIELD_LABELS: Record<string, string> = {
  rawMs: 'time',
  penalty: 'penalty',
  scramble: 'scramble',
  comment: 'comment',
  name: 'session name',
  event: 'puzzle event',
  inspectionEnabled: 'inspection',
  inspectionCountDirection: 'inspection direction',
  inspectionWarning8s: '8-second warning',
  inspectionWarning12s: '12-second warning',
  inspectionWarningVisualScope: 'warning visual scope',
  scrambleAlignment: 'scramble alignment',
  scrambleLimitHeight: 'scramble height limit',
  scrambleAction: 'scramble action',
  timerUpdateMode: 'timer display',
  holdDurationMs: 'hold duration',
  stopWithAnyKey: 'stop with any key',
  showTimerDecimalSmall: 'small timer decimals',
  uiZoomPercent: 'interface zoom',
  alertChannel: 'alert channel',
  alertVolume: 'alert volume',
  theme: 'theme',
  accentColor: 'accent color',
  statVisibility: 'statistics visibility',
  customAverages: 'custom averages',
  statMetricVisibility: 'statistics metrics',
  statTargetsMs: 'legacy statistics targets',
  statPrecision: 'statistics precision',
  averageTrimBetter: 'average trimming (better side)',
  averageTrimWorse: 'average trimming (worse side)',
  redirect: 'merge destination',
  legacyRecovery: 'legacy recovery',
  placeholder: 'scramble placeholder',
}

function conflictFieldLabel(field: string): string {
  if (field.startsWith('preferences.')) {
    return FIELD_LABELS[field.slice('preferences.'.length)] ?? field.slice('preferences.'.length)
  }
  return FIELD_LABELS[field] ?? field
}

function recoverySolveIds(value: unknown): string[] {
  if (typeof value !== 'string' || !value.startsWith('recover:')) return []
  return value
    .slice('recover:'.length)
    .split(',')
    .filter((id) => id.length > 0)
}

function formatConflictValue(field: string, value: unknown): string {
  if (field === 'averageTrimBetter' || field === 'averageTrimWorse') {
    if (value === 'auto') return 'Auto (match better side)'
    const option = AVERAGE_TRIM_OPTIONS.find((entry) => entry.value === value)
    if (option) return option.label
  }
  if (field === 'legacyRecovery') {
    if (value === 'keep-deleted') return 'keep deleted'
    const ids = recoverySolveIds(value)
    if (ids.length > 0) {
      return `${ids.length} older solve${ids.length === 1 ? '' : 's'}`
    }
  }
  if (value === undefined || value === null) return 'not set'
  if (typeof value === 'boolean') return value ? 'on' : 'off'
  if (field === 'rawMs' && typeof value === 'number') {
    return `${(value / 1000).toFixed(2)} s`
  }
  if (typeof value === 'object') {
    const text = JSON.stringify(value)
    return text.length > 80 ? `${text.slice(0, 77)}…` : text
  }
  const text = String(value)
  if (text.length === 0) return '(empty)'
  return text.length > 80 ? `${text.slice(0, 77)}…` : text
}

function conflictKey(conflict: SyncConflict): string {
  return `${conflict.kind}:${conflict.id}:${conflict.field}`
}

function formatTrainingSyncValue(value: unknown): string {
  if (value === undefined) return 'not set'
  if (value === null) return 'null'
  if (typeof value === 'string') return value.length > 100 ? `${value.slice(0, 97)}…` : value
  const text = JSON.stringify(value)
  return text.length > 100 ? `${text.slice(0, 97)}…` : text
}

/** How many conflicts render before the reviewer expands the list. */
const CONFLICT_PAGE_SIZE = 5
/** How many resolved decisions render before the history expands. */
const AUDIT_PAGE_SIZE = 5
/** How many snapshots of one device render before the list expands. */
const SNAPSHOT_PAGE_SIZE = 5

function formatBytes(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return 'size unknown'
  }
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(2)} MB`
}

function formatSnapshotTime(file: DriveFile): string {
  if (!file.modifiedTime) return 'unknown time'
  const parsed = Date.parse(file.modifiedTime)
  return Number.isFinite(parsed)
    ? new Date(parsed).toLocaleString()
    : 'unknown time'
}

function totalSnapshotBytes(files: ReadonlyArray<DriveFile>): number {
  return files.reduce((total, file) => total + (file.size ?? 0), 0)
}

const trainingDateFormatter = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
})
const trainingCountFormatter = new Intl.NumberFormat('en-US')

function formatTrainingCount(value: number): string {
  return trainingCountFormatter.format(value)
}

function formatTrainingRange(
  firstAttemptAt: number | null,
  lastAttemptAt: number | null,
): string {
  if (firstAttemptAt === null || lastAttemptAt === null) return 'no attempts'
  const from = trainingDateFormatter.format(new Date(firstAttemptAt))
  const to = trainingDateFormatter.format(new Date(lastAttemptAt))
  return from === to ? from : `${from} – ${to}`
}

function trainingSummaryLabel(summary: TrainingBackupSummary): string {
  return `${formatTrainingCount(summary.attempts)} attempt${
    summary.attempts === 1 ? '' : 's'
  } · ${formatTrainingCount(summary.sessions)} saved session${
    summary.sessions === 1 ? '' : 's'
  } · ${formatTrainingCount(summary.calibrations)} calibration${
    summary.calibrations === 1 ? '' : 's'
  } · ${formatTrainingCount(summary.customAlgorithms)} custom algorithm${
    summary.customAlgorithms === 1 ? '' : 's'
  } · ${formatTrainingCount(summary.presets)} preset${
    summary.presets === 1 ? '' : 's'
  } · ${formatTrainingRange(summary.firstAttemptAt, summary.lastAttemptAt)}`
}

function conflictTitle(
  conflict: Pick<SyncConflict, 'kind' | 'id' | 'field' | 'sessionId'>,
  sessions: SessionsData,
): string {
  const session = sessions.sessions.find(
    (candidate) =>
      candidate.id === conflict.sessionId || candidate.id === conflict.id,
  )
  const variable =
    conflict.kind === 'event'
      ? conflict.field === 'name'
        ? 'event name'
        : conflict.field === 'placeholder'
          ? 'scramble placeholder'
          : conflict.field
      : conflictFieldLabel(conflict.field)
  if (conflict.kind === 'settings') return `Global settings · ${variable}`
  if (conflict.kind === 'redirect') {
    return `Session merge${session ? ` · ${session.name}` : ''} · ${variable}`
  }
  if (conflict.kind === 'session') {
    if (conflict.field === 'legacyRecovery') {
      return 'Deleted session · legacy recovery'
    }
    return `Session${session ? ` · ${session.name}` : ''} · ${variable}`
  }
  if (conflict.kind === 'event') {
    const definition = (sessions.customEvents ?? []).find(
      (candidate) => candidate.id === conflict.id,
    )
    return `Custom event${definition ? ` · ${definition.name}` : ''} · ${variable}`
  }
  return `Solve ${conflict.id.slice(0, 8)}${session ? ` · ${session.name}` : ''} · ${variable}`
}

function resolutionLabel(
  kind: SyncConflict['kind'],
  remoteOnly: boolean | undefined,
  resolution: 'local' | 'remote',
): string {
  if (kind === 'redirect') {
    return resolution === 'local' ? 'newest cloud destination' : 'other cloud destination'
  }
  if (remoteOnly) {
    return resolution === 'local' ? 'newest cloud version' : 'other cloud version'
  }
  return resolution === 'local' ? 'this device' : 'cloud'
}

interface DriveBackupDialogProps {
  open: boolean
  transport: DriveTransport | null
  sessions: SessionsData
  settings: Settings
  storageOk: boolean
  sync: UseSyncResult
  training: {
    controller: TrainingController
    state: TrainingControllerState
  }
  trainingSync: UseTrainingSyncResult
  timerStatusRef: MutableRefObject<TimerState['status']>
  onClose: () => void
  onNotify: (message: string) => void
  onPendingRestore: (backup: import('../lib/backup').Backup) => void
  onReviewDuplicateNames: () => void
}

export function DriveBackupDialog({
  open,
  transport,
  sessions,
  settings,
  storageOk,
  sync,
  training,
  trainingSync,
  timerStatusRef,
  onClose,
  onNotify,
  onPendingRestore,
  onReviewDuplicateNames,
}: DriveBackupDialogProps) {
  const { dialogRef, handleKeyDown } = useModalDialog(open)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [conflictsExpanded, setConflictsExpanded] = useState(false)
  const [historyExpanded, setHistoryExpanded] = useState(false)
  const drive = useDriveBackup({
    transport,
    sessions,
    settings,
    storageOk,
    onPendingRestore,
    onNotify,
    onConnected: () => sync.updatePreferences({ enabled: true }),
  })
  const trainingDrive = useTrainingDriveBackup({
    transport,
    controller: training.controller,
    trainingState: training.state,
    sync,
    timerStatusRef,
    onNotify,
    onRestored: () => {
      trainingSync.reload()
      onClose()
    },
  })
  const [trainingRestoreTarget, setTrainingRestoreTarget] =
    useState<TrainingRemoteSnapshot | null>(null)
  const [trainingDeleteTarget, setTrainingDeleteTarget] =
    useState<TrainingRemoteSnapshot | null>(null)
  const [trainingInvalidDeleteTarget, setTrainingInvalidDeleteTarget] =
    useState<InvalidTrainingRemoteSnapshot | null>(null)
  const [expandedSnapshotGroups, setExpandedSnapshotGroups] = useState<string[]>([])
  const [snapshotDeleteTarget, setSnapshotDeleteTarget] = useState<DriveFile | null>(
    null,
  )
  const [cleanupConfirmOpen, setCleanupConfirmOpen] = useState(false)
  const [cleanupCount, setCleanupCount] = useState(0)
  const localDeviceId = useMemo(() => getSyncDeviceId(), [])
  const snapshotGroups = useMemo(
    () => groupRemoteSnapshots(drive.snapshots ?? [], localDeviceId),
    [drive.snapshots, localDeviceId],
  )
  const snapshotTotalBytes = useMemo(
    () => totalSnapshotBytes(drive.snapshots ?? []),
    [drive.snapshots],
  )

  // The hook recreates its callbacks when connection metadata changes, so keep
  // the latest loader in a ref. Depending on the callback itself would re-run
  // this effect after every snapshot state update and loop forever.
  const refreshSnapshotsRef = useRef(drive.refreshSnapshots)
  useEffect(() => {
    refreshSnapshotsRef.current = drive.refreshSnapshots
  }, [drive.refreshSnapshots])
  const driveConnected = drive.connected
  useEffect(() => {
    if (!open || !driveConnected) return
    void refreshSnapshotsRef.current()
  }, [open, driveConnected])
  const refreshTrainingSnapshotsRef = useRef(trainingDrive.refreshSnapshots)
  useEffect(() => {
    refreshTrainingSnapshotsRef.current = trainingDrive.refreshSnapshots
  }, [trainingDrive.refreshSnapshots])
  const trainingDriveConnected = trainingDrive.connected
  useEffect(() => {
    if (!open || !trainingDriveConnected) return
    void refreshTrainingSnapshotsRef.current()
  }, [open, trainingDriveConnected])
  if (!open) return null

  const phase = drive.phase
  const busy =
    phase === 'connecting' ||
    phase === 'backing-up' ||
    phase === 'restoring' ||
    phase === 'deleting'
  const driveStatus = !drive.configured
    ? 'Not configured for this build.'
    : phase === 'connecting'
      ? 'Connecting to Google Drive…'
      : phase === 'error'
        ? 'Google Drive connection error.'
        : phase === 'backing-up'
          ? drive.connected
            ? 'Connected · backing up…'
            : 'Backing up…'
          : phase === 'restoring'
            ? drive.connected
              ? 'Connected · restoring…'
              : 'Restoring…'
            : phase === 'deleting'
              ? drive.connected
                ? 'Connected · deleting remote backup…'
                : 'Deleting remote backup…'
              : !drive.connected
                ? 'Not connected. Connect to enable synchronization.'
                : sync.pendingConflicts.length > 0
                  ? `Connected · ${sync.pendingConflicts.length} conflict${
                      sync.pendingConflicts.length === 1 ? '' : 's'
                    } to review.`
                  : sync.phase === 'offline'
                    ? 'Connected · offline. Changes are saved locally.'
                    : sync.phase === 'failed'
                      ? 'Connected · last sync failed.'
                      : sync.phase === 'auth-required'
                        ? 'Connected · Google Drive needs reconnection.'
                        : sync.phase === 'syncing'
                          ? 'Connected · syncing…'
                          : !sync.preferences.enabled
                            ? 'Connected · automatic synchronization is off.'
                            : sync.hasPendingChanges
                              ? 'Connected · changes waiting to sync.'
                              : 'Connected · up to date.'
  const conflictCount = sync.pendingConflicts.length
  const persistedDriveState = loadDriveBackupState()
  const remoteFileId =
    persistedDriveState.remoteFileId ?? drive.metadata.remoteFileId
  const handleDisconnect = () => {
    drive.disconnect()
    // A disconnected browser cannot synchronize. Keep the preference state
    // coherent instead of advertising automatic sync that can only fail.
    sync.updatePreferences({ enabled: false })
    onNotify('Google Drive disconnected. Automatic synchronization is off.')
  }
  const snapshotDeleteOwner = snapshotDeleteTarget
    ? describeSnapshotOwner(snapshotDeleteTarget, localDeviceId)
    : null
  const handleCleanupRequest = () => {
    const files = drive.snapshots ?? []
    const candidates = selectSnapshotsForCleanup(files, {
      keepPerDevice: sync.preferences.snapshotKeepPerDevice,
      maxAgeDays: sync.preferences.snapshotMaxAgeDays,
      localDeviceId,
      publishedAt: newestSnapshotModifiedAt(files),
      ownOnly: true,
    })
    if (candidates.length === 0) {
      onNotify('No old snapshots needed cleanup')
      return
    }
    setCleanupCount(candidates.length)
    setCleanupConfirmOpen(true)
  }

  return (
    <>
      <dialog
        ref={dialogRef}
        className="confirm-dialog settings-dialog"
        aria-labelledby="drive-backup-title"
        aria-describedby="drive-backup-description"
        onKeyDown={handleKeyDown}
        onCancel={(event) => {
          event.preventDefault()
          onClose()
        }}
        onClick={(event) => {
          if (event.target === dialogRef.current) onClose()
        }}
      >
        <div className="dialog-content settings-content">
          <header className="settings-header">
            <div>
              <h2 id="drive-backup-title">Google Drive backup</h2>
            </div>
            <button
              type="button"
              className="icon-button settings-close"
              aria-label="Close Google Drive backup"
              title="Close Google Drive backup"
              onClick={onClose}
            >
              <CloseIcon size={16} />
            </button>
          </header>

          <p id="drive-backup-description" className="settings-intro">
            Automatic local-first synchronization with Google Drive app data.
          </p>

          <div className="settings-body">
            <section
              className="settings-section"
              aria-labelledby="drive-status-title"
            >
              <div className="settings-section-heading">
                <h3 id="drive-status-title">Status</h3>
              </div>

              <div className="settings-row">
                <div className="settings-row-copy">
                  <span className="settings-row-label">Google Drive</span>
                  <span
                    className="settings-row-description"
                    data-testid="drive-status"
                  >
                    {driveStatus}
                  </span>
                </div>
              </div>

              {drive.metadata.connectedAccountLabel ? (
                <p
                  className="settings-note"
                  data-testid="drive-account-label"
                >
                  Connected account: {drive.metadata.connectedAccountLabel}
                </p>
              ) : null}

              {!remoteFileId ? (
                <p className="settings-note">No remote backup found yet.</p>
              ) : null}

              <details className="drive-sync-details">
                <summary>Sync details</summary>
                <p className="settings-note" data-testid="sync-status">
                  Sync state: {sync.phase}
                  {sync.hasPendingChanges ? ' · Changes waiting to publish' : ''}
                  {conflictCount > 0
                    ? ` · ${conflictCount} conflict${
                        conflictCount === 1 ? '' : 's'
                      } to review`
                    : ''}
                  {' · '}New local solves since last sync:{' '}
                  {sync.newSolvesSinceLastSync}
                </p>
                <p className="settings-note">
                  {sync.lastSyncAt
                    ? `Last sync ${new Date(sync.lastSyncAt).toLocaleString()}`
                    : 'No completed sync yet.'}
                </p>
              </details>

              {sync.error ? (
                <p
                  className="settings-error"
                  role="alert"
                  data-testid="sync-error"
                >
                  {sync.error}
                </p>
              ) : null}
              {drive.error ? (
                <p
                  className="settings-error"
                  role="alert"
                  data-testid="drive-error"
                >
                  {drive.error}
                </p>
              ) : null}
              {sync.duplicateNames.length > 0 ? (
                <div
                  className="sync-duplicate-list"
                  data-testid="sync-duplicate-names"
                >
                  <p className="settings-note">
                    Separate sessions share the name
                    {sync.duplicateNames.length === 1 ? ' ' : 's '}
                    {sync.duplicateNames
                      .map((name) => `'${name}'`)
                      .join(', ')}
                    . They stay separate until you approve a merge.
                  </p>
                  <button
                    type="button"
                    className="button button-secondary button-small"
                    data-testid="review-duplicate-sessions"
                    onClick={onReviewDuplicateNames}
                  >
                    Review merge
                  </button>
                </div>
              ) : null}
              {sync.pendingConflicts.length > 0 ? (
                <div className="sync-conflict-list" data-testid="sync-conflicts">
                  <p className="settings-note">
                    Synchronization is paused. Choose which version to keep for
                    each conflicting edit.
                  </p>
                  {(conflictsExpanded
                    ? sync.pendingConflicts
                    : sync.pendingConflicts.slice(0, CONFLICT_PAGE_SIZE)
                  ).map((conflict) => (
                    <div
                      className="sync-conflict-item"
                      key={conflictKey(conflict)}
                      data-testid="sync-conflict"
                    >
                      <div className="sync-conflict-copy">
                        <span className="settings-row-label">
                          {conflictTitle(conflict, sessions)}
                        </span>
                        <span className="settings-row-description">
                          {conflict.field === 'legacyRecovery' ? (
                            <>
                              This deletion predates solve tracking. CubeLab
                              cannot tell whether the older solves in question
                              were already deleted or were offline edits.
                            </>
                          ) : conflict.remoteOnly ? (
                            <>
                              Newest cloud version:{' '}
                              {formatConflictValue(conflict.field, conflict.localValue)}{' '}
                              ·{' '}
                              Other cloud version:{' '}
                              {formatConflictValue(conflict.field, conflict.remoteValue)}
                            </>
                          ) : (
                            <>
                              This device:{' '}
                              {formatConflictValue(conflict.field, conflict.localValue)} ·
                              Cloud: {formatConflictValue(conflict.field, conflict.remoteValue)}
                            </>
                          )}
                        </span>
                      </div>
                      <div className="sync-conflict-actions">
                        <button
                          type="button"
                          className="button button-secondary button-small"
                          onClick={() =>
                            sync.resolveConflict(
                              conflict.id,
                              conflict.field,
                              'local',
                              conflict.kind,
                            )
                          }
                        >
                          {conflict.field === 'legacyRecovery'
                            ? 'Keep deleted'
                            : conflict.remoteOnly
                              ? 'Use newest cloud'
                              : 'Use this device'}
                        </button>
                        <button
                          type="button"
                          className="button button-secondary button-small"
                          onClick={() =>
                            sync.resolveConflict(
                              conflict.id,
                              conflict.field,
                              'remote',
                              conflict.kind,
                            )
                          }
                        >
                          {conflict.field === 'legacyRecovery'
                            ? 'Recover solves'
                            : conflict.remoteOnly
                              ? 'Use other cloud'
                              : 'Use cloud'}
                        </button>
                      </div>
                    </div>
                  ))}
                  {!conflictsExpanded &&
                  sync.pendingConflicts.length > CONFLICT_PAGE_SIZE ? (
                    <p className="settings-note sync-conflict-more">
                      <span>
                        Showing {CONFLICT_PAGE_SIZE} of{' '}
                        {sync.pendingConflicts.length} conflicts. Every
                        conflict is stored and blocks publication; the list is
                        only paginated for display.
                      </span>
                      <button
                        type="button"
                        className="button button-secondary button-small"
                        data-testid="show-all-conflicts"
                        onClick={() => setConflictsExpanded(true)}
                      >
                        Show all {sync.pendingConflicts.length}
                      </button>
                    </p>
                  ) : null}
                </div>
              ) : null}

              {sync.conflictAudit.length > 0 ? (
                <div
                  className="sync-conflict-list"
                  data-testid="sync-audit-history"
                >
                  <p className="settings-note">
                    Manual review history. Undo reverses the stored choice; the
                    next sync applies the other version when it is still present
                    in a cloud snapshot.
                  </p>
                  {(historyExpanded
                    ? sync.conflictAudit
                    : sync.conflictAudit.slice(0, AUDIT_PAGE_SIZE)
                  ).map((entry) => (
                    <div
                      className="sync-conflict-item"
                      key={entry.auditId}
                      data-testid="sync-audit-entry"
                    >
                      <div className="sync-conflict-copy">
                        <span className="settings-row-label">
                          {conflictTitle(entry, sessions)}
                        </span>
                        <span className="settings-row-description">
                          {entry.undoOf ? 'Reversed to ' : 'Chose '}
                          {resolutionLabel(
                            entry.kind,
                            entry.remoteOnly,
                            entry.resolution,
                          )}{' '}
                          · {new Date(entry.resolvedAt).toLocaleString()}
                          {entry.undoneAt ? ' · Reversed' : ''}
                        </span>
                      </div>
                      {entry.undoneAt === undefined &&
                      entry.kind !== 'redirect' &&
                      !(
                        entry.field === 'legacyRecovery' &&
                        entry.resolution === 'remote'
                      ) ? (
                        <div className="sync-conflict-actions">
                          <button
                            type="button"
                            className="button button-secondary button-small"
                            data-testid="undo-conflict-resolution"
                            onClick={() => {
                              const outcome = sync.undoConflictResolution(
                                entry.auditId,
                              )
                              if (!outcome.ok) onNotify(outcome.error)
                            }}
                          >
                            Undo
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ))}
                  {!historyExpanded &&
                  sync.conflictAudit.length > AUDIT_PAGE_SIZE ? (
                    <p className="settings-note sync-conflict-more">
                      <span>
                        Showing {AUDIT_PAGE_SIZE} of{' '}
                        {sync.conflictAudit.length} decisions. The rest stay in
                        local history.
                      </span>
                      <button
                        type="button"
                        className="button button-secondary button-small"
                        data-testid="show-all-audit"
                        onClick={() => setHistoryExpanded(true)}
                      >
                        Show all {sync.conflictAudit.length}
                      </button>
                    </p>
                  ) : null}
                </div>
              ) : null}

              {!drive.configured ? (
                <p className="settings-note">
                  Set <code>VITE_GOOGLE_CLIENT_ID</code> at build time to enable
                  Google Drive.
                </p>
              ) : null}

              <div className="settings-row">
                <div className="settings-row-copy">
                  <span className="settings-row-label">Connection</span>
                  <span className="settings-row-description">
                    Start or end Google Drive access for this browser.
                  </span>
                </div>
                <div className="settings-action-inline">
                  {!drive.connected ? (
                    <button
                      type="button"
                      className="button button-secondary button-small"
                      data-testid="drive-connect"
                      disabled={!drive.configured || busy}
                      onClick={() => void drive.connect()}
                    >
                      Connect Google Drive
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="button button-secondary button-small"
                      data-testid="drive-disconnect"
                      disabled={busy}
                      onClick={handleDisconnect}
                    >
                      Disconnect
                    </button>
                  )}
                </div>
              </div>
            </section>

            <section
              className="settings-section"
              aria-labelledby="drive-sync-title"
            >
              <div className="settings-section-heading">
                <h3 id="drive-sync-title">Automatic synchronization</h3>
              </div>

              <div className="settings-row">
                <div className="settings-row-copy">
                  <span className="settings-row-label">
                    Automatic synchronization
                  </span>
                  <span className="settings-row-description">
                    Keep this browser synchronized through Google Drive.
                  </span>
                </div>
                <input
                  type="checkbox"
                  aria-label="Automatic synchronization"
                  checked={sync.preferences.enabled}
                  onChange={(event) =>
                    sync.updatePreferences({ enabled: event.target.checked })
                  }
                />
              </div>

              <div className="sync-field-row">
                <div className="sync-field-copy">
                  <span className="settings-row-label">Time interval</span>
                  <span className="settings-row-description">
                    How often CubeLab checks for changes.
                  </span>
                </div>
                <Select
                  ariaLabel="Time interval"
                  className="compact-select"
                  testId="sync-interval"
                  value={String(sync.preferences.intervalMinutes)}
                  options={[1, 2, 3, 5, 10, 15, 30, 60].map((value) => ({
                    value: String(value),
                    label: `${value} minute${value === 1 ? '' : 's'}`,
                  }))}
                  onChange={(value) =>
                    sync.updatePreferences({
                      intervalMinutes: Number(value) as never,
                    })
                  }
                />
              </div>

              <div className="sync-field-row">
                <div className="sync-field-copy">
                  <span className="settings-row-label">Solve threshold</span>
                  <span className="settings-row-description">
                    Sync after this many new solves.
                  </span>
                </div>
                <Select
                  ariaLabel="Solve threshold"
                  className="compact-select"
                  testId="sync-threshold"
                  value={String(sync.preferences.solveThreshold)}
                  options={[1, 2, 3, 5, 10, 20, 25, 50, 100].map((value) => ({
                    value: String(value),
                    label: `${value} solve${value === 1 ? '' : 's'}`,
                  }))}
                  onChange={(value) =>
                    sync.updatePreferences({
                      solveThreshold: Number(value) as never,
                    })
                  }
                />
              </div>

              <div className="settings-row">
                <div className="settings-row-copy">
                  <span className="settings-row-label">Sync now</span>
                  <span className="settings-row-description">
                    Merge and synchronize now.
                  </span>
                </div>
                <button
                  type="button"
                  className="button button-primary button-small"
                  data-testid="sync-now"
                  disabled={
                    !sync.preferences.enabled || phase === 'deleting'
                  }
                  onClick={() => void sync.syncNow('manual')}
                >
                  Sync now
                </button>
              </div>
            </section>

            <section
              className="settings-section"
              aria-labelledby="drive-snapshots-title"
            >
              <div className="settings-section-heading">
                <h3 id="drive-snapshots-title">Remote snapshots</h3>
                {drive.connected ? (
                  <span
                    className="settings-storage is-ok"
                    data-testid="remote-snapshot-summary"
                  >
                    <span className="status-dot" aria-hidden="true" />
                    {drive.snapshots?.length ?? 0}{' '}
                    {(drive.snapshots?.length ?? 0) === 1 ? 'file' : 'files'} ·{' '}
                    {formatBytes(snapshotTotalBytes)}
                  </span>
                ) : null}
              </div>

              <p className="settings-note">
                Every synchronization publishes a new immutable snapshot.
                CubeLab keeps the newest snapshots per device so old files do
                not accumulate without a limit.
              </p>

              <div className="settings-row">
                <div className="settings-row-copy">
                  <span className="settings-row-label">Automatic cleanup</span>
                  <span className="settings-row-description">
                    After a successful sync, remove snapshots beyond the limits
                    below. The newest snapshot for every device is always kept.
                  </span>
                </div>
                <input
                  type="checkbox"
                  aria-label="Automatic snapshot cleanup"
                  checked={sync.preferences.snapshotCleanupEnabled}
                  onChange={(event) =>
                    sync.updatePreferences({
                      snapshotCleanupEnabled: event.target.checked,
                    })
                  }
                />
              </div>

              <div className="sync-field-row">
                <div className="sync-field-copy">
                  <span className="settings-row-label">Keep per device</span>
                  <span className="settings-row-description">
                    The newest snapshot for each device is always kept.
                  </span>
                </div>
                <Select
                  ariaLabel="Snapshots kept per device"
                  className="compact-select"
                  testId="snapshot-keep"
                  value={String(sync.preferences.snapshotKeepPerDevice)}
                  options={SNAPSHOT_KEEP_OPTIONS.map((value) => ({
                    value: String(value),
                    label: String(value),
                  }))}
                  onChange={(value) =>
                    sync.updatePreferences({
                      snapshotKeepPerDevice: Number(
                        value,
                      ) as SnapshotKeepPerDevice,
                    })
                  }
                />
              </div>

              <div className="sync-field-row">
                <div className="sync-field-copy">
                  <span className="settings-row-label">Delete older than</span>
                  <span className="settings-row-description">
                    Age is measured from the snapshot's last update.
                  </span>
                </div>
                <Select
                  ariaLabel="Snapshot maximum age"
                  className="compact-select"
                  testId="snapshot-age"
                  value={String(sync.preferences.snapshotMaxAgeDays)}
                  options={SNAPSHOT_MAX_AGE_OPTIONS.map((value) => ({
                    value: String(value),
                    label: `${value} days`,
                  }))}
                  onChange={(value) =>
                    sync.updatePreferences({
                      snapshotMaxAgeDays: Number(
                        value,
                      ) as SnapshotMaxAgeDays,
                    })
                  }
                />
              </div>

              {!drive.connected ? (
                <p className="settings-note">
                  Connect Google Drive to list and manage remote snapshots.
                </p>
              ) : (
                <>
                  <div className="settings-action-inline snapshot-toolbar">
                    <button
                      type="button"
                      className="button button-secondary button-small"
                      data-testid="refresh-remote-snapshots"
                      disabled={drive.snapshotsLoading}
                      onClick={() => void drive.refreshSnapshots()}
                    >
                      Refresh
                    </button>
                    <button
                      type="button"
                      className="button button-secondary button-small"
                      data-testid="cleanup-remote-snapshots"
                      disabled={
                        busy ||
                        drive.snapshotsLoading ||
                        (drive.snapshots?.length ?? 0) === 0
                      }
                      onClick={handleCleanupRequest}
                    >
                      Clean up now
                    </button>
                  </div>

                  {drive.snapshotsLoading && drive.snapshots === null ? (
                    <p className="settings-note">Loading remote snapshots…</p>
                  ) : null}
                  {drive.snapshotsError ? (
                    <p
                      className="settings-error"
                      role="alert"
                      data-testid="remote-snapshot-error"
                    >
                      {drive.snapshotsError}
                    </p>
                  ) : null}
                  {drive.snapshots !== null && drive.snapshots.length === 0 ? (
                    <p
                      className="settings-note"
                      data-testid="remote-snapshot-empty"
                    >
                      No remote snapshots found.
                    </p>
                  ) : null}

                  {snapshotGroups.map((group) => {
                    const expanded = expandedSnapshotGroups.includes(group.key)
                    const visible = expanded
                      ? group.files
                      : group.files.slice(0, SNAPSHOT_PAGE_SIZE)
                    return (
                      <div
                        className="snapshot-group"
                        key={group.key}
                        data-testid="remote-snapshot-group"
                      >
                        <div className="snapshot-group-heading">
                          <span className="settings-row-label">
                            {group.owner.label}
                          </span>
                          <span className="settings-row-description">
                            {group.files.length} snapshot
                            {group.files.length === 1 ? '' : 's'} ·{' '}
                            {formatBytes(totalSnapshotBytes(group.files))}
                          </span>
                        </div>
                        {visible.map((file, index) => (
                          <div
                            className="snapshot-item"
                            key={file.id}
                            data-testid="remote-snapshot"
                          >
                            <div className="snapshot-item-copy">
                              <span className="settings-row-label">
                                {formatSnapshotTime(file)}
                                {index === 0 ? ' · newest' : ''}
                              </span>
                              <span
                                className="settings-row-description snapshot-file-name"
                                title={file.name}
                              >
                                {formatBytes(file.size)} · {file.name}
                              </span>
                            </div>
                            <button
                              type="button"
                              className="button button-danger button-small"
                              data-testid="delete-remote-snapshot"
                              aria-label={`Delete snapshot ${file.name}`}
                              disabled={busy}
                              onClick={() => setSnapshotDeleteTarget(file)}
                            >
                              Delete
                            </button>
                          </div>
                        ))}
                        {group.files.length > SNAPSHOT_PAGE_SIZE ? (
                          <button
                            type="button"
                            className="button button-secondary button-small snapshot-show-all"
                            onClick={() =>
                              setExpandedSnapshotGroups((current) =>
                                expanded
                                  ? current.filter((key) => key !== group.key)
                                  : [...current, group.key],
                              )
                            }
                          >
                            {expanded
                              ? 'Show fewer'
                              : `Show all ${group.files.length}`}
                          </button>
                        ) : null}
                      </div>
                    )
                  })}

                  <p className="settings-note">
                    Manual cleanup removes only this device's superseded
                    snapshots. Other devices clean up their own after a
                    successful sync. Deleting a snapshot removes only its cloud
                    copy; local sessions are not changed.
                  </p>
                </>
              )}
            </section>

            <section
              className="settings-section"
              aria-labelledby="training-drive-title"
              data-testid="training-drive-section"
            >
              <div className="settings-section-heading">
                <h3 id="training-drive-title">Training history backup</h3>
                {trainingDrive.connected ? (
                  <span className="settings-storage is-ok">
                    <span className="status-dot" aria-hidden="true" />
                    {trainingDrive.snapshots.length} file
                    {trainingDrive.snapshots.length === 1 ? '' : 's'}
                  </span>
                ) : null}
              </div>

              <p className="settings-note">
                Manual cloud backup and replace-only restore of Training history.
                This is separate from solve synchronization and is not
                multi-device merge sync. Training files never appear in the solve
                snapshot list, and solve sync never uploads Training.
              </p>

              <div className="settings-row">
                <div className="settings-row-copy">
                  <span className="settings-row-label">Local Training</span>
                  <span
                    className="settings-row-description"
                    data-testid="training-local-summary"
                  >
                    {trainingDrive.localSummary
                      ? trainingSummaryLabel(trainingDrive.localSummary)
                      : 'Training history is unreadable. Restore a valid backup or repair local storage first.'}
                  </span>
                </div>
              </div>

              <div className="settings-row">
                <div className="settings-row-copy">
                  <span className="settings-row-label">
                    Back up Training to Drive
                  </span>
                  <span className="settings-row-description">
                    Uploads a new immutable snapshot. Older snapshots from this
                    device are cleaned up best-effort, keeping the newest five.
                    Requires an idle timer and closed Training history.
                  </span>
                </div>
                <button
                  type="button"
                  className="button button-primary button-small"
                  data-testid="training-backup-upload"
                  disabled={
                    !trainingDrive.canUpload || busy || trainingDrive.busy
                  }
                  onClick={() => void trainingDrive.upload()}
                >
                  {trainingDrive.phase === 'uploading'
                    ? 'Backing up…'
                    : 'Back up Training'}
                </button>
              </div>

              {!trainingDrive.configured ? (
                <p className="settings-note" data-testid="training-drive-unavailable">
                  Training cloud backup is unavailable for this build or Drive
                  transport.
                </p>
              ) : null}
              {trainingDrive.configured && trainingDrive.uploadBlockedReason ? (
                <p
                  className="settings-note"
                  data-testid="training-upload-blocked"
                >
                  {trainingDrive.uploadBlockedReason}
                </p>
              ) : null}
              {trainingDrive.error ? (
                <p
                  className="settings-error"
                  role="alert"
                  data-testid="training-drive-error"
                >
                  {trainingDrive.error}
                </p>
              ) : null}
              {trainingDrive.lastUpload ? (
                <p className="settings-note" data-testid="training-last-upload">
                  Latest remote Training snapshot:{' '}
                  {formatSnapshotTime(trainingDrive.lastUpload)} ·{' '}
                  {formatBytes(trainingDrive.lastUpload.size)}
                </p>
              ) : null}

              {trainingDrive.connected ? (
                <>
                  <div className="settings-action-inline snapshot-toolbar">
                    <button
                      type="button"
                      className="button button-secondary button-small"
                      data-testid="training-refresh-snapshots"
                      disabled={trainingDrive.snapshotsLoading}
                      onClick={() => void trainingDrive.refreshSnapshots()}
                    >
                      Refresh
                    </button>
                  </div>
                  {trainingDrive.snapshotsLoading ? (
                    <p className="settings-note">Loading Training snapshots…</p>
                  ) : null}
                  {!trainingDrive.snapshotsLoading &&
                  trainingDrive.snapshots.length === 0 ? (
                    <p
                      className="settings-note"
                      data-testid="training-remote-empty"
                    >
                      No remote Training snapshots found.
                    </p>
                  ) : null}
                  {trainingDrive.snapshots.map((snapshot, index) => {
                    const summary = trainingDrive.summaryOf(snapshot.backup)
                    return (
                      <div
                        className="snapshot-item"
                        key={snapshot.file.id}
                        data-testid="training-remote-snapshot"
                      >
                        <div className="snapshot-item-copy">
                          <span className="settings-row-label">
                            {formatSnapshotTime(snapshot.file)}
                            {index === 0 ? ' · newest' : ''}
                          </span>
                          <span
                            className="settings-row-description"
                            title={snapshot.file.name}
                          >
                            {formatBytes(snapshot.file.size)} ·{' '}
                            {trainingSummaryLabel(summary)}
                          </span>
                          <span className="settings-row-description snapshot-file-name">
                            {snapshot.file.name}
                          </span>
                        </div>
                        <div className="settings-action-inline">
                          <button
                            type="button"
                            className="button button-secondary button-small"
                            data-testid="training-restore-snapshot"
                            aria-label={`Restore Training snapshot ${snapshot.file.name}`}
                            disabled={
                              trainingDrive.busy || busy || trainingSync.enabled
                            }
                            onClick={() => setTrainingRestoreTarget(snapshot)}
                          >
                            Restore…
                          </button>
                          <button
                            type="button"
                            className="button button-danger button-small"
                            data-testid="training-delete-snapshot"
                            aria-label={`Delete Training snapshot ${snapshot.file.name}`}
                            disabled={trainingDrive.busy || busy}
                            onClick={() => setTrainingDeleteTarget(snapshot)}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    )
                  })}
                  {trainingDrive.invalidSnapshots.length > 0 ? (
                    <div
                      className="settings-error"
                      role="alert"
                      data-testid="training-invalid-snapshots"
                    >
                      <p>
                        {trainingDrive.invalidSnapshots.length} Training
                        snapshot
                        {trainingDrive.invalidSnapshots.length === 1
                          ? ' could'
                          : 's could'}{' '}
                        not be read and will be skipped. Delete the damaged file
                        here or from Google Drive.
                      </p>
                      {trainingDrive.invalidSnapshots.map((snapshot) => (
                        <div
                          className="snapshot-item"
                          key={snapshot.file.id}
                          data-testid="training-invalid-snapshot"
                        >
                          <div className="snapshot-item-copy">
                            <span className="settings-row-label">
                              {formatSnapshotTime(snapshot.file)}
                            </span>
                            <span
                              className="settings-row-description"
                              title={snapshot.file.name}
                            >
                              {formatBytes(snapshot.file.size)} ·{' '}
                              {snapshot.error}
                            </span>
                            <span className="settings-row-description snapshot-file-name">
                              {snapshot.file.name}
                            </span>
                          </div>
                          <button
                            type="button"
                            className="button button-danger button-small"
                            aria-label={`Delete unreadable Training snapshot ${snapshot.file.name}`}
                            disabled={trainingDrive.busy || busy}
                            onClick={() => setTrainingInvalidDeleteTarget(snapshot)}
                          >
                            Delete
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <p className="settings-note">
                    Restore is replace-only. It never resumes an imported
                    Training visit and never changes sessions, settings or solve
                    synchronization state.
                    {trainingSync.enabled
                      ? ' Disable Training Drive sync before using replace-only restore.'
                      : ''}
                  </p>
                </>
              ) : trainingDrive.configured ? (
                <p className="settings-note">
                  Connect Google Drive to list and restore Training backups.
                </p>
              ) : null}
            </section>

            <section
              className="settings-section"
              aria-labelledby="training-sync-title"
              data-testid="training-sync-section"
            >
              <div className="settings-section-heading">
                <h3 id="training-sync-title">Training synchronization</h3>
              </div>

              <p className="settings-note">
                Optional merge-based synchronization for Training history across
                devices. It uses its own Drive files and state and never changes
                solve synchronization. Disabling it stops automatic Training
                network work but keeps local history and remote files.
              </p>

              <div className="settings-row">
                <div className="settings-row-copy">
                  <span className="settings-row-label">Training Drive sync</span>
                  <span className="settings-row-description">
                    {trainingSync.enabled
                      ? 'Enabled. Synchronize only while the timer is idle and Training is closed.'
                      : 'Off. Manual cloud backup above is separate and replace-only.'}
                  </span>
                </div>
                <input
                  type="checkbox"
                  aria-label="Training Drive sync"
                  data-testid="training-sync-enabled"
                  checked={trainingSync.enabled}
                  onChange={(event) =>
                    trainingSync.updatePreferences({
                      enabled: event.target.checked,
                    })
                  }
                />
              </div>

              {trainingSync.storageWarning ? (
                <p
                  className="settings-error"
                  role="alert"
                  data-testid="training-sync-storage-warning"
                >
                  {trainingSync.storageWarning}
                </p>
              ) : null}

              {trainingSync.snapshotsError ? (
                <p
                  className="settings-note"
                  role="status"
                  data-testid="training-sync-snapshots-warning"
                >
                  {trainingSync.snapshotsError}
                </p>
              ) : null}

              {trainingSync.enabled ? (
                <>
                  <div className="settings-row">
                    <div className="settings-row-copy">
                      <span className="settings-row-label">Status</span>
                      <span
                        className="settings-row-description"
                        data-testid="training-sync-status"
                      >
                        {trainingSync.status}
                        {trainingSync.lastSyncAt
                          ? ` · last sync ${new Date(
                              trainingSync.lastSyncAt,
                            ).toLocaleString()}`
                          : ' · no completed sync yet'}
                        {trainingSync.pendingConflicts.length > 0
                          ? ` · ${trainingSync.pendingConflicts.length} conflict${
                              trainingSync.pendingConflicts.length === 1 ? '' : 's'
                            } to review`
                          : ''}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="button button-primary button-small"
                      data-testid="training-sync-now"
                      disabled={
                        trainingSync.status === 'syncing' || busy
                      }
                      onClick={() => void trainingSync.syncNow('manual')}
                    >
                      Sync Training now
                    </button>
                  </div>

                  {trainingSync.error ? (
                    <p
                      className="settings-error"
                      role="alert"
                      data-testid="training-sync-error"
                    >
                      {trainingSync.error}
                    </p>
                  ) : null}

                  <div className="settings-row">
                    <div className="settings-row-copy">
                      <span className="settings-row-label">
                        Sync on startup
                      </span>
                      <span className="settings-row-description">
                        Runs after the timer and Training are idle.
                      </span>
                    </div>
                    <input
                      type="checkbox"
                      aria-label="Training sync on startup"
                      checked={trainingSync.preferences.syncOnStartup}
                      onChange={(event) =>
                        trainingSync.updatePreferences({
                          syncOnStartup: event.target.checked,
                        })
                      }
                    />
                  </div>

                  <div className="settings-row">
                    <div className="settings-row-copy">
                      <span className="settings-row-label">
                        Manual Training conflict review
                      </span>
                      <span className="settings-row-description">
                        Pause Training publication and adoption until each
                        conflicting record is approved exactly. Independent from
                        solve conflict review.
                      </span>
                    </div>
                    <input
                      type="checkbox"
                      aria-label="Manual Training conflict review"
                      data-testid="training-sync-manual-conflicts"
                      checked={trainingSync.preferences.manualConflictReview}
                      onChange={(event) =>
                        trainingSync.updatePreferences({
                          manualConflictReview: event.target.checked,
                        })
                      }
                    />
                  </div>

                  <div className="settings-row">
                    <div className="settings-row-copy">
                      <span className="settings-row-label">
                        Training snapshot cleanup
                      </span>
                      <span className="settings-row-description">
                        Keep the newest Training snapshot for every device and
                        prune older Training files only. Solve files are never
                        selected.
                      </span>
                    </div>
                    <input
                      type="checkbox"
                      aria-label="Training snapshot cleanup"
                      checked={trainingSync.preferences.snapshotCleanupEnabled}
                      onChange={(event) =>
                        trainingSync.updatePreferences({
                          snapshotCleanupEnabled: event.target.checked,
                        })
                      }
                    />
                  </div>

                  {trainingSync.pendingConflicts.length > 0 ? (
                    <div
                      className="sync-conflict-list"
                      data-testid="training-sync-conflicts"
                    >
                      <p className="settings-note">
                        Training synchronization is paused. Choose which exact
                        version to keep for each conflicting Training record.
                      </p>
                      {trainingSync.pendingConflicts.map((conflict) => (
                        <div
                          className="sync-conflict-item"
                          key={`${conflict.kind}:${conflict.id}:${conflict.field}`}
                          data-testid="training-sync-conflict"
                        >
                          <div className="sync-conflict-copy">
                            <span className="settings-row-label">
                              {conflict.kind} · {conflict.field} ·{' '}
                              {conflict.id.slice(0, 12)}
                            </span>
                            <span className="settings-row-description">
                              This device:{' '}
                              {formatTrainingSyncValue(conflict.localValue)} · Cloud:{' '}
                              {formatTrainingSyncValue(conflict.remoteValue)} ·{' '}
                              {new Date(
                                conflict.localUpdatedAt,
                              ).toLocaleString()}{' '}
                              /{' '}
                              {new Date(
                                conflict.remoteUpdatedAt,
                              ).toLocaleString()}
                            </span>
                          </div>
                          <div className="sync-conflict-actions">
                            <button
                              type="button"
                              className="button button-secondary button-small"
                              onClick={() => {
                                const outcome = trainingSync.resolveConflict(
                                  conflict.id,
                                  conflict.field,
                                  conflict.kind,
                                  'local',
                                )
                                if (!outcome.ok) onNotify(outcome.error)
                              }}
                            >
                              Use this device
                            </button>
                            <button
                              type="button"
                              className="button button-secondary button-small"
                              onClick={() => {
                                const outcome = trainingSync.resolveConflict(
                                  conflict.id,
                                  conflict.field,
                                  conflict.kind,
                                  'remote',
                                )
                                if (!outcome.ok) onNotify(outcome.error)
                              }}
                            >
                              Use cloud
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  <p className="settings-note">
                    Training merge is deterministic but not a consensus protocol.
                    Clearing local site data removes this device's Training sync
                    record but does not delete remote Training files.
                  </p>
                </>
              ) : null}
            </section>

            <section
              className="settings-section sync-advanced-section"
              aria-labelledby="drive-advanced-title"
            >
              <button
                type="button"
                className="settings-advanced-header"
                aria-expanded={advancedOpen}
                aria-controls="drive-advanced-body"
                onClick={() => setAdvancedOpen((value) => !value)}
              >
                <span>Advanced settings</span>
                <span aria-hidden="true">{advancedOpen ? '▾' : '▸'}</span>
              </button>

              {advancedOpen ? (
                <div
                  id="drive-advanced-body"
                  className="settings-section-body"
                >
                  <div className="settings-row">
                    <div className="settings-row-copy">
                      <span className="settings-row-label">
                        Sync on startup
                      </span>
                    </div>
                    <input
                      type="checkbox"
                      aria-label="Sync on startup"
                      checked={sync.preferences.syncOnStartup}
                      onChange={(event) =>
                        sync.updatePreferences({
                          syncOnStartup: event.target.checked,
                        })
                      }
                    />
                  </div>
                  <div className="settings-row">
                    <div className="settings-row-copy">
                      <span className="settings-row-label">Sync on exit</span>
                    </div>
                    <input
                      type="checkbox"
                      aria-label="Sync on exit"
                      checked={sync.preferences.syncOnExit}
                      onChange={(event) =>
                        sync.updatePreferences({ syncOnExit: event.target.checked })
                      }
                    />
                  </div>
                  <div className="settings-row">
                    <div className="settings-row-copy">
                      <span className="settings-row-label">
                        Sync after reconnect
                      </span>
                      <span className="settings-row-description">
                        Merge changes when this browser comes back online.
                      </span>
                    </div>
                    <input
                      type="checkbox"
                      aria-label="Sync after reconnect"
                      checked={sync.preferences.syncOnReconnect}
                      onChange={(event) =>
                        sync.updatePreferences({
                          syncOnReconnect: event.target.checked,
                        })
                      }
                    />
                  </div>
                  <p className="settings-note">
                    Every automatic write adds a new immutable snapshot with a
                    unique name instead of replacing a device's previous file,
                    so simultaneous writers — including two browsers sharing one
                    device ID — cannot overwrite each other's data. Superseded
                    snapshots are pruned by the retention policy above; the
                    newest snapshot for each device is kept. The legacy mutable
                    cubelab-backup.json file is replaced only through a Google
                    Drive v2 ETag/If-Match check, and CubeLab refuses the write
                    when Drive cannot verify the ETag. This is a conditional
                    update for one file, not a transaction across files.
                  </p>
                  <div className="settings-row">
                    <div className="settings-row-copy">
                      <span className="settings-row-label">
                        Repair sync state
                      </span>
                      <span className="settings-row-description">
                        Re-read every cloud snapshot on the next sync. Sessions,
                        deletions, merge approvals, pending conflicts, and review
                        history are kept.
                      </span>
                    </div>
                    <button
                      type="button"
                      className="button button-secondary button-small"
                      data-testid="repair-sync-state"
                      onClick={() => {
                        sync.repairSyncState()
                        onNotify(
                          'Sync state repaired. CubeLab will re-read every cloud snapshot.',
                        )
                      }}
                    >
                      Repair
                    </button>
                  </div>
                  <div className="settings-row">
                    <div className="settings-row-copy">
                      <span className="settings-row-label">
                        Manual conflict review
                      </span>
                      <span className="settings-row-description">
                        Pause synchronization when same-field conflicts require review. No automatic cloud upload.
                      </span>
                    </div>
                    <input
                      type="checkbox"
                      aria-label="Manual conflict review"
                      checked={sync.preferences.manualConflictReview}
                      onChange={(event) =>
                        sync.updatePreferences({
                          manualConflictReview: event.target.checked,
                        })
                      }
                    />
                  </div>
                  <div className="settings-row settings-row-stacked">
                    <div className="settings-row-copy">
                      <span className="settings-row-label">
                        Delete remote backups
                      </span>
                      <span className="settings-row-description">
                        Remove every CubeLab sync snapshot from Google Drive,
                        including the legacy cubelab-backup.json file. Local data
                        is not changed. Future automatic sync may recreate this
                        device's snapshot.
                      </span>
                    </div>
                    <button
                      type="button"
                      className="button button-danger button-small"
                      data-testid="drive-delete-remote"
                      disabled={!drive.configured || busy}
                      onClick={() => setDeleteConfirmOpen(true)}
                    >
                      Delete remote backup
                    </button>
                  </div>
                </div>
              ) : null}
            </section>
          </div>

          <footer className="settings-footer">
            <span className="settings-footer-note">
              Sync uses app data only.
            </span>
            <button
              type="button"
              className="button button-secondary"
              data-testid="drive-done"
              onClick={onClose}
            >
              Done
            </button>
          </footer>
        </div>
      </dialog>

      <ConfirmDialog
        open={deleteConfirmOpen}
        eyebrow="Delete remote backups"
        title="Delete all Google Drive backups?"
        description="This removes every CubeLab snapshot, including cubelab-backup.json, from Google Drive app data. Local sessions and settings are not changed."
        cancelLabel="Keep backups"
        confirmLabel="Delete backups"
        onCancel={() => setDeleteConfirmOpen(false)}
        onConfirm={() => {
          setDeleteConfirmOpen(false)
          void drive.deleteRemoteBackup()
        }}
      />

      <ConfirmDialog
        open={snapshotDeleteTarget !== null}
        eyebrow="Delete remote snapshot"
        title="Delete this cloud snapshot?"
        description={
          snapshotDeleteTarget
            ? `${
                snapshotDeleteOwner?.own ? 'This device' : 'Another device'
              } snapshot from ${formatSnapshotTime(
                snapshotDeleteTarget,
              )} will be removed from Google Drive. Local sessions are not changed.${
                snapshotDeleteOwner?.own
                  ? ' Deleting this browser’s newest snapshot is safe only if another copy exists or the data is also stored locally.'
                  : ''
              }`
            : ''
        }
        cancelLabel="Keep snapshot"
        confirmLabel="Delete snapshot"
        onCancel={() => setSnapshotDeleteTarget(null)}
        onConfirm={() => {
          const target = snapshotDeleteTarget
          setSnapshotDeleteTarget(null)
          if (target) void drive.deleteSnapshot(target.id)
        }}
      />

      <ConfirmDialog
        open={cleanupConfirmOpen}
        eyebrow="Clean up snapshots"
        title="Remove superseded snapshots?"
        description={`This removes ${cleanupCount} of this device’s older snapshots from Google Drive. The newest snapshot for every device is kept. Local sessions and settings are not changed.`}
        cancelLabel="Keep snapshots"
        confirmLabel="Clean up"
        onCancel={() => setCleanupConfirmOpen(false)}
        onConfirm={() => {
          setCleanupConfirmOpen(false)
          void drive.cleanupSnapshots({
            keepPerDevice: sync.preferences.snapshotKeepPerDevice,
            maxAgeDays: sync.preferences.snapshotMaxAgeDays,
          })
        }}
      />

      <ConfirmDialog
        open={trainingRestoreTarget !== null}
        eyebrow="Restore Training backup"
        title="Replace local Training history?"
        description={
          trainingRestoreTarget
            ? `Local Training history will be replaced with the checked snapshot from ${formatSnapshotTime(
                trainingRestoreTarget.file,
              )}. Sessions, settings, solve synchronization state and Google Drive solve snapshots are not changed. No imported Training visit will be resumed.`
            : ''
        }
        details={
          trainingRestoreTarget ? (
            <dl className="confirm-summary">
              <div>
                <dt>Backup</dt>
                <dd>
                  {trainingSummaryLabel(
                    trainingDrive.summaryOf(trainingRestoreTarget.backup),
                  )}
                </dd>
              </div>
              <div>
                <dt>This device</dt>
                <dd>
                  {trainingDrive.localSummary
                    ? trainingSummaryLabel(trainingDrive.localSummary)
                    : 'unreadable'}
                </dd>
              </div>
            </dl>
          ) : null
        }
        cancelLabel="Cancel restore"
        confirmLabel="Replace Training"
        requireText="RESTORE TRAINING"
        onCancel={() => setTrainingRestoreTarget(null)}
        onConfirm={() => {
          const target = trainingRestoreTarget
          setTrainingRestoreTarget(null)
          if (target) void trainingDrive.restore(target)
        }}
      />

      <ConfirmDialog
        open={trainingDeleteTarget !== null}
        eyebrow="Delete Training snapshot"
        title="Delete this cloud Training snapshot?"
        description={
          trainingDeleteTarget
            ? `The Training snapshot from ${formatSnapshotTime(
                trainingDeleteTarget.file,
              )} will be removed from Google Drive. Local Training history is not changed. Solve snapshots are never selected by this action.`
            : ''
        }
        cancelLabel="Keep snapshot"
        confirmLabel="Delete snapshot"
        onCancel={() => setTrainingDeleteTarget(null)}
        onConfirm={() => {
          const target = trainingDeleteTarget
          setTrainingDeleteTarget(null)
          if (target) void trainingDrive.deleteSnapshot(target.file.id)
        }}
      />

      <ConfirmDialog
        open={trainingInvalidDeleteTarget !== null}
        eyebrow="Delete unreadable Training snapshot"
        title="Delete this unreadable cloud Training snapshot?"
        description={
          trainingInvalidDeleteTarget
            ? `${trainingInvalidDeleteTarget.file.name} could not be validated and is being skipped. It will be removed from Google Drive. Local Training history is not changed.`
            : ''
        }
        cancelLabel="Keep file"
        confirmLabel="Delete file"
        onCancel={() => setTrainingInvalidDeleteTarget(null)}
        onConfirm={() => {
          const target = trainingInvalidDeleteTarget
          setTrainingInvalidDeleteTarget(null)
          if (target) void trainingDrive.deleteSnapshot(target.file.id)
        }}
      />
    </>
  )
}