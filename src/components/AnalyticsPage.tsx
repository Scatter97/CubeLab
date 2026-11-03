import {
  createPortal,
} from 'react-dom'
import {
  memo,
  useMemo,
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
  buildActivity,
  buildAnalyticsTrend,
  buildHistogram,
  buildPBHistory,
  compareSessions,
  computeAdvanced,
  computeAnalyticsOverview,
  computeConsistency,
  computeSubX,
  createAnalyticsFilters,
  filterAnalyticsSolves,
  type AnalyticsFilters,
  type AnalyticsSolve,
} from '../lib/analytics'
import {
  ANALYTICS_SECTION_LABELS,
  createDefaultAnalyticsSettings,
  getSubXTargetMs,
  normalizeAnalyticsSections,
} from '../lib/analyticsSettings'
import { CUBELAB_EVENTS, getEventDefinition } from '../lib/events'
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

function shortDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
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
}: {
  label: string
  value: string
  detail?: string
  title?: string
}) {
  return (
    <div className="analytics-stat" title={title}>
      <span className="analytics-stat-label">{label}</span>
      <strong>{value}</strong>
      {detail ? <span className="analytics-stat-detail">{detail}</span> : null}
    </div>
  )
}

function Section({
  id,
  title,
  description,
  wide,
  children,
  actions,
}: {
  id: AnalyticsSectionId
  title: string
  description?: string
  wide: boolean
  children: ReactNode
  actions?: ReactNode
}) {
  return (
    <section
      className={`analytics-section${wide ? ' is-wide' : ''}`}
      id={`analytics-${id}`}
      aria-labelledby={`analytics-${id}-title`}
      data-testid={`analytics-section-${id}`}
    >
      <header className="analytics-section-header">
        <div>
          <h2 id={`analytics-${id}-title`}>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        {actions}
      </header>
      {children}
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
                {getEventDefinition(solve.event)?.label ?? solve.event} ·{' '}
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
}

const LIST_ROW_HEIGHT = 42
const LIST_HEIGHT = 320
const LIST_OVERSCAN = 160

const AnalyticsSolveList = memo(function AnalyticsSolveList({
  solves,
  onSelect,
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
    LIST_HEIGHT,
    LIST_OVERSCAN,
  )
  return (
    <div
      className="analytics-solve-list"
      style={{ height: LIST_HEIGHT }}
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

interface AnalyticsPageProps {
  sessions: readonly Session[]
  activeSessionId: string
  initialEvent: PuzzleEvent
  settings: Settings
  onChange: (next: Partial<Settings>) => void
}

export default function AnalyticsPage({
  sessions,
  activeSessionId,
  initialEvent,
  settings,
  onChange,
}: AnalyticsPageProps) {
  const [filters, setFilters] = useState<AnalyticsFilters>(() =>
    createAnalyticsFilters(initialEvent),
  )
  const [selectedSolve, setSelectedSolve] = useState<AnalyticsSolve | null>(null)
  const [selectedBin, setSelectedBin] = useState<number | null>(null)
  const [histogramIntervalMs, setHistogramIntervalMs] = useState<number | null>(null)
  const [progressSeries, setProgressSeries] = useState<ReadonlySet<string>>(
    () => new Set(['single', 'ao5', 'ao12']),
  )
  const [progressXAxis, setProgressXAxis] = useState<'solve' | 'date'>('solve')
  const [customizeOpen, setCustomizeOpen] = useState(false)

  const trimming: AverageTrimming = useMemo(
    () => ({
      better: settings.averageTrimBetter,
      worse: settings.averageTrimWorse,
    }),
    [settings.averageTrimBetter, settings.averageTrimWorse],
  )
  const analyticsSettings = settings.analytics
  const filtered = useMemo(
    () => filterAnalyticsSolves(sessions, filters),
    [sessions, filters],
  )
  const trend = useMemo(
    () => buildAnalyticsTrend(filtered, OVERVIEW_AVERAGE_SIZES, trimming),
    [filtered, trimming],
  )
  const overview = useMemo(
    () => computeAnalyticsOverview(trend, OVERVIEW_AVERAGE_SIZES, trimming),
    [trend, trimming],
  )
  const histogram = useMemo(
    () => buildHistogram(trend.singles, histogramIntervalMs),
    [trend.singles, histogramIntervalMs],
  )
  const consistency = useMemo(() => computeConsistency(trend), [trend])
  const activeTargetEvent = filters.event === 'all' ? initialEvent : filters.event
  const targetMs = getSubXTargetMs(analyticsSettings, activeTargetEvent)
  const subX = useMemo(
    () => computeSubX(trend, targetMs),
    [trend, targetMs],
  )
  const activity = useMemo(() => buildActivity(trend), [trend])
  const advanced = useMemo(
    () => computeAdvanced(trend, targetMs),
    [trend, targetMs],
  )
  const pbHistory = useMemo(() => buildPBHistory(trend), [trend])
  const comparison = useMemo(() => {
    const comparisonFilters: AnalyticsFilters = { ...filters }
    return compareSessions(sessions, comparisonFilters, trimming, targetMs)
  }, [sessions, filters, trimming, targetMs])
  const activeBin =
    selectedBin !== null ? histogram.bins[selectedBin] ?? null : null
  const explorerSolves = useMemo(() => {
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

  const progressChartSeries: AnalyticsSeries[] = useMemo(
    () =>
      PROGRESS_SERIES.filter((entry) => progressSeries.has(entry.key))
        .map((entry) => ({
          key: entry.key,
          label: entry.label,
          color: entry.color,
          values:
            entry.size === null
              ? trend.singles
              : trend.averages.get(entry.size) ?? [],
        })),
    [progressSeries, trend],
  )
  const averageChartSeries: AnalyticsSeries[] = useMemo(
    () =>
      AVERAGE_CHART_SIZES.flatMap((size) => {
        const values = trend.averages.get(size) ?? []
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
    [trend],
  )
  const comparisonMax = Math.max(0, ...comparison.map((entry) => entry.ao5.length))
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
  const weeklyCounts = useMemo(
    () => activity.weekly.map((week) => week.count),
    [activity.weekly],
  )
  const xSolveLabel = (index: number) => `#${index + 1}`
  const xDateLabel = (index: number) =>
    shortDate(trend.solves[index]?.createdAt ?? Date.now())

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
  const selectedSessionLabel =
    filters.sessionIds === null
      ? 'All sessions'
      : filters.sessionIds.length === 0
        ? 'No sessions'
        : filters.sessionIds.length === 1
          ? sessionChoices.find((session) => session.id === filters.sessionIds?.[0])
              ?.name ?? '1 session'
          : `${filters.sessionIds.length} sessions`

  const sectionSettings = useMemo(
    () => normalizeAnalyticsSections(analyticsSettings.sections),
    [analyticsSettings.sections],
  )

  const sectionContent: Record<AnalyticsSectionId, ReactNode> = {
    overview: (
      <div className="analytics-stat-grid" data-testid="analytics-overview">
        <StatCard
          label="Total solves"
          value={overview.count.toLocaleString()}
          detail={`${overview.validCount.toLocaleString()} valid · ${overview.dnfCount.toLocaleString()} DNF`}
          title="Every solve matching the global filters. DNFs stay in the total and are excluded from time statistics."
        />
        <StatCard
          label="Best single"
          value={formatOptionalMs(overview.best)}
          detail={overview.validCount > 0 ? 'Fastest valid solve' : 'No valid solves'}
        />
        <StatCard
          label="Worst single"
          value={formatOptionalMs(overview.worst)}
          detail="Slowest valid solve"
        />
        <StatCard
          label="Mean"
          value={formatOptionalMs(overview.meanMs)}
          detail="Valid solves only"
          title="Arithmetic mean of valid recorded results."
        />
        <StatCard
          label="Median"
          value={formatOptionalMs(overview.medianMs)}
          detail="Middle recorded result"
        />
        <StatCard
          label="Standard deviation"
          value={
            overview.standardDeviationMs === null
              ? '—'
              : `${(overview.standardDeviationMs / 1_000).toFixed(2)} s`
          }
          detail="Lower is more consistent"
        />
        <StatCard
          label="Practice time"
          value={formatDuration(overview.totalTimeMs)}
          detail="Valid solve time only"
          title="CubeLab does not store idle time, so this is time spent in recorded valid solves."
        />
        <StatCard
          label="Active days"
          value={overview.activeDays.toLocaleString()}
          detail={
            overview.solvesPerDay === null
              ? 'No solves yet'
              : `${overview.solvesPerDay.toFixed(1)} solves / calendar day`
          }
        />
        <StatCard
          label="DNF rate"
          value={formatPercent(overview.dnfPercent)}
          detail="Of all filtered solves"
        />
        <StatCard
          label="Improvement"
          value={formatPercent(overview.improvementPercent)}
          detail="First vs latest 10%"
          title="Positive values mean the latest tenth is faster than the earliest tenth of the filtered history."
        />
        {overview.averages
          .filter(
            (average) =>
              average.best !== null || average.current !== null,
          )
          .map((average) => (
          <StatCard
            key={average.size}
            label={`ao${average.size}`}
            value={formatStatValue(average.current, settings.statPrecision)}
            detail={`Best ${formatOptionalMs(average.best)}`}
            title={`Current and best trimmed ao${average.size}. DNFs follow the configured WCA-style trimming rules.`}
          />
        ))}
      </div>
    ),
    progression: (
      <div className="analytics-chart-stack">
        <div className="analytics-chart-toolbar" aria-label="Time progression series">
          <span>Series</span>
          {PROGRESS_SERIES.map((entry) => (
            <button
              key={entry.key}
              type="button"
              className="time-trend-chip"
              aria-pressed={progressSeries.has(entry.key)}
              onClick={() =>
                setProgressSeries((current) => {
                  const next = new Set(current)
                  if (next.has(entry.key)) next.delete(entry.key)
                  else next.add(entry.key)
                  return next
                })
              }
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
            onClick={() => setProgressXAxis('solve')}
          >
            Solve #
          </button>
          <button
            type="button"
            className="time-trend-chip"
            aria-pressed={progressXAxis === 'date'}
            onClick={() => setProgressXAxis('date')}
          >
            Date
          </button>
        </div>
        <AnalyticsLineChart
          title="Time progression"
          description="Individual solves and configurable rolling averages, oldest to newest. PB markers show singles."
          ariaLabel="Solve time progression"
          series={progressChartSeries}
          xLabel={progressXAxis === 'date' ? xDateLabel : xSolveLabel}
          formatValue={(value) => formatTime(value)}
          formatTick={(value) => formatTime(value)}
          markers={pbHistory.single.map((event) => ({
            index: event.index,
            value: event.ms,
            label: `PB · ${formatTime(event.ms)} · ${fullDate(event.solve.createdAt)}`,
          }))}
          onSelectIndex={(index) => {
            const solve = trend.solves[index]
            if (solve) setSelectedSolve(solve)
          }}
          emptyMessage="Record or import solves to see time progression."
          testId="analytics-progression"
        />
      </div>
    ),
    averages: (
      <div className="analytics-chart-stack">
        <AnalyticsLineChart
          title="Average progression"
          description="Rolling trimmed averages across the complete filtered history. DNF windows appear as gaps."
          ariaLabel="Average progression"
          series={averageChartSeries}
          xLabel={xSolveLabel}
          formatValue={(value) => formatTime(value)}
          formatTick={(value) => formatTime(value)}
          onSelectIndex={(index) => {
            const solve = trend.solves[index]
            if (solve) setSelectedSolve(solve)
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
              {overview.averages
                .filter(
                  (average) =>
                    average.best !== null || average.current !== null,
                )
                .map((average) => (
                <tr key={average.size}>
                  <th scope="row">ao{average.size}</th>
                  <td>{formatStatValue(average.current, settings.statPrecision)}</td>
                  <td>{formatOptionalMs(average.best)}</td>
                  <td>{average.size} solves</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    ),
    personalBests: (
      <div className="analytics-chart-stack">
        <AnalyticsLineChart
          title="Personal best progression"
          description="Cumulative best single and rolling average. A step down is a new personal best."
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
          xLabel={xDateLabel}
          formatValue={(value) => formatTime(value)}
          formatTick={(value) => formatTime(value)}
          markers={pbHistory.single.map((event) => ({
            index: event.index,
            value: event.ms,
            label: `PB · ${formatTime(event.ms)}`,
          }))}
          onSelectIndex={(index) => {
            const solve = trend.solves[index]
            if (solve) setSelectedSolve(solve)
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
                        {event.gapMs === null
                          ? '—'
                          : formatDuration(event.gapMs)}
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
    ),
    distribution: (
      <div className="analytics-chart-stack">
        <div className="analytics-chart-toolbar">
          <label>
            Interval
            <select
              value={histogramIntervalMs ?? 'auto'}
              onChange={(event) =>
                setHistogramIntervalMs(
                  event.target.value === 'auto'
                    ? null
                    : Number(event.target.value),
                )
              }
            >
              <option value="auto">Auto</option>
              <option value="250">0.25 s</option>
              <option value="500">0.5 s</option>
              <option value="1000">1 s</option>
              <option value="2000">2 s</option>
              <option value="5000">5 s</option>
            </select>
          </label>
          {activeBin ? (
            <button
              type="button"
              className="time-trend-button"
              onClick={() => setSelectedBin(null)}
            >
              Clear interval filter
            </button>
          ) : null}
        </div>
        <AnalyticsHistogram
          title="Solve time distribution"
          bins={histogram.bins}
          formatValue={(value) => formatTime(value)}
          meanMs={histogram.meanMs}
          medianMs={histogram.medianMs}
          selectedIndex={selectedBin}
          onSelectBin={(index) => {
            setSelectedBin((current) => (current === index ? null : index))
            window.setTimeout(() => {
              document.getElementById('analytics-explorer')?.scrollIntoView?.({
                behavior: 'smooth',
                block: 'start',
              })
            }, 0)
          }}
        />
        {activeBin ? (
          <p className="analytics-note" role="status">
            Showing <strong>{activeBin.count}</strong> solves from{' '}
            {formatTime(activeBin.startMs)} to {formatTime(activeBin.endMs)} in
            the Solve explorer.
          </p>
        ) : (
          <p className="analytics-note">
            Click a distribution bar to filter the Solve explorer. Outliers use
            the 1.5 × IQR rule.
          </p>
        )}
        <div className="analytics-stat-grid is-compact">
          <StatCard
            label="Mean"
            value={formatOptionalMs(histogram.meanMs)}
          />
          <StatCard
            label="Median"
            value={formatOptionalMs(histogram.medianMs)}
          />
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
    ),
    consistency: (
      <div className="analytics-chart-stack">
        <div className="analytics-stat-grid is-compact">
          <StatCard
            label="SD"
            value={
              consistency.standardDeviationMs === null
                ? '—'
                : `${(consistency.standardDeviationMs / 1_000).toFixed(2)} s`
            }
            detail="Spread of single times"
          />
          <StatCard
            label="Coefficient of variation"
            value={formatPercent(
              consistency.coefficientOfVariation === null
                ? null
                : consistency.coefficientOfVariation * 100,
              2,
            )}
            detail="SD ÷ mean · lower is more consistent"
          />
          <StatCard
            label="Spread"
            value={formatOptionalMs(consistency.spreadMs)}
            detail={`${formatOptionalMs(consistency.fastestMs)} → ${formatOptionalMs(consistency.slowestMs)}`}
          />
          <StatCard
            label="Mean / median"
            value={`${formatOptionalMs(consistency.meanMs)} / ${formatOptionalMs(consistency.medianMs)}`}
            detail="A large gap suggests outliers"
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
          title="Consistency trend"
          description="Rolling sample standard deviation. Falling values mean times are more tightly grouped, not necessarily faster."
          ariaLabel="Rolling standard deviation"
          series={consistency.rolling.map((rolling) => ({
            key: `sd-${rolling.size}`,
            label: `SD ${rolling.size}`,
            color:
              rolling.size === 12 ? 'var(--trend-ao12)' : 'var(--trend-ao50)',
            values: rolling.values,
          }))}
          xLabel={xSolveLabel}
          formatValue={(value) => `${(value / 1_000).toFixed(2)} s`}
          formatTick={(value) => `${(value / 1_000).toFixed(1)}`}
          onSelectIndex={(index) => {
            const solve = trend.solves[index]
            if (solve) setSelectedSolve(solve)
          }}
          emptyMessage="A rolling standard deviation needs a complete window."
          testId="analytics-consistency"
        />
        <p className="analytics-note">
          Consistency and speed are separate: a solver can set a fast mean while
          remaining less consistent than a slower solver with a lower SD.
        </p>
      </div>
    ),
    subX: (
      <div className="analytics-chart-stack">
        <div className="analytics-chart-toolbar">
          <label>
            Target for{' '}
            {getEventDefinition(activeTargetEvent)?.label ?? activeTargetEvent}
            <input
              key={`${activeTargetEvent}-${targetMs}`}
              type="number"
              min={1}
              max={3600}
              step={0.01}
              defaultValue={(targetMs / 1_000).toFixed(2)}
              aria-label={`Sub-X target in seconds for ${getEventDefinition(activeTargetEvent)?.label ?? activeTargetEvent}`}
              onBlur={(event) => {
                const seconds = Number(event.target.value)
                if (!Number.isFinite(seconds) || seconds < 1 || seconds > 3_600) {
                  event.target.value = (targetMs / 1_000).toFixed(2)
                  return
                }
                updateAnalytics({
                  subXTargetsMs: {
                    ...analyticsSettings.subXTargetsMs,
                    [activeTargetEvent]: Math.round(seconds * 1_000),
                  },
                })
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur()
              }}
            />
            seconds
          </label>
          <span className="analytics-note">
            Sub-{formatTime(targetMs)} means strictly faster than the target.
          </span>
        </div>
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
            detail="Consecutive sub-X solves"
          />
          <StatCard
            label="Longest streak"
            value={subX.longestStreak.toLocaleString()}
            detail="Best consecutive run"
          />
          <StatCard
            label="Estimated probability"
            value={formatPercent(subX.estimatedProbability)}
            detail="Normal estimate · not a prediction"
            title="A normal-approximation estimate based on the current mean and sample SD. It does not guarantee future results."
          />
        </div>
        <progress
          className="analytics-progress"
          max={100}
          value={subX.percent}
          aria-label={`Sub-X progress ${subX.percent.toFixed(1)} percent`}
        />
        <AnalyticsLineChart
          title="Sub-X percentage over time"
          description="Percentage of the latest 50 solves (or fewer at the beginning) under the target."
          ariaLabel="Sub-X percentage over time"
          series={[
            {
              key: 'subx',
              label: `Sub-${formatTime(targetMs)}`,
              color: 'var(--accent)',
              values: subX.progress,
            },
          ]}
          xLabel={xSolveLabel}
          formatValue={(value) => `${value.toFixed(1)}%`}
          formatTick={(value) => `${Math.round(value)}%`}
          onSelectIndex={(index) => {
            const solve = trend.solves[index]
            if (solve) setSelectedSolve(solve)
          }}
          emptyMessage="No solves match the current filters."
          testId="analytics-subx"
        />
        {subX.bySession.length > 0 ? (
          <div className="analytics-table-wrap">
            <table className="analytics-table">
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
                    <th scope="row">{session.sessionName}</th>
                    <td>{session.count.toLocaleString()}</td>
                    <td>{session.successes.toLocaleString()}</td>
                    <td>{formatPercent(session.percent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    ),
    sessions: (
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
              description="Each line is one session's rolling ao5, aligned by solve number within that session."
              ariaLabel="Session ao5 comparison"
              series={comparisonSeries}
              xLabel={xSolveLabel}
              formatValue={(value) => formatTime(value)}
              formatTick={(value) => formatTime(value)}
              emptyMessage="No comparable sessions."
              testId="analytics-session-comparison"
            />
          </>
        )}
      </div>
    ),
    activity: (
      <div className="analytics-chart-stack">
        <div className="analytics-stat-grid is-compact">
          <StatCard
            label="Timed practice"
            value={formatDuration(activity.totalTimeMs)}
            detail="Valid recorded solve time"
          />
          <StatCard
            label="Active days"
            value={activity.activeDays.toLocaleString()}
            detail={`${activity.averagePerActiveDay.toFixed(1)} solves per active day`}
          />
          <StatCard
            label="Practice frequency"
            value={formatPercent(activity.frequency)}
            detail="Active days across the filtered span"
          />
          <StatCard
            label="Current streak"
            value={`${activity.currentStreak.toLocaleString()} d`}
            detail={`Longest ${activity.longestStreak.toLocaleString()} days`}
          />
        </div>
        <ActivityHeatmap
          days={activity.daily}
          formatDate={(day) => fullDate(day.dateMs)}
        />
        <AnalyticsLineChart
          title="Solve volume"
          description="Solves per week across the filtered history."
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
            shortDate(activity.weekly[index]?.startMs ?? Date.now())
          }
          formatValue={(value) => value.toLocaleString()}
          formatTick={(value) => Math.round(value).toLocaleString()}
          showControls
          emptyMessage="No practice activity yet."
          testId="analytics-activity-chart"
        />
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
                    <th scope="row">Best · {fullDate(activity.bestPerformanceDay.dateMs)}</th>
                    <td>{formatTime(activity.bestPerformanceDay.meanMs)}</td>
                    <td>{activity.bestPerformanceDay.count}</td>
                  </tr>
                  {activity.worstPerformanceDay &&
                  activity.worstPerformanceDay.key !==
                    activity.bestPerformanceDay.key ? (
                    <tr>
                      <th scope="row">Hardest · {fullDate(activity.worstPerformanceDay.dateMs)}</th>
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
    ),
    advanced: (
      <div className="analytics-chart-stack">
        <div className="analytics-stat-grid is-compact">
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
            detail="Single PBs across the history span"
          />
          <StatCard
            label="Improvement rate"
            value={formatPercent(advanced.improvementPercent)}
            detail="Recent half vs historical half"
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
          description="A 25-solve moving median smooths short-term noise while preserving slower trends."
          ariaLabel="Moving median"
          series={[
            {
              key: 'median',
              label: 'Moving median',
              color: 'var(--trend-ao25)',
              values: advanced.movingMedian,
            },
          ]}
          xLabel={xSolveLabel}
          formatValue={(value) => formatTime(value)}
          formatTick={(value) => formatTime(value)}
          onSelectIndex={(index) => {
            const solve = trend.solves[index]
            if (solve) setSelectedSolve(solve)
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
                          onClick={() => setSelectedSolve(entry.solve)}
                        >
                          {formatTime(entry.ms)}
                        </button>
                      </th>
                      <td>{entry.solve.sessionName}</td>
                      <td>{shortDate(entry.solve.createdAt)}</td>
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
                          onClick={() => setSelectedSolve(entry.solve)}
                        >
                          {formatTime(entry.ms)}
                        </button>
                      </th>
                      <td>{entry.solve.sessionName}</td>
                      <td>{shortDate(entry.solve.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
        <p className="analytics-note">
          Percentiles and rankings use valid recorded results. Statistical target
          estimates are approximate and are never guarantees or WCA predictions.
        </p>
      </div>
    ),
    explorer: (
      <div className="analytics-chart-stack" id="analytics-explorer">
        <div className="analytics-chart-toolbar">
          <span data-testid="analytics-explorer-count">
            {explorerSolves.length.toLocaleString()} solves
            {activeBin
              ? ` · ${formatTime(activeBin.startMs)}–${formatTime(activeBin.endMs)}`
              : ' · newest first'}
          </span>
          {activeBin ? (
            <button
              type="button"
              className="time-trend-button"
              onClick={() => setSelectedBin(null)}
            >
              Clear interval filter
            </button>
          ) : null}
        </div>
        {explorerSolves.length === 0 ? (
          <p className="analytics-empty">No solves match the current filters.</p>
        ) : (
          <AnalyticsSolveList solves={explorerSolves} onSelect={setSelectedSolve} />
        )}
        <p className="analytics-note">
          Click a solve to inspect its scramble, penalty, comment, session and
          timestamp. The list is virtualized for large histories.
        </p>
      </div>
    ),
  }

  return (
    <main className="analytics-page" aria-labelledby="analytics-title">
      <header className="analytics-heading">
        <div>
          <p className="analytics-eyebrow">CubeLab insights</p>
          <h1 id="analytics-title">Analytics</h1>
          <p>
            Read-only analysis of your recorded solves. Global filters apply to
            every section.
          </p>
        </div>
        <div className="analytics-heading-actions">
          <span className="analytics-record-count">
            {overview.count.toLocaleString()} matching solves
          </span>
          <button
            type="button"
            className="time-trend-button"
            aria-expanded={customizeOpen}
            aria-controls="analytics-customize"
            onClick={() => setCustomizeOpen((open) => !open)}
            data-testid="analytics-customize-toggle"
          >
            Customize
          </button>
        </div>
      </header>

      <section className="analytics-filters" aria-label="Analytics filters">
        <label>
          Event
          <select
            value={filters.event}
            aria-label="Analytics event"
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                event: event.target.value as PuzzleEvent | 'all',
                sessionIds: null,
              }))
            }
          >
            <option value="all">All events</option>
            {CUBELAB_EVENTS.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>

        <div className="analytics-filter-field">
          <span>Sessions</span>
        <details className="analytics-multiselect">
          <summary>{selectedSessionLabel}</summary>
          <div className="analytics-multiselect-menu">
            <label>
              <input
                type="checkbox"
                checked={filters.sessionIds === null}
                onChange={() =>
                  setFilters((current) => ({ ...current, sessionIds: null }))
                }
              />
              All sessions
            </label>
            {sessionChoices.map((session) => {
              const checked =
                filters.sessionIds === null ||
                filters.sessionIds.includes(session.id)
              return (
                <label key={session.id}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {
                      const base =
                        filters.sessionIds === null
                          ? sessions.map((entry) => entry.id)
                          : filters.sessionIds
                      setFilters((current) => ({
                        ...current,
                        sessionIds: checked
                          ? base.filter((id) => id !== session.id)
                          : [...base, session.id],
                      }))
                    }}
                  />
                  {session.name}
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
        </details>
        </div>

        <label>
          Date range
          <select
            value={filters.datePreset}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                datePreset: event.target.value as AnalyticsFilters['datePreset'],
              }))
            }
          >
            <option value="all">All time</option>
            <option value="today">Today</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
            <option value="year">Last year</option>
            <option value="custom">Custom…</option>
          </select>
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

        <label>
          Last solves
          <select
            value={filters.solveLimit ?? 'all'}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                solveLimit:
                  event.target.value === 'all'
                    ? null
                    : Number(event.target.value),
              }))
            }
          >
            <option value="all">All</option>
            <option value="5">5</option>
            <option value="12">12</option>
            <option value="50">50</option>
            <option value="100">100</option>
            <option value="500">500</option>
            <option value="1000">1,000</option>
          </select>
        </label>

        <label>
          Penalty
          <select
            value={filters.penalty}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                penalty: event.target.value as AnalyticsFilters['penalty'],
              }))
            }
          >
            <option value="all">All results</option>
            <option value="none">Normal</option>
            <option value="+2">+2</option>
            <option value="dnf">DNF</option>
          </select>
        </label>

        <button
          type="button"
          className="time-trend-button"
          onClick={resetFilters}
          data-testid="analytics-reset-filters"
        >
          Reset filters
        </button>
      </section>

      {customizeOpen ? (
        <section
          className="analytics-customize"
          id="analytics-customize"
          aria-label="Customize analytics dashboard"
        >
          <div className="analytics-customize-heading">
            <div>
              <h2>Dashboard sections</h2>
              <p>
                Show, hide, widen or reorder sections. Preferences are saved with
                your synced settings.
              </p>
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
                <label className="analytics-checkbox">
                  <input
                    type="checkbox"
                    checked={section.wide}
                    onChange={() =>
                      updateAnalytics({
                        sections: analyticsSettings.sections.map((entry) =>
                          entry.id === section.id
                            ? { ...entry, wide: !entry.wide }
                            : entry,
                        ),
                      })
                    }
                  />
                  Wide
                </label>
                <span className="analytics-customize-move">
                  <button
                    type="button"
                    className="time-trend-button"
                    aria-label={`Move ${ANALYTICS_SECTION_LABELS[section.id]} up`}
                    disabled={index === 0}
                    onClick={() => moveSection(section.id, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="time-trend-button"
                    aria-label={`Move ${ANALYTICS_SECTION_LABELS[section.id]} down`}
                    disabled={index === analyticsSettings.sections.length - 1}
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

      <div className="analytics-dashboard">
        {sectionSettings
          .filter((section) => section.visible)
          .map((section) => (
            <Section
              key={section.id}
              id={section.id}
              title={ANALYTICS_SECTION_LABELS[section.id]}
              wide={section.wide}
            >
              {sectionContent[section.id]}
            </Section>
          ))}
        {sectionSettings.every((section) => !section.visible) ? (
          <p className="analytics-empty">
            Every section is hidden. Use Customize to show dashboard sections.
          </p>
        ) : null}
      </div>

      <p className="analytics-footer-note">
        Analytics is read-only. Stored solves, penalties, timestamps and sync data
        are never modified. Active session:{' '}
        {sessions.find((session) => session.id === activeSessionId)?.name ?? '—'}.
      </p>

      <SolveDetailsDialog
        solve={selectedSolve}
        onClose={() => setSelectedSolve(null)}
      />
    </main>
  )
}
