import { useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import type { InspectionCountDirection, InspectionWarningVisualScope, Solve, TimerUpdateMode } from '../types'
import { useRunningElapsed } from '../hooks/useRunningElapsed'
import type { AlertTone } from '../lib/alerts'
import { formatSolveTime, formatTime } from '../lib/format'
import {
  INSPECTION_DNF_MS,
  INSPECTION_LIMIT_MS,
  penaltyForInspection,
  type TimerInput,
  type TimerState,
} from '../timer/machine'
import { ResetIcon } from './Icons'

function splitDecimalTime(value: string): ReactNode {
  const index = value.lastIndexOf('.')
  if (index <= 0 || value.length - index < 2) return value
  return (
    <>
      {value.slice(0, index)}
      <span className="timer-decimal">{value.slice(index)}</span>
    </>
  )
}

interface TimerStageProps {
  state: TimerState
  eventLabel: string
  timerUpdateMode?: TimerUpdateMode
  inspectionElapsedMs: number | null
  holdProgress: number
  latestSolve: Solve | null
  disabled: boolean
  disabledHint?: string
  inspectionEnabled: boolean
  inspectionCountDirection: InspectionCountDirection
  showTimerDecimalSmall?: boolean
  alert?: { tone: AlertTone; id: number; message?: string; visualTone?: AlertTone } | null
  inspectionWarningVisualScope?: InspectionWarningVisualScope
  /** Presentation-only overlay anchored inside the timer stage. */
  overlay?: ReactNode
  onPress: (input: TimerInput) => void
  onRelease: (input: TimerInput) => void
  onCancel: () => void
}

type InspectionTone = 'safe' | 'warning' | 'danger'

interface InspectionDisplay {
  value: string
  tone: InspectionTone
}

function getInspectionDisplay(
  elapsedMs: number | null,
  direction: InspectionCountDirection,
): InspectionDisplay {
  const elapsed = elapsedMs ?? 0

  if (elapsed > INSPECTION_DNF_MS) {
    return { value: 'DNF', tone: 'danger' }
  }

  if (elapsed > INSPECTION_LIMIT_MS) {
    return { value: '+2', tone: 'warning' }
  }

  if (direction === 'up') {
    const elapsedSeconds = Math.floor(elapsed / 1_000)
    return {
      value: String(elapsedSeconds),
      tone: elapsed >= 12_000 ? 'warning' : 'safe',
    }
  }

  const remaining = Math.ceil((INSPECTION_LIMIT_MS - elapsed) / 1_000)
  return {
    value: String(Math.max(0, remaining)),
    tone: remaining <= 3 ? 'warning' : 'safe',
  }
}

function phaseLabel(state: TimerState): string {
  switch (state.status) {
    case 'idle':
      return 'Ready'
    case 'inspection':
      return 'Inspecting'
    case 'holding':
      return 'Arming'
    case 'ready':
      return 'Armed'
    case 'running':
      return 'Solving'
  }
}

export function TimerStage({
  state,
  eventLabel,
  timerUpdateMode = 'live',
  inspectionElapsedMs,
  holdProgress,
  latestSolve,
  disabled,
  disabledHint = 'Generating scramble…',
  inspectionEnabled,
  inspectionCountDirection,
  showTimerDecimalSmall = false,
  alert = null,
  inspectionWarningVisualScope = 'timer',
  overlay = null,
  onPress,
  onRelease,
  onCancel,
}: TimerStageProps) {
  const activePointer = useRef<number | null>(null)
  const elapsedMs = useRunningElapsed(state.status === 'running' ? state.startedAt : null, timerUpdateMode)
  // Inspection keeps its own display through holding and armed states. The
  // solve clock only replaces it once the timer is actually running.
  const inspectionStartedAt =
    state.status === 'inspection'
      ? state.inspectionStartedAt
      : state.status === 'holding' || state.status === 'ready'
        ? state.inspectionStartedAt
        : null
  const inspection =
    inspectionStartedAt !== null
      ? getInspectionDisplay(inspectionElapsedMs, inspectionCountDirection)
      : null
  const isRunning = state.status === 'running'
  const showReset =
    state.status === 'inspection' ||
    state.status === 'holding' ||
    state.status === 'ready'

  let mainValue = '0.00'
  let suffix: string | null = null
  let toneClass = ''

  if (isRunning) {
    mainValue = formatTime(elapsedMs ?? 0)
    if (state.inspectionStartedAt !== null) {
      const penalty = penaltyForInspection(state.startedAt - state.inspectionStartedAt)
      if (penalty === '+2') {
        suffix = '+2'
        toneClass = 'is-penalty'
      } else if (penalty === 'dnf') {
        suffix = 'DNF'
        toneClass = 'is-dnf'
      }
    }
  } else if (inspection) {
    mainValue = inspection.value
    toneClass = inspection.tone === 'danger' ? 'is-dnf' : inspection.tone === 'warning' ? 'is-penalty' : ''
  } else if (state.status === 'idle' && latestSolve) {
    const last = formatSolveTime(latestSolve.rawMs, latestSolve.penalty)
    mainValue = last.display
    suffix = last.suffix
    toneClass = latestSolve.penalty === 'dnf' ? 'is-dnf' : latestSolve.penalty === '+2' ? 'is-penalty' : ''
  }

  const hint = ''

  const meterPercent = Math.min(
    100,
    ((inspectionElapsedMs ?? 0) / INSPECTION_DNF_MS) * 100,
  )
  const inspectionTone =
    (inspectionElapsedMs ?? 0) > INSPECTION_DNF_MS
      ? 'is-danger'
      : (inspectionElapsedMs ?? 0) > INSPECTION_LIMIT_MS
        ? 'is-warning'
        : ''

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (disabled) return
    if (event.pointerType === 'mouse' && event.button !== 0) return
    if (activePointer.current !== null) return

    event.preventDefault()
    activePointer.current = event.pointerId
    // Capture the timing event before focus can force browser layout work.
    onPress('pointer')
    event.currentTarget.focus({ preventScroll: true })
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Pointer capture is an enhancement; pointer handlers still work.
    }
  }

  const handlePointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (activePointer.current !== event.pointerId) return
    activePointer.current = null
    event.preventDefault()
    onRelease('pointer')
  }

  const handlePointerCancel = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (activePointer.current !== event.pointerId) return
    activePointer.current = null
    onCancel()
  }

  const accessibleLabel = (() => {
    if (disabled) return `Timer unavailable: ${disabledHint}`
    if (isRunning) return `Timer running at ${mainValue}. Press Space or tap to stop.`
    if (inspection) {
      if (state.status === 'ready') {
        return `Inspection, ${inspection.value}. Timer armed. Release Space or the timer to start.`
      }
      if (state.status === 'holding') {
        return `Inspection, ${inspection.value}. Keep holding to arm the timer.`
      }
      return `Inspection, ${inspection.value}. Hold Space or press and hold the timer to arm.`
    }
    if (state.status === 'ready') return `Timer armed at ${mainValue}. Release to start.`
    if (state.status === 'holding') return `Timer arming. Keep holding.`
    if (latestSolve) {
      const nextAction = inspectionEnabled
        ? 'Press Space or tap to start inspection.'
        : 'Hold Space or press and hold to start.'
      return `Timer ready. Last solve ${mainValue}${
        latestSolve.penalty === '+2' ? ' plus two' : ''
      }${latestSolve.penalty === 'dnf' ? ' DNF' : ''}. ${nextAction}`
    }
    return inspectionEnabled
      ? 'Timer ready. Press Space or tap the timer to start 15-second inspection.'
      : `Timer ready. ${eventLabel}. Hold Space or press and hold the timer to arm, then release.`
  })()

  const readout = showTimerDecimalSmall
    ? splitDecimalTime(mainValue)
    : mainValue

  const stageClass = [
    'timer-stage',
    `phase-${state.status}`,
    toneClass,
    disabled ? 'is-disabled' : '',
    showReset ? 'has-reset' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <section className={stageClass} aria-labelledby="timer-phase">
      {alert ? (
        <span
          key={alert.id}
          className={`timer-alert is-${alert.visualTone ?? alert.tone}${
            inspectionWarningVisualScope === 'screen' ? ' is-screen' : ''
          }`}
          aria-hidden="true"
        >
          {alert.message ? (
            <span className="timer-alert-message">{alert.message}</span>
          ) : null}
        </span>
      ) : null}
      <button
        type="button"
        className="timer-surface"
        data-testid="timer-surface"
        data-phase={state.status}
        disabled={disabled}
        aria-label={accessibleLabel}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onContextMenu={(event) => event.preventDefault()}
      >
        <span className="stage-top" aria-hidden="true">
          <span className="phase-pill">
            <span className={`phase-dot ${isRunning ? 'is-live' : ''}`} aria-hidden="true" />
            <span id="timer-phase">
              {disabled ? 'Waiting' : phaseLabel(state)}
            </span>
          </span>
          <span className="stage-mode">
            {inspection ? (
              <>15s + 2s · WCA</>
            ) : isRunning ? (
              'Timing'
            ) : inspectionEnabled ? (
              'Inspection on'
            ) : (
              <>{eventLabel}</>
            )}
          </span>
        </span>

        <span className="readout-zone" aria-hidden="true">
          <span
            className="timer-display"
            data-testid="timer-display"
            aria-hidden="true"
          >
            {readout}
            {suffix ? <span className="timer-suffix">{suffix}</span> : null}
          </span>
        </span>

        <span className="meter-zone" aria-hidden="true">
          {inspection ? (
            <span className={`inspection-meter ${inspectionTone}`}>
              <span className="inspection-track">
                <span style={{ width: `${meterPercent}%` }} />
                <span className="inspection-marker" />
              </span>
              <span className="inspection-labels">
                <span>15s</span>
                <span>17s · DNF</span>
              </span>
            </span>
          ) : (
            <span className={`arm-track ${state.status === 'ready' ? 'is-armed' : ''}`}>
              <span style={{ width: `${holdProgress * 100}%` }} />
            </span>
          )}
        </span>

        <span className="stage-bottom" aria-hidden="true">
          <span className="timer-hint">{hint}</span>
        </span>
      </button>

      {showReset ? (
        <button
          type="button"
          className="stage-reset"
          onClick={onCancel}
          aria-label="Reset inspection and timer"
        >
          <ResetIcon size={14} />
          Reset
        </button>
      ) : null}

      {overlay}
    </section>
  )
}
