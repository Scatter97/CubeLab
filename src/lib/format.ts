import type { Penalty, Solve } from '../types'
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

export function formatStatValue(result: StatResult): string {
  if (result === null) return '—'
  if (result.status === 'dnf') return 'DNF'
  return formatTime(result.ms)
}

export function formatOptionalTime(ms: number | null): string {
  return ms === null ? '—' : formatTime(ms)
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
