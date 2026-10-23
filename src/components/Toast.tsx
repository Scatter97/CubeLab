import { CheckIcon } from './Icons'

export interface ToastData {
  id: string
  message: string
  actionLabel?: string
  onAction?: () => void
}

interface ToastProps {
  toast: ToastData | null
  onAction: () => void
  onDismiss: () => void
}

export function Toast({ toast, onAction, onDismiss }: ToastProps) {
  if (!toast) return null

  return (
    <div className="toast" role="status" aria-live="polite" key={toast.id}>
      <span className="toast-icon" aria-hidden="true">
        <CheckIcon size={15} />
      </span>
      <span className="toast-message">{toast.message}</span>
      {toast.actionLabel ? (
        <button type="button" className="toast-action" onClick={onAction}>
          {toast.actionLabel}
        </button>
      ) : null}
      <button
        type="button"
        className="toast-dismiss"
        onClick={onDismiss}
        aria-label="Dismiss notification"
      >
        ×
      </button>
    </div>
  )
}
