import { randomScrambleForEvent } from 'cubing/scramble'
import type { PuzzleEvent } from '../types'

const TOKEN_PATTERN = /^[A-Za-z]+w?(?:2|')*$/

/**
 * Returns the cubing.js event id for each supported CubeLab event.
 */
function scrambleEventId(event: PuzzleEvent): string {
  if (event === '333oh') return '333oh'
  return event
}

/**
 * Generates an official WCA random-state scramble with cubing.js. We
 * deliberately do not hand-roll a scramble algorithm.
 */
export async function generateScramble(event: PuzzleEvent = '333'): Promise<string> {
  const alg = await randomScrambleForEvent(scrambleEventId(event))
  return alg.toString().trim()
}

/** Basic sanity check used by tests and defensive UI code. */
export function isPlausibleScramble(scramble: string): boolean {
  const tokens = scramble.trim().split(/\s+/)
  return tokens.length >= 9 && tokens.every((token) => TOKEN_PATTERN.test(token))
}
