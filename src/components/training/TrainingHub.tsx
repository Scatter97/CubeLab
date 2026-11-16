import { downloadTrainingRecovery } from './downloadTrainingRecovery'
import { useMemo, useState } from 'react'
import { MAX_SESSION_NAME_LENGTH, suggestSessionName } from '../../lib/sessionNames'
import { availableAlgorithm } from '../../lib/training/algorithmSelection'
import { trainingCategoryName, type TrainingController } from '../../lib/training/controller'
import { trainingTime } from '../../lib/training/format'
import { trainingStatistics } from '../../lib/training/stats'
import type { TrainingAlgorithmOverrides, TrainingCaseId, TrainingData } from '../../lib/training/types'
import { CaseSelectionDialog } from './CaseSelectionDialog'
import { TrainingSetSelect } from './TrainingSetup'
import { selectedTrainingCasesLabel, trainingSelectionMessage } from './trainingSelectionPresentation'
import { readShowUpcomingCase, saveTrainingPresentation, TRAINING_UPCOMING_CASE_KEY } from '../../lib/training/statisticsPreferences'
import { TrainingSettingsDialog } from './TrainingSettingsDialog'
import { TrainingSaveRecovery, TrainingSaveRecoveryProvider } from './TrainingSaveRecovery'
import { trainingArchiveVisits } from '../../lib/training/archive'
import { TrainingArchiveRows } from './TrainingArchiveRows'

