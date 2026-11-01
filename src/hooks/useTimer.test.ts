import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useTimer } from './useTimer'

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
