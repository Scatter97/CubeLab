import { useEffect, useState, type ReactNode } from 'react'
import { useModalDialog } from '../hooks/useModalDialog'
import { AlertIcon } from './Icons'

interface ConfirmDialogProps {
  open: boolean
  eyebrow: string
  title: string
  description: ReactNode
  cancelLabel: string
  confirmLabel: string
  requireText?: string
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
  requireText,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const { dialogRef, handleKeyDown } = useModalDialog(open)
  const [confirmationText, setConfirmationText] = useState('')
  const confirmationMatches = !requireText || confirmationText === requireText

  useEffect(() => {
    // Reset typed confirmation whenever the dialog opens or changes target.
    // oxlint-disable-next-line react/set-state-in-effect
    if (open) setConfirmationText('')
  }, [open, requireText])

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
        {requireText ? (
          <label className="confirm-typed-field">
            <span>
              Type <strong>{requireText}</strong> to confirm
            </span>
            <input
              type="text"
              value={confirmationText}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              data-testid="confirm-text"
              aria-label={`Type ${requireText} to confirm`}
              onChange={(event) => setConfirmationText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && confirmationMatches) {
                  event.preventDefault()
                  onConfirm()
                }
              }}
            />
          </label>
        ) : null}
        <div className="dialog-actions">
          <button
            type="button"
            className="button button-secondary"
            onClick={onCancel}
            autoFocus={!requireText}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className="button button-danger"
            disabled={!confirmationMatches}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  )
}
