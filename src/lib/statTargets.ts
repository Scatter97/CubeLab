import { formatTime } from './format'

export const MIN_STAT_TARGET_MS = 10
export const MAX_STAT_TARGET_MS = 3_600_000

export type StatTargetParseResult =
  | { ok: true; ms: number }
  | { ok: false; error: string }

/** Formats a target in the timer notation users already read (15.00, 1:05.00). */
export function formatStatTarget(ms: number | null): string {
  return ms === null ? '' : formatTime(ms)
}

/**
 * Accepts either seconds (15.00) or timer notation (1:05.00). Targets are
 * rounded to the same centisecond precision used by aggregate statistics.
 */
export function parseStatTarget(input: string): StatTargetParseResult {
  const value = input.trim()
  if (value.length === 0) {
    return { ok: false, error: 'Enter a target time.' }
  }

  let seconds: number
  const timerMatch = /^(\d+):([0-5]?\d(?:\.\d{1,3})?)$/.exec(value)
  if (timerMatch) {
    seconds = Number(timerMatch[1]) * 60 + Number(timerMatch[2])
  } else if (/^\d+(?:\.\d{1,3})?$/.test(value)) {
    seconds = Number(value)
  } else {
    return {
      ok: false,
      error: 'Enter seconds (15.00) or minutes and seconds (1:05.00).',
    }
  }

  const rawMs = seconds * 1_000
  if (
    !Number.isFinite(rawMs) ||
    rawMs < MIN_STAT_TARGET_MS ||
    rawMs > MAX_STAT_TARGET_MS
  ) {
    return {
      ok: false,
      error: 'Use a target between 0.01 and 3,600 seconds.',
    }
  }

  return { ok: true, ms: Math.round(rawMs / 10) * 10 }
}

/** Matches built-in stat keys and stable custom-average keys. */
export function isValidStatTargetKey(key: string): boolean {
  return /^(?:single|mo3|ao\d{1,5}|custom:.+)$/.test(key)
}
