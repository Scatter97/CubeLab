import {
  DEFAULT_CUSTOM_EVENT_PLACEHOLDER,
  getCustomEventDefinition,
  getEventDefinition,
  isCustomEventId,
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

/**
 * Returns the cubing.js event id for each supported CubeLab event.
 */
function scrambleEventId(event: PuzzleEvent): string {
  return getEventDefinition(event)?.scrambleEventId ?? event
}

function scrambleFormat(event: PuzzleEvent): ScrambleFormat {
  return getEventDefinition(event)?.scrambleFormat ?? 'cube'
}

/**
 * Generates an official WCA scramble with cubing.js. We deliberately do not
 * hand-roll a scramble algorithm. Megaminx output is normally line-wrapped;
 * CubeLab stores and displays one whitespace-normalized line so the displayed
 * scramble always matches the persisted value.
 */
export async function generateScramble(event: PuzzleEvent = '333'): Promise<string> {
  // Custom events intentionally have no generator. Return the user's
  // placeholder immediately so no cubing.js worker is loaded for them.
  const custom = getCustomEventDefinition(event)
  if (isCustomEventId(event)) {
    return custom?.placeholder.trim() || DEFAULT_CUSTOM_EVENT_PLACEHOLDER
  }

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
  return alg.toString().trim().replace(/\s+/g, ' ')
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
