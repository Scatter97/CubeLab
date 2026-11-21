import { useEffect, useMemo, useRef, useState } from 'react'

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

function parseDate(value: string): Date | null {
  const match = DATE_PATTERN.exec(value)
  if (!match) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isNaN(date.getTime()) ? null : date
}

function toDateValue(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function sameDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  )
}

function formatRange(start: string, end: string): string {
  const from = parseDate(start)
  const to = parseDate(end)
  const formatter = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
  if (from && to) {
    if (from.getFullYear() === to.getFullYear()) {
      const short = new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
      })
      return `${short.format(from)} – ${formatter.format(to)}`
    }
    return `${formatter.format(from)} – ${formatter.format(to)}`
  }
  if (from) return `From ${formatter.format(from)}`
  if (to) return `Through ${formatter.format(to)}`
  return 'Choose dates'
}

interface RangeCalendarProps {
  start: string
  end: string
  onChange: (start: string, end: string) => void
}

/**
 * Themed floating range calendar for Analytics custom dates. Selecting the
 * first day starts a range; selecting a later day closes it. Selecting an
 * earlier day moves the start instead of inventing a reversed range.
 */
export function RangeCalendar({ start, end, onChange }: RangeCalendarProps) {
  const [open, setOpen] = useState(false)
  const [month, setMonth] = useState(() => {
    const initial = parseDate(start) ?? new Date()
    return new Date(initial.getFullYear(), initial.getMonth(), 1)
  })
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (!(event.target instanceof Node)) return
      if (rootRef.current?.contains(event.target)) return
      setOpen(false)
    }
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', keydown)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', keydown)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const frame = window.requestAnimationFrame(() => {
      panelRef.current?.querySelector<HTMLButtonElement>('[data-current-month]')?.focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [open])

  const days = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1)
    const startOffset = first.getDay()
    const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
    const cells: Array<{ date: Date | null; key: string }> = []
    for (let index = 0; index < startOffset; index += 1) {
      cells.push({ date: null, key: `blank-${index}` })
    }
    for (let day = 1; day <= count; day += 1) {
      const date = new Date(month.getFullYear(), month.getMonth(), day)
      cells.push({ date, key: toDateValue(date) })
    }
    while (cells.length % 7 !== 0) {
      cells.push({ date: null, key: `tail-${cells.length}` })
    }
    return cells
  }, [month])

  const startDate = parseDate(start)
  const endDate = parseDate(end)
  const [today] = useState(() => new Date())

  const chooseDay = (date: Date) => {
    const value = toDateValue(date)
    if (!startDate || (startDate && endDate)) {
      onChange(value, '')
      return
    }
    if (date.getTime() < startDate.getTime()) {
      onChange(value, '')
      return
    }
    onChange(start, value)
  }

  return (
    <div className="range-calendar" ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className="range-calendar-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid="analytics-custom-date-trigger"
        onClick={() => setOpen((current) => !current)}
      >
        <span>{formatRange(start, end)}</span>
        <span className="range-calendar-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open ? (
        <div
          ref={panelRef}
          className="range-calendar-panel"
          role="dialog"
          aria-label="Choose a custom date range"
          data-testid="analytics-date-calendar"
        >
          <div className="range-calendar-heading">
            <button
              type="button"
              className="icon-button"
              aria-label="Previous month"
              onClick={() =>
                setMonth(
                  (current) =>
                    new Date(current.getFullYear(), current.getMonth() - 1, 1),
                )
              }
            >
              ‹
            </button>
            <strong aria-live="polite">
              {MONTHS[month.getMonth()]} {month.getFullYear()}
            </strong>
            <button
              type="button"
              className="icon-button"
              aria-label="Next month"
              onClick={() =>
                setMonth(
                  (current) =>
                    new Date(current.getFullYear(), current.getMonth() + 1, 1),
                )
              }
            >
              ›
            </button>
          </div>
          <div className="range-calendar-weekdays" aria-hidden="true">
            {WEEKDAYS.map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>
          <div className="range-calendar-grid" role="grid">
            {days.map((cell) => {
              if (!cell.date) {
                return <span key={cell.key} aria-hidden="true" />
              }
              const date = cell.date
              const isStart = startDate ? sameDay(date, startDate) : false
              const isEnd = endDate ? sameDay(date, endDate) : false
              const inRange =
                startDate && endDate
                  ? date.getTime() >= startDate.getTime() &&
                    date.getTime() <= endDate.getTime()
                  : false
              return (
                <button
                  type="button"
                  key={cell.key}
                  className={`range-calendar-day${isStart || isEnd ? ' is-edge' : ''}${inRange ? ' is-in-range' : ''}${sameDay(date, today) ? ' is-today' : ''}`}
                  aria-pressed={isStart || isEnd}
                  aria-label={date.toLocaleDateString(undefined, {
                    weekday: 'long',
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                  data-current-month={
                    sameDay(date, new Date(month.getFullYear(), month.getMonth(), 1))
                      ? 'true'
                      : undefined
                  }
                  onClick={() => chooseDay(date)}
                >
                  {date.getDate()}
                </button>
              )
            })}
          </div>
          <div className="range-calendar-footer">
            <span className="range-calendar-summary">{formatRange(start, end)}</span>
            <button
              type="button"
              className="text-button"
              onClick={() => onChange('', '')}
            >
              Clear
            </button>
            <button
              type="button"
              className="button button-secondary button-small"
              onClick={() => {
                setOpen(false)
                triggerRef.current?.focus()
              }}
            >
              Done
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
