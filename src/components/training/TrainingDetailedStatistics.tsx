import { useId, useMemo, useState } from 'react'
import { STANDARD_CASES } from '../../lib/training/catalog/standardCases'
import { trainingStatistics, type TrainingMetric } from '../../lib/training/stats'
import {
  compareTrainingVisit,
  trainingCategoryLabel,
  trainingPercentage,
} from '../../lib/training/statisticsView'
import { trainingTime } from '../../lib/training/format'
import type {
  TrainingAttempt,
  TrainingCaseId,
  TrainingCategoryId,
  TrainingData,
  TrainingVisit,
} from '../../lib/training/types'
import { CaseDiagram } from './CaseDiagram'
import { TrainingDialog } from './TrainingDialog'

const EMPTY_ATTEMPTS: readonly TrainingAttempt[] = []

interface Props {
  data: TrainingData
  attempts: readonly TrainingAttempt[]
  history: readonly TrainingAttempt[]
  category: TrainingCategoryId
  metric: TrainingMetric
  visit?: TrainingVisit
  onClose: () => void
}

/**
 * Case-only detailed statistics. Algorithm revision tracking is temporarily
 * retired, so every attempt is grouped by its case regardless of any saved
 * historical attribution.
 */
export function TrainingDetailedStatistics({
  data,
  attempts,
  history,
  category,
  metric,
  visit,
  onClose,
}: Props) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [order, setOrder] = useState('case')
  const id = useId()
  const recognition = category.endsWith(':recognition')
  const setId = category.startsWith('oll:') ? 'oll' : 'pll'
  const difficult = data.preferences.sets[setId].difficultCaseIds

  const entries = useMemo(() => {
    const cases = STANDARD_CASES.filter((record) => record.setId === setId)
    const groups = new Map<string, TrainingAttempt[]>()
    for (const attempt of attempts) {
      const group = groups.get(attempt.caseId)
      if (group) group.push(attempt)
      else groups.set(attempt.caseId, [attempt])
    }
    const improvement = new Map(
      compareTrainingVisit(history, visit, category, metric)?.cases.map(
        (row) => [row.caseId, row.improvementPercent],
      ),
    )
    return cases.map((record) => ({
      key: record.id,
      caseId: record.id as TrainingCaseId,
      name: record.name,
      stats: trainingStatistics(groups.get(record.id) ?? EMPTY_ATTEMPTS, {
        categoryId: category,
      }, 0),
      improvement: improvement.get(record.id) ?? null,
    }))
  }, [attempts, category, history, metric, setId, visit])

  const matching = useMemo(() => {
    const search = query.trim().toLowerCase()
    const series = (entry: (typeof entries)[number]) =>
      metric === 'raw' ? entry.stats.raw : entry.stats.estimated
    return entries
      .filter((entry) => {
        const matchesQuery = [entry.caseId, entry.name].some((value) =>
          value.toLowerCase().includes(search),
        )
        if (!matchesQuery) return false
        switch (filter) {
          case 'practiced':
            return entry.stats.recordedAttempts > 0
          case 'unpracticed':
            return entry.stats.recordedAttempts === 0
          case 'difficult':
            return difficult.includes(entry.caseId)
          default:
            return true
        }
      })
      .sort((a, b) => {
        if (order === 'attempts')
          return b.stats.recordedAttempts - a.stats.recordedAttempts
        if (order === 'mean')
          return (
            (series(a)?.meanMs ?? Infinity) - (series(b)?.meanMs ?? Infinity) ||
            0
          )
        if (order === 'dnf')
          return (b.stats.dnfPercentage ?? -1) - (a.stats.dnfPercentage ?? -1)
        return a.name.localeCompare(b.name, undefined, { numeric: true })
      })
  }, [difficult, entries, filter, metric, order, query])

  return (
    <TrainingDialog title="Detailed statistics" onClose={onClose}>
      <p className="settings-note">
        {trainingCategoryLabel(category)} ·{' '}
        {metric === 'raw' ? 'Raw' : 'Estimated'} visit improvement
      </p>
      <div className="training-stat-breakdown" id={`${id}-panel`}>
        <div className="training-stat-filters">
          <label>
            Search
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <label>
            Filter
            <select
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            >
              <option value="all">All cases</option>
              <option value="practiced">Practiced</option>
              <option value="unpracticed">Unpracticed</option>
              <option value="difficult">Marked difficult</option>
            </select>
          </label>
          <label>
            Sort by
            <select
              value={order}
              onChange={(event) => setOrder(event.target.value)}
            >
              <option value="case">Case</option>
              <option value="attempts">Most attempts</option>
              <option value="mean">Fastest {metric} mean</option>
              <option value="dnf">Highest DNF percentage</option>
            </select>
          </label>
        </div>
        {matching.length ? (
          <div
            className="training-table-wrap training-stat-table"
            tabIndex={0}
            role="region"
            aria-label="Statistics by case"
          >
            <table>
              <thead>
                <tr>
                  <th scope="col">Case</th>
                  <th scope="col">Attempts</th>
                  <th scope="col">Successful</th>
                  <th scope="col">DNF %</th>
                  <th scope="col">{recognition ? 'Raw mean' : 'Mean'}</th>
                  <th scope="col">{recognition ? 'Raw best' : 'Best'}</th>
                  {recognition ? (
                    <>
                      <th scope="col">Est. mean</th>
                      <th scope="col">Est. best</th>
                    </>
                  ) : null}
                  <th scope="col">Improvement</th>
                </tr>
              </thead>
              <tbody>
                {matching.map((entry) => (
                  <tr key={entry.key}>
                    <th scope="row">
                      <span className="training-table-case">
                        <CaseDiagram caseId={entry.caseId} size={38} decorative />
                        <span>{entry.name}</span>
                      </span>
                    </th>
                    <td>{entry.stats.recordedAttempts}</td>
                    <td>{entry.stats.successfulAttempts}</td>
                    <td>{trainingPercentage(entry.stats.dnfPercentage)}</td>
                    <td>{trainingTime(entry.stats.raw.meanMs)}</td>
                    <td>{trainingTime(entry.stats.raw.bestMs)}</td>
                    {recognition ? (
                      <>
                        <td>{trainingTime(entry.stats.estimated?.meanMs ?? null)}</td>
                        <td>{trainingTime(entry.stats.estimated?.bestMs ?? null)}</td>
                      </>
                    ) : null}
                    <td>{trainingPercentage(entry.improvement)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p role="status">
            {entries.length
              ? 'No matches. Try another search or filter.'
              : 'No cases are available for this set.'}
          </p>
        )}
      </div>
      <p className="settings-note">
        Improvement compares the latest visit with its saved baseline for
        matching cases.
      </p>
    </TrainingDialog>
  )
}
