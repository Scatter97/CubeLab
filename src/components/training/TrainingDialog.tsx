import { useId, useLayoutEffect, type ReactNode, type RefCallback } from 'react'
import { TrainingSaveRecovery } from './TrainingSaveRecovery'
import { useModalDialog } from '../../hooks/useModalDialog'

interface Props {
  title: string
  onClose: () => void
  children: ReactNode
  className?: string
  toastHostRef?: RefCallback<HTMLDivElement>
  closeLabel?: string
  closeDisabled?: boolean
  dismissible?: boolean
}

export function TrainingDialog({ title, onClose, children, className, toastHostRef, closeLabel = 'Close', closeDisabled, dismissible = true }: Props) {
  const { dialogRef, handleKeyDown } = useModalDialog(true)
  const titleId = useId()
  useLayoutEffect(() => {
    const dialog = dialogRef.current
    const trigger = document.activeElement
    const fallback = trigger?.closest<HTMLElement>('.history-panel')
    return () => {
      if (dialog?.open) dialog.close()
      if (trigger instanceof HTMLElement && trigger.isConnected && trigger !== document.body) {
        trigger.focus({ preventScroll: true })
      }
      queueMicrotask(() => {
        if (document.activeElement !== document.body) return
        const target = document.querySelector<HTMLElement>('dialog[open] .settings-close')
          ?? (fallback?.isConnected ? fallback : null)
          ?? document.querySelector<HTMLElement>('[data-training-focus-fallback]')
          ?? document.querySelector<HTMLElement>('.app-nav [aria-current="page"]')
        target?.focus({ preventScroll: true })
      })
    }
  }, [dialogRef])

  return (
    <dialog ref={dialogRef} className={`confirm-dialog settings-dialog training-dialog${className ? ` ${className}` : ''}`} aria-labelledby={titleId}
      onKeyDown={handleKeyDown} onCancel={event => {
        if (event.target !== event.currentTarget) return
        event.preventDefault()
        if (dismissible && !closeDisabled) onClose()
      }}>
      <header className="settings-header">
        <h2 id={titleId}>{title}</h2>
        {dismissible ? <button type="button" className="button button-secondary settings-close" onClick={onClose} disabled={closeDisabled} autoFocus>{closeLabel}</button> : null}
      </header>
      <div className="dialog-content"><TrainingSaveRecovery />{children}</div>
      {toastHostRef ? <div ref={toastHostRef} /> : null}
    </dialog>
  )
}
