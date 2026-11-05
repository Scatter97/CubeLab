import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { AppHeader, type AppView } from './components/AppHeader'
import { ConfirmDialog } from './components/ConfirmDialog'
import { ScramblePanel } from './components/ScramblePanel'
import { ToolPanel } from './components/ToolPanel'
import { useDrawScrambleMode } from './hooks/useDrawScrambleMode'
import { SessionPanel } from './components/SessionPanel'
import { AppVersion } from './components/AppVersion'
import { SessionSettingsDialog } from './components/SessionSettingsDialog'
import { SettingsDialog } from './components/SettingsDialog'
import { SolveHistory } from './components/SolveHistory'
import { StatsPanel } from './components/StatsPanel'
import { TimerStage } from './components/TimerStage'
import { Toast } from './components/Toast'
import { useScramble } from './hooks/useScramble'
import { useSessions } from './hooks/useSessions'
import { useSettings } from './hooks/useSettings'
import { useTheme } from './hooks/useTheme'
import { useToolPanelOpen } from './hooks/useToolPanelOpen'
import { useTimer } from './hooks/useTimer'
import { usePostPaintValue } from './hooks/usePostPaintValue'
import { useToast } from './hooks/useToast'
import { SessionSetupDialog } from './components/SessionSetupDialog'
import { useSync } from './hooks/useSync'
import {
  inspectionWarningEvents,
  playAlertSound,
  primeAlertAudio,
  vibrateAlert,
  type AlertTone,
} from './lib/alerts'
import {
  backupFileName,
  createBackup,
  serializeBackup,
  type Backup,
} from './lib/backup'
import { getEventLabel, isCustomEventId } from './lib/events'
import { unionCustomEvents, findImportedEventCorrections } from './lib/customEvents'
import { formatSessionHours, formatSolveCount, formatStatValue, formatTime } from './lib/format'
import { countSolves, getSessionMergeError, getSessionSummary, appendSessionsInOrder } from './lib/sessions'
import { getSessionStats } from './lib/stats'
import { createDriveTransport } from './lib/driveTransport'
import { loadDriveBackupState, saveDriveBackupState } from './lib/driveStorage'
import { BUILT_IN_STAT_DEFINITIONS } from './lib/statDefinitions'
import { DEFAULT_TOOL, type CurrentTool } from './lib/tools'
import type {
  AlertChannel,
  Penalty,
  PuzzleEvent,
  SessionPreferences,
  Session,
} from './types'
import type { TimerInput, TimerState } from './timer/machine'

