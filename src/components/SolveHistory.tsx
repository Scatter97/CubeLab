import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import type { Penalty, Solve } from '../types'
import {
  formatEffectiveSolveTime,
  formatRelativeTime,
  formatSolveTime,
  formatTime,
} from '../lib/format'
import { copyText } from '../lib/clipboard'
import { MAX_SOLVE_COMMENT_LENGTH } from '../lib/sessions'
import {
  CopyIcon,
  CubeMark,
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

interface OpenSolveMenu {
  solve: Solve
  number: number
  rect: DOMRect
  trigger: HTMLElement
}

interface SolveRowProps {
  solve: Solve
  number: number
  menuOpen: boolean
  onOpenMenu: (solve: Solve, number: number, trigger: HTMLElement, anchor: HTMLElement) => void
  onSetPenalty: (id: string, penalty: Penalty) => void
}

function fullTimestamp(timestamp: number): string {
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
  menuOpen,
  onOpenMenu,
  onSetPenalty,
}: SolveRowProps) {
  const rowRef = useRef<HTMLLIElement>(null)
  const time = formatSolveTime(solve.rawMs, solve.penalty)
  const effective =
    solve.penalty === '+2'
      ? `Effective ${formatEffectiveSolveTime(solve)}`
      : null
  const raw = solve.penalty === 'dnf' ? `Raw ${formatTime(solve.rawMs)}` : null

  const openMenu = (trigger: HTMLElement) => {
    const selection = window.getSelection()
    if (selection && selection.toString().length > 0) return
    onOpenMenu(
      solve,
      number,
      trigger,
      rowRef.current ?? trigger,
    )
  }

  return (
    <li
      ref={rowRef}
      className={`history-row${menuOpen ? ' is-menu-open' : ''}`}
      data-testid="history-row"
      data-solve-id={solve.id}
    >
      <button
        type="button"
        className="history-main"
        data-testid="history-main"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label={`Solve ${number}, ${time.display}${time.suffix ?? ''}. Open solve actions.`}
        onClick={(event) => openMenu(event.currentTarget)}
      >
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
          {solve.comment ? (
            <span className="history-comment" title={solve.comment}>
              {solve.comment}
            </span>
          ) : null}
        </span>
      </button>

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
    </li>
  )
})

