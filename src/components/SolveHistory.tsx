import { memo, useCallback, useState } from 'react'
import type { Penalty, Solve } from '../types'
import {
  formatEffectiveSolveTime,
  formatRelativeTime,
  formatSolveTime,
  formatTime,
} from '../lib/format'
import { copyText } from '../lib/clipboard'
import { dateTimeAttribute, isDateTimestamp } from '../lib/dates'
import { useHistoryList } from '../hooks/useHistoryList'
import { useHistoryMenu } from '../hooks/useHistoryMenu'
import { HistoryActionMenu, HistoryMenuAction } from './HistoryActionMenu'
import { HistoryPanel, HistoryRow } from './HistoryPanel'
import { MAX_SOLVE_COMMENT_LENGTH } from '../lib/sessions'
import {
  CopyIcon,
  PencilIcon,
  TrashIcon,
} from './Icons'

interface SolveHistoryProps {
  solves: readonly Solve[]
  onSetPenalty: (id: string, penalty: Penalty) => void
  onDelete: (id: string) => void
  onSetComment: (id: string, comment: string) => void
  onNotify: (message: string) => void
}

interface SolveRowProps {
  solve: Solve
  number: number
  setSize: number
  menuOpen: boolean
  onOpenMenu: (solve: Solve, trigger: HTMLElement) => void
  onHoverMenu: (solve: Solve, trigger: HTMLElement) => void
  onSetPenalty: (id: string, penalty: Penalty) => void
}

function fullTimestamp(timestamp: number): string {
  if (!isDateTimestamp(timestamp)) return 'Unknown date'
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(timestamp)
}

function solveTimeText(solve: Solve): string {
  const time = formatSolveTime(solve.rawMs, solve.penalty)
  return `${time.display}${time.suffix ?? ''}`
}

const SolveRow = memo(function SolveRow({
  solve,
  number,
  setSize,
  menuOpen,
  onOpenMenu,
  onHoverMenu,
  onSetPenalty,
}: SolveRowProps) {
  const time = formatSolveTime(solve.rawMs, solve.penalty)
  const effective =
    solve.penalty === '+2'
      ? `Effective ${formatEffectiveSolveTime(solve)}`
      : null
  const raw = solve.penalty === 'dnf' ? `Raw ${formatTime(solve.rawMs)}` : null

  return (
    <HistoryRow
      rowId={solve.id}
      selected={menuOpen}
      data-testid="history-row"
      data-solve-id={solve.id}
      aria-posinset={number}
      aria-setsize={setSize}
      time={<>{time.display}{time.suffix ? <span className="time-suffix">{time.suffix}</span> : null}</>}
      timeClassName={solve.penalty === 'dnf' ? 'is-dnf' : solve.penalty === '+2' ? 'is-penalty' : ''}
      timeTestId="history-time"
      main={{
        'aria-haspopup': 'menu',
        'aria-expanded': menuOpen,
        'aria-label': `Solve ${number}, ${time.display}${time.suffix ?? ''}. Open solve actions.`,
        'data-testid': 'history-main',
        onClick: event => onOpenMenu(solve, event.currentTarget),
        // While a row menu is open, hovering another solve promotes it.
        onMouseEnter: event => onHoverMenu(solve, event.currentTarget),
      }}
      actions={(
        <div className="history-actions">
          <button
            type="button"
            className={`history-action${solve.penalty === '+2' ? ' is-active is-warning' : ''}`}
            data-testid="solve-plus-two"
            aria-pressed={solve.penalty === '+2'}
            aria-label={
              solve.penalty === '+2'
                ? `Remove +2 penalty from solve ${number}`
                : `Add +2 penalty to solve ${number}`
            }
            onClick={() =>
              onSetPenalty(
                solve.id,
                solve.penalty === '+2' ? 'none' : '+2',
              )
            }
          >
            +2
          </button>
          <button
            type="button"
            className={`history-action${solve.penalty === 'dnf' ? ' is-active is-danger' : ''}`}
            data-testid="solve-dnf"
            aria-pressed={solve.penalty === 'dnf'}
            aria-label={
              solve.penalty === 'dnf'
                ? `Remove DNF from solve ${number}`
                : `Mark solve ${number} as DNF`
            }
            onClick={() =>
              onSetPenalty(
                solve.id,
                solve.penalty === 'dnf' ? 'none' : 'dnf',
              )
            }
          >
            DNF
          </button>
        </div>
      )}
    >
      <span className="history-meta">
        <span>#{number}</span>
        <span aria-hidden="true">·</span>
        <time
          dateTime={dateTimeAttribute(solve.createdAt)}
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
      {solve.comment ? (
        <span className="history-comment" title={solve.comment}>
          {solve.comment}
        </span>
      ) : null}
    </HistoryRow>
  )
})

