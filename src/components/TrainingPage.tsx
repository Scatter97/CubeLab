import { downloadTrainingRecovery } from './training/downloadTrainingRecovery'
import { useCallback, useLayoutEffect, useMemo, useState, type RefCallback } from 'react'
import type { Settings } from '../types'
import type { TimerController } from '../hooks/useTimer'
import type { TimerInput } from '../timer/machine'
import { trainingCategoryName, type TrainingController, type TrainingControllerState } from '../lib/training/controller'
import type { TrainingAttempt, TrainingCategoryId } from '../lib/training/types'
import { STANDARD_CASE_BY_ID } from '../lib/training/catalog/standardCases'
import { getTrainingDomainSettings } from '../lib/training/settings'
import { trainingOutcome } from '../lib/training/results'
import { availableAlgorithm } from '../lib/training/runtime'
import { compareTrainingAttempts, storedTrainingEstimate, type TrainingMetric } from '../lib/training/stats'
import {
  DEFAULT_TRAINING_STATISTICS, parseTrainingStatisticsPreferences, readTrainingPresentation, saveTrainingPresentation,
  readShowUpcomingCase, TRAINING_UPCOMING_CASE_KEY, TRAINING_SPLIT_KEY, TRAINING_STAT_BY_ID, TRAINING_STATISTICS_KEY, type TrainingStatId, type TrainingStatisticsPreferences,
} from '../lib/training/statisticsPreferences'
import { latestCategoryVisit } from '../lib/training/statisticsView'
import { activeTrainingSession } from '../lib/training/visits'
import { TimerStage } from './TimerStage'
import { ToolPanel } from './ToolPanel'
import { AppVersion } from './AppVersion'
import { DEFAULT_STATS_SPLIT, SidebarSplit } from './SidebarSplit'
import { CaseDiagram } from './training/CaseDiagram'
import { CaseSelectionDialog } from './training/CaseSelectionDialog'
import { TrainingStatistics } from './training/TrainingStatistics'
import { TrainingDetailedStatistics } from './training/TrainingDetailedStatistics'
import { TrainingTimingDetails } from './training/TrainingTimingDetails'
import { TrainingStatisticsSettings } from './training/TrainingStatisticsSettings'
import { TrainingAttempts } from './training/TrainingAttempts'
import { TrainingPreparation } from './training/TrainingPreparation'
import { CalibrationReview } from './training/CalibrationReview'
import { TrainingSaveRecovery, TrainingSaveRecoveryProvider } from './training/TrainingSaveRecovery'
import { TrainingSetup } from './training/TrainingSetup'
import { trainingTime } from '../lib/training/format'
import { TrainingSettingsDialog } from './training/TrainingSettingsDialog'
import { TrainingReportsDialog } from './training/TrainingReportsDialog'
import { AttemptDetailsDialog } from './training/AttemptDetailsDialog'

const EMPTY_ATTEMPTS: readonly TrainingAttempt[] = []
const ignoreToolSelection = () => {}

