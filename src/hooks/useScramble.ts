import { useCallback, useEffect, useRef, useState } from 'react'
import { generateScramble } from '../lib/scramble'

type Slots = [string | null, string | null]

export interface ScrambleController {
  scramble: string | null
  nextScramble: string | null
  isLoading: boolean
  error: string | null
  /** Promotes the queued scramble and starts generating another. */
  advance: () => void
  retry: () => void
}

const EMPTY_SLOTS: Slots = [null, null]

/**
 * Keeps one scramble visible and one queued so a new scramble is almost always
 * ready when a solve ends. Generation is cancelled/restarted atomically when
 * the queue advances, including under React StrictMode.
 */
export function useScramble(): ScrambleController {
  const [slots, setSlots] = useState<Slots>(EMPTY_SLOTS)
  const slotsRef = useRef<Slots>(EMPTY_SLOTS)
  const [isGenerating, setIsGenerating] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [fillVersion, setFillVersion] = useState(0)

  const commitSlots = useCallback((next: Slots) => {
    slotsRef.current = next
    setSlots(next)
  }, [])

  useEffect(() => {
    let cancelled = false

    async function fillQueue() {
      setError(null)
      setIsGenerating(true)

      try {
        while (slotsRef.current.includes(null)) {
          const scramble = await generateScramble()
          if (cancelled) return

          const next: Slots = [...slotsRef.current]
          const emptyIndex = next.indexOf(null)
          if (emptyIndex === -1) return
          next[emptyIndex] = scramble
          commitSlots(next)
        }
      } catch {
        if (!cancelled) {
          setError('Could not generate a scramble. Try again.')
        }
      } finally {
        if (!cancelled) setIsGenerating(false)
      }
    }

    void fillQueue()

    return () => {
      cancelled = true
    }
  }, [commitSlots, fillVersion])

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
  }
}
