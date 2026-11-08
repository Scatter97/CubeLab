import {
  createPortal,
} from 'react-dom'
import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useModalDialog } from '../hooks/useModalDialog'
import {
  ActivityHeatmap,
  AnalyticsHistogram,
  AnalyticsLineChart,
  type AnalyticsSeries,
} from './AnalyticsCharts'
import {
  ACTIVITY_CALENDAR_WINDOW_DAYS,
  addLocalDays,
  buildActivity,
  buildActivityCalendar,
  buildAnalyticsAverages,
  buildAnalyticsTrend,
  buildHistogram,
  buildPBHistory,
  clampActivityCalendarStart,
  compareSessions,
  computeAdvanced,
  computeAnalyticsOverview,
  computeAverageOverviews,
  computeConsistency,
  computeSubX,
  createAnalyticsFilters,
  filterAnalyticsSolves,
  formatAnalyticsAxisDate,
  analyticsSpansMultipleYears,
  type ActivityReport,
  type AnalyticsFilters,
  type AnalyticsSolve,
  type AnalyticsTrend,
  type HistogramBin,
} from '../lib/analytics'
import {
  ANALYTICS_SECTION_LABELS,
  createDefaultAnalyticsSettings,
  getSubXPresetsMs,
  getSubXTargetMs,
  normalizeAnalyticsSections,
} from '../lib/analyticsSettings'
import { useDismissablePopover } from '../hooks/useDismissablePopover'
import { useLocalDayRefresh } from '../hooks/useLocalDayRefresh'
import { AppVersion } from './AppVersion'
import { ListIcon, ResetIcon, SlidersIcon } from './Icons'
import { Select } from './Select'
import {
  formatEventOptionLabel,
  getEventLabel,
  getEventOptions,
} from '../lib/events'
import {
  formatEffectiveSolveTime,
  formatStatValue,
  formatTime,
} from '../lib/format'
import { computeHistoryWindow } from '../lib/historyWindow'
import type {
  AnalyticsSectionId,
  AverageTrimming,
  PuzzleEvent,
  Session,
  Settings,
} from '../types'

const OVERVIEW_AVERAGE_SIZES = [5, 12, 50, 100, 1_000] as const
const AVERAGE_CHART_SIZES = [5, 12, 50, 100, 1_000] as const
const SESSION_AVERAGE_SIZES = [5, 12, 50] as const

const PROGRESS_SERIES = [
  { key: 'single', label: 'Single', color: 'var(--trend-single)', size: null },
  { key: 'ao5', label: 'ao5', color: 'var(--trend-ao5)', size: 5 },
  { key: 'ao12', label: 'ao12', color: 'var(--trend-ao12)', size: 12 },
  { key: 'ao50', label: 'ao50', color: 'var(--trend-ao50)', size: 50 },
  { key: 'ao100', label: 'ao100', color: 'var(--trend-ao100)', size: 100 },
  { key: 'ao1000', label: 'ao1000', color: 'var(--trend-ao1000)', size: 1_000 },
] as const

const SESSION_PALETTE = [
  'var(--trend-ao12)',
  'var(--trend-ao5)',
  'var(--trend-ao25)',
  'var(--trend-ao50)',
  'var(--trend-ao200)',
  'var(--trend-ao500)',
  'var(--trend-ao1000)',
  'var(--trend-custom)',
]

function formatOptionalMs(ms: number | null): string {
  return ms === null ? '—' : formatTime(ms)
}

function formatPercent(value: number | null, digits = 1): string {
  return value === null || !Number.isFinite(value)
    ? '—'
    : `${value.toFixed(digits)}%`
}

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)} s`
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)} min`
  return `${(ms / 3_600_000).toFixed(1)} h`
}

function fullDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function StatCard({
  label,
  value,
  detail,
  title,
  variant = 'default',
  accent = false,
}: {
  label: string
  value: string
  detail?: string
  title?: string
  variant?: 'default' | 'hero' | 'detail'
  accent?: boolean
}) {
  return (
    <div
      className={`analytics-stat is-${variant}${accent ? ' is-accent' : ''}`}
      title={title}
    >
      <span className="analytics-stat-label">{label}</span>
      <strong>{value}</strong>
      {detail ? <span className="analytics-stat-detail">{detail}</span> : null}
    </div>
  )
}

function SubXTargetControl({
  event,
  targetMs,
  onCommit,
}: {
  event: PuzzleEvent
  targetMs: number
  onCommit: (targetMs: number) => void
}) {
  const formatTarget = (milliseconds: number) =>
    (milliseconds / 1_000).toFixed(3).replace(/\.?0+$/, '')
  const [draft, setDraft] = useState(formatTarget(targetMs))
  const [error, setError] = useState<string | null>(null)
  const presets = getSubXPresetsMs(event)
  const errorId = 'sub-x-target-error'

  const commit = (value: string): boolean => {
    const normalized = value.trim()
    if (!/^\d+(?:\.\d{1,3})?$/.test(normalized)) {
      setError('Enter seconds with up to three decimal places, for example 15.50.')
      return false
    }
    const seconds = Number(normalized)
    const milliseconds = Math.round(seconds * 1_000)
    if (!Number.isFinite(seconds) || milliseconds < 1_000 || milliseconds > 3_600_000) {
      setError('Use a target from 1 to 3600 seconds.')
      return false
    }
    setDraft((milliseconds / 1_000).toFixed(3).replace(/0+$/, '').replace(/\.$/, ''))
    setError(null)
    onCommit(milliseconds)
    return true
  }

  return (
    <div className="analytics-subx-target">
      <label htmlFor="sub-x-target-input">
        Target for {getEventLabel(event)}
      </label>
      <div className="analytics-subx-controls">
        <span className="analytics-subx-input">
          <input
            id="sub-x-target-input"
            type="text"
            inputMode="decimal"
            value={draft}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? errorId : 'sub-x-target-help'}
            data-testid="sub-x-target"
            onChange={(inputEvent) => {
              setDraft(inputEvent.target.value)
              setError(null)
            }}
            onBlur={() => commit(draft)}
            onKeyDown={(keyEvent) => {
              if (keyEvent.key === 'Enter') {
                keyEvent.preventDefault()
                commit(draft)
              }
            }}
          />
          <span aria-hidden="true">seconds</span>
        </span>
        {presets.length > 0 ? (
          <span className="analytics-subx-presets" aria-label="Sub-X presets">
            {presets.map((preset) => (
              <button
                key={preset}
                type="button"
                className="time-trend-chip"
                aria-pressed={targetMs === preset}
                data-testid={`sub-x-preset-${preset}`}
                onClick={() => {
                  setDraft(String(preset / 1_000))
                  setError(null)
                  onCommit(preset)
                }}
              >
                Sub-{preset / 1_000}
              </button>
            ))}
          </span>
        ) : null}
      </div>
      {error ? (
        <p id={errorId} className="settings-error" role="alert">
          {error}
        </p>
      ) : (
        <p id="sub-x-target-help" className="analytics-note">
          Strictly faster than Sub-{formatTime(targetMs)}.
        </p>
      )}
    </div>
  )
}

function Section({
  id,
  title,
  meta,
  wide,
  children,
  actions,
  emptyMessage,
}: {
  id: AnalyticsSectionId
  title: string
  meta?: ReactNode
  wide: boolean
  children: ReactNode
  actions?: ReactNode
  emptyMessage?: string
}) {
  return (
    <section
      className={`analytics-section${wide ? ' is-wide' : ''}`}
      id={`analytics-${id}`}
      aria-labelledby={`analytics-${id}-title`}
      data-testid={`analytics-section-${id}`}
    >
      <header className="analytics-section-header">
        <div className="analytics-section-heading">
          <h2 id={`analytics-${id}-title`}>{title}</h2>
          {meta ? <span className="analytics-section-meta">{meta}</span> : null}
        </div>
        {actions}
      </header>
      {emptyMessage ? (
        <p className="analytics-empty" role="status">
          {emptyMessage}
        </p>
      ) : (
        children
      )}
    </section>
  )
}

interface SolveDetailsDialogProps {
  solve: AnalyticsSolve | null
  onClose: () => void
}

function SolveDetailsDialog({ solve, onClose }: SolveDetailsDialogProps) {
  const { dialogRef, handleKeyDown } = useModalDialog(solve !== null)
  return createPortal(
    <dialog
      ref={dialogRef}
      className="time-trend-dialog analytics-solve-dialog"
      aria-labelledby="analytics-solve-title"
      data-testid="analytics-solve-dialog"
      onKeyDown={(event) => {
        event.stopPropagation()
        handleKeyDown(event)
      }}
      onKeyUp={(event) => event.stopPropagation()}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      {solve ? (
        <div className="time-trend-pb-content">
          <header className="time-trend-modal-header">
            <div>
              <h2 id="analytics-solve-title">Solve details</h2>
              <p>
                {getEventLabel(solve.event)} ·{' '}
                {new Date(solve.createdAt).toLocaleString()}
              </p>
            </div>
            <button
              type="button"
              className="time-trend-button"
              onClick={onClose}
              aria-label="Close solve details"
            >
              Close
            </button>
          </header>
          <div className="analytics-solve-result">
            <strong data-testid="analytics-solve-time">
              {formatEffectiveSolveTime(solve)}
            </strong>
            <span>{solve.sessionName}</span>
            <span>
              Penalty: {solve.penalty === 'none' ? 'None' : solve.penalty} ·
              Raw {formatTime(solve.rawMs)}
            </span>
          </div>
          <section aria-label="Scramble">
            <h3>Scramble</h3>
            <p className="time-trend-scramble">
              {solve.scramble || 'No scramble recorded.'}
            </p>
          </section>
          {solve.comment ? (
            <section aria-label="Comment">
              <h3>Comment</h3>
              <p>{solve.comment}</p>
            </section>
          ) : null}
        </div>
      ) : null}
    </dialog>,
    document.body,
  )
}

