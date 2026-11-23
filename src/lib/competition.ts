import type {
  CompetitionFormat,
  CompetitionFormatId,
  CompetitionFormatSize,
  CompetitionFormatType,
  PuzzleEvent,
  Session,
  Solve,
} from '../types'
import {
  DEFAULT_AVERAGE_TRIMMING,
  getAverageTrimCounts,
} from './averageTrimming'
import type { AverageTrimming } from '../types'
import {
  calculateAverageFromTimes,
  calculateMeanFromTimes,
  effectiveTimeMs,
  type StatResult,
} from './stats'
import { formatStatValue } from './format'
import { createId } from './id'
import type { StatPrecision } from '../types'

export const MAX_ROUND_ID_LENGTH = 200
export const MAX_ROUND_INDEX = 999

interface CompetitionFormatDefinition {
  id: CompetitionFormatId
  type: CompetitionFormatType
  size: CompetitionFormatSize
  label: string
  description: string
}

export const COMPETITION_FORMATS: readonly CompetitionFormatDefinition[] = [
  {
    id: 'ao5',
    type: 'ao',
    size: 5,
    label: 'ao5',
    description: 'Average of 5 · best and worst trimmed',
  },
  {
    id: 'ao12',
    type: 'ao',
    size: 12,
    label: 'ao12',
    description: 'Average of 12 · best and worst trimmed',
  },
  {
    id: 'ao50',
    type: 'ao',
    size: 50,
    label: 'ao50',
    description: 'Average of 50 · best and worst trimmed',
  },
  {
    id: 'mo3',
    type: 'mo',
    size: 3,
    label: 'mo3',
    description: 'Mean of 3 · every attempt counts',
  },
  {
    id: 'bo3',
    type: 'bo',
    size: 3,
    label: 'bo3',
    description: 'Best of 3 attempts',
  },
]

const FORMATS_BY_ID = new Map(
  COMPETITION_FORMATS.map((format) => [format.id, format]),
)

function formatKey(format: CompetitionFormat): string {
  return `${format.type}${format.size}`
}

export function competitionFormatId(
  format: CompetitionFormat,
): CompetitionFormatId | null {
  const key = formatKey(format)
  return (
    COMPETITION_FORMATS.find((candidate) => candidate.id === key)?.id ?? null
  )
}

export function competitionFormatLabel(format: CompetitionFormat): string {
  return competitionFormatId(format) ?? `${format.type}${format.size}`
}

export function getCompetitionFormatById(
  id: string,
): CompetitionFormat | null {
  const format = FORMATS_BY_ID.get(id as CompetitionFormatId)
  return format ? { type: format.type, size: format.size } : null
}

export function isCompetitionFormat(
  value: unknown,
): value is CompetitionFormat {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (
    record.type !== 'ao' &&
    record.type !== 'mo' &&
    record.type !== 'bo'
  ) {
    return false
  }
  if (
    record.size !== 3 &&
    record.size !== 5 &&
    record.size !== 12 &&
    record.size !== 50
  ) {
    return false
  }
  return competitionFormatId({
    type: record.type,
    size: record.size,
  }) !== null
}

/** 6x6 and 7x7 default to mo3; every other event defaults to ao5. */
export function defaultCompetitionFormat(event: PuzzleEvent): CompetitionFormat {
  return event === '666' || event === '777'
    ? { type: 'mo', size: 3 }
    : { type: 'ao', size: 5 }
}

export function isCompetitionSession(
  session: Pick<Session, 'kind' | 'competitionFormat'>,
): session is Session & { competitionFormat: CompetitionFormat } {
  return (
    session.kind === 'competition' &&
    isCompetitionFormat(session.competitionFormat)
  )
}

export function isValidRoundId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_ROUND_ID_LENGTH
  )
}

export function isValidRoundIndex(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_ROUND_INDEX
  )
}

export function hasRoundMembership(
  solve: Pick<Solve, 'roundId' | 'roundIndex'>,
): boolean {
  return isValidRoundId(solve.roundId) && isValidRoundIndex(solve.roundIndex)
}

function compareChronological(left: Solve, right: Solve): number {
  return (
    left.createdAt - right.createdAt ||
    left.id.localeCompare(right.id)
  )
}

function newestFirst(solves: readonly Solve[]): Solve[] {
  return [...solves].sort(
    (left, right) =>
      right.createdAt - left.createdAt || right.id.localeCompare(left.id),
  )
}

