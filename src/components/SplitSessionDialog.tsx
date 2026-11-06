import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useModalDialog } from '../hooks/useModalDialog'
import type { Session, Solve } from '../types'
import {
  MAX_SESSION_NAME_LENGTH,
  getSessionNameError,
  normalizeSessionName,
  resolveUniqueSessionNames,
} from '../lib/sessions'
import { getEventLabel } from '../lib/events'
import { formatSolveCount, formatSolveTime } from '../lib/format'
import { CloseIcon } from './Icons'

interface SplitSessionDialogProps {
  open: boolean
  session: Session | null
  sessions: readonly Session[]
  onClose: () => void
  onSplit: (name: string, solveIds: readonly string[]) => string | null
}

type SplitSessionContentProps = Omit<SplitSessionDialogProps, 'open' | 'session'> & {
  session: Session
}

const VIRTUALIZE_THRESHOLD = 200
const ROW_HEIGHT = 54
const WINDOW_OVERSCAN_PX = 260
const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
})

function solveDate(timestamp: number): string {
  return dateFormatter.format(timestamp)
}

function solveResult(solve: Solve): string {
  const result = formatSolveTime(solve.rawMs, solve.penalty)
  return `${result.display}${result.suffix ?? ''}`
}

function defaultSplitName(session: Session, sessions: readonly Session[]): string {
  return resolveUniqueSessionNames(
    [`${session.name} (split)`],
    sessions.map((entry) => entry.name),
  )[0]!
}

/**
 * The shell owns the native modal lifecycle. Its body is mounted only while
 * open so a previous selection or confirmation can never survive a cancel.
 */
export function SplitSessionDialog({
  open,
  session,
  sessions,
  onClose,
  onSplit,
}: SplitSessionDialogProps) {
  const { dialogRef, handleKeyDown } = useModalDialog(open)

  return (
    <dialog
      ref={dialogRef}
      className="confirm-dialog settings-dialog split-session-dialog"
      aria-labelledby="split-session-title"
      aria-describedby="split-session-description"
      onKeyDown={handleKeyDown}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose()
      }}
    >
      {open && session ? (
        <SplitSessionContent
          key={session.id}
          session={session}
          sessions={sessions}
          onClose={onClose}
          onSplit={onSplit}
        />
      ) : null}
    </dialog>
  )
}

