import { calculateAverage, calculateMeanOf3, calculateRollingAverages, effectiveTimeMs } from './stats'
import { DEFAULT_AVERAGE_TRIMMING } from './averageTrimming'
import type { AverageTrimming, Solve, TimeTrendCutoff } from '../types'

export type SeriesId = 'single' | 'ao5' | 'ao12' | 'ao25' | 'ao50' | 'ao100' | 'ao200' | 'ao500' | 'ao1000' | 'custom'

export interface TrendPoint {
  index: number
  solve: Solve
  singleMs: number | null
  personalBest: boolean
  averages: Partial<Record<`ao${number}`, number | null>>
}

/**
 * Latest chronological lifetime PB. The newest solve need not be a PB, so the
 * current-PB ring can sit before the final plotted point.
 */
export function latestPersonalBest(points: readonly TrendPoint[]): TrendPoint | null {
  for (let index = points.length - 1; index >= 0; index -= 1) {
    if (points[index]?.personalBest) return points[index]!
  }
  return null
}

/** Preserve solve order and use the same penalty/precision rules as session stats. */
export function buildTrendData(solvesNewestFirst: readonly Solve[], seriesSizes: number[], trimming: AverageTrimming = DEFAULT_AVERAGE_TRIMMING): TrendPoint[] {
  const chrono = [...solvesNewestFirst].reverse()
  const sizes = [...new Set(seriesSizes.filter((n) => Number.isInteger(n) && n >= 3 && n <= 10000))]
  let best = Infinity
  const points: TrendPoint[] = chrono.map((solve, index) => {
    const singleMs = effectiveTimeMs(solve)
    const personalBest = singleMs !== null && singleMs < best
    if (singleMs !== null) best = Math.min(best, singleMs)
    return { index: index + 1, solve, singleMs, personalBest, averages: {} }
  })
  for (const size of sizes) {
    for (let index = 0; index < Math.min(size - 1, points.length); index++) points[index]!.averages[`ao${size}`] = null
    calculateRollingAverages(chrono, size, trimming).forEach((result, start) => {
      points[start + size - 1]!.averages[`ao${size}`] = result.status === 'value' ? result.ms : null
    })
  }
  return points
}

/** Robust upper-fence presets for the Time Trend Auto Y scale. */
export const TREND_CUTOFF_PRESETS: Readonly<Record<TimeTrendCutoff, { iqr: number; q3: number }>> = {
  gentle: { iqr: 4, q3: 1.75 },
  balanced: { iqr: 3, q3: 1.5 },
  strong: { iqr: 2, q3: 1.25 },
}

/**
 * Upper limit for the Time Trend Auto Y scale.
 *
 * Extreme slow singles are detected with a far-out Tukey fence selected by the
 * cutoff preset, floored at a multiple of Q3 so a low-variance session does not
 * collapse the scale. Enabled rolling averages are always included, so a
 * sustained slow trend is never mistaken for a single spike. Returns null when
 * there is nothing worth compressing (including sessions with fewer than 10
 * valid singles).
 */
export function trendOutlierLimit(
  singleValues: readonly (number | null)[],
  averageValues: readonly (number | null)[] = [],
  cutoff: TimeTrendCutoff = 'balanced',
): number | null {
  const singles = singleValues.filter(
    (value): value is number => value !== null && Number.isFinite(value) && value >= 0,
  ).sort((a, b) => a - b)
  if (singles.length < 10) return null
  const quantile = (fraction: number) => {
    const position = (singles.length - 1) * fraction
    const lower = Math.floor(position)
    const upper = Math.ceil(position)
    const low = singles[lower]!
    const high = singles[upper]!
    return low + (high - low) * (position - lower)
  }
  const q1 = quantile(0.25)
  const q3 = quantile(0.75)
  if (!(q3 > 0)) return null
  const iqr = q3 - q1
  const preset = TREND_CUTOFF_PRESETS[cutoff] ?? TREND_CUTOFF_PRESETS.balanced
  let limit = Math.max(q3 + preset.iqr * iqr, q3 * preset.q3)
  for (const value of averageValues) {
    if (value !== null && Number.isFinite(value) && value >= 0) {
      limit = Math.max(limit, value)
    }
  }
  return limit < singles[singles.length - 1]! ? limit : null
}

/**
 * Full-range nonnegative scale. An optional upper limit clips extreme values
 * while keeping the lower bound intact; without it the scale contains every
 * finite value, as Analytics expects.
 */
export function trendAxis(
  values: readonly (number | null)[],
  tickCount = 5,
  upperLimit: number | null = null,
) {
  let low = Infinity, high = -Infinity
  for (const value of values) {
    if (value === null || !Number.isFinite(value) || value < 0) continue
    low = Math.min(low, value); high = Math.max(high, value)
  }
  if (low === Infinity) { low = 0; high = 10000 }
  if (upperLimit !== null && Number.isFinite(upperLimit) && upperLimit > low && upperLimit < high) {
    high = upperLimit
  }
  const padding = Math.max((high - low) * 0.08, high * 0.01, 10)
  low = Math.max(0, low - padding)
  high += padding
  const rough = (high - low) / Math.max(2, tickCount)
  const magnitude = 10 ** Math.floor(Math.log10(rough))
  const step = [1, 2, 2.5, 5, 10].map((n) => n * magnitude).find((n) => n >= rough) ?? magnitude * 10
  // Start just below the lowest result instead of forcing a zero baseline. A
  // large outlier or a long full-range history must not turn a 10-second
  // session into a 0–90 second chart. Labels stay on the rounded step grid.
  const floorUnit = step / 10
  const min = Math.max(0, Number((Math.floor(low / floorUnit) * floorUnit).toPrecision(12)))
  const max = Math.ceil(high / step) * step
  const ticks: number[] = []
  const firstTick = Math.ceil(min / step)
  for (let i = firstTick; i * step <= max; i++) ticks.push(Number((i * step).toPrecision(12)))
  return { min, max, ticks }
}

