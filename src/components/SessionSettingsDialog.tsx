import { useState } from 'react'
import { useModalDialog } from '../hooks/useModalDialog'
import { formatSolveCount } from '../lib/format'
import { getSessionNameError } from '../lib/sessions'
import {
  formatEventOptionLabel,
  getEventLabel,
  getEventOptions,
} from '../lib/events'
import type { PuzzleEvent, Session } from '../types'
import { CloseIcon } from './Icons'
import { Select } from './Select'

interface SessionSettingsDialogProps {
  open: boolean
  sessions: Session[]
  session: Session
  effectiveInspectionEnabled: boolean
  canDelete: boolean
  onRenameSession: (id: string, name: string) => boolean
  onSetSessionEvent: (id: string, event: PuzzleEvent) => boolean
  onOpenEventManager: () => void
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
  onOpenEventManager,
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
  const [pendingEvent, setPendingEvent] = useState<PuzzleEvent | null>(null)
  const hasOverride =
    session.inspectionEnabled !== undefined ||
    session.preferences?.inspectionEnabled !== undefined

  const renameAfterEventChange = (
    previousEvent: PuzzleEvent,
    nextEvent: PuzzleEvent,
  ) => {
    const trimmedName = name.trim()
    const defaultish =
      trimmedName === '' ||
      trimmedName === getEventLabel(previousEvent) ||
      /^Session \d+$/.test(trimmedName)
    if (!defaultish) return
    const nextName = getEventLabel(nextEvent)
    setName(nextName)
    if (!onRenameSession(session.id, nextName)) {
      setNameError('Could not rename the session. Choose a unique name.')
      setName(session.name)
    } else {
      setNameError(null)
    }
  }

  const applyEventChange = (next: PuzzleEvent): boolean => {
    const previous = selectedEvent
    if (!onSetSessionEvent(session.id, next)) {
      setEventError('Could not change this session event.')
      return false
    }
    setSelectedEvent(next)
    setPendingEvent(null)
    setEventError(null)
    renameAfterEventChange(previous, next)
    return true
  }

  const requestEventChange = (next: PuzzleEvent) => {
    if (next === selectedEvent) return
    setEventError(null)
    if (session.solves.length > 0) {
      setPendingEvent(next)
      return
    }
    applyEventChange(next)
  }

  const cancelEventChange = () => {
    setPendingEvent(null)
    setEventError(null)
  }

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
          <div className="session-settings-field">
            <label htmlFor="session-name-setting" className="settings-field-label">
              Session name
            </label>
            <p className="settings-row-description">
              Unique within this browser, up to 40 characters.
            </p>
            <input
              id="session-name-setting"
              type="text"
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

          <div className="session-settings-field">
            <label htmlFor="session-event-select" className="settings-field-label">
              Event
            </label>
            <p className="settings-row-description">
              Changes apply to this session and every solve it contains. Solve
              times, penalties, scrambles, comments, dates, and import details
              stay unchanged.
            </p>
            <div className="session-settings-control-row">
              <Select
                id="session-event-select"
                className="compact-select"
                value={pendingEvent ?? selectedEvent}
                ariaDescribedBy={
                  pendingEvent ? 'session-event-confirmation' : undefined
                }
                testId="session-event-select"
                options={getEventOptions().map((item) => ({
                  value: item.id,
                  label: formatEventOptionLabel(item),
                  text: item.label,
                }))}
                onChange={(value) =>
                  requestEventChange(value as PuzzleEvent)
                }
              />
              <button
                type="button"
                className="button button-secondary button-small"
                data-testid="manage-events"
                onClick={onOpenEventManager}
              >
                Manage custom events
              </button>
            </div>
            {eventError ? (
              <p role="alert" className="settings-error">
                {eventError}
              </p>
            ) : null}
            {pendingEvent ? (
              <div
                className="session-event-confirmation"
                id="session-event-confirmation"
                role="group"
                aria-label="Confirm session event change"
              >
                <p>
                  Change <strong>{session.name}</strong> from{' '}
                  <strong>{getEventLabel(selectedEvent)}</strong> to{' '}
                  <strong>{getEventLabel(pendingEvent)}</strong>?
                </p>
                <p className="settings-note">
                  This reassigns {formatSolveCount(session.solves.length)} in
                  this session. Solve IDs, raw times, penalties, scrambles,
                  comments, dates, and import provenance are preserved.
                </p>
                <div className="session-event-confirmation-actions">
                  <button
                    type="button"
                    className="button button-primary button-small"
                    data-testid="confirm-session-event"
                    autoFocus
                    onClick={() => applyEventChange(pendingEvent)}
                  >
                    Confirm event change
                  </button>
                  <button
                    type="button"
                    className="button button-secondary button-small"
                    data-testid="cancel-session-event"
                    onClick={cancelEventChange}
                  >
                    Cancel
                  </button>
                </div>
              </div>
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
