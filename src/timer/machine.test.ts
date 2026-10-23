import { describe, expect, it } from 'vitest'
import {
  HOLD_TO_ARM_MS,
  INSPECTION_DNF_MS,
  INSPECTION_LIMIT_MS,
  initialTimerState,
  penaltyForInspection,
  transitionTimer,
  type TimerEvent,
  type TimerState,
} from './machine'

function send(state: TimerState, event: TimerEvent): TimerState {
  return transitionTimer(state, event).state
}

function armAndStart(
  state: TimerState,
  pressAt: number,
  releaseAt: number,
): TimerState {
  let next = send(state, {
    type: 'press',
    at: pressAt,
    input: 'keyboard',
    inspectionEnabled: false,
  })
  next = send(next, { type: 'tick', at: pressAt + HOLD_TO_ARM_MS })
  next = send(next, { type: 'release', at: releaseAt, input: 'keyboard' })
  return next
}

describe('inspection penalties', () => {
  it('keeps the first 15 seconds penalty-free', () => {
    expect(penaltyForInspection(0)).toBe('none')
    expect(penaltyForInspection(INSPECTION_LIMIT_MS)).toBe('none')
  })

  it('adds +2 after 15 seconds through 17 seconds', () => {
    expect(penaltyForInspection(INSPECTION_LIMIT_MS + 1)).toBe('+2')
    expect(penaltyForInspection(INSPECTION_DNF_MS)).toBe('+2')
  })

  it('turns DNF after 17 seconds', () => {
    expect(penaltyForInspection(INSPECTION_DNF_MS + 1)).toBe('dnf')
  })
})