type ChartPoint = { x: number; y: number }

/** Reduce dense lines by ordered bucket extrema; retain spikes and DNF gaps. */
export function trendPath(values: readonly (ChartPoint | null)[], buckets: number): string {
  const bucketSize = Math.max(1, Math.ceil(values.length / Math.max(1, buckets)))
  const commands: string[] = []
  let segment: ChartPoint[] = []
  const flush = () => {
    if (!segment.length) return
    const sampled: ChartPoint[] = [segment[0]!]
    for (let from = 0; from < segment.length; from += bucketSize) {
      const end = Math.min(segment.length, from + bucketSize)
      let min = from, max = from
      for (let i = from + 1; i < end; i++) {
        if (segment[i]!.y < segment[min]!.y) min = i
        if (segment[i]!.y > segment[max]!.y) max = i
      }
      sampled.push(segment[Math.min(min, max)]!)
      if (min !== max) sampled.push(segment[Math.max(min, max)]!)
    }
    sampled.push(segment[segment.length - 1]!)
    commands.push(sampled.map((point, i) => `${i === 0 ? 'M' : 'L'}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' '))
    segment = []
  }
  for (const point of values) {
    if (point === null) flush()
    else segment.push(point)
  }
  flush()
  return commands.join(' ')
}

export interface TrendAxisView {
  zoom: number
  position: number
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

/** Zoom a normalized axis around the point under the cursor, within its bounds. */
export function zoomTrendAxis(view: TrendAxisView, factor: number, anchor: number, maxZoom: number): TrendAxisView {
  if (!Number.isFinite(factor) || factor <= 0) return view
  const zoom = clamp(view.zoom * factor, 1, Math.max(1, maxZoom))
  const oldSpan = 1 / view.zoom
  const span = 1 / zoom
  const fraction = clamp(anchor, 0, 1)
  const point = (1 - oldSpan) * view.position + fraction * oldSpan
  const start = clamp(point - fraction * span, 0, 1 - span)
  return { zoom, position: span === 1 ? view.position : start / (1 - span) }
}

/** Pan by a fraction of the currently visible span, clamping at either edge. */
export function panTrendAxis(view: TrendAxisView, fraction: number): TrendAxisView {
  if (view.zoom <= 1 || !Number.isFinite(fraction)) return view
  const span = 1 / view.zoom
  return { ...view, position: clamp(view.position + fraction * span / (1 - span), 0, 1) }
}

/** Keep the exact zoomed range; only the grid interval is rounded. */
export function trendViewAxis(domain: { min: number; max: number }, view: TrendAxisView, tickCount = 5) {
  const span = (domain.max - domain.min) / view.zoom
  const min = Math.max(0, domain.min + (domain.max - domain.min - span) * view.position)
  const max = min + span
  const rough = span / Math.max(2, tickCount)
  const magnitude = 10 ** Math.floor(Math.log10(rough))
  const step = [1, 2, 2.5, 5, 10].map((n) => n * magnitude).find((n) => n >= rough) ?? magnitude * 10
  const ticks: number[] = []
  const first = Math.ceil(min / step)
  for (let i = first; i * step <= max; i++) ticks.push(Number((i * step).toPrecision(12)))
  return { min, max, ticks }
}


/** Statistics ending at this PB, independent of the chart's current zoom. */
export function buildPBStats(points: readonly TrendPoint[], solveId: string, averageSizes: readonly number[], trimming: AverageTrimming = DEFAULT_AVERAGE_TRIMMING) {
  const index = points.findIndex((point) => point.solve.id === solveId)
  const point = points[index]
  if (!point?.personalBest || point.singleMs === null) return null
  const context = points.slice(0, index + 1)
  const solves = context.map((entry) => entry.solve).reverse()
  const previousPB = context.slice(0, -1).reverse().find((entry) => entry.personalBest && entry.singleMs !== null) ?? null
  const improvementMs = previousPB?.singleMs !== null && previousPB?.singleMs !== undefined ? previousPB.singleMs - point.singleMs : null
  const sizes = [...new Set(averageSizes.filter((size) => Number.isInteger(size) && size >= 3 && size <= 10000))].sort((a, b) => a - b)
  return {
    point,
    trimming,
    previousPB,
    improvementMs,
    improvementPercent: improvementMs !== null && previousPB?.singleMs ? improvementMs / previousPB.singleMs * 100 : null,
    results: [
      { label: 'mo3', value: calculateMeanOf3(solves) },
      ...sizes.map((size) => ({ label: `ao${size}`, value: calculateAverage(solves, size, trimming) })),
    ],
  }
}
