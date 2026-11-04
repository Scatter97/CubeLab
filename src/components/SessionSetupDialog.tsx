import { useEffect, useRef, useState } from 'react'
import { useModalDialog } from '../hooks/useModalDialog'
import { AlertCircleIcon, CloseIcon } from './Icons'
import { getSessionNameError } from '../lib/sessions'
import {
  formatEventOptionLabel,
  getEventLabel,
  getEventOptions,
} from '../lib/events'
import type { PuzzleEvent, SessionPreferences } from '../types'
import { Select } from './Select'

interface SessionSetupDialogProps {
  open: boolean
  sessions: readonly { id?: string; name: string }[]
  defaultEvent: PuzzleEvent
  defaultInspectionEnabled: boolean
  defaultPreferences?: SessionPreferences
  onClose: () => void
  onCreate: (name: string, event: PuzzleEvent, preferences: SessionPreferences) => boolean
}

type SessionSetupContentProps = Omit<SessionSetupDialogProps, 'open'>

function defaultNameForEvent(event: PuzzleEvent): string {
  return getEventLabel(event) || 'Session 1'
}

/**
 * The dialog shell stays mounted so native close/focus restoration still runs.
 * Its contents mount only while open, which gives every opening fresh local
 * state without a setState-in-effect reset.
 */
export function SessionSetupDialog({
  open,
  onClose,
  ...contentProps
}: SessionSetupDialogProps) {
  const { dialogRef, handleKeyDown } = useModalDialog(open)

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
      {open ? <SessionSetupContent onClose={onClose} {...contentProps} /> : null}
    </dialog>
  )
}

function SessionSetupContent({
  sessions,
  defaultEvent,
  defaultInspectionEnabled,
  defaultPreferences,
  onClose,
  onCreate,
}: SessionSetupContentProps) {
  const [name, setName] = useState(() => defaultNameForEvent(defaultEvent))
  const [event, setEvent] = useState<PuzzleEvent>(defaultEvent)
  const [inspectionEnabled, setInspectionEnabled] = useState(
    defaultPreferences?.inspectionEnabled ?? defaultInspectionEnabled,
  )
  const [saveError, setSaveError] = useState<string | null>(null)
  const [nameTouched, setNameTouched] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const validationError =
    saveError ?? (nameTouched ? getSessionNameError(name, nameCandidates()) : null)

  useEffect(() => {
    const timer = window.setTimeout(() => inputRef.current?.focus(), 50)
    return () => window.clearTimeout(timer)
  }, [])

  function nameCandidates() {
    return sessions.map((session, index) => ({
      id: session.id ?? String(index),
      name: session.name,
    }))
  }

  function submit() {
    const trimmed = name.trim()
    setNameTouched(true)
    setSaveError(null)
    const submitError = getSessionNameError(trimmed, nameCandidates())
    if (submitError) {
      inputRef.current?.focus()
      return
    }
    const preferences: SessionPreferences = {
      inspectionEnabled,
    }
    const ok = onCreate(trimmed, event, preferences)
    if (!ok) {
      setSaveError('Could not create the session. Try another name.')
      inputRef.current?.focus()
      return
    }
    onClose()
  }

  return (
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
            aria-invalid={validationError ? true : undefined}
            aria-describedby={
              validationError ? 'create-session-name-error' : undefined
            }
            ref={inputRef}
            value={name}
            maxLength={40}
            onChange={(eventTarget) => {
              setName(eventTarget.target.value)
              setSaveError(null)
              setNameTouched(true)
            }}
            autoFocus
          />
          {validationError ? (
            <span
              id="create-session-name-error"
              role="alert"
              className="settings-inline-error"
              data-testid="session-error"
            >
              <AlertCircleIcon
                size={14}
                className="settings-inline-error-icon"
              />
              <span>{validationError}</span>
            </span>
          ) : null}
        </div>

        <div className="settings-field">
          <span>Puzzle event</span>
          <Select
            className="compact-select"
            value={event}
            ariaLabel="Puzzle event"
            testId="session-setup-event"
            options={getEventOptions().map((item) => ({
              value: item.id,
              label: formatEventOptionLabel(item),
              text: item.label,
            }))}
            onChange={(value) => {
              const next = value as PuzzleEvent
              const previous = event
              setEvent(next)
              if (!nameTouched) {
                setName(defaultNameForEvent(next))
              } else {
                const current = name.trim()
                const previousLabel = defaultNameForEvent(previous)
                if (
                  current === previousLabel ||
                  current === '' ||
                  /^Session\s+\d+$/.test(current)
                ) {
                  setName(defaultNameForEvent(next))
                }
              }
            }}
          />
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
  )
}
