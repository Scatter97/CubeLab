import type { ReactNode } from 'react'
import { useModalDialog } from '../hooks/useModalDialog'
import { AlertIcon } from './Icons'

interface ConfirmDialogProps {
  open: boolean
  eyebrow: string
  title: string
  description: ReactNode
  cancelLabel: string
  confirmLabel: string
  onCancel: () => void
  onConfirm: () => void
}

export function ConfirmDialog({
  open,
  eyebrow,
  title,
  description,
  cancelLabel,
  confirmLabel,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const { dialogRef, handleKeyDown } = useModalDialog(open)

  return (
    <dialog
      ref={dialogRef}
      className="confirm-dialog"
      aria-labelledby="confirm-title"
      aria-describedby="confirm-description"
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
        <span className="eyebrow">{eyebrow}</span>
        <h2 id="confirm-title">{title}</h2>
        <p id="confirm-description">{description}</p>
        <div className="dialog-actions">
          <button
            type="button"
            className="button button-secondary"
            onClick={onCancel}
            autoFocus
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className="button button-danger"
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  )
}
