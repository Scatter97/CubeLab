import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import { createPortal } from 'react-dom'
import type { Session } from '../types'
import {
  getSessionDisplayNames,
} from '../lib/sessions'
import { getEventLabel } from '../lib/events'
import { formatSolveCount } from '../lib/format'
import {
  competitionFormatLabel,
  isCompetitionSession,
} from '../lib/competition'
import {
  getDragAutoScrollDelta,
  getSessionDropIndex,
} from '../lib/sessionDrag'
import { useDismissablePopover } from '../hooks/useDismissablePopover'
import {
  CheckIcon,
  GripVerticalIcon,
  PlusIcon,
  SettingsIcon,
} from './Icons'

interface SessionPanelProps {
  sessions: readonly Session[]
  activeSessionId: string
  locked: boolean
  onRequestCreate?: () => void
  onSelect: (id: string) => void
  onOpenSessionSettings: () => void
  onReorder: (id: string, targetIndex: number) => void
}


interface SessionDragState {
  sessionId: string
  dropIndex: number
  line: { top: number; left: number; width: number } | null
  ghost: { x: number; y: number; width: number; name: string } | null
}

interface SessionDragGesture {
  sessionId: string
  sessionName: string
  pointerId: number
  startX: number
  startY: number
  currentX: number
  currentY: number
  active: boolean
  originIndex: number
  dropIndex: number
  handle: HTMLButtonElement
  ghostWidth: number
}

interface SessionMenuPosition {
  left: number
  top: number
  width: number
  maxHeight: number
}

function sessionName(session: Session, displayName: string | undefined): string {
  return displayName ?? session.name
}

