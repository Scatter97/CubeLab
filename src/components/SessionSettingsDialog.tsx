import { useModalDialog } from '../hooks/useModalDialog'
import { formatSolveCount } from '../lib/format'
import type { Session } from '../types'
import { CloseIcon } from './Icons'

interface SessionSettingsDialogProps {
  open: boolean
  session: Session
  effectiveInspectionEnabled: boolean
  canDelete: boolean
  onSetInspection: (enabled: boolean) => void
  onRequestClear: () => void
  onRequestDelete: () => void
  onClose: () => void
}

export function SessionSettingsDialog({
  open,
  session,
  effectiveInspectionEnabled,
  canDelete,
  onSetInspection,
  onRequestClear,
  onRequestDelete,
  onClose,
}: SessionSettingsDialogProps) {
  const { dialogRef, handleKeyDown } = useModalDialog(open)
  const hasOverride = session.inspectionEnabled !== undefined

  return (
    <dialog
      ref={dialogRef}
      className="confirm-dialog session-settings-dialog"
      aria-labelledby="session-settings-title"
      aria-describedby="session-settings-description"
      onKeyDown={handleKeyDown}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose()
      }}
    >
      <div className="dialog-content session-settings-content">
        <header className="settings-header">
          <div>
            <span className="eyebrow">Session</span>
            <h2 id="session-settings-title">Session settings</h2>
            <p id="session-settings-description" className="session-settings-meta">
              {session.name} · {formatSolveCount(session.solves.length)}
            </p>
          </div>
          <button
            type="button"
            className="icon-button settings-close"
            aria-label="Close session settings"
            title="Close session settings"
            onClick={onClose}
          >
            <CloseIcon size={16} />
          </button>
        </header>

        <div className="session-settings-body">
          <div className="settings-row">
            <div className="settings-row-copy">
              <span className="settings-row-label">Inspection</span>
              <span className="settings-row-description">
                {hasOverride
                  ? 'This session overrides the global inspection default.'
                  : 'This session is using the global inspection default.'}
              </span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={effectiveInspectionEnabled}
              aria-label="Inspection for this session"
              className="settings-switch"
              data-testid="session-inspection-setting"
              onClick={() => onSetInspection(!effectiveInspectionEnabled)}
            >
              <span className="switch-track" aria-hidden="true">
                <span className="switch-thumb" />
              </span>
            </button>
          </div>

          <div className="session-settings-danger">
            <div>
              <h3>Manage session</h3>
              <p>
                Clear removes every solve in this session. Delete removes the
                session and its solves. Both require typed confirmation.
              </p>
            </div>
            <div className="session-settings-actions">
              <button
                type="button"
                className="button button-secondary"
                data-testid="session-clear"
                disabled={session.solves.length === 0}
                onClick={onRequestClear}
              >
                Clear session
              </button>
              <button
                type="button"
                className="button button-danger"
                data-testid="session-delete"
                disabled={!canDelete}
                title={canDelete ? undefined : 'Keep at least one session'}
                onClick={onRequestDelete}
              >
                Delete session
              </button>
            </div>
          </div>
        </div>

        <footer className="session-settings-footer">
          <span>Changes save automatically.</span>
          <button
            type="button"
            className="button button-primary"
            data-testid="session-settings-done"
            onClick={onClose}
          >
            Done
          </button>
        </footer>
      </div>
    </dialog>
  )
}
