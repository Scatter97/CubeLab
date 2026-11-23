import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import {
  SCRAMBLE_GENERATION_TIMEOUT_MS,
  useScramble,
} from './useScramble'
import { generateScramble } from '../lib/scramble'

const TIMEOUT_MESSAGE = 'Scramble generation timed out.'

const mocks = vi.hoisted(() => ({ TIMEOUT_MESSAGE: 'Scramble generation timed out.' }))

vi.mock('../lib/scramble', () => ({
  generateScramble: vi.fn(),
  SCRAMBLE_TIMEOUT_MESSAGE: mocks.TIMEOUT_MESSAGE,
  DEFAULT_SCRAMBLE_TIMEOUT_MS: 20_000,
}))

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.resetAllMocks()
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function timeoutAfter(
  options: { timeoutMs?: number; signal?: AbortSignal } | undefined,
  stale?: Promise<string>,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error(TIMEOUT_MESSAGE)),
      options?.timeoutMs,
    )
    const abort = () => {
      window.clearTimeout(timer)
      reject(new Error('Scramble generation was cancelled.'))
    }
    options?.signal?.addEventListener('abort', abort, { once: true })
    stale?.then(resolve)
  })
}

async function flushPromises() {
  for (let index = 0; index < 10; index += 1) await Promise.resolve()
}

it('suspends ordinary event generation outside Timer and resumes its existing queue', async () => {
  vi.mocked(generateScramble).mockResolvedValue("R U R' U'")
  const { result, rerender } = renderHook(({enabled}) => useScramble('333',enabled), {initialProps:{enabled:false}})
  expect(generateScramble).not.toHaveBeenCalled()
  act(() => rerender({enabled:true}))
  await waitFor(() => expect(result.current.scramble).not.toBeNull())
  expect(generateScramble).toHaveBeenCalledTimes(2)
  act(() => rerender({enabled:false}))
  act(() => rerender({enabled:true}))
  await waitFor(() => expect(result.current.isLoading).toBe(false))
  expect(generateScramble).toHaveBeenCalledTimes(2)
})

it('times out a stalled initial request, retries successfully, and ignores the stale result', async () => {
  vi.useFakeTimers()
  const stalled = deferred<string>()
  vi.mocked(generateScramble)
    .mockImplementationOnce((_event, options) =>
      timeoutAfter(options, stalled.promise),
    )
    .mockResolvedValue("F R U' R' U' R U R' F'")

  const { result } = renderHook(() => useScramble('333', true))
  expect(result.current.isLoading).toBe(true)
  expect(result.current.scramble).toBeNull()

  await act(async () => {
    await vi.advanceTimersByTimeAsync(SCRAMBLE_GENERATION_TIMEOUT_MS)
  })
  expect(result.current.error).toContain('Could not generate a scramble')
  expect(result.current.isLoading).toBe(false)

  act(() => result.current.retry())
  await act(async () => {
    await flushPromises()
  })
  expect(result.current.scramble).toBe("F R U' R' U' R U R' F'")
  expect(result.current.error).toBeNull()
  expect(generateScramble).toHaveBeenLastCalledWith(
    '333',
    expect.objectContaining({
      freshWorker: true,
      timeoutMs: SCRAMBLE_GENERATION_TIMEOUT_MS,
    }),
  )

  await act(async () => {
    stalled.resolve('STALE SCRAMBLE')
    await Promise.resolve()
  })
  expect(result.current.scramble).toBe("F R U' R' U' R U R' F'")
  expect(result.current.nextScramble).toBe("F R U' R' U' R U R' F'")
})

it('offers reload recovery after repeated generation failures', async () => {
  vi.useFakeTimers()
  vi.mocked(generateScramble).mockImplementation((_event, options) =>
    timeoutAfter(options),
  )

  const { result } = renderHook(() => useScramble('333', true))
  await act(async () => {
    await vi.advanceTimersByTimeAsync(SCRAMBLE_GENERATION_TIMEOUT_MS)
  })
  expect(result.current.error).toContain('Could not generate a scramble')
  expect(result.current.recoveryRequired).toBe(false)

  act(() => result.current.retry())
  await act(async () => {
    await vi.advanceTimersByTimeAsync(SCRAMBLE_GENERATION_TIMEOUT_MS)
  })
  expect(result.current.recoveryRequired).toBe(true)
  expect(result.current.error).toContain('Could not generate a scramble')
})

it('aborts a switched event request and does not let its late result replace the new queue', async () => {
  const stalled = deferred<string>()
  let stalledSignal: AbortSignal | undefined
  vi.mocked(generateScramble)
    .mockImplementationOnce((_event, options) => {
      stalledSignal = options?.signal
      return stalled.promise
    })
    .mockResolvedValue("R U R' U' F2 D L2 B' R2 U2")

  const { result, rerender } = renderHook(
    ({ event }: { event: '333' | '222' }) => useScramble(event, true),
    { initialProps: { event: '333' } as { event: '333' | '222' } },
  )
  act(() => rerender({ event: '222' }))
  await waitFor(() =>
    expect(result.current.scramble).toBe("R U R' U' F2 D L2 B' R2 U2"),
  )
  expect(stalledSignal?.aborted).toBe(true)

  await act(async () => {
    stalled.resolve('STALE 333 SCRAMBLE')
    await Promise.resolve()
  })
  expect(result.current.scramble).toBe("R U R' U' F2 D L2 B' R2 U2")
})

it('switches puzzles while a recovery request is pending and abandons its result', async () => {
  vi.useFakeTimers()
  const recovery = deferred<string>()
  let recoverySignal: AbortSignal | undefined
  vi.mocked(generateScramble)
    .mockImplementationOnce((_event, options) => timeoutAfter(options))
    .mockImplementationOnce((_event, options) => {
      recoverySignal = options?.signal
      return recovery.promise
    })
    .mockResolvedValue("R U R' U' F2 D L2 B' R2 U2")

  const { result, rerender } = renderHook(
    ({ event }: { event: '333' | '222' }) => useScramble(event, true),
    { initialProps: { event: '333' } as { event: '333' | '222' } },
  )
  await act(async () => {
    await vi.advanceTimersByTimeAsync(SCRAMBLE_GENERATION_TIMEOUT_MS)
  })
  expect(result.current.error).toContain('Could not generate a scramble')

  act(() => result.current.retry())
  await act(async () => {
    await flushPromises()
  })
  expect(generateScramble).toHaveBeenCalledTimes(2)
  expect(recoverySignal?.aborted).toBe(false)

  act(() => rerender({ event: '222' }))
  await act(async () => {
    await flushPromises()
  })
  expect(recoverySignal?.aborted).toBe(true)
  expect(result.current.scramble).toBe("R U R' U' F2 D L2 B' R2 U2")

  await act(async () => {
    recovery.resolve('STALE 333 RECOVERY SCRAMBLE')
    await Promise.resolve()
  })
  expect(result.current.scramble).toBe("R U R' U' F2 D L2 B' R2 U2")
  expect(result.current.nextScramble).toBe("R U R' U' F2 D L2 B' R2 U2")
})