function compareAttempts(left: Solve, right: Solve): number {
  const leftIndex = isValidRoundIndex(left.roundIndex)
    ? left.roundIndex
    : Number.POSITIVE_INFINITY
  const rightIndex = isValidRoundIndex(right.roundIndex)
    ? right.roundIndex
    : Number.POSITIVE_INFINITY
  return (
    leftIndex - rightIndex ||
    left.createdAt - right.createdAt ||
    left.id.localeCompare(right.id)
  )
}

function withoutRoundMembership(solve: Solve): Solve {
  const { roundId: _roundId, roundIndex: _roundIndex, ...rest } = solve
  return rest
}

export function stripRoundMembership(solves: readonly Solve[]): Solve[] {
  return solves.map(withoutRoundMembership)
}

interface LatestRoundState {
  roundId: string
  nextIndex: number
}

/**
 * Reads the newest round from the newest-first solve array. Round members are
 * contiguous because entry assignment always appends to the open round, so the
 * scan is bounded by the format size rather than total history.
 */
function getLatestRoundState(
  solves: readonly Solve[],
  size: number,
): LatestRoundState | null {
  const latest = solves[0]
  if (!latest || !isValidRoundId(latest.roundId)) return null
  const roundId = latest.roundId
  let count = 0
  let maxIndex = -1
  for (const solve of solves) {
    if (solve.roundId !== roundId) break
    count += 1
    if (isValidRoundIndex(solve.roundIndex)) {
      maxIndex = Math.max(maxIndex, solve.roundIndex)
    }
  }
  const nextIndex = maxIndex + 1
  if (count >= size || nextIndex >= size) return null
  return { roundId, nextIndex }
}

/**
 * The single grouping rule for competition entry. Round fields on incoming
 * solves are discarded first; the destination session's format is the only
 * source of truth. Incoming solves are assigned chronologically and returned in
 * their original order.
 */
export function assignRoundMembership(
  incomingSolves: readonly Solve[],
  session: Pick<Session, 'solves'>,
  format: CompetitionFormat,
  options: { roundIdFactory?: () => string } = {},
): Solve[] {
  if (incomingSolves.length === 0) return []
  const roundIdFactory = options.roundIdFactory ?? createId
  const sorted = [...incomingSolves].sort(compareChronological)
  const assigned = new Map<string, Solve>()
  const open = getLatestRoundState(session.solves, format.size)
  let roundId = open?.roundId ?? ''
  let nextIndex = open?.nextIndex ?? format.size

  for (const solve of sorted) {
    if (!roundId || nextIndex >= format.size) {
      roundId = roundIdFactory()
      nextIndex = 0
    }
    assigned.set(solve.id, {
      ...withoutRoundMembership(solve),
      roundId,
      roundIndex: nextIndex,
    })
    nextIndex += 1
  }

  return incomingSolves.map(
    (solve) => assigned.get(solve.id) ?? withoutRoundMembership(solve),
  )
}

export interface CompetitionRoundAttempt {
  solve: Solve
  /** Whether the shared trimming rules exclude this attempt from the result. */
  trimmed: 'better' | 'worse' | null
  /** Fastest valid attempt in the round. */
  best: boolean
}

export interface CompetitionRound {
  id: string
  /** One-based round number derived from chronology. */
  number: number
  /** Attempts in roundIndex/chronological order. */
  solves: Solve[]
  attemptCount: number
  complete: boolean
  /** A duplicated slot or overfull round requires explicit review. */
  contested: boolean
  result: StatResult
  attempts: CompetitionRoundAttempt[]
}

