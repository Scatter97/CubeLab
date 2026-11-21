import { useEffect, useRef, useState } from 'react'
import { useModalDialog } from '../hooks/useModalDialog'
import { AlertCircleIcon, CloseIcon } from './Icons'
import { resolveSessionName, suggestSessionName } from '../lib/sessionNames'
import {
  getSessionNameError,
  MAX_SESSION_NAME_LENGTH,
  type SessionNameCandidate,
} from '../lib/sessions'
import {
  formatEventOptionLabel,
  getEventLabel,
  getEventOptions,
} from '../lib/events'
import type {
  CompetitionFormat,
  CompetitionFormatId,
  PuzzleEvent,
  SessionKind,
  SessionPreferences,
} from '../types'
import {
  COMPETITION_FORMATS,
  competitionFormatId,
  defaultCompetitionFormat,
  getCompetitionFormatById,
} from '../lib/competition'
import { Select } from './Select'

interface SessionSetupDialogProps {
  open: boolean
  sessions: readonly SessionNameCandidate[]
  defaultEvent: PuzzleEvent
  defaultInspectionEnabled: boolean
  defaultPreferences?: SessionPreferences
  onClose: () => void
  onCreate: (
    name: string,
    event: PuzzleEvent,
    preferences: SessionPreferences,
    competitionFormat?: CompetitionFormat,
  ) => boolean
}

type SessionSetupContentProps = Omit<SessionSetupDialogProps, 'open'>

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
  const [name, setName] = useState(() =>
    suggestSessionName(
      getEventLabel(defaultEvent),
      sessions.map((session) => session.name),
    ),
  )
  const [event, setEvent] = useState<PuzzleEvent>(defaultEvent)
  const [kind, setKind] = useState<SessionKind>('practice')
  const [formatId, setFormatId] = useState<CompetitionFormatId>(() => {
    const format = defaultCompetitionFormat(defaultEvent)
    return competitionFormatId(format) ?? 'ao5'
  })
  const [inspectionEnabled, setInspectionEnabled] = useState(
    defaultPreferences?.inspectionEnabled ?? defaultInspectionEnabled,
  )
  const [saveError, setSaveError] = useState<string | null>(null)
  const [nameTouched, setNameTouched] = useState(false)
  const [nameEdited, setNameEdited] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const suggestedName = suggestSessionName(
    getEventLabel(event),
    sessions.map((session) => session.name),
  )
  const resolvedName = resolveSessionName(name, suggestedName)
  const validationError =
    saveError ?? (nameTouched ? getSessionNameError(resolvedName, sessions) : null)

  useEffect(() => {
    const timer = window.setTimeout(() => inputRef.current?.focus(), 50)
    return () => window.clearTimeout(timer)
  }, [])

  function submit() {
    setNameTouched(true)
    setSaveError(null)
    const submitError = getSessionNameError(resolvedName, sessions)
    if (submitError) {
      inputRef.current?.focus()
      return
    }
    const preferences: SessionPreferences = {
      inspectionEnabled,
    }
    const competitionFormat =
      kind === 'competition'
        ? getCompetitionFormatById(formatId) ?? undefined
        : undefined
    const ok = competitionFormat
      ? onCreate(resolvedName, event, preferences, competitionFormat)
      : onCreate(resolvedName, event, preferences)
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

      <div className="session-settings-body">
        <div className="settings-field">
          <span>Session name</span>
          <input
            type="text"
            className="session-name-input"
            aria-label="Session name"
            aria-invalid={validationError ? true : undefined}
            aria-describedby={
              validationError ? 'create-session-name-error' : undefined
            }
            ref={inputRef}
            value={name}
            placeholder={suggestedName}
            maxLength={MAX_SESSION_NAME_LENGTH}
            onFocus={(eventTarget) => eventTarget.currentTarget.select()}
            onKeyDown={(eventTarget) => {
              const key = eventTarget.key
              if (key.length === 1 && !eventTarget.ctrlKey && !eventTarget.metaKey && !eventTarget.altKey) {
                setNameEdited(true)
              }
            }}
            onChange={(eventTarget) => {
              const nextName = eventTarget.target.value
              setName(nextName.trim() ? nextName : '')
              setNameEdited(true)
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
              const nextEvent = value as PuzzleEvent
              setEvent(nextEvent)
              setFormatId(
                competitionFormatId(defaultCompetitionFormat(nextEvent)) ??
                  'ao5',
              )
              if (!nameEdited) {
                setName(
                  suggestSessionName(
                    getEventLabel(nextEvent),
                    sessions.map((session) => session.name),
                  ),
                )
              }
              setSaveError(null)
            }}
          />
        </div>

        <div className="settings-field">
          <span className="settings-field-heading-row">
            Session type
            <span className="settings-hint">
              <button
                type="button"
                className="settings-hint-trigger"
                aria-label="About session types"
                aria-describedby="session-kind-hint"
              >
                ?
              </button>
              <span
                className="settings-hint-bubble"
                id="session-kind-hint"
                role="tooltip"
              >
                Practice records free-form solves. Competition groups solves
                into automatic WCA-style rounds with a fixed format. Practice
                can never be converted back into competition.
              </span>
            </span>
          </span>
          <div
            className="competition-kind-toggle"
            role="group"
            aria-label="Session type"
          >
            {(['practice', 'competition'] as const).map((option) => (
              <button
                key={option}
                type="button"
                className={`button button-secondary${kind === option ? ' is-active' : ''}`}
                aria-pressed={kind === option}
                data-testid={`session-setup-kind-${option}`}
                onClick={() => {
                  setKind(option)
                  setSaveError(null)
                }}
              >
                {option === 'practice' ? 'Practice' : 'Competition'}
              </button>
            ))}
          </div>
        </div>

        <div className="settings-field">
          <span>Round format</span>
          <Select
            className="compact-select"
            value={formatId}
            ariaLabel="Competition round format"
            testId="session-setup-format"
            disabled={kind !== 'competition'}
            options={COMPETITION_FORMATS.map((format) => ({
              value: format.id,
              label: format.label,
              text: format.description,
            }))}
            onChange={(value) => {
              setFormatId(value as CompetitionFormatId)
              setSaveError(null)
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
