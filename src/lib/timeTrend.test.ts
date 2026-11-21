import { describe, expect, it } from 'vitest'
import { buildTrendData, buildPBStats, latestPersonalBest, trendAxis, trendOutlierLimit, trendPath, zoomTrendAxis, panTrendAxis, trendViewAxis } from './timeTrend'
import type { Solve } from '../types'

const solve = (rawMs: number, id: number, penalty: Solve['penalty'] = 'none'): Solve => ({
  id: String(id), event: '333', rawMs, penalty, scramble: 'R U', comment: '', createdAt: id * 1000,
})

describe('trend data', () => {
  it('orders oldest first, preserves source data and marks lifetime PBs', () => {
    const solves = [solve(10000, 4), solve(9000, 3, 'dnf'), solve(10000, 2), solve(12009, 1)]
    const points = buildTrendData(solves, [])
    expect(points.map((p) => p.singleMs)).toEqual([12000, 10000, null, 10000])
    expect(points.map((p) => p.personalBest)).toEqual([true, true, false, false])
    expect(solves[0]!.id).toBe('4')
    expect(points.slice(2).every((p) => !p.personalBest)).toBe(true)
  })

  it('uses recorded precision, +2, trimmed averages and DNF rules', () => {
    const points = buildTrendData([solve(10009, 5), solve(10009, 4), solve(10009, 3), solve(10009, 2, '+2'), solve(10009, 1, 'dnf')], [5, 5, 2, NaN, 10001])
    expect(points[4]!.averages.ao5).toBe(10670)
    expect(Object.keys(points[4]!.averages)).toEqual(['ao5'])
    expect(points[0]!.averages.ao5).toBeNull()
    expect(buildTrendData([solve(10000, 5, 'dnf'), solve(10000, 4, 'dnf'), solve(10000, 3), solve(10000, 2), solve(10000, 1)], [5])[4]!.averages.ao5).toBeNull()
  })
})

describe('trend axes', () => {
  it.each([[0, 1, 2], [10009, 10009], [10, 10000, 900000], [], [null, null]])('keeps a nonnegative domain containing every finite time: %j', (...values) => {
    const axis = trendAxis(values)
    expect(axis.min).toBeGreaterThanOrEqual(0)
    expect(axis.max).toBeGreaterThan(axis.min)
    expect(axis.ticks.length).toBeGreaterThan(1)
    expect(axis.ticks.every((v) => v >= 0)).toBe(true)
    for (const value of values) {
      if (value === null) continue
      expect(value).toBeGreaterThanOrEqual(axis.min)
      expect(value).toBeLessThanOrEqual(axis.max)
    }
  })

  it('does not force a zero baseline when every result is far from zero', () => {
    const axis = trendAxis([10000, 30000, 90000], 5)
    expect(axis.min).toBeGreaterThan(0)
    expect(axis.min).toBeLessThanOrEqual(10000)
    expect(axis.max).toBeGreaterThanOrEqual(90000)
    expect(axis.ticks.length).toBeGreaterThan(1)
    expect(axis.ticks.every((tick) => tick >= axis.min && tick <= axis.max)).toBe(true)
    expect(axis.ticks.every((tick) => tick % 1 === 0)).toBe(true)
  })

  it('caps the upper domain for the Auto scale without moving the lower bound', () => {
    const cluster = Array.from({ length: 100 }, (_, i) => 10000 + (i % 20) * 250)
    const values = [...cluster, 90000]
    const full = trendAxis(values)
    const capped = trendAxis(values, 5, 21250)
    expect(full.max).toBeGreaterThan(90000)
    expect(capped.max).toBeGreaterThan(21250)
    expect(capped.max).toBeLessThan(90000)
    expect(capped.min).toBeGreaterThanOrEqual(0)
    expect(capped.min).toBeLessThanOrEqual(10000)
    expect(capped.ticks.every((tick) => tick >= capped.min && tick <= capped.max)).toBe(true)
    expect(trendAxis(values, 5, null)).toEqual(full)
    expect(trendAxis(values, 5, 200000)).toEqual(full)
  })
})

