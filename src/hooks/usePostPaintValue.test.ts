import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePostPaintValue } from './usePostPaintValue'

describe('post-frame presentation updates', () => {
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })

  it('keeps current presentation through the frame and discards superseded updates', () => {
    vi.useFakeTimers()
    const frames = new Map<number, FrameRequestCallback>()
    let id = 0
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => { frames.set(++id, callback); return id })
    vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation((key) => { frames.delete(key) })
    const { result, rerender, unmount } = renderHook(({ value }) => usePostPaintValue(value), { initialProps: { value: 'original' } })
    rerender({ value: 'old update' })
    expect(result.current).toBe('original')
    act(() => { for (const callback of frames.values()) callback(16); frames.clear() })
    expect(result.current).toBe('original')
    // Supersede a queued task before it can publish stale data.
    rerender({ value: 'latest' })
    act(() => vi.runOnlyPendingTimers())
    expect(result.current).toBe('original')
    act(() => { for (const callback of frames.values()) callback(32); frames.clear() })
    act(() => vi.runOnlyPendingTimers())
    expect(result.current).toBe('latest')
    rerender({ value: 'unmounted' })
    unmount()
    expect(frames.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })
})
