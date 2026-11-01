import { useCallback, useEffect, useRef, useState } from 'react'
import {
  transitionTimer,
  type TimerCompletion,
  type TimerEvent,
  type TimerInput,
  type TimerState,
} from '../timer/machine'

export interface UseTimerOptions {
  inspectionEnabled: boolean
  holdDurationMs: number
  onSolve: (completion: TimerCompletion) => void
  /** Injectable for deterministic tests; defaults to performance.now. */
  now?: () => number
}

export interface TimerController {
  state: TimerState
  holdProgress: number
  inspectionElapsedMs: number | null
  press: (input: TimerInput, at?: number) => void
  release: (input: TimerInput) => void
  cancel: () => void
}

/**
 * React adapter around the pure timer machine. The authoritative state also
 * lives in a ref so two DOM events in the same frame cannot both record a
 * solve (for example, an OS key repeat followed by a synthetic event).
 */
export function useTimer(options: UseTimerOptions): TimerController {
  const [state, setState] = useState<TimerState>({ status: 'idle' })
  const stateRef = useRef<TimerState>(state)
  const [now] = useState<() => number>(
    () => options.now ?? (() => performance.now()),
  )
  const [clock, setClock] = useState(() => now())

  const onSolveRef = useRef(options.onSolve)
  useEffect(() => {
    onSolveRef.current = options.onSolve
  }, [options.onSolve])

  const applyEvent = useCallback((event: TimerEvent) => {
    const previous = stateRef.current
    const { state: next, completed } = transitionTimer(previous, event)

    if (next !== previous) {
      stateRef.current = next
      setState(next)
      if ('at' in event) setClock(event.at)
    }

    if (completed) {
      onSolveRef.current(completed)
    }
  }, [])

  const press = useCallback(
    (input: TimerInput, at = now()) => {
      applyEvent({
        type: 'press',
        at,
        input,
        inspectionEnabled: options.inspectionEnabled,
        holdDurationMs: options.holdDurationMs,
      })
    },
    [applyEvent, now, options.holdDurationMs, options.inspectionEnabled],
  )

  const release = useCallback(
    (input: TimerInput) => {
      const at = now()
      applyEvent({ type: 'release', at, input })
    },
    [applyEvent, now],
  )

  const cancel = useCallback(() => {
    applyEvent({ type: 'cancel' })
  }, [applyEvent])

  useEffect(() => {
    const current = stateRef.current
    // If inspection was disabled while an inspection was running, return to a
    // safe idle state instead of silently switching timing modes.
    if (
      !options.inspectionEnabled &&
      (current.status === 'inspection' ||
        ((current.status === 'holding' || current.status === 'ready') &&
          current.inspectionStartedAt !== null))
    ) {
      applyEvent({ type: 'cancel' })
    }
  }, [options.inspectionEnabled, applyEvent])

  useEffect(() => {
    // Running ticks are presentation-only: the readout owns its animation.
    // Keep arming/inspection ticks here for transitions and warning feedback.
    if (state.status === 'idle' || state.status === 'running') return

    let frame = 0
    const animate = () => {
      const at = now()
      setClock(at)
      applyEvent({ type: 'tick', at })
      frame = requestAnimationFrame(animate)
    }

    frame = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(frame)
  }, [applyEvent, now, state.status])

  // Losing focus cannot leave a key physically "held" forever. A running solve
  // deliberately keeps running: time is monotonic and the user can stop it
  // when returning to the page.
  useEffect(() => {
    const handleBlur = () => {
      const current = stateRef.current
      if (current.status === 'holding' || current.status === 'ready') {
        applyEvent({ type: 'cancel' })
      }
    }

    window.addEventListener('blur', handleBlur)
    return () => window.removeEventListener('blur', handleBlur)
  }, [applyEvent])

  let holdProgress = 0
  if (state.status === 'holding') {
    holdProgress = Math.min(
      1,
      Math.max(
        0,
        (clock - state.holdStartedAt) /
          Math.max(1, state.holdDurationMs),
      ),
    )
  } else if (state.status === 'ready') {
    holdProgress = 1
  }

  let inspectionStartedAt: number | null = null
  if (state.status === 'inspection') {
    inspectionStartedAt = state.inspectionStartedAt
  } else if (
    (state.status === 'holding' || state.status === 'ready') &&
    state.inspectionStartedAt !== null
  ) {
    inspectionStartedAt = state.inspectionStartedAt
  }

  const inspectionElapsedMs =
    inspectionStartedAt === null
      ? null
      : Math.max(0, clock - inspectionStartedAt)

  return {
    state,
    holdProgress,
    inspectionElapsedMs,
    press,
    release,
    cancel,
  }
}
