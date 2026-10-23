import { randomScrambleForEvent } from 'cubing/scramble'

const TOKEN_PATTERN = /^(?:[URFDLB]w?)(?:2|'?)$/

/**
 * Generates an official WCA 3×3 random-state scramble with cubing.js. We
 * deliberately do not hand-roll a scramble algorithm.
 */
export async function generateScramble(): Promise<string> {
  const alg = await randomScrambleForEvent('333')
  return alg.toString().trim()
}

/** Basic sanity check used by tests and defensive UI code. */
export function isPlausibleScramble(scramble: string): boolean {
  const tokens = scramble.trim().split(/\s+/)
  return tokens.length >= 10 && tokens.every((token) => TOKEN_PATTERN.test(token))
}
