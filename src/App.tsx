import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppHeader } from './components/AppHeader'
import { ConfirmDialog } from './components/ConfirmDialog'
import { DataDialog } from './components/DataDialog'
import { ScramblePanel } from './components/ScramblePanel'
import { SessionPanel } from './components/SessionPanel'
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
import {
  backupFileName,
  createBackup,
  serializeBackup,
  type Backup,
} from './lib/backup'
import { formatSolveCount, formatStatValue, formatTime } from './lib/format'
import { countSolves } from './lib/sessions'
import { getSessionStats } from './lib/stats'
import type { Penalty, Session, TimerUpdateMode } from './types'

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
    deleteSolve,
    restoreSolve,
    clearSolves,
    createSession,
    renameSession,
    deleteSession,
    selectSession,
    replaceSessions,
  } = useSessions()
  const solves = activeSession.solves
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
  } = useScramble()
  const { toast, showToast, dismissToast } = useToast()

  const [clearOpen, setClearOpen] = useState(false)
  const [sessionToDelete, setSessionToDelete] = useState<Session | null>(null)
  const [pendingImport, setPendingImport] = useState<Backup | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [dataOpen, setDataOpen] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const scrambleRef = useRef(scramble)

  useEffect(() => {
    scrambleRef.current = scramble
  }, [scramble])

  const handleSolve = useCallback(
    (completion: { rawMs: number; penalty: Penalty }) => {
      const activeScramble = scrambleRef.current
      if (!activeScramble) return

      addSolve({
        rawMs: completion.rawMs,
        penalty: completion.penalty,
        scramble: activeScramble,
      })

      if (completion.penalty === 'dnf') {
        setAnnouncement('Solve recorded. DNF.')
      } else if (completion.penalty === '+2') {
        setAnnouncement(
          `Solve recorded. ${formatTime(completion.rawMs + 2_000)}, plus two.`,
        )
      } else {
        setAnnouncement(`Solve recorded. ${formatTime(completion.rawMs)}.`)
      }

      advanceScramble()
    },
    [addSolve, advanceScramble],
  )

  const timer = useTimer({
    inspectionEnabled: settings.inspectionEnabled,
    holdDurationMs: settings.holdDurationMs,
    onSolve: handleSolve,
  })

  const displayElapsed = roundTimerElapsed(
    timer.runningElapsedMs,
    settings.timerUpdateMode,
  )

  const timerActive = timer.state.status !== 'idle'
  const modalOpen =
    settingsOpen ||
    dataOpen ||
    clearOpen ||
    sessionToDelete !== null ||
    pendingImport !== null
  const timerCancel = timer.cancel
  const timerPress = timer.press
  const timerRelease = timer.release
  const canStart = scramble !== null
  const stats = useMemo(() => getSessionStats(solves), [solves])

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

  const handleDelete = useCallback(
    (id: string) => {
      const removed = deleteSolve(id)
      if (!removed) return

      showToast({
        message: 'Solve deleted',
        actionLabel: 'Undo',
        onAction: () =>
          restoreSolve(removed.solve, removed.index, removed.sessionId),
      })
    },
    [deleteSolve, restoreSolve, showToast],
  )

  const requestClear = useCallback(() => {
    if (
      timer.state.status === 'idle' &&
      !modalOpen &&
      solves.length > 0
    ) {
      setClearOpen(true)
    }
  }, [modalOpen, solves.length, timer.state.status])

  const confirmClear = useCallback(() => {
    clearSolves()
    setClearOpen(false)
    showToast({ message: 'Session cleared' })
  }, [clearSolves, showToast])

  const handleCreateSession = useCallback(
    (name: string): boolean => {
      if (timer.state.status !== 'idle') return false
      return createSession(name) !== null
    },
    [createSession, timer.state.status],
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

  const requestDeleteSession = useCallback(() => {
    if (timer.state.status !== 'idle' || sessions.length <= 1) return
    setSessionToDelete(activeSession)
  }, [activeSession, sessions.length, timer.state.status])

  const confirmDeleteSession = useCallback(() => {
    if (!sessionToDelete) return
    const deleted = deleteSession(sessionToDelete.id)
    setSessionToDelete(null)
    if (deleted) showToast({ message: 'Session deleted' })
  }, [deleteSession, sessionToDelete, showToast])

  const handleOpenBackup = useCallback(() => {
    if (timer.state.status !== 'idle') return
    setSettingsOpen(false)
    setDataOpen(true)
  }, [timer.state.status])

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
    setPendingImport(null)
    showToast({ message: 'Backup imported' })
  }, [pendingImport, replaceSessions, replaceSettings, showToast])

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
    timerCancel,
    timerPress,
    timerRelease,
    timer.state.status,
  ])

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
      style={
        {
          '--ui-scale': `${settings.uiZoomPercent / 100}`,
        } as React.CSSProperties
      }
    >
      <h1 className="sr-only">CubeLab — offline speedcubing timer</h1>
      <AppHeader
        sessionName={activeSession.name}
        inspectionEnabled={settings.inspectionEnabled}
        onOpenSettings={handleOpenSettings}
        settingsLocked={timerActive}
        storageOk={storageHealthy}
      />

      <main className="workspace">
        <div className="primary-column">
          <ScramblePanel
            scramble={scramble}
            nextScramble={nextScramble}
            isLoading={scrambleLoading}
            error={scrambleError}
            canRegenerate={!timerActive && !scrambleLoading && scramble !== null}
            onRegenerate={handleRegenerate}
            onRetry={retryScramble}
            onNotify={(message) => showToast({ message })}
            scrambleAction={settings.scrambleAction}
            alignment={settings.scrambleAlignment}
            limitHeight={settings.scrambleLimitHeight}
          />

          <TimerStage
            state={timer.state}
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
            showTimerDecimalSmall={settings.showTimerDecimalSmall}
            inspectionEnabled={settings.inspectionEnabled}
            onPress={timer.press}
            onRelease={timer.release}
            onCancel={handleCancel}
          />

          <div className="session-caption">
            <span className="caption-session">
              {stats.count === 0
                ? 'No solves yet'
                : `${stats.count === 1 ? '1 solve' : `${stats.count} solves`} this session`}
            </span>
            <span className="quick-stats" aria-label="Current averages">
              <span>
                <span>ao5</span>
                <strong>{formatStatValue(stats.latestAverage5)}</strong>
              </span>
              <span>
                <span>ao12</span>
                <strong>{formatStatValue(stats.latestAverage12)}</strong>
              </span>
            </span>
            <span className="caption-shortcuts">
              <kbd>Space</kbd> hold to arm · release to start
              {settings.inspectionEnabled ? (
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
            sessions={sessions}
            activeSessionId={activeSessionId}
            locked={timerActive}
            onCreate={handleCreateSession}
            onRename={handleRenameSession}
            onSelect={handleSelectSession}
            onRequestDelete={requestDeleteSession}
          />

          <StatsPanel stats={stats} />

          <SolveHistory
            solves={solves}
            onSetPenalty={handleSetPenalty}
            onDelete={handleDelete}
            onRequestClear={requestClear}
            clearDisabled={timerActive}
          />
        </aside>
      </main>

      <footer className="app-footer">
        <span>CubeLab · Local sessions</span>
        <span className="footer-middle">
          Local-first. Solves stay in this browser.
        </span>
        <span className="footer-meta">3×3 · WCA</span>
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
        onClose={() => setSettingsOpen(false)}
      />

      <DataDialog
        open={dataOpen}
        sessionCount={sessions.length}
        solveCount={countSolves(sessions)}
        onClose={() => setDataOpen(false)}
        onExport={handleExport}
        onImport={handleImportRequested}
      />

      <ConfirmDialog
        open={confirmContent !== null}
        eyebrow={confirmContent?.eyebrow ?? ''}
        title={confirmContent?.title ?? ''}
        description={confirmContent?.description ?? null}
        cancelLabel={confirmContent?.cancelLabel ?? 'Cancel'}
        confirmLabel={confirmContent?.confirmLabel ?? 'Confirm'}
        onCancel={cancelConfirm}
        onConfirm={handleConfirm}
      />

      <Toast
        toast={toast}
        onAction={handleToastAction}
        onDismiss={dismissToast}
      />
    </div>
  )
}