export default function TrainingHub({ data, controller, locked, error, onOpenHistory, onOpenAlgorithms, hidden, pendingSave }: {
  data: TrainingData
  controller: TrainingController
  locked: boolean
  error: string | null
  onOpenHistory: (id?: string) => void
  onOpenAlgorithms: () => void
  hidden: boolean
  pendingSave: boolean
}) {
  const [name, setName] = useState('')
  const [setId, setSetId] = useState(data.preferences.selectedSetId)
  const [sets, setSets] = useState(() => ({
    oll: data.preferences.sets.oll,
    pll: data.preferences.sets.pll,
  }))
  const [overrides, setOverrides] = useState<{ oll: TrainingAlgorithmOverrides; pll: TrainingAlgorithmOverrides }>({ oll: {}, pll: {} })
  const [dialog, setDialog] = useState<'cases' | 'settings' | null>(null)
  const [showUpcomingCase, setShowUpcomingCase] = useState(readShowUpcomingCase)
  const { includeSetupMoves, enabledCaseIds } = sets[setId]
  const mode = includeSetupMoves ? 'recognition' : 'execution'
  const categoryId = `${setId}:${mode}` as const
  const categoryName = trainingCategoryName(categoryId)
  const suggestion = useMemo(() => suggestSessionName(
    categoryName, data.visits.flatMap(visit => visit.session ? [visit.session.name] : []),
  ), [categoryName, data.visits])
  const stats = useMemo(() => trainingStatistics(data.attempts, { categoryId }, 0), [categoryId, data.attempts])
  const recent = useMemo(() => trainingArchiveVisits(data).filter(visit => visit.session).slice(0, 5), [data])
  const usableCount = useMemo(() => enabledCaseIds.filter(id => availableAlgorithm(data, id)).length,
    [data, enabledCaseIds])
  const selectionMessage = trainingSelectionMessage(enabledCaseIds.length, usableCount, includeSetupMoves)

  function applyCases(caseIds: readonly TrainingCaseId[], recognition: boolean, algorithmOverrides: TrainingAlgorithmOverrides) {
    setSets(previous => ({ ...previous, [setId]: { ...previous[setId], enabledCaseIds: caseIds, includeSetupMoves: recognition } }))
    setOverrides(previous => ({ ...previous, [setId]: algorithmOverrides }))
    setDialog(null)
  }

  const recovery = pendingSave ? { error, retry: controller.retrySave, download: () => downloadTrainingRecovery(controller) } : null
  return <TrainingSaveRecoveryProvider recovery={recovery}>
    <main className="training-hub" aria-labelledby="training-hub-title" hidden={hidden}>
      <div className="training-hub-content">
        <h1 id="training-hub-title">Training Hub</h1>
        {!dialog && !hidden ? <TrainingSaveRecovery /> : null}
        <div className="training-hub-grid">
          <section className="panel training-hub-panel" aria-labelledby="training-hub-setup-title">
            <h2 id="training-hub-setup-title">Session setup</h2>
            <label className="training-hub-field">
              Session name
              <input className="session-name-input training-select" value={name} placeholder={suggestion}
                maxLength={MAX_SESSION_NAME_LENGTH} onChange={event => {
                  const value = event.target.value
                  setName(value.trim() ? value : '')
                }} />
            </label>
            <div className="training-hub-category">
              <label className="training-hub-field">
                Algorithm set
                <TrainingSetSelect setId={setId} onChange={setSetId} />
              </label>
              <label className="training-hub-field">
                Practice type
                <select className="training-select" value={mode} aria-describedby="training-hub-mode-description"
                  onChange={event => {
                    const recognition = event.target.value === 'recognition'
                    setSets(previous => ({
                      ...previous, [setId]: { ...previous[setId], includeSetupMoves: recognition },
                    }))
                  }}>
                  <option value="execution">Execution</option>
                  <option value="recognition">Recognition</option>
                </select>
              </label>
            </div>
            <p className="training-muted" id="training-hub-mode-description">Recognition includes setup moves.</p>
            <div className="training-hub-cases">
              <span>{selectedTrainingCasesLabel(enabledCaseIds.length)}</span>
              <button type="button" className="button button-secondary" onClick={() => setDialog('cases')}>Edit cases</button>
            </div>
            {selectionMessage ? <p className="training-muted" role="status">{selectionMessage}</p> : null}
            <div className="training-hub-workspace">
              {error && !pendingSave ? <p role="alert">{error}</p> : null}
              <button type="button" className="button button-primary" disabled={locked || usableCount < (includeSetupMoves ? 2 : 1)}
                onClick={() => { void controller.beginSession({ name, categoryId, caseIds: enabledCaseIds, algorithmOverrides: overrides[setId] }) }}>Begin practice</button>
              <div className="training-actions">
                <button type="button" className="text-button" disabled={locked} onClick={() => setDialog('settings')}>Training settings</button>
              </div>
            </div>
          </section>
          <section className="panel training-hub-panel" aria-labelledby="training-hub-stats-title">
            <div className="training-hub-cases">
              <h2 id="training-hub-stats-title">{categoryName} statistics</h2>
              <button type="button" className="text-button" onClick={onOpenAlgorithms}>Algorithms</button>
            </div>
            <dl className="training-hub-stats">
              <div><dt>Attempts</dt><dd>{stats.recordedAttempts}</dd></div>
              <div><dt>Best raw time</dt><dd>{trainingTime(stats.raw.bestMs)}</dd></div>
              <div><dt>Mean raw time</dt><dd>{trainingTime(stats.raw.meanMs)}</dd></div>
              <div><dt>DNF rate</dt><dd>{stats.dnfPercentage === null ? '—' : `${stats.dnfPercentage.toFixed(1)}%`}</dd></div>
            </dl>
          </section>
        </div>
        <section className="panel training-hub-panel" aria-labelledby="training-hub-recent-title">
          <div className="training-hub-cases">
            <h2 id="training-hub-recent-title">Recent sessions</h2>
            <button type="button" className="text-button" aria-label="View all practice history" disabled={pendingSave}
              onClick={() => onOpenHistory()} data-training-focus-fallback>View all</button>
          </div>
          {recent.length ? <TrainingArchiveRows data={data} visits={recent} onReview={onOpenHistory} /> : <p className="training-muted">Completed sessions appear here.</p>}
        </section>
      </div>
      {dialog === 'cases' ? <CaseSelectionDialog data={data} setId={setId} controller={controller} onClose={() => setDialog(null)}
        draft={{ caseIds: enabledCaseIds, includeSetupMoves, algorithmOverrides: overrides[setId], onApply: applyCases }} /> : null}
      {dialog === 'settings' ? <TrainingSettingsDialog data={data} controller={controller} setId={setId}
        showUpcomingCase={showUpcomingCase} onShowUpcomingCaseChange={value => {
          if (!saveTrainingPresentation(TRAINING_UPCOMING_CASE_KEY, value)) return false
          setShowUpcomingCase(value)
          return true
        }} sessionFlow canRecalibrate={false} onClose={() => setDialog(null)} /> : null}
    </main>
  </TrainingSaveRecoveryProvider>
}
