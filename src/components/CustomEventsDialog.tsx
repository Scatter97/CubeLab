import { useMemo, useState } from 'react'
import type { CustomEventDefinition, PuzzleEvent, Session } from '../types'
import { useModalDialog } from '../hooks/useModalDialog'
import { formatSolveCount } from '../lib/format'
import {
  MAX_CUSTOM_EVENT_NAME_LENGTH,
  MAX_CUSTOM_EVENT_PLACEHOLDER_LENGTH,
  getCustomEventNameError,
  getCustomEventPlaceholderError,
} from '../lib/customEvents'
import {
  formatEventOptionLabel,
  getEventLabel,
  getEventOptions,
} from '../lib/events'
import { CloseIcon } from './Icons'
import { Select } from './Select'

interface CustomEventsDialogProps {
  open: boolean
  customEvents: readonly CustomEventDefinition[]
  sessions: readonly Session[]
  correctionCount: number
  onCreate: (name: string, placeholder?: string) => string | null
  onRename: (id: string, name: string) => boolean
  onSetPlaceholder: (id: string, placeholder: string) => boolean
  onDelete: (id: string) => { ok: true } | { ok: false; error: string }
  onReassignSessions: (sessionIds: readonly string[], event: PuzzleEvent) => boolean
  onCorrectImported: () => number
  onClose: () => void
}

interface CustomEventRowProps {
  definition: CustomEventDefinition
  onRename: (id: string, name: string) => boolean
  onSetPlaceholder: (id: string, placeholder: string) => boolean
  onDelete: (id: string) => { ok: true } | { ok: false; error: string }
  onError: (message: string | null) => void
  definitions: readonly CustomEventDefinition[]
}

function CustomEventRow({
  definition,
  definitions,
  onRename,
  onSetPlaceholder,
  onDelete,
  onError,
}: CustomEventRowProps) {
  const [name, setName] = useState(definition.name)
  const [placeholder, setPlaceholder] = useState(definition.placeholder)
  const [rowError, setRowError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const save = () => {
    const nameError = getCustomEventNameError(name, definitions, definition.id)
    if (nameError) {
      setRowError(nameError)
      return
    }
    const placeholderError = getCustomEventPlaceholderError(placeholder)
    if (placeholderError) {
      setRowError(placeholderError)
      return
    }
    if (!onRename(definition.id, name)) {
      setRowError('Could not rename the event.')
      return
    }
    if (!onSetPlaceholder(definition.id, placeholder)) {
      setRowError('Could not save the placeholder.')
      return
    }
    setRowError(null)
    setSaved(true)
    window.setTimeout(() => setSaved(false), 1500)
  }

  return (
    <li className="custom-event-row" data-testid="custom-event-row">
      <div className="custom-event-fields">
        <label>
          <span>Name</span>
          <input
            type="text"
            value={name}
            maxLength={MAX_CUSTOM_EVENT_NAME_LENGTH}
            onChange={(event) => {
              setName(event.target.value)
              setRowError(null)
              setSaved(false)
            }}
            aria-label={`Name for ${definition.name}`}
          />
        </label>
        <label>
          <span>Scramble placeholder</span>
          <input
            type="text"
            value={placeholder}
            maxLength={MAX_CUSTOM_EVENT_PLACEHOLDER_LENGTH}
            placeholder="No scramble for this event"
            onChange={(event) => {
              setPlaceholder(event.target.value)
              setRowError(null)
              setSaved(false)
            }}
            aria-label={`Scramble placeholder for ${definition.name}`}
          />
        </label>
      </div>
      <div className="custom-event-actions">
        <button type="button" className="button button-secondary button-small" onClick={save}>
          {saved ? 'Saved' : 'Save'}
        </button>
        <button
          type="button"
          className="button button-danger button-small"
          onClick={() => {
            const result = onDelete(definition.id)
            if (!result.ok) {
              setRowError(result.error)
              onError(result.error)
            }
          }}
        >
          Delete
        </button>
      </div>
      {rowError ? (
        <p className="settings-error" role="alert">
          {rowError}
        </p>
      ) : null}
    </li>
  )
}

export function CustomEventsDialog({
  open,
  customEvents,
  sessions,
  correctionCount,
  onCreate,
  onRename,
  onSetPlaceholder,
  onDelete,
  onReassignSessions,
  onCorrectImported,
  onClose,
}: CustomEventsDialogProps) {
  const { dialogRef, handleKeyDown } = useModalDialog(open)

  return (
    <dialog
      ref={dialogRef}
      className="confirm-dialog custom-events-dialog"
      aria-labelledby="custom-events-title"
      aria-describedby="custom-events-description"
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
        <CustomEventsContent
          customEvents={customEvents}
          sessions={sessions}
          correctionCount={correctionCount}
          onCreate={onCreate}
          onRename={onRename}
          onSetPlaceholder={onSetPlaceholder}
          onDelete={onDelete}
          onReassignSessions={onReassignSessions}
          onCorrectImported={onCorrectImported}
          onClose={onClose}
        />
      ) : null}
    </dialog>
  )
}

