import { useState } from 'react'
import { useModalDialog } from '../hooks/useModalDialog'
import { useDriveBackup } from '../hooks/useDriveBackup'
import { ConfirmDialog } from './ConfirmDialog'
import type { DriveTransport } from '../lib/driveTransport'
import type { UseSyncResult } from '../hooks/useSync'
import { CloseIcon } from './Icons'
import type { SessionsData, Settings } from '../types'
import { loadDriveBackupState } from '../lib/driveStorage'
import type { SyncConflict } from '../lib/syncStorage'

function conflictFieldLabel(field: string): string {
  if (field === 'rawMs') return 'time'
  if (field === 'penalty') return 'penalty'
  if (field === 'scramble') return 'scramble'
  if (field === 'comment') return 'comment'
  return field
}

function formatConflictValue(field: string, value: unknown): string {
  if (value === undefined) return 'not set'
  if (value === null) return 'null'
  const text = String(value)
  if (field === 'rawMs' && typeof value === 'number') return `${value} ms`
  if (text.length === 0) return '(empty)'
  return text.length > 80 ? `${text.slice(0, 77)}…` : text
}

function conflictKey(conflict: SyncConflict): string {
  return `${conflict.kind}:${conflict.id}:${conflict.field}`
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
}: DriveBackupDialogProps) {
  const { dialogRef, handleKeyDown } = useModalDialog(open)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const drive = useDriveBackup({
    transport,
    sessions,
    settings,
    storageOk,
    onPendingRestore,
    onNotify,
    onConnected: () => sync.updatePreferences({ enabled: true }),
  })

  if (!open) return null

  const phase = drive.phase
  const busy =
    phase === 'connecting' ||
    phase === 'backing-up' ||
    phase === 'restoring' ||
    phase === 'deleting'
  const persistedDriveState = loadDriveBackupState()
  const remoteFileId =
    persistedDriveState.remoteFileId ?? drive.metadata.remoteFileId

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
              <span className="eyebrow">Data</span>
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
                    {!drive.configured
                      ? 'Not configured for this build.'
                      : phase === 'connecting'
                        ? 'Connecting…'
                        : phase === 'connected'
                          ? 'Connected'
                          : phase === 'backing-up'
                            ? 'Backing up…'
                            : phase === 'restoring'
                              ? 'Restoring…'
                              : phase === 'deleting'
                                ? 'Deleting remote backup…'
                                : phase === 'error'
                                  ? 'Error'
                                  : 'Disconnected'}
                  </span>
                </div>
                <span
                  className={`settings-storage ${drive.connected ? 'is-ok' : 'is-error'}`}
                >
                  <span className="status-dot" aria-hidden="true" />
                  {drive.connected ? 'Online' : 'Offline'}
                </span>
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

              <p className="settings-note" data-testid="sync-status">
                Status: {sync.phase} · New local solves since last sync: {sync.newSolvesSinceLastSync}
                {sync.lastSyncAt
                  ? ` · Last sync ${new Date(sync.lastSyncAt).toLocaleString()}`
                  : ''}
              </p>

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
              {sync.pendingConflicts.length > 0 ? (
                <div className="sync-conflict-list" data-testid="sync-conflicts">
                  <p className="settings-note">
                    Synchronization is paused. Choose which version to keep for
                    each conflicting edit.
                  </p>
                  {sync.pendingConflicts.map((conflict) => (
                    <div
                      className="sync-conflict-item"
                      key={conflictKey(conflict)}
                      data-testid="sync-conflict"
                    >
                      <div className="sync-conflict-copy">
                        <span className="settings-row-label">
                          Solve {conflict.id.slice(0, 8)} ·{' '}
                          {conflictFieldLabel(conflict.field)}
                        </span>
                        <span className="settings-row-description">
                          This device: {formatConflictValue(conflict.field, conflict.localValue)} ·
                          Cloud: {formatConflictValue(conflict.field, conflict.remoteValue)}
                        </span>
                      </div>
                      <div className="sync-conflict-actions">
                        <button
                          type="button"
                          className="button button-secondary button-small"
                          onClick={() =>
                            sync.resolveConflict(conflict.id, conflict.field, 'local')
                          }
                        >
                          Use this device
                        </button>
                        <button
                          type="button"
                          className="button button-secondary button-small"
                          onClick={() =>
                            sync.resolveConflict(conflict.id, conflict.field, 'remote')
                          }
                        >
                          Use cloud
                        </button>
                      </div>
                    </div>
                  ))}
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
                      onClick={drive.disconnect}
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
                <select
                  aria-label="Time interval"
                  className="compact-select"
                  value={sync.preferences.intervalMinutes}
                  onChange={(event) =>
                    sync.updatePreferences({
                      intervalMinutes: Number(event.target.value) as never,
                    })
                  }
                >
                  {[1, 2, 3, 5, 10, 15, 30, 60].map((value) => (
                    <option key={value} value={value}>
                      {value} minute{value === 1 ? '' : 's'}
                    </option>
                  ))}
                </select>
              </div>

              <div className="sync-field-row">
                <div className="sync-field-copy">
                  <span className="settings-row-label">Solve threshold</span>
                  <span className="settings-row-description">
                    Sync after this many new solves.
                  </span>
                </div>
                <select
                  aria-label="Solve threshold"
                  className="compact-select"
                  value={sync.preferences.solveThreshold}
                  onChange={(event) =>
                    sync.updatePreferences({
                      solveThreshold: Number(event.target.value) as never,
                    })
                  }
                >
                  {[1, 2, 3, 5, 10, 20, 25, 50, 100].map((value) => (
                    <option key={value} value={value}>
                      {value} solve{value === 1 ? '' : 's'}
                    </option>
                  ))}
                </select>
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
                    Google Drive does not provide verified atomic compare-and-swap
                    here. Avoid syncing two devices at the same moment; a
                    simultaneous upload can still overwrite the other device.
                  </p>
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
                        Delete remote backup
                      </span>
                      <span className="settings-row-description">
                        Remove cubelab-backup.json from Google Drive. Local data
                        is not changed. Future automatic sync may recreate the
                        remote file.
                      </span>
                    </div>
                    <button
                      type="button"
                      className="button button-danger button-small"
                      data-testid="drive-delete-remote"
                      disabled={
                        !remoteFileId ||
                        drive.configured === false ||
                        busy ||
                        !remoteFileId
                      }
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
        eyebrow="Delete remote backup"
        title="Delete the Google Drive backup?"
        description="This removes cubelab-backup.json from Google Drive app data. Local sessions and settings are not changed."
        cancelLabel="Keep backup"
        confirmLabel="Delete backup"
        onCancel={() => setDeleteConfirmOpen(false)}
        onConfirm={() => {
          setDeleteConfirmOpen(false)
          void drive.deleteRemoteBackup()
        }}
      />
    </>
  )
}