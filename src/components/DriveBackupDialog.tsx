import { useState } from 'react'
import { useModalDialog } from '../hooks/useModalDialog'
import { useDriveBackup } from '../hooks/useDriveBackup'
import type { Backup } from '../lib/backup'
import { ConfirmDialog } from './ConfirmDialog'
import type { DriveTransport } from '../lib/driveTransport'
import type { UseSyncResult } from '../hooks/useSync'
import { CloseIcon } from './Icons'
import type { SessionsData, Settings } from '../types'

interface DriveBackupDialogProps {
  open: boolean
  transport: DriveTransport | null
  sessions: SessionsData
  settings: Settings
  storageOk: boolean
  sync: UseSyncResult
  onClose: () => void
  onNotify: (message: string) => void
  onPendingRestore: (backup: Backup) => void
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
  const drive = useDriveBackup({
    transport,
    sessions,
    settings,
    storageOk,
    onPendingRestore,
    onNotify,
  })

  if (!open) return null

  const phase = drive.phase
  const busy =
    phase === 'connecting' ||
    phase === 'backing-up' ||
    phase === 'restoring' ||
    phase === 'deleting'

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
            Manually back up or restore this browser’s sessions and settings using
            Google Drive app data. Backup never runs automatically.
          </p>

          <div className="settings-body">
            <section className="settings-section" aria-labelledby="drive-status-title">
              <div className="settings-section-heading">
                <h3 id="drive-status-title">Status</h3>
              </div>
              <div className="settings-row">
                <div className="settings-row-copy">
                  <span className="settings-row-label">Google Drive</span>
                  <span className="settings-row-description" data-testid="drive-status">
                    {!drive.configured
                      ? 'Not configured for this build.'
                      : phase === 'connecting'
                        ? 'Connecting…'
                        : phase === 'connected'
                          ? 'Connected.'
                          : phase === 'backing-up'
                            ? 'Backing up…'
                            : phase === 'restoring'
                              ? 'Restoring…'
                              : phase === 'deleting'
                                ? 'Deleting remote backup…'
                                : phase === 'error'
                                  ? 'Error.'
                                  : 'Disconnected.'}
                  </span>
                </div>
                <span className={`settings-storage ${drive.connected ? 'is-ok' : 'is-error'}`}>
                  <span className="status-dot" aria-hidden="true" />
                  {drive.connected ? 'Connected' : 'Offline'}
                </span>
              </div>
              {drive.metadata.connectedAccountLabel ? (
                <p className="settings-note" data-testid="drive-account-label">
                  Connected account: {drive.metadata.connectedAccountLabel}
                </p>
              ) : null}
              {drive.metadata.lastBackupAt ? (
                <p className="settings-note">
                  Last successful backup:{' '}
                  {new Date(drive.metadata.lastBackupAt).toLocaleString()}
                </p>
              ) : null}
              {drive.metadata.lastRestoreAt ? (
                <p className="settings-note">
                  Last restore: {new Date(drive.metadata.lastRestoreAt).toLocaleString()}
                </p>
              ) : null}
              {drive.metadata.remoteFileId ? (
                <p className="settings-note">
                  Remote file: {drive.metadata.remoteFileId}
                  {drive.metadata.remoteModifiedTime
                    ? ` (updated ${new Date(drive.metadata.remoteModifiedTime).toLocaleString()})`
                    : ''}
                </p>
              ) : (
                <p className="settings-note">No remote backup found yet.</p>
              )}
              {drive.error ? (
                <p className="settings-error" role="alert" data-testid="drive-error">
                  {drive.error}
                </p>
              ) : null}
            </section>

