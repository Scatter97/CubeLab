import { useId, useMemo, useState } from 'react'
import { STANDARD_CASES } from '../../lib/training/catalog/standardCases'
import { BUILT_IN_ALGORITHM_BY_ID } from '../../lib/training/catalog/defaultAlgorithms'
import { trainingStatistics, type TrainingMetric } from '../../lib/training/stats'
import { compareTrainingVisit, trainingCategoryLabel, trainingPercentage } from '../../lib/training/statisticsView'
import { trainingTime } from '../../lib/training/format'
import type { TrainingAlgorithmSnapshot, TrainingAttempt, TrainingCaseId, TrainingCategoryId, TrainingData, TrainingVisit } from '../../lib/training/types'
import { CaseDiagram } from './CaseDiagram'
import { TrainingDialog } from './TrainingDialog'

type Tab = 'case' | 'algorithm'
const TABS: readonly Tab[] = ['case', 'algorithm']
const EMPTY_ATTEMPTS: readonly TrainingAttempt[] = []

function addAttempt(groups: Map<string, TrainingAttempt[]>, key: string, attempt: TrainingAttempt) {
  const group = groups.get(key)
  if (group) group.push(attempt)
  else groups.set(key, [attempt])
}

interface Props {
  data: TrainingData
  attempts: readonly TrainingAttempt[]
  category: TrainingCategoryId
  metric: TrainingMetric
  visit?: TrainingVisit
  onClose: () => void
}