function SplitSessionContent({
  session,
  sessions,
  onClose,
  onSplit,
}: SplitSessionContentProps) {
  const solves = session.solves
  const listRef = useRef<HTMLDivElement>(null)
  const [name, setName] = useState(() => defaultSplitName(session, sessions))
  const [nameError, setNameError] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [phrase, setPhrase] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [rangeStart, setRangeStart] = useState('1')
  const [rangeEnd, setRangeEnd] = useState(String(Math.max(1, solves.length)))
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(320)
  const lastToggledIndexRef = useRef<number | null>(null)

  const virtualized = solves.length > VIRTUALIZE_THRESHOLD
  const start = virtualized
    ? Math.max(
        0,
        Math.floor((scrollTop - WINDOW_OVERSCAN_PX) / ROW_HEIGHT),
      )
    : 0
  const end = virtualized
    ? Math.min(
        solves.length,
        Math.ceil(
          (scrollTop + viewportHeight + WINDOW_OVERSCAN_PX) / ROW_HEIGHT,
        ),
      )
    : solves.length
  const topSpacer = virtualized ? start * ROW_HEIGHT : 0
  const bottomSpacer = virtualized ? (solves.length - end) * ROW_HEIGHT : 0

  useEffect(() => {
    const element = listRef.current
    if (!element) return
    const update = () => setViewportHeight(element.clientHeight)
    update()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update)
      return () => window.removeEventListener('resize', update)
    }
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const selectedCount = selectedIds.size
  const remainingCount = solves.length - selectedCount
  const allSelected = solves.length > 0 && selectedCount === solves.length
  const noneSelected = selectedCount === 0
  const canSubmit = selectedCount > 0 && phrase === 'SPLIT SESSION'

  const updateSelection = (next: Set<string>) => {
    setSelectedIds(next)
    setError(null)
  }

  const toggleSolve = (
    solveId: string,
    index: number,
    checked: boolean,
    shiftKey: boolean,
  ) => {
    const next = new Set(selectedIds)
    const previous = lastToggledIndexRef.current
    if (shiftKey && previous !== null) {
      const from = Math.min(previous, index)
      const to = Math.max(previous, index)
      for (let cursor = from; cursor <= to; cursor += 1) {
        const solve = solves[cursor]
        if (!solve) continue
        if (checked) next.add(solve.id)
        else next.delete(solve.id)
      }
    } else if (checked) {
      next.add(solveId)
    } else {
      next.delete(solveId)
    }
    lastToggledIndexRef.current = index
    updateSelection(next)
  }

  const handleSolveChange = (
    index: number,
    solveId: string,
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const native = event.nativeEvent as MouseEvent
    toggleSolve(solveId, index, event.target.checked, Boolean(native.shiftKey))
  }

  const selectRange = () => {
    const from = Number(rangeStart)
    const to = Number(rangeEnd)
    if (
      !Number.isInteger(from) ||
      !Number.isInteger(to) ||
      from < 1 ||
      to < 1 ||
      from > solves.length ||
      to > solves.length
    ) {
      setError(
        `Enter whole positions between 1 and ${solves.length.toLocaleString()}.`,
      )
      return
    }
    const first = Math.min(from, to)
    const last = Math.max(from, to)
    const next = new Set(selectedIds)
    for (let index = first - 1; index < last; index += 1) {
      const solve = solves[index]
      if (solve) next.add(solve.id)
    }
    lastToggledIndexRef.current = last - 1
    updateSelection(next)
  }

  const selectedSolves = solves.filter((solve) => selectedIds.has(solve.id))
  const selectedSolveIds = selectedSolves.map((solve) => solve.id)
  const effectiveName = normalizeSessionName(name)

  const handleSubmit = () => {
    if (!canSubmit) return
    const validationError = getSessionNameError(name, sessions)
    if (validationError) {
      setNameError(validationError)
      return
    }
    setError(null)
    const createdId = onSplit(effectiveName, selectedSolveIds)
    if (!createdId) {
      setError('Could not split this session. Nothing was moved.')
      return
    }
    onClose()
  }

  return (
    <div className="dialog-content settings-content split-session-content">
      <header className="settings-header">
        <div>
          <h2 id="split-session-title">Move solves to a new session</h2>
        </div>
        <button
          type="button"
          className="icon-button settings-close"
          aria-label="Close split session"
          onClick={onClose}
        >
          <CloseIcon size={16} />
        </button>
      </header>

      <p id="split-session-description" className="settings-intro">
        Move selected solves from <strong>{session.name}</strong> into a new
        session. The new session copies this session&apos;s event and per-session
        settings. The source session stays in place even when every solve moves.
      </p>

      <div className="settings-body split-session-body">
        <div className="settings-field">
          <label htmlFor="split-session-name">New session name</label>
          <p className="settings-row-description">
            Unique within this browser, up to {MAX_SESSION_NAME_LENGTH}{' '}
            characters.
          </p>
          <input
            id="split-session-name"
            type="text"
            autoFocus
            maxLength={MAX_SESSION_NAME_LENGTH}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? 'split-name-error' : undefined}
            data-testid="split-session-name"
            value={name}
            onChange={(event) => {
              setName(event.target.value)
              setNameError(null)
              setError(null)
            }}
            onBlur={() => {
              const validationError = getSessionNameError(name, sessions)
              if (validationError) {
                setNameError(validationError)
              } else {
                setName(normalizeSessionName(name))
              }
            }}
          />
          {nameError ? (
            <p
              id="split-name-error"
              className="settings-error"
              role="alert"
            >
              {nameError}
            </p>
          ) : null}
        </div>

        <section className="split-selection" aria-labelledby="split-selection-title">
          <div className="split-selection-header">
            <div>
              <h3 id="split-selection-title">Select solves to move</h3>
              <p className="settings-row-description">
                Choose individual solves, Shift-click for a range, or use the
                position controls. List position 1 is the newest solve.
              </p>
            </div>
            <p
              className="split-selection-count"
              role="status"
              aria-live="polite"
              data-testid="split-selection-count"
            >
              {selectedCount.toLocaleString()} of{' '}
              {solves.length.toLocaleString()} selected ·{' '}
              {remainingCount.toLocaleString()} remaining
            </p>
          </div>

          <div className="split-selection-actions">
            <button
              type="button"
              className="button button-secondary button-small"
              data-testid="split-select-all"
              disabled={allSelected}
              onClick={() =>
                updateSelection(new Set(solves.map((solve) => solve.id)))
              }
            >
              Select all
            </button>
            <button
              type="button"
              className="button button-secondary button-small"
              data-testid="split-select-none"
              disabled={noneSelected}
              onClick={() => updateSelection(new Set())}
            >
              Select none
            </button>
          </div>

          <div className="split-range-controls">
            <label>
              <span>From position</span>
              <input
                type="number"
                min={1}
                max={solves.length}
                inputMode="numeric"
                data-testid="split-range-start"
                value={rangeStart}
                onChange={(event) => setRangeStart(event.target.value)}
              />
            </label>
            <label>
              <span>To position</span>
              <input
                type="number"
                min={1}
                max={solves.length}
                inputMode="numeric"
                data-testid="split-range-end"
                value={rangeEnd}
                onChange={(event) => setRangeEnd(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="button button-secondary button-small"
              data-testid="split-select-range"
              onClick={selectRange}
            >
              Add range
            </button>
          </div>

          <div
            ref={listRef}
            className="split-solve-list"
            data-testid="split-solve-list"
            onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
          >
            <ul className="split-solve-list-inner">
              {topSpacer > 0 ? (
                <li
                  aria-hidden="true"
                  className="split-solve-spacer"
                  style={{ height: topSpacer }}
                />
              ) : null}
              {solves.slice(start, end).map((solve, offset) => {
                const index = start + offset
                const selected = selectedIds.has(solve.id)
                return (
                  <li
                    key={solve.id}
                    className={`split-solve-row${selected ? ' is-selected' : ''}`}
                    style={virtualized ? { height: ROW_HEIGHT } : undefined}
                  >
                    <label>
                      <input
                        type="checkbox"
                        checked={selected}
                        data-testid={`split-solve-${index}`}
                        onChange={(event) =>
                          handleSolveChange(index, solve.id, event)
                        }
                      />
                      <span className="split-solve-copy">
                        <span className="split-solve-main">
                          <span className="split-solve-number">
                            #{solves.length - index}
                          </span>
                          <strong>{solveResult(solve)}</strong>
                          <span className="split-solve-date">
                            {solveDate(solve.createdAt)}
                          </span>
                        </span>
                        {solve.comment ? (
                          <span className="split-solve-comment">
                            {solve.comment}
                          </span>
                        ) : null}
                      </span>
                    </label>
                  </li>
                )
              })}
              {bottomSpacer > 0 ? (
                <li
                  aria-hidden="true"
                  className="split-solve-spacer"
                  style={{ height: bottomSpacer }}
                />
              ) : null}
            </ul>
          </div>
          {virtualized ? (
            <p className="settings-note">
              This long list renders only nearby rows for responsiveness.
              Selection still covers every solve, including off-screen rows.
            </p>
          ) : null}
        </section>

        <section
          className="split-preview"
          data-testid="split-preview"
          aria-label="Split preview"
        >
          <h3>Preview</h3>
          <div className="split-preview-source">
            <span>Source session</span>
            <strong>{session.name}</strong>
            <span>
              {getEventLabel(session.event ?? '333')} ·{' '}
              {formatSolveCount(solves.length)}
            </span>
          </div>
          <div className="settings-facts">
            <div>
              <span>Moving</span>
              <strong>{selectedCount}</strong>
            </div>
            <div>
              <span>Staying in source</span>
              <strong>{remainingCount}</strong>
            </div>
            <div>
              <span>New session</span>
              <strong>{effectiveName || '—'}</strong>
            </div>
            <div>
              <span>Event</span>
              <strong>{getEventLabel(session.event ?? '333')}</strong>
            </div>
          </div>
          <p className="settings-note">
            The new session is inserted directly after {session.name} and becomes
            active. {session.name} remains even if all solves move. Solve IDs,
            times, penalties, scrambles, comments, dates, and import provenance
            are preserved. This cannot be undone without a previous backup.
          </p>
        </section>

        <div className="settings-field">
          <label htmlFor="split-phrase">Typed confirmation</label>
          <p className="settings-row-description">
            Type <strong>SPLIT SESSION</strong> to confirm the move.
          </p>
          <input
            id="split-phrase"
            type="text"
            placeholder="SPLIT SESSION"
            value={phrase}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              setPhrase(event.target.value)
              setError(null)
            }}
          />
        </div>

        {error ? (
          <p className="settings-error" role="alert" data-testid="split-error">
            {error}
          </p>
        ) : null}
      </div>

      <footer className="settings-footer">
        <span className="settings-footer-note">
          Cancel leaves {selectedCount > 0 ? 'the source and selection' : 'this session'} unchanged.
        </span>
        <button
          type="button"
          className="button button-secondary"
          aria-label="Cancel split"
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          type="button"
          className="button button-primary"
          aria-label="Confirm split"
          disabled={!canSubmit}
          onClick={handleSubmit}
        >
          Split session
        </button>
      </footer>
    </div>
  )
}
