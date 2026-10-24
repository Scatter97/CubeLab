import {
  formatOptionalTime,
  formatSolveCount,
  formatStatValue,
} from '../lib/format'
import type { SessionStats, StatResult } from '../lib/stats'
import type { StatKey, StatPrecision, StatVisibility } from '../types'

interface StatsPanelProps {
  stats: SessionStats
  visibleStats: StatVisibility
  precision: StatPrecision
}

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

export function StatsPanel({
  stats,
  visibleStats,
  precision,
}: StatsPanelProps) {
  const tiles: Array<{
    key: StatKey
    label: string
    best: number | null
    latest: StatResult
    testId: string
  }> = [
    {
      key: 'single',
      label: 'Best single',
      best: stats.bestSingleMs,
      latest: stats.latestSingle,
      testId: 'best-single',
    },
    {
      key: 'mo3',
      label: 'Best mo3',
      best: stats.bestMean3Ms,
      latest: stats.latestMean3,
      testId: 'best-mo3',
    },
    {
      key: 'ao5',
      label: 'Best ao5',
      best: stats.bestAverage5Ms,
      latest: stats.latestAverage5,
      testId: 'best-ao5',
    },
    {
      key: 'ao12',
      label: 'Best ao12',
      best: stats.bestAverage12Ms,
      latest: stats.latestAverage12,
      testId: 'best-ao12',
    },
  ]
  const shownTiles = tiles.filter((tile) => visibleStats[tile.key])

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
        <span className="note-mark">WCA</span>
        Trimmed averages. One DNF is dropped; two make the average DNF.
      </p>
    </section>
  )
}
