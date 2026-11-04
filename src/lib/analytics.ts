import type { AverageTrimming, PuzzleEvent, Session, Solve } from '../types'
import {
  calculateAverage,
  calculateRollingAverages,
  effectiveTimeMs,
  type StatResult,
} from './stats'

const DAY_MS = 86_400_000

export type AnalyticsPenaltyFilter = 'all' | 'none' | '+2' | 'dnf'
export type AnalyticsDatePreset =
  | 'all'
  | 'today'
  | '7d'
  | '30d'
  | '90d'
  | 'year'
  | 'custom'

export interface AnalyticsFilters {
  event: PuzzleEvent | 'all'
  /** `null` means every session. An empty list intentionally matches nothing. */
  sessionIds: readonly string[] | null
  datePreset: AnalyticsDatePreset
  customStart: string
  customEnd: string
  /** Latest N solves after the other filters. `null` keeps every solve. */
  solveLimit: number | null
  penalty: AnalyticsPenaltyFilter
}

export function createAnalyticsFilters(
  event: PuzzleEvent | 'all',
): AnalyticsFilters {
  return {
    event,
    sessionIds: null,
    datePreset: 'all',
    customStart: '',
    customEnd: '',
    solveLimit: null,
    penalty: 'all',
  }
}

export interface AnalyticsSolve extends Solve {
  readonly sessionId: string
  readonly sessionName: string
}

function startOfLocalDay(timestamp: number): number {
  const date = new Date(timestamp)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

function endOfLocalDay(timestamp: number): number {
  const date = new Date(timestamp)
  return (
    new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime() -
    1
  )
}

function parseDateInput(value: string, end: boolean): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2]) - 1
  const day = Number(match[3])
  const date = new Date(year, month, day)
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month ||
    date.getDate() !== day
  ) {
    return null
  }
  return end ? endOfLocalDay(date.getTime()) : date.getTime()
}

export function analyticsDateBounds(
  filters: AnalyticsFilters,
  now = Date.now(),
): { start: number | null; end: number | null } {
  const today = startOfLocalDay(now)
  switch (filters.datePreset) {
    case 'today':
      return { start: today, end: endOfLocalDay(now) }
    case '7d':
      return { start: startOfLocalDay(today - 6 * DAY_MS), end: endOfLocalDay(now) }
    case '30d':
      return { start: startOfLocalDay(today - 29 * DAY_MS), end: endOfLocalDay(now) }
    case '90d':
      return { start: startOfLocalDay(today - 89 * DAY_MS), end: endOfLocalDay(now) }
    case 'year':
      return { start: startOfLocalDay(today - 364 * DAY_MS), end: endOfLocalDay(now) }
    case 'custom':
      return {
        start: parseDateInput(filters.customStart, false),
        end: parseDateInput(filters.customEnd, true),
      }
    case 'all':
    default:
      return { start: null, end: null }
  }
}

/**
 * Applies global filters without mutating stored records. The last-N limit is
 * taken after event/session/date/penalty filtering so the dashboard always
 * reflects the most recent matching solves.
 */
export function filterAnalyticsSolves(
  sessions: readonly Session[],
  filters: AnalyticsFilters,
  now = Date.now(),
): AnalyticsSolve[] {
  const sessionIds =
    filters.sessionIds === null ? null : new Set(filters.sessionIds)
  const bounds = analyticsDateBounds(filters, now)
  const matches: (AnalyticsSolve & { order: number })[] = []
  let order = 0

  for (const session of sessions) {
    for (const solve of session.solves) {
      const recordOrder = order++
      if (filters.event !== 'all' && solve.event !== filters.event) continue
      if (sessionIds !== null && !sessionIds.has(session.id)) continue
      if (bounds.start !== null && solve.createdAt < bounds.start) continue
      if (bounds.end !== null && solve.createdAt > bounds.end) continue
      if (filters.penalty !== 'all' && solve.penalty !== filters.penalty) continue
      matches.push({
        ...solve,
        sessionId: session.id,
        sessionName: session.name,
        order: recordOrder,
      })
    }
  }

  matches.sort(
    (left, right) =>
      left.createdAt - right.createdAt || left.order - right.order,
  )

  const limited =
    filters.solveLimit !== null && filters.solveLimit > 0
      ? matches.slice(-filters.solveLimit)
      : matches

  return limited.map(({ order: _order, ...solve }) => solve)
}

export interface AnalyticsTrend {
  readonly solves: readonly AnalyticsSolve[]
  /** Effective single time, or null for a DNF. */
  readonly singles: readonly (number | null)[]
  readonly personalBests: readonly boolean[]
  /** Rolling averages aligned to the chronological solve index. */
  readonly averages: ReadonlyMap<number, readonly (number | null)[]>
  /** Best rolling average seen up to and including each index. */
  readonly bestAverages: ReadonlyMap<number, readonly (number | null)[]>
}

