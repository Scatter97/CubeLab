/* oxlint-disable react/set-state-in-effect */
/* oxlint-disable react-hooks/set-state-in-effect */
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
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
import {
  averageMeasuredHeight,
  buildRowOffsets,
  computeHistoryWindow,
  findRowAtOffset,
} from '../lib/historyWindow'
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

interface HistoryAnchor {
  id: string
  index: number
  offset: number
}

interface SolveRowProps {
  solve: Solve
  number: number
  setSize: number
  menuOpen: boolean
  onOpenMenu: (solve: Solve, number: number, trigger: HTMLElement, anchor: HTMLElement) => void
  onHoverMenu: (solve: Solve, number: number, trigger: HTMLElement, anchor: HTMLElement) => void
  onSetPenalty: (id: string, penalty: Penalty) => void
}

/**
 * Sessions above this size render only the rows near the scroll viewport.
 * Smaller sessions keep every row in the DOM so find-in-page and Tab order
 * continue to cover the complete history without an extra action.
 */
const VIRTUALIZE_THRESHOLD = 200
const ROW_HEIGHT_FALLBACK = 44
const WINDOW_OVERSCAN_PX = 320
const WINDOW_NOTE_ID = 'history-window-note'

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
  setSize,
  menuOpen,
  onOpenMenu,
  onHoverMenu,
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
      aria-posinset={number}
      aria-setsize={setSize}
    >
      <button
        type="button"
        className="history-main"
        data-testid="history-main"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label={`Solve ${number}, ${time.display}${time.suffix ?? ''}. Open solve actions.`}
        onClick={(event) => openMenu(event.currentTarget)}
        onMouseEnter={(event) => {
          // While a row menu is open, hovering another solve promotes it into
          // the same popup instead of leaving the previous solve selected.
          onHoverMenu(
            solve,
            number,
            event.currentTarget,
            rowRef.current ?? event.currentTarget,
          )
        }}
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

