import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  formatOptionalTime,
  formatSolveCount,
  formatStatValue,
  formatTimeWithPrecision,
} from '../lib/format'
import { DEFAULT_AVERAGE_TRIMMING } from '../lib/averageTrimming'
import { calculateStatInsights, type StatInsightKind } from '../lib/statInsights'
import { BUILT_IN_STAT_DEFINITIONS } from '../lib/statDefinitions'
import { formatStatTarget, parseStatTarget } from '../lib/statTargets'
import type { SessionStats, StatPair, StatResult } from '../lib/stats'
import type {
  AverageTrimming,
  CustomAverageSetting,
  Solve,
  StatPrecision,
  StatVisibility,
} from '../types'
import { ChevronRightIcon } from './Icons'

interface StatsPanelProps {
  stats: SessionStats
  visibleStats: StatVisibility
  customAverages: readonly CustomAverageSetting[]
  precision: StatPrecision
  solves: readonly Solve[]
  trimming?: AverageTrimming
  /** Per-event target times keyed by stat identity. */
  targetsMs: Readonly<Record<string, number>>
  onSetTarget: (key: string, targetMs: number | null) => void
  /** When true, render every enabled statistic instead of fitting to height. */
  showAllRows?: boolean
  style?: React.CSSProperties
}

interface StatRowModel {
  key: string
  label: string
  kind: StatInsightKind
  size: number | null
  pair: StatPair
  testId: string
  currentTestId: string
  targetMs: number | null
}

const EMPTY_PAIR: StatPair = { best: null, latest: null }
const EXPANDED_STATS_STORAGE_KEY = 'cubelab:expandedStats:v1'

function resultClass(result: StatResult): string {
  if (result === null) return 'is-empty'
  return result.status === 'dnf' ? 'is-dnf' : ''
}

function loadExpandedStats(): Set<string> {
  try {
    const raw = localStorage.getItem(EXPANDED_STATS_STORAGE_KEY)
    if (!raw) return new Set()
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(
      parsed.filter((value): value is string => typeof value === 'string'),
    )
  } catch {
    return new Set()
  }
}

function saveExpandedStats(expanded: ReadonlySet<string>): void {
  try {
    localStorage.setItem(
      EXPANDED_STATS_STORAGE_KEY,
      JSON.stringify([...expanded]),
    )
  } catch {
    // The expanded display is a local convenience; failures are harmless.
  }
}

function StatRowContent({
  row,
  precision,
  expanded,
  measurement = false,
}: {
  row: StatRowModel
  precision: StatPrecision
  expanded?: boolean
  measurement?: boolean
}) {
  return (
    <>
      <span className="stat-label">{row.label}</span>
      <span className={`stat-current ${resultClass(row.pair.latest)}`}>
        <span>Current</span>
        <strong data-testid={measurement ? undefined : row.currentTestId}>
          {formatStatValue(row.pair.latest, precision)}
        </strong>
      </span>
      <span className="stat-best">
        <span>Best</span>
        <strong
          className={row.pair.best === null ? 'is-empty' : ''}
          data-testid={measurement ? undefined : row.testId}
        >
          {formatOptionalTime(row.pair.best, precision)}
        </strong>
      </span>
      {measurement ? (
        <span className="stat-chevron" aria-hidden="true" />
      ) : (
        <ChevronRightIcon
          size={12}
          className={`stat-chevron${expanded ? ' is-expanded' : ''}`}
        />
      )}
    </>
  )
}

