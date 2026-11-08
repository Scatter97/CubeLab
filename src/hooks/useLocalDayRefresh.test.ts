import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  localDayStart,
  millisecondsUntilNextLocalMidnight,
  useLocalDayRefresh,
} from './useLocalDayRefresh'

describe('useLocalDayRefresh', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('refreshes at the next local midnight across a spring DST change', () => {
    vi.setSystemTime(new Date(2026, 2, 8, 12))
    const { result } = renderHook(() => useLocalDayRefresh())
    expect(result.current).toBe(new Date(2026, 2, 8).getTime())

    act(() => {
      vi.setSystemTime(new Date(2026, 2, 9, 0, 0, 1))
      vi.advanceTimersByTime(12 * 60 * 60 * 1000 + 100)
    })

    expect(result.current).toBe(new Date(2026, 2, 9).getTime())
  })

  it('refreshes at the next local midnight across a fall DST change', () => {
    vi.setSystemTime(new Date(2026, 9, 31, 12))
    const { result } = renderHook(() => useLocalDayRefresh())
    expect(result.current).toBe(new Date(2026, 9, 31).getTime())

    act(() => {
      vi.setSystemTime(new Date(2026, 10, 1, 0, 0, 1))
      vi.advanceTimersByTime(12 * 60 * 60 * 1000 + 100)
    })

    expect(result.current).toBe(new Date(2026, 10, 1).getTime())
  })

  it('catches up after returning to a backgrounded page without double recomputing', () => {
    vi.setSystemTime(new Date(2026, 4, 4, 23, 59, 30))
    const { result } = renderHook(() => useLocalDayRefresh())
    const firstDay = result.current

    act(() => {
      vi.setSystemTime(new Date(2026, 4, 8, 9))
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(result.current).toBe(new Date(2026, 4, 8).getTime())

    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(result.current).toBe(new Date(2026, 4, 8).getTime())
    expect(result.current).not.toBe(firstDay)
  })

  it('clears its timer on unmount', () => {
    vi.setSystemTime(new Date(2026, 0, 1, 12))
    const { unmount } = renderHook(() => useLocalDayRefresh())
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('uses calendar arithmetic for DST and month boundaries', () => {
    expect(
      millisecondsUntilNextLocalMidnight(new Date(2026, 2, 8, 12).getTime()),
    ).toBe(12 * 60 * 60 * 1000)
    expect(
      localDayStart(new Date(2026, 2, 9, 0, 30).getTime()),
    ).toBe(new Date(2026, 2, 9).getTime())
    expect(
      localDayStart(new Date(2025, 11, 31, 23, 59).getTime()),
    ).toBe(new Date(2025, 11, 31).getTime())
  })
})
