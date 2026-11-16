import type { TrainingStatistics as Statistics } from '../../lib/training/stats'
import { trainingTime } from '../../lib/training/format'
import { trainingPercentage } from '../../lib/training/statisticsView'

export function StatisticsSummary({ statistics: s }: { statistics: Statistics }) {
  return <dl className="training-stat-grid">
    <div><dt>Attempts</dt><dd>{s.recordedAttempts}</dd></div>
    <div><dt>Successes</dt><dd>{s.successfulAttempts}</dd></div>
    <div><dt>DNF rate</dt><dd>{trainingPercentage(s.dnfPercentage)}</dd></div>
    <div><dt>Best measured</dt><dd>{trainingTime(s.raw.bestMs)}</dd></div>
    <div><dt>Mean measured</dt><dd>{trainingTime(s.raw.meanMs)}</dd></div>
    {s.unsupportedAttempts ? <div><dt>Unsupported legacy</dt><dd>{s.unsupportedAttempts}</dd></div> : null}
  </dl>
}