function markAttempts(
  solves: readonly Solve[],
  format: CompetitionFormat,
  trimming: AverageTrimming,
): CompetitionRoundAttempt[] {
  const times = solves.map((solve) => effectiveTimeMs(solve))
  const attempts: CompetitionRoundAttempt[] = solves.map((solve) => ({
    solve,
    trimmed: null,
    best: false,
  }))
  const validEntries = times
    .map((time, index) => ({ time, index }))
    .filter((entry): entry is { time: number; index: number } => entry.time !== null)
    .sort(
      (left, right) =>
        left.time - right.time || left.index - right.index,
    )

  const best = validEntries[0]
  if (best) attempts[best.index]!.best = true

  if (format.type !== 'ao') return attempts

  const { better, worse } = getAverageTrimCounts(format.size, trimming)
  for (let index = 0; index < better; index += 1) {
    const entry = validEntries[index]
    if (entry) attempts[entry.index]!.trimmed = 'better'
  }

  let remainingWorst = worse
  for (let index = 0; index < times.length && remainingWorst > 0; index += 1) {
    if (times[index] === null) {
      attempts[index]!.trimmed = 'worse'
      remainingWorst -= 1
    }
  }
  for (
    let index = validEntries.length - 1;
    index >= 0 && remainingWorst > 0;
    index -= 1
  ) {
    const entry = validEntries[index]!
    if (attempts[entry.index]!.trimmed === null) {
      attempts[entry.index]!.trimmed = 'worse'
      remainingWorst -= 1
    }
  }
  return attempts
}

function calculateRoundResult(
  solves: readonly Solve[],
  format: CompetitionFormat,
  trimming: AverageTrimming,
): StatResult {
  if (solves.length !== format.size) return null
  const times = solves.map((solve) => effectiveTimeMs(solve))
  if (format.type === 'mo') return calculateMeanFromTimes(times)
  if (format.type === 'bo') {
    const valid = times.filter((time): time is number => time !== null)
    if (valid.length === 0) return { status: 'dnf' }
    return { status: 'value', ms: Math.min(...valid) }
  }
  return calculateAverageFromTimes(times, format.size, trimming)
}

