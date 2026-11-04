import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  panTrendAxis,
  trendAxis,
  trendPath,
  trendViewAxis,
  zoomTrendAxis,
  type TrendAxisView,
} from '../lib/timeTrend'
import type { ActivityDay, HistogramBin } from '../lib/analytics'
import {
  ResetIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from './Icons'

export interface AnalyticsSeries {
  key: string
  label: string
  color: string
  values: readonly (number | null)[]
}

interface LineChartProps {
  title: string
  description?: string
  ariaLabel: string
  series: readonly AnalyticsSeries[]
  xLabel: (index: number) => string
  formatValue: (value: number) => string
  formatTick: (value: number) => string
  height?: number
  emptyMessage?: string
  onSelectIndex?: (index: number) => void
  markers?: readonly { index: number; value: number; label: string }[]
  markerColor?: string
  testId?: string
  showControls?: boolean
}

function useElementWidth(ref: React.RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState({ width: 640, height: 220 })
  useEffect(() => {
    const host = ref.current
    if (!host || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width > 0 && entry.contentRect.height > 0) {
        setSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        })
      }
    })
    observer.observe(host)
    return () => observer.disconnect()
  }, [ref])
  return size
}

export const AnalyticsLineChart = memo(function AnalyticsLineChart({
  title,
  description,
  ariaLabel,
  series,
  xLabel,
  formatValue,
  formatTick,
  height = 240,
  emptyMessage = 'No data matches the current filters.',
  onSelectIndex,
  markers = [],
  markerColor = 'var(--trend-pb)',
  testId = 'analytics-line-chart',
  showControls = true,
}: LineChartProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const measured = useElementWidth(hostRef)
  const [view, setView] = useState<TrendAxisView>({ zoom: 1, position: 1 })
  const [hover, setHover] = useState<number | null>(null)
  const dragRef = useRef<{
    id: number
    x: number
    startX: number
    moved: boolean
  } | null>(null)
  const width = Math.max(260, measured.width)
  // Analytics charts fill their flex row on desktop; other uses fall back to the
  // explicit/default height until the plot has been measured.
  const chartHeight = Math.max(
    150,
    Math.round(measured.height > 0 ? measured.height : height),
  )
  const count = Math.max(
    ...series.map((entry) => entry.values.length),
    0,
  )
  const hasValues = series.some((entry) =>
    entry.values.some((value) => value !== null),
  )
  const allValues = useMemo(
    () => series.flatMap((entry) => entry.values.flatMap((value) => (value === null ? [] : [value]))),
    [series],
  )
  const yDomain = useMemo(() => trendAxis(allValues, 4), [allValues])
  const visibleCount = Math.min(
    count,
    Math.max(2, Math.ceil(count / Math.max(1, view.zoom))),
  )
  const start = Math.round((count - visibleCount) * view.position)
  const maxZoom = Math.max(1, count / 2)
  const yAxis = trendViewAxis(yDomain, { zoom: 1, position: 0.5 }, 4)
  const labelWidth = yAxis.ticks.reduce(
    (max, tick) => Math.max(max, formatTick(tick).length * 6.6 + 10),
    0,
  )
  const margin = {
    top: 14,
    right: 14,
    bottom: 26,
    left: Math.max(width < 340 ? 42 : 52, labelWidth),
  }
  const plotW = Math.max(1, width - margin.left - margin.right)
  const plotH = Math.max(1, chartHeight - margin.top - margin.bottom)
  const xScale = (index: number) =>
    margin.left +
    (visibleCount > 1 ? (index - start) / (visibleCount - 1) : 0.5) * plotW
  const yScale = (value: number) =>
    margin.top +
    plotH * (1 - (value - yAxis.min) / Math.max(1e-9, yAxis.max - yAxis.min))
  const visibleIndexes = useMemo(
    () => Array.from({ length: visibleCount }, (_, offset) => start + offset),
    [start, visibleCount],
  )
  const visibleMarkers = markers.filter(
    (marker) =>
      marker.index >= start &&
      marker.index < start + visibleCount &&
      marker.value >= yAxis.min &&
      marker.value <= yAxis.max,
  )

  const zoomBy = (factor: number, anchor = 0.5) =>
    setView((current) => zoomTrendAxis(current, factor, anchor, maxZoom))
  const reset = () => {
    setView({ zoom: 1, position: 1 })
    setHover(null)
  }

  // Native non-passive wheel handling keeps page zoom/scroll out of the plot.
  useEffect(() => {
    const host = hostRef.current
    if (!host || !hasValues || count < 3) return
    const wheel = (event: WheelEvent) => {
      const svg = host.querySelector('svg')
      if (!svg) return
      const rect = svg.getBoundingClientRect()
      const x = (event.clientX - rect.left) * width / Math.max(1, rect.width)
      const anchor = Math.max(0, Math.min(1, (x - margin.left) / plotW))
      event.preventDefault()
      event.stopPropagation()
      const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY
      const factor = Math.exp(-Math.max(-240, Math.min(240, delta)) * 0.004)
      setView((current) => zoomTrendAxis(current, factor, anchor, maxZoom))
      setHover(null)
    }
    host.addEventListener('wheel', wheel, { passive: false })
    return () => host.removeEventListener('wheel', wheel)
  }, [count, hasValues, margin.left, maxZoom, plotW, width])

  const indexAt = (clientX: number): number => {
    const svg = hostRef.current?.querySelector('svg')
    if (!svg) return start
    const rect = svg.getBoundingClientRect()
    const x = (clientX - rect.left) * width / Math.max(1, rect.width)
    const ratio = Math.max(0, Math.min(1, (x - margin.left) / plotW))
    return Math.min(count - 1, start + Math.round(ratio * Math.max(1, visibleCount - 1)))
  }

  const hoverLabel =
    hover === null
      ? null
      : `${xLabel(hover)} · ${series
          .map((entry) => {
            const value = entry.values[hover] ?? null
            return `${entry.label}: ${value === null ? '—' : formatValue(value)}`
          })
          .join(' · ')}`

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (count === 0) return
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      const current = hover ?? count - 1
      const next = Math.max(0, Math.min(count - 1, current + (event.key === 'ArrowRight' ? 1 : -1)))
      setHover(next)
      if (next < start || next >= start + visibleCount) {
        setView((state) => ({ ...state, position: next / Math.max(1, count - 1) }))
      }
    } else if (event.key === 'Enter' && hover !== null && onSelectIndex) {
      event.preventDefault()
      onSelectIndex(hover)
    }
  }

  return (
    <div className="analytics-chart analytics-line-chart" data-testid={testId}>
      {(title || showControls) && (
        <div className="analytics-chart-heading">
          <div>
            <h3>{title}</h3>
            {description ? <p>{description}</p> : null}
          </div>
          {showControls && count > 2 && hasValues ? (
            <div
              className="chart-zoom-controls"
              role="group"
              aria-label={`${title} view controls`}
            >
              <button
                type="button"
                className="chart-zoom-button"
                onClick={() => zoomBy(2)}
                aria-label={`Zoom in on ${title}`}
                title={`Zoom in on ${title}`}
              >
                <ZoomInIcon size={14} />
              </button>
              <button
                type="button"
                className="chart-zoom-button"
                onClick={() => zoomBy(0.5)}
                disabled={view.zoom <= 1}
                aria-label={`Zoom out of ${title}`}
                title={`Zoom out of ${title}`}
              >
                <ZoomOutIcon size={14} />
              </button>
              <button
                type="button"
                className="chart-zoom-button"
                onClick={reset}
                disabled={view.zoom <= 1 && view.position === 1}
                aria-label={`Reset ${title} view`}
                title={`Reset ${title} view`}
              >
                <ResetIcon size={14} />
              </button>
            </div>
          ) : null}
        </div>
      )}
      {!hasValues ? (
        <p className="analytics-empty" role="status">
          {emptyMessage}
        </p>
      ) : (
        <div
          className="analytics-chart-plot"
          ref={hostRef}
          tabIndex={0}
          role="group"
          aria-label={`${ariaLabel}. Use left and right arrow keys to inspect points${onSelectIndex ? '; press Enter to open details' : ''}.`}
          onKeyDown={handleKeyDown}
          onPointerDown={(event: ReactPointerEvent<HTMLDivElement>) => {
            if (event.button !== 0) return
            dragRef.current = {
              id: event.pointerId,
              x: event.clientX,
              startX: event.clientX,
              moved: false,
            }
            event.currentTarget.setPointerCapture(event.pointerId)
          }}
          onPointerUp={(event) => {
            const drag = dragRef.current
            if (!drag || drag.id !== event.pointerId) return
            dragRef.current = null
            event.currentTarget.releasePointerCapture(event.pointerId)
            if (!drag.moved && onSelectIndex) onSelectIndex(indexAt(event.clientX))
          }}
          onPointerCancel={() => {
            dragRef.current = null
          }}
          onPointerMove={(event) => {
            const drag = dragRef.current
            if (drag && drag.id === event.pointerId) {
              if (
                !drag.moved &&
                Math.hypot(event.clientX - drag.startX, 0) < 4
              ) {
                return
              }
              const dx = event.clientX - drag.x
              dragRef.current = { ...drag, x: event.clientX, moved: true }
              setView((current) => panTrendAxis(current, -dx / plotW))
              return
            }
            setHover(indexAt(event.clientX))
          }}
          onPointerLeave={() => setHover(null)}
        >
          <svg
            viewBox={`0 0 ${width} ${chartHeight}`}
            role="img"
            aria-label={ariaLabel}
            data-testid="analytics-chart-svg"
            data-y-min={yAxis.min}
            data-y-max={yAxis.max}
          >
            {yAxis.ticks.map((tick) => (
              <g key={tick}>
                <line
                  className="time-trend-grid"
                  x1={margin.left}
                  y1={yScale(tick)}
                  x2={width - margin.right}
                  y2={yScale(tick)}
                />
                <text
                  className="time-trend-axis-label"
                  x={margin.left - 6}
                  y={yScale(tick) + 3}
                  textAnchor="end"
                >
                  {formatTick(tick)}
                </text>
              </g>
            ))}
            <line
              className="time-trend-axis"
              x1={margin.left}
              y1={margin.top + plotH}
              x2={width - margin.right}
              y2={margin.top + plotH}
            />
            {Array.from({ length: Math.min(5, visibleCount) }, (_, tick) => {
              const offset = Math.round(
                (tick * Math.max(0, visibleCount - 1)) /
                  Math.max(1, Math.min(5, visibleCount) - 1),
              )
              const index = Math.min(count - 1, start + offset)
              return (
                <text
                  key={tick}
                  className="time-trend-axis-label"
                  x={xScale(index)}
                  y={chartHeight - 6}
                  textAnchor={
                    tick === 0
                      ? 'start'
                      : tick === Math.min(5, visibleCount) - 1
                        ? 'end'
                        : 'middle'
                  }
                >
                  {xLabel(index)}
                </text>
              )
            })}
            <g>
              {series.map((entry) => (
                <path
                  key={entry.key}
                  d={trendPath(
                    visibleIndexes.map((index) => {
                      const value = entry.values[index] ?? null
                      return value === null
                        ? null
                        : { x: xScale(index), y: yScale(value) }
                    }),
                    Math.max(20, Math.floor(plotW)),
                  )}
                  fill="none"
                  stroke={entry.color}
                  strokeWidth={1.6}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              ))}
              {visibleMarkers.map((marker) => (
                <circle
                  key={`${marker.index}-${marker.value}`}
                  cx={xScale(marker.index)}
                  cy={yScale(marker.value)}
                  r={3}
                  fill={markerColor}
                  stroke="var(--surface)"
                  strokeWidth={1}
                >
                  <title>{marker.label}</title>
                </circle>
              ))}
              {hover !== null && hover >= start && hover < start + visibleCount ? (
                <line
                  className="time-trend-crosshair"
                  x1={xScale(hover)}
                  x2={xScale(hover)}
                  y1={margin.top}
                  y2={margin.top + plotH}
                />
              ) : null}
            </g>
          </svg>
          {hoverLabel ? (
            <div className="analytics-chart-tooltip" data-testid="analytics-chart-tooltip">
              {hoverLabel}
            </div>
          ) : null}
        </div>
      )}
      <div className="analytics-legend" aria-label={`${title} series`}>
        {series.map((entry) => (
          <span key={entry.key}>
            <i style={{ background: entry.color }} aria-hidden="true" />
            {entry.label}
          </span>
        ))}
        {markers.length > 0 ? (
          <span>
            <i className="is-dot" style={{ background: markerColor }} aria-hidden="true" />
            Personal best
          </span>
        ) : null}
      </div>
      {visibleCount < count ? (
        <p className="analytics-chart-range">
          Showing solves {start + 1}–{start + visibleCount} of {count.toLocaleString()}.
          Scroll to zoom, drag to pan.
        </p>
      ) : null}
    </div>
  )
})