function StatTargetInput({
  row,
  onSetTarget,
}: {
  row: StatRowModel
  onSetTarget: (key: string, targetMs: number | null) => void
}) {
  const [draft, setDraft] = useState(() => formatStatTarget(row.targetMs))
  const [error, setError] = useState<string | null>(null)
  const errorId = `stat-target-error-${row.key}`

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    setDraft(formatStatTarget(row.targetMs))
    // oxlint-disable-next-line react/set-state-in-effect
    setError(null)
  }, [row.targetMs])

  const commit = (): boolean => {
    if (draft.trim().length === 0) {
      setDraft('')
      setError(null)
      onSetTarget(row.key, null)
      return true
    }
    const parsed = parseStatTarget(draft)
    if (!parsed.ok) {
      setError(parsed.error)
      return false
    }
    const formatted = formatStatTarget(parsed.ms)
    setDraft(formatted)
    setError(null)
    onSetTarget(row.key, parsed.ms)
    return true
  }

  return (
    <span className="stat-target-control">
      <input
        type="text"
        inputMode="decimal"
        className="stat-target-input"
        value={draft}
        placeholder="—"
        aria-label={`Target for ${row.label}`}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        data-testid={`stat-target-${row.key}`}
        onChange={(event) => {
          setDraft(event.target.value)
          setError(null)
        }}
        onBlur={() => commit()}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commit()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            setDraft(formatStatTarget(row.targetMs))
            setError(null)
          }
        }}
      />
      <span className="stat-target-unit" aria-hidden="true">
        s
      </span>
      {error ? (
        <span id={errorId} className="stat-target-error" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  )
}

function nextSolveText(
  next: ReturnType<typeof calculateStatInsights>['nextSolve'],
  precision: StatPrecision,
): string {
  switch (next.status) {
    case 'no-target':
      return 'Set a target'
    case 'insufficient':
      return 'Not enough solves'
    case 'impossible':
      return 'Not reachable'
    case 'any':
      return 'Any result'
    case 'any-valid':
      return 'Any valid result'
    case 'value':
      return next.ms === null
        ? '—'
        : `≤ ${formatTimeWithPrecision(next.ms, precision)}`
  }
}

function StatDetails({
  row,
  solves,
  trimming,
  precision,
  onSetTarget,
}: {
  row: StatRowModel
  solves: readonly Solve[]
  trimming: AverageTrimming
  precision: StatPrecision
  onSetTarget: (key: string, targetMs: number | null) => void
}) {
  const insights = useMemo(
    () =>
      calculateStatInsights({
        solves,
        kind: row.kind,
        size: row.size,
        trimming,
        targetMs: row.targetMs,
      }),
    [row.kind, row.size, row.targetMs, solves, trimming],
  )
  const targetReachable =
    row.targetMs !== null &&
    (insights.nextSolve.status === 'value' ||
      insights.nextSolve.status === 'any' ||
      insights.nextSolve.status === 'any-valid')
  const targetTitle =
    insights.nextSolve.status === 'any' ||
    insights.nextSolve.status === 'any-valid'
      ? 'Target achievable regardless of the next result'
      : 'Target achievable with the next solve'

  return (
    <div
      className="stat-details"
      id={`stat-details-${row.key}`}
      data-testid={`stat-details-${row.key}`}
    >
      <dl className="stat-detail-list">
        <div>
          <dt>Current</dt>
          <dd className={resultClass(row.pair.latest)}>
            {formatStatValue(row.pair.latest, precision)}
          </dd>
        </div>
        <div>
          <dt>Best</dt>
          <dd className={row.pair.best === null ? 'is-empty' : ''}>
            {formatOptionalTime(row.pair.best, precision)}
          </dd>
        </div>
        <div className="stat-detail-target stat-detail-wide">
          <dt>
            <abbr title="Goal time for this average in the current event.">
              Target
            </abbr>
          </dt>
          <dd>
            <StatTargetInput row={row} onSetTarget={onSetTarget} />
            {targetReachable ? (
              <span
                className="stat-target-indicator"
                title={targetTitle}
                aria-label={targetTitle}
              />
            ) : null}
          </dd>
        </div>
        {row.kind === 'single' ? null : (
          <>
            <div>
              <dt>
                <abbr title="Best possible next average: the next solve is 0.00 and the oldest solve leaves the window.">
                  BPA
                </abbr>
              </dt>
              <dd>{formatStatValue(insights.bpa, precision)}</dd>
            </div>
            <div>
              <dt>
                <abbr title="Worst possible next average: the next solve is a DNF and the oldest solve leaves the window.">
                  WPA
                </abbr>
              </dt>
              <dd>{formatStatValue(insights.wpa, precision)}</dd>
            </div>
          </>
        )}
        <div className="stat-detail-wide">
          <dt>
            <abbr title="Maximum next solve time that still reaches the target under the current trimming and penalty rules.">
              Next solve needed
            </abbr>
          </dt>
          <dd
            className={
              targetReachable ? 'stat-next-solve is-reachable' : 'stat-next-solve'
            }
            data-testid={`stat-next-${row.key}`}
          >
            {nextSolveText(insights.nextSolve, precision)}
          </dd>
        </div>
      </dl>
    </div>
  )
}