interface AnalyticsSolveListProps {
  solves: readonly AnalyticsSolve[]
  onSelect: (solve: AnalyticsSolve) => void
  height?: number
}

const LIST_ROW_HEIGHT = 40
const LIST_HEIGHT = 320
const LIST_OVERSCAN = 160

const AnalyticsSolveList = memo(function AnalyticsSolveList({
  solves,
  onSelect,
  height = LIST_HEIGHT,
}: AnalyticsSolveListProps) {
  const [scrollTop, setScrollTop] = useState(0)
  const offsets = useMemo(() => {
    const next = new Float64Array(solves.length + 1)
    for (let index = 0; index < solves.length; index += 1) {
      next[index] = index * LIST_ROW_HEIGHT
    }
    next[solves.length] = solves.length * LIST_ROW_HEIGHT
    return next
  }, [solves.length])
  const window = computeHistoryWindow(
    offsets,
    scrollTop,
    height,
    LIST_OVERSCAN,
  )
  return (
    <div
      className="analytics-solve-list"
      style={{ height }}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      role="list"
      aria-label={`${solves.length} solves, newest first`}
      data-testid="analytics-solve-list"
    >
      <div
        className="analytics-solve-list-inner"
        style={{ height: window.totalHeight }}
      >
        {solves.slice(window.start, window.end).map((solve, offset) => {
          const index = window.start + offset
          return (
            <button
              type="button"
              className="analytics-solve-row"
              key={solve.id}
              role="listitem"
              style={{ top: index * LIST_ROW_HEIGHT }}
              onClick={() => onSelect(solve)}
            >
              <span className="analytics-solve-time">
                {formatEffectiveSolveTime(solve)}
              </span>
              <span className="analytics-solve-session">{solve.sessionName}</span>
              <span className="analytics-solve-date">
                {new Date(solve.createdAt).toLocaleDateString()}
              </span>
              {solve.penalty !== 'none' ? (
                <span className={`analytics-penalty is-${solve.penalty === '+2' ? 'plus2' : 'dnf'}`}>
                  {solve.penalty}
                </span>
              ) : null}
              {solve.comment ? (
                <span className="analytics-solve-comment">{solve.comment}</span>
              ) : null}
            </button>
          )
        })}
      </div>
    </div>
  )
})

interface SolveListDialogProps {
  open: boolean
  solves: readonly AnalyticsSolve[]
  activeBin: { startMs: number; endMs: number } | null
  onClose: () => void
  onSelect: (solve: AnalyticsSolve) => void
}

function SolveListDialog({
  open,
  solves,
  activeBin,
  onClose,
  onSelect,
}: SolveListDialogProps) {
  const { dialogRef, handleKeyDown } = useModalDialog(open)
  return createPortal(
    <dialog
      ref={dialogRef}
      className="time-trend-dialog analytics-solve-dialog analytics-solve-list-dialog"
      aria-labelledby="analytics-solve-list-title"
      data-testid="analytics-solve-list-dialog"
      onKeyDown={(event) => {
        event.stopPropagation()
        handleKeyDown(event)
      }}
      onKeyUp={(event) => event.stopPropagation()}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      {open ? (
        <div className="time-trend-pb-content analytics-solve-list-content">
          <header className="time-trend-modal-header">
            <div>
              <h2 id="analytics-solve-list-title">
                {activeBin
                  ? `Solves ${formatTime(activeBin.startMs)}–${formatTime(activeBin.endMs)}`
                  : 'All filtered solves'}
              </h2>
              <p>
                {solves.length.toLocaleString()}{' '}
                {solves.length === 1 ? 'solve' : 'solves'}, newest first. Select
                a row to inspect its details.
              </p>
            </div>
            <button
              type="button"
              className="time-trend-button"
              onClick={onClose}
              aria-label="Close solve list"
            >
              Close
            </button>
          </header>
          {solves.length === 0 ? (
            <p className="analytics-empty">No solves match the current filters.</p>
          ) : (
            <AnalyticsSolveList
              solves={solves}
              height={420}
              onSelect={(solve) => {
                onClose()
                onSelect(solve)
              }}
            />
          )}
        </div>
      ) : null}
    </dialog>,
    document.body,
  )
}

interface SectionCalculationProps {
  trend: AnalyticsTrend
  onSelectSolve: (solve: AnalyticsSolve) => void
}

function useMultipleYears(trend: AnalyticsTrend): boolean {
  return useMemo(
    () => analyticsSpansMultipleYears(trend.solves.map((solve) => solve.createdAt)),
    [trend.solves],
  )
}

function ProgressionSection({
  trend,
  trimming,
  progressSeries,
  onToggleSeries,
  progressXAxis,
  onChangeXAxis,
  onSelectSolve,
}: SectionCalculationProps & {
  trimming: AverageTrimming
  progressSeries: ReadonlySet<string>
  onToggleSeries: (key: string) => void
  progressXAxis: 'solve' | 'date'
  onChangeXAxis: (axis: 'solve' | 'date') => void
}) {
  const multipleYears = useMultipleYears(trend)
  const { series, markers } = useMemo(() => {
    const sizes = PROGRESS_SERIES.flatMap((entry) =>
      entry.size !== null && progressSeries.has(entry.key) ? [entry.size] : [],
    )
    const averages = buildAnalyticsAverages(trend.solves, sizes, trimming)
    return {
      series: PROGRESS_SERIES.filter((entry) => progressSeries.has(entry.key)).map(
        (entry): AnalyticsSeries => ({
          key: entry.key,
          label: entry.label,
          color: entry.color,
          values:
            entry.size === null
              ? trend.singles
              : averages.averages.get(entry.size) ?? [],
        }),
      ),
      markers: buildPBHistory(trend).single.map((event) => ({
        index: event.index,
        value: event.ms,
        label: `PB · ${formatTime(event.ms)} · ${fullDate(event.solve.createdAt)}`,
      })),
    }
  }, [progressSeries, trend, trimming])
  const xSolveLabel = (index: number) => `#${index + 1}`
  const xDateLabel = (index: number) =>
    formatAnalyticsAxisDate(
      trend.solves[index]?.createdAt ?? Date.now(),
      multipleYears,
    )

  return (
    <div className="analytics-chart-stack">
      <div className="analytics-chart-toolbar" aria-label="Time progression series">
        <span>Series</span>
        {PROGRESS_SERIES.map((entry) => (
          <button
            key={entry.key}
            type="button"
            className="time-trend-chip"
            aria-pressed={progressSeries.has(entry.key)}
            onClick={() => onToggleSeries(entry.key)}
          >
            <i style={{ background: entry.color }} aria-hidden="true" />
            {entry.label}
          </button>
        ))}
        <span className="analytics-toolbar-separator" />
        <button
          type="button"
          className="time-trend-chip"
          aria-pressed={progressXAxis === 'solve'}
          onClick={() => onChangeXAxis('solve')}
        >
          Solve #
        </button>
        <button
          type="button"
          className="time-trend-chip"
          aria-pressed={progressXAxis === 'date'}
          onClick={() => onChangeXAxis('date')}
        >
          Date
        </button>
      </div>
      <AnalyticsLineChart
        title="Time progression"
        hideHeading
        ariaLabel="Solve time progression"
        series={series}
        xLabel={progressXAxis === 'date' ? xDateLabel : xSolveLabel}
        formatValue={(value) => formatTime(value)}
        formatTick={(value) => formatTime(value)}
        markers={markers}
        onSelectIndex={(index) => {
          const solve = trend.solves[index]
          if (solve) onSelectSolve(solve)
        }}
        emptyMessage="Record or import solves to see time progression."
        testId="analytics-progression"
      />
    </div>
  )
}

