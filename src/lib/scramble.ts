import searchWorkerFile from './searchWorkerFile'
import {
  DEFAULT_CUSTOM_EVENT_PLACEHOLDER,
  getCustomEventDefinition,
  getEventDefinition,
  isUnscrambledEvent,
  type ScrambleFormat,
} from './events'
import type { PuzzleEvent } from '../types'

const CUBE_TOKEN_PATTERN = /^(?:[2-3])?[URFDLB]w?(?:2|')?$/
const PYRAMINX_TOKEN_PATTERN = /^(?:[ULRB][2']?|[ulrb][2']?)$/
const SKEWB_TOKEN_PATTERN = /^[ULRB][2']?$/
const SQUARE1_TUPLE_PATTERN = /\(\s*-?\d+\s*,\s*-?\d+\s*\)/g
const SQUARE1_SCRAMBLE_PATTERN =
  /^\(\s*-?\d+\s*,\s*-?\d+\s*\)(?:\s*\/\s*\(\s*-?\d+\s*,\s*-?\d+\s*\))*\s*\/?$/
const CLOCK_TOKEN_PATTERN =
  /^(?:(?:U|R|D|L|ALL|UR|DR|DL|UL)\d+[+-]|y2)$/
const MEGAMINX_TOKEN_PATTERN = /^(?:[RD][+-]{2}|U'?)$/

export interface GenerateScrambleOptions {
  /**
   * Ask cubing.js for a fresh search worker instead of its cached instance.
   * Retry uses this after a stalled request because the failed worker can stay
   * alive and make every later scramble wait for the same dead transport.
   */
  freshWorker?: boolean
  /** Abandon a queued or running request without affecting another caller. */
  signal?: AbortSignal
  /**
   * Override the active-request deadline. Invalid or omitted values still use
   * DEFAULT_SCRAMBLE_TIMEOUT_MS, so no request can wait indefinitely.
   */
  timeoutMs?: number
}

/** Every active request gets this deadline unless it supplies a valid override. */
export const DEFAULT_SCRAMBLE_TIMEOUT_MS = 20_000
export const SCRAMBLE_TIMEOUT_MESSAGE = 'Scramble generation timed out.'
const SCRAMBLE_CANCELLED_MESSAGE = 'Scramble generation was cancelled.'

type ScrambleRequestState = 'queued' | 'running' | 'settled'

interface ScrambleRequest {
  event: PuzzleEvent
  freshWorker: boolean
  signal?: AbortSignal
  /** Normalized to a finite positive duration before the request is queued. */
  timeoutMs: number
  /** Temporary workers constructed while this request owns the boundary. */
  workers: Set<Worker>
  usesCachedWorker: boolean
  state: ScrambleRequestState
  closed: boolean
  /** Whether the cubing.js promise has settled, including after abandonment. */
  librarySettled: boolean
  /** An abandoned operation may still construct a worker that must be disposed. */
  awaitingLateConstruction: boolean
  /** First explicit script-load failure from a worker this request constructed. */
  workerLoadError: Error | null
  resolve: (scramble: string) => void
  reject: (error: unknown) => void
  timeoutId: ReturnType<typeof setTimeout> | null
  abortListener: (() => void) | null
}

type ScrambleOutcome =
  | { kind: 'success'; scramble: string }
  | { kind: 'error'; error: unknown }
  | { kind: 'timeout' }
  | { kind: 'abort'; reason: unknown }

/**
 * cubing.js has no public terminate/reset call for its cached search worker.
 * Its supported debug switch makes later calls instantiate a new worker, so
 * recovery keeps that switch on. Each request acts as a disposable generation
 * environment: worker construction is claimed only while that request is
 * synchronously entering cubing.js (or from the sole active request when no
 * abandoned operation could still construct one). Late construction from an
 * abandoned generation is terminated instead of joining a successor.
 */
let forceFreshSearchWorker = false
let cachedSearchWorker: Worker | null = null
const pendingScrambleRequests: ScrambleRequest[] = []
let activeScrambleRequest: ScrambleRequest | null = null
let constructingRequest: ScrambleRequest | null = null
let pendingLateConstructions = 0
let workerTrackingInstalled = false

function isSearchWorkerUrl(value: unknown): boolean {
  return typeof value === 'string' || value instanceof URL
    ? String(value).includes('search-worker-entry')
    : false
}

function terminateWorker(worker: Worker): void {
  try {
    worker.terminate()
  } catch {
    // A worker that already terminated itself needs no further cleanup.
  }
}

function toWorkerLoadError(event: Event): Error {
  if (event instanceof ErrorEvent) {
    if (event.error instanceof Error) return event.error
    if (event.message) return new Error(event.message)
  }
  return new Error('The scramble search worker failed to load.')
}

function constructionOwner(): ScrambleRequest | null {
  if (
    constructingRequest &&
    constructingRequest.state === 'running' &&
    !constructingRequest.closed
  ) {
    return constructingRequest
  }
  // An abandoned operation has an unresolved library call. It may still reach
  // worker construction after its replacement has started, so an unguarded
  // construction cannot safely be assigned to the current request.
  if (pendingLateConstructions > 0) return null
  const request = activeScrambleRequest
  return request?.state === 'running' && !request.closed ? request : null
}

function installSearchWorkerTracking(): void {
  if (
    workerTrackingInstalled ||
    typeof window === 'undefined' ||
    typeof window.Worker !== 'function'
  ) {
    return
  }
  workerTrackingInstalled = true
  const NativeWorker = window.Worker
  window.Worker = new Proxy(NativeWorker, {
    construct(target, argumentsList) {
      const isSearchWorker = isSearchWorkerUrl(argumentsList[0])
      const workerArguments = [...argumentsList]
      if (isSearchWorker && searchWorkerFile) {
        // cubing.js resolves the logical worker filename. Use the emitted chunk
        // so the first (synchronous) import.meta.resolve strategy succeeds.
        workerArguments[0] = new URL(
          searchWorkerFile,
          window.location.href,
        ).href
      }
      const worker = Reflect.construct(target, workerArguments) as Worker
      if (!isSearchWorker) return worker

      const owner = constructionOwner()
      if (!owner) {
        // A late or unowned worker must never join the next request.
        terminateWorker(worker)
        return worker
      }
      if (owner.usesCachedWorker) {
        // cubing.js keeps this one worker for ordinary generation.
        if (cachedSearchWorker && cachedSearchWorker !== worker) {
          terminateWorker(cachedSearchWorker)
        }
        cachedSearchWorker = worker
      } else {
        owner.workers.add(worker)
        // cubing.js's own listener rejects its instantiation promise after a
        // script-load error, but its eventual "no more fallbacks" failure would
        // hide this cause. Record the explicit error for the owning request.
        worker.addEventListener(
          'error',
          (event) => {
            if (
              owner.workerLoadError === null &&
              owner.state === 'running' &&
              !owner.closed
            ) {
              owner.workerLoadError = toWorkerLoadError(event)
            }
          },
          { once: true },
        )
      }
      return worker
    },
  }) as typeof Worker
}

function releaseRequestWorkers(request: ScrambleRequest): void {
  const workers = [...request.workers]
  request.workers.clear()
  for (const worker of workers) terminateWorker(worker)
}

function releaseCachedSearchWorker(): void {
  const worker = cachedSearchWorker
  cachedSearchWorker = null
  if (worker) terminateWorker(worker)
}

function abortReason(signal?: AbortSignal): unknown {
  return signal?.reason instanceof Error
    ? signal.reason
    : new Error(SCRAMBLE_CANCELLED_MESSAGE)
}

function clearRequestWaiters(request: ScrambleRequest): void {
  if (request.timeoutId !== null) {
    clearTimeout(request.timeoutId)
    request.timeoutId = null
  }
  if (request.abortListener && request.signal) {
    request.signal.removeEventListener('abort', request.abortListener)
    request.abortListener = null
  }
}

function releaseLateConstructionMarker(request: ScrambleRequest): void {
  if (!request.awaitingLateConstruction) return
  request.awaitingLateConstruction = false
  pendingLateConstructions = Math.max(0, pendingLateConstructions - 1)
}

function finishRequest(
  request: ScrambleRequest,
  outcome: ScrambleOutcome,
): void {
  if (request.state === 'settled') return

  const wasRunning = request.state === 'running'
  request.state = 'settled'
  request.closed = true
  clearRequestWaiters(request)
  if (!wasRunning) {
    const queuedIndex = pendingScrambleRequests.indexOf(request)
    if (queuedIndex !== -1) pendingScrambleRequests.splice(queuedIndex, 1)
  }
  if (wasRunning && activeScrambleRequest === request) {
    activeScrambleRequest = null
  }
  if (
    wasRunning &&
    !request.librarySettled &&
    (outcome.kind === 'timeout' || outcome.kind === 'abort')
  ) {
    // Its cubing.js call can still resume later. Keep that fact visible to the
    // worker proxy until the abandoned operation actually settles.
    request.awaitingLateConstruction = true
    pendingLateConstructions += 1
  }

  if (outcome.kind === 'timeout') {
    // A timed-out worker can never answer later requests reliably. Retry and
    // all subsequent generation use a fresh worker, and this request releases
    // only the workers it created plus the poisoned cached instance.
    forceFreshSearchWorker = true
    releaseRequestWorkers(request)
    if (request.usesCachedWorker) releaseCachedSearchWorker()
  } else if (outcome.kind === 'abort') {
    // An active request may still occupy the cached worker after cancellation.
    // Release its workers and move later requests to the fresh-worker path so
    // an abandoned request cannot delay them behind the same transport.
    releaseRequestWorkers(request)
    if (request.usesCachedWorker) {
      forceFreshSearchWorker = true
      releaseCachedSearchWorker()
    }
  } else if (outcome.kind === 'error') {
    // cubing.js caches a failed worker instantiation promise. Keep failing
    // Retry pinned to that rejected promise would make an ordinary script-load
    // error permanent, so release the cached worker and move the next attempt
    // to the supported fresh-worker recovery path.
    releaseRequestWorkers(request)
    if (request.usesCachedWorker) {
      forceFreshSearchWorker = true
      releaseCachedSearchWorker()
    }
  } else if (!request.usesCachedWorker) {
    releaseRequestWorkers(request)
  }

  if (outcome.kind === 'success') {
    request.resolve(outcome.scramble)
  } else if (outcome.kind === 'error') {
    request.reject(outcome.error)
  } else if (outcome.kind === 'timeout') {
    request.reject(new Error(SCRAMBLE_TIMEOUT_MESSAGE))
  } else {
    request.reject(outcome.reason)
  }

  startNextRequest()
}

async function generateScrambleForRequest(
  request: ScrambleRequest,
): Promise<string> {
  const ensureRunning = () => {
    if (request.state !== 'running') {
      throw new Error(SCRAMBLE_CANCELLED_MESSAGE)
    }
  }

  // Load cubing.js on demand so its large solver chunk does not block the
  // initial application shell. The production build still emits it as a
  // separate cached chunk, and the worker isolation in vite.config.ts is
  // unchanged.
  const { randomScrambleForEvent } = await import('cubing/scramble')
  ensureRunning()
  if (typeof window !== 'undefined') {
    // Installed cubing.js tries import.meta.resolve synchronously, then an
    // asynchronous esbuild fallback that constructs a worker after the guarded
    // call returns. While an abandoned generation is unresolved, that fallback
    // worker cannot be attributed safely and is terminated, leaving the
    // replacement request pending until its deadline. Recovery therefore
    // disables the legacy/asynchronous fallbacks so a replacement script-load
    // failure rejects promptly. Normal cached startup keeps cubing.js's
    // esbuild-first loading, including its fallbacks.
    const guardedRecovery = !request.usesCachedWorker
    const { setSearchDebug } = await import('cubing/search')
    ensureRunning()
    setSearchDebug({
      allowLegacyPatternsForWorkerInstantiation: !guardedRecovery,
      forceNewWorkerForEveryScramble: guardedRecovery,
      prioritizeEsbuildWorkaroundForWorkerInstantiation: !guardedRecovery,
    })
  }
  ensureRunning()
  // Claim construction only around the synchronous entry into cubing.js. A
  // worker that appears later belongs to an abandoned operation and is
  // terminated by the proxy instead of attaching to the next request.
  const algPromise = (() => {
    constructingRequest = request
    try {
      return randomScrambleForEvent(scrambleEventId(request.event))
    } finally {
      constructingRequest = null
    }
  })()
  const alg = await algPromise
  return alg.toString().trim().replace(/\s+/g, ' ')
}

async function runRequest(request: ScrambleRequest): Promise<void> {
  try {
    const scramble = await generateScrambleForRequest(request)
    request.librarySettled = true
    if (request.state !== 'running') return
    finishRequest(request, { kind: 'success', scramble })
  } catch (error) {
    request.librarySettled = true
    if (request.state !== 'running') return
    finishRequest(request, {
      kind: 'error',
      // cubing.js throws a generic "no more fallbacks" error after a worker
      // script fails to load. Prefer the explicit load error captured from the
      // request-owned worker so the caller still receives its primary cause.
      error: request.workerLoadError ?? error,
    })
  } finally {
    releaseLateConstructionMarker(request)
  }
}

function startNextRequest(): void {
  if (activeScrambleRequest) return
  const request = pendingScrambleRequests.shift()
  if (!request) return
  if (request.state !== 'queued') {
    startNextRequest()
    return
  }

  if (request.freshWorker) {
    forceFreshSearchWorker = true
    releaseCachedSearchWorker()
  }
  request.state = 'running'
  request.usesCachedWorker = !forceFreshSearchWorker
  activeScrambleRequest = request

  // Queued requests start their full deadline only when they become active.
  request.timeoutId = setTimeout(() => {
    request.timeoutId = null
    if (request.state === 'running') {
      finishRequest(request, { kind: 'timeout' })
    }
  }, request.timeoutMs)

  void runRequest(request)
}

/**
 * Test support: drop coordinator state between isolated cases. Production
 * requests always settle or are cancelled through their own promise/signal.
 */
export function resetScrambleCoordinatorForTests(): void {
  for (const queued of pendingScrambleRequests) {
    queued.state = 'settled'
    queued.closed = true
    clearRequestWaiters(queued)
    releaseRequestWorkers(queued)
  }
  pendingScrambleRequests.length = 0
  const request = activeScrambleRequest
  activeScrambleRequest = null
  constructingRequest = null
  pendingLateConstructions = 0
  if (request) {
    request.state = 'settled'
    request.closed = true
    request.awaitingLateConstruction = false
    clearRequestWaiters(request)
    releaseRequestWorkers(request)
  }
  releaseCachedSearchWorker()
  forceFreshSearchWorker = false
}

/**
 * Returns the cubing.js event id for each supported CubeLab event.
 */
function scrambleEventId(event: PuzzleEvent): string {
  return getEventDefinition(event)?.scrambleEventId ?? event
}

function scrambleFormat(event: PuzzleEvent): ScrambleFormat {
  return getEventDefinition(event)?.scrambleFormat ?? 'cube'
}

function normalizeTimeoutMs(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_SCRAMBLE_TIMEOUT_MS
}

/**
 * Generates an official WCA scramble with cubing.js. We deliberately do not
 * hand-roll a scramble algorithm. Megaminx output is normally line-wrapped;
 * CubeLab stores and displays one whitespace-normalized line so the displayed
 * scramble always matches the persisted value.
 */
export function generateScramble(
  event: PuzzleEvent = '333',
  options: GenerateScrambleOptions = {},
): Promise<string> {
  // MISC and legacy custom events intentionally have no generator. Return the
  // placeholder immediately so no cubing.js worker is loaded for them.
  const custom = getCustomEventDefinition(event)
  if (isUnscrambledEvent(event)) {
    return Promise.resolve(
      custom?.placeholder.trim() || DEFAULT_CUSTOM_EVENT_PLACEHOLDER,
    )
  }
  installSearchWorkerTracking()

  return new Promise<string>((resolve, reject) => {
    const signal = options.signal
    if (signal?.aborted) {
      reject(abortReason(signal))
      return
    }

    const request: ScrambleRequest = {
      event,
      freshWorker: options.freshWorker === true,
      signal,
      timeoutMs: normalizeTimeoutMs(options.timeoutMs),
      workers: new Set(),
      usesCachedWorker: false,
      state: 'queued',
      closed: false,
      librarySettled: false,
      awaitingLateConstruction: false,
      workerLoadError: null,
      resolve,
      reject,
      timeoutId: null,
      abortListener: null,
    }

    if (signal) {
      request.abortListener = () => {
        finishRequest(request, {
          kind: 'abort',
          reason: abortReason(signal),
        })
      }
      signal.addEventListener('abort', request.abortListener, { once: true })
    }

    pendingScrambleRequests.push(request)
    startNextRequest()
  })
}

/**
 * Basic sanity check used by tests and defensive UI code. Each WCA notation
 * family is validated with its own token grammar.
 */
export function isPlausibleScramble(
  scramble: string,
  event: PuzzleEvent = '333',
): boolean {
  const trimmed = scramble.trim()
  if (!trimmed) return false
  const tokens = trimmed.split(/\s+/)

  switch (scrambleFormat(event)) {
    case 'cube':
      return tokens.length >= 9 && tokens.every((token) => CUBE_TOKEN_PATTERN.test(token))
    case 'pyraminx':
      return (
        tokens.length >= 8 &&
        tokens.every((token) => PYRAMINX_TOKEN_PATTERN.test(token)) &&
        tokens.some((token) => /^[ULRB]/.test(token))
      )
    case 'skewb':
      return tokens.length >= 8 && tokens.every((token) => SKEWB_TOKEN_PATTERN.test(token))
    case 'square1': {
      // Square-1 tuples contain a space, so validate the whole scramble rather
      // than whitespace-separated tokens.
      const tuples = trimmed.match(SQUARE1_TUPLE_PATTERN) ?? []
      return (
        tuples.length >= 8 &&
        trimmed.includes('/') &&
        SQUARE1_SCRAMBLE_PATTERN.test(trimmed)
      )
    }
    case 'clock':
      return tokens.length >= 10 && tokens.every((token) => CLOCK_TOKEN_PATTERN.test(token))
    case 'megaminx':
      return (
        tokens.length >= 70 &&
        tokens.every((token) => MEGAMINX_TOKEN_PATTERN.test(token)) &&
        tokens.some((token) => token.startsWith('U'))
      )
  }
}