export const SolveHistory = memo(function SolveHistory({
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
  const [showAll, setShowAll] = useState(false)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)
  const [heights, setHeights] = useState(() => new Map<string, number>())
  const newestId = solves[0]?.id
  const virtualized = solves.length > VIRTUALIZE_THRESHOLD && !showAll

  const closeMenu = useCallback((restoreFocus = true) => {
    setOpenMenu((current) => {
      if (current && restoreFocus) {
        current.trigger.focus()
      }
      return null
    })
    setCommentEditing(false)
  }, [])

  const anchorRef = useRef<HistoryAnchor | null>(null)
  const previousNewestRef = useRef<string | undefined>(newestId)
  const scrollRafRef = useRef<number | null>(null)
  const openMenuRef = useRef<OpenSolveMenu | null>(null)
  const solvesRef = useRef(solves)
  const offsetsRef = useRef<Float64Array | null>(null)
  const virtualizedRef = useRef(virtualized)

  const estimate = useMemo(
    () => averageMeasuredHeight(heights, ROW_HEIGHT_FALLBACK),
    [heights],
  )
  const offsets = useMemo(
    () =>
      virtualized
        ? buildRowOffsets(
            solves.map((solve) => solve.id),
            heights,
            estimate,
          )
        : null,
    [estimate, heights, solves, virtualized],
  )

  useLayoutEffect(() => {
    solvesRef.current = solves
    openMenuRef.current = openMenu
    virtualizedRef.current = virtualized
    offsetsRef.current = offsets
  }, [solves, openMenu, virtualized, offsets])

  const windowRange = useMemo(
    () =>
      offsets
        ? computeHistoryWindow(
            offsets,
            scrollTop,
            viewportHeight,
            WINDOW_OVERSCAN_PX,
          )
        : {
            start: 0,
            end: solves.length,
            topSpacer: 0,
            bottomSpacer: 0,
            totalHeight: 0,
          },
    [offsets, scrollTop, solves.length, viewportHeight],
  )

  useEffect(() => {
    const ids = new Set(solves.map((solve) => solve.id))
    setHeights((previous) => {
      let changed = false
      const next = new Map(previous)
      for (const id of previous.keys()) {
        if (!ids.has(id)) {
          next.delete(id)
          changed = true
        }
      }
      return changed ? next : previous
    })
  }, [solves])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }, [newestId])

  useEffect(
    () => () => {
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current)
      }
    },
    [],
  )

  useLayoutEffect(() => {
    const scroller = scrollRef.current
    if (!scroller) return
    const update = () => setViewportHeight(scroller.clientHeight)
    update()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update)
      return () => window.removeEventListener('resize', update)
    }

    const observer = new ResizeObserver(update)
    observer.observe(scroller)
    return () => observer.disconnect()
  }, [])

  // Measure the rendered window. Heights vary with comments and wrapped
  // metadata, so the offset table is corrected before paint and the current
  // scroll anchor is restored by the effect below.
  useLayoutEffect(() => {
    if (!virtualized) return
    const scroller = scrollRef.current
    if (!scroller) return

    setHeights((previous) => {
      const next = new Map(previous)
      let changed = false
      for (const node of scroller.querySelectorAll<HTMLElement>('[data-solve-id]')) {
        const id = node.dataset.solveId
        if (!id) continue
        const height = node.getBoundingClientRect().height
        if (height <= 0) continue
        const existing = previous.get(id)
        if (existing === undefined || Math.abs(existing - height) > 0.5) {
          next.set(id, height)
          changed = true
        }
      }
      return changed ? next : previous
    })
  }, [openMenu, solves, scrollTop, viewportHeight, virtualized])

  // When "Show all" is used, measure every row once so switching back to the
  // windowed view keeps an accurate total height and scroll position.
  useLayoutEffect(() => {
    if (!showAll) return
    const scroller = scrollRef.current
    if (!scroller) return

    setHeights((previous) => {
      const next = new Map(previous)
      let changed = false
      for (const node of scroller.querySelectorAll<HTMLElement>('[data-solve-id]')) {
        const id = node.dataset.solveId
        if (!id) continue
        const height = node.getBoundingClientRect().height
        if (height <= 0) continue
        const existing = previous.get(id)
        if (existing === undefined || Math.abs(existing - height) > 0.5) {
          next.set(id, height)
          changed = true
        }
      }
      return changed ? next : previous
    })
  }, [showAll])

  useLayoutEffect(() => {
    const scroller = scrollRef.current
    const currentNewest = solves[0]?.id
    const newestChanged = currentNewest !== previousNewestRef.current
    previousNewestRef.current = currentNewest

    if (newestChanged) {
      anchorRef.current = null
      return
    }
    if (!virtualized || !offsets || !scroller) return

    const anchor = anchorRef.current
    if (!anchor) return

    const foundIndex = solves.findIndex((solve) => solve.id === anchor.id)
    const index =
      foundIndex >= 0
        ? foundIndex
        : Math.min(anchor.index, solves.length - 1)
    if (index < 0) return

    const target =
      (offsets[index] ?? 0) + (foundIndex >= 0 ? anchor.offset : 0)
    if (Math.abs(scroller.scrollTop - target) > 1) {
      scroller.scrollTop = target
      setScrollTop(target)
    }
  }, [heights, offsets, solves, virtualized])

  // Keep an open menu pointed at the current solve object and row number. A
  // penalty edit, deletion above it, or external import must not leave the
  // popup showing stale values.
  useEffect(() => {
    if (!openMenu) return
    const index = solves.findIndex((solve) => solve.id === openMenu.solve.id)
    if (index < 0) {
      // oxlint-disable-next-line react(set-state-in-effect)
      closeMenu(false)
      return
    }
    const current = solves[index]
    if (!current) return
    const number = solves.length - index
    if (current !== openMenu.solve || number !== openMenu.number) {
      // oxlint-disable-next-line react/set-state-in-effect
      setOpenMenu({ ...openMenu, solve: current, number })
    }
  }, [closeMenu, openMenu, solves])

  const captureAnchor = useCallback(() => {
    const scroller = scrollRef.current
    const currentOffsets = offsetsRef.current
    const currentSolves = solvesRef.current
    if (
      !virtualizedRef.current ||
      !scroller ||
      !currentOffsets ||
      currentSolves.length === 0
    ) {
      return
    }

    const top = scroller.scrollTop
    const index = findRowAtOffset(currentOffsets, top)
    const solve = currentSolves[index]
    if (solve) {
      anchorRef.current = {
        id: solve.id,
        index,
        offset: top - (currentOffsets[index] ?? top),
      }
    }
  }, [])

  const handleScroll = useCallback(() => {
    const scroller = scrollRef.current
    if (!scroller) return
    if (scrollRafRef.current !== null) return

    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null
      const top = scroller.scrollTop
      setScrollTop(top)

      const currentOffsets = offsetsRef.current
      const currentSolves = solvesRef.current
      if (!virtualizedRef.current || !currentOffsets || currentSolves.length === 0) {
        return
      }
      const index = findRowAtOffset(currentOffsets, top)
      const solve = currentSolves[index]
      if (solve) {
        anchorRef.current = {
          id: solve.id,
          index,
          offset: top - (currentOffsets[index] ?? top),
        }
      }
    })
  }, [])

  const handleOpenMenu = useCallback(
    (solve: Solve, number: number, trigger: HTMLElement, anchor: HTMLElement) => {
      if (openMenuRef.current?.solve.id === solve.id) {
        closeMenu(true)
        return
      }

      captureAnchor()
      setCommentDraft(solve.comment)
      setCommentEditing(false)
      setOpenMenu({
        solve,
        number,
        rect: anchor.getBoundingClientRect(),
        trigger,
      })
    },
    [captureAnchor, closeMenu],
  )

  const handleHoverMenu = useCallback(
    (solve: Solve, number: number, trigger: HTMLElement, anchor: HTMLElement) => {
      if (!openMenuRef.current || openMenuRef.current.solve.id === solve.id) {
        return
      }

      captureAnchor()
      setCommentDraft(solve.comment)
      setCommentEditing(false)
      setOpenMenu({
        solve,
        number,
        rect: anchor.getBoundingClientRect(),
        trigger,
      })
    },
    [captureAnchor],
  )

  const handleRowPenalty = useCallback(
    (id: string, penalty: Penalty) => {
      captureAnchor()
      onSetPenalty(id, penalty)
    },
    [captureAnchor, onSetPenalty],
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
    captureAnchor()
    onSetPenalty(openMenu.solve.id, penalty)
    closeMenu()
  }

  const handleDelete = () => {
    if (!openMenu) return
    captureAnchor()
    onDelete(openMenu.solve.id)
    closeMenu(false)
  }

  const handleSaveComment = () => {
    if (!openMenu) return
    captureAnchor()
    onSetComment(openMenu.solve.id, commentDraft.trim())
    onNotify('Solve comment saved')
    closeMenu()
  }

  const toggleShowAll = () => {
    captureAnchor()
    setShowAll((current) => !current)
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

  const renderedSolves = virtualized
    ? solves.slice(windowRange.start, windowRange.end)
    : solves

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
        {solves.length > VIRTUALIZE_THRESHOLD ? (
          <button
            type="button"
            className="text-button history-window-toggle"
            data-testid="history-window-toggle"
            aria-pressed={showAll}
            onClick={toggleShowAll}
          >
            {showAll ? 'Use windowed view' : 'Show all solves'}
          </button>
        ) : null}
      </div>

      {solves.length > VIRTUALIZE_THRESHOLD ? (
        <p id={WINDOW_NOTE_ID} className="sr-only">
          For performance, only solves near the visible area are rendered. Use
          Show all solves to make every row available to find-in-page and
          assistive technology.
        </p>
      ) : null}

      <div
        className={`history-scroll${virtualized ? ' is-virtualized' : ''}`}
        ref={scrollRef}
        onScroll={handleScroll}
      >
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
          <>
            {virtualized && windowRange.topSpacer > 0 ? (
              <div
                className="history-spacer"
                aria-hidden="true"
                style={{ height: windowRange.topSpacer }}
              />
            ) : null}
            <ol
              className={`history-list${virtualized ? ' history-list--virtualized' : ''}`}
              data-testid="history-list"
              data-virtualized={virtualized ? 'true' : 'false'}
              aria-label="Solve history"
              aria-describedby={
                solves.length > VIRTUALIZE_THRESHOLD
                  ? WINDOW_NOTE_ID
                  : undefined
              }
            >
              {renderedSolves.map((solve, offset) => {
                const index = virtualized ? windowRange.start + offset : offset
                return (
                  <SolveRow
                    key={solve.id}
                    solve={solve}
                    number={solves.length - index}
                    setSize={solves.length}
                    menuOpen={openMenu?.solve.id === solve.id}
                    onOpenMenu={handleOpenMenu}
                    onHoverMenu={handleHoverMenu}
                    onSetPenalty={handleRowPenalty}
                  />
                )
              })}
            </ol>
            {virtualized && windowRange.bottomSpacer > 0 ? (
              <div
                className="history-spacer"
                aria-hidden="true"
                style={{ height: windowRange.bottomSpacer }}
              />
            ) : null}
          </>
        )}
      </div>

      {menu}
    </section>
  )
})