/** Build rolling series once; all dashboard sections share the result. */
export function buildAnalyticsTrend(
  solves: readonly AnalyticsSolve[],
  sizes: readonly number[],
  trimming: AverageTrimming,
): AnalyticsTrend {
  const count = solves.length
  const singles: (number | null)[] = new Array(count)
  const personalBests: boolean[] = new Array(count)
  let bestSingle = Infinity

  for (let index = 0; index < count; index += 1) {
    const time = effectiveTimeMs(solves[index]!)
    singles[index] = time
    const isBest = time !== null && time < bestSingle
    personalBests[index] = isBest
    if (isBest) bestSingle = time!
  }

  const newestFirst = [...solves].reverse()
  const averages = new Map<number, readonly (number | null)[]>()
  const bestAverages = new Map<number, readonly (number | null)[]>()

  for (const size of new Set(sizes)) {
    if (!Number.isInteger(size) || size < 2 || size > 100_000) continue
    const values: (number | null)[] = new Array(count).fill(null)
    const runningBest: (number | null)[] = new Array(count).fill(null)
    const rolling = calculateRollingAverages(newestFirst, size, trimming)
    let best = Infinity

    rolling.forEach((result, start) => {
      const index = count - 1 - start
      const value = result.status === 'value' ? result.ms : null
      values[index] = value
      if (value !== null) best = Math.min(best, value)
      runningBest[index] = best === Infinity ? null : best
    })

    // Before the first complete window no average existed yet.
    for (let index = 0; index < Math.min(size - 1, count); index += 1) {
      const value = runningBest[index] ?? null
      runningBest[index] = value
    }

    averages.set(size, values)
    bestAverages.set(size, runningBest)
  }

  return { solves, singles, personalBests, averages, bestAverages }
}

function medianSorted(sorted: readonly number[]): number | null {
  if (sorted.length === 0) return null
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2
}

function percentileSorted(
  sorted: readonly number[],
  fraction: number,
): number | null {
  if (sorted.length === 0) return null
  if (sorted.length === 1) return sorted[0]!
  const position = Math.max(0, Math.min(1, fraction)) * (sorted.length - 1)
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  const weight = position - lower
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight
}

export function standardDeviation(values: readonly number[]): number {
  if (values.length < 2) return 0
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    (values.length - 1)
  return Math.sqrt(variance)
}

export interface AverageOverview {
  readonly size: number
  readonly current: StatResult
  readonly best: number | null
}

export interface AnalyticsOverview {
  readonly count: number
  readonly validCount: number
  readonly dnfCount: number
  readonly dnfPercent: number
  readonly best: number | null
  readonly worst: number | null
  readonly meanMs: number | null
  readonly medianMs: number | null
  readonly standardDeviationMs: number | null
  readonly totalTimeMs: number
  readonly activeDays: number
  readonly solvesPerDay: number | null
  readonly improvementPercent: number | null
  readonly averages: readonly AverageOverview[]
}

export function computeAnalyticsOverview(
  trend: AnalyticsTrend,
  sizes: readonly number[],
  trimming: AverageTrimming,
): AnalyticsOverview {
  const valid = trend.singles.filter((value): value is number => value !== null)
  const sorted = [...valid].sort((left, right) => left - right)
  const count = trend.solves.length
  const mean =
    valid.length > 0
      ? valid.reduce((sum, value) => sum + value, 0) / valid.length
      : null
  const totalTimeMs = valid.reduce((sum, value) => sum + value, 0)

  const dayNumbers = new Set<number>()
  for (const solve of trend.solves) dayNumbers.add(dayNumber(solve.createdAt))
  let solvesPerDay: number | null = null
  if (count > 0 && dayNumbers.size > 0) {
    const days = [...dayNumbers].sort((left, right) => left - right)
    const span = (days[days.length - 1]! - days[0]!) + 1
    solvesPerDay = count / Math.max(1, span)
  }

  let improvementPercent: number | null = null
  if (valid.length >= 10) {
    const section = Math.max(1, Math.floor(valid.length * 0.1))
    const first = valid.slice(0, section)
    const last = valid.slice(-section)
    const firstMean = first.reduce((sum, value) => sum + value, 0) / first.length
    const lastMean = last.reduce((sum, value) => sum + value, 0) / last.length
    if (firstMean > 0) improvementPercent = ((firstMean - lastMean) / firstMean) * 100
  }

  const newestFirst = [...trend.solves].reverse()
  const averages: AverageOverview[] = []
  for (const size of new Set(sizes)) {
    if (!Number.isInteger(size) || size < 2) continue
    const best = trend.bestAverages.get(size)
    averages.push({
      size,
      current: calculateAverage(newestFirst, size, trimming),
      best: best?.[best.length - 1] ?? null,
    })
  }

  return {
    count,
    validCount: valid.length,
    dnfCount: count - valid.length,
    dnfPercent: count > 0 ? ((count - valid.length) / count) * 100 : 0,
    best: sorted[0] ?? null,
    worst: sorted[sorted.length - 1] ?? null,
    meanMs: mean,
    medianMs: medianSorted(sorted),
    standardDeviationMs: valid.length > 1 ? standardDeviation(valid) : null,
    totalTimeMs,
    activeDays: dayNumbers.size,
    solvesPerDay,
    improvementPercent,
    averages,
  }
}

