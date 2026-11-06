import { useEffect, useMemo, useRef, useState } from 'react'
import { useModalDialog } from '../hooks/useModalDialog'
import { useDriveBackup } from '../hooks/useDriveBackup'
import { ConfirmDialog } from './ConfirmDialog'
import type { DriveFile, DriveTransport } from '../lib/driveTransport'
import type { UseSyncResult } from '../hooks/useSync'
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
  statTargetsMs: 'statistics targets',
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
  if (value === undefined) return 'not set'
  if (value === null) return 'null'
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
                    {drive.snapshots?.length ?? 0} files ·{' '}
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
    </>
  )
}