const AnalyticsPage = lazy(() => import('./components/AnalyticsPage'))
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
const CustomEventsDialog = lazy(() =>
  import('./components/CustomEventsDialog').then((module) => ({
    default: module.CustomEventsDialog,
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

function downloadJsonFile(contents: string, fileName: string): void {
  const blob = new Blob([contents], { type: 'application/json' })
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

export default function App() {
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
    renameSession,
    deleteSession,
    selectSession,
    setSessionEvent,
    mergeSessions,
    splitSession,
    moveSession,
    moveSessionTo,
    deleteAllSessions,
    replaceSessions,
    createCustomEvent,
    renameCustomEvent,
    setCustomEventPlaceholder,
    deleteCustomEvent,
    reassignSessionsEvent,
    correctImportedEvents,
  } = useSessions()
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
    setTimerActive: setSettingsTimerActive,
    adoptedFieldsRef: adoptedSettingsFieldsRef,
  } = useSettings()
  const storageHealthy = storageOk && settingsStorageOk
  const resolvedTheme = useTheme(settings.theme)
  const {
    scramble,
    isLoading: scrambleLoading,
    error: scrambleError,
    advance: advanceScramble,
    retry: retryScramble,
  } = useScramble(activeEvent)
  const { toast, showToast, dismissToast } = useToast()
  const driveTransport = useMemo(() => createDriveTransport(), [])

  const [clearOpen, setClearOpen] = useState(false)
  const [resetAllOpen, setResetAllOpen] = useState(false)
  const [resetAwaitingSync, setResetAwaitingSync] = useState(false)
  const [deleteAllOpen, setDeleteAllOpen] = useState(false)
  const [deleteAllAwaitingSync, setDeleteAllAwaitingSync] = useState(false)
  const [driveOpen, setDriveOpen] = useState(false)
  const [pendingDriveRestore, setPendingDriveRestore] = useState<Backup | null>(null)
  const [sessionToDelete, setSessionToDelete] = useState<Session | null>(null)
  const [pendingImport, setPendingImport] = useState<Backup | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [currentTool, setCurrentTool] = useState<CurrentTool>(DEFAULT_TOOL)
  const [view, setView] = useState<AppView>('timer')
  const [toolPanelOpen, setToolPanelOpen] = useToolPanelOpen()
  const [drawScrambleMode, setDrawScrambleMode] = useDrawScrambleMode()
  const [sessionSettingsOpen, setSessionSettingsOpen] = useState(false)

  const [eventManagerOpen, setEventManagerOpen] = useState(false)
  const [mergeSessionsOpen, setMergeSessionsOpen] = useState(false)
  const [mergeInitialTargetId, setMergeInitialTargetId] = useState<
    string | null
  >(null)
  const [mergeOpenedFromSettings, setMergeOpenedFromSettings] =
    useState(false)
  const [splitSessionId, setSplitSessionId] = useState<string | null>(null)
  const [createSessionOpen, setCreateSessionOpen] = useState(false)
  const createSessionOpenPrev = useRef(false)

  const [isDesktopLayout, setIsDesktopLayout] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(min-width: 901px)').matches,
  )
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const media = window.matchMedia('(min-width: 901px)')
    const update = () => setIsDesktopLayout(media.matches)
    update()
    if (media.addEventListener) media.addEventListener('change', update)
    else media.addListener(update)
    return () => {
      if (media.removeEventListener) media.removeEventListener('change', update)
      else media.removeListener(update)
    }
  }, [])

  const sidebarSplitRef = useRef<HTMLDivElement>(null)
  const [statsPanelHeight, setStatsPanelHeight] = useState<number | null>(null)
  const [sidebarHeight, setSidebarHeight] = useState(0)
  const sidebarDragRef = useRef<{
    pointerId: number
    startY: number
    startHeight: number
    containerHeight: number
    scale: number
  } | null>(null)
  const [sidebarDragging, setSidebarDragging] = useState(false)

  const minStatsHeight = 96
  const minSolvesHeight = 120
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
    inspectionEnabled: activeInspectionEnabled,
    holdDurationMs: effectiveSettings.holdDurationMs,
    onSolve: handleSolve,
  })

  useLayoutEffect(() => {
    setSettingsTimerActive(timer.state.status !== 'idle')
  }, [timer.state.status, setSettingsTimerActive])

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

  const sync = useSync({
    transport: driveTransport,
    sessions: syncSessionsData,
    settings,
    storageOk: storageOk && settingsStorageOk,
    timerActive: timer.state.status !== 'idle',
    onReplaceSessions: replaceSessions,
    onReplaceSettings: replaceSettings,
    adoptedSettingsFieldsRef,
    onNotify: (message) => showToast({ message }),
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
    settingsOpen ||
    sessionSettingsOpen ||
    dataOpen ||
    clearOpen ||
    resetAllOpen ||
    deleteAllOpen ||
    sessionToDelete !== null ||
    pendingImport !== null ||
    driveOpen ||
    mergeSessionsOpen ||
    splitSessionSource !== null ||
    createSessionOpen ||
    eventManagerOpen ||
    pendingDriveRestore !== null
  const timerCancel = timer.cancel
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
  const canStart = scramble !== null
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

  const handleOpenSettings = useCallback(() => {
    if (timer.state.status !== 'idle') return
    setSettingsOpen(true)
  }, [timer.state.status])

  const handleNavigate = useCallback(
    (next: AppView) => {
      if (next === 'analytics' && timer.state.status !== 'idle') return
      setView(next)
    },
    [timer.state.status],
  )

  const handleRegenerate = useCallback(() => {
    if (timer.state.status !== 'idle' || scrambleLoading) return
    advanceScramble()
  }, [advanceScramble, scrambleLoading, timer.state.status])

  const handleCancel = useCallback(() => {
    timerCancel()
  }, [timerCancel])

  const handleSetPenalty = useCallback(
    (id: string, penalty: Penalty) => {
      setPenalty(id, penalty)
    },
    [setPenalty],
  )

  const handleSetComment = useCallback(
    (id: string, comment: string) => {
      setComment(id, comment)
    },
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
  const handleNotify = useCallback((message: string) => showToast({ message }), [showToast])
  const handleDelete = useCallback(
    (id: string) => {
      const removed = deleteSolve(id)
      if (!removed) return
      recordDeletion('solve', id, removed.sessionId)

      showToast({
        message: 'Solve deleted',
        actionLabel: 'Undo',
        onAction: () => {
          restoreDeletion('solve', removed.solve.id)
          restoreSolve(removed.solve, removed.index, removed.sessionId)
        },
      })
    },
    [deleteSolve, restoreSolve, showToast, recordDeletion, restoreDeletion],
  )

  const requestClear = useCallback(() => {
    if (timer.state.status === 'idle' && solves.length > 0) {
      setClearOpen(true)
    }
  }, [solves.length, timer.state.status])

  const confirmClear = useCallback(() => {
    for (const solve of activeSession.solves) {
      sync.recordDeletion('solve', solve.id, activeSession.id)
    }
    clearSolves()
    setClearOpen(false)
    setSessionSettingsOpen(false)
    showToast({ message: 'Session cleared' })
  }, [activeSession.id, activeSession.solves, clearSolves, showToast, sync])

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
      showToast({
        message:
          'Solve data could not be saved after the reset. Deletion records are saved; retry after storage recovers.',
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
      showToast({
        message:
          'Sessions could not be saved after deletion. Deletion records are saved; retry after storage recovers.',
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
    ): boolean => {
      if (timer.state.status !== 'idle') return false
      const id = createSession(
        name,
        preferences?.inspectionEnabled ?? activeInspectionEnabled,
        event,
        preferences,
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

  const handleMoveSession = useCallback(
    (id: string, direction: -1 | 1) => {
      if (timer.state.status !== 'idle') return
      moveSession(id, direction)
    },
    [moveSession, timer.state.status],
  )

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

  const handleOpenEventManager = useCallback(() => {
    if (timer.state.status !== 'idle') return
    setSessionSettingsOpen(false)
    setEventManagerOpen(true)
  }, [timer.state.status])

  const handleDeleteCustomEvent = useCallback(
    (id: string): { ok: true } | { ok: false; error: string } => {
      const result = deleteCustomEvent(id)
      if (result.ok) {
        sync.recordDeletion('event', id)
        showToast({ message: 'Custom event deleted' })
      }
      return result
    },
    [deleteCustomEvent, showToast, sync],
  )

  const handleReassignSessionsEvent = useCallback(
    (sessionIds: readonly string[], event: PuzzleEvent): boolean => {
      const changed = reassignSessionsEvent(sessionIds, event)
      if (changed) {
        showToast({
          message: `Reassigned ${sessionIds.length === 1 ? 'session' : `${sessionIds.length} sessions`} to ${getEventLabel(event)}`,
        })
      }
      return changed
    },
    [reassignSessionsEvent, showToast],
  )

  const handleCorrectImportedEvents = useCallback((): number => {
    const moved = correctImportedEvents()
    if (moved > 0) {
      showToast({
        message: `Corrected ${moved === 1 ? '1 imported solve' : `${moved} imported solves`}`,
      })
    }
    return moved
  }, [correctImportedEvents, showToast])

  const importedCorrectionCount = useMemo(
    () =>
      findImportedEventCorrections({
        activeSessionId,
        sessions,
        ...(customEvents.length > 0 ? { customEvents } : {}),
      }).length,
    [activeSessionId, sessions, customEvents],
  )

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
    if (deleted) showToast({ message: 'Session deleted' })
  }, [deleteSession, sessionToDelete, showToast, sync])

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

  const confirmDriveRestore = useCallback(() => {
    if (!pendingDriveRestore) return
    replaceSessions(pendingDriveRestore.sessions)
    replaceSettings(pendingDriveRestore.settings)
    sync.resetBase(pendingDriveRestore.sessions)
    const current = loadDriveBackupState()
    saveDriveBackupState(
      { ...current, lastRestoreAt: Date.now() },
    )
    setPendingDriveRestore(null)
    setDriveOpen(false)
    showToast({ message: 'Google Drive backup restored' })
  }, [pendingDriveRestore, replaceSessions, replaceSettings, showToast, sync])

  const cancelDriveRestore = useCallback(() => {
    setPendingDriveRestore(null)
  }, [])

  const handleExport = useCallback((): boolean => {
    if (timer.state.status !== 'idle') return false

    try {
      const backup = createBackup(
        {
          activeSessionId,
          sessions,
          ...(customEvents.length > 0 ? { customEvents } : {}),
          ...(sessionOrder ? { sessionOrder } : {}),
          ...(sessionTransfers ? { sessionTransfers } : {}),
        },
        settings,
      )
      downloadJsonFile(serializeBackup(backup), backupFileName())
      setDataOpen(false)
      showToast({ message: 'Backup exported' })
      return true
    } catch {
      return false
    }
  }, [activeSessionId, sessions, customEvents, sessionOrder, sessionTransfers, settings, showToast, timer.state.status])

  const handleImportRequested = useCallback((backup: Backup) => {
    setDataOpen(false)
    setPendingImport(backup)
  }, [])

  const confirmImport = useCallback(() => {
    if (!pendingImport) return

    if (pendingImport.importMode === 'add') {
      const imported = pendingImport.sessions.sessions
      const mergedCustomEvents = unionCustomEvents(
        customEvents,
        pendingImport.sessions.customEvents ?? [],
      )
      const merged = appendSessionsInOrder(
        {
          activeSessionId: activeSessionId ?? imported[0]?.id ?? '',
          sessions: [...sessions],
          ...(mergedCustomEvents.length > 0
            ? { customEvents: mergedCustomEvents }
            : {}),
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
      replaceSessions(merged)
      // keep existing settings; do not overwrite
      sync.resetBase(merged)
      setPendingImport(null)
      showToast({ message: 'Backup imported' })
      return
    }

    replaceSessions(pendingImport.sessions)
    replaceSettings(pendingImport.settings)
    sync.resetBase(pendingImport.sessions)
    setPendingImport(null)
    showToast({ message: 'Backup imported' })
  }, [pendingImport, replaceSessions, replaceSettings, showToast, sync, activeSessionId, sessions, customEvents, syncSessionsData.sessionOrder, syncSessionsData.sessionTransfers])

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

      const newSessionId = splitSession(sessionId, name, solveIds)
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
    setClearOpen(false)
    setResetAllOpen(false)
    setDeleteAllOpen(false)
    setSessionToDelete(null)
    setPendingImport(null)
  }, [])

  const confirmContent = useMemo(() => {
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
            including custom events. Session names, event assignments,
            inspection and timer preferences, custom event definitions, and all
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
          onConfirm: confirmImport,
        }
      }

      const currentSolveCount = countSolves(sessions)

      return {
        eyebrow: 'Import backup',
        title: 'Replace local sessions?',
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
            . Settings will also be restored. Export first if you need a copy.
          </>
        ),
        cancelLabel: 'Cancel import',
        confirmLabel: 'Import backup',
        requireText: undefined,
        onConfirm: confirmImport,
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
    confirmDeleteAllSessions,
    confirmDeleteSession,
    confirmImport,
    confirmResetAll,
    deleteAllOpen,
    pendingImport,
    resetAllOpen,
    sessionToDelete,
    sessions,
    solves.length,
    totalSolveCount,
  ])

  const handleConfirm = useCallback(() => {
    confirmContent?.onConfirm()
  }, [confirmContent])

  const handleToastAction = useCallback(() => {
    if (toast?.onAction) toast.onAction()
    dismissToast()
  }, [dismissToast, toast])

  // One global keyboard controller keeps Space reliable even if the pointer is
  // over another panel. Space is reserved for timing except in text-entry
  // fields; buttons and switches remain keyboard-operable with Enter.
  useEffect(() => {
    const isActive = timer.state.status !== 'idle'

    const handleKeyDown = (event: KeyboardEvent) => {
      if (view !== 'timer') return
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
        effectiveSettings.stopWithAnyKey &&
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
      if (view !== 'timer') return
      if (modalOpen || event.code !== 'Space') return
      if (isTextEntryTarget(event.target)) return
      if (isSpaceControlTarget(event.target)) return
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
    timerCancel,
    timerPress,
    timerRelease,
    timer.state.status,
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

  // Sidebar split initialization and drag helpers.
  const clampStatsHeight = useCallback((value: number, containerHeight: number) => {
    const max = Math.max(minStatsHeight, containerHeight - minSolvesHeight)
    return Math.min(Math.max(value, minStatsHeight), max)
  }, [])

  const resetStatsSplit = useCallback(() => {
    const container = sidebarSplitRef.current
    if (container) {
      const target = Math.round(container.clientHeight * 0.36)
      setStatsPanelHeight(clampStatsHeight(target, container.clientHeight))
    }
    updateSettings({ statsPanelHeightPercent: 36 })
  }, [clampStatsHeight, updateSettings])

  const beginSidebarDrag = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return
      const container = sidebarSplitRef.current
      if (!container) return
      event.preventDefault()
      const containerRect = container.getBoundingClientRect()
      const startHeight =
        statsPanelHeight ?? Math.round(container.clientHeight * 0.36)
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        /* noop */
      }
      sidebarDragRef.current = {
        pointerId: event.pointerId,
        startY: event.clientY,
        startHeight,
        containerHeight: container.clientHeight,
        scale: containerRect.height / container.offsetHeight || 1,
      }
      setSidebarDragging(true)
      document.body.style.userSelect = 'none'
    },
    [statsPanelHeight],
  )

  const moveSidebarDrag = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const state = sidebarDragRef.current
      if (!state || state.pointerId !== event.pointerId) return
      event.preventDefault()
      const delta = (event.clientY - state.startY) / state.scale
      const next = clampStatsHeight(state.startHeight + delta, state.containerHeight)
      setStatsPanelHeight(next)
    },
    [clampStatsHeight],
  )

  const endSidebarDrag = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const state = sidebarDragRef.current
      if (!state || state.pointerId !== event.pointerId) return
      sidebarDragRef.current = null
      setSidebarDragging(false)
      document.body.style.userSelect = ''
      try {
        event.currentTarget.releasePointerCapture(event.pointerId)
      } catch {
        /* noop */
      }
      const container = sidebarSplitRef.current
      if (container && statsPanelHeight !== null && container.clientHeight > 0) {
        const percent = Math.round((statsPanelHeight / container.clientHeight) * 100)
        const clampedPercent = Math.min(80, Math.max(20, percent))
        updateSettings({ statsPanelHeightPercent: clampedPercent })
      }
    },
    [statsPanelHeight, updateSettings],
  )

  const cancelSidebarDrag = useCallback(() => {
    sidebarDragRef.current = null
    setSidebarDragging(false)
    document.body.style.userSelect = ''
  }, [])

  // Initialize/restore sidebar split height from settings.
  useEffect(() => {
    const container = sidebarSplitRef.current
    if (!container || statsPanelHeight !== null) return
    const height = container.clientHeight
    if (height <= 0) return
    setSidebarHeight(height)
    const percent = settings.statsPanelHeightPercent ?? 36
    setStatsPanelHeight(clampStatsHeight(Math.round(height * (percent / 100)), height))
  }, [settings.statsPanelHeightPercent, statsPanelHeight, clampStatsHeight, isDesktopLayout])

  // Keep the split usable when the window or sidebar container changes size.
  useEffect(() => {
    const container = sidebarSplitRef.current
    if (!container) return
    const update = () => {
      setSidebarHeight(container.clientHeight)
      if (sidebarDragRef.current) return
      setStatsPanelHeight((previous) => {
        if (previous === null) return previous
        const height = container.clientHeight
        if (height <= 0) return previous
        const percent = settings.statsPanelHeightPercent ?? 36
        return clampStatsHeight(Math.round(height * (percent / 100)), height)
      })
    }
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update)
      return () => window.removeEventListener('resize', update)
    }
    const observer = new ResizeObserver(update)
    observer.observe(container)
    return () => observer.disconnect()
  }, [settings.statsPanelHeightPercent, clampStatsHeight, isDesktopLayout])

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

  return (
    <div
      className={appShellClassName}
      data-accent={settings.accentColor}
      data-theme={resolvedTheme}
      data-ui-zoom={settings.uiZoomPercent}
      style={
        {
          '--ui-scale': `${settings.uiZoomPercent / 100}`,
        } as React.CSSProperties
      }
    >
      <AppHeader
        sessionName={activeSession.name}
        event={activeEvent}
        inspectionEnabled={activeInspectionEnabled}
        onOpenSettings={handleOpenSettings}
        settingsLocked={timerActive}
        storageOk={storageHealthy}
        view={view}
        onNavigate={handleNavigate}
      />

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
              !isCustomEventId(activeEvent) &&
              !scrambleLoading &&
              scramble !== null
            }
            onRegenerate={handleRegenerate}
            onRetry={retryScramble}
            onNotify={(message) => showToast({ message })}
            scrambleAction={effectiveSettings.scrambleAction}
            alignment={effectiveSettings.scrambleAlignment}
            limitHeight={effectiveSettings.scrambleLimitHeight}
            placeholder={isCustomEventId(activeEvent)}
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
                  activeTool={currentTool}
                  onSelectTool={setCurrentTool}
                  solves={insightSolves}
                  timerActive={timerActive || insightSolves !== solves}
                  trimming={averageTrimming}
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
            <AppVersion />
          </div>
        </div>

        <aside className="side-column" aria-label="Sessions and solve insights">
          <SessionPanel
            sessions={visibleSessions}
            activeSessionId={activeSessionId}
            locked={timerActive}
            onCreate={handleCreateSession}
            onRequestCreate={() => setCreateSessionOpen(true)}
            onRename={handleRenameSession}
            onSelect={handleSelectSession}
            onOpenSessionSettings={handleOpenSessionSettings}
            onMove={handleMoveSession}
            onReorder={handleReorderSession}
          />

          {isDesktopLayout ? (
            <div className="sidebar-split" ref={sidebarSplitRef}>
              <StatsPanel
                stats={stats}
                visibleStats={settings.statVisibility}
                customAverages={settings.customAverages}
                precision={settings.statPrecision}
                style={{ height: statsPanelHeight ?? undefined }}
              />

              <div
                className={`sidebar-divider${sidebarDragging ? ' is-dragging' : ''}`}
                role="separator"
                aria-orientation="horizontal"
                aria-label="Resize Statistics and Solves panels"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={
                  statsPanelHeight && statsPanelHeight > 0
                    ? Math.round((statsPanelHeight / (sidebarHeight || statsPanelHeight)) * 100)
                    : undefined
                }
                tabIndex={0}
                data-sidebar-divider="true"
                data-divider="stats-solves"
                data-resize-handle="true"
                data-testid="stats-solves-divider"
                data-testid-alt="sidebar-resize-handle"
                onPointerDown={beginSidebarDrag}
                onPointerMove={moveSidebarDrag}
                onPointerUp={endSidebarDrag}
                onPointerCancel={cancelSidebarDrag}
                onDoubleClick={resetStatsSplit}
                onKeyDown={(event) => {
                  const container = sidebarSplitRef.current
                  if (!container) return
                  const step = event.shiftKey ? 48 : 16
                  if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
                    event.preventDefault()
                    const next = clampStatsHeight(
                      (statsPanelHeight ?? 0) + step,
                      container.clientHeight,
                    )
                    setStatsPanelHeight(next)
                    const percent = Math.round((next / container.clientHeight) * 100)
                    updateSettings({
                      statsPanelHeightPercent: Math.min(80, Math.max(20, percent)),
                    })
                  } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
                    event.preventDefault()
                    const next = clampStatsHeight(
                      (statsPanelHeight ?? 0) - step,
                      container.clientHeight,
                    )
                    setStatsPanelHeight(next)
                    const percent = Math.round((next / container.clientHeight) * 100)
                    updateSettings({
                      statsPanelHeightPercent: Math.min(80, Math.max(20, percent)),
                    })
                  } else if (event.key === 'Home') {
                    event.preventDefault()
                    setStatsPanelHeight(minStatsHeight)
                    updateSettings({ statsPanelHeightPercent: 20 })
                  } else if (event.key === 'End') {
                    event.preventDefault()
                    const max = container.clientHeight - minSolvesHeight
                    setStatsPanelHeight(Math.max(minStatsHeight, max))
                    updateSettings({ statsPanelHeightPercent: 80 })
                  } else if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    resetStatsSplit()
                  }
                }}
              >
                <span className="sidebar-divider-grip" aria-hidden="true" />
              </div>

              <SolveHistory
                key={activeSession.id}
                solves={insightSolves}
                onSetPenalty={handleSetPenalty}
                onDelete={handleDelete}
                onSetComment={handleSetComment}
                onNotify={handleNotify}
              />
            </div>
          ) : (
            <>
              <StatsPanel
                stats={stats}
                visibleStats={settings.statVisibility}
                customAverages={settings.customAverages}
                precision={settings.statPrecision}
                showAllRows
              />
              <SolveHistory
                key={activeSession.id}
                solves={insightSolves}
                onSetPenalty={handleSetPenalty}
                onDelete={handleDelete}
                onSetComment={handleSetComment}
                onNotify={handleNotify}
              />
            </>
          )}
        </aside>
      </main>
      ) : (
        <Suspense
          fallback={
            <main className="analytics-page analytics-loading" role="status">
              Loading analytics…
            </main>
          }
        >
          <AnalyticsPage
            sessions={sessions}
            initialEvent={activeEvent}
            settings={settings}
            onChange={updateSettings}
          />
        </Suspense>
      )}

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
        onRequestResetAllSolveData={handleOpenResetAll}
        resetAllDisabledReason={resetAllDisabledReason}
        onRequestDeleteAllSessions={handleOpenDeleteAllSessions}
        deleteAllSessionsDisabledReason={deleteAllSessionsDisabledReason}
        developerSyncStatus={developerSyncStatus}
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
        onOpenEventManager={handleOpenEventManager}
        onClose={() => setSessionSettingsOpen(false)}
      />

      {dataOpen ? (
        <Suspense fallback={<DialogLoadingFallback />}>
          <DataDialog
            open
            sessions={sessions}
            sessionCount={sessions.length}
            solveCount={countSolves(sessions)}
            customEvents={customEvents}
            onClose={() => setDataOpen(false)}
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
            onClose={() => setDriveOpen(false)}
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
            onSplit={(name, solveIds) =>
              splitSessionSource
                ? handleSplitSession(splitSessionSource.id, name, solveIds)
                : null
            }
          />
        </Suspense>
      ) : null}

      {eventManagerOpen ? (
        <Suspense fallback={<DialogLoadingFallback />}>
          <CustomEventsDialog
            open
            customEvents={customEvents}
            sessions={sessions}
            correctionCount={importedCorrectionCount}
            onCreate={createCustomEvent}
            onRename={renameCustomEvent}
            onSetPlaceholder={setCustomEventPlaceholder}
            onDelete={handleDeleteCustomEvent}
            onReassignSessions={handleReassignSessionsEvent}
            onCorrectImported={handleCorrectImportedEvents}
            onClose={() => setEventManagerOpen(false)}
          />
        </Suspense>
      ) : null}

      <SessionSetupDialog
        open={createSessionOpen}
        sessions={sessions.map((session) => ({ id: session.id, name: session.name }))}
        defaultEvent={activeEvent}
        defaultInspectionEnabled={activeInspectionEnabled}
        onClose={() => setCreateSessionOpen(false)}
        onCreate={(name, event, preferences) =>
          Boolean(handleCreateSession(name, event, preferences))
        }
      />

      <Toast
        toast={toast}
        onAction={handleToastAction}
        onDismiss={dismissToast}
      />
    </div>
  )
}
