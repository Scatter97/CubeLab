import { useModalDialog } from '../hooks/useModalDialog'
import { formatSolveCount } from '../lib/format'
import { ChevronRightIcon, CloseIcon } from './Icons'

interface SettingsDialogProps {
  open: boolean
  inspectionEnabled: boolean
  storageOk: boolean
  sessionCount: number
  solveCount: number
  onInspectionChange: (enabled: boolean) => void
  onOpenBackup: () => void
  onClose: () => void
}

export function SettingsDialog({
  open,
  inspectionEnabled,
  storageOk,
  sessionCount,
  solveCount,
  onInspectionChange,
  onOpenBackup,
  onClose,
}: SettingsDialogProps) {
  const { dialogRef, handleKeyDown } = useModalDialog(open)

  return (
    <dialog
      ref={dialogRef}
      className="confirm-dialog settings-dialog"
      aria-labelledby="settings-title"
      aria-describedby="settings-description"
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
            <span className="eyebrow">Preferences</span>
            <h2 id="settings-title">Settings</h2>
          </div>
          <button
            type="button"
            className="icon-button settings-close"
            aria-label="Close settings"
            title="Close settings"
            onClick={onClose}
          >
            <CloseIcon size={16} />
          </button>
        </header>

        <p id="settings-description" className="settings-intro">
          Timer preferences and local data. Changes save automatically in this
          browser.
        </p>

        <div className="settings-body">
          <section
            className="settings-section"
            aria-labelledby="settings-timer-title"
          >
            <div className="settings-section-heading">
              <h3 id="settings-timer-title">Timer</h3>
              <span className="settings-badge">WCA</span>
            </div>
            <div className="settings-row">
              <div className="settings-row-copy">
                <span
                  className="settings-row-label"
                  id="settings-inspection-label"
                >
                  Inspection
                </span>
                <span
                  className="settings-row-description"
                  id="settings-inspection-description"
                >
                  15-second countdown before each solve. A solve started after
                  15 seconds receives +2; after 17 seconds it is a DNF.
                </span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={inspectionEnabled}
                aria-labelledby="settings-inspection-label"
                aria-describedby="settings-inspection-description"
                className="settings-switch"
                data-testid="inspection-setting"
                onClick={() => onInspectionChange(!inspectionEnabled)}
              >
                <span className="switch-track" aria-hidden="true">
                  <span className="switch-thumb" />
                </span>
              </button>
            </div>
            <div className="settings-facts">
              <div>
                <span>Inspection limit</span>
                <strong>15 s</strong>
              </div>
              <div>
                <span>Late penalties</span>
                <strong>+2 / DNF</strong>
              </div>
            </div>
          </section>

          <section
            className="settings-section"
            aria-labelledby="settings-controls-title"
          >
            <div className="settings-section-heading">
              <h3 id="settings-controls-title">Controls</h3>
            </div>
            <dl className="settings-controls">
              <div>
                <dt>
                  <kbd>Space</kbd>
                </dt>
                <dd>
                  Hold for 300 ms to arm, release to start, and press once to
                  stop.
                </dd>
              </div>
              <div>
                <dt>
                  <kbd>Esc</kbd>
                </dt>
                <dd>Cancel an armed hold or an active inspection.</dd>
              </div>
              <div>
                <dt>
                  <kbd>Enter</kbd>
                </dt>
                <dd>Activate a focused button or switch.</dd>
              </div>
            </dl>
          </section>

          <section
            className="settings-section"
            aria-labelledby="settings-data-title"
          >
            <div className="settings-section-heading">
              <h3 id="settings-data-title">Data</h3>
            </div>
            <div className="settings-row">
              <div className="settings-row-copy">
                <span className="settings-row-label">Local storage</span>
                <span className="settings-row-description">
                  {storageOk
                    ? `${formatSolveCount(solveCount)} in ${
                        sessionCount === 1
                          ? '1 session'
                          : `${sessionCount} sessions`
                      }, saved in this browser.`
                    : 'Browser storage is unavailable. Sessions and solves will not survive a refresh.'}
                </span>
              </div>
              <span
                className={`settings-storage ${
                  storageOk ? 'is-ok' : 'is-error'
                }`}
              >
                <span className="status-dot" aria-hidden="true" />
                {storageOk ? 'Saved' : 'Unavailable'}
              </span>
            </div>
            <button
              type="button"
              className="settings-data-button"
              onClick={onOpenBackup}
              data-testid="settings-backup-button"
            >
              <span className="settings-data-copy">
                <span className="settings-data-title">Backup &amp; restore</span>
                <span className="settings-data-description">
                  Export or import every session, solve, and setting
                </span>
              </span>
              <ChevronRightIcon size={16} />
            </button>
            <p className="settings-note">
              Backups stay on this device. CubeLab never uploads them.
            </p>
          </section>

          <section
            className="settings-section"
            aria-labelledby="settings-about-title"
          >
            <div className="settings-section-heading">
              <h3 id="settings-about-title">About</h3>
            </div>
            <dl className="settings-about">
              <div>
                <dt>Timer</dt>
                <dd>3×3 · WCA random-state</dd>
              </div>
              <div>
                <dt>Data</dt>
                <dd>Local-first, with no accounts or telemetry</dd>
              </div>
              <div>
                <dt>Offline</dt>
                <dd>Installable PWA with offline scramble generation</dd>
              </div>
            </dl>
          </section>
        </div>

        <footer className="settings-footer">
          <span className="settings-footer-note">
            Changes save automatically.
          </span>
          <button
            type="button"
            className="button button-secondary"
            onClick={onClose}
            data-testid="settings-done"
          >
            Done
          </button>
        </footer>
      </div>
    </dialog>
  )
}
