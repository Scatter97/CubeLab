// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_SCRAMBLE_TIMEOUT_MS,
  generateScramble,
  isPlausibleScramble,
  resetScrambleCoordinatorForTests,
  SCRAMBLE_TIMEOUT_MESSAGE,
} from './scramble'

const mocks = vi.hoisted(() => ({
  randomScrambleForEvent: vi.fn(),
  setSearchDebug: vi.fn(),
}))

vi.mock('cubing/scramble', () => ({
  randomScrambleForEvent: mocks.randomScrambleForEvent,
}))
vi.mock('cubing/search', () => ({
  setSearchDebug: mocks.setSearchDebug,
}))

const FIRST_SCRAMBLE = "R U R' U' F2 D L2 B' R2 U2"
const SECOND_SCRAMBLE = "F R U' R' U' R U R' F'"

type FakeWorkerListener = (event: Event) => void

class FakeWorker {
  static instances: FakeWorker[] = []
  static live = 0
  static maxLive = 0
  terminated = false
  private listeners = new Map<string, Set<FakeWorkerListener>>()

  constructor(readonly url: string) {
    FakeWorker.instances.push(this)
    FakeWorker.live += 1
    FakeWorker.maxLive = Math.max(FakeWorker.maxLive, FakeWorker.live)
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null) {
    if (!listener) return
    const callback =
      typeof listener === 'function'
        ? listener
        : (event: Event) => listener.handleEvent(event)
    const listeners = this.listeners.get(type) ?? new Set<FakeWorkerListener>()
    listeners.add(callback)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null) {
    if (!listener) return
    const listeners = this.listeners.get(type)
    if (!listeners) return
    if (typeof listener === 'function') listeners.delete(listener)
  }

  emit(type: string, event: Event) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      listener(event)
    }
  }

  terminate() {
    if (this.terminated) return
    this.terminated = true
    FakeWorker.live -= 1
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function algorithm(value: string) {
  return { toString: () => value }
}

function createSearchWorker() {
  return new window.Worker('https://example.test/search-worker-entry.js', {
    type: 'module',
  })
}

async function flushPromises() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
  if (vi.isFakeTimers()) {
    await vi.advanceTimersByTimeAsync(0)
  } else {
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
  }
}

beforeAll(() => {
  vi.stubGlobal('Worker', FakeWorker)
})

beforeEach(() => {
  FakeWorker.instances = []
  FakeWorker.live = 0
  FakeWorker.maxLive = 0
})

