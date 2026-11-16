import { useId, type ComponentPropsWithRef, type ComponentPropsWithoutRef, type ReactNode } from 'react'
import type { useHistoryList } from '../hooks/useHistoryList'
import { CubeMark } from './Icons'

interface Props {
  title: 'Solves' | 'Attempts'
  count: number
  empty: string
  listLabel: string
  listTestId: string
  countTestId: string
  windowToggleTestId: string
  history: ReturnType<typeof useHistoryList>
  renderRows: (start: number, end: number) => ReactNode
  children?: ReactNode
  locked?: boolean
}

export function HistoryPanel({ title, count, empty, listLabel, listTestId, countTestId, windowToggleTestId, history, renderRows, children, locked }: Props) {
  const titleId = useId()
  const noteId = useId()
  const noun = title.toLowerCase()
  const { canWindow, virtualized, windowRange, showAll, toggleShowAll, scrollRef, handleScroll } = history

  return (
    <section className="panel history-panel" aria-labelledby={titleId} tabIndex={-1}>
      <div className="panel-heading history-heading">
        <h2 id={titleId}>
          {title}
          <span className="heading-count" aria-live="polite" data-testid={countTestId}>{count}</span>
        </h2>
        {canWindow ? (
          <button type="button" className="text-button history-window-toggle" data-testid={windowToggleTestId}
            aria-pressed={showAll} onClick={toggleShowAll} disabled={locked}>
            {showAll ? 'Use windowed view' : `Show all ${noun}`}
          </button>
        ) : null}
      </div>
      {canWindow ? (
        <p id={noteId} className="sr-only">
          For performance, only {noun} near the visible area are rendered. Use
          Show all {noun} to make every row available to find-in-page and assistive technology.
        </p>
      ) : null}
      <div className={`history-scroll${virtualized ? ' is-virtualized' : ''}`} ref={scrollRef} onScroll={handleScroll}>
        {count === 0 ? (
          <div className="history-empty">
            <span className="empty-mark"><CubeMark size={44} /></span>
            <p>{empty}</p>
          </div>
        ) : (
          <>
            {windowRange.topSpacer > 0 ? (
              <div className="history-spacer" aria-hidden="true" style={{ height: windowRange.topSpacer }} />
            ) : null}
            <ol className={`history-list${virtualized ? ' history-list--virtualized' : ''}`}
              data-testid={listTestId} data-virtualized={String(virtualized)}
              aria-label={listLabel} aria-describedby={canWindow ? noteId : undefined}>
              {renderRows(windowRange.start, windowRange.end)}
            </ol>
            {windowRange.bottomSpacer > 0 ? (
              <div className="history-spacer" aria-hidden="true" style={{ height: windowRange.bottomSpacer }} />
            ) : null}
          </>
        )}
      </div>
      {children}
    </section>
  )
}

interface HistoryRowProps extends ComponentPropsWithRef<'li'> {
  rowId: string
  selected: boolean
  time: ReactNode
  timeClassName?: string
  timeTestId?: string
  main: ComponentPropsWithoutRef<'button'> & { 'data-testid'?: string }
  actions?: ReactNode
}

export function HistoryRow({ rowId, selected, time, timeClassName, timeTestId, main, actions, children, ...row }: HistoryRowProps) {
  return (
    <li {...row} className={`history-row${selected ? ' is-menu-open' : ''}`} data-history-id={rowId}>
      <button type="button" className="history-main" {...main}>
        <span className={`history-time ${timeClassName ?? ''}`} data-testid={timeTestId}>{time}</span>
        <span className="history-copy">{children}</span>
      </button>
      {actions}
    </li>
  )
}
