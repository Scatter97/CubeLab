import { memo, useEffect, useRef } from 'react'
import type { Penalty, Solve } from '../types'
import {
  formatEffectiveSolveTime,
  formatRelativeTime,
  formatSolveTime,
  formatTime,
} from '../lib/format'
import { CubeMark, TrashIcon } from './Icons'

interface SolveHistoryProps {
  solves: readonly Solve[]
  onSetPenalty: (id: string, penalty: Penalty) => void
  onDelete: (id: string) => void
  onRequestClear: () => void
  clearDisabled: boolean
}

interface SolveRowProps {
  solve: Solve
  number: number
  onSetPenalty: (id: string, penalty: Penalty) => void
  onDelete: (id: string) => void
}

function fullTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(timestamp)
}

const SolveRow = memo(function SolveRow({
  solve,
  number,
  onSetPenalty,
  onDelete,
}: SolveRowProps) {
  const time = formatSolveTime(solve.rawMs, solve.penalty)
  const effective =
    solve.penalty === '+2'
      ? `Effective ${formatEffectiveSolveTime(solve)}`
      : null
  const raw =
    solve.penalty === 'dnf' ? `Raw ${formatTime(solve.rawMs)}` : null

  return (
    <li className="history-row" data-testid="history-row">
      <span
        className={`history-time ${
          solve.penalty === 'dnf'
            ? 'is-dnf'
            : solve.penalty === '+2'
              ? 'is-penalty'
              : ''
        }`}
        data-testid="history-time"
      >
        {time.display}
        {time.suffix ? (
          <span className="time-suffix">{time.suffix}</span>
        ) : null}
      </span>

      <span className="history-copy">
        <span className="history-meta">
          <span>#{number}</span>
          <span aria-hidden="true">·</span>
          <time
            dateTime={new Date(solve.createdAt).toISOString()}
            title={fullTimestamp(solve.createdAt)}
          >
            {formatRelativeTime(solve.createdAt)}
          </time>
          {effective ? (
            <span className="effective-time">{effective}</span>
          ) : raw ? (
            <span className="effective-time">{raw}</span>
          ) : null}
        </span>
        <span className="history-scramble" title={solve.scramble}>
          {solve.scramble}
        </span>
      </span>

      <span className="history-actions">
        <button
          type="button"
          className={`mini-button ${
            solve.penalty === '+2' ? 'is-active' : ''
          }`}
          aria-label={`Toggle plus two penalty for solve ${number}`}
          aria-pressed={solve.penalty === '+2'}
          title="Toggle +2 penalty"
          onClick={() =>
            onSetPenalty(solve.id, solve.penalty === '+2' ? 'none' : '+2')
          }
        >
          +2
        </button>
        <button
          type="button"
          className={`mini-button ${
            solve.penalty === 'dnf' ? 'is-active is-dnf' : ''
          }`}
          aria-label={`Toggle DNF for solve ${number}`}
          aria-pressed={solve.penalty === 'dnf'}
          title="Toggle DNF"
          onClick={() =>
            onSetPenalty(solve.id, solve.penalty === 'dnf' ? 'none' : 'dnf')
          }
        >
          DNF
        </button>
        <button
          type="button"
          className="mini-button icon-only"
          aria-label={`Delete solve ${number}`}
          title="Delete solve"
          onClick={() => onDelete(solve.id)}
        >
          <TrashIcon size={14} />
        </button>
      </span>
    </li>
  )
})

export function SolveHistory({
  solves,
  onSetPenalty,
  onDelete,
  onRequestClear,
  clearDisabled,
}: SolveHistoryProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const newestId = solves[0]?.id

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }, [newestId])

  return (
    <section className="panel history-panel" aria-labelledby="history-title">
      <div className="panel-heading history-heading">
        <div>
          <span className="eyebrow">
            <span className="eyebrow-index">04</span>
            History
          </span>
          <h2 id="history-title">
            Solves
            <span
              className="heading-count"
              aria-live="polite"
              data-testid="solve-count"
            >
              {solves.length}
            </span>
          </h2>
        </div>
        <button
          type="button"
          className="text-button danger-text"
          onClick={onRequestClear}
          disabled={solves.length === 0 || clearDisabled}
          title={
            clearDisabled
              ? 'Stop the current solve before clearing the session'
              : 'Clear every solve in this session'
          }
        >
          Clear session
        </button>
      </div>

      <div className="history-scroll" ref={scrollRef}>
        {solves.length === 0 ? (
          <div className="history-empty">
            <span className="empty-mark">
              <CubeMark size={44} />
            </span>
            <p>No solves yet.</p>
            <span>
              Hold <kbd>Space</kbd>, release to start, then press again to stop.
            </span>
          </div>
        ) : (
          <ol className="history-list">
            {solves.map((solve, index) => (
              <SolveRow
                key={solve.id}
                solve={solve}
                number={solves.length - index}
                onSetPenalty={onSetPenalty}
                onDelete={onDelete}
              />
            ))}
          </ol>
        )}
      </div>
    </section>
  )
}
