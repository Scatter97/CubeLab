import type { Penalty } from '../types'

/** WCA inspection limits. */
export const INSPECTION_LIMIT_MS = 15_000
export const INSPECTION_DNF_MS = 17_000
/** How long a key or pointer must remain down before a solve can start. */
export const HOLD_TO_ARM_MS = 300

export type TimerInput = 'keyboard' | 'pointer'
export type TimerPhase = 'idle' | 'inspection' | 'holding' | 'ready' | 'running'

export interface IdleState {
  readonly status: 'idle'
}

export interface InspectionState {
  readonly status: 'inspection'
  readonly inspectionStartedAt: number
}

export interface HoldingState {
  readonly status: 'holding'
  readonly holdStartedAt: number
  readonly inspectionStartedAt: number | null
  readonly input: TimerInput
  readonly holdDurationMs: number
}

export interface ReadyState {
  readonly status: 'ready'
  readonly inspectionStartedAt: number | null
  readonly input: TimerInput
}

export interface RunningState {
  readonly status: 'running'
  readonly startedAt: number
  readonly inspectionStartedAt: number | null
  readonly input: TimerInput
}

export type TimerState =
  | IdleState
  | InspectionState
  | HoldingState
  | ReadyState
  | RunningState

export type TimerEvent =
  | {
      type: 'press'
      at: number
      input: TimerInput
      inspectionEnabled: boolean
      holdDurationMs?: number
    }
  | { type: 'release'; at: number; input: TimerInput }
  | { type: 'tick'; at: number }
  | { type: 'cancel' }

export interface TimerCompletion {
  rawMs: number
  penalty: Penalty
}

export interface TimerTransition {
  state: TimerState
  completed?: TimerCompletion
}

export const initialTimerState: TimerState = { status: 'idle' }

/**
 * WCA inspection penalties are based on the time at which the solve starts.
 * The first 15 seconds are free, the next two seconds incur +2, and anything
 * beyond 17 seconds is a DNF.
 */
export function penaltyForInspection(elapsedMs: number): Penalty {
  if (elapsedMs > INSPECTION_DNF_MS) return 'dnf'
  if (elapsedMs > INSPECTION_LIMIT_MS) return '+2'
  return 'none'
}

function inspectionPenaltyAt(
  startedAt: number,
  inspectionStartedAt: number | null,
): Penalty {
  if (inspectionStartedAt === null) return 'none'
  return penaltyForInspection(startedAt - inspectionStartedAt)
}

/**
 * Pure timer state machine. It never reads a clock itself, and every invalid
 * event returns the exact same state object. This makes duplicate key presses
 * and repeated browser events harmless.
 */
export function transitionTimer(
  state: TimerState,
  event: TimerEvent,
): TimerTransition {
  switch (event.type) {
    case 'press': {
      switch (state.status) {
        case 'idle':
          if (event.inspectionEnabled) {
            return {
              state: {
                status: 'inspection',
                inspectionStartedAt: event.at,
              },
            }
          }
          return {
            state: {
              status: 'holding',
              holdStartedAt: event.at,
              inspectionStartedAt: null,
              input: event.input,
              holdDurationMs: event.holdDurationMs ?? HOLD_TO_ARM_MS,
            },
          }
        case 'inspection':
          return {
            state: {
              status: 'holding',
              holdStartedAt: event.at,
              inspectionStartedAt: state.inspectionStartedAt,
              input: event.input,
              holdDurationMs: event.holdDurationMs ?? HOLD_TO_ARM_MS,
            },
          }
        case 'running': {
          const rawMs = Math.max(0, event.at - state.startedAt)
          return {
            state: initialTimerState,
            completed: {
              rawMs,
              penalty: inspectionPenaltyAt(
                state.startedAt,
                state.inspectionStartedAt,
              ),
            },
          }
        }
        case 'holding':
        case 'ready':
          // A repeated press (including OS key-repeat) must not re-arm or
          // accidentally stop an active timer.
          return { state }
      }
    }

    case 'release': {
      if (state.status === 'holding' && state.input === event.input) {
        // Readiness is a property of elapsed hold time, not of the last
        // presentation tick. If the eligible release arrives before a tick,
        // start directly from the release timestamp so dropped frames or a
        // suspended animation clock cannot cancel a valid hold.
        if (event.at - state.holdStartedAt >= state.holdDurationMs) {
          return {
            state: {
              status: 'running',
              startedAt: event.at,
              inspectionStartedAt: state.inspectionStartedAt,
              input: state.input,
            },
          }
        }
        if (state.inspectionStartedAt === null) {
          return { state: initialTimerState }
        }
        return {
          state: {
            status: 'inspection',
            inspectionStartedAt: state.inspectionStartedAt,
          },
        }
      }

      if (state.status === 'ready' && state.input === event.input) {
        return {
          state: {
            status: 'running',
            startedAt: event.at,
            inspectionStartedAt: state.inspectionStartedAt,
            input: state.input,
          },
        }
      }

      // Releasing while the timer is running must not stop it. Stopping is an
      // explicit press, which also prevents a key-up from recording twice.
      return { state }
    }

    case 'tick': {
      if (
        state.status === 'holding' &&
        event.at - state.holdStartedAt >= state.holdDurationMs
      ) {
        return {
          state: {
            status: 'ready',
            inspectionStartedAt: state.inspectionStartedAt,
            input: state.input,
          },
        }
      }
      return { state }
    }

    case 'cancel': {
      if (state.status === 'running' || state.status === 'idle') return { state }
      return { state: initialTimerState }
    }
  }
}