interface HistogramChartProps {
  title: string
  bins: readonly HistogramBin[]
  formatValue: (value: number) => string
  meanMs: number | null
  medianMs: number | null
  selectedIndex: number | null
  onSelectBin: (index: number) => void
  testId?: string
}

export const AnalyticsHistogram = memo(function AnalyticsHistogram({
  title,
  bins,
  formatValue,
  meanMs,
  medianMs,
  selectedIndex,
  onSelectBin,
  testId = 'analytics-histogram',
}: HistogramChartProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const measured = useElementWidth(hostRef)
  const width = Math.max(280, measured.width)
  const height = Math.max(
    140,
    Math.round(measured.height > 0 ? measured.height : 240),
  )
  const margin = { top: 18, right: 14, bottom: 28, left: 42 }
  const plotW = Math.max(1, width - margin.left - margin.right)
  const plotH = Math.max(1, height - margin.top - margin.bottom)
  const maxCount = Math.max(1, ...bins.map((bin) => bin.count))
  const dense = bins.length > 14
  const domainStart = bins[0]?.startMs ?? 0
  const domainEnd = bins[bins.length - 1]?.endMs ?? 1
  const xValue = (value: number) =>
    margin.left +
    ((value - domainStart) / Math.max(1, domainEnd - domainStart)) * plotW
  const tickCount = Math.max(2, Math.min(6, bins.length))
  const ticks = Array.from({ length: tickCount }, (_, index) =>
    Math.round((index * (bins.length - 1)) / Math.max(1, tickCount - 1)),
  )
  const barGap = 1.5
  const barWidth = Math.max(1, plotW / Math.max(1, bins.length) - barGap)

  return (
    <div className="analytics-chart analytics-histogram" data-testid={testId}>
      <div className="analytics-chart-heading">
        <div>
          <h3>{title}</h3>
          <p>Click a bar to inspect its solves. Percentages use valid (non-DNF) solves.</p>
        </div>
      </div>
      {bins.length === 0 ? (
        <p className="analytics-empty" role="status">No valid solve times match the current filters.</p>
      ) : (
        <div className="analytics-chart-plot" ref={hostRef}>
          <svg
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label={`Solve time histogram with ${bins.length} intervals`}
          >
            {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
              const count = Math.round(maxCount * fraction)
              const y = margin.top + plotH * (1 - fraction)
              return (
                <g key={fraction}>
                  <line
                    className="time-trend-grid"
                    x1={margin.left}
                    y1={y}
                    x2={width - margin.right}
                    y2={y}
                  />
                  <text
                    className="time-trend-axis-label"
                    x={margin.left - 6}
                    y={y + 3}
                    textAnchor="end"
                  >
                    {count}
                  </text>
                </g>
              )
            })}
            <line
              className="time-trend-axis"
              x1={margin.left}
              y1={margin.top + plotH}
              x2={width - margin.right}
              y2={margin.top + plotH}
            />
            {bins.map((bin, index) => {
              const x =
                margin.left + (index / bins.length) * plotW + barGap / 2
              const barHeight = (bin.count / maxCount) * plotH
              const selected = selectedIndex === index
              return (
                <g
                  key={`${bin.startMs}-${index}`}
                  role="button"
                  tabIndex={0}
                  aria-label={`${formatValue(bin.startMs)} to ${formatValue(bin.endMs)}: ${bin.count} solves, ${bin.percent.toFixed(1)} percent`}
                  aria-pressed={selected}
                  className={`analytics-histogram-bar${selected ? ' is-selected' : ''}`}
                  onClick={() => onSelectBin(index)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      onSelectBin(index)
                    }
                  }}
                >
                  <title>
                    {`${formatValue(bin.startMs)}–${formatValue(bin.endMs)} · ${bin.count} solves · ${bin.percent.toFixed(1)}%`}
                  </title>
                  <rect
                    className="analytics-histogram-hit"
                    x={x}
                    y={margin.top}
                    width={Math.max(1, barWidth)}
                    height={plotH}
                    fill="transparent"
                  />
                  <rect
                    x={x}
                    y={margin.top + plotH - barHeight}
                    width={Math.max(1, barWidth)}
                    height={Math.max(0, barHeight)}
                  />
                  {bin.count > 0 && bins.length <= 14 ? (
                    <text
                      className="analytics-histogram-count"
                      x={x + Math.max(1, barWidth) / 2}
                      y={margin.top + plotH - barHeight - 4}
                      textAnchor="middle"
                    >
                      {bin.count}
                    </text>
                  ) : null}
                </g>
              )
            })}
            {meanMs !== null ? (
              <g>
                <line
                  className="analytics-marker is-mean"
                  x1={xValue(meanMs)}
                  x2={xValue(meanMs)}
                  y1={margin.top}
                  y2={margin.top + plotH}
                />
                <text
                  className="analytics-marker-label"
                  x={xValue(meanMs) + 3}
                  y={margin.top + 10}
                >
                  Mean
                </text>
              </g>
            ) : null}
            {medianMs !== null ? (
              <g>
                <line
                  className="analytics-marker is-median"
                  x1={xValue(medianMs)}
                  x2={xValue(medianMs)}
                  y1={margin.top}
                  y2={margin.top + plotH}
                />
                <text
                  className="analytics-marker-label"
                  x={xValue(medianMs) + 3}
                  y={margin.top + 22}
                >
                  Median
                </text>
              </g>
            ) : null}
            {ticks.map((index) => {
              const bin = bins[index]
              if (!bin) return null
              return (
                <text
                  key={index}
                  className="time-trend-axis-label"
                  x={margin.left + (index / bins.length) * plotW}
                  y={height - 6}
                  textAnchor={
                    index === 0 ? 'start' : index === bins.length - 1 ? 'end' : 'middle'
                  }
                >
                  {dense && index % 2 === 1 ? '' : formatValue(bin.startMs)}
                </text>
              )
            })}
          </svg>
        </div>
      )}
    </div>
  )
})