describe('auto Y scaling', () => {
  const cluster = Array.from({ length: 100 }, (_, i) => 10000 + (i % 20) * 250)

  it('caps extreme slow singles and never clips an enabled rolling average', () => {
    const singles = [...cluster, 90000]
    const limit = trendOutlierLimit(singles)
    expect(limit).not.toBeNull()
    expect(limit!).toBeGreaterThan(14000)
    expect(limit!).toBeLessThan(90000)
    expect(trendOutlierLimit(singles, [50000])).toBe(50000)
    expect(trendOutlierLimit(singles, [90000])).toBeNull()
  })

  it('stays full-range for small sessions, ordinary spread and zero-variance clusters', () => {
    expect(trendOutlierLimit([])).toBeNull()
    expect(trendOutlierLimit([10000, 20000, 90000])).toBeNull()
    expect(trendOutlierLimit(Array.from({ length: 100 }, (_, i) => 10000 + (i % 40) * 250))).toBeNull()
    const fixed = Array.from({ length: 20 }, () => 10000)
    expect(trendOutlierLimit([...fixed, 14000])).toBeNull()
    expect(trendOutlierLimit([...fixed, 20000])).toBe(15000)
  })

  it('ignores invalid values and leaves the input unchanged', () => {
    const singles = [...cluster, 90000, null, NaN, -1, Infinity]
    const before = [...singles]
    expect(trendOutlierLimit(singles)).not.toBeNull()
    expect(singles).toEqual(before)
  })

  it('applies the Gentle, Standard and Strong fence presets', () => {
    const fixed = Array.from({ length: 20 }, () => 10000)
    const values = [...fixed, 20000]
    expect(trendOutlierLimit(values, [], 'gentle')).toBe(17500)
    expect(trendOutlierLimit(values, [], 'balanced')).toBe(15000)
    expect(trendOutlierLimit(values, [], 'strong')).toBe(12500)
    // A wider IQR uses the preset's Q3 + multiplier instead of the Q3 floor.
    const spread = [...Array.from({ length: 80 }, (_, i) => 8000 + (i % 20) * 100), 60000]
    const gentle = trendOutlierLimit(spread, [], 'gentle')!
    const balanced = trendOutlierLimit(spread, [], 'balanced')!
    const strong = trendOutlierLimit(spread, [], 'strong')!
    expect(gentle).toBeGreaterThan(balanced)
    expect(balanced).toBeGreaterThan(strong)
  })

  it('keeps the 10-single floor and clamps every cutoff to enabled averages', () => {
    const nine = [10000, 10000, 10000, 10000, 10000, 10000, 10000, 10000, 90000]
    expect(trendOutlierLimit(nine, [], 'gentle')).toBeNull()
    expect(trendOutlierLimit(nine, [], 'balanced')).toBeNull()
    expect(trendOutlierLimit(nine, [], 'strong')).toBeNull()
    const ten = [...nine, 10000]
    for (const cutoff of ['gentle', 'balanced', 'strong'] as const) {
      expect(trendOutlierLimit(ten, [75000], cutoff)).toBe(75000)
      expect(trendOutlierLimit(ten, [90000], cutoff)).toBeNull()
    }
  })
})

describe('dense trend rendering', () => {
  it('retains narrow spikes, the endpoints and gaps at DNFs', () => {
    const values = Array.from({ length: 10000 }, (_, x) => ({ x, y: x === 4321 ? 1000 : 10 }))
    const path = trendPath([...values, null, { x: 10001, y: 20 }], 300)
    expect(path).toContain('M0.00,10.00')
    expect(path).toContain('L4321.00,1000.00')
    expect(path).toContain('L9999.00,10.00')
    expect(path).toContain('M10001.00,20.00')
    expect(path.split(' ').length).toBeLessThan(1000)
  })
})


describe('trackpad viewport', () => {
  it('keeps the value under the pointer fixed while zooming', () => {
    const view = { zoom: 2, position: 0.4 }
    const anchor = 0.7
    const next = zoomTrendAxis(view, 2, anchor, 100)
    const valueAt = (v: typeof view) => (1 - 1 / v.zoom) * v.position + anchor / v.zoom
    expect(valueAt(next)).toBeCloseTo(valueAt(view))
    const restored = zoomTrendAxis(next, 0.5, anchor, 100)
    expect(restored.zoom).toBe(view.zoom)
    expect(restored.position).toBeCloseTo(view.position)
  })

  it('bounds extreme zoom, ignores invalid factors, and clamps panning', () => {
    const view = { zoom: 1, position: 0.5 }
    expect(zoomTrendAxis(view, 100000, 0.5, 50).zoom).toBe(50)
    expect(zoomTrendAxis(view, 0.001, 0.5, 50).zoom).toBe(1)
    expect(zoomTrendAxis(view, NaN, 0.5, 50)).toEqual(view)
    expect(panTrendAxis(view, 100)).toEqual(view)
    const zoomed = { zoom: 4, position: 0.5 }
    expect(panTrendAxis(zoomed, -100).position).toBe(0)
    expect(panTrendAxis(zoomed, 100).position).toBe(1)
    expect(panTrendAxis(zoomed, 0.3).position).toBeCloseTo(0.6)
  })

  it('zooms either edge without negative time ranges and retains precise bounds', () => {
    const view = zoomTrendAxis({ zoom: 1, position: 0.5 }, 4, 0, 100)
    const axis = trendViewAxis({ min: 0, max: 100000 }, view)
    expect(axis.min).toBe(0)
    expect(axis.max).toBe(25000)
    expect(axis.ticks.every((v) => v >= axis.min && v <= axis.max)).toBe(true)
    const top = trendViewAxis({ min: 0, max: 100000 }, { zoom: 4, position: 1 })
    expect(top.min).toBe(75000)
    expect(top.max).toBe(100000)
  })
})


