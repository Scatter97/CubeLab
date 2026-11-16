import { memo, useMemo } from 'react'
import { StatColumns, StatisticsPanel } from './StatisticsPanel'
import type { CSSProperties } from 'react'
import {
  formatOptionalTime,
  formatSolveCount,
  formatStatValue,
  formatTimeWithPrecision,
} from '../lib/format'
import { DEFAULT_AVERAGE_TRIMMING } from '../lib/averageTrimming'
import {
  calculateStatInsights,
  type NextSolveTarget,
  type StatInsightKind,
  type StatInsights,
} from '../lib/statInsights'
import { BUILT_IN_STAT_DEFINITIONS } from '../lib/statDefinitions'
import type { SessionStats, StatPair, StatResult } from '../lib/stats'
import type {
  AverageTrimming,
  CustomAverageSetting,
  Solve,
  StatMetricVisibility,
  StatPrecision,
  StatVisibility,
} from '../types'

interface StatsPanelProps {
  stats: SessionStats
  visibleStats: StatVisibility
  customAverages: readonly CustomAverageSetting[]
  metricVisibility: StatMetricVisibility
  precision: StatPrecision
  solves: readonly Solve[]
  trimming?: AverageTrimming
  /** Receives the intrinsic panel height needed to show every enabled row. */
  onMinimumHeightChange?: (height: number) => void
  style?: CSSProperties
}

interface StatRowModel {
  key: string
  label: string
  kind: StatInsightKind
  size: number | null
  pair: StatPair
  testId: string
  currentTestId: string
}

const EMPTY_PAIR: StatPair = { best: null, latest: null }

function resultClass(result: StatResult): string {
  if (result === null) return 'is-empty'
  return result.status === 'dnf' ? 'is-dnf' : ''
}

interface TargetDisplay {
  text: string
  className: string
  title: string
}

function targetDisplay(
  target: NextSolveTarget,
  precision: StatPrecision,
  label: string,
): TargetDisplay {
  switch (target.status) {
    case 'insufficient':
      return {
        text: '—',
        className: 'is-empty',
        title: `Target for ${label}: not enough history to establish a session best.`,
      }
    case 'impossible':
      return {
        text: 'N/A',
        className: 'is-empty',
        title: `No next result can produce a new ${label} best.`,
      }
    case 'any':
      return {
        text: '∞',
        className: 'is-reachable',
        title: `Any next result, including a DNF, produces a new ${label} best.`,
      }
    case 'any-valid':
      return {
        text: '∞',
        className: 'is-reachable',
        title: `Any finite next result produces a new ${label} best.`,
      }
    case 'value':
      if (target.ms === null) {
        return {
          text: '—',
          className: 'is-empty',
          title: `Target for ${label}: not available.`,
        }
      }
      return {
        text: formatTimeWithPrecision(target.ms, precision),
        className: 'is-reachable',
        title: `Maximum next result for a new ${label} best; a tie does not count.`,
      }
  }
}

function MetricLabel({
  children,
  title,
}: {
  children: string
  title?: string
}) {
  return (
    <span className="stat-metric-label">
      {title ? <abbr title={title}>{children}</abbr> : children}
    </span>
  )
}