            <section className="settings-section" aria-labelledby="drive-actions-title">
              <div className="settings-section-heading">
                <h3 id="drive-actions-title">Actions</h3>
              </div>
              <div className="settings-row">
                <div className="settings-row-copy">
                  <span className="settings-row-label">Connect</span>
                  <span className="settings-row-description">
                    Request Google Drive app-data access for this browser session.
                  </span>
                </div>
                <button
                  type="button"
                  className="button button-secondary button-small"
                  data-testid="drive-connect"
                  disabled={!drive.configured || busy}
                  onClick={() => void drive.connect()}
                >
                  Connect Google Drive
                </button>
              </div>
              <div className="settings-row">
                <div className="settings-row-copy">
                  <span className="settings-row-label">Backup now</span>
                  <span className="settings-row-description">
                    Upload {drive.countBackup.sessions} session
                    {drive.countBackup.sessions === 1 ? '' : 's'} and{' '}
                    {drive.countBackup.solves} solve
                    {drive.countBackup.solves === 1 ? '' : 's'}.
                  </span>
                </div>
                <button
                  type="button"
                  className="button button-primary button-small"
                  data-testid="drive-backup-now"
                  disabled={!drive.configured || busy}
                  onClick={() => void drive.backupNow()}
                >
                  Backup now
                </button>
              </div>
              <div className="settings-row">
                <div className="settings-row-copy">
                  <span className="settings-row-label">Restore from Drive</span>
                  <span className="settings-row-description">
                    Replace local data after a confirmation preview.
                  </span>
                </div>
                <button
                  type="button"
                  className="button button-secondary button-small"
                  data-testid="drive-restore"
                  disabled={!drive.configured || busy || !drive.metadata.remoteFileId}
                  onClick={() => void drive.restoreFromDrive()}
                >
                  Restore from Drive
                </button>
              </div>
              <div className="settings-row">
                <div className="settings-row-copy">
                  <span className="settings-row-label">Disconnect</span>
                  <span className="settings-row-description">
                    Clear this browser’s Drive access token.
                  </span>
                </div>
                <button
                  type="button"
                  className="button button-secondary button-small"
                  data-testid="drive-disconnect"
                  disabled={!drive.connected || busy}
                  onClick={drive.disconnect}
                >
                  Disconnect
                </button>
              </div>
              <div className="settings-row">
                <div className="settings-row-copy">
                  <span className="settings-row-label">Delete remote backup</span>
                  <span className="settings-row-description">
                    Remove the remote app-data file.
                  </span>
                </div>
                <button
                  type="button"
                  className="button button-danger button-small"
                  data-testid="drive-delete-remote"
                  disabled={!drive.configured || busy || !drive.metadata.remoteFileId}
                  onClick={() => setDeleteConfirmOpen(true)}
                >
                  Delete remote backup
                </button>
              </div>
              {!drive.configured ? (
                <p className="settings-note">
                  Set <code>VITE_GOOGLE_CLIENT_ID</code> at build time to enable
                  Google Drive backup.
                </p>
              ) : (
                <p className="settings-note">
                  Google Drive backup is manual only. The remote file is stored in
                  app data as <code>cubelab-backup.json</code>.
                </p>
              )}
            </section>

