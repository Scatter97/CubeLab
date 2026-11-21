import { memo, useMemo, type CSSProperties } from 'react'
import { trainingTime, trainingWindowCell } from '../../lib/training/format'
import { compareTrainingVisit, trainingPercentage } from '../../lib/training/statisticsView'
import { trainingStatistics, trainingTimingWindows, type TrainingMetric } from '../../lib/training/stats'
import { TRAINING_STAT_BY_ID, type TrainingStatId, type TrainingStatisticsPreferences } from '../../lib/training/statisticsPreferences'
import type { TrainingAttempt, TrainingCaseId, TrainingCategoryId, TrainingVisit } from '../../lib/training/types'
import { TrainingActions } from './TrainingActions'
import { StatColumns, StatisticsPanel } from '../StatisticsPanel'

interface Props {
  attempts: readonly TrainingAttempt[]
  history: readonly TrainingAttempt[]
  category: TrainingCategoryId
  trim: number
  preferences: TrainingStatisticsPreferences
  difficult: readonly TrainingCaseId[]
  visit?: TrainingVisit
  locked: boolean
  style?: CSSProperties
  onMinimumHeightChange?: (height: number) => void
  onChangeMetric: (metric: TrainingMetric) => void
  onConfigure: () => void
  onDetails: () => void
  onTimingDetails: (id: TrainingStatId) => void
}

export const TrainingStatistics = memo(function TrainingStatistics({
  attempts, history, category, trim, preferences, difficult, visit, locked, style, onMinimumHeightChange,
  onChangeMetric, onConfigure, onDetails, onTimingDetails,
}: Props) {
  const { metric, current, best, rows, visible } = preferences
  const recognition = category.endsWith(':recognition')
  const definitions = useMemo(() => rows.flatMap(id => {
    const row = TRAINING_STAT_BY_ID.get(id)
    return row && visible.includes(id) && (!('recognitionOnly' in row) || recognition) ? [row] : []
  }), [recognition, rows, visible])
  const summary = useMemo(() => trainingStatistics(attempts, { categoryId: category }, 0), [attempts, category])
  const values = useMemo(() => {
    const filter = { categoryId: category }
    const series = metric === 'raw' ? summary.raw : summary.estimated
    return definitions.map(row => {
      if ('size' in row) {
        const pair = trainingTimingWindows(attempts, row.size, row.size > 3 ? trim : 0, metric, best)
        return { row, pair }
      }

      let text: string
      switch (row.id) {
        case 'attempts': text = String(summary.totalAttempts); break
        case 'successful': text = String(summary.successfulAttempts); break
        case 'dnfs': text = String(summary.dnfAttempts); break
        case 'dnfRate': text = trainingPercentage(summary.dnfPercentage); break
        case 'successRate': text = trainingPercentage(summary.totalAttempts ? summary.successfulAttempts / summary.totalAttempts * 100 : null); break
        case 'mean': text = trainingTime(series?.meanMs ?? null); break
        case 'best': text = trainingTime(series?.bestMs ?? null); break
        case 'distinct': text = String(new Set(attempts.map(attempt => attempt.caseId)).size); break
        case 'estimate': text = trainingTime(summary.estimated?.meanMs ?? null); break
        case 'difficult': {
          const marked = new Set(difficult)
          const subset = trainingStatistics(attempts.filter(attempt => marked.has(attempt.caseId)), filter, 0)
          text = trainingTime((metric === 'raw' ? subset.raw : subset.estimated)?.meanMs ?? null)
          break
        }
        case 'improvement': text = trainingPercentage(compareTrainingVisit(history, visit, category, metric)?.improvementPercent ?? null); break
      }
      return { row, text }
    })
  }, [attempts, best, category, definitions, difficult, history, metric, summary, trim, visit])

  return (
    <StatisticsPanel
      count={`${summary.recordedAttempts} ${summary.recordedAttempts === 1 ? 'attempt' : 'attempts'}`}
      empty="No statistics shown. Choose rows in Customize."
      hasRows={values.length > 0}
      onMinimumHeightChange={onMinimumHeightChange}
      style={style}
      headingAction={
        <TrainingActions label="Statistics options" disabled={locked}>{close => <>
          <button type="button" className="text-button" onClick={() => { close(); onConfigure() }}>Customize</button>
          <button type="button" className="text-button" onClick={() => { close(); onDetails() }}>Detailed statistics</button>
          {recognition ? (
            <label className="training-preset-field">Timing series
              <select className="training-select" value={metric}
                onChange={event => { onChangeMetric(event.target.value as TrainingMetric); close() }}>
                <option value="raw">Raw</option>
                <option value="estimated">Estimated</option>
              </select>
            </label>
          ) : null}
        </>}</TrainingActions>
      }
      renderRows={measurement => values.map(value => {
        const { row } = value
        if (!value.pair) return (
          <div className="stat-entry" key={row.id} data-testid={measurement ? undefined : `training-stat-row-${row.id}`}>
            <div className="training-stat-metric"><span className="stat-label">{row.label}</span><strong>{value.text}</strong></div>
          </div>
        )
        const columns = (
          <StatColumns
            label={row.label}
            current={current ? { ...trainingWindowCell(value.pair.current.result), testId: measurement ? undefined : `training-current-${row.id}` } : undefined}
            best={best ? { ...trainingWindowCell(value.pair.best?.result), testId: measurement ? undefined : `training-best-${row.id}` } : undefined}
          />
        )
        return (
          <div className="stat-entry" key={row.id} data-testid={measurement ? undefined : `training-stat-row-${row.id}`}>
            {columns}
            {measurement ? null : (
              <button type="button" className="training-stat-button" aria-label={`${row.label} timing details`}
                aria-haspopup="dialog" disabled={locked} onClick={() => onTimingDetails(row.id)} />
            )}
          </div>
        )
      })}
    />
  )
})