describe('PB statistics', () => {
  it('uses the selected PB and its past window, even when newer solves are faster', () => {
    const chrono = [solve(20000, 1), solve(22000, 2), solve(21000, 3), solve(23000, 4), solve(16000, 5, '+2'), solve(16000, 6), solve(15000, 7)]
    const points = buildTrendData([...chrono].reverse(), [])
    const stats = buildPBStats(points, '5', [5, 12, 5, 3, NaN])!
    expect(stats.point.index).toBe(5)
    expect(stats.point.singleMs).toBe(18000)
    expect(stats.previousPB?.singleMs).toBe(20000)
    expect(stats.improvementMs).toBe(2000)
    expect(stats.improvementPercent).toBe(10)
    expect(stats.results.find((result) => result.label === 'mo3')?.value).toEqual({ status: 'value', ms: 20670 })
    expect(stats.results.find((result) => result.label === 'ao3')?.value).toEqual({ status: 'value', ms: 21000 })
    expect(stats.results.find((result) => result.label === 'ao5')?.value).toEqual({ status: 'value', ms: 21000 })
    expect(stats.results.find((result) => result.label === 'ao12')?.value).toBeNull()
    expect(chrono[4]!.rawMs).toBe(16000)
  })

  it('handles the first valid solve and rejects non-PB or missing IDs', () => {
    const points = buildTrendData([solve(22000, 3), solve(20000, 2), solve(10000, 1, 'dnf')], [])
    const first = buildPBStats(points, '2', [5])!
    expect(first.previousPB).toBeNull()
    expect(first.improvementMs).toBeNull()
    expect(first.results.every((result) => result.value === null)).toBe(true)
    expect(buildPBStats(points, '1', [5])).toBeNull()
    expect(buildPBStats(points, '3', [5])).toBeNull()
    expect(buildPBStats(points, 'missing', [5])).toBeNull()
  })

  it('preserves DNF rolling results instead of treating them as missing', () => {
    const points = buildTrendData([solve(9000, 5), solve(15000, 4, 'dnf'), solve(14000, 3), solve(13000, 2, 'dnf'), solve(12000, 1)], [])
    const stats = buildPBStats(points, '5', [5])!
    expect(stats.results.find((result) => result.label === 'mo3')?.value).toEqual({ status: 'dnf' })
    expect(stats.results.find((result) => result.label === 'ao5')?.value).toEqual({ status: 'dnf' })
  })
})


describe('latest PB and nearest-point lookup', () => {
  it('selects the latest lifetime PB even when newer solves are not PBs', () => {
    const chrono = [solve(20000, 1), solve(22000, 2), solve(18000, 3), solve(23000, 4), solve(16000, 5), solve(17000, 6)]
    const points = buildTrendData([...chrono].reverse(), [])
    expect(points.map((point) => point.personalBest)).toEqual([true, false, true, false, true, false])
    const latest = latestPersonalBest(points)
    expect(latest?.solve.id).toBe('5')
    expect(latest?.index).toBe(5)
    expect(latestPersonalBest([])).toBeNull()
  })

  it('moves the latest PB when a newer lifetime best arrives', () => {
    const chrono = [solve(20000, 1), solve(18000, 2), solve(19000, 3)]
    const points = buildTrendData([...chrono].reverse(), [])
    expect(latestPersonalBest(points)?.solve.id).toBe('2')
    const newer = buildTrendData([...chrono, solve(17000, 4)].reverse(), [])
    expect(latestPersonalBest(newer)?.solve.id).toBe('4')
  })

})

describe('trimming consistency in trends and PB details', () => {
  it('recalculates chart windows and historical PB results with the same policy', () => {
    const chrono = Array.from({ length: 1000 }, (_, i) => solve(i === 999 ? 9000 : 10000, i + 1, i >= 800 && i < 850 ? 'dnf' : 'none'))
    const input = [...chrono].reverse()
    const normal = buildTrendData(input, [1000])
    expect(normal[999]!.averages.ao1000).toBe(10000)
    expect(buildPBStats(normal, '1000', [1000])!.results.find((r) => r.label === 'ao1000')?.value).toEqual({ status: 'value', ms: 10000 })
    const trimming = { better: '1' as const, worse: 'auto' as const }
    const fixed = buildTrendData(input, [1000], trimming)
    expect(fixed[999]!.averages.ao1000).toBeNull()
    expect(buildPBStats(fixed, '1000', [1000], trimming)!.results.find((r) => r.label === 'ao1000')?.value).toEqual({ status: 'dnf' })
    expect(fixed.map((p) => p.personalBest)).toEqual(normal.map((p) => p.personalBest))
    expect(input[0]!.rawMs).toBe(9000)
  })
})