export interface PBEvent {
  readonly index: number
  readonly solve: AnalyticsSolve
  readonly ms: number
  readonly previousMs: number | null
  readonly improvementMs: number | null
  readonly gapMs: number | null
}

export interface PBHistory {
  readonly single: readonly PBEvent[]
  readonly singleStep: readonly (number | null)[]
  readonly averages: ReadonlyMap<number, readonly PBEvent[]>
  readonly averageSteps: ReadonlyMap<number, readonly (number | null)[]>
}

export function buildPBHistory(trend: AnalyticsTrend): PBHistory {
  const single: PBEvent[] = []
  const singleStep: (number | null)[] = new Array(trend.solves.length).fill(null)
  let previous: PBEvent | null = null
  let running: number | null = null

  trend.solves.forEach((solve, index) => {
    const ms = trend.singles[index] ?? null
    if (ms !== null && (running === null || ms < running)) {
      const event: PBEvent = {
        index,
        solve,
        ms,
        previousMs: previous?.ms ?? null,
        improvementMs: previous ? previous.ms - ms : null,
        gapMs: previous ? solve.createdAt - previous.solve.createdAt : null,
      }
      single.push(event)
      previous = event
      running = ms
    }
    singleStep[index] = running
  })

  const averages = new Map<number, readonly PBEvent[]>()
  const averageSteps = new Map<number, readonly (number | null)[]>()
  for (const [size, values] of trend.averages) {
    const events: PBEvent[] = []
    const step: (number | null)[] = new Array(values.length).fill(null)
    let best: number | null = null
    let lastEvent: PBEvent | null = null

    values.forEach((value, index) => {
      if (value !== null && (best === null || value < best)) {
        const result: PBEvent = {
          index,
          solve: trend.solves[index]!,
          ms: value,
          previousMs: lastEvent?.ms ?? null,
          improvementMs: lastEvent ? lastEvent.ms - value : null,
          gapMs: lastEvent
            ? trend.solves[index]!.createdAt - lastEvent.solve.createdAt
            : null,
        }
        events.push(result)
        lastEvent = result
        best = value
      }
      step[index] = best
    })

    averages.set(size, events)
    averageSteps.set(size, step)
  }

  return { single, singleStep, averages, averageSteps }
}

export interface HistogramBin {
  readonly startMs: number
  readonly endMs: number
  readonly count: number
  readonly percent: number
  /**
   * True when this edge bin absorbs values beyond the robust display range.
   * Their counts and drill-down ranges are retained; only the visual scale is
   * protected from a handful of unusually long solves.
   */
  readonly groupedExtreme?: boolean
}

export interface Histogram {
  readonly bins: readonly HistogramBin[]
  readonly intervalMs: number
  readonly validCount: number
  readonly meanMs: number | null
  readonly medianMs: number | null
  readonly standardDeviationMs: number | null
  readonly p25Ms: number | null
  readonly p75Ms: number | null
  readonly outlierLowMs: number | null
  readonly outlierHighMs: number | null
  readonly outlierCount: number
  /** False when an explicit interval was requested. */
  readonly autoInterval: boolean
  /** True when edge bins absorbed values outside the robust display range. */
  readonly groupedExtremes: boolean
}

function niceInterval(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1_000
  const magnitude = 10 ** Math.floor(Math.log10(value))
  const normalized = value / magnitude
  const step =
    normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10
  return Math.max(10, step * magnitude)
}