export const StatsPanel = memo(function StatsPanel({
  stats,
  visibleStats,
  customAverages,
  precision,
  solves,
  trimming = DEFAULT_AVERAGE_TRIMMING,
  targetsMs,
  onSetTarget,
  showAllRows = false,
  style,
}: StatsPanelProps) {
  const gridRef = useRef<HTMLDivElement>(null)
  const naturalRowsRef = useRef<HTMLDivElement>(null)
  const compactRowsRef = useRef<HTMLDivElement>(null)
  const [layout, setLayout] = useState({ count: 0, compact: false })
  const [expanded, setExpanded] = useState<Set<string>>(() => loadExpandedStats())

  const tiles = useMemo(() => {
    const builtInTiles = BUILT_IN_STAT_DEFINITIONS.filter(
      (definition) => visibleStats[definition.key],
    ).map((definition): StatRowModel => {
      const pair =
        definition.key === 'single'
          ? stats.single
          : definition.key === 'mo3'
            ? stats.mo3
            : stats.averages.get(definition.size as number) ?? EMPTY_PAIR

      return {
        key: definition.key,
        label:
          definition.key === 'single'
            ? 'Single'
            : definition.key === 'mo3'
              ? 'mo3'
              : `ao${definition.size}`,
        kind:
          definition.key === 'single'
            ? 'single'
            : definition.key === 'mo3'
              ? 'mo3'
              : 'average',
        size: definition.size,
        pair,
        testId: `best-${definition.key}`,
        currentTestId: `current-${definition.key}`,
        targetMs: targetsMs[definition.key] ?? null,
      }
    })

    const customTiles = customAverages
      .filter((average) => average.visible)
      .map((average): StatRowModel => {
        const key = `custom:${average.id}`
        return {
          key,
          label: `ao${average.size}`,
          kind: 'average',
          size: average.size,
          pair: stats.averages.get(average.size) ?? EMPTY_PAIR,
          testId: `best-ao${average.size}`,
          currentTestId: `current-ao${average.size}`,
          targetMs: targetsMs[key] ?? null,
        }
      })

    return [...builtInTiles, ...customTiles]
  }, [customAverages, stats, targetsMs, visibleStats])

  const hasExpanded = tiles.some((tile) => expanded.has(tile.key))

  const toggleExpanded = useCallback((key: string) => {
    setExpanded((previous) => {
      const next = new Set(previous)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      saveExpandedStats(next)
      return next
    })
  }, [])

  // Measure independent, intrinsic rows. The visible row count and density never
  // change these samples or the flex area's size, so resizing cannot feed back
  // into its own measurement. All comparisons use viewport coordinates (zoom too).
  const measure = useCallback(() => {
    const grid = gridRef.current
    const natural = naturalRowsRef.current
    const compact = compactRowsRef.current
    if (showAllRows || hasExpanded || !grid || !natural || !compact) return
    const bottom = grid.getBoundingClientRect().bottom - 1
    const fitCount = (sample: HTMLElement) => {
      let count = 0
      for (const row of Array.from(sample.children)) {
        if (row.getBoundingClientRect().bottom > bottom) break
        count += 1
      }
      return count
    }
    const naturalCount = fitCount(natural)
    const compactCount = fitCount(compact)
    const next =
      compactCount > naturalCount
        ? { count: compactCount, compact: true }
        : { count: naturalCount, compact: false }
    setLayout((previous) =>
      previous.count === next.count && previous.compact === next.compact
        ? previous
        : next,
    )
  }, [hasExpanded, showAllRows])

  useLayoutEffect(() => {
    measure()
  }, [measure, tiles, precision, style?.height])

  const hasTiles = tiles.length > 0
  useLayoutEffect(() => {
    if (showAllRows || hasExpanded || !hasTiles) return
    const elements = [
      gridRef.current,
      naturalRowsRef.current,
      compactRowsRef.current,
    ]
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(measure)
    for (const element of elements) if (element) observer?.observe(element)
    // Font loading can change intrinsic text metrics without changing the panel.
    let disposed = false
    void document.fonts?.ready.then(() => {
      if (!disposed) measure()
    })
    window.addEventListener('resize', measure)
    return () => {
      disposed = true
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [measure, hasTiles, hasExpanded, showAllRows])

  const renderedTiles =
    showAllRows || hasExpanded ? tiles : tiles.slice(0, layout.count)

  return (
    <section
      className={`panel stats-panel${!showAllRows && layout.compact ? ' is-compact' : ''}`}
      aria-labelledby="stats-title"
      style={{ position: 'relative', ...style }}
    >
      <div className="panel-heading">
        <h2 id="stats-title">Statistics</h2>
        <span className="count-pill">{formatSolveCount(stats.count)}</span>
      </div>

      {tiles.length > 0 ? (
        <div
          className={`stats-grid${hasExpanded ? ' has-expanded' : ''}${
            hasExpanded && !showAllRows ? ' is-scrollable' : ''
          }`}
          ref={gridRef}
        >
          {!showAllRows ? (
            <>
              <div
                className="stats-measure-rows"
                ref={naturalRowsRef}
                aria-hidden="true"
              >
                {tiles.map((row) => (
                  <div className="stat-measure-row" key={row.key}>
                    <StatRowContent row={row} precision={precision} measurement />
                  </div>
                ))}
              </div>
              <div
                className="stats-measure-rows is-compact"
                ref={compactRowsRef}
                aria-hidden="true"
              >
                {tiles.map((row) => (
                  <div className="stat-measure-row" key={row.key}>
                    <StatRowContent row={row} precision={precision} measurement />
                  </div>
                ))}
              </div>
            </>
          ) : null}
          {renderedTiles.map((row) => {
            const isExpanded = expanded.has(row.key)
            return (
              <div
                className={`stat-entry${isExpanded ? ' is-expanded' : ''}`}
                key={row.key}
              >
                <button
                  type="button"
                  className={`stat-tile${isExpanded ? ' is-expanded' : ''}`}
                  aria-expanded={isExpanded}
                  aria-controls={`stat-details-${row.key}`}
                  data-testid={`stat-row-${row.key}`}
                  onClick={() => toggleExpanded(row.key)}
                >
                  <StatRowContent
                    row={row}
                    precision={precision}
                    expanded={isExpanded}
                  />
                </button>
                {isExpanded ? (
                  <StatDetails
                    row={row}
                    solves={solves}
                    trimming={trimming}
                    precision={precision}
                    onSetTarget={onSetTarget}
                  />
                ) : null}
              </div>
            )
          })}
        </div>
      ) : null}

      {tiles.length === 0 ? (
        <p className="stats-empty">
          No statistics shown. Enable at least one in Settings.
        </p>
      ) : null}
    </section>
  )
})
