import { useEffect, useRef, useState } from 'react'
import { useModalDialog } from '../hooks/useModalDialog'
import { CloseIcon } from './Icons'
import { nextSessionName } from '../lib/sessions'
import { CUBELAB_EVENTS } from '../lib/events'
import type { PuzzleEvent, SessionPreferences } from '../types'

interface SessionSetupDialogProps {
  open: boolean
  sessions: readonly { name: string }[]
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
  const [name, setName] = useState(nextSessionName(sessions as any))
  const inputRef = useRef<HTMLInputElement>(null)
  const [event, setEvent] = useState<PuzzleEvent>(defaultEvent)
  const [inspectionEnabled, setInspectionEnabled] = useState(
    defaultPreferences?.inspectionEnabled ?? defaultInspectionEnabled,
  )
  const [inspectionDirection, setInspectionDirection] = useState(
    defaultPreferences?.inspectionCountDirection ?? 'down',
  )
  const [warning8s, setWarning8s] = useState(defaultPreferences?.inspectionWarning8s ?? false)
  const [warning12s, setWarning12s] = useState(defaultPreferences?.inspectionWarning12s ?? false)
  const [scrambleAction, setScrambleAction] = useState(
    defaultPreferences?.scrambleAction ?? 'copy',
  )
  const [scrambleAlignment, setScrambleAlignment] = useState(
    defaultPreferences?.scrambleAlignment ?? 'center',
  )
  const [timerMode, setTimerMode] = useState(defaultPreferences?.timerUpdateMode ?? 'live')
  const [holdDuration, setHoldDuration] = useState(
    defaultPreferences?.holdDurationMs ?? 300,
  )
  const [stopWithAnyKey, setStopWithAnyKey] = useState(
    defaultPreferences?.stopWithAnyKey ?? false,
  )
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setName(nextSessionName(sessions as any))
    setEvent(defaultEvent)
    setInspectionEnabled(defaultPreferences?.inspectionEnabled ?? defaultInspectionEnabled)
    setInspectionDirection(defaultPreferences?.inspectionCountDirection ?? 'down')
    setWarning8s(defaultPreferences?.inspectionWarning8s ?? false)
    setWarning12s(defaultPreferences?.inspectionWarning12s ?? false)
    setScrambleAction(defaultPreferences?.scrambleAction ?? 'copy')
    setScrambleAlignment(defaultPreferences?.scrambleAlignment ?? 'center')
    setTimerMode(defaultPreferences?.timerUpdateMode ?? 'live')
    setHoldDuration(defaultPreferences?.holdDurationMs ?? 300)
    setStopWithAnyKey(defaultPreferences?.stopWithAnyKey ?? false)
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
      inspectionCountDirection: inspectionDirection,
      inspectionWarning8s: warning8s,
      inspectionWarning12s: warning12s,
      inspectionWarningVisualScope: defaultPreferences?.inspectionWarningVisualScope ?? 'timer',
      scrambleAction,
      scrambleAlignment,
      scrambleLimitHeight: defaultPreferences?.scrambleLimitHeight ?? false,
      timerUpdateMode: timerMode,
      holdDurationMs: holdDuration,
      stopWithAnyKey,
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
      className="confirm-dialog settings-dialog"
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
      <div className="dialog-content settings-content">
        <header className="settings-header">
          <div>
            <span className="eyebrow">Sessions</span>
            <h2 id="create-session-title">Create new session</h2>
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

        <p id="create-session-description" className="settings-intro">
          Configure the session before creating it.
        </p>

        {error ? (
          <p
            role="alert"
            className="settings-error"
            data-testid="session-error"
          >
            {error}
          </p>
        ) : null}

        <div className="settings-body">
          <section className="settings-section">
            <div className="settings-section-heading">
              <h3>General</h3>
            </div>
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
          </section>

          <details className="settings-field-group">
            <summary>Inspection</summary>
            <div className="settings-row">
              <div className="settings-row-copy">
                <span className="settings-row-label">Enable inspection</span>
              </div>
              <input
                type="checkbox"
                checked={inspectionEnabled}
                onChange={(eventTarget) =>
                  setInspectionEnabled(eventTarget.target.checked)
                }
              />
            </div>
            <div className="settings-field">
              <span>Inspection direction</span>
              <select
                className="compact-select"
                value={inspectionDirection}
                onChange={(eventTarget) =>
                  setInspectionDirection(
                    eventTarget.target.value as 'down' | 'up',
                  )
                }
              >
                <option value="down">Count down</option>
                <option value="up">Count up</option>
              </select>
            </div>
            <div className="settings-row">
              <div className="settings-row-copy">
                <span className="settings-row-label">8-second warning</span>
              </div>
              <input
                type="checkbox"
                checked={warning8s}
                onChange={(eventTarget) => setWarning8s(eventTarget.target.checked)}
              />
            </div>
            <div className="settings-row">
              <div className="settings-row-copy">
                <span className="settings-row-label">12-second warning</span>
              </div>
              <input
                type="checkbox"
                checked={warning12s}
                onChange={(eventTarget) => setWarning12s(eventTarget.target.checked)}
              />
            </div>
          </details>

          <details className="settings-field-group">
            <summary>Scramble</summary>
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
          </details>

          <details className="settings-field-group">
            <summary>Timer</summary>
            <div className="settings-field">
              <span>Timer mode</span>
              <select
                className="compact-select"
                value={timerMode}
                onChange={(eventTarget) =>
                  setTimerMode(eventTarget.target.value as any)
                }
              >
                <option value="live">Live</option>
                <option value="tenths">Tenths</option>
                <option value="seconds">Seconds</option>
              </select>
            </div>
            <div className="settings-field">
              <span>Hold duration</span>
              <input
                type="number"
                min="0"
                max="10000"
                value={holdDuration}
                onChange={(eventTarget) =>
                  setHoldDuration(Number(eventTarget.target.value))
                }
              />
            </div>
            <div className="settings-row">
              <div className="settings-row-copy">
                <span className="settings-row-label">Stop with any key</span>
              </div>
              <input
                type="checkbox"
                checked={stopWithAnyKey}
                onChange={(eventTarget) =>
                  setStopWithAnyKey(eventTarget.target.checked)
                }
              />
            </div>
          </details>
        </div>

        <footer className="settings-footer">
          <span className="settings-footer-note">
            Advanced options are saved on this session only.
          </span>
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