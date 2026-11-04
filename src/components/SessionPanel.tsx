import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import type { Session } from '../types'
import {
  MAX_SESSION_NAME_LENGTH,
  getSessionDisplayNames,
  getSessionNameError,
  nextSessionName,
} from '../lib/sessions'
import { getEventLabel } from '../lib/events'
import { formatSolveCount } from '../lib/format'
import {
  getDragAutoScrollDelta,
  getSessionDropIndex,
} from '../lib/sessionDrag'
import { useDismissablePopover } from '../hooks/useDismissablePopover'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  CloseIcon,
  GripVerticalIcon,
  PencilIcon,
  PlusIcon,
  SettingsIcon,
} from './Icons'

interface SessionPanelProps {
  sessions: readonly Session[]
  activeSessionId: string
  locked: boolean
  onCreate?: (name: string) => boolean
  onRequestCreate?: () => void
  onRename: (id: string, name: string) => boolean
  onSelect: (id: string) => void
  onOpenSessionSettings: () => void
  onMove: (id: string, direction: -1 | 1) => void
  onReorder: (id: string, targetIndex: number) => void
}

type EditMode = 'create' | 'rename'

interface SessionDragState {
  sessionId: string
  dropIndex: number
  line: { top: number; left: number; width: number } | null
}

interface SessionDragGesture {
  sessionId: string
  sessionName: string
  pointerId: number
  startX: number
  startY: number
  currentY: number
  active: boolean
  originIndex: number
  dropIndex: number
  handle: HTMLButtonElement
}

function sessionName(session: Session, displayName: string | undefined): string {
  return displayName ?? session.name
}

