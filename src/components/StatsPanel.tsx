import { formatOptionalTime, formatSolveCount, formatStatValue } from '../lib/format'
import type { SessionStats, StatResult } from '../lib/stats'

interface StatsPanelProps {
  stats: SessionStats
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
}: {
  label: string
  best: number | null
  latest: StatResult
  testId: string
}) {
  const latestClass = resultClass(latest)
  return (
    <div className="stat-tile">
      <span className="stat-label">{label}</span>
      <strong
        className={`stat-value ${best === null ? 'is-empty' : ''}`}
        data-testid={testId}
      >
        {formatOptionalTime(best)}
      </strong>
      <span className={`stat-latest ${latestClass}`}>
        <span>Latest</span>
        {formatStatValue(latest)}
      </span>
    </div>
  )
}

export function StatsPanel({ stats }: StatsPanelProps) {
  return (
    <section className="panel stats-panel" aria-labelledby="stats-title">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">
            <span className="eyebrow-index">02</span>
            Performance
          </span>
          <h2 id="stats-title">Session stats</h2>
        </div>
        <span className="count-pill">{formatSolveCount(stats.count)}</span>
      </div>

      <div className="stats-grid">
        <StatTile
          label="Best single"
          best={stats.bestSingleMs}
          latest={stats.latestSingle}
          testId="best-single"
        />
        <StatTile
          label="Best mo3"
          best={stats.bestMean3Ms}
          latest={stats.latestMean3}
          testId="best-mo3"
        />
        <StatTile
          label="Best ao5"
          best={stats.bestAverage5Ms}
          latest={stats.latestAverage5}
          testId="best-ao5"
        />
        <StatTile
          label="Best ao12"
          best={stats.bestAverage12Ms}
          latest={stats.latestAverage12}
          testId="best-ao12"
        />
      </div>

      <p className="stats-note">
        <span className="note-mark">WCA</span>
        Trimmed averages. One DNF is dropped; two make the average DNF.
      </p>
    </section>
  )
}