export function buildHistogram(
  times: readonly (number | null)[],
  requestedIntervalMs?: number | null,
): Histogram {
  const valid = times.filter((value): value is number => value !== null)
  const sorted = [...valid].sort((left, right) => left - right)
  const explicitInterval =
    requestedIntervalMs !== null &&
    requestedIntervalMs !== undefined &&
    Number.isFinite(requestedIntervalMs) &&
    requestedIntervalMs >= 10
  if (valid.length === 0) {
    return {
      bins: [],
      intervalMs: explicitInterval
        ? Math.round(requestedIntervalMs!)
        : 1_000,
      validCount: 0,
      meanMs: null,
      medianMs: null,
      standardDeviationMs: null,
      p25Ms: null,
      p75Ms: null,
      outlierLowMs: null,
      outlierHighMs: null,
      outlierCount: 0,
      autoInterval: !explicitInterval,
      groupedExtremes: false,
    }
  }

  const min = sorted[0]!
  const max = sorted[sorted.length - 1]!
  const targetBins = Math.max(8, Math.min(40, Math.ceil(Math.sqrt(valid.length))))
  // Derive the automatic interval from the central 98% of the filtered data.
  // A handful of unusually long solves must not widen every normal bin; those
  // values remain counted and drillable through edge intervals below.
  const centralLow = valid.length >= 20 ? percentileSorted(sorted, 0.01)! : min
  const centralHigh = valid.length >= 20 ? percentileSorted(sorted, 0.99)! : max
  const intervalMs = explicitInterval
    ? Math.round(requestedIntervalMs!)
    : niceInterval(
        (centralHigh - centralLow || Math.max(1_000, (max - min) / targetBins)) /
          targetBins,
      )

  const centralStart = Math.floor(centralLow / intervalMs) * intervalMs
  const displayEnd = Math.max(
    centralStart + intervalMs,
    Math.ceil(centralHigh / intervalMs) * intervalMs,
  )
  const hasLowExtreme = min < centralStart
  const hasHighExtreme = max >= displayEnd
  const bins: HistogramBin[] = []
  if (hasLowExtreme) {
    bins.push({
      startMs: min,
      endMs: centralStart,
      count: 0,
      percent: 0,
      groupedExtreme: true,
    })
  }
  for (let edge = centralStart; edge < displayEnd; edge += intervalMs) {
    bins.push({
      startMs: edge,
      endMs: Math.min(displayEnd, edge + intervalMs),
      count: 0,
      percent: 0,
    })
  }
  if (hasHighExtreme) {
    // Counts and drill-down must include the exact maximum, so the grouped edge
    // interval is inclusive by ending one millisecond after it.
    bins.push({
      startMs: displayEnd,
      endMs: max + 1,
      count: 0,
      percent: 0,
      groupedExtreme: true,
    })
  }
  if (bins.length === 0) {
    bins.push({
      startMs: min,
      endMs: Math.max(max, min + intervalMs),
      count: 0,
      percent: 0,
      groupedExtreme: true,
    })
  }
  const lowOffset = hasLowExtreme ? 1 : 0
  for (const value of valid) {
    let index: number
    if (hasLowExtreme && value < centralStart) {
      index = 0
    } else if (hasHighExtreme && value >= displayEnd) {
      index = bins.length - 1
    } else {
      index =
        lowOffset +
        Math.min(
          Math.max(0, Math.floor((value - centralStart) / intervalMs)),
          Math.max(0, bins.length - lowOffset - (hasHighExtreme ? 1 : 0) - 1),
        )
    }
    const bin = bins[index]!
    bins[index] = { ...bin, count: bin.count + 1, percent: bin.percent + 1 }
  }
  for (let index = 0; index < bins.length; index += 1) {
    const bin = bins[index]!
    bins[index] = { ...bin, percent: (bin.count / valid.length) * 100 }
  }

  const p25 = percentileSorted(sorted, 0.25)!
  const p75 = percentileSorted(sorted, 0.75)!
  const iqr = p75 - p25
  const outlierLow = p25 - iqr * 1.5
  const outlierHigh = p75 + iqr * 1.5

  return {
    bins,
    intervalMs,
    validCount: valid.length,
    meanMs: valid.reduce((sum, value) => sum + value, 0) / valid.length,
    medianMs: medianSorted(sorted),
    standardDeviationMs: standardDeviation(valid),
    p25Ms: p25,
    p75Ms: p75,
    outlierLowMs: outlierLow,
    outlierHighMs: outlierHigh,
    outlierCount: valid.filter(
      (value) => value < outlierLow || value > outlierHigh,
    ).length,
    autoInterval: !explicitInterval,
    groupedExtremes: hasLowExtreme || hasHighExtreme,
  }
}

export interface RollingConsistency {
  readonly size: number
  readonly values: readonly (number | null)[]
  readonly latestMs: number | null
  readonly bestMs: number | null
}

export interface ConsistencyReport {
  readonly validCount: number
  readonly meanMs: number | null
  readonly medianMs: number | null
  readonly standardDeviationMs: number | null
  readonly coefficientOfVariation: number | null
  readonly fastestMs: number | null
  readonly slowestMs: number | null
  readonly spreadMs: number | null
  readonly rolling: readonly RollingConsistency[]
}

