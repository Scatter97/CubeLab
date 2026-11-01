import { memo } from 'react'
import {
  formatOptionalTime,
  formatSolveCount,
  formatStatValue,
} from '../lib/format'
import { DEFAULT_AVERAGE_TRIMMING, averageTrimmingLabel } from '../lib/averageTrimming'
import type { AverageTrimming } from '../types'
import { BUILT_IN_STAT_DEFINITIONS } from '../lib/statDefinitions'
import type { SessionStats, StatPair, StatResult } from '../lib/stats'
import type {
  CustomAverageSetting,
  StatPrecision,
  StatVisibility,
} from '../types'

interface StatsPanelProps {
  stats: SessionStats
  visibleStats: StatVisibility
  customAverages: readonly CustomAverageSetting[]
  precision: StatPrecision
  trimming?: AverageTrimming
}

const EMPTY_PAIR: StatPair = { best: null, latest: null }

function resultClass(result: StatResult): string {
  if (result === null) return 'is-empty'
  return result.status === 'dnf' ? 'is-dnf' : ''
}

function StatTile({
  label,
  best,
  latest,
  testId,
  precision,
}: {
  label: string
  best: number | null
  latest: StatResult
  testId: string
  precision: StatPrecision
}) {
  const latestClass = resultClass(latest)
  return (
    <div className="stat-tile">
      <span className="stat-label">{label}</span>
      <strong
        className={`stat-value ${best === null ? 'is-empty' : ''}`}
        data-testid={testId}
      >
        {formatOptionalTime(best, precision)}
      </strong>
      <span className={`stat-latest ${latestClass}`}>
        <span>Latest</span>
        {formatStatValue(latest, precision)}
      </span>
    </div>
  )
}

export const StatsPanel = memo(function StatsPanel({
  stats,
  visibleStats,
  customAverages,
  precision,
  trimming = DEFAULT_AVERAGE_TRIMMING,
}: StatsPanelProps) {
  const builtInTiles = BUILT_IN_STAT_DEFINITIONS.filter(
    (definition) => visibleStats[definition.key],
  ).map((definition) => {
    const pair =
      definition.key === 'single'
        ? stats.single
        : definition.key === 'mo3'
          ? stats.mo3
          : stats.averages.get(definition.size as number) ?? EMPTY_PAIR

    return {
      key: definition.key as string,
      label: definition.label,
      best: pair.best,
      latest: pair.latest,
      testId: `best-${definition.key}`,
    }
  })

  const customTiles = customAverages
    .filter((average) => average.visible)
    .map((average) => {
      const pair = stats.averages.get(average.size) ?? EMPTY_PAIR
      return {
        key: `custom-${average.id}`,
        label: `Best ao${average.size}`,
        best: pair.best,
        latest: pair.latest,
        testId: `best-ao${average.size}`,
      }
    })

  const shownTiles = [...builtInTiles, ...customTiles]

  return (
    <section className="panel stats-panel" aria-labelledby="stats-title">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">
            <span className="eyebrow-index">03</span>
            Statistics
          </span>
          <h2 id="stats-title">Statistics</h2>
        </div>
        <span className="count-pill">{formatSolveCount(stats.count)}</span>
      </div>

      {shownTiles.length > 0 ? (
        <div className="stats-grid">
          {shownTiles.map((tile) => (
            <StatTile
              key={tile.key}
              label={tile.label}
              best={tile.best}
              latest={tile.latest}
              testId={tile.testId}
              precision={precision}
            />
          ))}
        </div>
      ) : (
        <p className="stats-empty">
          No statistics shown. Enable at least one in Settings.
        </p>
      )}

      <p className="stats-note">
        <span className="note-mark">AVG</span>
        Trim {averageTrimmingLabel(trimming)}. DNFs count as worst.
      </p>
    </section>
  )
})
