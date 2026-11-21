import { useMemo, useState } from 'react'
import { addLocalDays, analyticsSpansMultipleYears, formatAnalyticsAxisDate } from '../../lib/analytics'
import { buildTrainingAnalytics } from '../../lib/training/analytics'
import { trainingTime } from '../../lib/training/format'
import { trainingPercentage } from '../../lib/training/statisticsView'
import type { TrainingArchiveRequest } from './TrainingArchive'
import type { TrainingData, TrainingMode, TrainingSetId } from '../../lib/training/types'
import { useLocalDayRefresh } from '../../hooks/useLocalDayRefresh'
import { AnalyticsLineChart } from '../AnalyticsCharts'
import { TrainingSetSelect } from './TrainingSetup'

const countLabel = (count: number) => count.toLocaleString()

export default function AlgorithmsAnalytics({ data, hidden, onStart, onHistory }: {
  data: TrainingData | null
  hidden: boolean
  onStart: () => void
  onHistory: (request: TrainingArchiveRequest) => void
}) {
  const [set, setSet] = useState<TrainingSetId>(() => data?.preferences.selectedSetId ?? 'oll')
  const [mode, setMode] = useState<TrainingMode>('execution')
  const [range, setRange] = useState(90)
  const day = useLocalDayRefresh()
  const since = range ? addLocalDays(day, 1 - range) : undefined
  const category = `${set}:${mode}` as const
  const analytics = useMemo(() => data ? buildTrainingAnalytics(data.attempts, category, since) : null, [category, data, since])
  const dates = analytics?.days.map(point => point.date) ?? []
  const showYear = analyticsSpansMultipleYears(dates)
  const dateLabel = (index: number) => formatAnalyticsAxisDate(dates[index] ?? day, showYear)
  return <main className="analytics-page training-algorithms" hidden={hidden} aria-labelledby="algorithms-analytics-title">
    <header className="analytics-heading">
      <div className="analytics-heading-copy"><h1 id="algorithms-analytics-title">Algorithms</h1></div>
      <div className="analytics-heading-actions">
        <button type="button" className="analytics-action" disabled={!data} onClick={() => onHistory({ filters: { set, mode }, dateRange: range })}>Practice history</button>
        <button type="button" className="analytics-action is-primary" onClick={onStart}>Start new session</button>
      </div>
    </header>
    {analytics ? <>
      <div className="panel training-algorithms-filters">
        <div role="group" aria-label="Practice type" className="training-actions">
          {(['execution', 'recognition'] as const).map(option => <button type="button" key={option}
            className="button button-secondary button-small" aria-pressed={mode === option} onClick={() => setMode(option)}>
            {option === 'execution' ? 'Execution' : 'Recognition (BETA)'}</button>)}
        </div>
        <label>Algorithm set <TrainingSetSelect setId={set} onChange={setSet} /></label>
        <label>Date range <select className="training-select" value={range} onChange={event => setRange(Number(event.target.value))}>
          <option value={30}>Last 30 days</option><option value={90}>Last 90 days</option><option value={0}>All dates</option>
        </select></label>
      </div>
      <section className="panel training-algorithms-section" aria-label="Practice summary">
        <h2>Practice summary</h2>
        {mode === 'recognition' ? <p className="training-muted">Measured times include setup moves.</p> : null}
        <dl className="training-stat-grid">
          <div><dt>Attempts</dt><dd data-testid="algorithms-attempt-count">{analytics.statistics.recordedAttempts}</dd></div>
          <div><dt>Successes</dt><dd>{analytics.statistics.successfulAttempts}</dd></div>
          <div><dt>DNF rate</dt><dd>{trainingPercentage(analytics.statistics.dnfPercentage)}</dd></div>
          <div><dt>Best measured</dt><dd>{trainingTime(analytics.statistics.raw.bestMs)}</dd></div>
          <div><dt>Mean measured</dt><dd>{trainingTime(analytics.statistics.raw.meanMs)}</dd></div>
          {analytics.statistics.unsupportedAttempts ? <div><dt>Unsupported legacy</dt><dd>{analytics.statistics.unsupportedAttempts}</dd></div> : null}
        </dl>
      </section>
      <div className="training-algorithms-charts">
        <section className="panel training-algorithms-section">
          <AnalyticsLineChart key={category} title="Time progression" ariaLabel="Daily mean measured time"
            series={[{ key: 'time', label: 'Mean measured time', color: 'var(--accent-strong)', values: analytics.days.map(point => point.meanMs) }]}
            xLabel={dateLabel} formatValue={trainingTime} formatTick={trainingTime}
            emptyMessage="No successful attempts in this range." testId="algorithms-progression" />
        </section>
        <section className="panel training-algorithms-section">
          <AnalyticsLineChart key={category} title="Practice volume" ariaLabel="Attempts per practice day"
            series={[{ key: 'volume', label: 'Attempts', color: 'var(--trend-pb)', values: analytics.days.map(point => point.count) }]}
            xLabel={dateLabel} formatValue={countLabel} formatTick={countLabel}
            emptyMessage="No attempts in this range." testId="algorithms-volume" />
        </section>
      </div>
      <section className="panel training-algorithms-section" aria-labelledby="algorithms-case-title">
        <h2 id="algorithms-case-title">Case performance</h2>
        <div className="training-table-wrap" tabIndex={0} role="region" aria-label="Case performance table">
          <table><thead><tr><th>Case</th><th>Attempts</th><th>DNF rate</th><th>Mean measured</th><th>Best measured</th></tr></thead>
            <tbody>{analytics.cases.map(row => {
              const { caseId, name, statistics } = row
              return <tr key={caseId}>
                <th scope="row">{name}</th>
                <td>{statistics.recordedAttempts}</td><td>{trainingPercentage(statistics.dnfPercentage)}</td>
                <td>{trainingTime(statistics.raw.meanMs)}</td><td>{trainingTime(statistics.raw.bestMs)}</td>
              </tr>
            })}</tbody></table>
        </div>
      </section>
    </> : <p>Training history is unavailable.</p>}
  </main>
}