export function SessionPanel({
  sessions,
  activeSessionId,
  locked,
  onCreate,
  onRequestCreate,
  onRename,
  onSelect,
  onOpenSessionSettings,
  onMove,
  onReorder,
}: SessionPanelProps) {
  const [editing, setEditing] = useState<EditMode | null>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuLayout, setMenuLayout] = useState({ above: false, maxHeight: 430 })
  const [announcement, setAnnouncement] = useState('')
  const [dragState, setDragState] = useState<SessionDragState | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const activeOptionRef = useRef<HTMLButtonElement>(null)
  const typeaheadRef = useRef({ text: '', at: 0 })
  const restoreSelectFocus = useRef(false)
  const dragRef = useRef<SessionDragGesture | null>(null)
  const autoScrollFrameRef = useRef<number | null>(null)

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
    if (!editing) return
    const input = inputRef.current
    if (!input) return
    input.focus()
    input.select()
  }, [editing])

  useEffect(() => {
    if (editing || !restoreSelectFocus.current) return
    restoreSelectFocus.current = false
    triggerRef.current?.focus()
  }, [editing])

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
      const spaceBelow = window.innerHeight - rect.bottom - 10
      const spaceAbove = rect.top - 10
      const above = spaceBelow < 220 && spaceAbove > spaceBelow
      const maxHeight = Math.max(
        160,
        Math.min(430, above ? spaceAbove : spaceBelow),
      )
      setMenuLayout((current) =>
        current.above === above && current.maxHeight === maxHeight
          ? current
          : { above, maxHeight },
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
    if (!menuOpen) return
    const frame = window.requestAnimationFrame(() => {
      activeOptionRef.current?.focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [menuOpen])

  const startCreate = () => {
    if (locked) return
    if (onRequestCreate) {
      onRequestCreate()
      return
    }
    setDraft(nextSessionName(sessions))
    setError(null)
    setEditing('create')
  }

  const startRename = () => {
    if (locked || !activeSession) return
    setDraft(activeSession.name)
    setError(null)
    setEditing('rename')
  }

  const finishEditing = () => {
    restoreSelectFocus.current = true
    setEditing(null)
    setError(null)
  }

  const cancelEditing = () => {
    if (locked) return
    finishEditing()
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editing || locked) return

    const nameError = getSessionNameError(
      draft,
      sessions,
      editing === 'rename' ? activeSessionId : undefined,
    )
    if (nameError) {
      setError(nameError)
      return
    }

    const saved =
      editing === 'create'
        ? (onCreate?.(draft) ?? false)
        : (onRename?.(activeSessionId, draft) ?? false)
    if (!saved) {
      setError('Could not save the session. Try another name.')
      return
    }

    finishEditing()
  }

  const chooseSession = (session: Session, name: string) => {
    if (locked) return
    onSelect(session.id)
    setAnnouncement(`Switched to ${name}.`)
    closeMenu()
    triggerRef.current?.focus()
  }

  const moveSession = (session: Session, name: string, direction: -1 | 1) => {
    if (locked) return
    onMove(session.id, direction)
    const index = sessions.findIndex((entry) => entry.id === session.id)
    const destination = index + direction
    if (index >= 0 && destination >= 0 && destination < sessions.length) {
      setAnnouncement(
        `${name} moved ${direction < 0 ? 'up' : 'down'} to position ${destination + 1}.`,
      )
    }
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
    setDragState((current) => {
      if (
        current &&
        current.sessionId === gesture.sessionId &&
        current.dropIndex === dropIndex &&
        current.line?.top === line.top &&
        current.line?.left === line.left &&
        current.line?.width === line.width
      ) {
        return current
      }
      return {
        sessionId: gesture.sessionId,
        dropIndex,
        line,
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
    dragRef.current = {
      sessionId: session.id,
      sessionName: name,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      currentY: event.clientY,
      active: false,
      originIndex: index,
      dropIndex: index,
      handle: event.currentTarget,
    }
  }

  const moveDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const gesture = dragRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
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

      {editing ? (
        <form
          className="session-edit"
          onSubmit={handleSubmit}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation()
              cancelEditing()
            }
          }}
        >
          <label className="sr-only" htmlFor="session-name-input">
            Session name
          </label>
          <input
            id="session-name-input"
            ref={inputRef}
            type="text"
            className="session-name-input"
            value={draft}
            maxLength={MAX_SESSION_NAME_LENGTH}
            disabled={locked}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'session-name-error' : undefined}
            data-testid="session-name-input"
            onChange={(event) => {
              setDraft(event.target.value)
              if (error) setError(null)
            }}
          />
          <button
            type="submit"
            className="icon-button session-action"
            aria-label="Save session name"
            title="Save session name"
            disabled={locked}
            data-testid="save-session-name"
          >
            <CheckIcon size={15} />
          </button>
          <button
            type="button"
            className="icon-button session-action"
            aria-label="Cancel session name"
            title="Cancel"
            disabled={locked}
            data-testid="cancel-session-name"
            onClick={cancelEditing}
          >
            <CloseIcon size={15} />
          </button>
        </form>
      ) : (
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

            {menuOpen ? (
              <div
                ref={panelRef}
                className={`session-picker-panel${menuLayout.above ? ' is-above' : ''}${dragState ? ' is-reordering' : ''}`}
                id="session-picker-list"
                role="group"
                aria-label="Session list"
                data-timer-space-ignore="true"
                style={{ maxHeight: menuLayout.maxHeight }}
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
                          </span>
                          {active ? (
                            <CheckIcon
                              size={13}
                              className="session-picker-check"
                            />
                          ) : null}
                        </button>
                        <span className="session-picker-reorder">
                          <button
                            type="button"
                            className="session-reorder-button"
                            aria-label={`Move ${name} up`}
                            aria-disabled={locked || index === 0}
                            title={`Move ${name} up`}
                            data-testid={`session-move-up-${session.id}`}
                            onClick={() => {
                              if (locked || index === 0) return
                              moveSession(session, name, -1)
                            }}
                          >
                            <ArrowUpIcon size={12} />
                          </button>
                          <button
                            type="button"
                            className="session-reorder-button"
                            aria-label={`Move ${name} down`}
                            aria-disabled={
                              locked || index === sessions.length - 1
                            }
                            title={`Move ${name} down`}
                            data-testid={`session-move-down-${session.id}`}
                            onClick={() => {
                              if (locked || index === sessions.length - 1) return
                              moveSession(session, name, 1)
                            }}
                          >
                            <ArrowDownIcon size={12} />
                          </button>
                        </span>
                      </li>
                    )
                  })}
                </ul>
                <p className="session-picker-hint" id="session-picker-hint">
                  Choose a name to switch. Drag a handle, or focus it and press
                  the arrow keys; the move buttons also reorder. The active
                  session and solves stay unchanged.
                </p>
                <span className="sr-only" role="status" aria-live="polite">
                  {announcement}
                </span>
              </div>
            ) : null}
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
            aria-label="Rename session"
            title={
              locked
                ? 'Finish or reset the current timer before renaming a session'
                : 'Rename the active session'
            }
            disabled={locked}
            data-testid="rename-session"
            onClick={startRename}
          >
            <PencilIcon size={15} />
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
      )}

      {error ? (
        <p
          id="session-name-error"
          className="session-error"
          role="alert"
          data-testid="session-error"
        >
          {error}
        </p>
      ) : null}
    </section>
  )
}