afterEach(() => {
  resetScrambleCoordinatorForTests()
  FakeWorker.instances = []
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('scramble request ownership', () => {
  it('serializes overlapping requests and releases only the completed request workers', async () => {
    const first = deferred<{ toString: () => string }>()
    const second = deferred<{ toString: () => string }>()
    let calls = 0
    mocks.randomScrambleForEvent.mockImplementation(() => {
      createSearchWorker()
      calls += 1
      return calls === 1 ? first.promise : second.promise
    })

    const firstResult = generateScramble('333', { freshWorker: true })
    const secondResult = generateScramble('222', { freshWorker: true })
    await flushPromises()

    // The second request waits at the shared boundary instead of creating a
    // worker that the first request's cleanup could terminate.
    expect(mocks.randomScrambleForEvent).toHaveBeenCalledTimes(1)
    expect(FakeWorker.instances).toHaveLength(1)

    first.resolve(algorithm(FIRST_SCRAMBLE))
    await expect(firstResult).resolves.toBe(FIRST_SCRAMBLE)
    await flushPromises()

    expect(mocks.randomScrambleForEvent).toHaveBeenCalledTimes(2)
    expect(FakeWorker.instances).toHaveLength(2)
    expect(FakeWorker.instances[0]?.terminated).toBe(true)
    expect(FakeWorker.instances[1]?.terminated).toBe(false)

    second.resolve(algorithm(SECOND_SCRAMBLE))
    await expect(secondResult).resolves.toBe(SECOND_SCRAMBLE)
    expect(FakeWorker.instances[1]?.terminated).toBe(true)
    expect(isPlausibleScramble(FIRST_SCRAMBLE)).toBe(true)
    expect(isPlausibleScramble(SECOND_SCRAMBLE)).toBe(true)
  })

  it('times out one request, bypasses its cached worker, and lets the next request finish', async () => {
    vi.useFakeTimers()
    const first = deferred<{ toString: () => string }>()
    const second = deferred<{ toString: () => string }>()
    let calls = 0
    mocks.randomScrambleForEvent.mockImplementation(() => {
      createSearchWorker()
      calls += 1
      return calls === 1 ? first.promise : second.promise
    })

    const firstResult = generateScramble('333', { timeoutMs: 100 })
    const firstOutcome = firstResult.then(
      () => null,
      (error: unknown) => error,
    )
    const secondResult = generateScramble('222', { timeoutMs: 100 })
    await flushPromises()
    expect(FakeWorker.instances).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(100)
    await flushPromises()

    const timeout = await firstOutcome
    expect(timeout).toBeInstanceOf(Error)
    expect((timeout as Error).message).toBe(SCRAMBLE_TIMEOUT_MESSAGE)
    expect(FakeWorker.instances[0]?.terminated).toBe(true)
    expect(mocks.randomScrambleForEvent).toHaveBeenCalledTimes(2)
    expect(FakeWorker.instances).toHaveLength(2)

    // The abandoned worker result cannot replace the queued request.
    first.resolve(algorithm('STALE SCRAMBLE'))
    await flushPromises()
    second.resolve(algorithm(SECOND_SCRAMBLE))
    await expect(secondResult).resolves.toBe(SECOND_SCRAMBLE)
    expect(FakeWorker.instances[1]?.terminated).toBe(true)
    expect(isPlausibleScramble(SECOND_SCRAMBLE, '222')).toBe(true)
  })

  it('applies the default deadline to a battle-style request and starts the queued timer request', async () => {
    vi.useFakeTimers()
    const battle = deferred<{ toString: () => string }>()
    let calls = 0
    mocks.randomScrambleForEvent.mockImplementation(() => {
      createSearchWorker()
      calls += 1
      return calls === 1
        ? battle.promise
        : Promise.resolve(algorithm(SECOND_SCRAMBLE))
    })

    const controller = new AbortController()
    const battleOutcome = generateScramble('333', {
      signal: controller.signal,
    }).then(
      () => null,
      (error: unknown) => error,
    )
    const timerResult = generateScramble('222')
    await flushPromises()
    expect(calls).toBe(1)

    // A Battle request passes a signal but no timeout override. The timer
    // request is queued and must not start its own deadline yet.
    await vi.advanceTimersByTimeAsync(DEFAULT_SCRAMBLE_TIMEOUT_MS - 1)
    expect(calls).toBe(1)

    await vi.advanceTimersByTimeAsync(1)
    await flushPromises()

    const timeout = await battleOutcome
    expect(timeout).toBeInstanceOf(Error)
    expect((timeout as Error).message).toBe(SCRAMBLE_TIMEOUT_MESSAGE)
    expect(calls).toBe(2)
    await expect(timerResult).resolves.toBe(SECOND_SCRAMBLE)
    expect(isPlausibleScramble(SECOND_SCRAMBLE, '222')).toBe(true)
    expect(FakeWorker.instances[0]?.terminated).toBe(true)
    expect(FakeWorker.instances[1]?.terminated).toBe(true)

    // The abandoned Battle result cannot replace the timer result or start a
    // race after its timeout.
    battle.resolve(algorithm('STALE BATTLE SCRAMBLE'))
    await flushPromises()
    await expect(timerResult).resolves.toBe(SECOND_SCRAMBLE)
  })

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'normalizes an invalid timeout override (%s) to the finite default',
    async (timeoutMs) => {
      vi.useFakeTimers()
      mocks.randomScrambleForEvent.mockImplementation(() => {
        createSearchWorker()
        return new Promise(() => {})
      })

      const outcome = generateScramble('333', { timeoutMs }).then(
        () => null,
        (error: unknown) => error,
      )
      await flushPromises()
      await vi.advanceTimersByTimeAsync(DEFAULT_SCRAMBLE_TIMEOUT_MS - 1)
      let settled = false
      void outcome.then(() => {
        settled = true
      })
      await flushPromises()
      expect(settled).toBe(false)

      await vi.advanceTimersByTimeAsync(1)
      await flushPromises()
      const timeout = await outcome
      expect(timeout).toBeInstanceOf(Error)
      expect((timeout as Error).message).toBe(SCRAMBLE_TIMEOUT_MESSAGE)
      expect(FakeWorker.instances[0]?.terminated).toBe(true)
    },
  )

  it('gives a queued request its own full deadline when it becomes active', async () => {
    vi.useFakeTimers()
    const first = deferred<{ toString: () => string }>()
    let calls = 0
    mocks.randomScrambleForEvent.mockImplementation(() => {
      createSearchWorker()
      calls += 1
      return calls === 1 ? first.promise : new Promise(() => {})
    })

    const firstOutcome = generateScramble('333', { timeoutMs: 100 }).then(
      () => null,
      (error: unknown) => error,
    )
    const secondOutcome = generateScramble('222', { timeoutMs: 100 }).then(
      () => null,
      (error: unknown) => error,
    )
    await flushPromises()

    // 99 ms belongs only to the active request. The queued request has not
    // started counting down and has not reached cubing.js.
    await vi.advanceTimersByTimeAsync(99)
    expect(calls).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    await flushPromises()
    expect(calls).toBe(2)
    expect((await firstOutcome as Error).message).toBe(SCRAMBLE_TIMEOUT_MESSAGE)

    // The second request started at 100 ms with a fresh 100 ms deadline.
    let secondSettled = false
    void secondOutcome.then(() => {
      secondSettled = true
    })
    await vi.advanceTimersByTimeAsync(99)
    await flushPromises()
    expect(secondSettled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await flushPromises()
    expect((await secondOutcome as Error).message).toBe(SCRAMBLE_TIMEOUT_MESSAGE)
  })

  it('disposes late workers from cancelled generations and keeps the current worker intact', async () => {
    const firstConstruction = deferred<void>()
    const secondConstruction = deferred<void>()
    const third = deferred<{ toString: () => string }>()
    let calls = 0
    mocks.randomScrambleForEvent.mockImplementation(() => {
      calls += 1
      if (calls === 1) {
        return firstConstruction.promise.then(() => {
          createSearchWorker()
          return algorithm('STALE FIRST SCRAMBLE')
        })
      }
      if (calls === 2) {
        return secondConstruction.promise.then(() => {
          createSearchWorker()
          return algorithm('STALE SECOND SCRAMBLE')
        })
      }
      createSearchWorker()
      return third.promise
    })

    const firstController = new AbortController()
    const firstOutcome = generateScramble('333', {
      freshWorker: true,
      signal: firstController.signal,
    }).then(
      () => null,
      (error: unknown) => error,
    )
    const secondController = new AbortController()
    const secondOutcome = generateScramble('222', {
      freshWorker: true,
      signal: secondController.signal,
    }).then(
      () => null,
      (error: unknown) => error,
    )
    await flushPromises()

    firstController.abort(new Error('cancel first'))
    await flushPromises()
    secondController.abort(new Error('cancel second'))
    await flushPromises()

    const thirdResult = generateScramble('222', { freshWorker: true })
    await flushPromises()
    expect(calls).toBe(3)
    expect(await firstOutcome).toBeInstanceOf(Error)
    expect(await secondOutcome).toBeInstanceOf(Error)

    // The third request's worker is constructed inside its guarded entry.
    expect(FakeWorker.instances).toHaveLength(1)
    const currentWorker = FakeWorker.instances[0]!
    expect(currentWorker.terminated).toBe(false)

    // The two abandoned generations construct workers later. Neither may join
    // the current request, and the current worker must remain usable.
    firstConstruction.resolve()
    secondConstruction.resolve()
    await flushPromises()
    expect(FakeWorker.instances).toHaveLength(3)
    expect(FakeWorker.instances[1]?.terminated).toBe(true)
    expect(FakeWorker.instances[2]?.terminated).toBe(true)
    expect(currentWorker.terminated).toBe(false)
    expect(FakeWorker.instances.filter((worker) => !worker.terminated)).toHaveLength(1)
    expect(FakeWorker.live).toBe(1)
    expect(FakeWorker.maxLive).toBeLessThanOrEqual(2)

    third.resolve(algorithm(SECOND_SCRAMBLE))
    await expect(thirdResult).resolves.toBe(SECOND_SCRAMBLE)
    expect(isPlausibleScramble(SECOND_SCRAMBLE, '222')).toBe(true)
    expect(currentWorker.terminated).toBe(true)
    expect(FakeWorker.instances.filter((worker) => !worker.terminated)).toHaveLength(0)
    expect(FakeWorker.live).toBe(0)
  })

  it('keeps live workers bounded through repeated cancellations and late construction', async () => {
    const gates = Array.from({ length: 4 }, () => deferred<void>())
    const final = deferred<{ toString: () => string }>()
    const outcomes: Promise<unknown>[] = []
    let calls = 0
    mocks.randomScrambleForEvent.mockImplementation(() => {
      const index = calls
      calls += 1
      if (index < gates.length) {
        return gates[index]!.promise.then(() => {
          createSearchWorker()
          return algorithm(`STALE ${index}`)
        })
      }
      createSearchWorker()
      return final.promise
    })

    for (let index = 0; index < gates.length; index += 1) {
      const controller = new AbortController()
      outcomes.push(
        generateScramble('333', {
          freshWorker: true,
          signal: controller.signal,
        }).then(
          () => null,
          (error: unknown) => error,
        ),
      )
      await flushPromises()
      expect(calls).toBe(index + 1)
      controller.abort(new Error(`cancel ${index}`))
      await flushPromises()
    }

    const finalResult = generateScramble('222', { freshWorker: true })
    await flushPromises()
    expect(calls).toBe(gates.length + 1)
    expect(FakeWorker.live).toBe(1)
    expect(FakeWorker.maxLive).toBe(1)

    for (const gate of gates) gate.resolve()
    await flushPromises()
    expect(FakeWorker.instances).toHaveLength(gates.length + 1)
    expect(FakeWorker.instances.filter((worker) => worker.terminated)).toHaveLength(
      gates.length,
    )
    expect(FakeWorker.live).toBe(1)
    // Each late constructor briefly overlaps the live current worker before
    // being terminated in the same construction step.
    expect(FakeWorker.maxLive).toBe(2)
    for (const outcome of outcomes) expect(await outcome).toBeInstanceOf(Error)

    final.resolve(algorithm(SECOND_SCRAMBLE))
    await expect(finalResult).resolves.toBe(SECOND_SCRAMBLE)
    expect(FakeWorker.live).toBe(0)
    expect(FakeWorker.instances.every((worker) => worker.terminated)).toBe(true)
  })

  it('disposes a worker constructed after a timeout without disturbing the successor', async () => {
    vi.useFakeTimers()
    const lateConstruction = deferred<void>()
    const successor = deferred<{ toString: () => string }>()
    let calls = 0
    mocks.randomScrambleForEvent.mockImplementation(() => {
      calls += 1
      if (calls === 1) {
        return lateConstruction.promise.then(() => {
          createSearchWorker()
          return algorithm('STALE TIMED-OUT SCRAMBLE')
        })
      }
      createSearchWorker()
      return successor.promise
    })

    const timedOut = generateScramble('333', { timeoutMs: 100 }).then(
      () => null,
      (error: unknown) => error,
    )
    await flushPromises()
    expect(calls).toBe(1)
    await vi.advanceTimersByTimeAsync(100)
    await flushPromises()
    expect((await timedOut as Error).message).toBe(SCRAMBLE_TIMEOUT_MESSAGE)

    const successorResult = generateScramble('222')
    await flushPromises()
    expect(calls).toBe(2)
    expect(FakeWorker.instances).toHaveLength(1)
    const successorWorker = FakeWorker.instances[0]!
    expect(successorWorker.terminated).toBe(false)

    lateConstruction.resolve()
    await flushPromises()
    expect(FakeWorker.instances).toHaveLength(2)
    expect(FakeWorker.instances[1]?.terminated).toBe(true) // late timed-out worker
    expect(successorWorker.terminated).toBe(false)

    successor.resolve(algorithm(SECOND_SCRAMBLE))
    await expect(successorResult).resolves.toBe(SECOND_SCRAMBLE)
    expect(successorWorker.terminated).toBe(true)
  })

  it('cancels one request without terminating the next request worker', async () => {
    const first = deferred<{ toString: () => string }>()
    const second = deferred<{ toString: () => string }>()
    let calls = 0
    mocks.randomScrambleForEvent.mockImplementation(() => {
      createSearchWorker()
      calls += 1
      return calls === 1 ? first.promise : second.promise
    })

    const controller = new AbortController()
    const firstResult = generateScramble('333', {
      freshWorker: true,
      signal: controller.signal,
    })
    const firstOutcome = firstResult.then(
      () => null,
      (error: unknown) => error,
    )
    const secondResult = generateScramble('222', { freshWorker: true })
    await flushPromises()
    expect(FakeWorker.instances).toHaveLength(1)

    controller.abort(new Error('switch puzzles'))
    await flushPromises()

    expect(await firstOutcome).toBeInstanceOf(Error)
    expect(FakeWorker.instances[0]?.terminated).toBe(true)
    expect(mocks.randomScrambleForEvent).toHaveBeenCalledTimes(2)
    expect(FakeWorker.instances).toHaveLength(2)
    expect(FakeWorker.instances[1]?.terminated).toBe(false)

    first.resolve(algorithm('STALE SCRAMBLE'))
    await flushPromises()
    second.resolve(algorithm(FIRST_SCRAMBLE))
    await expect(secondResult).resolves.toBe(FIRST_SCRAMBLE)
    expect(FakeWorker.instances[1]?.terminated).toBe(true)
    expect(isPlausibleScramble(FIRST_SCRAMBLE, '222')).toBe(true)
  })

  it('releases a cancelled cached request so the next request uses a fresh worker', async () => {
    const first = deferred<{ toString: () => string }>()
    const second = deferred<{ toString: () => string }>()
    let calls = 0
    mocks.randomScrambleForEvent.mockImplementation(() => {
      createSearchWorker()
      calls += 1
      return calls === 1 ? first.promise : second.promise
    })

    const controller = new AbortController()
    const firstResult = generateScramble('333', { signal: controller.signal })
    const firstOutcome = firstResult.then(
      () => null,
      (error: unknown) => error,
    )
    const secondResult = generateScramble('222')
    await flushPromises()
    expect(FakeWorker.instances).toHaveLength(1)
    expect(FakeWorker.instances[0]?.terminated).toBe(false)

    controller.abort(new Error('switch puzzles'))
    await flushPromises()

    expect(await firstOutcome).toBeInstanceOf(Error)
    expect(FakeWorker.instances[0]?.terminated).toBe(true)
    expect(calls).toBe(2)
    expect(FakeWorker.instances).toHaveLength(2)
    expect(FakeWorker.instances[1]?.terminated).toBe(false)

    second.resolve(algorithm(SECOND_SCRAMBLE))
    await expect(secondResult).resolves.toBe(SECOND_SCRAMBLE)
    expect(FakeWorker.instances[1]?.terminated).toBe(true)
    expect(isPlausibleScramble(SECOND_SCRAMBLE, '222')).toBe(true)
  })

  it('drops a cancelled queued request without disturbing the active request', async () => {
    const first = deferred<{ toString: () => string }>()
    let calls = 0
    mocks.randomScrambleForEvent.mockImplementation(() => {
      createSearchWorker()
      calls += 1
      return first.promise
    })

    const firstResult = generateScramble('333', { freshWorker: true })
    const controller = new AbortController()
    const queuedResult = generateScramble('222', {
      freshWorker: true,
      signal: controller.signal,
    })
    const queuedOutcome = queuedResult.then(
      () => null,
      (error: unknown) => error,
    )
    await flushPromises()
    controller.abort(new Error('switch puzzles'))
    await flushPromises()

    expect(await queuedOutcome).toBeInstanceOf(Error)
    expect(calls).toBe(1)
    first.resolve(algorithm(FIRST_SCRAMBLE))
    await expect(firstResult).resolves.toBe(FIRST_SCRAMBLE)
    expect(mocks.randomScrambleForEvent).toHaveBeenCalledTimes(1)
    expect(FakeWorker.instances).toHaveLength(1)
    expect(FakeWorker.instances[0]?.terminated).toBe(true)
  })

  it('scopes the cubing.js fallback controls to guarded recovery requests', async () => {
    mocks.randomScrambleForEvent.mockImplementation(() => {
      createSearchWorker()
      return Promise.resolve(algorithm(FIRST_SCRAMBLE))
    })

    await expect(generateScramble('333')).resolves.toBe(FIRST_SCRAMBLE)
    expect(mocks.setSearchDebug).toHaveBeenLastCalledWith({
      allowLegacyPatternsForWorkerInstantiation: true,
      forceNewWorkerForEveryScramble: false,
      prioritizeEsbuildWorkaroundForWorkerInstantiation: true,
    })

    await expect(
      generateScramble('222', { freshWorker: true }),
    ).resolves.toBe(FIRST_SCRAMBLE)
    expect(mocks.setSearchDebug).toHaveBeenLastCalledWith({
      allowLegacyPatternsForWorkerInstantiation: false,
      forceNewWorkerForEveryScramble: true,
      prioritizeEsbuildWorkaroundForWorkerInstantiation: false,
    })
  })

  it('propagates a replacement worker load error instead of the fallback failure', async () => {
    const loadError = new Error('replacement search worker failed to load')
    mocks.randomScrambleForEvent.mockImplementation(() => {
      const worker = createSearchWorker() as unknown as FakeWorker
      worker.emit(
        'error',
        new ErrorEvent('error', {
          message: loadError.message,
          error: loadError,
        }),
      )
      return Promise.reject(
        new Error(
          'Module worker instantiation failed. There are no more fallbacks available.',
        ),
      )
    })

    const outcome = generateScramble('333', { freshWorker: true }).then(
      () => null,
      (error: unknown) => error,
    )
    await flushPromises()

    expect(await outcome).toBe(loadError)
    expect(FakeWorker.instances[0]?.terminated).toBe(true)
  })

  it('retries with a fresh worker after a cached worker error', async () => {
    let calls = 0
    mocks.randomScrambleForEvent.mockImplementation(() => {
      const worker = createSearchWorker() as unknown as FakeWorker
      calls += 1
      if (calls === 1) {
        worker.emit(
          'error',
          new ErrorEvent('error', {
            message: 'cached search worker failed to load',
          }),
        )
        return Promise.reject(
          new Error(
            'Module worker instantiation failed. There are no more fallbacks available.',
          ),
        )
      }
      return Promise.resolve(algorithm(SECOND_SCRAMBLE))
    })

    const firstOutcome = await generateScramble('333').then(
      () => null,
      (error: unknown) => error,
    )
    expect(firstOutcome).toBeInstanceOf(Error)
    expect(FakeWorker.instances[0]?.terminated).toBe(true)

    await expect(generateScramble('333')).resolves.toBe(SECOND_SCRAMBLE)
    expect(FakeWorker.instances).toHaveLength(2)
    expect(mocks.setSearchDebug).toHaveBeenLastCalledWith({
      allowLegacyPatternsForWorkerInstantiation: false,
      forceNewWorkerForEveryScramble: true,
      prioritizeEsbuildWorkaroundForWorkerInstantiation: false,
    })
  })
})