export function computeConsistency(
  trend: AnalyticsTrend,
  windowSizes: readonly number[] = [12, 50],
): ConsistencyReport {
  const valid = trend.singles.filter((value): value is number => value !== null)
  const sorted = [...valid].sort((left, right) => left - right)
  const mean =
    valid.length > 0
      ? valid.reduce((sum, value) => sum + value, 0) / valid.length
      : null
  const sd = valid.length > 1 ? standardDeviation(valid) : null
  const rolling: RollingConsistency[] = []

  for (const size of new Set(windowSizes)) {
    if (!Number.isInteger(size) || size < 2) continue
    const values: (number | null)[] = new Array(trend.singles.length).fill(null)
    let sum = 0
    let sumSquares = 0
    let validInWindow = 0
    const window: (number | null)[] = []

    for (let index = 0; index < trend.singles.length; index += 1) {
      const incoming = trend.singles[index] ?? null
      window.push(incoming)
      if (incoming !== null) {
        sum += incoming
        sumSquares += incoming * incoming
        validInWindow += 1
      }
      if (window.length > size) {
        const outgoing = window.shift() ?? null
        if (outgoing !== null) {
          sum -= outgoing
          sumSquares -= outgoing * outgoing
          validInWindow -= 1
        }
      }
      if (window.length === size && validInWindow > 1) {
        const average = sum / validInWindow
        const variance =
          (sumSquares - validInWindow * average * average) /
          (validInWindow - 1)
        values[index] = Math.sqrt(Math.max(0, variance))
      }
    }

    let bestMs: number | null = null
    for (const value of values) {
      if (value !== null && (bestMs === null || value < bestMs)) bestMs = value
    }
    rolling.push({
      size,
      values,
      latestMs: values[values.length - 1] ?? null,
      bestMs,
    })
  }

  return {
    validCount: valid.length,
    meanMs: mean,
    medianMs: medianSorted(sorted),
    standardDeviationMs: sd,
    coefficientOfVariation: mean !== null && mean > 0 && sd !== null ? sd / mean : null,
    fastestMs: sorted[0] ?? null,
    slowestMs: sorted[sorted.length - 1] ?? null,
    spreadMs:
      sorted.length > 0 ? sorted[sorted.length - 1]! - sorted[0]! : null,
    rolling,
  }
}

export interface SubXSession {
  readonly sessionId: string
  readonly sessionName: string
  readonly count: number
  readonly successes: number
  readonly percent: number
}

export interface SubXReport {
  readonly targetMs: number
  readonly count: number
  readonly validCount: number
  readonly successes: number
  readonly percent: number
  readonly validPercent: number
  readonly currentStreak: number
  readonly longestStreak: number
  readonly progress: readonly number[]
  readonly bySession: readonly SubXSession[]
  readonly estimatedProbability: number | null
}

export function computeSubX(
  trend: AnalyticsTrend,
  targetMs: number,
  windowSize = 50,
): SubXReport {
  const successes = trend.singles.map(
    (value) => value !== null && value < targetMs,
  )
  const validCount = trend.singles.filter((value) => value !== null).length
  const totalSuccesses = successes.filter(Boolean).length
  let currentStreak = 0
  for (let index = successes.length - 1; index >= 0; index -= 1) {
    if (!successes[index]) break
    currentStreak += 1
  }
  let longestStreak = 0
  let run = 0
  for (const success of successes) {
    run = success ? run + 1 : 0
    longestStreak = Math.max(longestStreak, run)
  }

  const progress: number[] = []
  let windowSuccesses = 0
  for (let index = 0; index < successes.length; index += 1) {
    if (successes[index]) windowSuccesses += 1
    const outgoingIndex = index - windowSize
    if (outgoingIndex >= 0 && successes[outgoingIndex]) windowSuccesses -= 1
    const windowLength = Math.min(windowSize, index + 1)
    progress.push((windowSuccesses / windowLength) * 100)
  }

  const sessions = new Map<string, SubXSession>()
  trend.solves.forEach((solve, index) => {
    const entry = sessions.get(solve.sessionId) ?? {
      sessionId: solve.sessionId,
      sessionName: solve.sessionName,
      count: 0,
      successes: 0,
      percent: 0,
    }
    sessions.set(solve.sessionId, {
      ...entry,
      count: entry.count + 1,
      successes: entry.successes + (successes[index] ? 1 : 0),
      percent: 0,
    })
  })
  const bySession = [...sessions.values()].map((entry) => ({
    ...entry,
    percent: entry.count > 0 ? (entry.successes / entry.count) * 100 : 0,
  }))
  bySession.sort((left, right) => right.count - left.count)

  return {
    targetMs,
    count: trend.solves.length,
    validCount,
    successes: totalSuccesses,
    percent: trend.solves.length > 0 ? (totalSuccesses / trend.solves.length) * 100 : 0,
    validPercent: validCount > 0 ? (totalSuccesses / validCount) * 100 : 0,
    currentStreak,
    longestStreak,
    progress,
    bySession,
    estimatedProbability: estimateTargetProbability(trend, targetMs),
  }
}

