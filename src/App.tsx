import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppHeader } from './components/AppHeader'
import { ConfirmDialog } from './components/ConfirmDialog'
import { DriveBackupDialog } from './components/DriveBackupDialog'
import { DataDialog } from './components/DataDialog'
import { ScramblePanel } from './components/ScramblePanel'
import { SessionPanel } from './components/SessionPanel'
import { SessionSettingsDialog } from './components/SessionSettingsDialog'
import { SettingsDialog } from './components/SettingsDialog'
import { SolveHistory } from './components/SolveHistory'
import { StatsPanel } from './components/StatsPanel'
import { TimerStage } from './components/TimerStage'
import { Toast } from './components/Toast'
import { useScramble } from './hooks/useScramble'
import { useSessions } from './hooks/useSessions'
import { useSettings } from './hooks/useSettings'
import { useTimer } from './hooks/useTimer'
import { useToast } from './hooks/useToast'
import { MergeSessionsDialog } from './components/MergeSessionsDialog'
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
import { getEventDefinition } from './lib/events'
import { formatSolveCount, formatStatValue, formatTime } from './lib/format'
import { countSolves, mergeSessionsById } from './lib/sessions'
import { getSessionStats } from './lib/stats'
import { createDriveTransport } from './lib/driveTransport'
import { loadDriveBackupState, saveDriveBackupState } from './lib/driveStorage'
import { BUILT_IN_STAT_DEFINITIONS } from './lib/statDefinitions'
import type {
  AlertChannel,
  Penalty,
  PuzzleEvent,
  SessionPreferences,
  Session,
  TimerUpdateMode,
} from './types'
import type { TimerInput, TimerState } from './timer/machine'

