import type { calculateTrainingReport } from '../../lib/training/reports'
import type { TrainingVisit } from '../../lib/training/types'
import { STANDARD_CASE_BY_ID } from '../../lib/training/catalog/standardCases'
import { trainingChangeLabel, trainingTime } from '../../lib/training/format'
import { trainingCategoryLabel, trainingPercentage } from '../../lib/training/statisticsView'
import { trainingVisitElapsed } from '../../lib/training/records'
import { AnalyticsLineChart } from '../AnalyticsCharts'
import { StatisticsSummary } from './TrainingReportSummary'

type Report = ReturnType<typeof calculateTrainingReport>

export function TrainingSessionReport({ visit, report, onOpenAttempt }: {
  visit: TrainingVisit
  report: Report
  onOpenAttempt: (id: string) => void
}) {
  return <section aria-label="Practice report" className="training-report">
    <h3>{visit.session?.name ?? 'Practice report'}</h3>
    {visit.lifecycle?.endReason === 'tab-closed' && visit.session ? <p>The previous session ended when the site closed.</p> : null}
    <p>Duration: {trainingTime(trainingVisitElapsed(visit))} elapsed</p>
    {report.baseline ? <p>Comparison uses the previous {report.baseline.count} {report.baseline.kind === 'days' ? 'days' : 'attempts per case'}, before this session.</p> : null}
    {report.status === 'baseline-policy-unavailable' ? <p>Comparison unavailable for this legacy visit.</p> : null}
    {report.status === 'empty' ? <p>No remaining attempts in this visit.</p> : null}
    {report.categories?.map(category => {
      const { statistics, comparison, points, timing } = category
      const recognition = category.categoryId.endsWith(':recognition')
      return <section key={category.categoryId} className="training-report-category">
        <h4>{trainingCategoryLabel(category.categoryId)}</h4>
        <StatisticsSummary statistics={statistics} />
        {comparison ? <p>Measured time comparison: <strong className={comparison.changePercent == null ? undefined : comparison.changePercent < 0 ? 'training-faster' : comparison.changePercent > 0 ? 'training-slower' : undefined}>
          {trainingChangeLabel(comparison.changePercent)}</strong> · {comparison.matchedCases} of {comparison.cases.length} cases matched
          {comparison.changePercent === null ? ` · Needs ${comparison.requiredCases} ${comparison.requiredCases === 1 ? 'case' : 'cases'} with ${comparison.minimum} successes per side` : ''}
        </p> : null}
        {recognition ? <dl className="training-stat-grid">
          {([
            ['Mean combined estimate', timing.combined],
            ['Mean execution estimate', timing.execution],
            ['Mean recognition estimate', timing.recognition],
          ] as const).map(([label, value]) => <div key={label}><dt>{label}</dt>
            <dd>{trainingTime(value.meanMs)} · {value.count}/{statistics.successfulAttempts} successes</dd></div>)}
        </dl> : null}
        {points.length ? <AnalyticsLineChart title="Attempt order" ariaLabel="Attempt order chart"
          series={[{ key: 'measured', label: 'Measured time', color: 'var(--accent-strong)', values: points.map(point => point.measuredMs) }]}
          xLabel={index => {
            const point = points[index]
            return `#${index + 1}${point?.outcome === 'dnf' ? ' DNF' : point?.outcome === 'unsupported' ? ' Unavailable' : ''}`
          }}
          formatValue={trainingTime} formatTick={trainingTime}
          onSelectIndex={index => { const point = points[index]; if (point) onOpenAttempt(point.id) }}
          emptyMessage="No successful measured times. Open attempt details below for individual results."
          testId="training-report-chart" /> : null}
        {category.cases.length ? <div className="training-table-wrap" tabIndex={0} role="region" aria-label="Practice results by case">
          <table><thead><tr><th>Case</th><th>Attempts</th><th>Successes</th><th>DNF</th><th>Mean</th><th>Best</th><th>Comparison</th></tr></thead>
            <tbody>{category.cases.map(({ caseId, statistics: row }) => {
              const match = comparison?.cases.find(item => item.caseId === caseId)
              return <tr key={caseId}><th scope="row">{STANDARD_CASE_BY_ID.get(caseId)?.name}</th><td>{row.recordedAttempts}</td>
                <td>{row.successfulAttempts}</td><td>{trainingPercentage(row.dnfPercentage)}</td>
                <td>{trainingTime(row.raw.meanMs)}</td><td>{trainingTime(row.raw.bestMs)}</td>
                <td>{match ? `${match.changePercent === null ? '—' : trainingChangeLabel(match.changePercent)} (${match.currentSuccesses}/${match.historicalSuccesses})` : '—'}</td></tr>
            })}</tbody></table>
        </div> : null}
      </section>
    })}
    <details><summary>Visit attempts</summary><div className="training-report-list">
      {report.categories?.flatMap(category => category.points).map(point => <button key={point.id} type="button" className="button button-secondary"
        onClick={() => onOpenAttempt(point.id)}>{STANDARD_CASE_BY_ID.get(point.caseId)?.name} · {point.outcome === 'dnf' ? 'DNF' : point.outcome === 'unsupported' ? 'Unavailable' : trainingTime(point.measuredMs)}
        {point.combinedMs !== null ? ` · Combined ${trainingTime(point.combinedMs)}` : ''}
        {point.recognitionMs !== null ? ` · Recognition ${trainingTime(point.recognitionMs)} · Execution ${trainingTime(point.executionMs)}` : ''}
      </button>)}
    </div></details>
  </section>
}
