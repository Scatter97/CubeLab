import { useEffect, useState } from 'react'
import type { Penalty, Solve } from '../types'
import { copyText } from '../lib/clipboard'
import { dateTimeAttribute, isDateTimestamp } from '../lib/dates'
import {
  formatEffectiveSolveTime,
  formatSolveTime,
  formatTime,
} from '../lib/format'
import { MAX_SOLVE_COMMENT_LENGTH } from '../lib/sessions'

interface Props {
  /** Newest solve in the active session, or null when the session is empty. */
  solve: Solve | null
  /** Session-relative solve number. */
  number: number
  /** Competition round and attempt context, when available. */
  roundLabel?: string | null
  /** Mutations are locked while the timer or a pending save is active. */
  disabled?: boolean
  onSetPenalty?: (id: string, penalty: Penalty) => void
  onSetComment?: (id: string, comment: string) => void
  onDeleteSolve?: (id: string) => void
  onNotify?: (message: string) => void
}

const timestampFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
})

function formatSolveDate(timestamp: number): string {
  return isDateTimestamp(timestamp)
    ? timestampFormatter.format(timestamp)
    : 'Unknown date'
}

function solveTimeText(solve: Solve): string {
  const time = formatSolveTime(solve.rawMs, solve.penalty)
  return `${time.display}${time.suffix ?? ''}`
}

function solveClipboardText(solve: Solve): string {
  const parts = [solveTimeText(solve)]
  if (solve.penalty === '+2') {
    parts.push(`Effective ${formatEffectiveSolveTime(solve)}`)
  } else if (solve.penalty === 'dnf') {
    parts.push(`Raw ${formatTime(solve.rawMs)}`)
  }
  if (solve.comment) parts.push(`[${solve.comment}]`)
  parts.push(solve.scramble || 'No scramble')
  parts.push(`@${formatSolveDate(solve.createdAt)}`)
  return parts.join('   ')
}

/**
 * Confirms the solve that was just recorded. Mirrors csTimer's Confirm time
 * tool: result corrections, comment editing, copy and delete for the latest
 * solve, without a separate manual time-entry path.
 */
