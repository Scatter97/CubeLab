import { useEffect, useRef, useState } from 'react'
import { useModalDialog } from '../hooks/useModalDialog'
import { CloseIcon } from './Icons'
import { nextSessionName } from '../lib/sessions'
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
  const [scrambleAction, setScrambleAction] = useState(
    defaultPreferences?.scrambleAction ?? 'copy',
  )
  const [scrambleAlignment, setScrambleAlignment] = useState(
    defaultPreferences?.scrambleAlignment ?? 'center',
  )
  const [scrambleLimitHeight, setScrambleLimitHeight] = useState(
    defaultPreferences?.scrambleLimitHeight ?? false,
  )
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setName(nextSessionName(sessions as { id: string; name: string }[]))
    setEvent(defaultEvent)
    setInspectionEnabled(defaultPreferences?.inspectionEnabled ?? defaultInspectionEnabled)
    setScrambleAction(defaultPreferences?.scrambleAction ?? 'copy')
    setScrambleAlignment(defaultPreferences?.scrambleAlignment ?? 'center')
    setScrambleLimitHeight(defaultPreferences?.scrambleLimitHeight ?? false)
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
    if (!trimmed) {
      setError('Enter a session name.')
      return
    }
    if (trimmed.length > 40) {
      setError('Use 40 characters or fewer.')
      return
    }
    const duplicate = sessions.some(
      (session) => session.name.trim().toLowerCase() === trimmed.toLowerCase(),
    )
    if (duplicate) {
      setError('Session names must be unique.')
      return
    }
    setError(null)
    const preferences: SessionPreferences = {
      inspectionEnabled,
      scrambleAction,
      scrambleAlignment,
      scrambleLimitHeight,
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

        {error ? (
          <p role="alert" className="settings-error" data-testid="session-error">
            {error}
          </p>
        ) : null}

        <div className="session-settings-body">
          <div className="settings-field">
            <span>Session name</span>
            <input
              type="text"
              aria-label="Session name"
              ref={inputRef}
              value={name}
              onChange={(eventTarget) => setName(eventTarget.target.value)}
              autoFocus
            />
          </div>

          <div className="settings-field">
            <span>Puzzle event</span>
            <select
              className="compact-select"
              value={event}
              onChange={(eventTarget) =>
                setEvent(eventTarget.target.value as PuzzleEvent)
              }
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

          <div className="session-settings-group">
            <h3>Scramble</h3>
            <div className="settings-field">
              <span>Click action</span>
              <select
                className="compact-select"
                value={scrambleAction}
                onChange={(eventTarget) =>
                  setScrambleAction(eventTarget.target.value as any)
                }
              >
                <option value="none">None</option>
                <option value="copy">Copy</option>
                <option value="next">Next</option>
              </select>
            </div>
            <div className="settings-field">
              <span>Alignment</span>
              <select
                className="compact-select"
                value={scrambleAlignment}
                onChange={(eventTarget) =>
                  setScrambleAlignment(eventTarget.target.value as any)
                }
              >
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
              </select>
            </div>
            <div className="settings-row">
              <div className="settings-row-copy">
                <span className="settings-row-label">Limit height</span>
                <span className="settings-row-description">
                  Restrict scramble panel height.
                </span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={scrambleLimitHeight}
                aria-label="Limit scramble height"
                className="settings-switch"
                onClick={() => setScrambleLimitHeight(!scrambleLimitHeight)}
              >
                <span className="switch-track" aria-hidden="true">
                  <span className="switch-thumb" />
                </span>
              </button>
            </div>
          </div>
        </div>

        <footer className="session-settings-footer">
          <span>Changes save automatically.</span>
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