export function TrainingDetailedStatistics({ data, attempts, category, metric, visit, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('case')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [order, setOrder] = useState('case')
  const id = useId()
  const recognition = category.endsWith(':recognition')
  const setId = category.startsWith('oll:') ? 'oll' : 'pll'
  const difficult = data.preferences.sets[setId].difficultCaseIds

  const entries = useMemo(() => {
    const cases = STANDARD_CASES.filter(record => record.setId === setId)
    const groups = new Map<string, TrainingAttempt[]>()
    const snapshots = new Map<string, TrainingAlgorithmSnapshot>()
    for (const attempt of attempts) {
      if (tab === 'case') addAttempt(groups, attempt.caseId, attempt)
      else if (attempt.attribution.kind !== 'unknown') {
        const algorithm = attempt.attribution.algorithm
        const key = JSON.stringify([attempt.caseId, algorithm.id, algorithm.revision])
        addAttempt(groups, key, attempt)
        snapshots.set(key, algorithm)
      }
    }

    const improvement = tab === 'case'
      ? new Map(compareTrainingVisit(attempts, visit, category, metric)?.cases.map(row => [row.caseId, row.improvementPercent]))
      : null
    const definitions = tab === 'case'
      ? cases.map(record => ({ key: record.id, caseId: record.id as TrainingCaseId }))
      : [...groups].map(([key, group]) => ({ key, caseId: group[0]!.caseId }))
    const names = new Map(cases.map(record => [record.id, record.name]))

    return definitions.map(({ key, caseId }) => {
      const group = groups.get(key) ?? EMPTY_ATTEMPTS
      const algorithm = snapshots.get(key)
      const builtIn = algorithm ? BUILT_IN_ALGORITHM_BY_ID.get(algorithm.id) : undefined
      const source = !algorithm ? null : builtIn?.version === algorithm.revision && builtIn.caseId === caseId
        ? 'Built-in'
        : data.customAlgorithms.some(record => record.id === algorithm.id && record.version === algorithm.revision && record.caseId === caseId)
          ? 'Custom' : 'Historical'
      return {
        key, caseId, name: names.get(caseId) ?? caseId, algorithm, source,
        stats: trainingStatistics(group, { categoryId: category }, 0),
        assumed: tab === 'algorithm' ? group.filter(attempt => attempt.attribution.kind === 'assumed-preferred').length : 0,
        improvement: (improvement
          ? improvement.get(caseId)
          : compareTrainingVisit(group, visit, category, metric)?.improvementPercent) ?? null,
      }
    })
  }, [attempts, category, data.customAlgorithms, metric, setId, tab, visit])

  const matching = useMemo(() => {
    const search = query.trim().toLowerCase()
    const series = (entry: typeof entries[number]) => metric === 'raw' ? entry.stats.raw : entry.stats.estimated
    return entries.filter(entry => {
      const matchesQuery = [entry.caseId, entry.name, entry.algorithm?.id, entry.algorithm?.notation, entry.algorithm?.revision]
        .some(value => value?.toString().toLowerCase().includes(search))
      if (!matchesQuery) return false
      switch (filter) {
        case 'practiced': return entry.stats.recordedAttempts > 0
        case 'unpracticed': return entry.stats.recordedAttempts === 0
        case 'difficult': return difficult.includes(entry.caseId)
        case 'built-in': return entry.source === 'Built-in'
        case 'custom': return entry.source === 'Custom'
        case 'historical': return entry.source === 'Historical'
        default: return true
      }
    }).sort((a, b) => {
      if (order === 'attempts') return b.stats.recordedAttempts - a.stats.recordedAttempts
      if (order === 'mean') return (series(a)?.meanMs ?? Infinity) - (series(b)?.meanMs ?? Infinity) || 0
      if (order === 'dnf') return (b.stats.dnfPercentage ?? -1) - (a.stats.dnfPercentage ?? -1)
      return a.name.localeCompare(b.name, undefined, { numeric: true })
    })
  }, [difficult, entries, filter, metric, order, query])

  const unknown = tab === 'algorithm' ? attempts.filter(attempt => attempt.attribution.kind === 'unknown').length : 0
  const switchTab = (next: Tab) => { setTab(next); setFilter('all'); setQuery('') }

  return (
    <TrainingDialog title="Detailed statistics" onClose={onClose}>
      <p className="settings-note">{trainingCategoryLabel(category)} · {metric === 'raw' ? 'Raw' : 'Estimated'} visit improvement</p>
      <div className="app-nav training-stat-tabs" role="tablist" aria-label="Statistics breakdown">
        {TABS.map(value => (
          <button type="button" key={value} id={`${id}-${value}`} className="app-nav-button"
            role="tab" aria-selected={value === tab} aria-controls={`${id}-panel`} tabIndex={value === tab ? 0 : -1}
            onClick={() => switchTab(value)}
            onKeyDown={event => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
              event.preventDefault()
              const next = event.key === 'Home' ? 'case' : event.key === 'End' ? 'algorithm' : value === 'case' ? 'algorithm' : 'case'
              switchTab(next)
              document.getElementById(`${id}-${next}`)?.focus()
            }}>
            {value === 'case' ? 'By case' : 'By algorithm'}
          </button>
        ))}
      </div>
      <div className="training-stat-breakdown" id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${tab}`}>
        <div className="training-stat-filters">
          <label>Search<input type="search" value={query} onChange={event => setQuery(event.target.value)} /></label>
          <label>Filter<select value={filter} onChange={event => setFilter(event.target.value)}>
            <option value="all">All {tab === 'case' ? 'cases' : 'algorithms'}</option>
            {tab === 'case' ? <>
              <option value="practiced">Practiced</option><option value="unpracticed">Unpracticed</option><option value="difficult">Marked difficult</option>
            </> : <>
              <option value="built-in">Built-in</option><option value="custom">Custom</option><option value="historical">Historical</option>
            </>}
          </select></label>
          <label>Sort by<select value={order} onChange={event => setOrder(event.target.value)}>
            <option value="case">Case</option><option value="attempts">Most attempts</option>
            <option value="mean">Fastest {metric} mean</option><option value="dnf">Highest DNF percentage</option>
          </select></label>
        </div>
        {unknown ? <p className="settings-note">{unknown} {unknown === 1 ? 'attempt' : 'attempts'} with unknown attribution appear only under By case.</p> : null}
        {matching.length ? (
          <div className="training-table-wrap training-stat-table" tabIndex={0} role="region" aria-label={`Statistics by ${tab}`}>
            <table>
              <thead><tr>
                <th scope="col">Case</th>
                {tab === 'algorithm' ? <th scope="col">Algorithm</th> : null}
                <th scope="col">{tab === 'algorithm' ? 'Attributed' : 'Attempts'}</th><th scope="col">Successful</th><th scope="col">DNF %</th>
                <th scope="col">{recognition ? 'Raw mean' : 'Mean'}</th><th scope="col">{recognition ? 'Raw best' : 'Best'}</th>
                {recognition ? <><th scope="col">Est. mean</th><th scope="col">Est. best</th></> : null}
                <th scope="col">Improvement</th>
              </tr></thead>
              <tbody>{matching.map(entry => (
                <tr key={entry.key}>
                  <th scope="row"><span className="training-table-case"><CaseDiagram caseId={entry.caseId} size={38} decorative /><span>{entry.name}</span></span></th>
                  {entry.algorithm ? (
                    <td className="training-stat-algorithm">
                      <code>{entry.algorithm.notation ?? 'Notation unavailable'}</code>
                      <small>{entry.source} · rev. {entry.algorithm.revision}<br />{entry.algorithm.id}</small>
                    </td>
                  ) : null}
                  <td>{entry.stats.recordedAttempts}{entry.assumed ? <small>{entry.assumed} assumed</small> : null}</td>
                  <td>{entry.stats.successfulAttempts}</td><td>{trainingPercentage(entry.stats.dnfPercentage)}</td>
                  <td>{trainingTime(entry.stats.raw.meanMs)}</td><td>{trainingTime(entry.stats.raw.bestMs)}</td>
                  {recognition ? <><td>{trainingTime(entry.stats.estimated?.meanMs ?? null)}</td><td>{trainingTime(entry.stats.estimated?.bestMs ?? null)}</td></> : null}
                  <td>{trainingPercentage(entry.improvement)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <p role="status">{entries.length ? 'No matches. Try another search or filter.' : 'No attempts with recorded algorithm attribution yet.'}</p>}
      </div>
      <p className="settings-note">Improvement compares the latest visit with its saved baseline for matching cases and algorithm revisions.</p>
    </TrainingDialog>
  )
}
