import { useLayoutEffect, type MouseEventHandler, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'

interface HistoryActionMenuProps {
  menuRef: RefObject<HTMLDivElement | null>
  rect: DOMRect
  label: string
  title: string
  time: ReactNode
  secondary?: ReactNode
  preview?: ReactNode
  editor?: ReactNode
  footer: ReactNode
  children: ReactNode
}

export function HistoryActionMenu({ menuRef, rect, label, title, time, secondary, preview, editor, footer, children }: HistoryActionMenuProps) {
  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!menu) return
    const { offsetWidth, offsetHeight } = menu
    const right = rect.right + 8
    const maxLeft = window.innerWidth - offsetWidth - 8
    const left = right <= maxLeft ? right : Math.max(8, Math.min(rect.left, maxLeft))
    const top = Math.max(8, Math.min(rect.top, window.innerHeight - offsetHeight - 8))
    menu.style.left = `${left}px`
    menu.style.top = `${top}px`
  })

  return createPortal(
    <div ref={menuRef} className="solve-menu" role="menu" aria-label={label}
      onKeyDown={event => {
        if (!(event.target instanceof HTMLElement) || event.target.getAttribute('role') !== 'menuitem') return
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
        const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)'))
        const index = items.indexOf(event.target)
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
        event.preventDefault()
        items[next]?.focus()
      }}>
      <div className="solve-menu-header">
        <span className="solve-menu-title">{title}</span>
        <strong className="solve-menu-time">{time}</strong>
        {secondary ? <span className="solve-menu-effective">{secondary}</span> : null}
        {preview}
      </div>
      <div className="solve-menu-actions">{children}</div>
      {editor}
      <div className="solve-menu-footer">{footer}</div>
    </div>,
    document.body,
  )
}

interface HistoryMenuActionProps {
  icon: ReactNode
  onClick: MouseEventHandler<HTMLButtonElement>
  danger?: boolean
  disabled?: boolean
  children: ReactNode
}

export function HistoryMenuAction({ icon, onClick, danger, disabled, children }: HistoryMenuActionProps) {
  return (
    <button type="button" role="menuitem" className={`solve-menu-action${danger ? ' is-danger' : ''}`}
      disabled={disabled} onClick={onClick}>
      {icon}
      {children}
    </button>
  )
}
