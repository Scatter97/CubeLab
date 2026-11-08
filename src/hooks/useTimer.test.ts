import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useTimer } from './useTimer'

describe('useTimer inspection and arming', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  function setup() {
    let clock = 0
    let tick: FrameRequestCallback | undefined
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
      tick = callback
      return 1
    })
    vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {})
    const onSolve = vi.fn()
    const hook = renderHook(() =>
      useTimer({
        inspectionEnabled: true,
        holdDurationMs: 300,
        onSolve,
        now: () => clock,
      }),
    )
    return {
      ...hook,
      onSolve,
      setClock: (next: number) => { clock = next },
      frame: (next: number) => { clock = next; act(() => tick?.(next)) },
    }
  }

  it('keeps inspection elapsed time advancing while armed and records at release', () => {
    const timer = setup()
    act(() => timer.result.current.press('keyboard'))
    expect(timer.result.current.state.status).toBe('inspection')

    timer.setClock(1_000)
    act(() => timer.result.current.press('keyboard'))
    expect(timer.result.current.state.status).toBe('holding')
    expect(timer.result.current.inspectionElapsedMs).toBe(1_000)

    timer.frame(1_300)
    expect(timer.result.current.state.status).toBe('ready')
    expect(timer.result.current.inspectionElapsedMs).toBe(1_300)

    timer.frame(9_000)
    expect(timer.result.current.inspectionElapsedMs).toBe(9_000)
    expect(timer.result.current.state.status).toBe('ready')
    expect(timer.onSolve).not.toHaveBeenCalled()

    timer.setClock(16_000)
    act(() => timer.result.current.release('keyboard'))
    expect(timer.result.current.state).toMatchObject({
      status: 'running',
      startedAt: 16_000,
      inspectionStartedAt: 0,
    })
    expect(timer.onSolve).not.toHaveBeenCalled()

    timer.setClock(26_000)
    act(() => timer.result.current.press('keyboard', 26_000))
    expect(timer.onSolve).toHaveBeenCalledExactlyOnceWith({
      rawMs: 10_000,
      penalty: '+2',
    })
  })

  it('starts an eligible hold on release when no readiness animation frame arrives', () => {
    let clock = 0
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(() => 1)
    vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {})
    const onSolve = vi.fn()
    const { result } = renderHook(() =>
      useTimer({
        inspectionEnabled: false,
        holdDurationMs: 300,
        onSolve,
        now: () => clock,
      }),
    )

    act(() => result.current.press('pointer'))
    expect(result.current.state.status).toBe('holding')
    clock = 300
    act(() => result.current.release('pointer'))
    expect(result.current.state).toMatchObject({
      status: 'running',
      startedAt: 300,
      input: 'pointer',
    })

    clock = 1_300
    act(() => result.current.press('pointer', 1_300))
    expect(onSolve).toHaveBeenCalledExactlyOnceWith({
      rawMs: 1_000,
      penalty: 'none',
    })
  })

  it('returns to the running inspection when released before arming', () => {
    const timer = setup()
    act(() => timer.result.current.press('keyboard'))
    timer.setClock(2_000)
    act(() => timer.result.current.press('keyboard'))
    timer.setClock(2_100)
    act(() => timer.result.current.release('keyboard'))

    expect(timer.result.current.state).toEqual({
      status: 'inspection',
      inspectionStartedAt: 0,
    })
    expect(timer.result.current.inspectionElapsedMs).toBe(2_100)
    expect(timer.onSolve).not.toHaveBeenCalled()
  })
})

describe('useTimer input-boundary timestamps', () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks() })

  it.each([['keyboard', 0, 'none'], ['pointer', 16000, '+2'], ['keyboard', 17500, 'dnf']] as const)(
    'records %s once with %s ms inspection without using display frames', (input, inspectionMs, penalty) => {
      let clock = 0
      let tick: FrameRequestCallback | undefined
      vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => { tick = callback; return 1 })
      vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {})
      const onSolve = vi.fn()
      const { result } = renderHook(() => useTimer({ inspectionEnabled: inspectionMs > 0,
        holdDurationMs: 300, onSolve, now: () => clock }))
      act(() => result.current.press(input))
      if (inspectionMs) {
        clock = inspectionMs - 300
        act(() => result.current.press(input))
      }
      clock += 300
      act(() => tick?.(clock))
      act(() => result.current.release(input))
      const startedAt = clock
      // The caller captured input before expensive audio/focus work.
      const capturedStop = startedAt + 1234.75
      clock = capturedStop + 100
      act(() => {
        result.current.press(input, capturedStop)
        result.current.release(input)
      })
      expect(onSolve).toHaveBeenCalledExactlyOnceWith({ rawMs: 1234.75, penalty })
      expect(result.current.state.status).toBe('idle')
    },
  )
})