function erf(value: number): number {
  const sign = value < 0 ? -1 : 1
  const x = Math.abs(value)
  const a1 = 0.254829592
  const a2 = -0.284496736
  const a3 = 1.421413741
  const a4 = -1.453152027
  const a5 = 1.061405429
  const p = 0.3275911
  const t = 1 / (1 + p * x)
  const poly =
    (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t
  return sign * (1 - poly * Math.exp(-x * x))
}

export function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2))
}

/**
 * Normal-approximation estimate, clearly displayed as an estimate rather than
 * a prediction. Empirical results remain the authoritative measure.
 */
export function estimateTargetProbability(
  trend: AnalyticsTrend,
  targetMs: number,
): number | null {
  const valid = trend.singles.filter((value): value is number => value !== null)
  if (valid.length < 2) return null
  const mean = valid.reduce((sum, value) => sum + value, 0) / valid.length
  const sd = standardDeviation(valid)
  if (sd <= 0) return mean < targetMs ? 100 : 0
  return Math.max(0, Math.min(100, normalCdf((targetMs - mean) / sd) * 100))
}

export interface ActivityDay {
  readonly key: string
  readonly dayNumber: number
  readonly dateMs: number
  readonly count: number
  readonly timeMs: number
}

export interface ActivityBucket {
  readonly key: string
  readonly startMs: number
  readonly count: number
}

export interface PracticeDayPerformance {
  readonly key: string
  readonly dateMs: number
  readonly count: number
  readonly meanMs: number
}

export interface ActivityReport {
  readonly daily: readonly ActivityDay[]
  readonly allDays: readonly ActivityDay[]
  readonly heatmapStartMs: number | null
  readonly heatmapEndMs: number | null
  readonly totalTimeMs: number
  readonly activeDays: number
  readonly averagePerActiveDay: number
  readonly frequency: number
  readonly currentStreak: number
  readonly longestStreak: number
  readonly mostActive: readonly ActivityDay[]
  readonly weekly: readonly ActivityBucket[]
  readonly monthly: readonly ActivityBucket[]
  readonly bestPerformanceDay: PracticeDayPerformance | null
  readonly worstPerformanceDay: PracticeDayPerformance | null
}

function dayNumber(timestamp: number): number {
  const date = new Date(timestamp)
  return (
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS
  )
}

