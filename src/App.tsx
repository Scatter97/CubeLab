import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppHeader } from './components/AppHeader'
import { ConfirmDialog } from './components/ConfirmDialog'
import { ScramblePanel } from './components/ScramblePanel'
import { SolveHistory } from './components/SolveHistory'
import { StatsPanel } from './components/StatsPanel'
import { TimerStage } from './components/TimerStage'
import { Toast } from './components/Toast'
import { useScramble } from './hooks/useScramble'
import { useSettings } from './hooks/useSettings'
import { useSolves } from './hooks/useSolves'
import { useTimer } from './hooks/useTimer'
import { useToast } from './hooks/useToast'
import { formatStatValue, formatTime } from './lib/format'
import { getSessionStats } from './lib/stats'
import type { Penalty } from './types'

function isTextEntryTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('input, textarea, select, [contenteditable="true"]') !== null
  )
}

export default function App() {
  const {
    solves,
    storageOk,
    addSolve,
    setPenalty,
    deleteSolve,
    restoreSolve,
    clearSolves,
  } = useSolves()
  const { settings, settingsStorageOk, setInspectionEnabled } = useSettings()
  const {
    scramble,
    nextScramble,
    isLoading: scrambleLoading,
    error: scrambleError,
    advance: advanceScramble,
    retry: retryScramble,
  } = useScramble()
  const { toast, showToast, dismissToast } = useToast()

  const [confirmOpen, setConfirmOpen] = useState(false)
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
    onSolve: handleSolve,
  })

  const timerActive = timer.state.status !== 'idle'
  const timerCancel = timer.cancel
  const timerPress = timer.press
  const timerRelease = timer.release
  const canStart = scramble !== null
  const stats = useMemo(() => getSessionStats(solves), [solves])

  const handleInspectionChange = useCallback(
    (enabled: boolean) => {
      if (timer.state.status !== 'idle') return
      setInspectionEnabled(enabled)
    },
    [setInspectionEnabled, timer.state.status],
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

  const handleDelete = useCallback(
    (id: string) => {
      const index = solves.findIndex((solve) => solve.id === id)
      const solve = solves[index]
      if (!solve) return

      deleteSolve(id)
      showToast({
        message: 'Solve deleted',
        actionLabel: 'Undo',
        onAction: () => restoreSolve(solve, index),
      })
    },
    [deleteSolve, restoreSolve, showToast, solves],
  )

  const requestClear = useCallback(() => {
    if (timer.state.status === 'idle' && solves.length > 0) {
      setConfirmOpen(true)
    }
  }, [solves.length, timer.state.status])

  const confirmClear = useCallback(() => {
    clearSolves()
    setConfirmOpen(false)
    showToast({ message: 'Session cleared' })
  }, [clearSolves, showToast])

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
      if (confirmOpen) return
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
      if (confirmOpen || event.code !== 'Space') return
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
    confirmOpen,
    timerCancel,
    timerPress,
    timerRelease,
    timer.state.status,
  ])

  const storageHealthy = storageOk && settingsStorageOk
  const displayElapsed = timer.runningElapsedMs

  return (
    <div className="app-shell">
      <h1 className="sr-only">CubeLab — offline speedcubing timer</h1>

      <AppHeader
        inspectionEnabled={settings.inspectionEnabled}
        onInspectionChange={handleInspectionChange}
        inspectionLocked={timerActive || confirmOpen}
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
          />

          <TimerStage
            state={timer.state}
            elapsedMs={displayElapsed}
            inspectionElapsedMs={timer.inspectionElapsedMs}
            holdProgress={timer.holdProgress}
            latestSolve={solves[0] ?? null}
            disabled={!canStart && !timerActive}
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

        <aside className="side-column" aria-label="Session insights">
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
        <span>CubeLab · Milestone 1</span>
        <span className="footer-middle">
          Local-first. Solves stay in this browser.
        </span>
        <span className="footer-meta">3×3 · WCA</span>
      </footer>

      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        solveCount={solves.length}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={confirmClear}
      />

      <Toast
        toast={toast}
        onAction={handleToastAction}
        onDismiss={dismissToast}
      />
    </div>
  )
}