interface Props {
  controller: TrainingController
  state: TrainingControllerState
  timer: TimerController
  settings: Settings
  onPress: (input: TimerInput) => void
  onCancel: () => void
  onModalChange: (open: boolean) => void
  onNotify: (message: string) => void
  onDeleteAttempt: (id: string) => boolean
  toastHostRef?: RefCallback<HTMLDivElement>
  initialHistoryOpen?: boolean
  sessionFlow?: boolean
  onCloseHistory?: () => void
  onRequestEnd?: (anchor: HTMLButtonElement) => void
  lifecycleLocked?: boolean
}
export default function TrainingPage({ controller, state, timer, settings, onPress, onCancel, onModalChange, onNotify, onDeleteAttempt, toastHostRef, initialHistoryOpen, sessionFlow, onCloseHistory, onRequestEnd, lifecycleLocked }: Props) {
  const { data, category, setup, calibration, sample } = state
  const [dialog, setDialog] = useState<'cases' | 'settings' | 'reports' | 'statistics' | 'customize' | null>(initialHistoryOpen ? 'reports' : null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [timingId, setTimingId] = useState<TrainingStatId | null>(null)
  const [showUpcomingCase, setShowUpcomingCase] = useState(readShowUpcomingCase)
  const [minimizedResultId, setMinimizedResultId] = useState<string | null>(null)
  const [statisticsByCategory, setStatisticsByCategory] = useState(() =>
    parseTrainingStatisticsPreferences(readTrainingPresentation(TRAINING_STATISTICS_KEY)))
  const [split, setSplit] = useState(() => {
    const stored = Number(readTrainingPresentation(TRAINING_SPLIT_KEY))
    return stored >= 5 && stored <= 95 ? stored : DEFAULT_STATS_SPLIT
  })
  const savedData = state.pendingSave ? controller.getSavedData() : data
  const currentSession = activeTrainingSession(savedData)
  const currentSessionId = currentSession ? String(currentSession.id) : undefined
  const session = currentSession?.session
  const setId = category ? (category.startsWith('oll:') ? 'oll' : 'pll') : data?.preferences.selectedSetId ?? 'oll'
  const prefs = data?.preferences.sets[setId]
  const selectedCategory: TrainingCategoryId = `${setId}:${prefs?.includeSetupMoves ? 'recognition' : 'execution'}`
  const displayedCategory = category ?? selectedCategory
  const savedMetric = data?.preferences.categories[displayedCategory].recognitionMetric ?? 'raw'
  const preferences = useMemo(() => statisticsByCategory[displayedCategory] ?? {
    ...DEFAULT_TRAINING_STATISTICS, metric: savedMetric,
  }, [displayedCategory, savedMetric, statisticsByCategory])
  const active = timer.state.status !== 'idle'
  const running = timer.state.status === 'running'
  const locked = active || state.pendingSave || state.needsContinuity
  const records = savedData?.attempts ?? EMPTY_ATTEMPTS
  const attempts = useMemo(() => records.filter(attempt => attempt.categoryId === displayedCategory &&
    (currentSessionId ? attempt.visitId === currentSessionId : !sessionFlow)).sort(compareTrainingAttempts),
  [displayedCategory, records, currentSessionId, sessionFlow])
  const eligible = useMemo(() => data && prefs ? prefs.enabledCaseIds.filter(id => availableAlgorithm(data, id)).length : 0,
    [data, prefs])
  const newestFirst = useMemo(() => attempts.toReversed(), [attempts])
  const last = useMemo(() => sessionFlow ? attempts.at(-1) : records.find(attempt => attempt.id === state.lastResultId),
    [sessionFlow, attempts, records, state.lastResultId])
  const detail = useMemo(() => records.find(attempt => attempt.id === detailId), [detailId, records])
  if (detailId && !detail) setDetailId(null)
  const timing = timingId ? TRAINING_STAT_BY_ID.get(timingId) : undefined
  const modalOpen = dialog !== null || detail !== undefined || timing !== undefined
  useLayoutEffect(() => { onModalChange(modalOpen) }, [modalOpen, onModalChange])
  useLayoutEffect(() => () => onModalChange(false), [onModalChange])

  const correctAttempt = useCallback((id: string, outcome: 'success' | 'dnf') => {
    controller.correctResult(id, outcome)
    if (controller.getSnapshot().pendingSave) setDetailId(id)
  }, [controller])
  const deleteAttempt = useCallback((id: string) => {
    const deleted = onDeleteAttempt(id)
    if (!deleted && controller.getSnapshot().pendingSave) setDetailId(id)
    return deleted
  }, [controller, onDeleteAttempt])

  const customize = useCallback(() => setDialog('customize'), [])
  const showStatistics = useCallback(() => setDialog('statistics'), [])
  const updateStatistics = useCallback((next: TrainingStatisticsPreferences) => {
    const updated = { ...statisticsByCategory, [displayedCategory]: next }
    setStatisticsByCategory(updated)
    saveTrainingPresentation(TRAINING_STATISTICS_KEY, updated)
  }, [displayedCategory, statisticsByCategory])
  const changeMetric = useCallback((metric: TrainingMetric) =>
    updateStatistics({ ...preferences, metric }), [preferences, updateStatistics])
  const resizeSidebar = useCallback((percent: number) => {
    setSplit(percent)
    saveTrainingPresentation(TRAINING_SPLIT_KEY, percent)
  }, [])

  if (!data || !prefs) return (
    <main className="training-unavailable">
      <h1>Training unavailable</h1><p role="alert">{state.error}</p>
      <p>You can still use Timer.</p>
      <button type="button" className="button button-secondary" onClick={controller.retrySave}>Retry</button>
      <button type="button" className="button button-secondary" onClick={() => downloadTrainingRecovery(controller)}>Download recovery copy</button>
    </main>
  )
  const result = sample !== null ? { rawMs: sample, penalty: 'none' as const }
    : !calibration && last ? { rawMs: last.rawMs, penalty: trainingOutcome(last.result) === 'dnf' ? 'dnf' as const : 'none' as const } : null
  const ready = !locked && !lifecycleLocked && (calibration ? calibration.status === 'collecting' && sample === null : Boolean(setup && data.activeVisitId))
  const visit = sessionFlow ? currentSession : latestCategoryVisit(savedData?.visits ?? [], displayedCategory)
  const visitCount = visit && visit.id === savedData?.activeVisitId ? visit.attemptIds.length : null
  const retryCategory = last ? `${last.setId}:execution` : null
  const canRetry = last && (session ? session.cases.some(choice => choice.caseId === last.caseId)
    : data.preferences.sets[last.setId].enabledCaseIds.includes(last.caseId) && availableAlgorithm(data, last.caseId))
  const canPrepare = (session?.cases.length ?? eligible) >= (displayedCategory.endsWith(':recognition') ? 2 : 1)
  const trim = getTrainingDomainSettings(data.preferences).trimPercent
  const changePreview = (value: boolean) => {
    if (!saveTrainingPresentation(TRAINING_UPCOMING_CASE_KEY, value)) return false
    setShowUpcomingCase(value)
    return true
  }
  const recovery = state.pendingSave ? {
    error: state.error, retry: controller.retrySave, download: () => downloadTrainingRecovery(controller),
  } : null
  const showTimer = !sessionFlow || Boolean(category && session) || Boolean(calibration)
  return <TrainingSaveRecoveryProvider recovery={recovery}><main className="workspace training-workspace">
    <h1 className="sr-only">CubeLab Training</h1>
    <div className="primary-column">
      {modalOpen ? null : <TrainingSaveRecovery />}
      {showTimer ? <><TrainingPreparation state={state} controller={controller} setId={setId} selectedCategory={displayedCategory}
        locked={locked} eligible={canPrepare} showUpcomingCase={showUpcomingCase} />
      <TimerStage
        state={timer.state}
        eventLabel="Training"
        timerUpdateMode={settings.timerUpdateMode}
        inspectionElapsedMs={null}
        holdProgress={timer.holdProgress}
        latestResult={result}
        disabled={!ready && !active}
        disabledHint={state.pendingSave ? 'Retry saving Training changes.' : sample !== null ? 'Review the calibration sample.'
          : state.preparing ? 'Preparing setup…' : !canPrepare ? 'Edit cases to continue.'
          : data.activeVisitId ? 'Prepare a setup to continue.' : category ? 'Resume practice.' : 'Begin practice.'}
        inspectionEnabled={false}
        inspectionCountDirection="down"
        showTimerDecimalSmall={settings.showTimerDecimalSmall}
        onPress={onPress}
        onRelease={timer.release}
        onCancel={onCancel}
        overlay={calibration ? <CalibrationReview state={state} controller={controller} active={active} locked={locked} /> : last ? (
          <ToolPanel
            event="333"
            scramble={null}
            mode="net"
            activeTool="drawScramble"
            onSelectTool={ignoreToolSelection}
            panelId="training-last-result"
            title="Last Result"
            timerActive={running}
            minimized={running || minimizedResultId === last.id}
            onToggleMinimized={() => setMinimizedResultId(id => id === last.id ? null : last.id)}
          >
            <div className="training-last-content" data-timer-space-ignore>
              <CaseDiagram caseId={last.caseId} size={64} decorative />
              <div>
                <strong>{STANDARD_CASE_BY_ID.get(last.caseId)?.name}</strong>
                <p className="training-last-time">{trainingOutcome(last.result) === 'dnf' ? `DNF · Raw ${trainingTime(last.rawMs)}` : `Raw ${trainingTime(last.rawMs)}`}
                  {last.mode === 'recognition' && storedTrainingEstimate(last) !== null ? ` · Est. ${trainingTime(storedTrainingEstimate(last))}` : ''}
                </p>
                {last.attribution.kind === 'unknown' ? <p>Algorithm unknown</p> : (
                  <>
                    <p>{last.attribution.kind === 'assumed-preferred' ? 'Preferred algorithm (assumed)' : 'Corrected algorithm'}</p>
                    {last.attribution.algorithm.notation ? <p className="training-notation">{last.attribution.algorithm.notation}</p> : null}
                  </>
                )}
              </div>
              <div className="training-actions">
                {!sessionFlow || last.mode === 'execution' ? <button type="button" className="button button-secondary button-small" disabled={locked || !canRetry}
                  title={canRetry ? undefined : 'Enable this case in Edit cases to retry it.'}
                  onClick={() => { setMinimizedResultId(null); void controller.retryCase(last.caseId) }}>
                  {displayedCategory === retryCategory ? 'Retry case' : `Retry in ${last.setId.toUpperCase()} execution`}
                </button> : null}
                <button type="button" className="button button-secondary button-small" disabled={locked}
                  aria-pressed={data.preferences.sets[last.setId].difficultCaseIds.includes(last.caseId)}
                  onClick={() => controller.toggleDifficult(last.caseId)}>Mark difficult</button>
                <button type="button" className="button button-secondary button-small" disabled={locked}
                  onClick={() => setDetailId(last.id)}>Attempt details</button>
              </div>
            </div>
          </ToolPanel>
        ) : null}
      />
      <div className="session-caption">
        <span>{setId.toUpperCase()} · {displayedCategory.endsWith(':recognition') ? 'Recognition' : 'Execution'}</span>
        {visitCount !== null ? <span className="session-footer-summary">{visitCount} {visitCount === 1 ? 'attempt' : 'attempts'} this {sessionFlow ? 'session' : 'visit'}</span> : null}
        <AppVersion />
      </div></> : null}
    </div>
    {showTimer && (!sessionFlow || session) ? <aside className="side-column training-sidebar" aria-label="Training controls and insights">
      {session ? <section className="panel session-panel training-controls" aria-label="Current session">
        <div className="panel-heading"><h2>Current session</h2></div>
        <p><strong>{session.name}</strong></p>
        <p className="training-muted">{trainingCategoryName(displayedCategory)} · {session.cases.length} {session.cases.length === 1 ? 'case' : 'cases'}</p>
        <div className="training-actions">
          <button type="button" className="text-button" disabled={locked} onClick={() => setDialog('settings')}>Training settings</button>
          <button type="button" className="button button-secondary button-small" disabled={locked}
            onClick={event => onRequestEnd?.(event.currentTarget)}>End session</button>
        </div>
      </section> : <TrainingSetup data={data} state={state} controller={controller} eligible={eligible} locked={locked}
        openCases={() => setDialog('cases')} openSettings={() => setDialog('settings')} openReports={() => setDialog('reports')} />}
      <SidebarSplit historyLabel="Attempts" percent={split} onPercentChange={resizeSidebar}
        statistics={layout => (
          <TrainingStatistics attempts={attempts} category={displayedCategory} trim={trim} preferences={preferences}
            difficult={prefs.difficultCaseIds} visit={preferences.visible.includes('improvement') ? visit : undefined} locked={locked}
            onChangeMetric={changeMetric} onConfigure={customize} onDetails={showStatistics} onTimingDetails={setTimingId} {...layout} />
        )}>
        <TrainingAttempts key={displayedCategory} attempts={newestFirst} selectedId={detailId} locked={locked}
          showEstimated={preferences.metric === 'estimated'} onOpen={setDetailId}
          onCorrectResult={correctAttempt} onDelete={deleteAttempt} onNotify={onNotify} />
      </SidebarSplit>
    </aside> : null}
    {dialog === 'statistics' ? <TrainingDetailedStatistics data={data} attempts={attempts} category={displayedCategory}
      metric={preferences.metric} visit={visit} onClose={() => setDialog(null)} /> : null}
    {dialog === 'customize' ? <TrainingStatisticsSettings category={displayedCategory} preferences={preferences}
      onChange={updateStatistics} onClose={() => setDialog(null)} /> : null}
    {timing && 'size' in timing ? <TrainingTimingDetails label={timing.label} size={timing.size} trim={timing.size > 3 ? trim : 0}
      metric={preferences.metric} attempts={attempts} onClose={() => setTimingId(null)} /> : null}
    {dialog === 'cases' ? <CaseSelectionDialog data={savedData ?? data} controller={controller} setId={setId} onClose={() => setDialog(null)} /> : null}
    {dialog === 'settings' ? <TrainingSettingsDialog data={data} setId={setId} controller={controller}
      showUpcomingCase={showUpcomingCase} onShowUpcomingCaseChange={changePreview}
      sessionFlow={sessionFlow} canRecalibrate={Boolean(!sessionFlow && category?.endsWith(':recognition') && !calibration && !locked)} onClose={() => setDialog(null)} /> : null}
    {dialog === 'reports' ? <TrainingReportsDialog data={savedData ?? data} controller={controller} onOpenAttempt={setDetailId} onClose={() => {
      setDialog(null)
      onCloseHistory?.()
    }} toastHostRef={toastHostRef} /> : null}
    {detail ? <AttemptDetailsDialog data={data} attempt={detail} controller={controller}
      locked={locked || Boolean(savedData?.visits.some(v => v.id === detail.visitId && v.session && v.endedAt !== null))}
      onDelete={deleteAttempt} onClose={() => setDetailId(null)} /> : null}
  </main></TrainingSaveRecoveryProvider>
}
