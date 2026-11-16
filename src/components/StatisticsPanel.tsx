import { useCallback, useId, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react'

interface Props {
  count: string
  empty: string
  hasRows: boolean
  renderRows: (measurement: boolean) => ReactNode
  headingAction?: ReactNode
  onMinimumHeightChange?: (height: number) => void
  style?: CSSProperties
}

export function StatisticsPanel({ count, empty, hasRows, renderRows, headingAction, onMinimumHeightChange, style }: Props) {
  const titleId = useId()
  const measure = useRef<HTMLDivElement>(null)
  const reportMinimum = useCallback(() => {
    const height = measure.current?.offsetHeight
    if (height) onMinimumHeightChange?.(height)
  }, [onMinimumHeightChange])

  useLayoutEffect(reportMinimum)

  useLayoutEffect(() => {
    const sample = measure.current
    if (!sample || !onMinimumHeightChange || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(reportMinimum)
    observer.observe(sample)
    return () => observer.disconnect()
  }, [onMinimumHeightChange, reportMinimum])

  const content = (measurement: boolean) => (
    <>
      <div className="panel-heading">
        <h2 id={measurement ? undefined : titleId}>Statistics</h2>
        <div className="statistics-heading-meta">
          <span className="count-pill">{count}</span>
          {measurement ? null : headingAction}
        </div>
      </div>
      {hasRows
        ? <div className="stats-grid">{renderRows(measurement)}</div>
        : <p className={measurement ? 'stats-empty-measure' : 'stats-empty'}>{empty}</p>}
    </>
  )

  return (
    <section className="panel stats-panel" aria-labelledby={titleId} style={style}>
      <div className="stats-panel-measure" ref={measure} aria-hidden="true" inert>
        {content(true)}
      </div>
      <div className="stats-scroll">{content(false)}</div>
    </section>
  )
}

interface StatCell {
  text: string
  className?: string
  testId?: string
  title?: string
}

export function StatColumns({ label, current, best }: { label: string; current?: StatCell; best?: StatCell }) {
  return (
    <span className={`stat-main${current ? ' has-current' : ''}${best ? ' has-best' : ''}`}>
      <span className="stat-label">{label}</span>
      {current ? (
        <span className={`stat-current ${current.className ?? ''}`}>
          <span>Current</span>
          <strong data-testid={current.testId} title={current.title}>{current.text}</strong>
        </span>
      ) : null}
      {best ? (
        <span className={`stat-best ${best.className ?? ''}`}>
          <span>Best</span>
          <strong data-testid={best.testId} title={best.title}>{best.text}</strong>
        </span>
      ) : null}
    </span>
  )
}