export function SolveHistory({
  solves,
  onSetPenalty,
  onDelete,
  onSetComment,
  onNotify,
}: SolveHistoryProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [openMenu, setOpenMenu] = useState<OpenSolveMenu | null>(null)
  const [commentEditing, setCommentEditing] = useState(false)
  const [commentDraft, setCommentDraft] = useState('')
  const newestId = solves[0]?.id

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }, [newestId])

  const closeMenu = useCallback((restoreFocus = true) => {
    setOpenMenu((current) => {
      if (current && restoreFocus) {
        current.trigger.focus()
      }
      return null
    })
    setCommentEditing(false)
  }, [])

  const handleOpenMenu = useCallback(
    (solve: Solve, number: number, trigger: HTMLElement, anchor: HTMLElement) => {
      setCommentDraft(solve.comment)
      setCommentEditing(false)
      setOpenMenu({
        solve,
        number,
        rect: anchor.getBoundingClientRect(),
        trigger,
      })
    },
    [],
  )

  useEffect(() => {
    if (!openMenu) return
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (menuRef.current?.contains(target)) return
      if (openMenu.trigger.contains(target)) return
      closeMenu()
    }
    const handleResize = () => closeMenu(false)
    const handleScroll = () => closeMenu(false)
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      closeMenu()
    }

    document.addEventListener('pointerdown', handlePointerDown, true)
    document.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('resize', handleResize)
    const scroller = scrollRef.current
    scroller?.addEventListener('scroll', handleScroll, { passive: true })

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
      document.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('resize', handleResize)
      scroller?.removeEventListener('scroll', handleScroll)
    }
  }, [closeMenu, openMenu])

  const handleCopy = async (text: string, successMessage: string) => {
    const copied = await copyText(text)
    onNotify(copied ? successMessage : 'Could not copy to the clipboard')
    closeMenu()
  }

  const handlePenalty = (penalty: Penalty) => {
    if (!openMenu) return
    onSetPenalty(openMenu.solve.id, penalty)
    closeMenu()
  }

  const handleDelete = () => {
    if (!openMenu) return
    onDelete(openMenu.solve.id)
    closeMenu(false)
  }

  const handleSaveComment = () => {
    if (!openMenu) return
    onSetComment(openMenu.solve.id, commentDraft.trim())
    onNotify('Solve comment saved')
    closeMenu()
  }

  const menu = openMenu
    ? (() => {
        const menuWidth = 248
        const estimatedHeight = 360
        const rightSpace = window.innerWidth - openMenu.rect.right - 8
        const placeRight = rightSpace >= menuWidth
        const left = placeRight
          ? openMenu.rect.right + 8
          : Math.max(
              8,
              Math.min(openMenu.rect.left, window.innerWidth - menuWidth - 8),
            )
        const top = Math.max(
          8,
          Math.min(
            openMenu.rect.top,
            window.innerHeight - estimatedHeight - 8,
          ),
        )
        const time = formatSolveTime(
          openMenu.solve.rawMs,
          openMenu.solve.penalty,
        )
        const effective =
          openMenu.solve.penalty === '+2'
            ? `Effective ${formatEffectiveSolveTime(openMenu.solve)}`
            : openMenu.solve.penalty === 'dnf'
              ? `Raw ${formatTime(openMenu.solve.rawMs)}`
              : null

        return createPortal(
          <div
            ref={menuRef}
            className="solve-menu"
            style={{ left, top }}
            role="menu"
            aria-label={`Solve ${openMenu.number} actions`}
          >
            <div className="solve-menu-header">
              <span className="solve-menu-title">Solve #{openMenu.number}</span>
              <strong className="solve-menu-time">
                {time.display}
                {time.suffix ? (
                  <span className="time-suffix">{time.suffix}</span>
                ) : null}
              </strong>
              {effective ? (
                <span className="solve-menu-effective">{effective}</span>
              ) : null}
              {openMenu.solve.comment ? (
                <p className="solve-menu-comment-preview">
                  {openMenu.solve.comment}
                </p>
              ) : null}
            </div>

            <div className="solve-menu-actions">
              <button
                type="button"
                role="menuitem"
                className="solve-menu-action"
                onClick={() =>
                  handlePenalty(
                    openMenu.solve.penalty === '+2' ? 'none' : '+2',
                  )
                }
              >
                <span className="solve-menu-action-icon" aria-hidden="true">
                  +2
                </span>
                {openMenu.solve.penalty === '+2'
                  ? 'Remove +2 penalty'
                  : 'Add +2 penalty'}
              </button>
              <button
                type="button"
                role="menuitem"
                className="solve-menu-action"
                onClick={() =>
                  handlePenalty(
                    openMenu.solve.penalty === 'dnf' ? 'none' : 'dnf',
                  )
                }
              >
                <span className="solve-menu-action-icon" aria-hidden="true">
                  DNF
                </span>
                {openMenu.solve.penalty === 'dnf'
                  ? 'Remove DNF'
                  : 'Mark as DNF'}
              </button>
              <button
                type="button"
                role="menuitem"
                className="solve-menu-action"
                onClick={() =>
                  void handleCopy(
                    openMenu.solve.scramble,
                    'Scramble copied to clipboard',
                  )
                }
              >
                <CopyIcon size={14} />
                Copy scramble
              </button>
              <button
                type="button"
                role="menuitem"
                className="solve-menu-action"
                onClick={() =>
                  void handleCopy(solveTimeText(openMenu.solve), 'Solve time copied')
                }
              >
                <CopyIcon size={14} />
                Copy solve time
              </button>
              <button
                type="button"
                role="menuitem"
                className="solve-menu-action"
                onClick={() =>
                  void handleCopy(
                    `${solveTimeText(openMenu.solve)} — ${openMenu.solve.scramble}`,
                    'Solve copied to clipboard',
                  )
                }
              >
                <CopyIcon size={14} />
                Copy solve text
              </button>
              <button
                type="button"
                role="menuitem"
                className="solve-menu-action"
                onClick={() => setCommentEditing((editing) => !editing)}
              >
                <PencilIcon size={14} />
                {openMenu.solve.comment ? 'Edit comment' : 'Add comment'}
              </button>
            </div>

            {commentEditing ? (
              <div className="solve-menu-comment">
                <label className="sr-only" htmlFor="solve-comment-input">
                  Solve comment
                </label>
                <textarea
                  id="solve-comment-input"
                  value={commentDraft}
                  maxLength={MAX_SOLVE_COMMENT_LENGTH}
                  autoFocus
                  placeholder="Add a comment about this solve"
                  onChange={(event) => setCommentDraft(event.target.value)}
                />
                <div className="solve-menu-comment-actions">
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setCommentEditing(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="button button-primary button-small"
                    onClick={handleSaveComment}
                  >
                    Save comment
                  </button>
                </div>
              </div>
            ) : null}

            <div className="solve-menu-footer">
              <button
                type="button"
                role="menuitem"
                className="solve-menu-action is-danger"
                onClick={handleDelete}
              >
                <TrashIcon size={14} />
                Delete solve
              </button>
            </div>
          </div>,
          document.body,
        )
      })()
    : null

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
                menuOpen={openMenu?.solve.id === solve.id}
                onOpenMenu={handleOpenMenu}
                onSetPenalty={onSetPenalty}
              />
            ))}
          </ol>
        )}
      </div>

      {menu}
    </section>
  )
}