export function ConfirmTimeTool({
  solve,
  number,
  roundLabel = null,
  disabled = false,
  onSetPenalty,
  onSetComment,
  onDeleteSolve,
  onNotify,
}: Props) {
  const [commentDraft, setCommentDraft] = useState(solve?.comment ?? '')

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    setCommentDraft(solve?.comment ?? '')
  }, [solve?.id, solve?.comment])

  if (!solve) {
    return (
      <div className="tool-scroll confirm-time-tool" data-timer-space-ignore>
        <p className="tool-note" data-testid="confirm-time-empty">
          No solves to confirm yet. Finish a solve and it will appear here.
        </p>
      </div>
    )
  }

  const time = formatSolveTime(solve.rawMs, solve.penalty)
  const secondary =
    solve.penalty === '+2'
      ? `Effective ${formatEffectiveSolveTime(solve)}`
      : solve.penalty === 'dnf'
        ? `Raw ${formatTime(solve.rawMs)}`
        : null
  const normalizedComment = commentDraft
    .trim()
    .slice(0, MAX_SOLVE_COMMENT_LENGTH)
  const commentDirty = commentDraft !== solve.comment
  const commentDisabled = disabled || !onSetComment
  const penaltyDisabled = disabled || !onSetPenalty
  const deleteDisabled = disabled || !onDeleteSolve

  const saveComment = () => {
    if (!commentDirty || commentDisabled) return
    onSetComment?.(solve.id, normalizedComment)
    setCommentDraft(normalizedComment)
    onNotify?.('Solve comment saved')
  }

  const copy = async (text: string, successMessage: string) => {
    const copied = await copyText(text)
    onNotify?.(
      copied ? successMessage : 'Could not copy to the clipboard',
    )
  }

  return (
    <div
      className="tool-scroll confirm-time-tool"
      data-testid="confirm-time-tool"
      data-timer-space-ignore
    >
      <p className="tool-label" data-testid="confirm-time-heading">
        Solve #{number}
        {roundLabel ? ` · ${roundLabel}` : ''}
      </p>

      <div
        className={`confirm-time-value${solve.penalty === 'dnf' ? ' is-dnf' : ''}`}
        data-testid="confirm-time-value"
      >
        {time.display}
        {time.suffix ? (
          <span className="confirm-time-suffix">{time.suffix}</span>
        ) : null}
      </div>
      {secondary ? (
        <p className="tool-note" data-testid="confirm-time-secondary">
          {secondary}
        </p>
      ) : null}

      <div
        className="confirm-time-penalties"
        role="group"
        aria-label="Solve result"
      >
        <button
          type="button"
          aria-pressed={solve.penalty === 'none'}
          disabled={penaltyDisabled}
          data-testid="confirm-time-ok"
          onClick={() => onSetPenalty?.(solve.id, 'none')}
        >
          OK
        </button>
        <button
          type="button"
          aria-pressed={solve.penalty === '+2'}
          disabled={penaltyDisabled}
          data-testid="confirm-time-plus-two"
          onClick={() => onSetPenalty?.(solve.id, '+2')}
        >
          +2
        </button>
        <button
          type="button"
          aria-pressed={solve.penalty === 'dnf'}
          disabled={penaltyDisabled}
          data-testid="confirm-time-dnf"
          onClick={() => onSetPenalty?.(solve.id, 'dnf')}
        >
          DNF
        </button>
      </div>

      {disabled ? (
        <p className="tool-note">Result changes are locked while timing.</p>
      ) : null}

      <div className="tool-field confirm-time-comment">
        <label htmlFor="confirm-time-comment-input">Comment</label>
        <div className="confirm-time-comment-row">
          <input
            id="confirm-time-comment-input"
            type="text"
            maxLength={MAX_SOLVE_COMMENT_LENGTH}
            value={commentDraft}
            disabled={commentDisabled}
            placeholder="Add a comment"
            data-testid="confirm-time-comment"
            onChange={(event) => setCommentDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setCommentDraft(solve.comment)
                return
              }
              if (event.key === 'Enter') {
                event.preventDefault()
                saveComment()
              }
            }}
          />
          <button
            type="button"
            className="button button-secondary button-small"
            disabled={!commentDirty || commentDisabled}
            aria-label="Save comment"
            data-testid="confirm-time-save-comment"
            onClick={saveComment}
          >
            Save
          </button>
        </div>
      </div>

      <dl className="confirm-time-meta">
        <div>
          <dt>Date</dt>
          <dd>
            <time
              data-testid="confirm-time-date"
              dateTime={dateTimeAttribute(solve.createdAt)}
              title={formatSolveDate(solve.createdAt)}
            >
              {formatSolveDate(solve.createdAt)}
            </time>
          </dd>
        </div>
        <div>
          <dt>Scramble</dt>
          <dd>
            {solve.scramble ? (
              <p
                className="confirm-time-scramble"
                data-testid="confirm-time-scramble"
                title={solve.scramble}
              >
                {solve.scramble}
              </p>
            ) : (
              <span className="tool-note">No scramble stored.</span>
            )}
          </dd>
        </div>
      </dl>

      <div className="tool-actions confirm-time-actions">
        <button
          type="button"
          className="text-button"
          data-testid="confirm-time-copy-solve"
          onClick={() => void copy(solveClipboardText(solve), 'Solve copied to clipboard')}
        >
          Copy solve
        </button>
        <button
          type="button"
          className="text-button"
          disabled={!solve.scramble}
          data-testid="confirm-time-copy-scramble"
          onClick={() => void copy(solve.scramble, 'Scramble copied to clipboard')}
        >
          Copy scramble
        </button>
        <button
          type="button"
          className="text-button danger-text"
          disabled={deleteDisabled}
          data-testid="confirm-time-delete"
          onClick={() => onDeleteSolve?.(solve.id)}
        >
          Delete solve
        </button>
      </div>
    </div>
  )
}
