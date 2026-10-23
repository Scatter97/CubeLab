import { useEffect, useRef, type KeyboardEvent } from 'react'
import { AlertIcon } from './Icons'

interface ConfirmDialogProps {
  open: boolean
  solveCount: number
  onCancel: () => void
  onConfirm: () => void
}

export function ConfirmDialog({
  open,
  solveCount,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    if (open && !dialog.open) {
      dialog.showModal()
    } else if (!open && dialog.open) {
      dialog.close()
    }
  }, [open])

  const handleKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== 'Tab') return

    const dialog = dialogRef.current
    if (!dialog) return

    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => element.getClientRects().length > 0)

    if (focusable.length === 0) {
      event.preventDefault()
      dialog.focus()
      return
    }

    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (!first || !last) {
      event.preventDefault()
      dialog.focus()
      return
    }

    const active = document.activeElement

    if (event.shiftKey) {
      if (active === first || active === dialog || !dialog.contains(active)) {
        event.preventDefault()
        last.focus()
      }
    } else if (active === last || !dialog.contains(active)) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="confirm-dialog"
      aria-labelledby="clear-title"
      aria-describedby="clear-description"
      onKeyDown={handleKeyDown}
      onCancel={(event) => {
        event.preventDefault()
        onCancel()
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) onCancel()
      }}
    >
      <div className="dialog-content">
        <span className="dialog-icon" aria-hidden="true">
          <AlertIcon size={22} />
        </span>
        <span className="eyebrow">Clear session</span>
        <h2 id="clear-title">Delete every solve?</h2>
        <p id="clear-description">
          This will permanently remove{' '}
          <strong>
            {solveCount} {solveCount === 1 ? 'solve' : 'solves'}
          </strong>{' '}
          from this browser. Your scramble queue and settings stay intact.
        </p>
        <div className="dialog-actions">
          <button
            type="button"
            className="button button-secondary"
            onClick={onCancel}
            autoFocus
          >
            Keep solves
          </button>
          <button
            type="button"
            className="button button-danger"
            onClick={onConfirm}
          >
            Clear session
          </button>
        </div>
      </div>
    </dialog>
  )
}
