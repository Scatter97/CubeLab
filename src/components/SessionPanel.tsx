import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
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
import { useDismissablePopover } from '../hooks/useDismissablePopover'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  CloseIcon,
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
}

type EditMode = 'create' | 'rename'

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
}: SessionPanelProps) {
  const [editing, setEditing] = useState<EditMode | null>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuLayout, setMenuLayout] = useState({ above: false, maxHeight: 430 })
  const [announcement, setAnnouncement] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const activeOptionRef = useRef<HTMLButtonElement>(null)
  const typeaheadRef = useRef({ text: '', at: 0 })
  const restoreSelectFocus = useRef(false)

  const activeSession =
    sessions.find((session) => session.id === activeSessionId) ?? sessions[0]
  const displayNames = getSessionDisplayNames(sessions)
  const activeName = activeSession
    ? sessionName(
        activeSession,
        displayNames[sessions.findIndex((session) => session.id === activeSession.id)],
      )
    : 'No sessions'

  const closeMenu = () => setMenuOpen(false)

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

  useEffect(() => {
    if (!menuOpen) return
    const updateLayout = () => {
      const trigger = triggerRef.current
      if (!trigger) return
      const rect = trigger.getBoundingClientRect()
      const spaceBelow = window.innerHeight - rect.bottom - 10
      const spaceAbove = rect.top - 10
      const above = spaceBelow < 220 && spaceAbove > spaceBelow
      setMenuLayout({
        above,
        maxHeight: Math.max(160, Math.min(430, above ? spaceAbove : spaceBelow)),
      })
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

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (locked) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      event.stopPropagation()
      setMenuOpen(true)
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      event.stopPropagation()
      setMenuOpen((open) => !open)
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
                setMenuOpen((open) => !open)
              }}
              onKeyDown={handleTriggerKeyDown}
            >
              <span className="cube-select-value">{activeName}</span>
              <span className="cube-select-chevron" aria-hidden="true" />
            </button>

            {menuOpen ? (
              <div
                ref={panelRef}
                className={`session-picker-panel${menuLayout.above ? ' is-above' : ''}`}
                id="session-picker-list"
                role="group"
                aria-label="Session list"
                data-timer-space-ignore="true"
                style={{ maxHeight: menuLayout.maxHeight }}
                onKeyDown={handleMenuKeyDown}
              >
                <div className="session-picker-heading">
                  <span>Sessions</span>
                  <span>{sessions.length}</span>
                </div>
                <ul className="session-picker-list">
                  {sessions.map((session, index) => {
                    const name = sessionName(session, displayNames[index])
                    const active = session.id === activeSessionId
                    return (
                      <li key={session.id} className="session-picker-row">
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
                <p className="session-picker-hint">
                  Choose a name to switch. Reorder with the arrow buttons; the
                  active session and solves stay unchanged.
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
