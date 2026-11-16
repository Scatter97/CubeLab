import { useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useDismissablePopover } from '../../hooks/useDismissablePopover'

export function TrainingEndConfirmation({ anchor, leave, onClose, onConfirm }: {
  anchor: HTMLButtonElement
  leave: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  const triggerRef = useRef(anchor)
  const panelRef = useRef<HTMLDivElement>(null)
  const keepRef = useRef<HTMLButtonElement>(null)
  useDismissablePopover({ open: true, onClose, triggerRef, panelRef })

  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    const position = () => {
      const rect = anchor.getBoundingClientRect()
      const maxLeft = window.innerWidth - panel.offsetWidth - 8
      const below = rect.bottom + 5
      const top = below + panel.offsetHeight <= window.innerHeight - 8 ? below : rect.top - panel.offsetHeight - 5
      panel.style.left = `${Math.max(8, Math.min(rect.left, maxLeft))}px`
      panel.style.top = `${Math.max(8, top)}px`
    }
    position()
    keepRef.current?.focus({ preventScroll: true })
    window.addEventListener('resize', position)
    window.addEventListener('scroll', position, true)
    return () => {
      window.removeEventListener('resize', position)
      window.removeEventListener('scroll', position, true)
    }
  }, [anchor])

  return createPortal(<div ref={panelRef} className="panel training-end-confirmation" role="group"
    aria-label={leave ? 'Leave Training session' : 'Confirm end session'} data-timer-space-ignore>
    <button type="button" className="button button-secondary" onClick={onConfirm}>{leave ? 'End session and leave' : 'End session'}</button>
    <button type="button" className="button button-secondary" ref={keepRef} onClick={() => {
      onClose()
      anchor.focus({ preventScroll: true })
    }}>Keep practicing</button>
  </div>, document.body)
}