function CustomEventsContent({
  customEvents,
  sessions,
  correctionCount,
  onCreate,
  onRename,
  onSetPlaceholder,
  onDelete,
  onReassignSessions,
  onCorrectImported,
  onClose,
}: Omit<CustomEventsDialogProps, 'open'>) {
  const [name, setName] = useState('')
  const [placeholder, setPlaceholder] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [sourceEvent, setSourceEvent] = useState('')
  const [targetEvent, setTargetEvent] = useState('333')
  const [selectedSessions, setSelectedSessions] = useState<ReadonlySet<string>>(
    () => new Set(),
  )
  const [confirmingReassign, setConfirmingReassign] = useState(false)

  const options = getEventOptions()
  const sourceOptions = useMemo(() => {
    const counts = new Map<string, number>()
    for (const session of sessions) {
      const event = session.event ?? '333'
      counts.set(event, (counts.get(event) ?? 0) + 1)
    }
    return options.filter((option) => counts.has(option.id))
  }, [options, sessions])
  const effectiveSource = sourceOptions.some((option) => option.id === sourceEvent)
    ? sourceEvent
    : sourceOptions[0]?.id ?? ''
  const sourceSessions = sessions.filter(
    (session) => (session.event ?? '333') === effectiveSource,
  )
  const selectedSolveCount = sourceSessions
    .filter((session) => selectedSessions.has(session.id))
    .reduce((total, session) => total + session.solves.length, 0)

  const create = () => {
    const nameError = getCustomEventNameError(name, customEvents)
    if (nameError) {
      setError(nameError)
      return
    }
    const placeholderError = getCustomEventPlaceholderError(placeholder)
    if (placeholderError) {
      setError(placeholderError)
      return
    }
    const id = onCreate(name, placeholder)
    if (!id) {
      setError('Could not create the custom event.')
      return
    }
    setName('')
    setPlaceholder('')
    setError(null)
    setStatus(`Created ${getEventLabel(id)}.`)
  }

  const reassign = () => {
    if (selectedSessions.size === 0) return
    if (!onReassignSessions([...selectedSessions], targetEvent)) {
      setError('Could not reassign those sessions.')
      return
    }
    setStatus(
      `Reassigned ${selectedSessions.size} session${selectedSessions.size === 1 ? '' : 's'} to ${getEventLabel(targetEvent)}.`,
    )
    setSelectedSessions(new Set())
    setConfirmingReassign(false)
    setError(null)
  }

  return (
    <div className="dialog-content custom-events-content">
      <header className="settings-header">
        <div>
          <span className="eyebrow">Events</span>
          <h2 id="custom-events-title">Custom events</h2>
          <p id="custom-events-description" className="session-settings-meta">
            Record puzzles that have no official scramble generator. Times,
            sessions, statistics, Analytics and personal bests stay separate.
          </p>
        </div>
        <button
          type="button"
          className="icon-button settings-close"
          aria-label="Close custom events"
          title="Close custom events"
          onClick={onClose}
        >
          <CloseIcon size={16} />
        </button>
      </header>

      <div className="custom-events-body">
        {error ? (
          <p className="settings-error" role="alert" data-testid="custom-event-error">
            {error}
          </p>
        ) : null}
        {status ? (
          <p className="settings-note" role="status" data-testid="custom-event-status">
            {status}
          </p>
        ) : null}

        <section aria-labelledby="create-custom-event-title">
          <h3 id="create-custom-event-title">Create custom event</h3>
          <div className="custom-event-create">
            <label>
              <span>Name</span>
              <input
                type="text"
                value={name}
                maxLength={MAX_CUSTOM_EVENT_NAME_LENGTH}
                placeholder="e.g. FTO"
                onChange={(event) => {
                  setName(event.target.value)
                  setError(null)
                }}
                data-testid="custom-event-name"
              />
            </label>
            <label>
              <span>Scramble placeholder (optional)</span>
              <input
                type="text"
                value={placeholder}
                maxLength={MAX_CUSTOM_EVENT_PLACEHOLDER_LENGTH}
                placeholder="No scramble for this event"
                onChange={(event) => {
                  setPlaceholder(event.target.value)
                  setError(null)
                }}
                data-testid="custom-event-placeholder"
              />
            </label>
            <button
              type="button"
              className="button button-primary"
              onClick={create}
              data-testid="create-custom-event"
            >
              Create custom event
            </button>
          </div>
        </section>

        <section aria-labelledby="custom-event-list-title">
          <h3 id="custom-event-list-title">Your custom events</h3>
          {customEvents.length === 0 ? (
            <p className="settings-note">No custom events yet.</p>
          ) : (
            <ul className="custom-event-list">
              {customEvents.map((definition) => (
                <CustomEventRow
                  key={definition.id}
                  definition={definition}
                  definitions={customEvents}
                  onRename={onRename}
                  onSetPlaceholder={onSetPlaceholder}
                  onDelete={onDelete}
                  onError={setError}
                />
              ))}
            </ul>
          )}
        </section>

        {correctionCount > 0 ? (
          <section aria-labelledby="custom-event-correction-title">
            <h3 id="custom-event-correction-title">Imported solve correction</h3>
            <p className="settings-row-description">
              {correctionCount} imported {correctionCount === 1 ? 'solve has' : 'solves have'} original
              csTimer metadata that maps to a different event. Correcting only
              changes the event; times, dates, penalties, comments and scrambles
              stay intact.
            </p>
            <button
              type="button"
              className="button button-secondary"
              data-testid="correct-imported-events"
              onClick={() => {
                const moved = onCorrectImported()
                setStatus(
                  moved > 0
                    ? `Corrected ${moved} imported solve${moved === 1 ? '' : 's'}.`
                    : 'No imported solves needed correction.',
                )
              }}
            >
              Correct {correctionCount} imported {correctionCount === 1 ? 'solve' : 'solves'} automatically
            </button>
          </section>
        ) : null}

        <section aria-labelledby="custom-event-reassign-title">
          <h3 id="custom-event-reassign-title">Reassign sessions</h3>
          <p className="settings-row-description">
            Move whole sessions between events after an incorrect import. This
            preserves every solve time, timestamp, penalty, comment and scramble.
          </p>
          <div className="custom-event-reassign">
            <label>
              <span>Source event</span>
              <Select
                testId="custom-event-source"
                value={effectiveSource}
                options={sourceOptions.map((option) => ({
                  value: option.id,
                  label: formatEventOptionLabel(option),
                  text: option.label,
                }))}
                onChange={(value) => {
                  setSourceEvent(value)
                  setSelectedSessions(new Set())
                  setConfirmingReassign(false)
                }}
              />
            </label>
            <label>
              <span>Target event</span>
              <Select
                testId="custom-event-target"
                value={targetEvent}
                options={options.map((option) => ({
                  value: option.id,
                  label: formatEventOptionLabel(option),
                  text: option.label,
                }))}
                onChange={(value) => {
                  setTargetEvent(value)
                  setConfirmingReassign(false)
                }}
              />
            </label>
          </div>

          {sourceSessions.length === 0 ? (
            <p className="settings-note">No sessions use that event.</p>
          ) : (
            <ul className="custom-event-session-list">
              {sourceSessions.map((session) => (
                <li key={session.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={selectedSessions.has(session.id)}
                      onChange={(event) => {
                        const next = new Set(selectedSessions)
                        if (event.target.checked) next.add(session.id)
                        else next.delete(session.id)
                        setSelectedSessions(next)
                        setConfirmingReassign(false)
                      }}
                    />
                    <span>
                      {session.name} · {formatSolveCount(session.solves.length)}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}

          {confirmingReassign ? (
            <div className="custom-event-confirm" role="alert">
              <p>
                Move {selectedSessions.size} session
                {selectedSessions.size === 1 ? '' : 's'} and{' '}
                {formatSolveCount(selectedSolveCount)} from{' '}
                {getEventLabel(effectiveSource)} to {getEventLabel(targetEvent)}?
              </p>
              <button
                type="button"
                className="button button-primary"
                data-testid="confirm-reassign-sessions"
                onClick={reassign}
              >
                Confirm reassignment
              </button>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => setConfirmingReassign(false)}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="button button-secondary"
              disabled={selectedSessions.size === 0 || effectiveSource === targetEvent}
              data-testid="reassign-sessions"
              onClick={() => setConfirmingReassign(true)}
            >
              Reassign selected sessions
            </button>
          )}
        </section>
      </div>

      <footer className="session-settings-footer">
        <span>Custom event definitions sync with your sessions.</span>
        <button type="button" className="button button-primary" onClick={onClose}>
          Done
        </button>
      </footer>
    </div>
  )
}
