import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TimerStage } from './TimerStage'
import { useTimer } from '../hooks/useTimer'
import type { TimerState } from '../timer/machine'

describe('timer display and input isolation', () => {
  let time = 0
  let sequence = 0
  let frames: Map<number, FrameRequestCallback>
  const frame = (at: number) => {
    time = at
    const callbacks = [...frames.values()]
    frames.clear()
    act(() => callbacks.forEach((callback) => callback(at)))
  }
  const props = {
    eventLabel: '3×3', inspectionElapsedMs: null, holdProgress: 0,
    latestSolve: null, disabled: false, inspectionEnabled: false,
    inspectionCountDirection: 'down' as const,
    onPress: vi.fn(), onRelease: vi.fn(), onCancel: vi.fn(),
  }

  beforeEach(() => {
    time = 0
    sequence = 0
    frames = new Map()
    vi.spyOn(performance, 'now').mockImplementation(() => time)
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.set(++sequence, callback)
      return sequence
    })
    vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation((id) => { frames.delete(id) })
  })
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  it('animates the readout without re-rendering the timer owner and records the input timestamp once', () => {
    const onSolve = vi.fn()
    let ownerRenders = 0
    function Owner() {
      ownerRenders++
      const timer = useTimer({ inspectionEnabled: false, holdDurationMs: 300, onSolve })
      return <TimerStage {...props} state={timer.state} holdProgress={timer.holdProgress}
        onPress={timer.press} onRelease={timer.release} />
    }
    render(<Owner />)
    const surface = screen.getByTestId('timer-surface')
    fireEvent.pointerDown(surface, { pointerId: 1 })
    frame(300)
    time = 350
    fireEvent.pointerUp(surface, { pointerId: 1 })
    expect(surface).toHaveAttribute('data-phase', 'running')
    const rendersAtStart = ownerRenders
    frame(456)
    frame(1350)
    expect(screen.getByTestId('timer-display')).toHaveTextContent('1.00')
    expect(ownerRenders).toBe(rendersAtStart)
    time = 1584.75
    // Focus represents slow browser work after input. It must not inflate raw time.
    vi.spyOn(surface, 'focus').mockImplementation(() => { time += 40 })
    fireEvent.pointerDown(surface, { pointerId: 2 })
    fireEvent.pointerUp(surface, { pointerId: 2 })
    expect(onSolve).toHaveBeenCalledExactlyOnceWith({ rawMs: 1234.75, penalty: 'none' })
    expect(surface).toHaveAttribute('data-phase', 'idle')
    expect(frames.size).toBe(0)
  })

  it('keeps the inspection readout visible through holding and armed states', () => {
    const holding: TimerState = {
      status: 'holding',
      holdStartedAt: 9_100,
      inspectionStartedAt: 0,
      input: 'keyboard',
      holdDurationMs: 300,
    }
    const ready: TimerState = {
      status: 'ready',
      inspectionStartedAt: 0,
      input: 'keyboard',
    }
    const { rerender } = render(
      <TimerStage
        {...props}
        state={holding}
        inspectionEnabled
        inspectionElapsedMs={9_000}
      />,
    )
    expect(screen.getByTestId('timer-display')).toHaveTextContent('6')
    expect(screen.getByTestId('timer-surface')).toHaveAttribute(
      'data-phase',
      'holding',
    )

    rerender(
      <TimerStage
        {...props}
        state={ready}
        inspectionEnabled
        inspectionElapsedMs={12_000}
      />,
    )
    expect(screen.getByTestId('timer-display')).toHaveTextContent('3')
    expect(screen.getByTestId('timer-surface')).toHaveAttribute(
      'data-phase',
      'ready',
    )
    expect(screen.getByTestId('timer-surface')).toHaveAccessibleName(
      /Inspection, 3\. Timer armed/,
    )

    rerender(
      <TimerStage
        {...props}
        state={{
          status: 'running',
          startedAt: 12_700,
          inspectionStartedAt: 0,
          input: 'keyboard',
        }}
        inspectionEnabled
        inspectionElapsedMs={12_700}
      />,
    )
    expect(screen.getByTestId('timer-display')).toHaveTextContent('0.00')
  })

  it('does not render instructional captions beneath the timer', () => {
    const { rerender } = render(<TimerStage {...props} state={{ status: 'idle' }} />)
    const readout = () => document.querySelector('.readout-zone')
    expect(readout()).not.toHaveTextContent('Ready')
    expect(readout()).not.toHaveTextContent('Inspection enabled')

    rerender(
      <TimerStage
        {...props}
        state={{
          status: 'holding',
          holdStartedAt: 1_000,
          inspectionStartedAt: null,
          input: 'keyboard',
          holdDurationMs: 300,
        }}
      />,
    )
    expect(readout()).not.toHaveTextContent('Keep holding')

    rerender(
      <TimerStage
        {...props}
        state={{ status: 'ready', inspectionStartedAt: null, input: 'keyboard' }}
      />,
    )
    expect(readout()).not.toHaveTextContent('Release to start')
  })

  it.each([
    ['live', '1.23'], ['tenths', '1.20'], ['seconds', '1.00'],
  ] as const)('retains %s display precision and resets a new run', (timerUpdateMode, expected) => {
    const running = (startedAt: number): TimerState => ({ status: 'running', startedAt,
      inspectionStartedAt: null, input: 'keyboard' })
    const { rerender } = render(<TimerStage {...props} state={running(100)} timerUpdateMode={timerUpdateMode} />)
    frame(1334)
    expect(screen.getByTestId('timer-display')).toHaveTextContent(expected)
    rerender(<TimerStage {...props} state={{ status: 'idle' }} timerUpdateMode={timerUpdateMode} />)
    expect(frames.size).toBe(0)
    rerender(<TimerStage {...props} state={running(2000)} timerUpdateMode={timerUpdateMode} />)
    expect(screen.getByTestId('timer-display')).toHaveTextContent('0.00')
    frame(3234)
    expect(screen.getByTestId('timer-display')).toHaveTextContent(expected)
  })
})
