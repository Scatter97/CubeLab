import { useMemo, useState } from 'react'
import { analyticsSpansMultipleYears, formatAnalyticsAxisDate } from '../../lib/analytics'
import { resolveCapturedAlgorithm } from '../../lib/training/algorithmSelection'
import { trainingPracticeDays, type buildTrainingAnalytics } from '../../lib/training/analytics'
import { trainingTime } from '../../lib/training/format'
import type { TrainingCategoryId, TrainingData } from '../../lib/training/types'
import { AnalyticsLineChart } from '../AnalyticsCharts'
import { StatisticsSummary } from './TrainingReportSummary'

type CaseRow = ReturnType<typeof buildTrainingAnalytics>['cases'][number]

export function TrainingRevisionDetails({ data, row, category }: {
  data: TrainingData
  row: CaseRow
  category: TrainingCategoryId
}) {
  const [selection, setSelection] = useState(row.revisions[0]?.key)
  const revision = row.revisions.find(item => item.key === selection) ?? row.revisions[0]
  const days = useMemo(() => revision ? trainingPracticeDays(revision.attempts, category) : [], [revision, category])
  if (!revision) return null
  const showYear = analyticsSpansMultipleYears(days.map(point => point.date))
  return <section className="training-revision-details" aria-label={`${row.name} revision statistics`}>
    <label>Algorithm revision <select className="training-select" value={revision.key} onChange={event => setSelection(event.target.value)}>
      {row.revisions.map(item => {
        const resolved = resolveCapturedAlgorithm(data, row.caseId, item.algorithm)
        const name = resolved?.source === 'built-in' ? 'Built-in default' : resolved?.record.label ?? item.algorithm.id
        return <option value={item.key} key={item.key}>{name} · revision {item.algorithm.revision} · {item.algorithm.notation ?? 'Notation unavailable'}</option>
      })}
    </select></label>
    <StatisticsSummary statistics={revision.statistics} />
    <AnalyticsLineChart key={revision.key} title="Revision progression" ariaLabel={`${row.name} revision progression`}
      series={[{ key: 'time', label: 'Mean measured time', color: 'var(--accent-strong)', values: days.map(point => point.meanMs) }]}
      xLabel={index => formatAnalyticsAxisDate(days[index]!.date, showYear)} formatValue={trainingTime} formatTick={trainingTime}
      emptyMessage="No successful measured times for this revision." testId="algorithm-revision-progression" />
  </section>
}