export function SessionPanel({
  sessions,
  activeSessionId,
  locked,
  onRequestCreate,
  onSelect,
  onOpenSessionSettings,
  onReorder,
}: SessionPanelProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuPosition, setMenuPosition] = useState<SessionMenuPosition | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [dragState, setDragState] = useState<SessionDragState | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const activeOptionRef = useRef<HTMLButtonElement>(null)
  const typeaheadRef = useRef({ text: '', at: 0 })
  const dragRef = useRef<SessionDragGesture | null>(null)
  const autoScrollFrameRef = useRef<number | null>(null)
  const menuFocusedRef = useRef(false)

  const activeSession =
    sessions.find((session) => session.id === activeSessionId) ?? sessions[0]
  const displayNames = getSessionDisplayNames(sessions)
  const activeName = activeSession
    ? sessionName(
        activeSession,
        displayNames[sessions.findIndex((session) => session.id === activeSession.id)],
      )
    : 'No sessions'

  const stopAutoScroll = () => {
    if (autoScrollFrameRef.current === null) return
    window.cancelAnimationFrame(autoScrollFrameRef.current)
    autoScrollFrameRef.current = null
  }

  const cancelDrag = () => {
    const gesture = dragRef.current
    dragRef.current = null
    stopAutoScroll()
    setDragState(null)
    if (!gesture) return
    try {
      gesture.handle.releasePointerCapture(gesture.pointerId)
    } catch {
      // The capture may already be gone after a browser-level cancel.
    }
  }

  const openMenu = () => {
    cancelDrag()
    setMenuOpen(true)
  }

  const closeMenu = () => {
    cancelDrag()
    setMenuOpen(false)
  }

  useDismissablePopover({
    open: menuOpen,
    onClose: closeMenu,
    triggerRef,
    panelRef,
    rootRef,
  })

  useEffect(() => {
    if (!locked) return
    // Locking closes an already-open picker without changing the active session.
    // oxlint-disable-next-line react/set-state-in-effect
    setMenuOpen(false)
  }, [locked])

  useEffect(
    () => () => {
      if (autoScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(autoScrollFrameRef.current)
      }
    },
    [],
  )

  useEffect(() => {
    if (!menuOpen) return
    const updateLayout = () => {
      const trigger = triggerRef.current
      if (!trigger) return
      const rect = trigger.getBoundingClientRect()
      const gap = 5
      const viewportGap = 8
      const spaceBelow = window.innerHeight - rect.bottom - viewportGap
      const spaceAbove = rect.top - viewportGap
      const above = spaceBelow < 220 && spaceAbove > spaceBelow
      const maxHeight = Math.max(
        160,
        Math.min(430, above ? spaceAbove : spaceBelow),
      )
      const width = Math.min(330, window.innerWidth - viewportGap * 2)
      const left = Math.max(
        viewportGap,
        Math.min(rect.left, window.innerWidth - width - viewportGap),
      )
      const top = above
        ? Math.max(viewportGap, rect.top - gap - maxHeight)
        : Math.min(window.innerHeight - viewportGap, rect.bottom + gap)
      setMenuPosition((current) =>
        current &&
        current.left === left &&
        current.top === top &&
        current.width === width &&
        current.maxHeight === maxHeight
          ? current
          : { left, top, width, maxHeight },
      )
    }
    updateLayout()
    window.addEventListener('resize', updateLayout)
    window.addEventListener('scroll', updateLayout, true)
    return () => {
      window.removeEventListener('resize', updateLayout)
      window.removeEventListener('scroll', updateLayout, true)
    }
  }, [menuOpen])

  useEffect(() => {
    if (!menuOpen) {
      menuFocusedRef.current = false
      return
    }
    if (!menuPosition || menuFocusedRef.current) return
    menuFocusedRef.current = true
    const frame = window.requestAnimationFrame(() => {
      activeOptionRef.current?.focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [menuOpen, menuPosition])

  const startCreate = () => {
    if (locked) return
    onRequestCreate?.()
  }

  const chooseSession = (session: Session, name: string) => {
    if (locked) return
    onSelect(session.id)
    setAnnouncement(`Switched to ${name}.`)
    closeMenu()
    triggerRef.current?.focus()
  }

  const updateDragFromPointer = (gesture: SessionDragGesture) => {
    const list = listRef.current
    if (!list) return
    const listRect = list.getBoundingClientRect()
    const rowRects: DOMRect[] = []
    for (const element of list.querySelectorAll<HTMLLIElement>(
      '.session-picker-row',
    )) {
      if (element.dataset.sessionId === gesture.sessionId) continue
      rowRects.push(element.getBoundingClientRect())
    }

    const dropIndex = getSessionDropIndex(
      rowRects.map((rect) => ({ top: rect.top, bottom: rect.bottom })),
      gesture.currentY,
    )
    const first = rowRects[0]
    const last = rowRects[rowRects.length - 1]
    const line =
      first && last
        ? {
            top:
              (dropIndex >= rowRects.length
                ? last.bottom
                : rowRects[dropIndex]!.top) - listRect.top,
            left: first.left - listRect.left,
            width: first.width,
          }
        : { top: 0, left: 0, width: listRect.width }

    gesture.dropIndex = dropIndex
    const ghost = gesture.active
      ? {
          x: gesture.currentX + 12,
          y: gesture.currentY + 10,
          width: gesture.ghostWidth,
          name: gesture.sessionName,
        }
      : null
    setDragState((current) => {
      if (
        current &&
        current.sessionId === gesture.sessionId &&
        current.dropIndex === dropIndex &&
        current.line?.top === line.top &&
        current.line?.left === line.left &&
        current.line?.width === line.width &&
        current.ghost?.x === ghost?.x &&
        current.ghost?.y === ghost?.y &&
        current.ghost?.width === ghost?.width
      ) {
        return current
      }
      return {
        sessionId: gesture.sessionId,
        dropIndex,
        line,
        ghost,
      }
    })
  }

  const runAutoScroll = () => {
    if (autoScrollFrameRef.current !== null) return
    const tick = () => {
      autoScrollFrameRef.current = null
      const gesture = dragRef.current
      const panel = panelRef.current
      if (!gesture?.active || !panel) return

      const rect = panel.getBoundingClientRect()
      const delta = getDragAutoScrollDelta(
        gesture.currentY,
        rect.top,
        rect.bottom,
      )
      if (delta !== 0) {
        const maxScroll = Math.max(0, panel.scrollHeight - panel.clientHeight)
        const next = Math.max(
          0,
          Math.min(maxScroll, panel.scrollTop + delta),
        )
        if (next !== panel.scrollTop) {
          panel.scrollTop = next
          updateDragFromPointer(gesture)
        }
      }
      autoScrollFrameRef.current = window.requestAnimationFrame(tick)
    }
    autoScrollFrameRef.current = window.requestAnimationFrame(tick)
  }

  const beginDrag = (
    event: PointerEvent<HTMLButtonElement>,
    session: Session,
    name: string,
    index: number,
  ) => {
    if (locked) return
    if (event.isPrimary === false) return
    if (event.pointerType === 'mouse' && event.button !== 0) return

    // The handle is a pointer-only affordance; focusing it here keeps keyboard
    // reordering available after a mouse or touch drag without selecting the row.
    event.preventDefault()
    event.currentTarget.focus()
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Pointer capture is an enhancement; the drag still works without it.
    }
    const row = event.currentTarget.closest<HTMLLIElement>('.session-picker-row')
    dragRef.current = {
      sessionId: session.id,
      sessionName: name,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      currentX: event.clientX,
      currentY: event.clientY,
      active: false,
      originIndex: index,
      dropIndex: index,
      handle: event.currentTarget,
      ghostWidth: row?.getBoundingClientRect().width ?? 240,
    }
  }

  const moveDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const gesture = dragRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    gesture.currentX = event.clientX
    gesture.currentY = event.clientY

    if (!gesture.active) {
      if (
        Math.hypot(
          event.clientX - gesture.startX,
          event.clientY - gesture.startY,
        ) < 4
      ) {
        return
      }
      gesture.active = true
      setAnnouncement(`Moving ${gesture.sessionName}. Release to drop.`)
      runAutoScroll()
    }

    event.preventDefault()
    updateDragFromPointer(gesture)
  }

  const finishDrag = (
    event: PointerEvent<HTMLButtonElement>,
    commit: boolean,
  ) => {
    const gesture = dragRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return

    if (commit && gesture.active) {
      // The list can scroll under a stationary pointer (wheel, trackpad, or
      // keyboard). Refresh the insertion index from the live geometry before
      // committing so the drop cannot use a stale position.
      gesture.currentX = event.clientX
      gesture.currentY = event.clientY
      updateDragFromPointer(gesture)
    }

    dragRef.current = null
    stopAutoScroll()
    setDragState(null)
    try {
      gesture.handle.releasePointerCapture(gesture.pointerId)
    } catch {
      // The capture may already be gone after a browser-level cancel.
    }
    if (!commit || !gesture.active) return

    if (gesture.dropIndex === gesture.originIndex) {
      setAnnouncement(`${gesture.sessionName} kept its position.`)
      return
    }
    onReorder(gesture.sessionId, gesture.dropIndex)
    setAnnouncement(
      `${gesture.sessionName} moved to position ${gesture.dropIndex + 1} of ${sessions.length}.`,
    )
  }

  const revealRowInPanel = (row: HTMLElement | null) => {
    if (!row) return
    window.requestAnimationFrame(() => {
      const panel = panelRef.current
      if (!panel || !row.isConnected) return
      const inset = 8
      const panelRect = panel.getBoundingClientRect()
      const rowRect = row.getBoundingClientRect()
      const maxScroll = Math.max(0, panel.scrollHeight - panel.clientHeight)
      if (rowRect.top < panelRect.top + inset) {
        panel.scrollTop = Math.max(
          0,
          Math.min(
            maxScroll,
            panel.scrollTop - (panelRect.top + inset - rowRect.top),
          ),
        )
      } else if (rowRect.bottom > panelRect.bottom - inset) {
        panel.scrollTop = Math.max(
          0,
          Math.min(
            maxScroll,
            panel.scrollTop + rowRect.bottom - (panelRect.bottom - inset),
          ),
        )
      }
    })
  }

  const handleDragHandleKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    session: Session,
    name: string,
    index: number,
  ) => {
    if (locked) return
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    event.stopPropagation()

    const direction = event.key === 'ArrowUp' ? -1 : 1
    const destination = index + direction
    if (destination < 0 || destination >= sessions.length) return
    const row = event.currentTarget.closest<HTMLElement>(
      '.session-picker-row',
    )
    onReorder(session.id, destination)
    setAnnouncement(
      `${name} moved ${direction < 0 ? 'up' : 'down'} to position ${destination + 1} of ${sessions.length}.`,
    )
    // Keyboard moves can take the focused row outside the scrollable list.
    // Reveal it after React applies the new order, matching pointer drags.
    revealRowInPanel(row)
  }

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (locked) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      event.stopPropagation()
      openMenu()
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      event.stopPropagation()
      if (menuOpen) closeMenu()
      else openMenu()
    }
  }

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = event.target
    if (!(current instanceof HTMLButtonElement)) return
    if (!current.hasAttribute('data-session-select-button')) return
    const buttons = Array.from(
      panelRef.current?.querySelectorAll<HTMLButtonElement>(
        '[data-session-select-button]',
      ) ?? [],
    )
    const index = buttons.indexOf(current)
    if (index < 0) return
    if (
      event.key === 'ArrowDown' ||
      event.key === 'ArrowUp' ||
      event.key === 'Home' ||
      event.key === 'End'
    ) {
      event.preventDefault()
      event.stopPropagation()
      let next = index
      if (event.key === 'ArrowDown') next = (index + 1) % buttons.length
      else if (event.key === 'ArrowUp')
        next = (index - 1 + buttons.length) % buttons.length
      else if (event.key === 'Home') next = 0
      else next = buttons.length - 1
      buttons[next]?.focus()
      return
    }
    if (
      event.key.length === 1 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      const now = Date.now()
      const previous = typeaheadRef.current
      const text =
        now - previous.at > 700 ? event.key : `${previous.text}${event.key}`
      typeaheadRef.current = { text, at: now }
      const match = buttons.find((button) =>
        (button.dataset.sessionName ?? '')
          .toLocaleLowerCase()
          .startsWith(text.toLocaleLowerCase()),
      )
      if (match) {
        event.preventDefault()
        match.focus()
      }
    }
  }

  return (
    <section className="panel session-panel" aria-labelledby="session-title">
      <div className="panel-heading">
        <h2 id="session-title">Sessions</h2>
      </div>

        <div className="session-controls">
          <div className="session-picker" ref={rootRef}>
            <button
              ref={triggerRef}
              type="button"
              className="cube-select session-select session-picker-trigger"
              aria-haspopup="listbox"
              aria-expanded={menuOpen}
              aria-controls="session-picker-list"
              aria-label={`Active session: ${activeName}. Choose a session or reorder the list.`}
              disabled={locked}
              data-testid="session-select"
              title={
                locked
                  ? 'Finish or reset the current timer before switching sessions'
                  : `${activeName} · choose or reorder sessions`
              }
              onClick={() => {
                if (locked) return
                if (menuOpen) closeMenu()
                else openMenu()
              }}
              onKeyDown={handleTriggerKeyDown}
            >
              <span className="cube-select-value">{activeName}</span>
              <span className="cube-select-chevron" aria-hidden="true" />
            </button>

            {menuOpen && menuPosition
              ? createPortal(
              <div
                ref={panelRef}
                className={`session-picker-panel is-fixed${dragState ? ' is-reordering' : ''}`}
                id="session-picker-list"
                role="group"
                aria-label="Session list"
                data-timer-space-ignore="true"
                style={{
                  left: menuPosition.left,
                  top: menuPosition.top,
                  width: menuPosition.width,
                  maxHeight: menuPosition.maxHeight,
                }}
                onKeyDown={handleMenuKeyDown}
                onScroll={() => {
                  const gesture = dragRef.current
                  if (gesture?.active) updateDragFromPointer(gesture)
                }}
              >
                <div className="session-picker-heading">
                  <span>Sessions</span>
                  <span>{sessions.length}</span>
                </div>
                <ul className="session-picker-list" ref={listRef}>
                  {dragState?.line ? (
                    <li
                      className="session-picker-drop-line"
                      style={{
                        top: dragState.line.top,
                        left: dragState.line.left,
                        width: dragState.line.width,
                      }}
                      data-testid="session-drop-indicator"
                      aria-hidden="true"
                    />
                  ) : null}
                  {sessions.map((session, index) => {
                    const name = sessionName(session, displayNames[index])
                    const active = session.id === activeSessionId
                    return (
                      <li
                        key={session.id}
                        className={`session-picker-row${dragState?.sessionId === session.id ? ' is-dragging' : ''}`}
                        data-session-id={session.id}
                      >
                        <button
                          type="button"
                          className="session-drag-handle"
                          aria-label={`Reorder ${name}`}
                          aria-describedby="session-picker-hint"
                          aria-keyshortcuts="ArrowUp ArrowDown"
                          title={`Drag ${name} to reorder, or press the up and down arrow keys`}
                          data-testid={`session-drag-handle-${session.id}`}
                          onPointerDown={(event) =>
                            beginDrag(event, session, name, index)
                          }
                          onPointerMove={moveDrag}
                          onPointerUp={(event) => finishDrag(event, true)}
                          onPointerCancel={(event) => finishDrag(event, false)}
                          onLostPointerCapture={(event) => {
                            if (
                              dragRef.current?.pointerId === event.pointerId
                            ) {
                              finishDrag(event, false)
                            }
                          }}
                          onKeyDown={(event) =>
                            handleDragHandleKeyDown(
                              event,
                              session,
                              name,
                              index,
                            )
                          }
                        >
                          <GripVerticalIcon size={13} />
                        </button>
                        <button
                          ref={active ? activeOptionRef : undefined}
                          type="button"
                          className={`session-picker-option${active ? ' is-active' : ''}`}
                          aria-current={active ? 'true' : undefined}
                          aria-label={`Select session ${name}`}
                          data-session-select-button="true"
                          data-session-name={name}
                          data-testid={`session-option-${session.id}`}
                          onClick={() => chooseSession(session, name)}
                        >
                          <span className="session-picker-name">{name}</span>
                          <span className="session-picker-meta">
                            {getEventLabel(session.event ?? '333')} ·{' '}
                            {formatSolveCount(session.solves.length)}
                            {isCompetitionSession(session) ? (
                              <span
                                className="competition-format-badge"
                                data-testid={`session-format-${session.id}`}
                              >
                                {competitionFormatLabel(session.competitionFormat)}
                              </span>
                            ) : null}
                          </span>
                          {active ? (
                            <CheckIcon
                              size={13}
                              className="session-picker-check"
                            />
                          ) : null}
                        </button>
                      </li>
                    )
                  })}
                </ul>
                <p className="session-picker-hint" id="session-picker-hint">
                  Choose a name to switch. Drag a row's handle, or focus the
                  handle and press the arrow keys, to reorder. The active
                  session and solves stay unchanged.
                </p>
                <span className="sr-only" role="status" aria-live="polite">
                  {announcement}
                </span>
              </div>,
              document.body,
            )
            : null}
            {dragState?.ghost
              ? createPortal(
                  <div
                    className="session-drag-ghost"
                    aria-hidden="true"
                    data-testid="session-drag-ghost"
                    style={{
                      left: dragState.ghost.x,
                      top: dragState.ghost.y,
                      width: dragState.ghost.width,
                    }}
                  >
                    <span className="session-picker-name">
                      {dragState.ghost.name}
                    </span>
                    <span className="session-drag-ghost-meta">
                      Drop to reorder
                    </span>
                  </div>,
                  document.body,
                )
              : null}
          </div>
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
    </section>
  )
}