function dateKey(timestamp: number): string {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** True when the supplied timestamps cover more than one calendar year. */
export function analyticsSpansMultipleYears(
  timestamps: readonly number[],
): boolean {
  if (timestamps.length === 0) return false
  let first = timestamps[0]!
  let last = timestamps[0]!
  for (const timestamp of timestamps) {
    if (timestamp < first) first = timestamp
    if (timestamp > last) last = timestamp
  }
  return new Date(first).getFullYear() !== new Date(last).getFullYear()
}

/**
 * Date labels stay compact for single-year histories and include the year when
 * the filtered data spans multiple years, so "Sep 15" is never ambiguous.
 */
export function formatAnalyticsAxisDate(
  timestamp: number,
  includeYear: boolean,
): string {
  return new Date(timestamp).toLocaleDateString(
    undefined,
    includeYear
      ? { year: 'numeric', month: 'short', day: 'numeric' }
      : { month: 'short', day: 'numeric' },
  )
}

export function buildActivity(
  trend: AnalyticsTrend,
  now = Date.now(),
): ActivityReport {
  const days = new Map<string, ActivityDay>()
  const computeByDay = new Map<string, { count: number; sum: number; valid: number }>()

  trend.solves.forEach((solve, index) => {
    const key = dateKey(solve.createdAt)
    const day = days.get(key) ?? {
      key,
      dayNumber: dayNumber(solve.createdAt),
      dateMs: startOfLocalDay(solve.createdAt),
      count: 0,
      timeMs: 0,
    }
    const time = trend.singles[index] ?? null
    days.set(key, {
      ...day,
      count: day.count + 1,
      timeMs: day.timeMs + (time ?? 0),
    })
    const aggregate = computeByDay.get(key) ?? { count: 0, sum: 0, valid: 0 }
    if (time !== null) {
      aggregate.sum += time
      aggregate.valid += 1
    }
    aggregate.count += 1
    computeByDay.set(key, aggregate)
  })

  const allDays = [...days.values()].sort(
    (left, right) => left.dayNumber - right.dayNumber,
  )
  const totalTimeMs = allDays.reduce((sum, day) => sum + day.timeMs, 0)
  const activeDays = allDays.length
  const averagePerActiveDay = activeDays > 0 ? trend.solves.length / activeDays : 0
  const spanDays =
    allDays.length > 0
      ? allDays[allDays.length - 1]!.dayNumber - allDays[0]!.dayNumber + 1
      : 0
  const frequency = spanDays > 0 ? (activeDays / spanDays) * 100 : 0

  const activeNumbers = new Set(allDays.map((day) => day.dayNumber))
  let longestStreak = 0
  let run = 0
  let previous: number | null = null
  for (const day of allDays) {
    run = previous !== null && day.dayNumber === previous + 1 ? run + 1 : 1
    longestStreak = Math.max(longestStreak, run)
    previous = day.dayNumber
  }

  let currentStreak = 0
  const today = dayNumber(now)
  const latest = allDays[allDays.length - 1]?.dayNumber ?? null
  if (latest !== null && latest >= today - 1) {
    let cursor = latest
    while (activeNumbers.has(cursor)) {
      currentStreak += 1
      cursor -= 1
    }
  }

  // The heatmap covers the complete filtered activity range instead of a
  // rolling one-year window. Empty calendar days are included so gaps remain
  // visible and multi-year histories never silently lose earlier months.
  const daily: ActivityDay[] = []
  const firstDay = allDays[0]
  const lastDay = allDays[allDays.length - 1]
  if (firstDay && lastDay) {
    const firstDate = new Date(firstDay.dateMs)
    const dayCount = lastDay.dayNumber - firstDay.dayNumber
    for (let offset = 0; offset <= dayCount; offset += 1) {
      const dateMs = new Date(
        firstDate.getFullYear(),
        firstDate.getMonth(),
        firstDate.getDate() + offset,
      ).getTime()
      const number = dayNumber(dateMs)
      const key = dateKey(dateMs)
      daily.push(
        days.get(key) ?? {
          key,
          dayNumber: number,
          dateMs,
          count: 0,
          timeMs: 0,
        },
      )
    }
  }

  const weeklyMap = new Map<string, ActivityBucket>()
  const monthlyMap = new Map<string, ActivityBucket>()
  for (const day of allDays) {
    const date = new Date(day.dateMs)
    const monday = new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate() - ((date.getDay() + 6) % 7),
    )
    const weekKey = dateKey(monday.getTime())
    const week = weeklyMap.get(weekKey) ?? {
      key: weekKey,
      startMs: monday.getTime(),
      count: 0,
    }
    weeklyMap.set(weekKey, { ...week, count: week.count + day.count })

    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    const month = monthlyMap.get(monthKey) ?? {
      key: monthKey,
      startMs: new Date(date.getFullYear(), date.getMonth(), 1).getTime(),
      count: 0,
    }
    monthlyMap.set(monthKey, { ...month, count: month.count + day.count })
  }

  const performances = [...computeByDay.entries()]
    .filter(([, value]) => value.valid >= 3)
    .map(([key, value]) => ({
      key,
      dateMs: startOfLocalDay(days.get(key)!.dateMs),
      count: value.count,
      meanMs: value.sum / value.valid,
    }))
  performances.sort((left, right) => left.meanMs - right.meanMs)

  return {
    daily,
    allDays,
    heatmapStartMs: daily[0]?.dateMs ?? null,
    heatmapEndMs: daily[daily.length - 1]?.dateMs ?? null,
    totalTimeMs,
    activeDays,
    averagePerActiveDay,
    frequency,
    currentStreak,
    longestStreak,
    mostActive: [...allDays].sort((left, right) => right.count - left.count).slice(0, 5),
    weekly: [...weeklyMap.values()].sort((left, right) => left.startMs - right.startMs),
    monthly: [...monthlyMap.values()].sort((left, right) => left.startMs - right.startMs),
    bestPerformanceDay: performances[0] ?? null,
    worstPerformanceDay: performances[performances.length - 1] ?? null,
  }
}

export interface AdvancedReport {
  readonly p5Ms: number | null
  readonly p25Ms: number | null
  readonly p50Ms: number | null
  readonly p75Ms: number | null
  readonly p95Ms: number | null
  readonly movingMedian: readonly (number | null)[]
  readonly pbCount: number
  readonly pbRatePer100: number
  readonly pbPerMonth: number | null
  readonly improvementPercent: number | null
  readonly recentMeanMs: number | null
  readonly historicalMeanMs: number | null
  readonly fastest: readonly { index: number; solve: AnalyticsSolve; ms: number }[]
  readonly slowest: readonly { index: number; solve: AnalyticsSolve; ms: number }[]
  readonly estimatedTargetProbability: number | null
}

