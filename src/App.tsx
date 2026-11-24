import type { SessionsSnapshot, SettingsSnapshot } from './lib/storage'
import type {
  OnboardingBootstrap,
  OnboardingDraft,
  OnboardingMode,
} from './lib/onboarding'
import {
  clearOnboardingDraft,
  markOnboardingDecision,
} from './lib/onboarding'
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { AppHeader, type AppView } from './components/AppHeader'
import { ConfirmDialog } from './components/ConfirmDialog'
import { ScramblePanel } from './components/ScramblePanel'
import { ToolPanel } from './components/ToolPanel'
import { AnalyticsSkeleton, TrainingSkeleton } from './components/ContentSkeletons'
import { useDrawScrambleMode } from './hooks/useDrawScrambleMode'
import { SessionPanel } from './components/SessionPanel'
import { AppVersion } from './components/AppVersion'
import { LegalLinks } from './components/LegalLinks'
import { SessionSettingsDialog } from './components/SessionSettingsDialog'
import { SettingsDialog } from './components/SettingsDialog'
import { SolveHistory } from './components/SolveHistory'
import { StatsPanel } from './components/StatsPanel'
import { DEFAULT_STATS_SPLIT, SidebarSplit } from './components/SidebarSplit'
import { TimerStage } from './components/TimerStage'
import { Toast } from './components/Toast'
import { useScramble } from './hooks/useScramble'
import { useSessions } from './hooks/useSessions'
import { useSettings } from './hooks/useSettings'
import { useTheme } from './hooks/useTheme'
import { useToolPanelOpen } from './hooks/useToolPanelOpen'
import { useCurrentTool } from './hooks/useCurrentTool'
import { readShowUpcomingCase, saveTrainingPresentation, TRAINING_UPCOMING_CASE_KEY } from './lib/training/statisticsPreferences'
import type { TrainingDomainSettings, TrainingSetId } from './lib/training/types'
import { useTraining } from './hooks/useTraining'
import { useTrainingSync } from './hooks/useTrainingSync'
import { activeTrainingSession } from './lib/training/visits'
import { TrainingEndConfirmation } from './components/training/TrainingEndConfirmation'
import { downloadTrainingRecovery } from './components/training/downloadTrainingRecovery'
import type { TrainingArchiveRequest } from './components/training/TrainingArchive'
import { useTimer } from './hooks/useTimer'
import { usePostPaintValue } from './hooks/usePostPaintValue'
import { useToast } from './hooks/useToast'
import { SessionSetupDialog } from './components/SessionSetupDialog'
import { RoundSummaryDialog } from './components/competition/RoundSummaryDialog'
import { useSync } from './hooks/useSync'
import { useDurableReplacement } from './hooks/useDurableReplacement'
import {
  inspectionWarningEvents,
  playAlertSound,
  primeAlertAudio,
  vibrateAlert,
  type AlertTone,
} from './lib/alerts'
import {
  createBackup,
  type Backup,
} from './lib/backup'
import { preparePortableBackupExport } from './lib/portableBackup'
import { summarizeTrainingData } from './lib/training/backupSection'
import { stageTrainingSnapshot } from './lib/training/storage'
import {
  clearTrainingSyncProvenance,
  loadTrainingSyncStorage,
} from './lib/trainingSyncStorage'
import { getEventLabel, isUnscrambledEvent } from './lib/events'
import { formatSessionHours, formatSolveCount, formatStatValue, formatTime } from './lib/format'
import { countSolves, getSessionMergeError, getSessionSummary, appendSessionsInOrder, isUntouchedDefaultSession } from './lib/sessions'
import { getSessionStats } from './lib/stats'
import {
  getCompetitionRounds,
  isCompetitionSession,
  type CompetitionRound,
} from './lib/competition'
import { createDriveTransport } from './lib/driveTransport'
import {
  beginSiteResetGate,
  createFailedSiteResetResult,
  createSiteResetRunId,
  isSiteResetInProgress,
  publishSiteResetSignal,
  resetSiteStorage,
  subscribeToSiteReset,
  waitForSyncIdle,
  type SiteResetSignal,
  type SiteResetStorageResult,
} from './lib/siteReset'
import { loadDriveBackupState } from './lib/driveStorage'
import { requestStoragePersistence } from './lib/storagePersistence'
import { loadSyncStorage, loadSyncStorageChecked } from './lib/syncStorage'
import {
  addPendingSolveRestore,
  applyPendingSolveRestores,
  createPendingSolveRestore,
  loadSolveRecoveryChecked,
  removePendingSolveRestore,
} from './lib/solveRecovery'
import {
  loadReplacementJournal,
  pendingReplacementMessage,
  recoverPendingReplacement,
} from './lib/replacement'
import {
  createAdditiveImportSyncStorage,
  createResetBaseSyncStorage,
} from './lib/syncBase'
import { BUILT_IN_STAT_DEFINITIONS } from './lib/statDefinitions'
import type {
  AlertChannel,
  CompetitionFormat,
  Penalty,
  PuzzleEvent,
  SessionPreferences,
  Session,
  SessionsData,
  Settings,
} from './types'
import type { TimerInput, TimerState } from './timer/machine'

interface ConfirmContent {
  eyebrow: string
  title: string
  description: ReactNode
  details?: ReactNode
  cancelLabel: string
  confirmLabel: string
  requireText?: string
  onConfirm: () => void
}

const TrainingPage = lazy(() => import('./components/TrainingPage'))
const TrainingHub = lazy(() => import('./components/training/TrainingHub'))
const TrainingLifecycleDialog = lazy(() => import('./components/training/TrainingLifecycleDialog'))
const TrainingArchive = lazy(() => import('./components/training/TrainingArchive'))
const AnalyticsPage = lazy(() => import('./components/AnalyticsPage'))
const AlgorithmsAnalytics = lazy(() => import('./components/training/AlgorithmsAnalytics'))
const DataDialog = lazy(() =>
  import('./components/DataDialog').then((module) => ({
    default: module.DataDialog,
  })),
)
const DriveBackupDialog = lazy(() =>
  import('./components/DriveBackupDialog').then((module) => ({
    default: module.DriveBackupDialog,
  })),
)
const MergeSessionsDialog = lazy(() =>
  import('./components/MergeSessionsDialog').then((module) => ({
    default: module.MergeSessionsDialog,
  })),
)
const SplitSessionDialog = lazy(() =>
  import('./components/SplitSessionDialog').then((module) => ({
    default: module.SplitSessionDialog,
  })),
)
const Onboarding = lazy(() =>
  import('./components/Onboarding').then((module) => ({
    default: module.Onboarding,
  })),
)

function DialogLoadingFallback() {
  return (
    <div className="dialog-loading-overlay" role="status" aria-live="polite">
      <span>Loading dialog…</span>
    </div>
  )
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('input, textarea, [contenteditable="true"]') !== null
  )
}

/**
 * Disclosure summaries and custom combobox/listbox controls use Space to
 * activate their own UI, so they must not start or stop the timer. Native
 * selects, buttons and switches keep the established Space-for-timing boundary
 * because Enter/arrows still operate them and existing timer flows rely on a
 * focused session select not blocking timing.
 */
function isSpaceControlTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest(
      'summary, [role="combobox"], [role="listbox"], [role="option"], [data-timer-space-ignore]',
    ) !== null
  )
}

function isModifierKey(key: string): boolean {
  return (
    key === 'Shift' ||
    key === 'Control' ||
    key === 'Alt' ||
    key === 'Meta' ||
    key === 'CapsLock' ||
    key === 'NumLock' ||
    key === 'ScrollLock'
  )
}

function activeInspectionStartedAt(state: TimerState): number | null {
  if (state.status === 'inspection') return state.inspectionStartedAt
  if (state.status === 'holding' || state.status === 'ready') {
    return state.inspectionStartedAt
  }
  return null
}

interface TimerAlert {
  tone: AlertTone
  id: number
  message?: string
  visualTone?: AlertTone
}

function downloadFile(contents: BlobPart, fileName: string, type: string): void {
  const blob = new Blob([contents], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

const trainingDateFormatter = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
})

const trainingCountFormatter = new Intl.NumberFormat('en-US')

function formatTrainingCount(count: number): string {
  return trainingCountFormatter.format(count)
}

function formatTrainingAttemptRange(first: number | null, last: number | null): string {
  if (first === null || last === null) return ''
  const from = trainingDateFormatter.format(new Date(first))
  const to = trainingDateFormatter.format(new Date(last))
  return from === to ? ` on ${from}` : ` from ${from} to ${to}`
}