describe('timer state machine', () => {
  it('arms after the hold threshold and starts on release', () => {
    const holding = send(initialTimerState, {
      type: 'press',
      at: 1_000,
      input: 'keyboard',
      inspectionEnabled: false,
    })
    expect(holding).toMatchObject({
      status: 'holding',
      holdStartedAt: 1_000,
      input: 'keyboard',
    })

    const stillHolding = send(holding, {
      type: 'tick',
      at: 1_000 + HOLD_TO_ARM_MS - 1,
    })
    expect(stillHolding.status).toBe('holding')

    const ready = send(holding, {
      type: 'tick',
      at: 1_000 + HOLD_TO_ARM_MS,
    })
    expect(ready.status).toBe('ready')

    const running = send(ready, {
      type: 'release',
      at: 1_800,
      input: 'keyboard',
    })
    expect(running).toMatchObject({ status: 'running', startedAt: 1_800 })
  })

  it('cancels a hold that is released before arming', () => {
    const holding = send(initialTimerState, {
      type: 'press',
      at: 1_000,
      input: 'keyboard',
      inspectionEnabled: false,
    })
    const released = send(holding, {
      type: 'release',
      at: 1_100,
      input: 'keyboard',
    })
    expect(released).toEqual(initialTimerState)
  })

  it('completes exactly once on a stop press', () => {
    const running = armAndStart(initialTimerState, 1_000, 1_500)
    const completed = transitionTimer(running, {
      type: 'press',
      at: 13_750,
      input: 'keyboard',
      inspectionEnabled: false,
    })

    expect(completed.state.status).toBe('idle')
    expect(completed.completed).toEqual({ rawMs: 12_250, penalty: 'none' })

    const repeated = transitionTimer(completed.state, {
      type: 'press',
      at: 13_800,
      input: 'keyboard',
      inspectionEnabled: false,
    })
    expect(repeated.state.status).toBe('holding')
    expect(repeated.completed).toBeUndefined()
  })

  it('ignores repeated tick and duplicate press events', () => {
    const ready = armAndStart(initialTimerState, 0, 1_000)
    const firstTick = transitionTimer(ready, { type: 'tick', at: 2_000 })
    expect(firstTick.state).toBe(ready)

    const holding = send(initialTimerState, {
      type: 'press',
      at: 3_000,
      input: 'keyboard',
      inspectionEnabled: false,
    })
    const duplicate = transitionTimer(holding, {
      type: 'press',
      at: 3_100,
      input: 'keyboard',
      inspectionEnabled: false,
    })
    expect(duplicate.state).toBe(holding)
    expect(duplicate.completed).toBeUndefined()
  })

  it('ignores releases from a different input source', () => {
    const holding = send(initialTimerState, {
      type: 'press',
      at: 1_000,
      input: 'keyboard',
      inspectionEnabled: false,
    })
    const pointerRelease = send(holding, {
      type: 'release',
      at: 1_500,
      input: 'pointer',
    })
    expect(pointerRelease).toBe(holding)
  })

  it('does not stop on release while running', () => {
    const running = armAndStart(initialTimerState, 0, 1_000)
    const released = send(running, {
      type: 'release',
      at: 2_000,
      input: 'keyboard',
    })
    expect(released).toBe(running)
  })

  it('starts inspection from idle and requires a second hold to solve', () => {
    const inspection = send(initialTimerState, {
      type: 'press',
      at: 1_000,
      input: 'keyboard',
      inspectionEnabled: true,
    })
    expect(inspection).toEqual({
      status: 'inspection',
      inspectionStartedAt: 1_000,
    })

    const releaseAfterStartingInspection = send(inspection, {
      type: 'release',
      at: 1_050,
      input: 'keyboard',
    })
    expect(releaseAfterStartingInspection).toBe(inspection)

    const holding = send(inspection, {
      type: 'press',
      at: 3_000,
      input: 'keyboard',
      inspectionEnabled: true,
    })
    expect(holding).toMatchObject({
      status: 'holding',
      inspectionStartedAt: 1_000,
    })

    const ready = send(holding, {
      type: 'tick',
      at: 3_000 + HOLD_TO_ARM_MS,
    })
    const running = send(ready, {
      type: 'release',
      at: 4_000,
      input: 'keyboard',
    })
    expect(running).toMatchObject({
      status: 'running',
      startedAt: 4_000,
      inspectionStartedAt: 1_000,
    })
  })

  it('applies +2 and DNF based on when the solve actually starts', () => {
    const inspection = send(initialTimerState, {
      type: 'press',
      at: 0,
      input: 'keyboard',
      inspectionEnabled: true,
    })

    const plusTwoStart = armAndStart(inspection, 1_000, 16_000)
    const plusTwo = transitionTimer(plusTwoStart, {
      type: 'press',
      at: 26_000,
      input: 'keyboard',
      inspectionEnabled: false,
    })
    expect(plusTwo.completed).toEqual({ rawMs: 10_000, penalty: '+2' })

    const dnfStart = armAndStart(inspection, 1_000, 17_001)
    const dnf = transitionTimer(dnfStart, {
      type: 'press',
      at: 27_001,
      input: 'keyboard',
      inspectionEnabled: false,
    })
    expect(dnf.completed).toEqual({ rawMs: 10_000, penalty: 'dnf' })
  })

  it('returns to inspection when an inspection hold is aborted', () => {
    const inspection = send(initialTimerState, {
      type: 'press',
      at: 100,
      input: 'keyboard',
      inspectionEnabled: true,
    })
    const holding = send(inspection, {
      type: 'press',
      at: 2_000,
      input: 'keyboard',
      inspectionEnabled: true,
    })
    const aborted = send(holding, {
      type: 'release',
      at: 2_100,
      input: 'keyboard',
    })
    expect(aborted).toEqual(inspection)
  })

  it('cancels inspection and cannot cancel a running solve', () => {
    const inspection = send(initialTimerState, {
      type: 'press',
      at: 100,
      input: 'keyboard',
      inspectionEnabled: true,
    })
    expect(send(inspection, { type: 'cancel' })).toEqual(initialTimerState)

    const running = armAndStart(initialTimerState, 0, 1_000)
    expect(send(running, { type: 'cancel' })).toBe(running)
  })
})
