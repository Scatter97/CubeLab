import { useEffect, useRef, useState } from 'react'
import { useModalDialog } from '../hooks/useModalDialog'
import { CloseIcon } from './Icons'
import { nextSessionName, getSessionNameError } from '../lib/sessions'
import { CUBELAB_EVENTS } from '../lib/events'
import type { PuzzleEvent, SessionPreferences } from '../types'

interface SessionSetupDialogProps {
  open: boolean
  sessions: readonly { id?: string; name: string }[]
  defaultEvent: PuzzleEvent
  defaultInspectionEnabled: boolean
  defaultPreferences?: SessionPreferences
  onClose: () => void
  onCreate: (name: string, event: PuzzleEvent, preferences: SessionPreferences) => boolean
}

export function SessionSetupDialog({
  open,
  sessions,
  defaultEvent,
  defaultInspectionEnabled,
  defaultPreferences,
  onClose,
  onCreate,
}: SessionSetupDialogProps) {
  const { dialogRef, handleKeyDown } = useModalDialog(open)
  const [name, setName] = useState(nextSessionName(sessions as { id: string; name: string }[]))
  const [event, setEvent] = useState<PuzzleEvent>(defaultEvent)
  const [inspectionEnabled, setInspectionEnabled] = useState(
    defaultPreferences?.inspectionEnabled ?? defaultInspectionEnabled,
  )
  const [error, setError] = useState<string | null>(null)
  const [nameTouched, setNameTouched] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setName(CUBELAB_EVENTS.find((item) => item.id === defaultEvent)?.label ?? 'Session 1')
    setNameTouched(false)
    setEvent(defaultEvent)
    setInspectionEnabled(defaultPreferences?.inspectionEnabled ?? defaultInspectionEnabled)
    setError(null)
  }, [open, sessions, defaultEvent, defaultInspectionEnabled, defaultPreferences])

  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => inputRef.current?.focus(), 50)
    return () => window.clearTimeout(timer)
  }, [open])

  if (!open) return null

  function submit() {
    const trimmed = name.trim()
    const validationError = getSessionNameError(trimmed, sessions.map((session, index) => ({ id: session.id ?? String(index), name: session.name })))
    if (validationError) {
      setError(validationError)
      inputRef.current?.focus()
      return
    }
    setError(null)
    const preferences: SessionPreferences = {
      inspectionEnabled,
    }
    const ok = onCreate(trimmed, event, preferences)
    if (!ok) {
      setError('Could not create the session. Try another name.')
      return
    }
    onClose()
  }

  return (
    <dialog
      ref={dialogRef}
      className="confirm-dialog session-settings-dialog"
      aria-labelledby="create-session-title"
      aria-describedby="create-session-description"
      onKeyDown={handleKeyDown}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(eventTarget) => {
        if (eventTarget.target === dialogRef.current) onClose()
      }}
    >
      <div className="dialog-content session-settings-content">
        <header className="settings-header">
          <div>
            <span className="eyebrow">Session</span>
            <h2 id="create-session-title">Create new session</h2>
            <p
              id="create-session-description"
              className="session-settings-meta"
            >
              Name, event, and essential session behavior
            </p>
          </div>
          <button
            type="button"
            className="icon-button settings-close"
            aria-label="Close create session"
            title="Close create session"
            onClick={onClose}
          >
            <CloseIcon size={16} />
          </button>
        </header>

        <div className="session-settings-body">
          <div className="settings-field">
            <span>Session name</span>
            <input
              type="text"
              aria-label="Session name"
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "create-session-name-error" : undefined}
              ref={inputRef}
              value={name}
              onChange={(eventTarget) => {
                  setName(eventTarget.target.value)
                  if (error) setError(getSessionNameError(eventTarget.target.value, sessions.map((session, index) => ({ id: session.id ?? String(index), name: session.name }))))
                  setNameTouched(true)
                }}
              autoFocus
            />
            {error ? <p id="create-session-name-error" role="alert" className="settings-error" data-testid="session-error"><span aria-hidden="true">❗</span> {error}</p> : null}
          </div>

          <div className="settings-field">
            <span>Puzzle event</span>
            <select
              className="compact-select"
              value={event}
              onChange={(eventTarget) => {
                  const next = eventTarget.target.value as PuzzleEvent
                  const previous = event
                  setEvent(next)
                  if (!nameTouched) {
                    const nextLabel =
                      CUBELAB_EVENTS.find((item) => item.id === next)?.label ?? next
                    setName(nextLabel)
                  } else {
                    const current = name.trim()
                    const previousLabel =
                      CUBELAB_EVENTS.find((item) => item.id === previous)?.label ?? previous
                    if (current === previousLabel || current === '' || /^Session\s+\d+$/.test(current)) {
                      setName(CUBELAB_EVENTS.find((item) => item.id === next)?.label ?? next)
                    }
                  }
                }}
            >
              {CUBELAB_EVENTS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>

          <div className="settings-row">
            <div className="settings-row-copy">
              <span className="settings-row-label">Enable inspection</span>
              <span className="settings-row-description">
                Use this session’s inspection override.
              </span>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={inspectionEnabled}
              aria-label="Enable inspection"
              className="settings-switch"
              onClick={() => setInspectionEnabled(!inspectionEnabled)}
            >
              <span className="switch-track" aria-hidden="true">
                <span className="switch-thumb" />
              </span>
            </button>
          </div>
        </div>

        <footer className="session-settings-footer">
          <span>Nothing is saved until you create the session.</span>
          <button
            type="button"
            className="button button-secondary"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="button button-primary"
            onClick={submit}
          >
            Create session
          </button>
        </footer>
      </div>
    </dialog>
  )
}