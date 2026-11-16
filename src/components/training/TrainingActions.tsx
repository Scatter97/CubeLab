import { useId, type ReactNode } from 'react'

export function TrainingActions({ label, disabled, indicator, symbol = '⋯', focusFallback, children }: {
  label: string
  disabled?: boolean
  indicator?: number
  symbol?: string
  focusFallback?: boolean
  children: (close: () => void) => ReactNode
}) {
  const id = useId()
  const triggerId = `${id}-trigger`
  return (
    <>
      <button id={triggerId} type="button" className="training-action-trigger" aria-label={label} title={label} data-training-focus-fallback={focusFallback || undefined}
        popoverTarget={id} disabled={disabled} data-timer-space-ignore>
        <span aria-hidden="true">{symbol}</span>
        {indicator ? <span className="count-pill" aria-hidden="true">{indicator}</span> : null}
      </button>
      <div id={id} popover="auto" className="panel training-action-popover" aria-label={label} data-timer-space-ignore>
        {children(() => {
          document.getElementById(id)?.hidePopover?.()
          document.getElementById(triggerId)?.focus({ preventScroll: true })
        })}
      </div>
    </>
  )
}