            <section className="settings-section" aria-labelledby="drive-sync-title">
              <div className="settings-section-heading">
                <h3 id="drive-sync-title">Synchronization</h3>
              </div>
              <div className="settings-row">
                <div className="settings-row-copy">
                  <span className="settings-row-label">Automatic synchronization</span>
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
              <div className="settings-row">
                <div className="settings-row-copy">
                  <span className="settings-row-label">Mode</span>
                  <span className="settings-row-description">
                    Time-based, solve-count, or combined.
                  </span>
                </div>
                <select
                  aria-label="Synchronization mode"
                  value={sync.preferences.mode}
                  onChange={(event) =>
                    sync.updatePreferences({ mode: event.target.value as 'time' | 'solve' | 'combined' })
                  }
                >
                  <option value="time">Time-based</option>
                  <option value="solve">Solve-count</option>
                  <option value="combined">Combined</option>
                </select>
              </div>
              <div className="settings-row">
                <div className="settings-row-copy">
                  <span className="settings-row-label">Time interval</span>
                  <span className="settings-row-description">Minutes between checks.</span>
                </div>
                <select
                  aria-label="Time interval"
                  value={sync.preferences.intervalMinutes}
                  onChange={(event) =>
                    sync.updatePreferences({ intervalMinutes: Number(event.target.value) as never })
                  }
                >
                  {[1, 2, 3, 5, 10, 15, 30, 60].map((value) => (
                    <option key={value} value={value}>{value} minute{value === 1 ? '' : 's'}</option>
                  ))}
                </select>
              </div>
              <div className="settings-row">
                <div className="settings-row-copy">
                  <span className="settings-row-label">Solve threshold</span>
                  <span className="settings-row-description">New solves before sync.</span>
                </div>
                <select
                  aria-label="Solve threshold"
                  value={sync.preferences.solveThreshold}
                  onChange={(event) =>
                    sync.updatePreferences({ solveThreshold: Number(event.target.value) as never })
                  }
                >
                  {[1, 2, 3, 5, 10, 20, 25, 50, 100].map((value) => (
                    <option key={value} value={value}>{value} solve{value === 1 ? '' : 's'}</option>
                  ))}
                </select>
              </div>
              <div className="settings-row">
                <div className="settings-row-copy">
                  <span className="settings-row-label">Sync on startup</span>
                </div>
                <input
                  type="checkbox"
                  aria-label="Sync on startup"
                  checked={sync.preferences.syncOnStartup}
                  onChange={(event) =>
                    sync.updatePreferences({ syncOnStartup: event.target.checked })
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
                  <span className="settings-row-label">Sync after reconnect</span>
                </div>
                <input
                  type="checkbox"
                  aria-label="Sync after reconnect"
                  checked={sync.preferences.syncOnReconnect}
                  onChange={(event) =>
                    sync.updatePreferences({ syncOnReconnect: event.target.checked })
                  }
                />
              </div>
              <div className="settings-row">
                <div className="settings-row-copy">
                  <span className="settings-row-label">Manual conflict review</span>
                  <span className="settings-row-description">
                    Ask before applying same-field conflicts. Default resolves automatically.
                  </span>
                </div>
                <input
                  type="checkbox"
                  aria-label="Manual conflict review"
                  checked={sync.preferences.manualConflictReview}
                  onChange={(event) =>
                    sync.updatePreferences({ manualConflictReview: event.target.checked })
                  }
                />
              </div>
              <div className="settings-row">
                <div className="settings-row-copy">
                  <span className="settings-row-label">Status</span>
                  <span className="settings-row-description" data-testid="sync-status">
                    {sync.phase}
                  </span>
                </div>
                <span className="settings-note">
                  Pending: {sync.pendingCount}
                  {sync.lastSyncAt ? ` · Last sync ${new Date(sync.lastSyncAt).toLocaleString()}` : ''}
                </span>
              </div>
              {sync.error ? (
                <p className="settings-error" role="alert" data-testid="sync-error">
                  {sync.error}
                </p>
              ) : null}
              {sync.conflictsCount > 0 ? (
                <p className="settings-note" data-testid="sync-conflicts">
                  {sync.conflictsCount} conflict{sync.conflictsCount === 1 ? '' : 's'} need review.
                </p>
              ) : null}
              <div className="settings-row">
                <div className="settings-row-copy">
                  <span className="settings-row-label">Sync now</span>
                  <span className="settings-row-description">
                    Push local changes and merge cloud changes immediately.
                  </span>
                </div>
                <button
                  type="button"
                  className="button button-primary button-small"
                  data-testid="sync-now"
                  disabled={!sync.preferences.enabled || phase === 'backing-up' || phase === 'restoring'}
                  onClick={() => void sync.syncNow('manual')}
                >
                  Sync now
                </button>
              </div>
            </section>

          </div>

          <footer className="settings-footer">
            <span className="settings-footer-note">
              Backups stay in your Google Drive app data.
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