export function computeAdvanced(
  trend: AnalyticsTrend,
  targetMs: number,
  movingWindow = 25,
): AdvancedReport {
  const valid = trend.singles.filter((value): value is number => value !== null)
  const sorted = [...valid].sort((left, right) => left - right)
  const movingMedian: (number | null)[] = new Array(trend.singles.length).fill(null)
  const attempts: (number | null)[] = []

  for (let index = 0; index < trend.singles.length; index += 1) {
    attempts.push(trend.singles[index] ?? null)
    if (attempts.length > movingWindow) attempts.shift()
    // DNFs occupy a slot in the rolling attempt window. Older solves must not
    // remain eligible merely because the newest attempt was a DNF.
    movingMedian[index] = medianSorted(
      attempts.filter((value): value is number => value !== null),
    )
  }

  const half = Math.floor(valid.length / 2)
  const historicalMean =
    half > 0 ? valid.slice(0, half).reduce((sum, value) => sum + value, 0) / half : null
  const recent = valid.slice(half)
  const recentMean =
    recent.length > 0
      ? recent.reduce((sum, value) => sum + value, 0) / recent.length
      : null
  const improvementPercent =
    historicalMean !== null && historicalMean > 0 && recentMean !== null
      ? ((historicalMean - recentMean) / historicalMean) * 100
      : null

  const ranked = trend.solves
    .map((solve, index) => ({ index, solve, ms: trend.singles[index] }))
    .filter(
      (entry): entry is { index: number; solve: AnalyticsSolve; ms: number } =>
        entry.ms !== null,
    )
  const fastest = [...ranked].sort((left, right) => left.ms - right.ms).slice(0, 5)
  const slowest = [...ranked]
    .sort((left, right) => right.ms - left.ms)
    .slice(0, 5)

  const pbCount = trend.personalBests.filter(Boolean).length
  const months =
    trend.solves.length > 1
      ? Math.max(
          1,
          (new Date(trend.solves[trend.solves.length - 1]!.createdAt).getFullYear() -
            new Date(trend.solves[0]!.createdAt).getFullYear()) *
            12 +
            (new Date(trend.solves[trend.solves.length - 1]!.createdAt).getMonth() -
              new Date(trend.solves[0]!.createdAt).getMonth()) +
            1,
        )
      : 1

  return {
    p5Ms: percentileSorted(sorted, 0.05),
    p25Ms: percentileSorted(sorted, 0.25),
    p50Ms: percentileSorted(sorted, 0.5),
    p75Ms: percentileSorted(sorted, 0.75),
    p95Ms: percentileSorted(sorted, 0.95),
    movingMedian,
    pbCount,
    pbRatePer100: trend.solves.length > 0 ? (pbCount / trend.solves.length) * 100 : 0,
    pbPerMonth: trend.solves.length > 0 ? pbCount / months : null,
    improvementPercent,
    recentMeanMs: recentMean,
    historicalMeanMs: historicalMean,
    fastest,
    slowest,
    estimatedTargetProbability: estimateTargetProbability(trend, targetMs),
  }
}

export interface SessionComparison {
  readonly id: string
  readonly name: string
  readonly event: PuzzleEvent
  readonly count: number
  readonly overview: AnalyticsOverview
  readonly subX: SubXReport
  readonly ao5: readonly (number | null)[]
}

/**
 * Compares the selected sessions when two or more are selected; otherwise all
 * sessions matching the event/date/penalty filters are compared. Session
 * selection is deliberately ignored for the comparison itself so a single
 * global session filter does not reduce the section to one column.
 */
export function compareSessions(
  sessions: readonly Session[],
  filters: AnalyticsFilters,
  trimming: AverageTrimming,
  targetMs: number,
  now = Date.now(),
): SessionComparison[] {
  const comparisonFilters: AnalyticsFilters = {
    ...filters,
    sessionIds:
      filters.sessionIds !== null && filters.sessionIds.length >= 2
        ? filters.sessionIds
        : null,
    solveLimit: null,
  }
  const solves = filterAnalyticsSolves(sessions, comparisonFilters, now)
  const grouped = new Map<string, AnalyticsSolve[]>()
  for (const solve of solves) {
    const group = grouped.get(solve.sessionId) ?? []
    group.push(solve)
    grouped.set(solve.sessionId, group)
  }

  const results: SessionComparison[] = []
  for (const session of sessions) {
    const group = grouped.get(session.id)
    if (!group || group.length === 0) continue
    const trend = buildAnalyticsTrend(group, [5, 12, 50], trimming)
    results.push({
      id: session.id,
      name: session.name,
      event: session.event ?? group[0]!.event,
      count: group.length,
      overview: computeAnalyticsOverview(trend, [5, 12, 50], trimming),
      subX: computeSubX(trend, targetMs),
      ao5: trend.averages.get(5) ?? [],
    })
  }
  results.sort((left, right) => right.count - left.count)
  return results
}

/** Counts every local calendar day touched by the filtered solves. */
export function analyticsActiveDayCount(solves: readonly Solve[]): number {
  const keys = new Set<string>()
  for (const solve of solves) keys.add(dateKey(solve.createdAt))
  return keys.size
}
