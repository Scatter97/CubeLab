import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { PuzzleEvent, Session } from '../types'
import {
  MAX_SESSION_NAME_LENGTH,
  getSessionNameError,
  nextSessionName,
} from '../lib/sessions'
import { CUBELAB_EVENTS } from '../lib/events'
import {
  CheckIcon,
  CloseIcon,
  PencilIcon,
  PlusIcon,
  SettingsIcon,
} from './Icons'

interface SessionPanelProps {
  sessions: readonly Session[]
  activeSessionId: string
  locked: boolean
  event?: PuzzleEvent
  availableEvents?: readonly PuzzleEvent[]
  onCreate?: (name: string) => boolean
  onRequestCreate?: () => void
  onRename: (id: string, name: string) => boolean
  onSelect: (id: string) => void
  onSelectEvent?: (event: PuzzleEvent) => void
  onOpenSessionSettings: () => void
}

type EditMode = 'create' | 'rename'

export function SessionPanel({
  sessions,
  activeSessionId,
  locked,
  event = '333',
  availableEvents = ['333', '222', '444', '333oh'],
  onCreate,
  onRequestCreate,
  onRename,
  onSelect,
  onSelectEvent,
  onOpenSessionSettings,
}: SessionPanelProps) {
  const [editing, setEditing] = useState<EditMode | null>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const selectRef = useRef<HTMLSelectElement>(null)
  const restoreSelectFocus = useRef(false)

  const activeSession =
    sessions.find((session) => session.id === activeSessionId) ?? sessions[0]

  useEffect(() => {
    if (!editing) return
    const input = inputRef.current
    if (!input) return
    input.focus()
    input.select()
  }, [editing])

  useEffect(() => {
    if (editing || !restoreSelectFocus.current) return
    restoreSelectFocus.current = false
    selectRef.current?.focus()
  }, [editing])

  const startCreate = () => {
    if (locked) return
    if (onRequestCreate) {
      onRequestCreate()
      return
    }
    setDraft(nextSessionName(sessions))
    setError(null)
    setEditing('create')
  }

  const startRename = () => {
    if (locked || !activeSession) return
    setDraft(activeSession.name)
    setError(null)
    setEditing('rename')
  }

  const finishEditing = () => {
    restoreSelectFocus.current = true
    setEditing(null)
    setError(null)
  }

  const cancelEditing = () => {
    if (locked) return
    finishEditing()
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editing || locked) return

    const nameError = getSessionNameError(
      draft,
      sessions,
      editing === 'rename' ? activeSessionId : undefined,
    )
    if (nameError) {
      setError(nameError)
      return
    }

    const saved =
      editing === 'create'
        ? (onCreate?.(draft) ?? false)
        : (onRename?.(activeSessionId, draft) ?? false)
    if (!saved) {
      setError('Could not save the session. Try another name.')
      return
    }

    finishEditing()
  }

  return (
    <section className="panel session-panel" aria-labelledby="session-title">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">
            <span className="eyebrow-index">01</span>
            Session
          </span>
          <h2 id="session-title">Sessions</h2>
        </div>
      </div>

      <div className="session-event-row">
        <label className="sr-only" htmlFor="active-event">Active event</label>
        <select
          id="active-event"
          className="session-select"
          value={event}
          disabled={locked}
          data-testid="event-select"
          onChange={(changeEvent) =>
            onSelectEvent?.(changeEvent.target.value as PuzzleEvent)
          }
        >
          {CUBELAB_EVENTS.filter((item) => availableEvents.includes(item.id)).map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </div>

      {editing ? (
        <form
          className="session-edit"
          onSubmit={handleSubmit}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation()
              cancelEditing()
            }
          }}
        >
          <label className="sr-only" htmlFor="session-name-input">
            Session name
          </label>
          <input
            id="session-name-input"
            ref={inputRef}
            type="text"
            className="session-name-input"
            value={draft}
            maxLength={MAX_SESSION_NAME_LENGTH}
            disabled={locked}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'session-name-error' : undefined}
            data-testid="session-name-input"
            onChange={(event) => {
              setDraft(event.target.value)
              if (error) setError(null)
            }}
          />
          <button
            type="submit"
            className="icon-button session-action"
            aria-label="Save session name"
            title="Save session name"
            disabled={locked}
            data-testid="save-session-name"
          >
            <CheckIcon size={15} />
          </button>
          <button
            type="button"
            className="icon-button session-action"
            aria-label="Cancel session name"
            title="Cancel"
            disabled={locked}
            data-testid="cancel-session-name"
            onClick={cancelEditing}
          >
            <CloseIcon size={15} />
          </button>
        </form>
      ) : (
        <div className="session-controls">
          <label className="sr-only" htmlFor="active-session">
            Active session
          </label>
          <select
            id="active-session"
            ref={selectRef}
            className="session-select"
            value={activeSessionId}
            disabled={locked}
            data-testid="session-select"
            onChange={(event) => onSelect(event.target.value)}
          >
            {sessions.map((session) => (
              <option key={session.id} value={session.id}>
                {session.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="icon-button session-action"
            aria-label="New session"
            title={
              locked
                ? 'Finish or reset the current timer before creating a session'
                : 'Create a new session'
            }
            disabled={locked}
            data-testid="new-session"
            onClick={startCreate}
          >
            <PlusIcon size={15} />
          </button>
          <button
            type="button"
            className="icon-button session-action"
            aria-label="Rename session"
            title={
              locked
                ? 'Finish or reset the current timer before renaming a session'
                : 'Rename the active session'
            }
            disabled={locked}
            data-testid="rename-session"
            onClick={startRename}
          >
            <PencilIcon size={15} />
          </button>
          <button
            type="button"
            className="icon-button session-action"
            aria-label="Session settings"
            title={
              locked
                ? 'Finish or reset the current timer before opening session settings'
                : 'Open settings for the active session'
            }
            disabled={locked}
            data-testid="session-settings"
            onClick={onOpenSessionSettings}
          >
            <SettingsIcon size={15} />
          </button>
        </div>
      )}

      {error ? (
        <p
          id="session-name-error"
          className="session-error"
          role="alert"
          data-testid="session-error"
        >
          {error}
        </p>
      ) : null}
    </section>
  )
}