function roundHash(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * Stable identity for an attempt moved out of a contested slot. Hashing the
 * original round and solve IDs keeps both merge directions (and repeated
 * merges) on the same new round instead of generating a fresh random ID.
 */
export function contestedRoundId(roundId: string, solveId: string): string {
  return `contested:${roundHash(`${roundId}\u0000${solveId}`)}`
}

/**
 * Identifies the deterministic round that holds an attempt moved out of a
 * contested slot. A resolved contest is durable structure: a stale device's
 * older assignment to the original round must not undo it during a merge.
 */
export function isContestedRoundId(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('contested:')
}

/**
 * Keeps one attempt per round slot. Duplicate slots and attempts beyond the
 * fixed format size are moved to deterministic single-attempt rounds, so every
 * solve is preserved while a completed round stays scorable. The earliest
 * attempt (createdAt, then ID) owns a contested slot in either merge order.
 */
function reconcileContestedRoundSlots(
  solves: Solve[],
  format: CompetitionFormat,
): Solve[] {
  const groups = new Map<string, Solve[]>()
  for (const solve of solves) {
    if (!isValidRoundId(solve.roundId)) continue
    const group = groups.get(solve.roundId) ?? []
    group.push(solve)
    groups.set(solve.roundId, group)
  }
  const usedRoundIds = new Set(groups.keys())
  const moved = new Map<string, { roundId: string; roundIndex: number }>()
  for (const [roundId, members] of groups) {
    const usedIndexes = new Set<number>()
    for (const solve of [...members].sort(compareAttempts)) {
      const index = isValidRoundIndex(solve.roundIndex)
        ? solve.roundIndex
        : null
      if (
        index !== null &&
        index < format.size &&
        !usedIndexes.has(index)
      ) {
        usedIndexes.add(index)
        continue
      }
      let nextRoundId = contestedRoundId(roundId, solve.id)
      let suffix = 1
      while (usedRoundIds.has(nextRoundId)) {
        nextRoundId = `${contestedRoundId(roundId, solve.id)}:${suffix}`
        suffix += 1
      }
      usedRoundIds.add(nextRoundId)
      moved.set(solve.id, { roundId: nextRoundId, roundIndex: 0 })
    }
  }
  if (moved.size === 0) return solves
  return solves.map((solve) => {
    const assignment = moved.get(solve.id)
    return assignment ? { ...solve, ...assignment } : solve
  })
}

function roundHasContestedSlot(
  solves: readonly Solve[],
  format: CompetitionFormat,
): boolean {
  if (solves.length > format.size) return true
  const seen = new Set<number>()
  for (const solve of solves) {
    if (!isValidRoundIndex(solve.roundIndex)) return true
    if (solve.roundIndex >= format.size) return true
    if (seen.has(solve.roundIndex)) return true
    seen.add(solve.roundIndex)
  }
  return false
}

interface RoundGroup {
  id: string
  solves: Solve[]
  firstAt: number
}

export function getCompetitionRounds(
  solves: readonly Solve[],
  format: CompetitionFormat,
  trimming: AverageTrimming = DEFAULT_AVERAGE_TRIMMING,
): CompetitionRound[] {
  const groups = new Map<string, RoundGroup>()
  for (const solve of solves) {
    if (!isValidRoundId(solve.roundId)) continue
    const group = groups.get(solve.roundId) ?? {
      id: solve.roundId,
      solves: [],
      firstAt: solve.createdAt,
    }
    group.solves.push(solve)
    group.firstAt = Math.min(group.firstAt, solve.createdAt)
    groups.set(group.id, group)
  }

  return [...groups.values()]
    .sort(
      (left, right) =>
        left.firstAt - right.firstAt || left.id.localeCompare(right.id),
    )
    .map((group, index) => {
      const ordered = [...group.solves].sort(compareAttempts)
      const contested = roundHasContestedSlot(ordered, format)
      // A contested round has no authoritative result until its membership is
      // resolved. Keeping a numeric result here would let Statistics call it
      // Best or DNF even though the same solved state is also Contested.
      const result = contested
        ? null
        : calculateRoundResult(ordered, format, trimming)
      return {
        id: group.id,
        number: index + 1,
        solves: ordered,
        attemptCount: ordered.length,
        complete: ordered.length === format.size,
        contested,
        result,
        attempts: markAttempts(ordered, format, trimming),
      }
    })
}

export function competitionRoundResultLabel(
  round: CompetitionRound,
  format: CompetitionFormat,
  precision: StatPrecision,
): string {
  if (round.contested) {
    return `Contested · ${round.attemptCount}/${format.size}`
  }
  if (!round.complete) {
    return `Incomplete · ${round.attemptCount}/${format.size}`
  }
  return formatStatValue(round.result, precision)
}

export interface CompetitionRoundSummary {
  latest: CompetitionRound | null
  best: CompetitionRound | null
  dnfRounds: CompetitionRound[]
}

function resultMs(round: CompetitionRound): number | null {
  return round.result?.status === 'value' ? round.result.ms : null
}

/** Latest, best and DNF round rows for the Statistics panel. */
export function getCompetitionRoundSummary(
  rounds: readonly CompetitionRound[],
): CompetitionRoundSummary {
  let best: CompetitionRound | null = null
  const dnfRounds: CompetitionRound[] = []
  for (const round of rounds) {
    // Contested membership has no authoritative result, even if a caller
    // constructs a round object with a stale numeric result attached.
    if (round.contested) continue
    if (round.result?.status === 'dnf') dnfRounds.push(round)
    const ms = resultMs(round)
    if (ms === null) continue
    const bestMs = best ? resultMs(best) : null
    if (bestMs === null || ms < bestMs) best = round
  }
  return {
    latest: rounds[rounds.length - 1] ?? null,
    best,
    dnfRounds,
  }
}

/**
 * Makes stored solves consistent with their session kind. Practice sessions
 * lose stray round fields; competition sessions keep valid memberships and
 * assign any missing or malformed ones through the same entry rule.
 */
export function normalizeRoundMembership(session: Session): Session {
  if (!isCompetitionSession(session)) {
    if (!session.solves.some((solve) => solve.roundId !== undefined || solve.roundIndex !== undefined)) {
      return session
    }
    return { ...session, solves: stripRoundMembership(session.solves) }
  }

  const assigned: Solve[] = []
  const unassigned: Solve[] = []
  for (const solve of session.solves) {
    if (hasRoundMembership(solve)) assigned.push(solve)
    else unassigned.push(solve)
  }
  if (unassigned.length === 0) {
    const reconciled = reconcileContestedRoundSlots(
      session.solves,
      session.competitionFormat,
    )
    return reconciled === session.solves
      ? session
      : { ...session, solves: newestFirst(reconciled) }
  }

  const existing = newestFirst(assigned)
  const next = assignRoundMembership(
    unassigned,
    { solves: existing },
    session.competitionFormat,
  )
  const byId = new Map(next.map((solve) => [solve.id, solve]))
  const combined = session.solves.map((solve) => byId.get(solve.id) ?? solve)
  const reconciled = reconcileContestedRoundSlots(
    combined,
    session.competitionFormat,
  )
  return {
    ...session,
    solves: newestFirst(reconciled),
  }
}
