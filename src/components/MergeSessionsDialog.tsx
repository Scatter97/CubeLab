import { useMemo, useState } from 'react'
import { useModalDialog } from '../hooks/useModalDialog'
import type { Session, SessionsData } from '../types'
import {
  getSessionDisplayNames,
  normalizeSessionName,
} from '../lib/sessions'
import { getEventLabel } from '../lib/events'
import { formatSolveCount } from '../lib/format'
import { CloseIcon } from './Icons'
import { Select } from './Select'

interface MergeSessionsDialogProps {
  open: boolean
  sessions: SessionsData
  initialTargetId?: string
  onClose: () => void
  onMerge: (sourceIds: readonly string[], targetId: string) => boolean
}

type MergeSessionsContentProps = Omit<MergeSessionsDialogProps, 'open'>

function sessionKey(session: Session): string {
  return normalizeSessionName(session.name).toLowerCase()
}

function duplicateGroups(sessions: SessionsData) {
  const groups = new Map<string, Session[]>()
  for (const session of sessions.sessions) {
    const key = sessionKey(session)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)?.push(session)
  }
  return [...groups.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([name, group]) => ({ name, sessions: group }))
}

function eventOf(session: Session): string {
  return session.event ?? '333'
}

function compatibleSource(source: Session, target: Session): boolean {
  const targetEvent = eventOf(target)
  return (
    eventOf(source) === targetEvent &&
    [...source.solves, ...target.solves].every(
      (solve) => solve.event === targetEvent,
    )
  )
}

/**
 * The dialog shell owns the native modal lifecycle. Its body is mounted only
 * while open, so a previously typed confirmation can never survive a close and
 * silently authorise a later destructive merge.
 */
export function MergeSessionsDialog({
  open,
  sessions,
  initialTargetId,
  onClose,
  onMerge,
}: MergeSessionsDialogProps) {
  const { dialogRef, handleKeyDown } = useModalDialog(open)

  return (
    <dialog
      ref={dialogRef}
      className="confirm-dialog settings-dialog merge-sessions-dialog"
      aria-labelledby="merge-sessions-title"
      aria-describedby="merge-sessions-description"
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
        <MergeSessionsContent
          sessions={sessions}
          initialTargetId={initialTargetId}
          onClose={onClose}
          onMerge={onMerge}
        />
      ) : null}
    </dialog>
  )
}