function AveragesSection({
  trend,
  trimming,
  statPrecision,
  onSelectSolve,
}: SectionCalculationProps & {
  trimming: AverageTrimming
  statPrecision: Settings['statPrecision']
}) {
  const { series, overviews } = useMemo(() => {
    const averages = buildAnalyticsAverages(
      trend.solves,
      AVERAGE_CHART_SIZES,
      trimming,
    )
    return {
      series: AVERAGE_CHART_SIZES.flatMap((size): AnalyticsSeries[] => {
        const values = averages.averages.get(size) ?? []
        return values.some((value) => value !== null)
          ? [
              {
                key: `ao${size}`,
                label: `ao${size}`,
                color: `var(--trend-ao${size})`,
                values,
              },
            ]
          : []
      }),
      overviews: computeAverageOverviews(
        trend,
        AVERAGE_CHART_SIZES,
        trimming,
        averages,
      ),
    }
  }, [trend, trimming])

  return (
    <div className="analytics-chart-stack">
      <AnalyticsLineChart
        title="Average progression"
        hideHeading
        ariaLabel="Average progression"
        series={series}
        xLabel={(index) => `#${index + 1}`}
        formatValue={(value) => formatTime(value)}
        formatTick={(value) => formatTime(value)}
        onSelectIndex={(index) => {
          const solve = trend.solves[index]
          if (solve) onSelectSolve(solve)
        }}
        emptyMessage="At least one complete average window is needed."
        testId="analytics-averages"
      />
      <div className="analytics-average-table-wrap">
        <table className="analytics-table">
          <thead>
            <tr>
              <th scope="col">Average</th>
              <th scope="col">Current</th>
              <th scope="col">Best</th>
              <th scope="col">Size</th>
            </tr>
          </thead>
          <tbody>
            {overviews
              .filter(
                (average) =>
                  average.best !== null || average.current !== null,
              )
              .map((average) => (
                <tr key={average.size}>
                  <th scope="row">ao{average.size}</th>
                  <td>{formatStatValue(average.current, statPrecision)}</td>
                  <td>{formatOptionalMs(average.best)}</td>
                  <td>{average.size} solves</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function PersonalBestsSection({
  trend,
  trimming,
  onSelectSolve,
}: SectionCalculationProps & { trimming: AverageTrimming }) {
  const multipleYears = useMultipleYears(trend)
  const pbHistory = useMemo(() => {
    const averages = buildAnalyticsAverages(trend.solves, [5, 12], trimming)
    return buildPBHistory(trend, averages.averages)
  }, [trend, trimming])
  const markers = useMemo(
    () =>
      pbHistory.single.map((event) => ({
        index: event.index,
        value: event.ms,
        label: `PB · ${formatTime(event.ms)}`,
      })),
    [pbHistory.single],
  )

  return (
    <div className="analytics-chart-stack">
      <AnalyticsLineChart
        title="PB progression"
        ariaLabel="Personal best progression"
        series={[
          {
            key: 'single',
            label: 'Single PB',
            color: 'var(--trend-single)',
            values: pbHistory.singleStep,
          },
          {
            key: 'ao5',
            label: 'ao5 PB',
            color: 'var(--trend-ao5)',
            values: pbHistory.averageSteps.get(5) ?? [],
          },
          {
            key: 'ao12',
            label: 'ao12 PB',
            color: 'var(--trend-ao12)',
            values: pbHistory.averageSteps.get(12) ?? [],
          },
        ]}
        xLabel={(index) =>
          formatAnalyticsAxisDate(
            trend.solves[index]?.createdAt ?? Date.now(),
            multipleYears,
          )
        }
        formatValue={(value) => formatTime(value)}
        formatTick={(value) => formatTime(value)}
        markers={markers}
        onSelectIndex={(index) => {
          const solve = trend.solves[index]
          if (solve) onSelectSolve(solve)
        }}
        emptyMessage="Personal bests appear after the first valid solve."
        testId="analytics-personal-bests"
      />
      <div className="analytics-pb-columns">
        <div>
          <h3>Recent single PBs</h3>
          {pbHistory.single.length === 0 ? (
            <p className="analytics-empty">No valid solves yet.</p>
          ) : (
            <table className="analytics-table">
              <thead>
                <tr>
                  <th scope="col">Time</th>
                  <th scope="col">When</th>
                  <th scope="col">Gain</th>
                  <th scope="col">Since previous</th>
                </tr>
              </thead>
              <tbody>
                {pbHistory.single.slice(-8).reverse().map((event) => (
                  <tr key={event.solve.id}>
                    <th scope="row">{formatTime(event.ms)}</th>
                    <td>{fullDate(event.solve.createdAt)}</td>
                    <td>
                      {event.improvementMs === null
                        ? 'First PB'
                        : `${formatTime(event.improvementMs)}`}
                    </td>
                    <td>
                      {event.gapMs === null ? '—' : formatDuration(event.gapMs)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div>
          <h3>Recent ao5 PBs</h3>
          {(pbHistory.averages.get(5) ?? []).length === 0 ? (
            <p className="analytics-empty">No complete ao5 window yet.</p>
          ) : (
            <table className="analytics-table">
              <thead>
                <tr>
                  <th scope="col">Average</th>
                  <th scope="col">When</th>
                  <th scope="col">Gain</th>
                </tr>
              </thead>
              <tbody>
                {(pbHistory.averages.get(5) ?? []).slice(-8).reverse().map((event) => (
                  <tr key={`${event.solve.id}-ao5`}>
                    <th scope="row">{formatTime(event.ms)}</th>
                    <td>{fullDate(event.solve.createdAt)}</td>
                    <td>
                      {event.improvementMs === null
                        ? 'First PB'
                        : formatTime(event.improvementMs)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

function DistributionSection({
  trend,
  intervalMs,
  selectedBin,
  onIntervalChange,
  onSelectBin,
  onClearBin,
}: SectionCalculationProps & {
  intervalMs: number | null
  selectedBin: HistogramBin | null
  onIntervalChange: (value: number | null) => void
  onSelectBin: (bin: HistogramBin) => void
  onClearBin: () => void
}) {
  const histogram = useMemo(
    () => buildHistogram(trend.singles, intervalMs, trend.times),
    [trend, intervalMs],
  )
  const selectedIndex = selectedBin
    ? histogram.bins.findIndex(
        (bin) =>
          bin.startMs === selectedBin.startMs && bin.endMs === selectedBin.endMs,
      )
    : -1

  return (
    <div className="analytics-chart-stack">
      <div className="analytics-chart-toolbar">
        <label>
          Interval
          <Select
            value={intervalMs === null ? 'auto' : String(intervalMs)}
            testId="analytics-interval"
            options={[
              { value: 'auto', label: 'Auto' },
              { value: '250', label: '0.25 s' },
              { value: '500', label: '0.5 s' },
              { value: '1000', label: '1 s' },
              { value: '2000', label: '2 s' },
              { value: '5000', label: '5 s' },
            ]}
            onChange={(value) =>
              onIntervalChange(value === 'auto' ? null : Number(value))
            }
          />
        </label>
        {selectedBin ? (
          <button
            type="button"
            className="time-trend-button"
            onClick={onClearBin}
          >
            Clear interval filter
          </button>
        ) : null}
      </div>
      <AnalyticsHistogram
        title="Solve time distribution"
        hideHeading
        bins={histogram.bins}
        formatValue={(value) => formatTime(value)}
        meanMs={histogram.meanMs}
        medianMs={histogram.medianMs}
        selectedIndex={selectedIndex}
        onSelectBin={(index) => {
          const bin = histogram.bins[index]
          if (bin) onSelectBin(bin)
        }}
      />
      {selectedBin ? (
        <p className="analytics-note" role="status">
          Showing <strong>{selectedBin.count}</strong> solves from{' '}
          {formatTime(selectedBin.startMs)} to {formatTime(selectedBin.endMs)} in
          the solve list.{' '}
        </p>
      ) : histogram.groupedExtremes ? (
        <p className="analytics-note">
          Edge bars group values beyond the central 98%.
        </p>
      ) : null}
      <div className="analytics-stat-grid is-compact">
        <StatCard label="Mean" value={formatOptionalMs(histogram.meanMs)} />
        <StatCard label="Median" value={formatOptionalMs(histogram.medianMs)} />
        <StatCard
          label="SD"
          value={
            histogram.standardDeviationMs === null
              ? '—'
              : `${(histogram.standardDeviationMs / 1_000).toFixed(2)} s`
          }
        />
        <StatCard
          label="Outliers"
          value={String(histogram.outlierCount)}
          detail={
            histogram.outlierLowMs === null || histogram.outlierHighMs === null
              ? 'No valid solves'
              : `Outside ${formatTime(histogram.outlierLowMs)}–${formatTime(histogram.outlierHighMs)}`
          }
        />
      </div>
    </div>
  )
}

function ConsistencySection({ trend, onSelectSolve }: SectionCalculationProps) {
  const consistency = useMemo(() => computeConsistency(trend), [trend])

  return (
    <div className="analytics-chart-stack">
      <div className="analytics-stat-grid is-compact">
        <StatCard
          label="SD"
          value={
            consistency.standardDeviationMs === null
              ? '—'
              : `${(consistency.standardDeviationMs / 1_000).toFixed(2)} s`
          }
        />
        <StatCard
          label="Coefficient of variation"
          value={formatPercent(
            consistency.coefficientOfVariation === null
              ? null
              : consistency.coefficientOfVariation * 100,
            2,
          )}
        />
        <StatCard
          label="Spread"
          value={formatOptionalMs(consistency.spreadMs)}
          detail={`${formatOptionalMs(consistency.fastestMs)} → ${formatOptionalMs(consistency.slowestMs)}`}
        />
        <StatCard
          label="Mean / median"
          value={`${formatOptionalMs(consistency.meanMs)} / ${formatOptionalMs(consistency.medianMs)}`}
        />
        {consistency.rolling.map((rolling) => (
          <StatCard
            key={rolling.size}
            label={`Rolling SD · ${rolling.size}`}
            value={
              rolling.latestMs === null
                ? '—'
                : `${(rolling.latestMs / 1_000).toFixed(2)} s`
            }
            detail={`Best ${rolling.bestMs === null ? '—' : `${(rolling.bestMs / 1_000).toFixed(2)} s`}`}
          />
        ))}
      </div>
      <AnalyticsLineChart
        title="Rolling standard deviation"
        ariaLabel="Rolling standard deviation"
        series={consistency.rolling.map((rolling) => ({
          key: `sd-${rolling.size}`,
          label: `SD ${rolling.size}`,
          color:
            rolling.size === 12 ? 'var(--trend-ao12)' : 'var(--trend-ao50)',
          values: rolling.values,
        }))}
        xLabel={(index) => `#${index + 1}`}
        formatValue={(value) => `${(value / 1_000).toFixed(2)} s`}
        formatTick={(value) => `${(value / 1_000).toFixed(1)}`}
        onSelectIndex={(index) => {
          const solve = trend.solves[index]
          if (solve) onSelectSolve(solve)
        }}
        emptyMessage="A rolling standard deviation needs a complete window."
        testId="analytics-consistency"
      />
    </div>
  )
}

function clampSubXPercent(value: number): number {
  return Math.max(38, Math.min(72, value))
}

function SubXSection({
  trend,
  event,
  targetMs,
  onCommitTarget,
  chartPercent,
  onChartPercentChange,
  onSelectSolve,
}: SectionCalculationProps & {
  event: PuzzleEvent
  targetMs: number
  onCommitTarget: (targetMs: number) => void
  chartPercent: number
  onChartPercentChange: (value: number) => void
}) {
  const subX = useMemo(() => computeSubX(trend, targetMs), [trend, targetMs])
  const splitRef = useRef<HTMLDivElement>(null)
  const splitDragRef = useRef<{ startX: number; startPercent: number } | null>(
    null,
  )
  const beginSplit = (pointerEvent: React.PointerEvent<HTMLDivElement>) => {
    if (pointerEvent.button !== 0) return
    splitDragRef.current = {
      startX: pointerEvent.clientX,
      startPercent: chartPercent,
    }
    pointerEvent.currentTarget.setPointerCapture(pointerEvent.pointerId)
  }
  const moveSplit = (pointerEvent: React.PointerEvent<HTMLDivElement>) => {
    const drag = splitDragRef.current
    const container = splitRef.current
    if (!drag || !container) return
    const width = Math.max(1, container.getBoundingClientRect().width)
    onChartPercentChange(
      clampSubXPercent(
        drag.startPercent +
          ((pointerEvent.clientX - drag.startX) / width) * 100,
      ),
    )
  }
  const endSplit = (pointerEvent: React.PointerEvent<HTMLDivElement>) => {
    if (!splitDragRef.current) return
    splitDragRef.current = null
    if (pointerEvent.currentTarget.hasPointerCapture(pointerEvent.pointerId)) {
      pointerEvent.currentTarget.releasePointerCapture(pointerEvent.pointerId)
    }
  }
  const subXChart = (
    <AnalyticsLineChart
      title="Sub-X percentage over time"
      ariaLabel="Sub-X percentage over time"
      series={[
        {
          key: 'subx',
          label: `Sub-${formatTime(targetMs)}`,
          color: 'var(--accent)',
          values: subX.progress,
        },
      ]}
      xLabel={(index) => `#${index + 1}`}
      formatValue={(value) => `${value.toFixed(1)}%`}
      formatTick={(value) => `${Math.round(value)}%`}
      onSelectIndex={(index) => {
        const solve = trend.solves[index]
        if (solve) onSelectSolve(solve)
      }}
      emptyMessage="No solves match the current filters."
      testId="analytics-subx"
    />
  )

  return (
    <div className="analytics-chart-stack analytics-subx-stack">
      <SubXTargetControl
        key={`${event}:${targetMs}`}
        event={event}
        targetMs={targetMs}
        onCommit={onCommitTarget}
      />
      <div className="analytics-stat-grid is-compact">
        <StatCard
          label="Sub-X rate"
          value={formatPercent(subX.percent)}
          detail={`${subX.successes.toLocaleString()} of ${subX.count.toLocaleString()} solves`}
        />
        <StatCard
          label="Valid-only rate"
          value={formatPercent(subX.validPercent)}
          detail={`${subX.validCount.toLocaleString()} valid solves`}
        />
        <StatCard
          label="Current streak"
          value={subX.currentStreak.toLocaleString()}
        />
        <StatCard
          label="Longest streak"
          value={subX.longestStreak.toLocaleString()}
        />
        <StatCard
          label="Estimated probability"
          value={formatPercent(subX.estimatedProbability)}
          title="A normal-approximation estimate based on the current mean and sample SD. It does not guarantee future results."
        />
      </div>
      {subX.bySession.length > 0 ? (
        <div
          className="analytics-subx-split"
          ref={splitRef}
          data-testid="analytics-subx-split"
        >
          <div
            className="analytics-subx-chart-pane"
            style={{ flexBasis: `${chartPercent}%` }}
          >
            {subXChart}
          </div>
          <div
            className="analytics-subx-divider"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize Sub-X chart and session breakdown"
            aria-valuemin={38}
            aria-valuemax={72}
            aria-valuenow={Math.round(chartPercent)}
            tabIndex={0}
            data-testid="analytics-subx-divider"
            onPointerDown={beginSplit}
            onPointerMove={moveSplit}
            onPointerUp={endSplit}
            onPointerCancel={endSplit}
            onDoubleClick={() => onChartPercentChange(58)}
            onKeyDown={(keyEvent) => {
              const step = keyEvent.shiftKey ? 8 : 3
              if (
                keyEvent.key === 'ArrowRight' ||
                keyEvent.key === 'ArrowDown'
              ) {
                keyEvent.preventDefault()
                onChartPercentChange(clampSubXPercent(chartPercent + step))
              } else if (
                keyEvent.key === 'ArrowLeft' ||
                keyEvent.key === 'ArrowUp'
              ) {
                keyEvent.preventDefault()
                onChartPercentChange(clampSubXPercent(chartPercent - step))
              } else if (keyEvent.key === 'Home') {
                keyEvent.preventDefault()
                onChartPercentChange(38)
              } else if (keyEvent.key === 'End') {
                keyEvent.preventDefault()
                onChartPercentChange(72)
              } else if (keyEvent.key === 'Enter' || keyEvent.key === ' ') {
                keyEvent.preventDefault()
                onChartPercentChange(58)
              }
            }}
          >
            <span className="analytics-subx-divider-grip" aria-hidden="true" />
          </div>
          <div
            className="analytics-subx-table-pane"
            data-testid="analytics-subx-table-pane"
          >
            <div className="analytics-subx-table-heading">
              <h3>Session breakdown</h3>
              <span>
                {subX.bySession.length.toLocaleString()}{' '}
                {subX.bySession.length === 1 ? 'session' : 'sessions'}
              </span>
            </div>
            <div
              className="analytics-subx-table-scroll"
              tabIndex={0}
              role="region"
              aria-label="Sub-X session breakdown. Scroll to see every session."
              data-testid="analytics-subx-table-scroll"
            >
              <table className="analytics-table analytics-subx-table">
                <caption className="sr-only">
                  Sub-X results by session under the current target. Column
                  headings stay visible while the table scrolls.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Session</th>
                    <th scope="col">Solves</th>
                    <th scope="col">Sub-X</th>
                    <th scope="col">Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {subX.bySession.map((session) => (
                    <tr key={session.sessionId}>
                      <th scope="row" title={session.sessionName}>
                        {session.sessionName}
                      </th>
                      <td>{session.count.toLocaleString()}</td>
                      <td>{session.successes.toLocaleString()}</td>
                      <td>{formatPercent(session.percent)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        subXChart
      )}
    </div>
  )
}

function SessionsSection({
  sessions,
  filters,
  trimming,
  targetMs,
  now,
}: {
  sessions: readonly Session[]
  filters: AnalyticsFilters
  trimming: AverageTrimming
  targetMs: number
  now: number
}) {
  const comparison = useMemo(
    () => compareSessions(sessions, filters, trimming, targetMs, now),
    [sessions, filters, trimming, targetMs, now],
  )
  const comparisonMax = comparison.reduce(
    (max, entry) => Math.max(max, entry.ao5.length),
    0,
  )
  const comparisonSeries: AnalyticsSeries[] = useMemo(
    () =>
      comparison.map((entry, index) => ({
        key: entry.id,
        label: entry.name,
        color: SESSION_PALETTE[index % SESSION_PALETTE.length]!,
        values: Array.from(
          { length: comparisonMax },
          (_, solveIndex) => entry.ao5[solveIndex] ?? null,
        ),
      })),
    [comparison, comparisonMax],
  )

  return (
    <div className="analytics-chart-stack">
      {comparison.length < 2 ? (
        <p className="analytics-empty">
          Select at least two sessions with solves, or record solves in another
          session, to compare them.
        </p>
      ) : (
        <>
          <div className="analytics-table-wrap">
            <table className="analytics-table analytics-compare-table">
              <thead>
                <tr>
                  <th scope="col">Measure</th>
                  {comparison.map((session) => (
                    <th scope="col" key={session.id}>
                      {session.name}
                      <span className="analytics-column-note">
                        {session.count.toLocaleString()} solves
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">Mean</th>
                  {comparison.map((session) => (
                    <td key={session.id}>
                      {formatOptionalMs(session.overview.meanMs)}
                    </td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">Median</th>
                  {comparison.map((session) => (
                    <td key={session.id}>
                      {formatOptionalMs(session.overview.medianMs)}
                    </td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">Best single</th>
                  {comparison.map((session) => (
                    <td key={session.id}>
                      {formatOptionalMs(session.overview.best)}
                    </td>
                  ))}
                </tr>
                {SESSION_AVERAGE_SIZES.map((size) => (
                  <tr key={size}>
                    <th scope="row">Best ao{size}</th>
                    {comparison.map((session) => (
                      <td key={session.id}>
                        {formatOptionalMs(
                          session.overview.averages.find(
                            (average) => average.size === size,
                          )?.best ?? null,
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr>
                  <th scope="row">Standard deviation</th>
                  {comparison.map((session) => (
                    <td key={session.id}>
                      {session.overview.standardDeviationMs === null
                        ? '—'
                        : `${(session.overview.standardDeviationMs / 1_000).toFixed(2)} s`}
                    </td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">DNF rate</th>
                  {comparison.map((session) => (
                    <td key={session.id}>
                      {formatPercent(session.overview.dnfPercent)}
                    </td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">Sub-X rate</th>
                  {comparison.map((session) => (
                    <td key={session.id}>
                      {formatPercent(session.subX.percent)}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
          <AnalyticsLineChart
            title="Session ao5 comparison"
            ariaLabel="Session ao5 comparison"
            series={comparisonSeries}
            xLabel={(index) => `#${index + 1}`}
            formatValue={(value) => formatTime(value)}
            formatTick={(value) => formatTime(value)}
            emptyMessage="No comparable sessions."
            testId="analytics-session-comparison"
          />
        </>
      )}
    </div>
  )
}

function ActivityCalendar({ report }: { report: ActivityReport }) {
  const [requestedStart, setRequestedStart] = useState<number | null>(null)

  if (report.heatmapStartMs === null || report.heatmapEndMs === null) {
    return <ActivityHeatmap days={[]} formatDate={(day) => fullDate(day.dateMs)} />
  }

  const latestStart = addLocalDays(
    report.heatmapEndMs,
    -(ACTIVITY_CALENDAR_WINDOW_DAYS - 1),
  )
  const windowStart = clampActivityCalendarStart(
    report,
    requestedStart ?? latestStart,
  )
  // ActivityCalendar is keyed by the filtered extent, so a new filter range
  // starts at its latest window instead of retaining an out-of-range anchor.
  const days = buildActivityCalendar(report.allDays, windowStart)
  const canGoEarlier = windowStart > report.heatmapStartMs
  const canGoLater = windowStart < latestStart
  const fullRange = `${fullDate(report.heatmapStartMs)} – ${fullDate(report.heatmapEndMs)}`

  return (
    <div className="analytics-heatmap-block">
      <div
        className="analytics-heatmap-nav"
        role="group"
        aria-label="Activity calendar range"
      >
        <button
          type="button"
          className="analytics-heatmap-nav-button"
          onClick={() => setRequestedStart(report.heatmapStartMs)}
          disabled={!canGoEarlier}
        >
          Earliest
        </button>
        <button
          type="button"
          className="analytics-heatmap-nav-button"
          onClick={() =>
            setRequestedStart(
              addLocalDays(windowStart, -ACTIVITY_CALENDAR_WINDOW_DAYS),
            )
          }
          disabled={!canGoEarlier}
        >
          Earlier
        </button>
        <span className="analytics-heatmap-nav-range">
          {fullRange}
        </span>
        <button
          type="button"
          className="analytics-heatmap-nav-button"
          onClick={() =>
            setRequestedStart(
              addLocalDays(windowStart, ACTIVITY_CALENDAR_WINDOW_DAYS),
            )
          }
          disabled={!canGoLater}
        >
          Later
        </button>
        <button
          type="button"
          className="analytics-heatmap-nav-button"
          onClick={() => setRequestedStart(latestStart)}
          disabled={!canGoLater}
        >
          Latest
        </button>
      </div>
      <ActivityHeatmap
        days={days}
        formatDate={(day) => fullDate(day.dateMs)}
      />
    </div>
  )
}

function ActivitySection({
  trend,
  now,
}: SectionCalculationProps & { now: number }) {
  const multipleYears = useMultipleYears(trend)
  const { activity, weeklyCounts } = useMemo(() => {
    const activityReport = buildActivity(trend, now)
    return {
      activity: activityReport,
      weeklyCounts: activityReport.weekly.map((week) => week.count),
    }
  }, [trend, now])

  return (
    <div className="analytics-chart-stack">
      <div className="analytics-stat-grid is-compact">
        <StatCard
          label="Timed practice"
          value={formatDuration(activity.totalTimeMs)}
        />
        <StatCard
          label="Active days"
          value={activity.activeDays.toLocaleString()}
          detail={`${activity.averagePerActiveDay.toFixed(1)} solves per active day`}
        />
        <StatCard
          label="Practice frequency"
          value={formatPercent(activity.frequency)}
        />
        <StatCard
          label="Current streak"
          value={`${activity.currentStreak.toLocaleString()} d`}
          detail={`Longest ${activity.longestStreak.toLocaleString()} days`}
        />
      </div>
      <div className="analytics-activity-split">
        <ActivityCalendar
          key={`${activity.heatmapStartMs ?? 'empty'}:${activity.heatmapEndMs ?? 'empty'}`}
          report={activity}
        />
        <AnalyticsLineChart
          title="Solve volume"
          ariaLabel="Weekly solve volume"
          series={[
            {
              key: 'weekly',
              label: 'Solves / week',
              color: 'var(--trend-ao200)',
              values: weeklyCounts,
            },
          ]}
          xLabel={(index) =>
            formatAnalyticsAxisDate(
              activity.weekly[index]?.startMs ?? Date.now(),
              multipleYears,
            )
          }
          formatValue={(value) => value.toLocaleString()}
          formatTick={(value) => Math.round(value).toLocaleString()}
          showControls
          emptyMessage="No practice activity yet."
          testId="analytics-activity-chart"
        />
      </div>
      <div className="analytics-pb-columns">
        <div>
          <h3>Most active days</h3>
          {activity.mostActive.length === 0 ? (
            <p className="analytics-empty">No solves match the filters.</p>
          ) : (
            <table className="analytics-table">
              <thead>
                <tr>
                  <th scope="col">Day</th>
                  <th scope="col">Solves</th>
                  <th scope="col">Timed</th>
                </tr>
              </thead>
              <tbody>
                {activity.mostActive.map((day) => (
                  <tr key={day.key}>
                    <th scope="row">{fullDate(day.dateMs)}</th>
                    <td>{day.count.toLocaleString()}</td>
                    <td>{formatDuration(day.timeMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div>
          <h3>Best / hardest practice days</h3>
          {activity.bestPerformanceDay === null ? (
            <p className="analytics-empty">
              Days with at least three valid solves are ranked by mean time.
            </p>
          ) : (
            <table className="analytics-table">
              <thead>
                <tr>
                  <th scope="col">Day</th>
                  <th scope="col">Mean</th>
                  <th scope="col">Solves</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">
                    Best · {fullDate(activity.bestPerformanceDay.dateMs)}
                  </th>
                  <td>{formatTime(activity.bestPerformanceDay.meanMs)}</td>
                  <td>{activity.bestPerformanceDay.count}</td>
                </tr>
                {activity.worstPerformanceDay &&
                activity.worstPerformanceDay.key !==
                  activity.bestPerformanceDay.key ? (
                  <tr>
                    <th scope="row">
                      Hardest · {fullDate(activity.worstPerformanceDay.dateMs)}
                    </th>
                    <td>{formatTime(activity.worstPerformanceDay.meanMs)}</td>
                    <td>{activity.worstPerformanceDay.count}</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

function AdvancedSection({
  trend,
  targetMs,
  onSelectSolve,
}: SectionCalculationProps & { targetMs: number }) {
  const multipleYears = useMultipleYears(trend)
  const advanced = useMemo(
    () => computeAdvanced(trend, targetMs),
    [trend, targetMs],
  )

  return (
    <div className="analytics-chart-stack">
      <div className="analytics-stat-grid is-compact is-advanced">
        <StatCard label="5th percentile" value={formatOptionalMs(advanced.p5Ms)} />
        <StatCard label="25th percentile" value={formatOptionalMs(advanced.p25Ms)} />
        <StatCard label="50th percentile" value={formatOptionalMs(advanced.p50Ms)} />
        <StatCard label="75th percentile" value={formatOptionalMs(advanced.p75Ms)} />
        <StatCard label="95th percentile" value={formatOptionalMs(advanced.p95Ms)} />
        <StatCard
          label="PB frequency"
          value={advanced.pbCount.toLocaleString()}
          detail={`${advanced.pbRatePer100.toFixed(2)} per 100 solves`}
          title="Count of new single personal bests in the filtered history."
        />
        <StatCard
          label="PB per month"
          value={
            advanced.pbPerMonth === null
              ? '—'
              : advanced.pbPerMonth.toFixed(2)
          }
        />
        <StatCard
          label="Improvement rate"
          value={formatPercent(advanced.improvementPercent)}
        />
        <StatCard
          label="Target estimate"
          value={formatPercent(advanced.estimatedTargetProbability)}
          detail={`Sub-${formatTime(targetMs)} · normal estimate`}
          title="Estimated from the filtered mean and sample standard deviation, not a guarantee."
        />
      </div>
      <AnalyticsLineChart
        title="Moving median"
        ariaLabel="Moving median"
        series={[
          {
            key: 'median',
            label: 'Moving median',
            color: 'var(--trend-ao25)',
            values: advanced.movingMedian,
          },
        ]}
        xLabel={(index) => `#${index + 1}`}
        formatValue={(value) => formatTime(value)}
        formatTick={(value) => formatTime(value)}
        onSelectIndex={(index) => {
          const solve = trend.solves[index]
          if (solve) onSelectSolve(solve)
        }}
        emptyMessage="No valid solves match the current filters."
        testId="analytics-moving-median"
      />
      <div className="analytics-pb-columns">
        <div>
          <h3>Fastest solves</h3>
          {advanced.fastest.length === 0 ? (
            <p className="analytics-empty">No valid solves.</p>
          ) : (
            <table className="analytics-table">
              <thead>
                <tr>
                  <th scope="col">Time</th>
                  <th scope="col">Session</th>
                  <th scope="col">Date</th>
                </tr>
              </thead>
              <tbody>
                {advanced.fastest.map((entry) => (
                  <tr key={entry.solve.id}>
                    <th scope="row">
                      <button
                        type="button"
                        className="analytics-link"
                        onClick={() => onSelectSolve(entry.solve)}
                      >
                        {formatTime(entry.ms)}
                      </button>
                    </th>
                    <td>{entry.solve.sessionName}</td>
                    <td>
                      {formatAnalyticsAxisDate(
                        entry.solve.createdAt,
                        multipleYears,
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div>
          <h3>Slowest solves</h3>
          {advanced.slowest.length === 0 ? (
            <p className="analytics-empty">No valid solves.</p>
          ) : (
            <table className="analytics-table">
              <thead>
                <tr>
                  <th scope="col">Time</th>
                  <th scope="col">Session</th>
                  <th scope="col">Date</th>
                </tr>
              </thead>
              <tbody>
                {advanced.slowest.map((entry) => (
                  <tr key={entry.solve.id}>
                    <th scope="row">
                      <button
                        type="button"
                        className="analytics-link"
                        onClick={() => onSelectSolve(entry.solve)}
                      >
                        {formatTime(entry.ms)}
                      </button>
                    </th>
                    <td>{entry.solve.sessionName}</td>
                    <td>
                      {formatAnalyticsAxisDate(
                        entry.solve.createdAt,
                        multipleYears,
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}


interface AnalyticsPageProps {
  sessions: readonly Session[]
  initialEvent: PuzzleEvent
  settings: Settings
  onChange: (next: Partial<Settings>) => void
}

export default function AnalyticsPage({
  sessions,
  initialEvent,
  settings,
  onChange,
}: AnalyticsPageProps) {
  const localDay = useLocalDayRefresh()
  const analyticsSettings = settings.analytics
  const sectionSettings = useMemo(
    () => normalizeAnalyticsSections(analyticsSettings.sections),
    [analyticsSettings.sections],
  )
  const analysisSections = useMemo(
    () => sectionSettings.filter((section) => section.id !== 'overview'),
    [sectionSettings],
  )
  const visibleAnalysisSections = useMemo(
    () => analysisSections.filter((section) => section.visible),
    [analysisSections],
  )
  const [activeAnalysis, setActiveAnalysis] = useState<AnalyticsSectionId>(
    () => visibleAnalysisSections[0]?.id ?? 'progression',
  )
  const [filters, setFilters] = useState<AnalyticsFilters>(() =>
    createAnalyticsFilters(initialEvent),
  )
  const [filtersOpen, setFiltersOpen] = useState(
    () =>
      typeof window === 'undefined' ||
      !window.matchMedia?.('(max-width: 680px)').matches,
  )
  const [selectedSolve, setSelectedSolve] = useState<AnalyticsSolve | null>(null)
  const [selectedBin, setSelectedBin] = useState<HistogramBin | null>(null)
  const [solveListOpen, setSolveListOpen] = useState(false)
  const [sessionsMenuOpen, setSessionsMenuOpen] = useState(false)
  const [histogramIntervalMs, setHistogramIntervalMs] = useState<number | null>(null)
  const [progressSeries, setProgressSeries] = useState<ReadonlySet<string>>(
    () => new Set(['single', 'ao5', 'ao12']),
  )
  const [progressXAxis, setProgressXAxis] = useState<'solve' | 'date'>('solve')
  const [customizeOpen, setCustomizeOpen] = useState(false)
  const [subXChartPercent, setSubXChartPercent] = useState(58)
  const sessionsTriggerRef = useRef<HTMLButtonElement>(null)
  const sessionsPanelRef = useRef<HTMLDivElement>(null)
  const sessionsRootRef = useRef<HTMLDivElement>(null)

  useDismissablePopover({
    open: sessionsMenuOpen,
    onClose: () => setSessionsMenuOpen(false),
    triggerRef: sessionsTriggerRef,
    panelRef: sessionsPanelRef,
    rootRef: sessionsRootRef,
  })

  const trimming: AverageTrimming = useMemo(
    () => ({
      better: settings.averageTrimBetter,
      worse: settings.averageTrimWorse,
    }),
    [settings.averageTrimBetter, settings.averageTrimWorse],
  )
  const filtered = useMemo(
    () => filterAnalyticsSolves(sessions, filters, localDay),
    [sessions, filters, localDay],
  )
  // The single and PB preparation is shared by every section. Rolling series
  // are built only by the section that needs them.
  const trend = useMemo(
    () => buildAnalyticsTrend(filtered, [], trimming),
    [filtered, trimming],
  )
  const overviewAverages = useMemo(
    () => buildAnalyticsAverages(filtered, OVERVIEW_AVERAGE_SIZES, trimming),
    [filtered, trimming],
  )
  const overview = useMemo(
    () =>
      computeAnalyticsOverview(
        trend,
        OVERVIEW_AVERAGE_SIZES,
        trimming,
        overviewAverages,
      ),
    [trend, trimming, overviewAverages],
  )
  const visibleOverviewAverages = overview.averages.filter(
    (average) => average.best !== null || average.current !== null,
  )
  const featuredAverages = visibleOverviewAverages.filter(
    (average) =>
      average.size === 5 || average.size === 12 || average.size === 50,
  )
  const detailAverages = visibleOverviewAverages.filter(
    (average) =>
      average.size !== 5 && average.size !== 12 && average.size !== 50,
  )
  const scopeSummary = useMemo(() => {
    if (filtered.length === 0) return 'No solves in scope'
    const first = filtered[0]!
    const last = filtered[filtered.length - 1]!
    const sessionCount = new Set(
      filtered.map((solve) => solve.sessionId),
    ).size
    const range =
      fullDate(first.createdAt) === fullDate(last.createdAt)
        ? fullDate(first.createdAt)
        : `${fullDate(first.createdAt)} – ${fullDate(last.createdAt)}`
    return `${range} · ${sessionCount.toLocaleString()} ${
      sessionCount === 1 ? 'session' : 'sessions'
    }`
  }, [filtered])
  const activeFilterCount =
    (filters.event === 'all' ? 0 : 1) +
    (filters.sessionIds === null ? 0 : 1) +
    (filters.datePreset === 'all' ? 0 : 1) +
    (filters.solveLimit === null ? 0 : 1) +
    (filters.penalty === 'all' ? 0 : 1)
  const activeTargetEvent = filters.event === 'all' ? initialEvent : filters.event
  const targetMs = getSubXTargetMs(analyticsSettings, activeTargetEvent)
  const selectedAnalysis =
    visibleAnalysisSections.find((section) => section.id === activeAnalysis) ??
    visibleAnalysisSections[0] ??
    null
  const sessionFilterKey =
    filters.sessionIds === null ? 'all' : filters.sessionIds.join(',')
  useEffect(() => {
    // Switching sessions, events, dates, penalties, intervals or solve data
    // must not keep a drill-down interval from the previous histogram.
    // oxlint-disable-next-line react/set-state-in-effect
    setSelectedBin(null)
  }, [
    filters.event,
    filters.datePreset,
    filters.customStart,
    filters.customEnd,
    filters.solveLimit,
    filters.penalty,
    sessionFilterKey,
    sessions,
    histogramIntervalMs,
  ])
  const activeBin = selectedBin
  const solveListSolves = useMemo(() => {
    if (activeBin) {
      const matches: AnalyticsSolve[] = []
      trend.solves.forEach((solve, index) => {
        const time = trend.singles[index] ?? null
        if (
          time !== null &&
          time >= activeBin.startMs &&
          time < activeBin.endMs
        ) {
          matches.push(solve)
        }
      })
      return matches.reverse()
    }
    return [...filtered].reverse()
  }, [activeBin, filtered, trend])

  const toggleProgressSeries = (key: string) => {
    setProgressSeries((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const updateAnalytics = (next: Partial<Settings['analytics']>) => {
    onChange({ analytics: { ...analyticsSettings, ...next } })
  }
  const moveSection = (id: AnalyticsSectionId, direction: -1 | 1) => {
    const sections = [...analyticsSettings.sections]
    const index = sections.findIndex((section) => section.id === id)
    const target = index + direction
    if (index < 0 || target < 0 || target >= sections.length) return
    const [entry] = sections.splice(index, 1)
    if (entry) sections.splice(target, 0, entry)
    updateAnalytics({ sections })
  }
  const resetLayout = () => {
    const defaults = createDefaultAnalyticsSettings()
    updateAnalytics({ sections: defaults.sections })
  }
  const resetFilters = () => {
    setFilters(createAnalyticsFilters(initialEvent))
    setSelectedBin(null)
  }

  const sessionChoices = sessions.filter(
    (session) =>
      filters.event === 'all' ||
      session.event === filters.event ||
      session.solves.some((solve) => solve.event === filters.event),
  )
  const selectedSessionIds = filters.sessionIds
  const selectedSessionCount =
    selectedSessionIds === null
      ? sessionChoices.length
      : sessionChoices.filter((session) =>
          selectedSessionIds.includes(session.id),
        ).length
  const allSessionsSelected =
    selectedSessionIds === null ||
    (sessionChoices.length > 0 &&
      selectedSessionCount === sessionChoices.length)
  const noSessionsSelected =
    selectedSessionIds !== null && selectedSessionCount === 0
  const analysisEmptyMessage = noSessionsSelected
    ? 'Select at least one session to see this analysis.'
    : undefined
  const analysisEmpty = analysisEmptyMessage !== undefined
  const partialSessionsSelected =
    !allSessionsSelected && !noSessionsSelected
  const selectedSessionLabel = allSessionsSelected
    ? 'All sessions'
    : noSessionsSelected
      ? 'No sessions'
      : selectedSessionCount === 1
        ? sessionChoices.find((session) =>
            selectedSessionIds?.includes(session.id),
          )?.name ?? '1 session'
        : `${selectedSessionCount} of ${sessionChoices.length} sessions`
  const selectAllSessions = () =>
    setFilters((current) => ({ ...current, sessionIds: null }))

  const overviewContent =
    overview.count === 0 ? (
      <div
        className="analytics-overview-empty"
        data-testid="analytics-overview"
      >
        <p>No solves match this scope.</p>
        {activeFilterCount > 0 ? (
          <button
            type="button"
            className="analytics-link"
            onClick={resetFilters}
          >
            Reset filters
          </button>
        ) : (
          <p>Record or import solves to populate the overview.</p>
        )}
      </div>
    ) : (
      <div className="analytics-overview" data-testid="analytics-overview">
        <div className="analytics-overview-hero">
          <StatCard
            label="Best single"
            value={formatOptionalMs(overview.best)}
            variant="hero"
            accent
          />
          {featuredAverages.map((average) => (
            <StatCard
              key={average.size}
              label={`Current ao${average.size}`}
              value={formatStatValue(
                average.current,
                settings.statPrecision,
              )}
              detail={`Best ${formatOptionalMs(average.best)}`}
              title={`Current and best trimmed ao${average.size}. DNFs follow the configured WCA-style trimming rules.`}
              variant="hero"
            />
          ))}
          <StatCard
            label="Total solves"
            value={overview.count.toLocaleString()}
            detail={`${overview.validCount.toLocaleString()} valid · ${overview.dnfCount.toLocaleString()} DNF`}
            title="Every solve matching the global filters. DNFs stay in the total and are excluded from time statistics."
            variant="hero"
          />
        </div>
        <div
          className="analytics-overview-detail"
          data-count={8 + detailAverages.length}
        >
          <StatCard
            label="Worst single"
            value={formatOptionalMs(overview.worst)}
            variant="detail"
          />
          <StatCard
            label="Mean"
            value={formatOptionalMs(overview.meanMs)}
            title="Arithmetic mean of valid recorded results."
            variant="detail"
          />
          <StatCard
            label="Median"
            value={formatOptionalMs(overview.medianMs)}
            variant="detail"
          />
          <StatCard
            label="Standard deviation"
            value={
              overview.standardDeviationMs === null
                ? '—'
                : `${(overview.standardDeviationMs / 1_000).toFixed(2)} s`
            }
            title="Sample standard deviation of valid solve times. Lower is more consistent."
            variant="detail"
          />
          <StatCard
            label="Practice time"
            value={formatDuration(overview.totalTimeMs)}
            title="Time spent in recorded valid solves. CubeLab does not store idle time."
            variant="detail"
          />
          <StatCard
            label="Active days"
            value={overview.activeDays.toLocaleString()}
            variant="detail"
          />
          <StatCard
            label="DNF rate"
            value={formatPercent(overview.dnfPercent)}
            title="Share of filtered solves marked DNF."
            variant="detail"
          />
          <StatCard
            label="Improvement"
            value={formatPercent(overview.improvementPercent)}
            title="Positive values mean the latest tenth of the filtered history is faster than the earliest tenth."
            variant="detail"
          />
          {detailAverages.map((average) => (
            <StatCard
              key={average.size}
              label={`Current ao${average.size}`}
              value={formatStatValue(
                average.current,
                settings.statPrecision,
              )}
              detail={`Best ${formatOptionalMs(average.best)}`}
              title={`Current and best trimmed ao${average.size}. DNFs follow the configured WCA-style trimming rules.`}
              variant="detail"
            />
          ))}
        </div>
      </div>
    )

  const selectedAnalysisContent = !selectedAnalysis ? null
    : selectedAnalysis.id === 'progression' ? (
        <ProgressionSection
          trend={trend}
          trimming={trimming}
          progressSeries={progressSeries}
          onToggleSeries={toggleProgressSeries}
          progressXAxis={progressXAxis}
          onChangeXAxis={setProgressXAxis}
          onSelectSolve={setSelectedSolve}
        />
      )
    : selectedAnalysis.id === 'averages' ? (
        <AveragesSection
          trend={trend}
          trimming={trimming}
          statPrecision={settings.statPrecision}
          onSelectSolve={setSelectedSolve}
        />
      )
    : selectedAnalysis.id === 'personalBests' ? (
        <PersonalBestsSection
          trend={trend}
          trimming={trimming}
          onSelectSolve={setSelectedSolve}
        />
      )
    : selectedAnalysis.id === 'distribution' ? (
        <DistributionSection
          trend={trend}
          intervalMs={histogramIntervalMs}
          selectedBin={selectedBin}
          onIntervalChange={setHistogramIntervalMs}
          onSelectBin={(bin) => {
            setSelectedBin(bin)
            setSolveListOpen(true)
          }}
          onClearBin={() => setSelectedBin(null)}
          onSelectSolve={setSelectedSolve}
        />
      )
    : selectedAnalysis.id === 'consistency' ? (
        <ConsistencySection
          trend={trend}
          onSelectSolve={setSelectedSolve}
        />
      )
    : selectedAnalysis.id === 'subX' ? (
        <SubXSection
          trend={trend}
          event={activeTargetEvent}
          targetMs={targetMs}
          onCommitTarget={(nextTargetMs) =>
            updateAnalytics({
              subXTargetsMs: {
                ...analyticsSettings.subXTargetsMs,
                [activeTargetEvent]: nextTargetMs,
              },
            })
          }
          chartPercent={subXChartPercent}
          onChartPercentChange={setSubXChartPercent}
          onSelectSolve={setSelectedSolve}
        />
      )
    : selectedAnalysis.id === 'sessions' ? (
        <SessionsSection
          sessions={sessions}
          filters={filters}
          trimming={trimming}
          targetMs={targetMs}
          now={localDay}
        />
      )
    : selectedAnalysis.id === 'activity' ? (
        <ActivitySection
          trend={trend}
          now={localDay}
          onSelectSolve={setSelectedSolve}
        />
      )
    : (
        <AdvancedSection
          trend={trend}
          targetMs={targetMs}
          onSelectSolve={setSelectedSolve}
        />
      )

  return (
    <main
      className={`analytics-page${customizeOpen ? ' is-customizing' : ''}${
        overview.count === 0 ? ' is-empty' : ''
      }${analysisEmpty ? ' is-analysis-empty' : ''}`}
      aria-labelledby="analytics-title"
    >
      <header className="analytics-heading">
        <div className="analytics-heading-copy">
          <h1 id="analytics-title">Analytics</h1>
          <span className="analytics-record-count">
            {overview.count.toLocaleString()} matching solves
          </span>
        </div>
        <div className="analytics-heading-actions">
          <button
            type="button"
            className="analytics-action is-primary"
            onClick={() => {
              setSelectedBin(null)
              setSolveListOpen(true)
            }}
            disabled={overview.count === 0}
            data-testid="analytics-view-solves"
          >
            <ListIcon size={14} />
            View solves
          </button>
          <button
            type="button"
            className={`analytics-action${customizeOpen ? ' is-active' : ''}`}
            aria-expanded={customizeOpen}
            aria-controls="analytics-customize"
            onClick={() => setCustomizeOpen((open) => !open)}
            data-testid="analytics-customize-toggle"
          >
            <SlidersIcon size={14} />
            Customize
          </button>
        </div>
      </header>

      <button
        type="button"
        className={`analytics-action analytics-filters-toggle${filtersOpen ? ' is-active' : ''}`}
        aria-expanded={filtersOpen}
        aria-controls="analytics-filters"
        onClick={() => setFiltersOpen((open) => !open)}
        data-testid="analytics-filters-toggle"
      >
        <SlidersIcon size={14} />
        Filters
        {activeFilterCount > 0 ? (
          <span className="analytics-filters-count">
            {activeFilterCount} active
          </span>
        ) : null}
      </button>

      <section
        id="analytics-filters"
        className={`analytics-filters${filtersOpen ? '' : ' is-collapsed'}`}
        aria-label="Analytics filters"
      >
        <div className="analytics-filter-controls">
          <label className="analytics-filter-field is-event">
            Event
            <Select
              value={filters.event}
              ariaLabel="Analytics event"
              testId="analytics-event"
              options={[
                { value: 'all', label: 'All events' },
                ...getEventOptions().map((entry) => ({
                  value: entry.id,
                  label: formatEventOptionLabel(entry),
                  text: entry.label,
                })),
              ]}
              onChange={(value) =>
                setFilters((current) => ({
                  ...current,
                  event: value as PuzzleEvent | 'all',
                  sessionIds: null,
                }))
              }
            />
          </label>

          <div
            className="analytics-filter-field analytics-multiselect"
            ref={sessionsRootRef}
          >
            <span>Sessions</span>
            <button
              ref={sessionsTriggerRef}
              type="button"
              className="analytics-multiselect-trigger"
              aria-haspopup="listbox"
              aria-expanded={sessionsMenuOpen}
              aria-controls="analytics-session-filter-menu"
              data-testid="analytics-sessions-trigger"
              onClick={() => setSessionsMenuOpen((open) => !open)}
            >
              <span className="analytics-multiselect-value">
                {selectedSessionLabel}
              </span>
              <span
                className="analytics-multiselect-chevron"
                aria-hidden="true"
              />
            </button>
            {sessionsMenuOpen ? (
              <div
                ref={sessionsPanelRef}
                className="analytics-multiselect-menu"
                id="analytics-session-filter-menu"
                role="group"
                aria-label="Session filters"
                data-timer-space-ignore="true"
              >
                <label className="analytics-multiselect-row">
                  <input
                    type="checkbox"
                    data-testid="analytics-sessions-all"
                    checked={allSessionsSelected}
                    aria-checked={
                      partialSessionsSelected
                        ? 'mixed'
                        : allSessionsSelected
                          ? 'true'
                          : 'false'
                    }
                    ref={(input) => {
                      if (input) input.indeterminate = partialSessionsSelected
                    }}
                    onChange={() =>
                      setFilters((current) => ({
                        ...current,
                        sessionIds: allSessionsSelected ? [] : null,
                      }))
                    }
                  />
                  <span className="analytics-multiselect-name">All sessions</span>
                  <span className="analytics-multiselect-meta">
                    {sessionChoices.length}{' '}
                    {sessionChoices.length === 1 ? 'session' : 'sessions'}
                  </span>
                </label>
                {sessionChoices.map((session) => {
                  const checked =
                    filters.sessionIds === null ||
                    filters.sessionIds.includes(session.id)
                  return (
                    <label
                      key={session.id}
                      className="analytics-multiselect-row"
                    >
                      <input
                        type="checkbox"
                        data-testid={`analytics-session-option-${session.id}`}
                        checked={checked}
                        onChange={() => {
                          const base =
                            filters.sessionIds === null
                              ? sessionChoices.map((entry) => entry.id)
                              : filters.sessionIds
                          setFilters((current) => ({
                            ...current,
                            sessionIds: checked
                              ? base.filter((id) => id !== session.id)
                              : [...base, session.id],
                          }))
                        }}
                      />
                      <span
                        className="analytics-multiselect-name"
                        title={session.name}
                      >
                        {session.name}
                      </span>
                      <span className="analytics-multiselect-meta">
                        {session.solves.length} solves
                      </span>
                    </label>
                  )
                })}
                {sessionChoices.length === 0 ? (
                  <p className="analytics-note">No sessions match this event.</p>
                ) : null}
              </div>
            ) : null}
            <span className="sr-only" role="status" aria-live="polite">
              {selectedSessionLabel}
            </span>
          </div>

          <label className="analytics-filter-field is-date">
            Date range
            <Select
              value={filters.datePreset}
              testId="analytics-date-range"
              options={[
                { value: 'all', label: 'All time' },
                { value: 'today', label: 'Today' },
                { value: '7d', label: 'Last 7 days' },
                { value: '30d', label: 'Last 30 days' },
                { value: '90d', label: 'Last 90 days' },
                { value: 'year', label: 'Last year' },
                { value: 'custom', label: 'Custom…' },
              ]}
              onChange={(value) =>
                setFilters((current) => ({
                  ...current,
                  datePreset: value as AnalyticsFilters['datePreset'],
                }))
              }
            />
          </label>

          {filters.datePreset === 'custom' ? (
            <div className="analytics-date-custom">
              <label>
                From
                <input
                  type="date"
                  value={filters.customStart}
                  onChange={(event) =>
                    setFilters((current) => ({
                      ...current,
                      customStart: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                To
                <input
                  type="date"
                  value={filters.customEnd}
                  onChange={(event) =>
                    setFilters((current) => ({
                      ...current,
                      customEnd: event.target.value,
                    }))
                  }
                />
              </label>
            </div>
          ) : null}

          <label className="analytics-filter-field is-limit">
            Last solves
            <Select
              value={filters.solveLimit === null ? 'all' : String(filters.solveLimit)}
              testId="analytics-solve-limit"
              options={[
                { value: 'all', label: 'All' },
                { value: '5', label: '5' },
                { value: '12', label: '12' },
                { value: '50', label: '50' },
                { value: '100', label: '100' },
                { value: '500', label: '500' },
                { value: '1000', label: '1,000' },
              ]}
              onChange={(value) =>
                setFilters((current) => ({
                  ...current,
                  solveLimit: value === 'all' ? null : Number(value),
                }))
              }
            />
          </label>

          <label className="analytics-filter-field is-penalty">
            Penalty
            <Select
              value={filters.penalty}
              testId="analytics-penalty"
              options={[
                { value: 'all', label: 'All results' },
                { value: 'none', label: 'Normal' },
                { value: '+2', label: '+2' },
                { value: 'dnf', label: 'DNF' },
              ]}
              onChange={(value) =>
                setFilters((current) => ({
                  ...current,
                  penalty: value as AnalyticsFilters['penalty'],
                }))
              }
            />
          </label>

          <button
            type="button"
            className="analytics-reset-filters"
            onClick={resetFilters}
            data-testid="analytics-reset-filters"
          >
            <ResetIcon size={13} />
            Reset filters
          </button>
        </div>
      </section>

      {noSessionsSelected ? (
        <div
          className="analytics-empty-selection"
          role="status"
          data-testid="analytics-no-sessions"
        >
          <div>
            <strong>No sessions selected.</strong> Analytics is showing no
            solves until you choose at least one session.
          </div>
          <button
            type="button"
            className="time-trend-button"
            data-testid="analytics-select-all-sessions"
            onClick={selectAllSessions}
          >
            Select all sessions
          </button>
        </div>
      ) : null}

      {customizeOpen ? (
        <section
          className="analytics-customize"
          id="analytics-customize"
          aria-label="Customize analytics dashboard"
        >
          <div className="analytics-customize-heading">
            <div className="analytics-customize-title">
              <h2>Sections</h2>
              <span className="analytics-customize-count">
                {analyticsSettings.sections.filter((section) => section.visible).length}{' '}
                of {analyticsSettings.sections.length} visible
              </span>
            </div>
            <button type="button" className="time-trend-button" onClick={resetLayout}>
              Reset layout
            </button>
          </div>
          <ol className="analytics-customize-list">
            {analyticsSettings.sections.map((section, index) => (
              <li key={section.id}>
                <label className="analytics-checkbox">
                  <input
                    type="checkbox"
                    checked={section.visible}
                    onChange={() =>
                      updateAnalytics({
                        sections: analyticsSettings.sections.map((entry) =>
                          entry.id === section.id
                            ? { ...entry, visible: !entry.visible }
                            : entry,
                        ),
                      })
                    }
                  />
                  {ANALYTICS_SECTION_LABELS[section.id]}
                </label>
                <span className="analytics-customize-move">
                  <button
                    type="button"
                    className="time-trend-button"
                    aria-label={`Move ${ANALYTICS_SECTION_LABELS[section.id]} up`}
                    disabled={index === 0 || section.id === 'overview'}
                    onClick={() => moveSection(section.id, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="time-trend-button"
                    aria-label={`Move ${ANALYTICS_SECTION_LABELS[section.id]} down`}
                    disabled={
                      index === analyticsSettings.sections.length - 1 ||
                      section.id === 'overview'
                    }
                    onClick={() => moveSection(section.id, 1)}
                  >
                    ↓
                  </button>
                </span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {sectionSettings.find((section) => section.id === 'overview')?.visible ? (
        <Section
          id="overview"
          title={ANALYTICS_SECTION_LABELS.overview}
          meta={
            overview.count === 0
              ? undefined
              : `${scopeSummary} · ${overview.validCount.toLocaleString()} valid ${
                  overview.validCount === 1 ? 'solve' : 'solves'
                }`
          }
          wide
        >
          {overviewContent}
        </Section>
      ) : null}

      {visibleAnalysisSections.length > 0 ? (
        <div className="analytics-analysis-layout">
          <nav
            className="analytics-analysis-nav"
            aria-labelledby="analytics-analysis-heading"
          >
            <div className="analytics-analysis-nav-heading">
              <h2 id="analytics-analysis-heading">Analysis</h2>
            </div>
            <div
              className="analytics-analysis-tabs"
              role="tablist"
              aria-labelledby="analytics-analysis-heading"
              aria-orientation="vertical"
            >
              {visibleAnalysisSections.map((section) => {
                const selected = selectedAnalysis?.id === section.id
                return (
                  <button
                    key={section.id}
                    type="button"
                    role="tab"
                    id={`analytics-analysis-tab-${section.id}`}
                    aria-selected={selected}
                    aria-controls="analytics-analysis-panel"
                    tabIndex={selected ? 0 : -1}
                    className={`analytics-analysis-tab${selected ? ' is-selected' : ''}`}
                    data-testid={`analytics-analysis-tab-${section.id}`}
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={(event) => {
                      setActiveAnalysis(section.id)
                      // Keep a section switch from auto-scrolling the bounded
                      // analysis rail and moving the heading or tab items.
                      event.currentTarget.focus({ preventScroll: true })
                    }}
                    onKeyDown={(event) => {
                      const index = visibleAnalysisSections.findIndex(
                        (candidate) => candidate.id === section.id,
                      )
                      let nextIndex: number | null = null
                      if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
                        nextIndex = (index + 1) % visibleAnalysisSections.length
                      } else if (
                        event.key === 'ArrowUp' ||
                        event.key === 'ArrowLeft'
                      ) {
                        nextIndex =
                          (index - 1 + visibleAnalysisSections.length) %
                          visibleAnalysisSections.length
                      } else if (event.key === 'Home') {
                        nextIndex = 0
                      } else if (event.key === 'End') {
                        nextIndex = visibleAnalysisSections.length - 1
                      }
                      if (nextIndex === null) return
                      event.preventDefault()
                      const next = visibleAnalysisSections[nextIndex]
                      if (!next) return
                      setActiveAnalysis(next.id)
                      document
                        .getElementById(`analytics-analysis-tab-${next.id}`)
                        ?.focus({ preventScroll: true })
                    }}
                  >
                    {ANALYTICS_SECTION_LABELS[section.id]}
                  </button>
                )
              })}
            </div>
            <label className="analytics-analysis-mobile-select">
              Analysis
              <Select
                ariaLabel="Select analysis"
                testId="analytics-analysis-select"
                value={selectedAnalysis?.id ?? ''}
                options={visibleAnalysisSections.map((section) => ({
                  value: section.id,
                  label: ANALYTICS_SECTION_LABELS[section.id],
                }))}
                onChange={(value) =>
                  setActiveAnalysis(value as AnalyticsSectionId)
                }
              />
            </label>
          </nav>

          <div
            className="analytics-analysis-content"
            id="analytics-analysis-panel"
            data-testid="analytics-analysis-panel"
            role="tabpanel"
            aria-labelledby={
              selectedAnalysis
                ? `analytics-analysis-tab-${selectedAnalysis.id}`
                : undefined
            }
          >
            {selectedAnalysis ? (
              <Section
                key={selectedAnalysis.id}
                id={selectedAnalysis.id}
                title={ANALYTICS_SECTION_LABELS[selectedAnalysis.id]}
                emptyMessage={analysisEmptyMessage}
                wide={false}
              >
                {selectedAnalysisContent}
              </Section>
            ) : null}
          </div>
        </div>
      ) : null}

      {sectionSettings.every((section) => !section.visible) ? (
        <p className="analytics-empty">
          Every section is hidden. Use Customize to show dashboard sections.
        </p>
      ) : null}

      <footer className="analytics-footer">
        <AppVersion />
      </footer>

      <SolveListDialog
        open={solveListOpen}
        solves={solveListSolves}
        activeBin={activeBin}
        onClose={() => setSolveListOpen(false)}
        onSelect={setSelectedSolve}
      />

      <SolveDetailsDialog
        solve={selectedSolve}
        onClose={() => setSelectedSolve(null)}
      />
    </main>
  )
}