export default function App({ initialSessions, initialSettings, initialOnboarding }: { initialSessions?: SessionsSnapshot; initialSettings?: SettingsSnapshot; initialOnboarding?: OnboardingBootstrap } = {}) {
  const [onboarding, setOnboarding] = useState<{
    mode: OnboardingMode
    draft?: OnboardingDraft
  } | null>(() =>
    initialOnboarding?.show
      ? {
          mode: initialOnboarding.mode,
          ...(initialOnboarding.draft ? { draft: initialOnboarding.draft } : {}),
        }
      : null,
  )
  const onboardingRef = useRef(onboarding)
  useLayoutEffect(() => {
    onboardingRef.current = onboarding
  }, [onboarding])
  const {
    sessions,
    customEvents,
    sessionOrder,
    sessionTransfers,
    activeSession,
    activeSessionId,
    storageOk,
    addSolve,
    setPenalty,
    setComment,
    setInspection,
    deleteSolve,
    restoreSolve,
    clearSolves,
    resetAllSolveData,
    createSession,
    convertSessionToPractice,
    renameSession,
    deleteSession,
    selectSession,
    setSessionEvent,
    mergeSessions,
    splitSession,
    moveSessionTo,
    deleteAllSessions,
    replaceSessions,
    stageSessions,
  } = useSessions(initialSessions)
  const solves = activeSession.solves
  const totalSolveCount = useMemo(() => countSolves(sessions), [sessions])
  // Only presentation may lag. Storage, the final readout and sync receive
  // current data; switching sessions must never show another session's solves.
  const deferredSession = usePostPaintValue(activeSession)
  const insightSolves = deferredSession.id === activeSession.id ? deferredSession.solves : solves
  const activeEvent = activeSession.event ?? '333'
  // The selector lists every session. A session's event is its own property,
  // not a filter for session visibility.
  const visibleSessions = sessions
  const {
    settings,
    settingsStorageOk,
    updateSettings,
    replaceSettings,
    stageSettings,
    setTimerActive: setSettingsTimerActive,
    adoptedFieldsRef: adoptedSettingsFieldsRef,
  } = useSettings(initialSettings)
  const storageHealthy = storageOk && settingsStorageOk
  const resolvedTheme = useTheme(settings.theme, settings.appearance)
  const training = useTraining()
  const [trainingShowUpcomingCase, setTrainingShowUpcomingCase] = useState(() =>
    readShowUpcomingCase(),
  )
  const handleTrainingUpcomingCaseChange = useCallback((value: boolean) => {
    if (!saveTrainingPresentation(TRAINING_UPCOMING_CASE_KEY, value)) return false
    setTrainingShowUpcomingCase(value)
    return true
  }, [])
  const handleUpdateTrainingSettings = useCallback(
    (
      domain: TrainingDomainSettings,
      renewals: Record<
        TrainingSetId,
        { renewalDays: number; renewalAttempts: number }
      >,
    ) => {
      return training.controller.updateGlobalSettings(domain, renewals)
    },
    [training.controller],
  )
  const [view, setView] = useState<AppView>(() => {
    try {
      const previous = sessionStorage.getItem('cubelab:view:v1')
      if (previous === 'training' || (previous === 'analytics' && activeTrainingSession(training.controller.getSavedData()))) return previous
    } catch { /* use the default view */ }
    return 'timer'
  })
  const [analyticsMode, setAnalyticsMode] = useState<'solves' | 'algorithms'>('solves')
  const [analyticsOpened, setAnalyticsOpened] = useState(() => ({ solves: view === 'analytics', algorithms: false }))
  const showAnalyticsMode = useCallback((mode: 'solves' | 'algorithms') => {
    setAnalyticsMode(mode)
    setAnalyticsOpened(previous => previous[mode] ? previous : { ...previous, [mode]: true })
  }, [])
  const {
    scramble,
    isLoading: scrambleLoading,
    error: scrambleError,
    recoveryRequired: scrambleRecoveryRequired,
    advance: advanceScramble,
    retry: retryScramble,
  } = useScramble(activeEvent, view === 'timer')
  const { toast, showToast, dismissToast } = useToast()
  const [trainingToastHost, setTrainingToastHost] = useState<HTMLDivElement | null>(null)
  const driveTransport = useMemo(() => createDriveTransport(), [])

  const [clearOpen, setClearOpen] = useState(false)
  const [resetAllOpen, setResetAllOpen] = useState(false)
  const [resetAwaitingSync, setResetAwaitingSync] = useState(false)
  const [deleteAllOpen, setDeleteAllOpen] = useState(false)
  const [deleteAllAwaitingSync, setDeleteAllAwaitingSync] = useState(false)
  const [driveOpen, setDriveOpen] = useState(false)
  const [pendingDriveRestore, setPendingDriveRestore] = useState<Backup | null>(null)
  const [sessionToDelete, setSessionToDelete] = useState<Session | null>(null)
  const [convertToPracticeOpen, setConvertToPracticeOpen] = useState(false)
  const [roundSummary, setRoundSummary] = useState<CompetitionRound | null>(null)
  const seenRoundCompletionRef = useRef(
    new Map<string, { id: string; complete: boolean }>(),
  )
  const [pendingImport, setPendingImport] = useState<Backup | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [siteResetOpen, setSiteResetOpen] = useState(false)
  const [siteResetPhase, setSiteResetPhase] = useState<
    'idle' | 'resetting' | 'failed'
  >('idle')
  const [siteResetResult, setSiteResetResult] =
    useState<SiteResetStorageResult | null>(null)
  const [remoteSiteReset, setRemoteSiteReset] = useState<
    'begin' | 'failed' | null
  >(null)
  const siteResetRunIdRef = useRef<string | null>(null)
  const [currentTool, setCurrentTool] = useCurrentTool()
  const savedTrainingData = training.controller.getSavedData()
  const trainingBackupSnapshot = training.controller.getBackupSnapshot()
  const savedTrainingSession = activeTrainingSession(savedTrainingData)
  const trainingWorkspace = Boolean(training.state.category)
  const requiredReport = !savedTrainingData?.activeVisitId ? savedTrainingData?.visits.findLast(visit => visit.session && visit.lifecycle?.reportPending) : undefined
  const [trainingEndRequest, setTrainingEndRequest] = useState<{ anchor: HTMLButtonElement; destination: AppView } | null>(null)
  const trainingIdle = training.state.idlePrompt !== null
  const trainingLifecycleLocked = Boolean(requiredReport || trainingIdle || trainingEndRequest)
  const [trainingArchive, setTrainingArchive] = useState<TrainingArchiveRequest | null>(null)
  const [trainingModalOpen, setTrainingModalOpen] = useState(false)
  const [toolPanelOpen, setToolPanelOpen] = useToolPanelOpen()
  const [drawScrambleMode, setDrawScrambleMode] = useDrawScrambleMode()
  const [sessionSettingsOpen, setSessionSettingsOpen] = useState(false)

  const [mergeSessionsOpen, setMergeSessionsOpen] = useState(false)
  const [mergeInitialTargetId, setMergeInitialTargetId] = useState<
    string | null
  >(null)
  const [mergeOpenedFromSettings, setMergeOpenedFromSettings] =
    useState(false)
  const [splitSessionId, setSplitSessionId] = useState<string | null>(null)
  const [createSessionOpen, setCreateSessionOpen] = useState(false)
  const createSessionOpenPrev = useRef(false)

  const [dataOpen, setDataOpen] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const [timerAlert, setTimerAlert] = useState<TimerAlert | null>(null)
  const scrambleRef = useRef(scramble)
  const alertIdRef = useRef(0)
  const alertTimeoutRef = useRef<number | null>(null)
  const inspectionWarningRef = useRef<{
    startedAt: number | null
    warned: Record<'8s' | '12s', boolean>
  }>({
    startedAt: null,
    warned: { '8s': false, '12s': false },
  })

  useEffect(() => {
    scrambleRef.current = scramble
  }, [scramble])

  useEffect(
    () => () => {
      if (alertTimeoutRef.current !== null) {
        window.clearTimeout(alertTimeoutRef.current)
      }
    },
    [],
  )

  const triggerAlert = useCallback(
    (
      tone: AlertTone,
      channel: AlertChannel,
      volume: number,
      message?: string,
      forceVisual = false,
      visualTone?: AlertTone,
    ) => {
      if (channel !== 'off') {
        if (channel.includes('sound')) playAlertSound(tone, volume)
        if (channel.includes('haptic')) vibrateAlert(tone)
      }
      if (!forceVisual && !channel.includes('visual')) return

      alertIdRef.current += 1
      setTimerAlert({ tone, id: alertIdRef.current, message, visualTone })
      if (alertTimeoutRef.current !== null) {
        window.clearTimeout(alertTimeoutRef.current)
      }
      const duration = message ? 1_600 : tone === 'warning' ? 900 : 650
      alertTimeoutRef.current = window.setTimeout(
        () => setTimerAlert(null),
        duration,
      )
    },
    [],
  )

  const handleSolve = useCallback(
    (completion: { rawMs: number; penalty: Penalty }) => {
      const activeScramble = scrambleRef.current
      if (!activeScramble) return

      addSolve(
        {
          rawMs: completion.rawMs,
          penalty: completion.penalty,
          scramble: activeScramble,
        },
        activeEvent,
      )

      if (completion.penalty === 'dnf') {
        setAnnouncement('Solve recorded. DNF.')
      } else if (completion.penalty === '+2') {
        setAnnouncement(
          `Solve recorded. ${formatTime(completion.rawMs + 2_000)}, plus two.`,
        )
      } else {
        setAnnouncement(`Solve recorded. ${formatTime(completion.rawMs)}.`)
      }

      triggerAlert(
        completion.penalty === 'dnf' ? 'danger' : 'success',
        settings.alertChannel,
        settings.alertVolume,
      )
      advanceScramble()
      // Ask after the accepted solve has been scheduled and never block the
      // timing path on a browser permission API.
      void requestStoragePersistence().catch(() => undefined)
    },
    [
      addSolve,
      advanceScramble,
      activeEvent,
      settings.alertChannel,
      settings.alertVolume,
      triggerAlert,
    ],
  )

  const activeInspectionEnabled =
    activeSession.inspectionEnabled ??
    activeSession.preferences?.inspectionEnabled ??
    settings.inspectionEnabled
  const effectiveSettings = {
    ...settings,
    inspectionEnabled: activeInspectionEnabled,
    inspectionCountDirection:
      activeSession.preferences?.inspectionCountDirection ??
      settings.inspectionCountDirection,
    inspectionWarning8s:
      activeSession.preferences?.inspectionWarning8s ?? settings.inspectionWarning8s,
    inspectionWarning12s:
      activeSession.preferences?.inspectionWarning12s ?? settings.inspectionWarning12s,
    inspectionWarningVisualScope:
      activeSession.preferences?.inspectionWarningVisualScope ??
      settings.inspectionWarningVisualScope,
    timerUpdateMode:
      activeSession.preferences?.timerUpdateMode ?? settings.timerUpdateMode,
    holdDurationMs:
      activeSession.preferences?.holdDurationMs ?? settings.holdDurationMs,
    stopWithAnyKey:
      activeSession.preferences?.stopWithAnyKey ?? settings.stopWithAnyKey,
    showTimerDecimalSmall:
      activeSession.preferences?.showTimerDecimalSmall ??
      settings.showTimerDecimalSmall,
    scrambleAlignment:
      activeSession.preferences?.scrambleAlignment ?? settings.scrambleAlignment,
    scrambleLimitHeight:
      activeSession.preferences?.scrambleLimitHeight ??
      settings.scrambleLimitHeight,
    scrambleAction:
      activeSession.preferences?.scrambleAction ?? settings.scrambleAction,
  }

  const timer = useTimer({
    inspectionEnabled: view === 'training' ? false : activeInspectionEnabled,
    holdDurationMs: view === 'training' ? settings.holdDurationMs : effectiveSettings.holdDurationMs,
    onStart: view === 'training' ? training.controller.beginAttempt : undefined,
    onSolve: (completion) => {
      if (view === 'training') {
        const outcome = training.controller.completeAttempt(completion.rawMs)
        setAnnouncement(outcome === 'sample' ? `Sample ${formatTime(completion.rawMs)}. Review to keep or retry.`
          : outcome === 'saved' ? `Attempt recorded. ${formatTime(completion.rawMs)}.` : '')
      } else handleSolve(completion)
    },
  })
  const timerStatusRef = useRef(timer.state.status)
  useLayoutEffect(() => {
    timerStatusRef.current = timer.state.status
    training.controller.setTimerActive(timer.state.status !== 'idle')
    setSettingsTimerActive(timer.state.status !== 'idle')
  }, [timer.state.status, setSettingsTimerActive, training.controller])

  const handleDeleteTrainingAttempt = useCallback((id: string) => {
    if (timerStatusRef.current !== 'idle') return false
    const controller = training.controller
    const saved = controller.deleteAttempt(id, deleted => {
      const undo = () => {
        const { pendingSave, needsContinuity } = controller.getSnapshot()
        const blocked = timerStatusRef.current !== 'idle' ? 'Finish timing to undo'
          : pendingSave ? 'Retry the pending Training save before undoing'
            : needsContinuity ? 'Resolve the Training visit before undoing' : null
        if (blocked) {
          showToast({ message: blocked, actionLabel: 'Undo', onAction: undo })
          return
        }
        const restored = controller.undoDeleteAttempt(deleted, () => showToast({ message: 'Attempt restored' }))
        if (!restored && !controller.getSnapshot().pendingSave) showToast({ message: 'Could not restore attempt' })
      }
      showToast({ message: 'Attempt deleted', actionLabel: 'Undo', onAction: undo })
    })
    if (!saved && !controller.getSnapshot().pendingSave) showToast({ message: 'Could not delete attempt' })
    return Boolean(saved)
  }, [showToast, training.controller])

  const syncSessionsData = useMemo(
    () => ({
      activeSessionId,
      sessions,
      ...(customEvents.length > 0 ? { customEvents } : {}),
      ...(sessionOrder ? { sessionOrder } : {}),
      ...(sessionTransfers ? { sessionTransfers } : {}),
    }),
    [activeSessionId, sessions, customEvents, sessionOrder, sessionTransfers],
  )

  const handleNotify = useCallback(
    (message: string) => {
      if (onboardingRef.current) return
      showToast({ message })
    },
    [showToast],
  )

  const trainingImportBlockedReason = useCallback((): string | null => {
    if (loadTrainingSyncStorage().preferences.enabled) {
      return 'Training Drive sync is enabled. Disable it before importing or restoring a native Training backup so a replace-only restore cannot race an automatic merge.'
    }
    if (training.state.pendingSave) {
      return 'A Training save is pending. Retry the save or download a recovery copy first.'
    }
    if (training.state.needsContinuity) {
      return 'Training is waiting for a resume or end decision. Open Training and choose Resume session or End session first.'
    }
    if (training.state.data?.activeVisitId) {
      return 'An active Training session is open. Finish or end it before importing Training history.'
    }
    return null
  }, [
    training.state.data?.activeVisitId,
    training.state.needsContinuity,
    training.state.pendingSave,
  ])

  const sync = useSync({
    transport: driveTransport,
    sessions: syncSessionsData,
    settings,
    storageOk: storageOk && settingsStorageOk,
    timerActive: timer.state.status !== 'idle',
    onReplaceSessions: replaceSessions,
    onReplaceSettings: replaceSettings,
    adoptedSettingsFieldsRef,
    onNotify: handleNotify,
    onDuplicateSessionDetected: (names, summary) => {
      showToast({
        message:
          summary ??
          `CubeLab found separate sessions named ${names
            .map((name) => `'${name}'`)
            .join(', ')}. They remain separate until you approve a merge.`,
        actionLabel: 'Review Merge',
        onAction: () => {
          setMergeOpenedFromSettings(false)
          setMergeInitialTargetId(null)
          setMergeSessionsOpen(true)
        },
      })
    },
  })

  const syncRef = useRef(sync)
  useLayoutEffect(() => {
    syncRef.current = sync
  }, [sync])

  const trainingSyncBlockedReason = useCallback((): string | null => {
    if (pendingImport) {
      return 'A native import is waiting for confirmation. Finish or cancel it first.'
    }
    if (pendingDriveRestore) {
      return 'A Drive solve restore is waiting for confirmation. Finish or cancel it first.'
    }
    return null
  }, [pendingDriveRestore, pendingImport])

  const trainingSync = useTrainingSync({
    transport: driveTransport,
    controller: training.controller,
    trainingState: training.state,
    timerStatusRef,
    blockedReason: trainingSyncBlockedReason,
    onNotify: handleNotify,
  })
  const trainingSyncRef = useRef(trainingSync)
  useLayoutEffect(() => {
    trainingSyncRef.current = trainingSync
  }, [trainingSync])

  useEffect(() => {
    return subscribeToSiteReset((signal) => {
      // Ignore our own broadcast; the initiating tab handles its phases
      // directly and must be able to show retry/failure UI.
      if (signal.runId === siteResetRunIdRef.current) return
      if (signal.phase === 'begin') {
        // Another tab owns the reset. Stop this tab's writes and Drive access
        // before that tab clears shared storage. Gate first: persisting the
        // disabled preference must not recreate a CubeLab key after the owner
        // has already cleared storage.
        beginSiteResetGate()
        syncRef.current.updatePreferences({ enabled: false })
        trainingSyncRef.current.updatePreferences({ enabled: false })
        driveTransport?.blockForReset?.()
        setRemoteSiteReset('begin')
        return
      }
      if (signal.phase === 'failed') {
        // Keep this tab gated and hold its stale in-memory collections. The
        // initiating tab retains the retry UI; reloading here would clear the
        // gate and risk writing a partial state back over the reset.
        setRemoteSiteReset('failed')
        return
      }
      // Complete or explicitly abandoned: reload so this document cannot
      // retain stale in-memory collections and write them back over the
      // reset storage.
      window.location.reload()
    })
  }, [driveTransport])

  const commitDurableReplacement = useDurableReplacement({
    sync,
    timerStatusRef,
    settings,
    stageSessions,
    stageSettings,
    replaceSessions,
    replaceSettings,
    stageTraining: (data) => stageTrainingSnapshot(data),
    replaceTraining: (data, raw) => {
      training.controller.adoptSavedTraining(data, raw)
      trainingSync.reload()
    },
    trainingBlockedReason: trainingImportBlockedReason,
    onNotify: handleNotify,
  })

  const finishOnboardingOverlay = useCallback(
    (mode: OnboardingMode) => {
      setOnboarding(null)
      window.requestAnimationFrame(() => {
        window.setTimeout(() => {
          const target =
            mode === 'reopen'
              ? document.querySelector<HTMLElement>(
                  '[data-testid="settings-button"]',
                )
              : document.querySelector<HTMLElement>(
                  '[data-testid="timer-surface"]',
                )
          ;(target ??
            document.querySelector<HTMLElement>(
              '[data-testid="settings-button"]',
            ))?.focus()
        }, 0)
      })
    },
    [],
  )

  const handleOnboardingSkip = useCallback(() => {
    const mode = onboardingRef.current?.mode ?? 'first-run'
    if (mode === 'first-run') {
      markOnboardingDecision('skipped')
    } else {
      clearOnboardingDraft()
    }
    finishOnboardingOverlay(mode)
  }, [finishOnboardingOverlay])

  const handleOnboardingClose = useCallback(() => {
    const mode = onboardingRef.current?.mode ?? 'reopen'
    if (mode === 'reopen') clearOnboardingDraft()
    finishOnboardingOverlay(mode)
  }, [finishOnboardingOverlay])

  const handleOnboardingFinish = useCallback(() => {
    finishOnboardingOverlay(onboardingRef.current?.mode ?? 'first-run')
  }, [finishOnboardingOverlay])

  const handleOnboardingMarkComplete = useCallback(() => {
    markOnboardingDecision('completed')
    void requestStoragePersistence().catch(() => undefined)
  }, [])

  const handleOpenOnboardingFromSettings = useCallback(() => {
    if (timerStatusRef.current !== 'idle') return
    setSettingsOpen(false)
    setOnboarding({ mode: 'reopen' })
  }, [])

  const handleOnboardingCommitSetup = useCallback(
    async (nextSessions: SessionsData, nextSettings: Settings) => {
      const currentSync = loadSyncStorage()
      const baseSyncStorage = createAdditiveImportSyncStorage(
        currentSync,
        nextSessions,
      )
      const now = Date.now()
      const syncStorage = {
        ...baseSyncStorage,
        runtime: {
          ...baseSyncStorage.runtime,
          // The onboarding Main Event is an explicit local choice. Stamp the
          // existing selection metadata so a first cloud merge cannot silently
          // replace the session the user just chose.
          activeSessionFieldUpdate: {
            updatedAt: now,
            editorId: currentSync.runtime.deviceId,
          },
        },
      }
      return commitDurableReplacement({
        kind: 'additive-import',
        sessionsData: nextSessions,
        settingsData: nextSettings,
        syncStorage,
        successMessage: 'Setup saved',
        failurePrefix: 'Setup could not be saved',
        onSuccess: () => {},
      })
    },
    [commitDurableReplacement],
  )

  const handleOnboardingImportBackup = useCallback(
    async (
      backup: Backup,
    ): Promise<
      { ok: true; importedSessionIds: string[] } | { ok: false; error: string }
    > => {
      const imported = backup.sessions.sessions
      if (imported.length === 0) {
        return { ok: false, error: 'No csTimer sessions were found.' }
      }
      const keptSessions = syncSessionsData.sessions.filter(
        (session) => !isUntouchedDefaultSession(session),
      )
      const base: SessionsData = {
        activeSessionId: imported[0]!.id,
        sessions: [...keptSessions],
        ...(syncSessionsData.sessionOrder
          ? { sessionOrder: syncSessionsData.sessionOrder }
          : {}),
        ...(syncSessionsData.sessionTransfers
          ? { sessionTransfers: syncSessionsData.sessionTransfers }
          : {}),
      }
      const merged = appendSessionsInOrder(
        base,
        imported,
        undefined,
        'onboarding-import',
      )
      const activeSessionId = merged.sessions.some(
        (session) => session.id === imported[0]!.id,
      )
        ? imported[0]!.id
        : merged.sessions[0]?.id
      if (!activeSessionId) {
        return {
          ok: false,
          error: 'The csTimer import could not determine an active session.',
        }
      }
      const nextSessions = { ...merged, activeSessionId }
      const syncStorage = createAdditiveImportSyncStorage(
        loadSyncStorage(),
        nextSessions,
      )
      const committed = await commitDurableReplacement({
        kind: 'additive-import',
        sessionsData: nextSessions,
        syncStorage,
        successMessage: 'csTimer sessions imported',
        failurePrefix: 'csTimer import blocked',
        onSuccess: () => {},
      })
      if (!committed) {
        return {
          ok: false,
          error: 'The csTimer import could not be saved. Nothing was imported.',
        }
      }
      return {
        ok: true,
        importedSessionIds: imported.map((session) => session.id),
      }
    },
    [commitDurableReplacement, syncSessionsData],
  )

  useEffect(() => {
    const journal = loadReplacementJournal()
    if (journal.status === 'invalid') {
      showToast({ message: journal.message })
      return
    }
    if (journal.status === 'none') return
    if (journal.journal.phase === 'prepared') {
      // Another tab may still be writing its recovery record. Do not roll it
      // back from this tab; startup/main recovery handles abandoned records.
      showToast({
        message:
          'A backup replacement is in progress in another tab. Synchronization and new imports stay paused until it finishes.',
      })
      return
    }
    const recovery = recoverPendingReplacement()
    const message = pendingReplacementMessage(recovery)
    if (message) showToast({ message })
  }, [showToast])

  useEffect(() => {
    const startedAt = activeInspectionStartedAt(timer.state)
    if (startedAt === null) {
      inspectionWarningRef.current = {
        startedAt: null,
        warned: { '8s': false, '12s': false },
      }
      return
    }

    if (inspectionWarningRef.current.startedAt !== startedAt) {
      inspectionWarningRef.current = {
        startedAt,
        warned: { '8s': false, '12s': false },
      }
    }

    const elapsedMs = timer.inspectionElapsedMs ?? 0
    const events = inspectionWarningEvents(
      effectiveSettings.inspectionCountDirection,
      effectiveSettings.inspectionWarning8s,
      effectiveSettings.inspectionWarning12s,
    )

    for (const event of events) {
      if (
        inspectionWarningRef.current.warned[event.key] ||
        elapsedMs < event.elapsedMs
      ) {
        continue
      }

      inspectionWarningRef.current.warned[event.key] = true
      setAnnouncement(event.label)
      triggerAlert(
        'warning',
        settings.alertChannel,
        settings.alertVolume,
        undefined,
        true,
        event.key === '12s' ? 'danger' : 'warning',
      )
    }
  }, [
    settings.alertChannel,
    settings.alertVolume,
    effectiveSettings.inspectionCountDirection,
    effectiveSettings.inspectionWarning8s,
    effectiveSettings.inspectionWarning12s,
    timer.inspectionElapsedMs,
    timer.state,
    triggerAlert,
  ])

  const timerActive = timer.state.status !== 'idle'
  const splitSessionSource = splitSessionId
    ? sessions.find((session) => session.id === splitSessionId) ?? null
    : null
  const modalOpen =
    trainingArchive !== null ||
    trainingLifecycleLocked ||
    trainingModalOpen ||
    onboarding !== null ||
    settingsOpen ||
    sessionSettingsOpen ||
    dataOpen ||
    clearOpen ||
    resetAllOpen ||
    deleteAllOpen ||
    sessionToDelete !== null ||
    convertToPracticeOpen ||
    roundSummary !== null ||
    pendingImport !== null ||
    driveOpen ||
    mergeSessionsOpen ||
    splitSessionSource !== null ||
    createSessionOpen ||
    pendingDriveRestore !== null ||
    siteResetOpen ||
    siteResetPhase === 'resetting' ||
    siteResetPhase === 'failed' ||
    remoteSiteReset !== null
  const cancelTimerBase = timer.cancel
  const timerCancel = useCallback(() => {
    // Escape cancels a hold/inspection, never a running solve. The machine
    // ignores cancel while running, so clear only the Training attempt context
    // when the timer is not running; otherwise the stop would lose its attempt.
    const running = timerStatusRef.current === 'running'
    cancelTimerBase()
    if (!running) training.controller.cancelAttempt()
  }, [cancelTimerBase, training.controller])
  const timerPressBase = timer.press
  const timerPress = useCallback(
    (input: TimerInput) => {
      const at = performance.now()
      if (settings.alertChannel.includes('sound')) primeAlertAudio()
      timerPressBase(input, at)
    },
    [settings.alertChannel, timerPressBase],
  )
  const timerRelease = timer.release
  const canStart = view === 'training'
    ? trainingWorkspace && !!training.state.data && !training.state.pendingSave && !training.state.needsContinuity && !modalOpen &&
      (training.state.calibration ? training.state.calibration.status === 'collecting' && training.state.sample === null : Boolean(training.state.setup && training.state.data.activeVisitId))
    : !trainingLifecycleLocked && scramble !== null
  const visibleAverageSizes = useMemo(() => {
    const sizes: number[] = []
    for (const definition of BUILT_IN_STAT_DEFINITIONS) {
      if (
        definition.size !== null &&
        definition.key !== 'single' &&
        definition.key !== 'mo3' &&
        settings.statVisibility[definition.key]
      ) {
        sizes.push(definition.size)
      }
    }
    for (const average of settings.customAverages) {
      if (average.visible) sizes.push(average.size)
    }
    return sizes
  }, [settings.customAverages, settings.statVisibility])
  const averageTrimming = useMemo(() => ({ better: settings.averageTrimBetter, worse: settings.averageTrimWorse }), [settings.averageTrimBetter, settings.averageTrimWorse])
  const stats = useMemo(
    () => getSessionStats(insightSolves, visibleAverageSizes, averageTrimming),
    [insightSolves, visibleAverageSizes, averageTrimming],
  )
  const latestAo5 = stats.averages.get(5)?.latest ?? null
  const latestAo12 = stats.averages.get(12)?.latest ?? null
  const sessionSummary = useMemo(
    () => getSessionSummary(activeSession.solves),
    [activeSession.solves],
  )
  const activeCompetitionFormat = isCompetitionSession(activeSession)
    ? activeSession.competitionFormat
    : null
  const competition = useMemo(
    () =>
      activeCompetitionFormat
        ? {
            format: activeCompetitionFormat,
            rounds: getCompetitionRounds(
              insightSolves,
              activeCompetitionFormat,
              averageTrimming,
            ),
          }
        : null,
    [activeCompetitionFormat, averageTrimming, insightSolves],
  )
  const latestRoundLabel = useMemo(() => {
    const latest = insightSolves[0]
    if (!competition || !latest?.roundId) return null
    const round = competition.rounds.find(
      (entry) => entry.id === latest.roundId,
    )
    if (!round) return null
    const index = latest.roundIndex ??
      round.solves.findIndex((solve) => solve.id === latest.id)
    const attempt = index >= 0 ? index + 1 : round.attemptCount
    return `Round ${round.number} · attempt ${attempt}/${competition.format.size}`
  }, [competition, insightSolves])
  useEffect(() => {
    if (timer.state.status !== 'idle') return
    const sessionId = activeSession.id
    if (!isCompetitionSession(activeSession)) {
      seenRoundCompletionRef.current.delete(sessionId)
      return
    }
    // Detection runs after paint, so scanning the current history cannot add
    // work to the stop path. The rail presentation still uses the deferred
    // `competition` value above.
    const currentRounds = getCompetitionRounds(
      activeSession.solves,
      activeSession.competitionFormat,
      averageTrimming,
    )
    if (currentRounds.length === 0) {
      seenRoundCompletionRef.current.delete(sessionId)
      return
    }
    const latest = currentRounds[currentRounds.length - 1]!
    const previous = seenRoundCompletionRef.current.get(sessionId)
    seenRoundCompletionRef.current.set(sessionId, {
      id: latest.id,
      complete: latest.complete,
    })
    if (
      previous &&
      previous.id === latest.id &&
      !previous.complete &&
      latest.complete &&
      !latest.contested
    ) {
      setRoundSummary(latest)
    }
  }, [activeSession, averageTrimming, timer.state.status])

  const handleOpenSettings = useCallback(() => {
    if (timer.state.status !== 'idle') return
    setSettingsOpen(true)
  }, [timer.state.status])

  const routeTo = useCallback((next: AppView, analyticsTarget: 'solves' | 'algorithms' = 'solves') => {
    setTrainingArchive(null)
    if (next === 'analytics') showAnalyticsMode(analyticsTarget)
    try {
      if (!isSiteResetInProgress()) {
        sessionStorage.setItem('cubelab:view:v1', next)
      }
    } catch { /* device-local presentation only */ }
    setView(next)
  }, [showAnalyticsMode])

  const endTrainingSession = (destination: AppView) => {
    if (timerActive) return
    setTrainingEndRequest(null)
    training.controller.endSession({ destination, onEmpty: () => routeTo(destination) })
  }

  const handleNavigate = useCallback(
    (next: AppView, anchor?: HTMLButtonElement) => {
      if (timer.state.status !== 'idle') return
      if (requiredReport || trainingIdle) return
      if (view === 'training' && next !== 'training' && trainingWorkspace) {
        if (savedTrainingSession || training.state.pendingSave) {
          if (anchor && !training.state.pendingSave) setTrainingEndRequest({ anchor, destination: next })
          return
        }
        training.controller.cancelCalibration()
      }
      setTrainingEndRequest(null)
      routeTo(next)
    },
    [timer.state.status, view, training.controller, training.state.pendingSave, trainingWorkspace, savedTrainingSession, requiredReport, trainingIdle, routeTo],
  )

  const handleRegenerate = useCallback(() => {
    if (timer.state.status !== 'idle' || scrambleLoading) return
    advanceScramble()
  }, [advanceScramble, scrambleLoading, timer.state.status])

  const handleReloadScramble = useCallback(() => {
    if (timer.state.status !== 'idle' || !storageHealthy) return
    window.location.reload()
  }, [storageHealthy, timer.state.status])

  const handleCancel = useCallback(() => {
    timerCancel()
  }, [timerCancel])

  const handleSetPenalty = useCallback(
    (id: string, penalty: Penalty) => {
      if (!setPenalty(id, penalty)) {
        showToast({
          message:
            'The result change was not saved. Try again when browser storage is available.',
        })
      }
    },
    [setPenalty, showToast],
  )

  const handleSetComment = useCallback(
    (id: string, comment: string) => setComment(id, comment),
    [setComment],
  )

  const handleSetSessionInspection = useCallback(
    (enabled: boolean | undefined) => {
      if (timer.state.status !== 'idle') return
      setInspection(activeSession.id, enabled)
    },
    [activeSession.id, setInspection, timer.state.status],
  )

  const { recordDeletion, restoreDeletion } = sync
  const handleDelete = useCallback(
    (id: string) => {
      const solve = activeSession.solves.find((entry) => entry.id === id)
      if (!solve) return
      // Deletion intent must be durable before the solve disappears.
      if (!recordDeletion('solve', id, activeSession.id)) {
        showToast({
          message:
            'Solve deletion blocked: deletion records could not be saved. Nothing was removed.',
        })
        return
      }
      const removed = deleteSolve(id)
      if (!removed) {
        const revoked = restoreDeletion('solve', id)
        showToast({
          message: revoked
            ? 'Solve deletion could not be saved. Nothing was removed.'
            : 'Solve deletion could not be saved. The deletion record remains and will apply when storage recovers.',
        })
        return
      }

      showToast({
        message: 'Solve deleted',
        actionLabel: 'Undo',
        onAction: () => {
          const deletedTombstone = loadSyncStorage().runtime.tombstones.find(
            (tombstone) =>
              tombstone.kind === 'solve' &&
              tombstone.id === removed.solve.id,
          )
          const recovery = createPendingSolveRestore(
            removed.solve,
            removed.index,
            removed.sessionId,
            activeSession.name,
            deletedTombstone
              ? {
                  deletedAt: deletedTombstone.deletedAt,
                  deletedByDeviceId: deletedTombstone.deletedByDeviceId,
                }
              : undefined,
          )
          if (!addPendingSolveRestore(recovery)) {
            showToast({
              message:
                'Undo blocked: the recovery record could not be saved. The solve remains deleted.',
            })
            return
          }
          if (!restoreDeletion('solve', removed.solve.id)) {
            removePendingSolveRestore(recovery.operationId)
            showToast({
              message:
                'Undo blocked: the deletion record could not be updated. The solve remains deleted.',
            })
            return
          }
          if (!restoreSolve(removed.solve, removed.index, removed.sessionId)) {
            showToast({
              message:
                'Undo is pending recovery: the solve could not be restored immediately. It will be retried before synchronization or after reload.',
            })
            return
          }
          removePendingSolveRestore(recovery.operationId)
        },
      })
    },
    [
      activeSession.id,
      activeSession.name,
      activeSession.solves,
      deleteSolve,
      recordDeletion,
      restoreDeletion,
      restoreSolve,
      showToast,
    ],
  )

  const requestClear = useCallback(() => {
    if (timer.state.status === 'idle' && solves.length > 0) {
      setClearOpen(true)
    }
  }, [solves.length, timer.state.status])

  const confirmClear = useCallback(() => {
    const removed = activeSession.solves.map((solve) => ({
      id: solve.id,
      sessionId: activeSession.id,
    }))
    if (removed.length === 0) {
      setClearOpen(false)
      setSessionSettingsOpen(false)
      return
    }
    // One checked batch write is the deletion-intent boundary. If it fails,
    // leave the collection and every solve untouched.
    if (!sync.recordDeletions(removed)) {
      showToast({
        message:
          'Session clear blocked: deletion records could not be saved. Nothing was removed.',
      })
      return
    }
    // The deletion intent is durable now. Do not publish or announce an empty
    // collection unless that collection also reached storage.
    if (!clearSolves()) {
      setClearOpen(false)
      setSessionSettingsOpen(false)
      showToast({
        message:
          'Session clear could not be saved. Deletion records are saved; retry after storage recovers.',
      })
      return
    }
    setClearOpen(false)
    setSessionSettingsOpen(false)
    showToast({ message: 'Session cleared' })
  }, [
    activeSession.id,
    activeSession.solves,
    clearSolves,
    showToast,
    sync,
  ])

  const resetAllDisabledReason = useMemo(() => {
    if (!storageHealthy) {
      return 'Reset is blocked because browser storage is unavailable. Start a backup first or restore storage access.'
    }
    if (timer.state.status !== 'idle') {
      return 'Reset is blocked while the timer is active. Finish or cancel the current attempt first.'
    }
    if (sync.phase === 'syncing') {
      return 'Reset is blocked while Google Drive synchronization is in progress. Wait for it to finish, then try again.'
    }
    return null
  }, [storageHealthy, sync.phase, timer.state.status])

  const deleteAllSessionsDisabledReason = useMemo(() => {
    if (!storageHealthy) {
      return 'Deleting all sessions is blocked because browser storage is unavailable. Start a backup first or restore storage access.'
    }
    if (timer.state.status !== 'idle') {
      return 'Deleting all sessions is blocked while the timer is active. Finish or cancel the current attempt first.'
    }
    if (sync.phase === 'syncing') {
      return 'Deleting all sessions is blocked while Google Drive synchronization is in progress. Wait for it to finish, then try again.'
    }
    return null
  }, [storageHealthy, sync.phase, timer.state.status])

  const developerSyncStatus = useMemo(() => {
    if (resetAwaitingSync || deleteAllAwaitingSync) {
      return 'Deletion records are being synchronized with Google Drive. Historical snapshots are retained.'
    }
    switch (sync.phase) {
      case 'disabled':
        return 'Google Drive synchronization is off. Deletion records are stored locally and will be published after synchronization is enabled.'
      case 'synced':
        return 'Google Drive is synchronized. Deletions will publish on the next sync; historical snapshots are never deleted.'
      case 'pending':
        return 'Google Drive has pending local changes. Deletions will publish on the next synchronization.'
      case 'offline':
        return 'You are offline. Deletion records are saved locally and will publish after reconnection.'
      case 'auth-required':
        return 'Google Drive needs reconnection. Deletion records stay saved locally until sync is authorized.'
      case 'conflict':
        return 'Synchronization is paused for conflict review. Deletion records stay saved; existing conflict protection is not bypassed.'
      case 'failed':
        return 'The last synchronization failed. Deletion records stay saved locally; retry Sync now from Google Drive backup.'
      case 'syncing':
        return 'Google Drive synchronization is in progress.'
      default:
        return 'Deletion records are stored locally and publish through the existing synchronization system.'
    }
  }, [deleteAllAwaitingSync, resetAwaitingSync, sync.phase])

  const handleOpenResetAll = useCallback(() => {
    if (timer.state.status !== 'idle') return
    setSettingsOpen(false)
    setResetAllOpen(true)
  }, [timer.state.status])

  const confirmResetAll = useCallback(() => {
    if (timer.state.status !== 'idle') {
      setResetAllOpen(false)
      showToast({
        message: 'Reset blocked: finish or cancel the current timer attempt first.',
      })
      return
    }
    if (!storageHealthy) {
      setResetAllOpen(false)
      showToast({
        message:
          'Reset blocked: browser storage is unavailable, so deletion records cannot be saved safely.',
      })
      return
    }
    if (sync.phase === 'syncing') {
      setResetAllOpen(false)
      showToast({
        message:
          'Reset blocked: Google Drive synchronization is in progress. Wait for it to finish, then try again.',
      })
      return
    }

    const removed = sessions.flatMap((session) =>
      session.solves.map((solve) => ({
        id: solve.id,
        sessionId: session.id,
      })),
    )
    if (removed.length === 0) {
      setResetAllOpen(false)
      return
    }

    // Delete intent becomes durable before solve data is cleared. Even if the
    // app closes immediately, a later merge cannot resurrect these solves.
    if (!sync.recordDeletions(removed)) {
      setResetAllOpen(false)
      showToast({
        message:
          'Reset blocked: deletion records could not be saved. No solves were removed.',
      })
      return
    }

    const result = resetAllSolveData()
    setResetAllOpen(false)
    if (!result.ok) {
      const revoked = sync.restoreDeletions(
        removed.map(({ id }) => ({ kind: 'solve' as const, id })),
      )
      showToast({
        message: revoked
          ? 'Solve data could not be saved after the reset. Nothing was removed; retry after storage recovers.'
          : 'Solve data could not be saved and the deletion records could not be revoked. Synchronize carefully before retrying.',
      })
      return
    }

    const syncing = sync.phase !== 'disabled' && navigator.onLine
    if (syncing) {
      setResetAwaitingSync(true)
      showToast({
        message:
          'All solves reset locally. Synchronizing deletion records with Google Drive…',
      })
      window.setTimeout(() => void sync.syncNow('reset'), 0)
      return
    }

    setResetAwaitingSync(false)
    showToast({
      message:
        sync.phase === 'disabled'
          ? 'All solves reset locally. Synchronization is off; deletion records are saved for a later sync.'
          : 'All solves reset locally. Deletion records are saved and will publish after reconnection.',
    })
  }, [
    resetAllSolveData,
    sessions,
    showToast,
    storageHealthy,
    sync,
    timer.state.status,
  ])

  const siteResetRunningRef = useRef(false)

  const handleOpenSiteReset = useCallback(() => {
    if (timer.state.status !== 'idle') return
    setSettingsOpen(false)
    setSiteResetOpen(true)
  }, [timer.state.status])

  const runSiteReset = useCallback(async () => {
    if (siteResetRunningRef.current) return
    siteResetRunningRef.current = true
    setSiteResetOpen(false)
    setSiteResetResult(null)
    setSiteResetPhase('resetting')

    const runId = createSiteResetRunId()
    siteResetRunIdRef.current = runId
    const signal = (
      phase: SiteResetSignal['phase'],
    ): SiteResetSignal => ({
      type: 'cubelab-site-reset',
      phase,
      runId,
      at: Date.now(),
    })

    // Persist the disabled preference before the write gate starts rejecting
    // every CubeLab save. This stops scheduled syncs from starting again.
    sync.updatePreferences({ enabled: false })
    beginSiteResetGate()
    publishSiteResetSignal(signal('begin'))
    driveTransport?.blockForReset?.()

    // Give other tabs a turn to receive the begin signal, gate their writes,
    // and block Drive access before shared storage is cleared. Production
    // normally has a single running tab, but a tab that was already waiting or
    // a legacy client must not write stale data between the clear and reload.
    await new Promise<void>((resolve) => window.setTimeout(resolve, 100))

    // Let any run that was already in flight abort and settle before local
    // storage is cleared. If it cannot stop, keep the data and fail closed.
    const syncStopped = await waitForSyncIdle(() => sync.isSyncRunning())
    if (!syncStopped) {
      siteResetRunningRef.current = false
      publishSiteResetSignal(signal('failed'))
      setSiteResetResult(
        createFailedSiteResetResult(
          'Google Drive synchronization did not stop. Nothing was cleared. Wait for the current sync to finish, then retry.',
        ),
      )
      setSiteResetPhase('failed')
      return
    }

    const result = await resetSiteStorage()
    if (!result.ok) {
      siteResetRunningRef.current = false
      publishSiteResetSignal(signal('failed'))
      setSiteResetResult(result)
      setSiteResetPhase('failed')
      return
    }

    publishSiteResetSignal(signal('complete'))
    // Give BroadcastChannel a turn to notify other tabs before this document
    // reloads. The write gate remains active for every intervening task.
    window.setTimeout(() => window.location.reload(), 50)
  }, [driveTransport, sync])

  const confirmSiteReset = useCallback(() => {
    void runSiteReset()
  }, [runSiteReset])

  const retrySiteReset = useCallback(() => {
    void runSiteReset()
  }, [runSiteReset])

  const abandonSiteReset = useCallback(() => {
    // The user explicitly chose to leave a partial reset. Tell gated tabs to
    // reload too, otherwise they would stay locked with no retry UI.
    publishSiteResetSignal({
      type: 'cubelab-site-reset',
      phase: 'abandoned',
      runId: siteResetRunIdRef.current ?? createSiteResetRunId(),
      at: Date.now(),
    })
    window.setTimeout(() => window.location.reload(), 50)
  }, [])

  useEffect(() => {
    if (!resetAwaitingSync) return
    if (sync.phase === 'synced' && !sync.hasPendingChanges) {
      // oxlint-disable-next-line react/set-state-in-effect
      setResetAwaitingSync(false)
      showToast({
        message:
          'All solve data was reset and the deletion records synchronized with Google Drive.',
      })
      return
    }
    if (
      sync.phase === 'failed' ||
      sync.phase === 'conflict' ||
      sync.phase === 'auth-required' ||
      sync.phase === 'offline'
    ) {
      // oxlint-disable-next-line react/set-state-in-effect
      setResetAwaitingSync(false)
      showToast({
        message:
          'Solve data was reset locally, but Google Drive synchronization did not complete. Deletion records remain saved for a later sync.',
      })
    }
  }, [resetAwaitingSync, showToast, sync.hasPendingChanges, sync.phase])

  const handleOpenDeleteAllSessions = useCallback(() => {
    if (timer.state.status !== 'idle') return
    setSettingsOpen(false)
    setDeleteAllOpen(true)
  }, [timer.state.status])

  const confirmDeleteAllSessions = useCallback(() => {
    if (timer.state.status !== 'idle') {
      setDeleteAllOpen(false)
      showToast({
        message:
          'Delete all sessions blocked: finish or cancel the current timer attempt first.',
      })
      return
    }
    if (!storageHealthy) {
      setDeleteAllOpen(false)
      showToast({
        message:
          'Delete all sessions blocked: browser storage is unavailable, so deletion records cannot be saved safely.',
      })
      return
    }
    if (sync.phase === 'syncing') {
      setDeleteAllOpen(false)
      showToast({
        message:
          'Delete all sessions blocked: Google Drive synchronization is in progress. Wait for it to finish, then try again.',
      })
      return
    }

    // Deletion intent becomes durable before the session collection is replaced.
    // Session tombstones carry every known solve ID and explicit solve
    // tombstones prevent either record type from being resurrected by a merge.
    if (!sync.recordAllSessionDeletions(sessions)) {
      setDeleteAllOpen(false)
      showToast({
        message:
          'Delete all sessions blocked: deletion records could not be saved. Nothing was removed.',
      })
      return
    }

    if (!deleteAllSessions()) {
      setDeleteAllOpen(false)
      const revoked = sync.restoreDeletions(
        sessions.map((session) => ({
          kind: 'session' as const,
          id: session.id,
          knownSolveIds: session.solves.map((solve) => solve.id),
        })),
      )
      showToast({
        message: revoked
          ? 'Sessions could not be saved after deletion. Nothing was removed; retry after storage recovers.'
          : 'Sessions could not be saved and the deletion records could not be revoked. Synchronize carefully before retrying.',
      })
      return
    }

    setDeleteAllOpen(false)
    setSessionSettingsOpen(false)

    const syncing = sync.phase !== 'disabled' && navigator.onLine
    if (syncing) {
      setDeleteAllAwaitingSync(true)
      showToast({
        message:
          'All sessions deleted locally. Synchronizing deletion records with Google Drive…',
      })
      window.setTimeout(() => void sync.syncNow('reset'), 0)
      return
    }

    setDeleteAllAwaitingSync(false)
    showToast({
      message:
        sync.phase === 'disabled'
          ? 'All sessions deleted locally. Session 1 is ready. Synchronization is off; deletion records are saved for a later sync.'
          : 'All sessions deleted locally. Session 1 is ready. Deletion records are saved and will publish after reconnection.',
    })
  }, [
    deleteAllSessions,
    sessions,
    showToast,
    storageHealthy,
    sync,
    timer.state.status,
  ])

  useEffect(() => {
    if (!deleteAllAwaitingSync) return
    if (sync.phase === 'synced' && !sync.hasPendingChanges) {
      // oxlint-disable-next-line react/set-state-in-effect
      setDeleteAllAwaitingSync(false)
      showToast({
        message:
          'All sessions were deleted and the deletion records synchronized with Google Drive.',
      })
      return
    }
    if (
      sync.phase === 'failed' ||
      sync.phase === 'conflict' ||
      sync.phase === 'auth-required' ||
      sync.phase === 'offline'
    ) {
      // oxlint-disable-next-line react/set-state-in-effect
      setDeleteAllAwaitingSync(false)
      showToast({
        message:
          'Sessions were deleted locally, but Google Drive synchronization did not complete. Deletion records remain saved for a later sync.',
      })
    }
  }, [deleteAllAwaitingSync, showToast, sync.hasPendingChanges, sync.phase])

  const handleCreateSession = useCallback(
    (
      name: string,
      event?: PuzzleEvent,
      preferences?: SessionPreferences,
      competitionFormat?: CompetitionFormat,
    ): boolean => {
      if (timer.state.status !== 'idle') return false
      const id = createSession(
        name,
        preferences?.inspectionEnabled ?? activeInspectionEnabled,
        event,
        preferences,
        competitionFormat,
      )
      if (id) {
        selectSession(id)
      }
      return Boolean(id)
    },
    [
      activeInspectionEnabled,
      createSession,
      selectSession,
      timer.state.status,
    ],
  )

  const handleRenameSession = useCallback(
    (id: string, name: string): boolean => {
      if (timer.state.status !== 'idle') return false
      return renameSession(id, name)
    },
    [renameSession, timer.state.status],
  )

  const handleSelectSession = useCallback(
    (id: string) => {
      if (timer.state.status !== 'idle') return
      selectSession(id)
    },
    [selectSession, timer.state.status],
  )

  const handleOpenSessionSettings = useCallback(() => {
    if (timer.state.status !== 'idle') return
    setSessionSettingsOpen(true)
  }, [timer.state.status])

  const handleReorderSession = useCallback(
    (id: string, targetIndex: number) => {
      if (timer.state.status !== 'idle') return
      moveSessionTo(id, targetIndex)
    },
    [moveSessionTo, timer.state.status],
  )

  const handleSetSessionEvent = useCallback(
    (id: string, event: PuzzleEvent) => {
      if (timer.state.status !== 'idle') return false
      return setSessionEvent(id, event)
    },
    [setSessionEvent, timer.state.status],
  )

  const requestDeleteSession = useCallback(() => {
    if (timer.state.status !== 'idle' || sessions.length <= 1) return
    setSessionToDelete(activeSession)
  }, [activeSession, sessions.length, timer.state.status])

  const requestConvertToPractice = useCallback(() => {
    if (timer.state.status !== 'idle' || !isCompetitionSession(activeSession)) return
    setSessionSettingsOpen(false)
    setConvertToPracticeOpen(true)
  }, [activeSession, timer.state.status])

  const confirmConvertToPractice = useCallback(() => {
    setConvertToPracticeOpen(false)
    if (!isCompetitionSession(activeSession)) return
    if (!convertSessionToPractice(activeSession.id)) {
      showToast({
        message:
          'Conversion could not be saved. The session is still a competition.',
      })
      return
    }
    showToast({
      message: `Converted “${activeSession.name}” to practice. Rounds were flattened.`,
    })
    if (sync.phase !== 'disabled' && navigator.onLine) {
      window.setTimeout(() => void sync.syncNow('conversion'), 0)
    }
  }, [activeSession, convertSessionToPractice, showToast, sync])

  const confirmDeleteSession = useCallback(() => {
    if (!sessionToDelete) return
    if (!sync.recordSessionDeletion(sessionToDelete)) {
      setSessionToDelete(null)
      setSessionSettingsOpen(false)
      showToast({
        message:
          'Session deletion blocked: deletion records could not be saved. Nothing was removed.',
      })
      return
    }
    const deleted = deleteSession(sessionToDelete.id)
    setSessionToDelete(null)
    setSessionSettingsOpen(false)
    if (deleted) {
      showToast({ message: 'Session deleted' })
      return
    }
    // The collection write failed. Revoke the durable deletion intent written
    // above so a later sync cannot delete a session the UI kept.
    const revoked = sync.restoreDeletion(
      'session',
      sessionToDelete.id,
      sessionToDelete.solves.map((solve) => solve.id),
    )
    showToast({
      message: revoked
        ? 'Session deletion failed. Nothing was removed.'
        : 'Session deletion failed and its deletion record could not be revoked. Synchronize carefully before retrying.',
    })
  }, [deleteSession, sessionToDelete, showToast, sync])

  const restoreHeaderSettingsFocus = useCallback(() => {
    // Wait for the dialog to unmount and close before moving focus back to the
    // visible header control; an open modal would otherwise keep focus inside
    // or restore it to a removed element.
    window.requestAnimationFrame(() => {
      window.setTimeout(() => {
        document
          .querySelector<HTMLElement>('[data-testid="settings-button"]')
          ?.focus()
      }, 0)
    })
  }, [])

  const handleCloseData = useCallback(() => {
    setDataOpen(false)
    restoreHeaderSettingsFocus()
  }, [restoreHeaderSettingsFocus])

  const handleCloseDrive = useCallback(() => {
    setDriveOpen(false)
    restoreHeaderSettingsFocus()
  }, [restoreHeaderSettingsFocus])

  const handleOpenBackup = useCallback(() => {
    if (timer.state.status !== 'idle') return
    setSettingsOpen(false)
    setDataOpen(true)
  }, [timer.state.status])

  const handleOpenDriveBackup = useCallback(() => {
    if (timer.state.status !== 'idle') return
    setSettingsOpen(false)
    setDriveOpen(true)
  }, [timer.state.status])

  const handleDriveRestorePending = useCallback((backup: Backup) => {
    setPendingDriveRestore(backup)
    setDriveOpen(false)
  }, [])

  const confirmDriveRestore = useCallback(async () => {
    if (!pendingDriveRestore) return
    const nextSyncStorage = createResetBaseSyncStorage(
      loadSyncStorage(),
      pendingDriveRestore.sessions,
    )
    const nextDriveState = {
      ...loadDriveBackupState(),
      lastRestoreAt: Date.now(),
    }
    const committed = await commitDurableReplacement({
      kind: 'drive-restore',
      sessionsData: pendingDriveRestore.sessions,
      settingsData: pendingDriveRestore.settings,
      syncStorage: nextSyncStorage,
      driveState: nextDriveState,
      successMessage: 'Google Drive backup restored',
      failurePrefix: 'Google Drive restore blocked',
      onSuccess: () => {
        setPendingDriveRestore(null)
        setDriveOpen(false)
        restoreHeaderSettingsFocus()
      },
    })
    if (!committed) return
  }, [
    commitDurableReplacement,
    pendingDriveRestore,
    restoreHeaderSettingsFocus,
  ])

  const cancelDriveRestore = useCallback(() => {
    setPendingDriveRestore(null)
    restoreHeaderSettingsFocus()
  }, [restoreHeaderSettingsFocus])

  const handleExport = useCallback(async (): Promise<
    { ok: true } | { ok: false; error: string }
  > => {
    if (timer.state.status !== 'idle') {
      return {
        ok: false,
        error: 'Wait for the timer to return to idle before exporting.',
      }
    }

    try {
      const trainingSnapshot = training.controller.getBackupSnapshot()
      if (trainingSnapshot.status === 'blocked') {
        return {
          ok: false,
          error: `Backup not exported: ${trainingSnapshot.reason}`,
        }
      }

      const localData = {
        activeSessionId,
        sessions,
        ...(customEvents.length > 0 ? { customEvents } : {}),
        ...(sessionOrder ? { sessionOrder } : {}),
        ...(sessionTransfers ? { sessionTransfers } : {}),
      }
      const pendingRecovery = loadSolveRecoveryChecked()
      if (!pendingRecovery.ok) {
        return {
          ok: false,
          error: `Backup not exported: ${pendingRecovery.message}`,
        }
      }
      let exportData = localData
      if (pendingRecovery.data.operations.length > 0) {
        const syncRead = loadSyncStorageChecked()
        if (!syncRead.ok) {
          return {
            ok: false,
            error: `Backup not exported: ${syncRead.message}`,
          }
        }
        const materialized = applyPendingSolveRestores({
          data: localData,
          tombstones: syncRead.data.runtime.tombstones,
          operations: pendingRecovery.data.operations,
        })
        if (materialized.remaining.length > 0) {
          return {
            ok: false,
            error:
              'Backup not exported: a pending Undo could not be materialized safely.',
          }
        }
        exportData = materialized.data
      }
      const backup = createBackup(
        exportData,
        settings,
        new Date(),
        undefined,
        trainingSnapshot.status === 'ready' ? trainingSnapshot.data : undefined,
      )
      const serialized = await preparePortableBackupExport(backup)
      if (!serialized.ok) {
        return { ok: false, error: `Backup not exported: ${serialized.error}` }
      }
      downloadFile(
        serialized.bytes as BlobPart,
        serialized.fileName,
        serialized.compressed ? 'application/gzip' : 'application/json',
      )
      setDataOpen(false)
      const trainingLabel =
        trainingSnapshot.status === 'ready' ? ' with Training history' : ''
      const formatLabel = serialized.compressed
        ? ' as a compressed .json.gz file'
        : serialized.compact
          ? ' in compact form to stay under the size limit'
          : ''
      showToast({ message: `Backup exported${trainingLabel}${formatLabel}` })
      restoreHeaderSettingsFocus()
      return { ok: true }
    } catch {
      return {
        ok: false,
        error: 'Backup not exported: the backup could not be built safely.',
      }
    }
  }, [activeSessionId, sessions, customEvents, sessionOrder, sessionTransfers, settings, showToast, timer.state.status, restoreHeaderSettingsFocus, training.controller])

  const handleImportRequested = useCallback((backup: Backup) => {
    setDataOpen(false)
    setPendingImport(backup)
  }, [])

  const confirmImport = useCallback(async () => {
    if (!pendingImport) return

    if (pendingImport.importMode === 'add') {
      const imported = pendingImport.sessions.sessions
      const merged = appendSessionsInOrder(
        {
          activeSessionId: activeSessionId ?? imported[0]?.id ?? '',
          sessions: [...sessions],
          ...(syncSessionsData.sessionOrder
            ? { sessionOrder: syncSessionsData.sessionOrder }
            : {}),
          ...(syncSessionsData.sessionTransfers
            ? { sessionTransfers: syncSessionsData.sessionTransfers }
            : {}),
        },
        imported,
        undefined,
        'local-import',
      )
      const nextSyncStorage = createAdditiveImportSyncStorage(
        loadSyncStorage(),
        merged,
      )
      await commitDurableReplacement({
        kind: 'additive-import',
        sessionsData: merged,
        syncStorage: nextSyncStorage,
        successMessage: 'Backup imported',
        failurePrefix: 'Backup import blocked',
        onSuccess: () => {
          setPendingImport(null)
          restoreHeaderSettingsFocus()
        },
      })
      return
    }

    const nextSyncStorage = createResetBaseSyncStorage(
      loadSyncStorage(),
      pendingImport.sessions,
    )
    await commitDurableReplacement({
      kind: 'native-import',
      sessionsData: pendingImport.sessions,
      settingsData: pendingImport.settings,
      syncStorage: nextSyncStorage,
      trainingData: pendingImport.training?.data,
      ...(pendingImport.training
        ? {
            trainingSyncStorage: clearTrainingSyncProvenance(
              loadTrainingSyncStorage(),
            ),
          }
        : {}),
      successMessage: 'Backup imported',
      failurePrefix: 'Backup import blocked',
      onSuccess: () => {
        setPendingImport(null)
        restoreHeaderSettingsFocus()
      },
    })
  }, [
    commitDurableReplacement,
    pendingImport,
    activeSessionId,
    sessions,
    syncSessionsData.sessionOrder,
    syncSessionsData.sessionTransfers,
    restoreHeaderSettingsFocus,
  ])

  const splitFromSettingsRef = useRef(false)
  const restoreSessionSelectorFocus = useCallback(() => {
    window.setTimeout(() => {
      document
        .querySelector<HTMLElement>('[data-testid="session-select"]')
        ?.focus()
    }, 0)
  }, [])

  const closeMergeSessions = useCallback(() => {
    const fromSettings = mergeOpenedFromSettings
    setMergeOpenedFromSettings(false)
    setMergeSessionsOpen(false)
    setMergeInitialTargetId(null)
    if (fromSettings) restoreSessionSelectorFocus()
  }, [mergeOpenedFromSettings, restoreSessionSelectorFocus])

  const closeSplitSession = useCallback(() => {
    const fromSettings = splitFromSettingsRef.current
    splitFromSettingsRef.current = false
    setSplitSessionId(null)
    if (fromSettings) restoreSessionSelectorFocus()
  }, [restoreSessionSelectorFocus])

  const handleOpenMergeSessions = useCallback(() => {
    if (timer.state.status !== 'idle') return
    setSessionSettingsOpen(false)
    setMergeInitialTargetId(activeSession.id)
    setMergeOpenedFromSettings(true)
    setMergeSessionsOpen(true)
  }, [activeSession.id, timer.state.status])

  const handleOpenSplitSession = useCallback(() => {
    if (timer.state.status !== 'idle' || activeSession.solves.length === 0) return
    setSessionSettingsOpen(false)
    splitFromSettingsRef.current = true
    setSplitSessionId(activeSession.id)
  }, [activeSession.id, activeSession.solves.length, timer.state.status])

  const handleMergeSessions = useCallback(
    (sourceIds: readonly string[], targetId: string): boolean => {
      if (timer.state.status !== 'idle') {
        showToast({
          message:
            'Merge blocked: finish or cancel the current timer attempt first.',
        })
        return false
      }
      if (!storageHealthy) {
        showToast({
          message:
            'Merge blocked: browser storage is unavailable. Nothing was changed.',
        })
        return false
      }
      if (sync.phase === 'syncing') {
        showToast({
          message:
            'Merge blocked: Google Drive synchronization is in progress. Wait for it to finish, then try again.',
        })
        return false
      }

      const current = {
        activeSessionId,
        sessions,
        ...(customEvents.length > 0 ? { customEvents } : {}),
        ...(sessionOrder ? { sessionOrder } : {}),
        ...(sessionTransfers ? { sessionTransfers } : {}),
      }
      const validationError = getSessionMergeError(
        current,
        targetId,
        sourceIds,
      )
      if (validationError) {
        showToast({ message: `Merge blocked: ${validationError}` })
        return false
      }

      const targetName =
        sessions.find((session) => session.id === targetId)?.name ?? 'session'
      const uniqueSources = [...new Set(sourceIds)]

      // Write the redirect intent first. The session collection is not replaced
      // unless that intent is durable, so a stale device can still be moved to
      // the chosen destination after a later synchronization.
      if (!sync.recordSessionMerges(targetId, uniqueSources)) {
        showToast({
          message:
            'Merge blocked: the merge record could not be saved. Nothing was changed.',
        })
        return false
      }
      if (!mergeSessions(targetId, uniqueSources)) {
        const rolledBack = sync.removeSessionMerges(targetId, uniqueSources)
        showToast({
          message: rolledBack
            ? 'Merge could not be saved. Nothing was removed.'
            : 'Merge could not be saved locally. A saved merge record will be applied at the next successful synchronization.',
        })
        return false
      }

      showToast({
        message: `Merged ${uniqueSources.length === 1 ? '1 session' : `${uniqueSources.length} sessions`} into “${targetName}”`,
      })
      if (sync.phase !== 'disabled' && navigator.onLine) {
        window.setTimeout(() => void sync.syncNow('merge'), 0)
      }
      return true
    },
    [
      activeSessionId,
      customEvents,
      mergeSessions,
      sessionOrder,
      sessionTransfers,
      sessions,
      showToast,
      storageHealthy,
      sync,
      timer.state.status,
    ],
  )

  const handleSplitSession = useCallback(
    (
      sessionId: string,
      name: string,
      solveIds: readonly string[],
      competitionFormat?: CompetitionFormat,
    ): string | null => {
      if (timer.state.status !== 'idle') {
        showToast({
          message:
            'Split blocked: finish or cancel the current timer attempt first.',
        })
        return null
      }
      if (!storageHealthy) {
        showToast({
          message:
            'Split blocked: browser storage is unavailable. Nothing was changed.',
        })
        return null
      }
      if (sync.phase === 'syncing') {
        showToast({
          message:
            'Split blocked: Google Drive synchronization is in progress. Wait for it to finish, then try again.',
        })
        return null
      }

      const newSessionId = splitSession(
        sessionId,
        name,
        solveIds,
        competitionFormat,
      )
      if (!newSessionId) {
        showToast({
          message: 'Split could not be saved. Nothing was moved.',
        })
        return null
      }

      showToast({
        message: `Moved ${solveIds.length === 1 ? '1 solve' : `${solveIds.length} solves`} to “${name.trim()}”`,
      })
      if (sync.phase !== 'disabled' && navigator.onLine) {
        window.setTimeout(() => void sync.syncNow('split'), 0)
      }
      return newSessionId
    },
    [showToast, splitSession, storageHealthy, sync, timer.state.status],
  )

  const cancelConfirm = useCallback(() => {
    const cancelledImport = pendingImport !== null
    setClearOpen(false)
    setResetAllOpen(false)
    setDeleteAllOpen(false)
    setSiteResetOpen(false)
    setSessionToDelete(null)
    setConvertToPracticeOpen(false)
    setPendingImport(null)
    if (cancelledImport) restoreHeaderSettingsFocus()
  }, [pendingImport, restoreHeaderSettingsFocus])

  const confirmContent = useMemo<ConfirmContent | null>(() => {
    if (siteResetOpen) {
      return {
        eyebrow: 'Developer · Danger zone',
        title: 'Reset all site data?',
        description: (
          <>
            Permanently delete all local CubeLab data, caches, settings, and
            authentication state. CubeLab will restart as a new user.{' '}
            <strong>
              This action cannot be undone. Google Drive cloud data will not be
              deleted.
            </strong>
          </>
        ),
        details: (
          <ul>
            <li>All locally stored solves and sessions</li>
            <li>All Training attempts, calibration, and practice history</li>
            <li>All settings and preferences</li>
            <li>All onboarding and first-visit flags</li>
            <li>All IndexedDB databases owned by CubeLab</li>
            <li>All CubeLab localStorage and sessionStorage</li>
            <li>
              All CubeLab application caches and offline data the page can
              access
            </li>
            <li>
              All locally stored Google authentication and synchronization
              state
            </li>
          </ul>
        ),
        cancelLabel: 'Cancel',
        confirmLabel: 'Reset All Data',
        requireText: 'RESET',
        onConfirm: confirmSiteReset,
      }
    }

    if (deleteAllOpen) {
      return {
        eyebrow: 'Developer · Danger zone',
        title: 'Delete all sessions and solves?',
        description: (
          <>
            This permanently removes <strong>{sessions.length}</strong>{' '}
            {sessions.length === 1 ? 'session' : 'sessions'} and{' '}
            <strong>{totalSolveCount}</strong>{' '}
            {totalSolveCount === 1 ? 'solve' : 'solves'} from this browser. A
            new empty <strong>Session 1</strong> becomes active. Custom-event
            definitions and all application settings are kept. Statistics, PBs,
            averages, Analytics, and solve history reset because their solves
            are gone. Durable session and solve deletion records prevent
            synchronization from restoring the deleted data; Google Drive
            historical snapshots are not deleted. This cannot be undone without
            a previous backup.
          </>
        ),
        cancelLabel: 'Cancel deletion',
        confirmLabel: 'Delete all sessions',
        requireText: 'DELETE ALL SESSIONS',
        onConfirm: confirmDeleteAllSessions,
      }
    }

    if (resetAllOpen) {
      return {
        eyebrow: 'Developer · Danger zone',
        title: 'Reset all solve data?',
        description: (
          <>
            This will permanently remove <strong>{totalSolveCount}</strong>{' '}
            {totalSolveCount === 1 ? 'solve' : 'solves'} from{' '}
            <strong>{sessions.length}</strong>{' '}
            {sessions.length === 1 ? 'session' : 'sessions'} across every event,
            Session names, event assignments,
            inspection and timer preferences, and all
            application settings stay intact. Statistics, PBs, averages,
            Analytics, and solve history reset because their solves are gone.
            This cannot be undone without a previous backup. Google Drive
            historical snapshots are not deleted by this reset; deletion records
            for recorded solves use the existing tombstone system so they cannot
            reappear after synchronization.
          </>
        ),
        cancelLabel: 'Cancel reset',
        confirmLabel: 'Reset all solve data',
        requireText: 'DELETE ALL SOLVES',
        onConfirm: confirmResetAll,
      }
    }

    if (pendingImport) {
      const importedSolveCount = countSolves(pendingImport.sessions.sessions)
      const importedSessionCount = pendingImport.sessions.sessions.length
      const isAdd = pendingImport.importMode === 'add'

      if (isAdd) {
        return {
          eyebrow: 'Import backup',
          title: 'Add imported sessions?',
          description: (
            <>
              Add <strong>{importedSessionCount}</strong>{' '}
              {importedSessionCount === 1 ? 'new session' : 'new sessions'} with{' '}
              <strong>{formatSolveCount(importedSolveCount)}</strong> to your
              existing local data. Existing sessions and solves remain untouched.
              Settings are not changed.
            </>
          ),
          confirmLabel: 'Import sessions',
          cancelLabel: 'Cancel import',
          onConfirm: () => {
            void confirmImport()
          },
        }
      }

      const currentSolveCount = countSolves(sessions)
      const backupTraining = pendingImport.training
        ? summarizeTrainingData(pendingImport.training.data)
        : null
      const localTraining = savedTrainingData
        ? summarizeTrainingData(savedTrainingData)
        : null

      return {
        eyebrow: 'Import backup',
        title: backupTraining
          ? 'Replace local sessions and Training?'
          : 'Replace local sessions?',
        description: (
          <>
            Replace <strong>{formatSolveCount(currentSolveCount)}</strong> across{' '}
            <strong>
              {sessions.length === 1
                ? '1 session'
                : `${sessions.length} sessions`}
            </strong>{' '}
            with <strong>{formatSolveCount(importedSolveCount)}</strong> across{' '}
            <strong>
              {importedSessionCount === 1
                ? '1 session'
                : `${importedSessionCount} sessions`}
            </strong>
            . Settings will also be restored.{' '}
            {backupTraining ? (
              <>
                Training history will be replaced: the backup contains{' '}
                <strong>{formatTrainingCount(backupTraining.attempts)}</strong>{' '}
                {backupTraining.attempts === 1 ? 'attempt' : 'attempts'},{' '}
                <strong>{formatTrainingCount(backupTraining.sessions)}</strong>{' '}
                {backupTraining.sessions === 1 ? 'saved session' : 'saved sessions'}{' '}
                and <strong>{formatTrainingCount(backupTraining.calibrations)}</strong>{' '}
                {backupTraining.calibrations === 1
                  ? 'calibration'
                  : 'calibrations'}
                {formatTrainingAttemptRange(
                  backupTraining.firstAttemptAt,
                  backupTraining.lastAttemptAt,
                )}
                .{' '}
                {localTraining ? (
                  <>
                    This replaces the local store ({formatTrainingCount(localTraining.attempts)}{' '}
                    {localTraining.attempts === 1 ? 'attempt' : 'attempts'},{' '}
                    {formatTrainingCount(localTraining.sessions)}{' '}
                    {localTraining.sessions === 1 ? 'saved session' : 'saved sessions'}
                    , {formatTrainingCount(localTraining.calibrations)}{' '}
                    {localTraining.calibrations === 1
                      ? 'calibration'
                      : 'calibrations'}
                    ).{' '}
                  </>
                ) : (
                  <>
                    Local Training history is unreadable, so the backup will
                    replace it.{' '}
                  </>
                )}
                Imported Training sessions stay ended and are not resumed.
              </>
            ) : (
              <>This backup has no Training section, so local Training stays unchanged.</>
            )}{' '}
            Export first if you need a copy.
          </>
        ),
        cancelLabel: 'Cancel import',
        confirmLabel: 'Import backup',
        requireText: undefined,
        onConfirm: () => {
          void confirmImport()
        },
      }
    }

    if (convertToPracticeOpen) {
      return {
        eyebrow: 'Convert session',
        title: `Convert “${activeSession.name}” to practice?`,
        description: (
          <>
            This removes the competition format and flattens every round in this
            session. Solves, times, penalties, scrambles, comments, dates,
            personal bests and Analytics history stay intact. Practice sessions
            cannot be converted back into competition sessions because their
            rounds never existed. This cannot be undone without a previous
            backup.
          </>
        ),
        cancelLabel: 'Keep competition',
        confirmLabel: 'Convert to practice',
        requireText: 'CONVERT TO PRACTICE',
        onConfirm: confirmConvertToPractice,
      }
    }

    if (sessionToDelete) {
      return {
        eyebrow: 'Delete session',
        title: `Delete “${sessionToDelete.name}”?`,
        description: (
          <>
            This will permanently remove{' '}
            <strong>{formatSolveCount(sessionToDelete.solves.length)}</strong>{' '}
            from this browser. The other sessions stay intact.
          </>
        ),
        cancelLabel: 'Keep session',
        confirmLabel: 'Delete session',
        requireText: 'DELETE THIS SESSION',
        onConfirm: confirmDeleteSession,
      }
    }

    if (clearOpen) {
      return {
        eyebrow: 'Clear session',
        title: 'Delete every solve?',
        description: (
          <>
            This will permanently remove{' '}
            <strong>{formatSolveCount(solves.length)}</strong> from{' '}
            <strong>{activeSession.name}</strong>. Your other sessions and
            settings stay intact.
          </>
        ),
        cancelLabel: 'Keep solves',
        confirmLabel: 'Clear session',
        requireText: 'CLEAR THIS SESSION',
        onConfirm: confirmClear,
      }
    }

    return null
  }, [
    activeSession.name,
    clearOpen,
    confirmClear,
    confirmConvertToPractice,
    confirmDeleteAllSessions,
    confirmDeleteSession,
    confirmImport,
    convertToPracticeOpen,
    confirmResetAll,
    confirmSiteReset,
    deleteAllOpen,
    pendingImport,
    resetAllOpen,
    savedTrainingData,
    sessionToDelete,
    sessions,
    siteResetOpen,
    solves.length,
    totalSolveCount,
  ])

  const handleConfirm = useCallback(() => {
    confirmContent?.onConfirm()
  }, [confirmContent])

  const handleToastAction = useCallback(() => {
    const action = toast?.onAction
    // Dismiss the original action toast first so a replacement notification
    // created by the callback is not cleared by this handler.
    dismissToast()
    action?.()
  }, [dismissToast, toast])

  // One global keyboard controller keeps Space reliable even if the pointer is
  // over another panel. Space is reserved for timing except in text-entry
  // fields; buttons and switches remain keyboard-operable with Enter.
  useEffect(() => {
    if (view !== 'timer' && !(view === 'training' && trainingWorkspace)) return
    const isActive = timer.state.status !== 'idle'

    const handleKeyDown = (event: KeyboardEvent) => {
      if (modalOpen) return
      if (event.metaKey || event.ctrlKey || event.altKey) return

      if (event.key === 'Escape') {
        if (isActive) {
          event.preventDefault()
          timerCancel()
        }
        return
      }

      if (
        (view === 'training' ? settings.stopWithAnyKey : effectiveSettings.stopWithAnyKey) &&
        timer.state.status === 'running' &&
        !event.repeat &&
        !isModifierKey(event.key) &&
        !isTextEntryTarget(event.target) &&
        !isSpaceControlTarget(event.target) &&
        !(event.target instanceof Element && event.target.closest('[data-sidebar-divider]'))
      ) {
        // The optional any-key stop is intentionally limited to a running
        // timer. Tab is allowed through so keyboard focus can still move.
        if (event.key !== 'Tab') event.preventDefault()
        timerPress('keyboard')
        return
      }

      if (event.code !== 'Space') return

      // Space is reserved for timing throughout the app, including while a
      // button is focused. Keyboard users can activate those buttons with
      // Enter, so timer input never becomes dependent on current focus.
      // Disclosure and custom-combobox controls keep their own Space behavior
      // instead of accidentally starting the timer.
      if (isTextEntryTarget(event.target)) return
      if (isSpaceControlTarget(event.target)) return
      if (event.target instanceof Element && event.target.closest('[data-sidebar-divider]')) return
      event.preventDefault()
      if (event.repeat) return
      if (timer.state.status === 'idle' && !canStart) return

      timerPress('keyboard')
    }

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return
      // A keyboard hold must be releasable even if focus moved into a text
      // field, a tool, or a modal while Space was down. Otherwise the timer
      // stays armed but the next press is ignored.
      const keyboardHold =
        timer.state.status === 'holding' || timer.state.status === 'ready'
      if (!keyboardHold) {
        if (modalOpen) return
        if (isTextEntryTarget(event.target)) return
        if (isSpaceControlTarget(event.target)) return
      }
      event.preventDefault()
      timerRelease('keyboard')
    }

    window.addEventListener('keydown', handleKeyDown, { passive: false })
    window.addEventListener('keyup', handleKeyUp, { passive: false })
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [
    canStart,
    modalOpen,
    effectiveSettings.stopWithAnyKey,
    settings.stopWithAnyKey,
    timerCancel,
    timerPress,
    timerRelease,
    timer.state.status,
    trainingWorkspace,
    view,
  ])

  useEffect(() => {
    if (createSessionOpenPrev.current && !createSessionOpen && timer.state.status === 'idle') {
      window.setTimeout(() => {
        document.querySelector<HTMLElement>('[data-testid="session-select"]')?.focus()
      }, 0)
    }
    createSessionOpenPrev.current = createSessionOpen
  }, [createSessionOpen, timer.state.status])

  const appShellClassName = [
    'app-shell',
    settings.showTimerDecimalSmall ? 'is-decimal-small' : '',
    settings.scrambleLimitHeight ? 'is-scramble-height-limited' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const sessionSummaryContent = useMemo(
    () =>
      settings.showSessionSolveProgress || settings.showSessionTotalTime ? (
        <>
          {settings.showSessionSolveProgress ? (
            <span
              className="session-summary-item"
              data-testid="session-solve-progress"
              aria-label={`${sessionSummary.completed.toLocaleString()} of ${sessionSummary.total.toLocaleString()} solves completed in ${activeSession.name}`}
              title="Completed (non-DNF) / total solves in this session"
            >
              {sessionSummary.completed.toLocaleString()} /{' '}
              {sessionSummary.total.toLocaleString()}
            </span>
          ) : null}
          {settings.showSessionSolveProgress &&
          settings.showSessionTotalTime ? (
            <span className="session-summary-separator" aria-hidden="true">
              ·
            </span>
          ) : null}
          {settings.showSessionTotalTime ? (
            <span
              className="session-summary-item"
              data-testid="session-total-time"
              aria-label={`Total completed solve time for ${activeSession.name}: ${formatSessionHours(sessionSummary.totalTimeMs).replace(/ h$/, ' hours')}`}
              title="Sum of completed solve times; DNFs excluded, +2 included"
            >
              {formatSessionHours(sessionSummary.totalTimeMs)}
            </span>
          ) : null}
        </>
      ) : null,
    [
      activeSession.name,
      sessionSummary,
      settings.showSessionSolveProgress,
      settings.showSessionTotalTime,
    ],
  )

  const appShellStyle = {
    '--ui-scale': `${settings.uiZoomPercent / 100}`,
  } as React.CSSProperties

  if (onboarding) {
    return (
      <div
        className={`${appShellClassName} onboarding-shell`}
        data-accent={settings.appearance.accent ? 'custom' : settings.accentColor}
        data-theme={resolvedTheme}
        data-ui-zoom={settings.uiZoomPercent}
        style={appShellStyle}
      >
        <Suspense
          fallback={
            <main className="onboarding-loading" role="status">
              <span className="onboarding-spinner" aria-hidden="true" />
              Opening setup…
            </main>
          }
        >
          <Onboarding
            mode={onboarding.mode}
            {...(onboarding.draft ? { initialDraft: onboarding.draft } : {})}
            sessionsData={syncSessionsData}
            settings={settings}
            sync={sync}
            transport={driveTransport}
            drawScrambleMode={drawScrambleMode}
            onDrawScrambleModeChange={setDrawScrambleMode}
            onChangeSettings={updateSettings}
            onCommitSetup={handleOnboardingCommitSetup}
            onImportBackup={handleOnboardingImportBackup}
            onMarkComplete={handleOnboardingMarkComplete}
            onSkip={handleOnboardingSkip}
            onClose={handleOnboardingClose}
            onFinish={handleOnboardingFinish}
          />
        </Suspense>
      </div>
    )
  }

  return (
    <div
      className={appShellClassName}
      data-accent={settings.appearance.accent ? 'custom' : settings.accentColor}
      data-theme={resolvedTheme}
      data-ui-zoom={settings.uiZoomPercent}
      style={appShellStyle}
    >
      <AppHeader
        sessionName={activeSession.name}
        event={activeEvent}
        inspectionEnabled={activeInspectionEnabled}
        onOpenSettings={handleOpenSettings}
        settingsLocked={timerActive || Boolean(requiredReport) || trainingIdle}
        storageOk={storageHealthy}
        view={view}
        onNavigate={handleNavigate}
      />

      {view === 'training' && training.state.closedSessionName ? <div className="training-notice" role="status">
        <span>{training.state.closedSessionName} ended when the site closed.</span>
        <button type="button" onClick={training.controller.dismissClosureNotice}>Dismiss</button>
      </div> : null}
      {training.state.pendingSave && view !== 'training' && !requiredReport ? <div className="training-notice" role="alert" data-timer-space-ignore>
        <span>Training changes weren’t saved. Keep this page open.</span>
        <button type="button" disabled={timerActive} onClick={training.controller.retrySave}>Retry save</button>
        <button type="button" onClick={() => downloadTrainingRecovery(training.controller)}>Download recovery copy</button>
      </div> : null}
      {(training.state.needsContinuity || (view === 'training' && !savedTrainingSession && training.state.data?.activeVisitId)) ? <div className="training-notice" role="status" data-timer-space-ignore>
        <span>{savedTrainingSession ? `Unfinished Training session: ${savedTrainingSession.session?.name}` : 'Finish your previous Training visit before starting a session.'}</span>
        {savedTrainingSession ? <>
          <button type="button" disabled={timerActive || training.state.pendingSave} onClick={() => {
            training.controller.resumeSession(() => routeTo('training'))
          }}>{view === 'training' ? 'Resume session' : 'Continue session'}</button>
          <button type="button" disabled={timerActive || training.state.pendingSave} onClick={() => endTrainingSession(view)}>End session</button>
        </> : <button type="button" disabled={timerActive || training.state.pendingSave} onClick={() => {
          if (training.state.needsContinuity && training.state.data?.visits.find(v => v.id === training.state.data?.activeVisitId)?.lifecycle) training.controller.recover('closed')
          else training.controller.finishLegacyVisit()
        }}>End visit</button>}
      </div> : null}
      {trainingEndRequest ? <TrainingEndConfirmation key={trainingEndRequest.destination}
        anchor={trainingEndRequest.anchor} leave={trainingEndRequest.destination !== 'training'}
        onClose={() => setTrainingEndRequest(null)} onConfirm={() => endTrainingSession(trainingEndRequest.destination)} /> : null}
      {view === 'timer' ? (
      <main className="workspace">
        <h1 className="sr-only">CubeLab — offline speedcubing timer</h1>
        <div className="primary-column">
          <ScramblePanel
            event={activeEvent}
            scramble={scramble}
            isLoading={scrambleLoading}
            error={scrambleError}
            canRegenerate={
              !timerActive &&
              !isUnscrambledEvent(activeEvent) &&
              !scrambleLoading &&
              scramble !== null
            }
            onRegenerate={handleRegenerate}
            onRetry={retryScramble}
            showReload={scrambleRecoveryRequired}
            canReload={timer.state.status === 'idle' && storageHealthy}
            onReload={handleReloadScramble}
            onNotify={(message) => showToast({ message })}
            scrambleAction={effectiveSettings.scrambleAction}
            alignment={effectiveSettings.scrambleAlignment}
            limitHeight={effectiveSettings.scrambleLimitHeight}
            placeholder={isUnscrambledEvent(activeEvent)}
            activeTool={currentTool}
            toolPanelOpen={toolPanelOpen}
            onToggleToolPanel={() => setToolPanelOpen(!toolPanelOpen)}
          />

          <TimerStage
            state={timer.state}
            eventLabel={getEventLabel(activeEvent)}
            timerUpdateMode={effectiveSettings.timerUpdateMode}
            inspectionElapsedMs={timer.inspectionElapsedMs}
            holdProgress={timer.holdProgress}
            latestSolve={solves[0] ?? null}
            disabled={!canStart && !timerActive}
            disabledHint={
              scrambleError
                ? 'Scramble unavailable. Retry above.'
                : 'Generating scramble…'
            }
            showTimerDecimalSmall={effectiveSettings.showTimerDecimalSmall}
            hideEvenTimerSeconds={effectiveSettings.hideEvenTimerSeconds}
            inspectionEnabled={activeInspectionEnabled}
            inspectionCountDirection={effectiveSettings.inspectionCountDirection}
            alert={timerAlert}
            inspectionWarningVisualScope={effectiveSettings.inspectionWarningVisualScope}
            onPress={timerPress}
            onRelease={timer.release}
            onCancel={handleCancel}
            overlay={
              toolPanelOpen ? (
                <ToolPanel
                  scramble={scramble}
                  event={activeEvent}
                  mode={drawScrambleMode}
                  onSelectMode={setDrawScrambleMode}
                  activeTool={currentTool}
                  onSelectTool={setCurrentTool}
                  solves={insightSolves}
                  timerActive={timerActive || insightSolves !== solves}
                  trimming={averageTrimming}
                  timeTrendScale={settings.timeTrendScale}
                  timeTrendCutoff={settings.timeTrendCutoff}
                  roundLabel={latestRoundLabel}
                  onSetPenalty={handleSetPenalty}
                  onSetComment={handleSetComment}
                  onDeleteSolve={handleDelete}
                  onNotify={handleNotify}
                />
              ) : null
            }
          />

          <div className="session-caption">
            <span
              className="caption-session"
              data-testid="session-footer-summary"
            >
              {sessionSummaryContent ? (
                <span
                  className="session-footer-summary"
                  role="group"
                  aria-label="Current session summary"
                >
                  {sessionSummaryContent}
                </span>
              ) : stats.count === 0 ? (
                'No solves yet'
              ) : (
                `${stats.count === 1 ? '1 solve' : `${stats.count} solves`} this session`
              )}
            </span>
            {settings.statVisibility.ao5 || settings.statVisibility.ao12 ? (
              <span className="quick-stats" aria-label="Current averages">
                {settings.statVisibility.ao5 ? (
                  <span>
                    <span>ao5</span>
                    <strong>
                      {formatStatValue(latestAo5, settings.statPrecision)}
                    </strong>
                  </span>
                ) : null}
                {settings.statVisibility.ao12 ? (
                  <span>
                    <span>ao12</span>
                    <strong>
                      {formatStatValue(latestAo12, settings.statPrecision)}
                    </strong>
                  </span>
                ) : null}
              </span>
            ) : null}
            <div className="session-caption-legal">
              <AppVersion />
              <LegalLinks className="app-legal-links" />
            </div>
          </div>
        </div>

        <aside className="side-column" aria-label="Sessions and solve insights">
          <SessionPanel
            sessions={visibleSessions}
            activeSessionId={activeSessionId}
            locked={timerActive}
            onRequestCreate={() => setCreateSessionOpen(true)}
            onSelect={handleSelectSession}
            onOpenSessionSettings={handleOpenSessionSettings}
            onReorder={handleReorderSession}
          />

          <SidebarSplit
            historyLabel="Solves"
            percent={settings.statsPanelHeightPercent ?? DEFAULT_STATS_SPLIT}
            onPercentChange={statsPanelHeightPercent => updateSettings({ statsPanelHeightPercent })}
            statistics={layout => (
              <StatsPanel
                stats={stats}
                visibleStats={settings.statVisibility}
                customAverages={settings.customAverages}
                metricVisibility={settings.statMetricVisibility}
                precision={settings.statPrecision}
                solves={insightSolves}
                trimming={averageTrimming}
                competition={competition ?? undefined}
                {...layout}
              />
            )}
          >
            <SolveHistory
              key={activeSession.id}
              solves={insightSolves}
              competition={competition ?? undefined}
              onSetPenalty={handleSetPenalty}
              onDelete={handleDelete}
              onSetComment={handleSetComment}
              onNotify={handleNotify}
            />
          </SidebarSplit>
        </aside>
      </main>
      ) : view === 'training' ? (
        <Suspense fallback={<TrainingSkeleton />}>
          {training.state.data && (!savedTrainingSession || !trainingWorkspace) ? (
            <TrainingHub key={`training-hub-${training.state.storeEpoch}`}
              data={training.controller.getSavedData() ?? training.state.data} controller={training.controller}
              hidden={trainingWorkspace} pendingSave={training.state.pendingSave}
              locked={Boolean(requiredReport || training.state.data.activeVisitId || training.state.needsContinuity || training.state.pendingSave)}
              error={training.state.error} onOpenHistory={reviewId => setTrainingArchive({ reviewId })}
              onOpenAlgorithms={() => routeTo('analytics', 'algorithms')} />
          ) : null}
          {trainingWorkspace || !training.state.data ? (
            <TrainingPage controller={training.controller} state={training.state} timer={timer} sessionFlow
            settings={settings} onPress={timerPress} onCancel={handleCancel} onModalChange={setTrainingModalOpen} onNotify={handleNotify} onDeleteAttempt={handleDeleteTrainingAttempt} showUpcomingCase={trainingShowUpcomingCase}
            onRequestEnd={anchor => setTrainingEndRequest({ anchor, destination: 'training' })} lifecycleLocked={trainingLifecycleLocked}
            toastHostRef={setTrainingToastHost} />
          ) : null}
        </Suspense>
      ) : (<>
        <nav className="analytics-view-switcher" aria-label="Analytics views">
          <button type="button" className="button button-secondary button-small" aria-pressed={analyticsMode === 'solves'}
            onClick={() => showAnalyticsMode('solves')}>Solves</button>
          <button type="button" className="button button-secondary button-small" aria-pressed={analyticsMode === 'algorithms'}
            onClick={() => showAnalyticsMode('algorithms')}>Algorithms</button>
        </nav>
        <Suspense
          fallback={<AnalyticsSkeleton />}
        >
          {analyticsOpened.solves ? <AnalyticsPage
            sessions={sessions}
            initialEvent={activeEvent}
            settings={settings}
            onChange={updateSettings}
            hidden={analyticsMode !== 'solves'}
          /> : null}
          {analyticsOpened.algorithms ? <AlgorithmsAnalytics data={savedTrainingData} hidden={analyticsMode !== 'algorithms'}
            onStart={() => routeTo('training')} onHistory={setTrainingArchive} /> : null}
        </Suspense>
      </>)}

      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>

      <SettingsDialog
        open={settingsOpen}
        settings={settings}
        storageOk={storageHealthy}
        sessionCount={sessions.length}
        solveCount={totalSolveCount}
        drawScrambleMode={drawScrambleMode}
        onDrawScrambleModeChange={setDrawScrambleMode}
        onChange={updateSettings}
        onOpenBackup={handleOpenBackup}
        onOpenDriveBackup={handleOpenDriveBackup}
        onOpenOnboarding={handleOpenOnboardingFromSettings}
        onRequestResetAllSolveData={handleOpenResetAll}
        resetAllDisabledReason={resetAllDisabledReason}
        onRequestDeleteAllSessions={handleOpenDeleteAllSessions}
        deleteAllSessionsDisabledReason={deleteAllSessionsDisabledReason}
        onRequestResetAllSiteData={handleOpenSiteReset}
        developerSyncStatus={developerSyncStatus}
        lastSyncAt={sync.lastSyncAt}
        trainingData={training.state.data}
        showUpcomingCase={trainingShowUpcomingCase}
        onShowUpcomingCaseChange={handleTrainingUpcomingCaseChange}
        onUpdateTrainingSettings={handleUpdateTrainingSettings}
        onClose={() => setSettingsOpen(false)}
      />

      <SessionSettingsDialog
        open={sessionSettingsOpen}
        sessions={sessions}
        session={activeSession}
        effectiveInspectionEnabled={activeInspectionEnabled}
        canDelete={sessions.length > 1}
        onRenameSession={(id, name) => handleRenameSession(id, name)}
        onSetSessionEvent={(id, event) => handleSetSessionEvent(id, event)}
        onSetInspection={handleSetSessionInspection}
        onRequestClear={requestClear}
        onRequestDelete={requestDeleteSession}
        onRequestMerge={handleOpenMergeSessions}
        onRequestSplit={handleOpenSplitSession}
        onRequestConvertToPractice={requestConvertToPractice}
        onClose={() => setSessionSettingsOpen(false)}
      />

      <RoundSummaryDialog
        round={roundSummary}
        rounds={competition?.rounds ?? []}
        format={roundSummary && isCompetitionSession(activeSession)
          ? activeSession.competitionFormat
          : { type: 'ao', size: 5 }}
        precision={settings.statPrecision}
        onClose={() => setRoundSummary(null)}
      />

      {dataOpen ? (
        <Suspense fallback={<DialogLoadingFallback />}>
          <DataDialog
            open
            sessions={sessions}
            sessionCount={sessions.length}
            solveCount={countSolves(sessions)}
            trainingData={
              trainingBackupSnapshot.status === 'absent'
                ? null
                : savedTrainingData
            }
            trainingUnreadable={training.state.data === null}
            trainingIncluded={trainingBackupSnapshot.status === 'ready'}
            trainingExportBlockedReason={
              trainingBackupSnapshot.status === 'blocked'
                ? trainingBackupSnapshot.reason
                : null
            }
            trainingImportBlockedReason={trainingImportBlockedReason()}
            onClose={handleCloseData}
            onExport={handleExport}
            onImport={handleImportRequested}
          />
        </Suspense>
      ) : null}

      {driveOpen ? (
        <Suspense fallback={<DialogLoadingFallback />}>
          <DriveBackupDialog
            open
            transport={driveTransport}
            sessions={{
              activeSessionId,
              sessions,
              ...(customEvents.length > 0 ? { customEvents } : {}),
              ...(sessionOrder ? { sessionOrder } : {}),
              ...(sessionTransfers ? { sessionTransfers } : {}),
            }}
            settings={settings}
            storageOk={storageHealthy}
            sync={sync}
            training={training}
            trainingSync={trainingSync}
            timerStatusRef={timerStatusRef}
            onClose={handleCloseDrive}
            onNotify={(message) => showToast({ message })}
            onPendingRestore={handleDriveRestorePending}
            onReviewDuplicateNames={() => setMergeSessionsOpen(true)}
          />
        </Suspense>
      ) : null}

      {pendingDriveRestore ? (
        <ConfirmDialog
          open={true}
          eyebrow="Restore Google Drive backup"
        title="Replace local sessions?"
        description={`Replace ${countSolves(sessions)} solves across ${sessions.length} sessions with ${countSolves(pendingDriveRestore.sessions.sessions)} solves across ${pendingDriveRestore.sessions.sessions.length} sessions. Settings will also be restored.`}

        cancelLabel="Cancel restore"
        confirmLabel="Restore backup"
        requireText="RESTORE FROM DRIVE"
        onCancel={cancelDriveRestore}
        onConfirm={confirmDriveRestore}
      />
) : null}

      <ConfirmDialog
        open={confirmContent !== null}
        eyebrow={confirmContent?.eyebrow ?? ''}
        title={confirmContent?.title ?? ''}
        description={confirmContent?.description ?? null}
        details={confirmContent?.details}
        cancelLabel={confirmContent?.cancelLabel ?? 'Cancel'}
        confirmLabel={confirmContent?.confirmLabel ?? 'Confirm'}
        requireText={confirmContent?.requireText}
        onCancel={cancelConfirm}
        onConfirm={handleConfirm}
      />

      {mergeSessionsOpen ? (
        <Suspense fallback={<DialogLoadingFallback />}>
          <MergeSessionsDialog
            open
            sessions={{
              activeSessionId,
              sessions,
              ...(customEvents.length > 0 ? { customEvents } : {}),
              ...(sessionOrder ? { sessionOrder } : {}),
              ...(sessionTransfers ? { sessionTransfers } : {}),
            }}
            initialTargetId={mergeInitialTargetId ?? undefined}
            onClose={closeMergeSessions}
            onMerge={handleMergeSessions}
          />
        </Suspense>
      ) : null}

      {splitSessionSource !== null ? (
        <Suspense fallback={<DialogLoadingFallback />}>
          <SplitSessionDialog
            open
            session={splitSessionSource}
            sessions={sessions}
            onClose={closeSplitSession}
            onSplit={(name, solveIds, competitionFormat) =>
              splitSessionSource
                ? handleSplitSession(
                    splitSessionSource.id,
                    name,
                    solveIds,
                    competitionFormat,
                  )
                : null
            }
          />
        </Suspense>
      ) : null}

      <SessionSetupDialog
        open={createSessionOpen}
        sessions={sessions}
        defaultEvent={activeEvent}
        defaultInspectionEnabled={activeInspectionEnabled}
        onClose={() => setCreateSessionOpen(false)}
        onCreate={(name, event, preferences, competitionFormat) =>
          Boolean(
            handleCreateSession(
              name,
              event,
              preferences,
              competitionFormat,
            ),
          )
        }
      />

      {savedTrainingData && trainingArchive && !requiredReport ? <Suspense fallback={<DialogLoadingFallback />}>
        <TrainingArchive data={savedTrainingData} controller={training.controller} request={trainingArchive}
          pendingSave={training.state.pendingSave} error={training.state.error}
          canDelete={!training.state.needsContinuity && !timerActive} onClose={() => setTrainingArchive(null)} />
      </Suspense> : null}

      {savedTrainingData && (requiredReport || (trainingIdle && !trainingModalOpen && !settingsOpen && !trainingEndRequest)) ? (
        <Suspense fallback={<DialogLoadingFallback />}>
          {requiredReport ? <TrainingLifecycleDialog key={requiredReport.id} reportId={requiredReport.id}
            controller={training.controller} data={savedTrainingData} pendingSave={training.state.pendingSave} error={training.state.error}
            onDone={() => training.controller.closeSessionReport(requiredReport.id, () => routeTo(requiredReport.lifecycle?.reportDestination ?? view))} />
            : <TrainingLifecycleDialog controller={training.controller} data={savedTrainingData} pendingSave={training.state.pendingSave}
              error={training.state.error} onEnd={() => endTrainingSession('training')} />}
        </Suspense>
      ) : null}

      {siteResetPhase === 'resetting' || remoteSiteReset ? (
        <div
          className="dialog-loading-overlay"
          data-testid="site-reset-progress"
          role="status"
          aria-live="polite"
        >
          {siteResetPhase === 'resetting'
            ? 'Resetting CubeLab…'
            : remoteSiteReset === 'failed'
              ? 'Another CubeLab tab could not finish resetting site data. This tab is locked to prevent stale writes. Retry or close that tab.'
              : 'Another CubeLab tab is resetting site data…'}
        </div>
      ) : null}

      {siteResetPhase === 'failed' && siteResetResult ? (
        <ConfirmDialog
          open
          eyebrow="Developer · Danger zone"
          title="Reset could not finish"
          description={
            <>
              CubeLab did not report success. Google Drive synchronization
              remains disabled, local sign-in remains blocked, and other
              CubeLab tabs stay locked to prevent stale writes. Close other
              CubeLab tabs, then retry.
            </>
          }
          details={
            <ul>
              {siteResetResult.errors.map((error, index) => (
                <li key={`${index}-${error}`}>{error}</li>
              ))}
            </ul>
          }
          cancelLabel="Reload without finishing"
          confirmLabel="Retry reset"
          onCancel={abandonSiteReset}
          onConfirm={retrySiteReset}
        />
      ) : null}

      {trainingToastHost
        ? createPortal(<Toast toast={toast} onAction={handleToastAction} onDismiss={dismissToast} />, trainingToastHost)
        : <Toast toast={toast} onAction={handleToastAction} onDismiss={dismissToast} />}
    </div>
  )
}