function StatRowContent({
  row,
  precision,
  metricVisibility,
  insights,
  measurement = false,
}: {
  row: StatRowModel
  precision: StatPrecision
  metricVisibility: StatMetricVisibility
  insights: StatInsights | null
  measurement?: boolean
}) {
  const showCurrent = metricVisibility.current
  const showBest = metricVisibility.best
  const showTarget = metricVisibility.target
  const showBpa = metricVisibility.bpa && row.kind !== 'single'
  const showWpa = metricVisibility.wpa && row.kind !== 'single'
  const target = showTarget ? insights?.target : undefined
  const display = target
    ? targetDisplay(target, precision, row.label)
    : null
  const hasSecondary = showBpa || showWpa || display !== null

  return (
    <>
      <StatColumns
        label={row.label}
        current={showCurrent ? {
          text: formatStatValue(row.pair.latest, precision),
          className: resultClass(row.pair.latest),
          testId: measurement ? undefined : row.currentTestId,
        } : undefined}
        best={showBest ? {
          text: formatOptionalTime(row.pair.best, precision),
          className: row.pair.best === null ? 'is-empty' : '',
          testId: measurement ? undefined : row.testId,
        } : undefined}
      />

      {hasSecondary && insights ? (
        <div className="stat-secondary">
          {showBpa ? (
            <span className={`stat-metric ${resultClass(insights.bpa)}`}>
              <MetricLabel title="Best possible average if the next solve is 0.00.">
                BPA
              </MetricLabel>
              <strong data-testid={measurement ? undefined : `bpa-${row.key}`}>
                {formatStatValue(insights.bpa, precision)}
              </strong>
            </span>
          ) : null}
          {showWpa ? (
            <span className={`stat-metric ${resultClass(insights.wpa)}`}>
              <MetricLabel title="Worst possible average if the next solve is a DNF.">
                WPA
              </MetricLabel>
              <strong data-testid={measurement ? undefined : `wpa-${row.key}`}>
                {formatStatValue(insights.wpa, precision)}
              </strong>
            </span>
          ) : null}
          {display ? (
            <span className={`stat-metric stat-target ${display.className}`}>
              <MetricLabel title="Maximum next result for a new session best.">
                Target
              </MetricLabel>
              <strong
                title={display.title}
                aria-label={`Target for ${row.label}: ${display.text}. ${display.title}`}
                data-testid={measurement ? undefined : `target-${row.key}`}
              >
                {display.text}
              </strong>
            </span>
          ) : null}
        </div>
      ) : null}
    </>
  )
}

const StatRow = memo(function StatRow({
  row,
  precision,
  metricVisibility,
  insights,
}: {
  row: StatRowModel
  precision: StatPrecision
  metricVisibility: StatMetricVisibility
  insights: StatInsights | null
}) {
  return (
    <div className="stat-entry" data-testid={`stat-row-${row.key}`}>
      <StatRowContent
        row={row}
        precision={precision}
        metricVisibility={metricVisibility}
        insights={insights}
      />
    </div>
  )
})

export const StatsPanel = memo(function StatsPanel({
  stats,
  visibleStats,
  customAverages,
  metricVisibility,
  precision,
  solves,
  trimming = DEFAULT_AVERAGE_TRIMMING,
  onMinimumHeightChange,
  style,
}: StatsPanelProps) {
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
        }
      })

    return [...builtInTiles, ...customTiles]
  }, [customAverages, stats, visibleStats])

  const insightsByKey = useMemo(() => {
    const insights = new Map<string, StatInsights | null>()
    for (const row of tiles) {
      const wantsBpa = metricVisibility.bpa && row.kind !== 'single'
      const wantsWpa = metricVisibility.wpa && row.kind !== 'single'
      const wantsTarget = metricVisibility.target
      if (!wantsBpa && !wantsWpa && !wantsTarget) {
        insights.set(row.key, null)
        continue
      }
      insights.set(
        row.key,
        calculateStatInsights({
          solves,
          kind: row.kind,
          size: row.size,
          trimming,
          bestMs: row.pair.best,
          metrics: {
            bpa: wantsBpa,
            wpa: wantsWpa,
            target: wantsTarget,
          },
        }),
      )
    }
    return insights
  }, [metricVisibility, solves, tiles, trimming])

  return (
    <StatisticsPanel
      count={formatSolveCount(stats.count)}
      hasRows={tiles.length > 0}
      empty="No statistics shown. Enable at least one in Settings."
      onMinimumHeightChange={onMinimumHeightChange}
      style={style}
      renderRows={measurement => tiles.map(row => {
        const props = { row, precision, metricVisibility, insights: insightsByKey.get(row.key) ?? null }
        return measurement ? (
          <div className="stat-entry" key={row.key}>
            <StatRowContent {...props} measurement />
          </div>
        ) : <StatRow key={row.key} {...props} />
      })}
    />
  )
})
