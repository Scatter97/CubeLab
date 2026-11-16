import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'

export const DEFAULT_STATS_SPLIT = 36
const MIN_HISTORY_SPACE = 120

interface Props {
  percent: number
  onPercentChange: (percent: number) => void
  historyLabel: 'Solves' | 'Attempts'
  statistics: (props: { style?: CSSProperties; onMinimumHeightChange?: (height: number) => void }) => ReactNode
  children: ReactNode
}

interface Drag {
  pointerId: number
  startY: number
  startHeight: number
  scale: number
}

export function SidebarSplit({ percent, onPercentChange, historyLabel, statistics, children }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const dividerRef = useRef<HTMLDivElement>(null)
  const [geometry, setGeometry] = useState({ height: 0, grip: 0 })
  const { height, grip } = geometry
  const [minimum, setMinimum] = useState(0)
  const [dragHeight, setDragHeight] = useState<number | null>(null)
  const drag = useRef<Drag | null>(null)
  const [desktop, setDesktop] = useState(() => window.matchMedia?.('(min-width: 901px)').matches ?? false)

  useLayoutEffect(() => {
    const media = window.matchMedia?.('(min-width: 901px)')
    const update = () => {
      if (!media?.matches) {
        drag.current = null
        setDragHeight(null)
      }
      setDesktop(media?.matches ?? false)
    }
    if (!media) return
    if (media.addEventListener) {
      media.addEventListener('change', update)
      return () => media.removeEventListener('change', update)
    }
    media.addListener(update)
    return () => media.removeListener(update)
  }, [])

  useLayoutEffect(() => {
    if (!desktop || !ref.current) return
    const container = ref.current
    const divider = dividerRef.current!
    const update = () => {
      const css = getComputedStyle(divider)
      const next = {
        height: container.clientHeight,
        grip: divider.offsetHeight + parseFloat(css.marginTop) + parseFloat(css.marginBottom),
      }
      setGeometry(previous => previous.height === next.height && previous.grip === next.grip ? previous : next)
    }
    update()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update)
      return () => window.removeEventListener('resize', update)
    }
    const observer = new ResizeObserver(update)
    observer.observe(container)
    observer.observe(divider)
    return () => observer.disconnect()
  }, [desktop])

  const max = Math.max(0, height - grip - MIN_HISTORY_SPACE)
  const min = Math.min(minimum, max)
  const clamp = (value: number) => Math.min(max, Math.max(min, value))
  const pixels = clamp(dragHeight ?? Math.round(height * percent / 100))
  const asPercent = (value: number) => Math.round(value / height * 100)
  const saveHeight = (value: number) => {
    if (height > 0) onPercentChange(Math.min(95, Math.max(5, asPercent(clamp(value)))))
  }
  const reset = () => onPercentChange(DEFAULT_STATS_SPLIT)
  const cancelDrag = (pointerId: number) => {
    if (drag.current?.pointerId !== pointerId) return
    drag.current = null
    setDragHeight(null)
  }

  return (
    <div ref={ref} className="sidebar-split">
      {statistics(desktop ? {
        style: { height: height > 0 ? pixels : undefined },
        onMinimumHeightChange: setMinimum,
      } : {})}
      {desktop ? (
        <div
          ref={dividerRef}
          className={`sidebar-divider${dragHeight !== null ? ' is-dragging' : ''}`}
          role="separator"
          aria-orientation="horizontal"
          aria-label={`Resize Statistics and ${historyLabel} panels`}
          aria-valuemin={height > 0 ? asPercent(min) : 0}
          aria-valuemax={height > 0 ? asPercent(max) : 100}
          aria-valuenow={height > 0 ? asPercent(pixels) : undefined}
          aria-valuetext={height > 0 ? `Statistics ${asPercent(pixels)}%, ${historyLabel} ${100 - asPercent(pixels)}%` : undefined}
          tabIndex={0}
          data-sidebar-divider="true"
          data-timer-space-ignore
          data-divider={`stats-${historyLabel.toLowerCase()}`}
          data-resize-handle="true"
          data-testid={`stats-${historyLabel.toLowerCase()}-divider`}
          data-testid-alt="sidebar-resize-handle"
          onPointerDown={event => {
            if (event.button !== 0 || drag.current || !ref.current) return
            event.preventDefault()
            const container = ref.current
            drag.current = {
              pointerId: event.pointerId,
              startY: event.clientY,
              startHeight: pixels,
              scale: container.getBoundingClientRect().height / container.offsetHeight || 1,
            }
            try {
              event.currentTarget.setPointerCapture(event.pointerId)
            } catch {
              // Synthetic or already-ended pointers may have no capture target.
            }
            setDragHeight(pixels)
          }}
          onPointerMove={event => {
            const current = drag.current
            if (current?.pointerId !== event.pointerId) return
            setDragHeight(clamp(current.startHeight + (event.clientY - current.startY) / current.scale))
          }}
          onPointerUp={event => {
            const current = drag.current
            if (current?.pointerId !== event.pointerId) return
            cancelDrag(event.pointerId)
            if (event.clientY !== current.startY) {
              saveHeight(current.startHeight + (event.clientY - current.startY) / current.scale)
            }
          }}
          onPointerCancel={event => cancelDrag(event.pointerId)}
          onLostPointerCapture={event => cancelDrag(event.pointerId)}
          onDoubleClick={reset}
          onKeyDown={event => {
            const step = event.shiftKey ? 48 : 16
            switch (event.key) {
              case 'ArrowDown':
              case 'ArrowRight':
                saveHeight(pixels + step)
                break
              case 'ArrowUp':
              case 'ArrowLeft':
                saveHeight(pixels - step)
                break
              case 'Home':
                saveHeight(min)
                break
              case 'End':
                saveHeight(max)
                break
              case 'Enter':
              case ' ':
                reset()
                break
              default:
                return
            }
            event.preventDefault()
          }}
        />
      ) : null}
      {children}
    </div>
  )
}
