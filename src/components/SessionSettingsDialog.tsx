import { useState } from 'react'
import { useModalDialog } from '../hooks/useModalDialog'
import { formatSolveCount } from '../lib/format'
import { getSessionNameError } from '../lib/sessions'
import { CUBELAB_EVENTS } from '../lib/events'
import type { PuzzleEvent, Session } from '../types'
import { CloseIcon } from './Icons'

interface SessionSettingsDialogProps {
  open: boolean
  sessions: Session[]
  session: Session
  effectiveInspectionEnabled: boolean
  canDelete: boolean
  onRenameSession: (id: string, name: string) => boolean
  onSetSessionEvent: (id: string, event: PuzzleEvent) => boolean
  onCreateForEvent: (event: PuzzleEvent) => void
  onSetInspection: (enabled: boolean | undefined) => void
  onRequestClear: () => void
  onRequestDelete: () => void
  onClose: () => void
}

type SessionSettingsContentProps = Omit<SessionSettingsDialogProps, 'open'>

/**
 * The dialog shell owns the native modal lifecycle. The body is remounted per
 * session while open, so its draft name and selected event always start from
 * the current session without synchronizing state inside an effect.
 */
export function SessionSettingsDialog({
  open,
  session,
  onClose,
  ...contentProps
}: SessionSettingsDialogProps) {
  const { dialogRef, handleKeyDown } = useModalDialog(open)

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
      {open ? (
        <SessionSettingsContent
          key={session.id}
          session={session}
          onClose={onClose}
          {...contentProps}
        />
      ) : null}
    </dialog>
  )
}

function SessionSettingsContent({
  sessions: allSessions,
  session,
  effectiveInspectionEnabled,
  canDelete,
  onRenameSession,
  onSetSessionEvent,
  onCreateForEvent,
  onSetInspection,
  onRequestClear,
  onRequestDelete,
  onClose,
}: SessionSettingsContentProps) {
  const [name, setName] = useState(session.name)
  const [nameError, setNameError] = useState<string | null>(null)
  const [eventError, setEventError] = useState<string | null>(null)
  const [selectedEvent, setSelectedEvent] = useState<PuzzleEvent>(
    session.event ?? '333',
  )
  const hasOverride =
    session.inspectionEnabled !== undefined ||
    session.preferences?.inspectionEnabled !== undefined

  return (
    <div className="dialog-content session-settings-content">
      <header className="settings-header">
        <div>
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
        <div className="session-settings-group">
          <div className="settings-field">
            <span>Session name</span>
            <input
              type="text"
              aria-label="Session name"
              aria-invalid={Boolean(nameError)}
              aria-describedby={nameError ? 'session-settings-name-error' : undefined}
              value={name}
              onChange={(event) => {
                setName(event.target.value)
                setNameError(null)
              }}
              onBlur={() => {
                const trimmed = name.trim()
                if (!trimmed) {
                  setNameError('Enter a session name.')
                  setName(session.name)
                  return
                }
                const validationError = getSessionNameError(
                  trimmed,
                  allSessions,
                  session.id,
                )
                if (validationError) {
                  setNameError(validationError)
                  return
                }
                const ok = onRenameSession(session.id, trimmed)
                if (!ok) setNameError('Could not rename the session.')
              }}
            />
            {nameError ? (
              <p
                id="session-settings-name-error"
                role="alert"
                className="settings-error"
              >
                {nameError}
              </p>
            ) : null}
          </div>

          <div className="settings-field">
            <span>Event</span>
            {session.solves.length > 0 ? (
              <input
                className="compact-select"
                type="text"
                value={CUBELAB_EVENTS.find((item) => item.id === (session.event ?? '333'))?.label ?? session.event}
                disabled
                readOnly
              />
            ) : (
              <select
                className="compact-select"
                value={selectedEvent}
                onChange={(eventTarget) => {
                  const next = eventTarget.target.value as PuzzleEvent
                  const previous = selectedEvent
                  if (!onSetSessionEvent(session.id, next)) {
                    setEventError('Could not change this session event.')
                    return
                  }
                  setSelectedEvent(next)
                  const trimmedName = name.trim()
                  const eventLabel = (id: PuzzleEvent) =>
                    CUBELAB_EVENTS.find((item) => item.id === id)?.label ?? id
                  const defaultish =
                    trimmedName === '' ||
                    trimmedName === eventLabel(previous) ||
                    /^Session \d+$/.test(trimmedName)
                  if (defaultish) {
                    const nextName = eventLabel(next)
                    setName(nextName)
                    if (!onRenameSession(session.id, nextName)) {
                      setNameError(
                        'Could not rename the session. Choose a unique name.',
                      )
                      setName(session.name)
                    } else {
                      setNameError(null)
                    }
                  }
                  setEventError(null)
                }}
              >
                {CUBELAB_EVENTS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            )}
            {eventError ? (
              <p role="alert" className="settings-error">
                {eventError}
              </p>
            ) : null}
            {session.solves.length > 0 ? (
              <p className="settings-row-description">
                Event is locked because this session has solves.
                <button
                  type="button"
                  className="button button-secondary button-small"
                  onClick={() => onCreateForEvent?.(session.event ?? '333')}
                >
                  Create a new session for another event
                </button>
              </p>
            ) : null}
          </div>
        </div>

        <div className="settings-row">
          <div className="settings-row-copy">
            <span className="settings-row-label">Inspection</span>
            <span className="settings-row-description">
              {hasOverride
                ? 'This session overrides the global inspection default.'
                : 'This session is using the global inspection default.'}
            </span>
            {hasOverride ? (
              <button
                type="button"
                className="text-button"
                data-testid="session-inspection-use-global"
                onClick={() => onSetInspection(undefined)}
              >
                Use global setting
              </button>
            ) : null}
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
  )
}