interface ActivityHeatmapProps {
  days: readonly ActivityDay[]
  formatDate: (day: ActivityDay) => string
}

export const ActivityHeatmap = memo(function ActivityHeatmap({
  days,
  formatDate,
}: ActivityHeatmapProps) {
  const max = Math.max(1, ...days.map((day) => day.count))
  const weeks = useMemo(() => {
    const result: (ActivityDay | null)[][] = []
    let current: (ActivityDay | null)[] = []
    const first = days[0]
    if (first) {
      const weekday = (new Date(first.dateMs).getDay() + 6) % 7
      for (let blank = 0; blank < weekday; blank += 1) current.push(null)
    }
    for (const day of days) {
      current.push(day)
      if (current.length === 7) {
        result.push(current)
        current = []
      }
    }
    if (current.length > 0) {
      while (current.length < 7) current.push(null)
      result.push(current)
    }
    return result
  }, [days])

  const firstDay = days[0]
  const lastDay = days[days.length - 1]
  const activeDays = days.filter((day) => day.count > 0).length
  const monthLabels = useMemo(() => {
    let previousMonth = -1
    let previousYear = -1
    return weeks.map((week, index) => {
      const day = week.find((entry): entry is ActivityDay => entry !== null)
      if (!day) return ''
      const date = new Date(day.dateMs)
      const month = date.getMonth()
      const year = date.getFullYear()
      const changed = month !== previousMonth || year !== previousYear
      previousMonth = month
      previousYear = year
      if (!changed && index !== 0) return ''
      const monthLabel = date.toLocaleDateString(undefined, { month: 'short' })
      return index === 0 || month === 0
        ? `${monthLabel} ${year}`
        : monthLabel
    })
  }, [weeks])

  const weekdayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

  if (!firstDay || !lastDay) {
    return (
      <p className="analytics-empty" role="status">
        No practice activity matches the current filters.
      </p>
    )
  }

  const rangeDescription = `${formatDate(firstDay)} to ${formatDate(lastDay)}`
  return (
    <div className="analytics-heatmap-block">
      <p className="analytics-heatmap-caption" data-testid="activity-heatmap-range">
        <strong>{rangeDescription}</strong>
        <span>
          {activeDays.toLocaleString()} active{' '}
          {activeDays === 1 ? 'day' : 'days'} across {days.length.toLocaleString()}{' '}
          calendar {days.length === 1 ? 'day' : 'days'}
        </span>
      </p>
      <div
        className="analytics-heatmap-scroll"
        tabIndex={0}
        role="region"
        aria-label={`Daily solve activity, ${rangeDescription}. Scroll horizontally for the full range.`}
      >
        <table className="analytics-heatmap">
          <caption className="sr-only">
            Daily solve activity from {rangeDescription}. {activeDays} active
            days.
          </caption>
          <thead>
            <tr>
              <th scope="col" className="analytics-heatmap-corner">
                <span className="sr-only">Weekday</span>
              </th>
              {weeks.map((week, weekIndex) => (
                <th
                  key={`month-${weekIndex}`}
                  scope="col"
                  className="analytics-heatmap-month"
                >
                  {monthLabels[weekIndex] ? (
                    <span>{monthLabels[weekIndex]}</span>
                  ) : (
                    <span className="sr-only">
                      Week of{' '}
                      {week.find((day): day is ActivityDay => day !== null)
                        ? formatDate(
                            week.find(
                              (day): day is ActivityDay => day !== null,
                            )!,
                          )
                        : weekIndex}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weekdayLabels.map((weekday, dayIndex) => (
              <tr key={weekday}>
                <th scope="row" className="analytics-heatmap-weekday">
                  {weekday}
                </th>
                {weeks.map((week, weekIndex) => {
                  const day = week[dayIndex]
                  return (
                    <td key={`${weekIndex}-${dayIndex}`}>
                      {day ? (
                        <span
                          className={`analytics-heatmap-cell level-${day.count === 0 ? 0 : Math.min(4, Math.ceil((day.count / max) * 4))}`}
                          role="img"
                          aria-label={`${formatDate(day)}: ${day.count} solves`}
                          title={`${formatDate(day)} · ${day.count} ${day.count === 1 ? 'solve' : 'solves'}`}
                        />
                      ) : (
                        <span
                          className="analytics-heatmap-cell is-empty"
                          aria-hidden="true"
                        />
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
})
