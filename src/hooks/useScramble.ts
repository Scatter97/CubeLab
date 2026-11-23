import { useCallback, useEffect, useRef, useState } from 'react'
import {
  DEFAULT_SCRAMBLE_TIMEOUT_MS,
  generateScramble,
  SCRAMBLE_TIMEOUT_MESSAGE,
} from '../lib/scramble'
import {
  DEFAULT_CUSTOM_EVENT_PLACEHOLDER,
  getCustomEventDefinition,
  isUnscrambledEvent,
} from '../lib/events'

type Slots = [string | null, string | null]

export interface ScrambleController {
  scramble: string | null
  nextScramble: string | null
  isLoading: boolean
  error: string | null
  /** Promotes the queued scramble and starts generating another. */
  advance: () => void
  retry: () => void
  /** Repeated retries still could not generate a scramble. */
  recoveryRequired: boolean
}

const EMPTY_SLOTS: Slots = [null, null]

/** A stalled worker request must not leave the timer disabled forever. */
export const SCRAMBLE_GENERATION_TIMEOUT_MS = DEFAULT_SCRAMBLE_TIMEOUT_MS
const FAILURES_BEFORE_RELOAD = 2

/**
 * Keeps one scramble visible and one queued so a new scramble is almost always
 * ready when a solve ends. Generation is cancelled/restarted atomically when
 * the queue advances, including under React StrictMode.
 */
export function useScramble(event: import('../types').PuzzleEvent = '333', enabled = true): ScrambleController {
  const [slots, setSlots] = useState<Slots>(EMPTY_SLOTS)
  const slotsRef = useRef<Slots>(EMPTY_SLOTS)
  const [isGenerating, setIsGenerating] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [failureCount, setFailureCount] = useState(0)
  const [fillVersion, setFillVersion] = useState(0)
  const freshWorkerRef = useRef(false)
  const eventRef = useRef(event)
  const customEvent = getCustomEventDefinition(event)
  const placeholder = isUnscrambledEvent(event)
    ? customEvent?.placeholder.trim() || DEFAULT_CUSTOM_EVENT_PLACEHOLDER
    : null

  const commitSlots = useCallback((next: Slots) => {
    slotsRef.current = next
    setSlots(next)
  }, [])

  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => {
    let cancelled = false
    if (!enabled) return
    if (eventRef.current !== event) {
      eventRef.current = event
      slotsRef.current = EMPTY_SLOTS
      commitSlots(EMPTY_SLOTS)
      // oxlint-disable-next-line react/set-state-in-effect
      setFailureCount(0)
    }

    if (placeholder !== null) {
      // oxlint-disable-next-line react/set-state-in-effect
      setError(null)
      // oxlint-disable-next-line react/set-state-in-effect
      setIsGenerating(false)
      // oxlint-disable-next-line react/set-state-in-effect
      setFailureCount(0)
      // oxlint-disable-next-line react/set-state-in-effect
      commitSlots([placeholder, placeholder])
      return () => {
        cancelled = true
      }
    }

    const controller = new AbortController()
    const generateWithTimeout = () =>
      // The shared boundary serializes generation and owns the timeout, so a
      // queued request does not start its clock before it can use a worker.
      // Cleanup aborts only this request; other callers keep their own work.
      generateScramble(event, {
        freshWorker: freshWorkerRef.current,
        signal: controller.signal,
        timeoutMs: SCRAMBLE_GENERATION_TIMEOUT_MS,
      })

    async function fillQueue() {
      setError(null)
      setIsGenerating(true)

      try {
        while (slotsRef.current.includes(null)) {
          const scramble = await generateWithTimeout()
          // A timed-out, retried or event-switched request is abandoned. Its
          // late result must never replace the current scramble queue.
          if (cancelled) return
          setFailureCount(0)

          const next: Slots = [...slotsRef.current]
          const emptyIndex = next.indexOf(null)
          if (emptyIndex === -1) return
          next[emptyIndex] = scramble
          commitSlots(next)
        }
      } catch (error) {
        if (!cancelled) {
          // cubing.js reuses its cached worker. A timed-out request can leave
          // that worker permanently stuck, so only a fresh worker can recover
          // on Retry.
          if (
            error instanceof Error &&
            error.message === SCRAMBLE_TIMEOUT_MESSAGE
          ) {
            freshWorkerRef.current = true
          }
          setFailureCount((count) => count + 1)
          setError('Could not generate a scramble. Retry when ready.')
        }
      } finally {
        if (!cancelled) setIsGenerating(false)
      }
    }

    void fillQueue()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [commitSlots, enabled, event, fillVersion, placeholder])

  const advance = useCallback(() => {
    const next: Slots = [slotsRef.current[1], null]
    slotsRef.current = next
    setSlots(next)
    setFillVersion((version) => version + 1)
  }, [])

  const retry = useCallback(() => {
    setError(null)
    setFillVersion((version) => version + 1)
  }, [])

  return {
    scramble: slots[0],
    nextScramble: slots[1],
    isLoading: isGenerating || (slots[0] === null && error === null),
    error,
    advance,
    retry,
    recoveryRequired: failureCount >= FAILURES_BEFORE_RELOAD,
  }
}
