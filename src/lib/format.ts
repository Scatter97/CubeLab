import type { Penalty, Solve, StatPrecision } from '../types'
import type { StatResult } from './stats'

/** Formats a centisecond timer reading. Minutes are shown when needed. */
export function formatTime(ms: number): string {
  const safeMs = Number.isFinite(ms) ? Math.max(0, Math.floor(ms)) : 0
  const centiseconds = Math.floor(safeMs / 10)
  const minutes = Math.floor(centiseconds / 6_000)
  const secondsPart = Math.floor((centiseconds % 6_000) / 100)
  const hundredths = centiseconds % 100

  if (minutes > 0) {
    return `${minutes}:${String(secondsPart).padStart(2, '0')}.${String(
      hundredths,
    ).padStart(2, '0')}`
  }

  return `${secondsPart}.${String(hundredths).padStart(2, '0')}`
}

/**
 * Lists commonly show the raw time with a penalty suffix. The effective time
 * used for statistics is available via `solveEffectiveTimeMs`.
 */
export function formatSolveTime(
  rawMs: number,
  penalty: Penalty,
): { display: string; suffix: string | null } {
  if (penalty === 'dnf') return { display: 'DNF', suffix: null }
  return {
    display: formatTime(rawMs),
    suffix: penalty === '+2' ? '+2' : null,
  }
}

export function formatSolveRaw(solve: Solve): string {
  return formatTime(solve.rawMs)
}

function formatTimeTenths(ms: number): string {
  const safeMs = Number.isFinite(ms) ? Math.max(0, Math.floor(ms)) : 0
  const tenths = Math.floor(safeMs / 100)
  const minutes = Math.floor(tenths / 600)
  const secondsPart = Math.floor((tenths % 600) / 10)
  const tenthsPart = tenths % 10

  if (minutes > 0) {
    return `${minutes}:${String(secondsPart).padStart(2, '0')}.${tenthsPart}`
  }

  return `${secondsPart}.${tenthsPart}`
}

/** Formats statistics without changing the stored centisecond value. */
export function formatTimeWithPrecision(
  ms: number,
  precision: StatPrecision = 'centiseconds',
): string {
  return precision === 'tenths' ? formatTimeTenths(ms) : formatTime(ms)
}

export function formatStatValue(
  result: StatResult,
  precision: StatPrecision = 'centiseconds',
): string {
  if (result === null) return '—'
  if (result.status === 'dnf') return 'DNF'
  return formatTimeWithPrecision(result.ms, precision)
}

export function formatOptionalTime(
  ms: number | null,
  precision: StatPrecision = 'centiseconds',
): string {
  return ms === null ? '—' : formatTimeWithPrecision(ms, precision)
}

export function formatSolveCount(count: number): string {
  return `${count} ${count === 1 ? 'solve' : 'solves'}`
}

export function formatRelativeTime(timestamp: number, now = Date.now()): string {
  const elapsed = Math.max(0, now - timestamp)
  if (elapsed < 60_000) return 'Just now'
  if (elapsed < 3_600_000) {
    const minutes = Math.floor(elapsed / 60_000)
    return `${minutes}m ago`
  }
  if (elapsed < 86_400_000) {
    const hours = Math.floor(elapsed / 3_600_000)
    return `${hours}h ago`
  }
  const days = Math.floor(elapsed / 86_400_000)
  if (days < 7) return `${days}d ago`
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(timestamp)
}

export function formatEffectiveSolveTime(solve: Solve): string {
  if (solve.penalty === 'dnf') return 'DNF'
  return formatTime(solve.rawMs + (solve.penalty === '+2' ? 2_000 : 0))
}
