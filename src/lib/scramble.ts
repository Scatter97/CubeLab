import { getEventDefinition } from './events'
import type { PuzzleEvent } from '../types'

const TOKEN_PATTERN = /^(?:[2-3])?[URFDLB]w?(?:2|')?$/

/**
 * Returns the cubing.js event id for each supported CubeLab event.
 */
function scrambleEventId(event: PuzzleEvent): string {
  return getEventDefinition(event)?.scrambleEventId ?? event
}

/**
 * Generates an official WCA random-state scramble with cubing.js. We
 * deliberately do not hand-roll a scramble algorithm.
 */
export async function generateScramble(event: PuzzleEvent = '333'): Promise<string> {
  // Load cubing.js on demand so its large solver chunk does not block the
  // initial application shell. The production build still emits it as a
  // separate cached chunk, and the worker isolation in vite.config.ts is
  // unchanged.
  const { randomScrambleForEvent } = await import('cubing/scramble')
  if (typeof window !== 'undefined') {
    // import.meta.resolve keeps the un-hashed worker filename in a Vite build.
    // Prefer cubing.js's bundler-aware entry instead of first loading the SPA
    // fallback HTML as a worker (a SyntaxError in WebKit).
    const { setSearchDebug } = await import('cubing/search')
    setSearchDebug({ prioritizeEsbuildWorkaroundForWorkerInstantiation: true })
  }
  const alg = await randomScrambleForEvent(scrambleEventId(event))
  return alg.toString().trim()
}

/** Basic sanity check used by tests and defensive UI code. */
export function isPlausibleScramble(scramble: string): boolean {
  const tokens = scramble.trim().split(/\s+/)
  return tokens.length >= 9 && tokens.every((token) => TOKEN_PATTERN.test(token))
}