function MergeSessionsContent({
  sessions,
  initialTargetId,
  onClose,
  onMerge,
}: MergeSessionsContentProps) {
  const groups = useMemo(() => duplicateGroups(sessions), [sessions])
  const displayNames = useMemo(
    () => getSessionDisplayNames(sessions.sessions),
    [sessions.sessions],
  )
  const displayNameById = useMemo(
    () =>
      new Map(
        sessions.sessions.map((session, index) => [
          session.id,
          displayNames[index] ?? session.name,
        ]),
      ),
    [displayNames, sessions.sessions],
  )

  const firstPair = groups[0]
  const requestedTarget =
    initialTargetId &&
    sessions.sessions.some((session) => session.id === initialTargetId)
      ? initialTargetId
      : null
  const fallbackTarget =
    firstPair?.sessions[0]?.id ??
    (sessions.sessions.some(
      (session) => session.id === sessions.activeSessionId,
    )
      ? sessions.activeSessionId
      : sessions.sessions[0]?.id) ??
    ''
  const [targetId, setTargetId] = useState(requestedTarget ?? fallbackTarget)
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>(() => {
    if (requestedTarget || !firstPair) return []
    return firstPair.sessions
      .filter((session) => session.id !== (firstPair.sessions[0]?.id ?? ''))
      .map((session) => session.id)
  })
  const [phrase, setPhrase] = useState('')
  const [error, setError] = useState<string | null>(null)

  const target =
    sessions.sessions.find((session) => session.id === targetId) ?? null
  const selectedSources = sessions.sessions.filter((session) =>
    selectedSourceIds.includes(session.id),
  )
  const compatibleSessions = target
    ? sessions.sessions.filter(
        (session) =>
          session.id !== target.id && compatibleSource(session, target),
      )
    : []
  const canPreview =
    target !== null &&
    selectedSources.length > 0 &&
    selectedSources.every((source) => compatibleSource(source, target))
  const mergedSolveIds = new Set([
    ...(target?.solves ?? []).map((solve) => solve.id),
    ...selectedSources.flatMap((session) =>
      session.solves.map((solve) => solve.id),
    ),
  ])
  const selectedSolveCount = selectedSources.reduce(
    (total, session) => total + session.solves.length,
    0,
  )
  const approved = phrase === 'MERGE SESSIONS'
  const canSubmit = canPreview && approved

  const clearConfirmation = () => {
    setPhrase('')
    setError(null)
  }

  const changeTarget = (value: string) => {
    const nextTarget = sessions.sessions.find(
      (session) => session.id === value,
    )
    setTargetId(value)
    setSelectedSourceIds((current) =>
      current.filter((id) => {
        const source = sessions.sessions.find((session) => session.id === id)
        return (
          source !== undefined &&
          nextTarget !== undefined &&
          source.id !== nextTarget.id &&
          compatibleSource(source, nextTarget)
        )
      }),
    )
    clearConfirmation()
  }

  const toggleSource = (id: string, checked: boolean) => {
    setSelectedSourceIds((current) =>
      checked
        ? [...new Set([...current, id])]
        : current.filter((sourceId) => sourceId !== id),
    )
    clearConfirmation()
  }

  const labelFor = (session: Session) =>
    displayNameById.get(session.id) ?? session.name

  return (
    <div className="dialog-content settings-content">
      <header className="settings-header">
        <div>
          <h2 id="merge-sessions-title">Merge sessions</h2>
        </div>
        <button
          type="button"
          className="icon-button settings-close"
          aria-label="Close merge sessions"
          onClick={onClose}
        >
          <CloseIcon size={16} />
        </button>
      </header>

      <p id="merge-sessions-description" className="settings-intro">
        Choose one destination and one or more source sessions. The destination
        keeps its name, event, settings, and active selection. Every source solve
        moves into it, then the source sessions are removed. Name matching alone
        never merges sessions automatically.
      </p>

      <div className="settings-body merge-sessions-body">
        {groups.map((group) => (
          <p key={group.name} className="settings-note">
            Found {group.sessions.length} separate sessions named &ldquo;
            {normalizeSessionName(group.sessions[0]!.name)}&rdquo;.
          </p>
        ))}

        {sessions.sessions.length <= 1 ? (
          <p className="settings-note">
            Create another session before merging. At least one destination and
            one source are required.
          </p>
        ) : null}

        {target ? (
          <>
            <div className="settings-field">
              <label htmlFor="merge-destination-select">Destination session</label>
              <Select
                id="merge-destination-select"
                ariaLabel="Destination session"
                className="compact-select"
                value={target.id}
                testId="merge-destination"
                options={sessions.sessions.map((session) => ({
                  value: session.id,
                  label: `${labelFor(session)} · ${getEventLabel(eventOf(session))} · ${formatSolveCount(session.solves.length)}`,
                  text: labelFor(session),
                }))}
                onChange={changeTarget}
              />
            </div>

            <fieldset className="settings-fieldset merge-source-fieldset">
              <legend>Source sessions</legend>
              <p className="settings-row-description">
                Only sessions using {getEventLabel(eventOf(target))} can be
                selected. Different events are disabled because merging them
                would mix statistics, personal bests, and scramble histories.
              </p>
              <div className="merge-source-actions">
                <button
                  type="button"
                  className="button button-secondary button-small"
                  data-testid="merge-select-all"
                  disabled={compatibleSessions.length === 0}
                  onClick={() => {
                    setSelectedSourceIds(
                      compatibleSessions.map((session) => session.id),
                    )
                    clearConfirmation()
                  }}
                >
                  Select all compatible
                </button>
                <button
                  type="button"
                  className="button button-secondary button-small"
                  data-testid="merge-select-none"
                  disabled={selectedSourceIds.length === 0}
                  onClick={() => {
                    setSelectedSourceIds([])
                    clearConfirmation()
                  }}
                >
                  Select none
                </button>
              </div>
              <div
                className="merge-source-list"
                data-testid="merge-source-list"
              >
                {sessions.sessions
                  .filter((session) => session.id !== target.id)
                  .map((session) => {
                    const compatible = compatibleSource(session, target)
                    const selected = selectedSourceIds.includes(session.id)
                    return (
                      <label
                        key={session.id}
                        className={`merge-source-row${compatible ? '' : ' is-disabled'}${selected ? ' is-selected' : ''}`}
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          disabled={!compatible}
                          data-testid={`merge-source-${session.id}`}
                          onChange={(event) =>
                            toggleSource(session.id, event.target.checked)
                          }
                        />
                        <span className="merge-source-copy">
                          <span className="merge-source-name">
                            {labelFor(session)}
                          </span>
                          <span className="merge-source-meta">
                            {getEventLabel(eventOf(session))} ·{' '}
                            {formatSolveCount(session.solves.length)}
                          </span>
                          {!compatible ? (
                            <span className="merge-source-reason">
                              Uses a different event, so it cannot be merged.
                            </span>
                          ) : null}
                        </span>
                      </label>
                    )
                  })}
              </div>
            </fieldset>

            {canPreview ? (
              <section
                className="merge-preview"
                data-testid="merge-preview"
                aria-label="Merge preview"
              >
                <h3>Preview</h3>
                <div className="merge-preview-destination">
                  <span>Destination</span>
                  <strong>{labelFor(target)}</strong>
                  <span>
                    {getEventLabel(eventOf(target))} ·{' '}
                    {formatSolveCount(target.solves.length)}
                  </span>
                </div>
                <div className="settings-facts">
                  <div>
                    <span>Destination solves</span>
                    <strong>{target.solves.length}</strong>
                  </div>
                  <div>
                    <span>Sources removed</span>
                    <strong>{selectedSources.length}</strong>
                  </div>
                  <div>
                    <span>Source solves moved</span>
                    <strong>{selectedSolveCount}</strong>
                  </div>
                  <div>
                    <span>After merge</span>
                    <strong>{mergedSolveIds.size}</strong>
                  </div>
                  <div>
                    <span>Event</span>
                    <strong>{getEventLabel(eventOf(target))}</strong>
                  </div>
                </div>
                <p className="settings-note">
                  Moving:{' '}
                  {selectedSources
                    .map(
                      (session) =>
                        `${labelFor(session)} (${formatSolveCount(session.solves.length)})`,
                    )
                    .join(', ')}
                  . Source sessions and their empty containers are removed only
                  after all solves are placed in the destination. The
                  destination becomes active.
                </p>
              </section>
            ) : null}

            {selectedSources.some(
              (session) => session.solves.length === 0,
            ) ? (
              <p className="settings-note">
                Empty source sessions contain no solves and will be removed by
                the merge.
              </p>
            ) : null}

            <div className="settings-field">
              <label htmlFor="merge-phrase">Typed confirmation</label>
              <p className="settings-row-description">
                Type <strong>MERGE SESSIONS</strong> to confirm. This cannot be
                undone without a previous backup.
              </p>
              <input
                id="merge-phrase"
                type="text"
                placeholder="MERGE SESSIONS"
                value={phrase}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => {
                  setPhrase(event.target.value)
                  setError(null)
                }}
                disabled={!canPreview}
              />
            </div>
          </>
        ) : (
          <p className="settings-note">No sessions are available to merge.</p>
        )}

        {error ? (
          <p className="settings-error" role="alert" data-testid="merge-error">
            {error}
          </p>
        ) : null}
      </div>

      <footer className="settings-footer">
        <span className="settings-footer-note">
          Cancel leaves every session unchanged.
        </span>
        <button
          type="button"
          className="button button-secondary"
          aria-label="Cancel merge"
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          type="button"
          className="button button-primary"
          aria-label="Confirm merge"
          disabled={!canSubmit}
          onClick={() => {
            if (!canSubmit) return
            setError(null)
            if (
              onMerge(
                selectedSources.map((session) => session.id),
                targetId,
              )
            ) {
              onClose()
            } else {
              setError(
                'Could not merge these sessions. Nothing was removed; check storage and try again.',
              )
            }
          }}
        >
          Merge sessions
        </button>
      </footer>
    </div>
  )
}