function roundTimerElapsed(
  elapsedMs: number | null,
  mode: TimerUpdateMode,
): number | null {
  if (elapsedMs === null) return null
  if (mode === 'tenths') return Math.floor(elapsedMs / 100) * 100
  if (mode === 'seconds') return Math.floor(elapsedMs / 1000) * 1000
  return elapsedMs
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('input, textarea, [contenteditable="true"]') !== null
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
    createSession,
    renameSession,
    deleteSession,
    selectSession,
    setSessionEvent,
    replaceSessions,
  } = useSessions()
  const solves = activeSession.solves
  const activeEvent = activeSession.event ?? '333'
  // The selector lists every session. A session's event is its own property,
  // not a filter for session visibility.
  const visibleSessions = sessions
  const {
    settings,
    settingsStorageOk,
    updateSettings,
    replaceSettings,
  } = useSettings()
  const {
    scramble,
    nextScramble,
    isLoading: scrambleLoading,
    error: scrambleError,
    advance: advanceScramble,
    retry: retryScramble,
  } = useScramble(activeEvent)
  const { toast, showToast, dismissToast } = useToast()
  const driveTransport = useMemo(() => createDriveTransport(), [])

  const [clearOpen, setClearOpen] = useState(false)
  const [driveOpen, setDriveOpen] = useState(false)
  const [pendingDriveRestore, setPendingDriveRestore] = useState<Backup | null>(null)
  const [sessionToDelete, setSessionToDelete] = useState<Session | null>(null)
  const [pendingImport, setPendingImport] = useState<Backup | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [sessionSettingsOpen, setSessionSettingsOpen] = useState(false)
  const [mergeSessionsOpen, setMergeSessionsOpen] = useState(false)
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

  const sync = useSync({
    transport: driveTransport,
    sessions: { activeSessionId, sessions },
    settings,
    storageOk: storageOk && settingsStorageOk,
    timerActive: timer.state.status !== 'idle',
    onReplaceSessions: replaceSessions,
    onReplaceSettings: replaceSettings,
    onNotify: (message) => showToast({ message }),
    onDuplicateSessionDetected: (names, summary) => {
      showToast({
        message:
          summary ??
          `CubeLab found separate sessions named ${names
            .map((name) => `'${name}'`)
            .join(', ')}. They remain separate until you approve a merge.`,
        actionLabel: 'Review Merge',
        onAction: () => setMergeSessionsOpen(true),
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

  const displayElapsed = roundTimerElapsed(
    timer.runningElapsedMs,
    effectiveSettings.timerUpdateMode,
  )

  const timerActive = timer.state.status !== 'idle'
  const modalOpen =
    settingsOpen ||
    sessionSettingsOpen ||
    dataOpen ||
    clearOpen ||
    sessionToDelete !== null ||
    pendingImport !== null ||
    driveOpen ||
    mergeSessionsOpen ||
    createSessionOpen ||
    pendingDriveRestore !== null
  const timerCancel = timer.cancel
  const timerPressBase = timer.press
  const timerPress = useCallback(
    (input: TimerInput) => {
      if (settings.alertChannel.includes('sound')) primeAlertAudio()
      timerPressBase(input)
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
  const stats = useMemo(
    () => getSessionStats(solves, visibleAverageSizes),
    [solves, visibleAverageSizes],
  )
  const latestAo5 = stats.averages.get(5)?.latest ?? null
  const latestAo12 = stats.averages.get(12)?.latest ?? null

  const handleOpenSettings = useCallback(() => {
    if (timer.state.status !== 'idle') return
    setSettingsOpen(true)
  }, [timer.state.status])

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

  const handleDelete = useCallback(
    (id: string) => {
      const removed = deleteSolve(id)
      if (!removed) return
      sync.recordDeletion('solve', id, removed.sessionId)

      showToast({
        message: 'Solve deleted',
        actionLabel: 'Undo',
        onAction: () => {
          sync.restoreDeletion('solve', removed.solve.id)
          restoreSolve(removed.solve, removed.index, removed.sessionId)
        },
      })
    },
    [deleteSolve, restoreSolve, showToast, sync],
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

  const confirmDeleteSession = useCallback(() => {
    if (!sessionToDelete) return
    sync.recordDeletion('session', sessionToDelete.id)
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
        { activeSessionId, sessions },
        settings,
      )
      downloadJsonFile(serializeBackup(backup), backupFileName())
      setDataOpen(false)
      showToast({ message: 'Backup exported' })
      return true
    } catch {
      return false
    }
  }, [activeSessionId, sessions, settings, showToast, timer.state.status])

  const handleImportRequested = useCallback((backup: Backup) => {
    setDataOpen(false)
    setPendingImport(backup)
  }, [])

  const confirmImport = useCallback(() => {
    if (!pendingImport) return

    replaceSessions(pendingImport.sessions)
    replaceSettings(pendingImport.settings)
    sync.resetBase(pendingImport.sessions)
    setPendingImport(null)
    showToast({ message: 'Backup imported' })
  }, [pendingImport, replaceSessions, replaceSettings, showToast, sync])

  const handleMergeSessions = useCallback(
    (sourceId: string, targetId: string) => {
      const merged = mergeSessionsById(
        { activeSessionId, sessions },
        targetId,
        sourceId,
      )
      if (!merged) return false
      replaceSessions(merged)
      sync.approveSessionMerge(sourceId, targetId)
      showToast({ message: 'Sessions merged' })
      return true
    },
    [activeSessionId, sessions, replaceSessions, showToast, sync],
  )

  const cancelConfirm = useCallback(() => {
    setClearOpen(false)
    setSessionToDelete(null)
    setPendingImport(null)
  }, [])

  const confirmContent = useMemo(() => {
    if (pendingImport) {
      const currentSolveCount = countSolves(sessions)
      const importedSolveCount = countSolves(pendingImport.sessions.sessions)
      const importedSessionCount = pendingImport.sessions.sessions.length

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
    confirmDeleteSession,
    confirmImport,
    pendingImport,
    sessionToDelete,
    sessions,
    solves.length,
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
        !isTextEntryTarget(event.target)
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
      if (isTextEntryTarget(event.target)) return
      event.preventDefault()
      if (event.repeat) return
      if (timer.state.status === 'idle' && !canStart) return

      timerPress('keyboard')
    }

    const handleKeyUp = (event: KeyboardEvent) => {
      if (modalOpen || event.code !== 'Space') return
      if (isTextEntryTarget(event.target)) return
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
  ])

  useEffect(() => {
    if (createSessionOpenPrev.current && !createSessionOpen && timer.state.status === 'idle') {
      window.setTimeout(() => {
        document.querySelector<HTMLElement>('[data-testid="session-select"]')?.focus()
      }, 0)
    }
    createSessionOpenPrev.current = createSessionOpen
  }, [createSessionOpen, timer.state.status])

  const storageHealthy = storageOk && settingsStorageOk
  const appShellClassName = [
    'app-shell',
    settings.showTimerDecimalSmall ? 'is-decimal-small' : '',
    settings.scrambleLimitHeight ? 'is-scramble-height-limited' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={appShellClassName}
      data-accent={settings.accentColor}
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
      />

      <main className="workspace">
        <h1 className="sr-only">CubeLab — offline speedcubing timer</h1>
        <div className="primary-column">
          <ScramblePanel
            event={activeEvent}
            scramble={scramble}
            nextScramble={nextScramble}
            isLoading={scrambleLoading}
            error={scrambleError}
            canRegenerate={!timerActive && !scrambleLoading && scramble !== null}
            onRegenerate={handleRegenerate}
            onRetry={retryScramble}
            onNotify={(message) => showToast({ message })}
            scrambleAction={effectiveSettings.scrambleAction}
            alignment={effectiveSettings.scrambleAlignment}
            limitHeight={effectiveSettings.scrambleLimitHeight}
          />

          <TimerStage
            state={timer.state}
            eventLabel={getEventDefinition(activeEvent)?.label ?? activeEvent}
            elapsedMs={displayElapsed}
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
          />

          <div className="session-caption">
            <span className="caption-session">
              {stats.count === 0
                ? 'No solves yet'
                : `${stats.count === 1 ? '1 solve' : `${stats.count} solves`} this session`}
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
            <span className="caption-shortcuts">
              <kbd>Space</kbd> hold to arm · release to start
              {activeInspectionEnabled ? (
                <>
                  <span aria-hidden="true">·</span>
                  <kbd>Esc</kbd> reset
                </>
              ) : null}
            </span>
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
          />

          <StatsPanel
            stats={stats}
            visibleStats={settings.statVisibility}
            customAverages={settings.customAverages}
            precision={settings.statPrecision}
          />

          <SolveHistory
            key={activeSession.id}
            solves={solves}
            onSetPenalty={handleSetPenalty}
            onDelete={handleDelete}
            onSetComment={handleSetComment}
            onNotify={(message) => showToast({ message })}
          />
        </aside>
      </main>

      <footer className="app-footer">
        <span>CubeLab · Local sessions</span>
        <span className="footer-middle">
          Local-first. Solves stay in this browser.
        </span>
        <span className="footer-meta">{activeEvent.toUpperCase()} · CubeLab</span>
      </footer>

      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>

      <SettingsDialog
        open={settingsOpen}
        settings={settings}
        storageOk={storageHealthy}
        sessionCount={sessions.length}
        solveCount={countSolves(sessions)}
        onChange={updateSettings}
        onOpenBackup={handleOpenBackup}
        onOpenDriveBackup={handleOpenDriveBackup}
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
        onCreateForEvent={() => {
          setSessionSettingsOpen(false)
          setCreateSessionOpen(true)
        }}
        onSetInspection={handleSetSessionInspection}
        onRequestClear={requestClear}
        onRequestDelete={requestDeleteSession}
        onClose={() => setSessionSettingsOpen(false)}
      />

      <DataDialog
        open={dataOpen}
        sessionCount={sessions.length}
        solveCount={countSolves(sessions)}
        onClose={() => setDataOpen(false)}
        onExport={handleExport}
        onImport={handleImportRequested}
      />

      <DriveBackupDialog
        open={driveOpen}
        transport={driveTransport}
        sessions={{ activeSessionId, sessions }}
        settings={settings}
        storageOk={storageHealthy}
        sync={sync}
        onClose={() => setDriveOpen(false)}
        onNotify={(message) => showToast({ message })}
        onPendingRestore={handleDriveRestorePending}
        onReviewDuplicateNames={() => setMergeSessionsOpen(true)}
      />

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

      <MergeSessionsDialog
        open={mergeSessionsOpen}
        sessions={{ activeSessionId, sessions }}
        onClose={() => setMergeSessionsOpen(false)}
        onMerge={handleMergeSessions}
      />

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