export const SolveHistory = memo(function SolveHistory({
  solves,
  onSetPenalty,
  onDelete,
  onSetComment,
  onNotify,
}: SolveHistoryProps) {
  const history = useHistoryList(solves)
  const { scrollRef, captureAnchor } = history
  const [commentEditing, setCommentEditing] = useState(false)
  const [commentDraft, setCommentDraft] = useState('')
  const resetEditor = useCallback((solve: Solve) => {
    setCommentDraft(solve.comment)
    setCommentEditing(false)
  }, [])
  const { openMenu, menuRef, toggleMenu, hoverMenu, closeMenu } =
    useHistoryMenu(solves, scrollRef, captureAnchor, false, resetEditor)

  const handleRowPenalty = useCallback(
    (id: string, penalty: Penalty) => {
      captureAnchor()
      onSetPenalty(id, penalty)
    },
    [captureAnchor, onSetPenalty],
  )

  const handleCopy = async (text: string, successMessage: string) => {
    closeMenu()
    const copied = await copyText(text)
    onNotify(copied ? successMessage : 'Could not copy to the clipboard')
  }

  const handlePenalty = (penalty: Penalty) => {
    if (!openMenu) return
    captureAnchor()
    onSetPenalty(openMenu.item.id, penalty)
    closeMenu()
  }

  const handleDelete = () => {
    if (!openMenu) return
    captureAnchor()
    onDelete(openMenu.item.id)
    closeMenu(false)
  }

  const handleSaveComment = () => {
    if (!openMenu) return
    captureAnchor()
    onSetComment(openMenu.item.id, commentDraft.trim())
    onNotify('Solve comment saved')
    closeMenu()
  }

  const solve = openMenu?.item
  const time = solve ? formatSolveTime(solve.rawMs, solve.penalty) : null
  const secondary = solve?.penalty === '+2'
    ? `Effective ${formatEffectiveSolveTime(solve)}`
    : solve?.penalty === 'dnf' ? `Raw ${formatTime(solve.rawMs)}` : null

  const menu = openMenu && solve && time ? (
    <HistoryActionMenu
      menuRef={menuRef} rect={openMenu.rect}
      label={`Solve ${openMenu.number} actions`} title={`Solve #${openMenu.number}`}
      time={<>{time.display}{time.suffix ? <span className="time-suffix">{time.suffix}</span> : null}</>}
      secondary={secondary}
      preview={solve.comment ? <p className="solve-menu-comment-preview">{solve.comment}</p> : null}
      editor={commentEditing ? (
        <div className="solve-menu-comment">
          <label className="sr-only" htmlFor="solve-comment-input">Solve comment</label>
          <textarea
            id="solve-comment-input"
            value={commentDraft}
            maxLength={MAX_SOLVE_COMMENT_LENGTH}
            autoFocus
            placeholder="Add a comment about this solve"
            onChange={event => setCommentDraft(event.target.value)}
          />
          <div className="solve-menu-comment-actions">
            <button type="button" className="text-button" onClick={() => setCommentEditing(false)}>
              Cancel
            </button>
            <button type="button" className="button button-primary button-small" onClick={handleSaveComment}>
              Save comment
            </button>
          </div>
        </div>
      ) : null}
      footer={<HistoryMenuAction icon={<TrashIcon size={14} />} danger onClick={handleDelete}>Delete solve</HistoryMenuAction>}
    >
      <HistoryMenuAction icon={<span className="solve-menu-action-icon" aria-hidden="true">+2</span>}
        onClick={() => handlePenalty(solve.penalty === '+2' ? 'none' : '+2')}>
        {solve.penalty === '+2' ? 'Remove +2 penalty' : 'Add +2 penalty'}
      </HistoryMenuAction>
      <HistoryMenuAction icon={<span className="solve-menu-action-icon" aria-hidden="true">DNF</span>}
        onClick={() => handlePenalty(solve.penalty === 'dnf' ? 'none' : 'dnf')}>
        {solve.penalty === 'dnf' ? 'Remove DNF' : 'Mark as DNF'}
      </HistoryMenuAction>
      <HistoryMenuAction icon={<CopyIcon size={14} />}
        onClick={() => void handleCopy(solve.scramble, 'Scramble copied to clipboard')}>
        Copy scramble
      </HistoryMenuAction>
      <HistoryMenuAction icon={<CopyIcon size={14} />}
        onClick={() => void handleCopy(solveTimeText(solve), 'Solve time copied')}>
        Copy solve time
      </HistoryMenuAction>
      <HistoryMenuAction icon={<CopyIcon size={14} />}
        onClick={() => void handleCopy(`${solveTimeText(solve)} — ${solve.scramble}`, 'Solve copied to clipboard')}>
        Copy solve text
      </HistoryMenuAction>
      <HistoryMenuAction icon={<PencilIcon size={14} />} onClick={() => setCommentEditing(editing => !editing)}>
        {solve.comment ? 'Edit comment' : 'Add comment'}
      </HistoryMenuAction>
    </HistoryActionMenu>
  ) : null

  return (
    <HistoryPanel
      title="Solves"
      count={solves.length}
      empty="No solves yet."
      listLabel="Solve history"
      listTestId="history-list"
      countTestId="solve-count"
      windowToggleTestId="history-window-toggle"
      history={history}
      renderRows={(start, end) => solves.slice(start, end).map((solve, offset) => (
        <SolveRow
          key={solve.id}
          solve={solve}
          number={solves.length - start - offset}
          setSize={solves.length}
          menuOpen={openMenu?.id === solve.id}
          onOpenMenu={toggleMenu}
          onHoverMenu={hoverMenu}
          onSetPenalty={handleRowPenalty}
        />
      ))}
    >
      {menu}
    </HistoryPanel>
  )
})
