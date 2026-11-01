import { describe, expect, it } from 'vitest'
import { AVERAGE_TRIM_OPTIONS, DEFAULT_AVERAGE_TRIMMING, getAverageTrimCounts, isAverageTrimRule } from './averageTrimming'

describe('average trimming rules', () => {
  it.each([[5, 1], [12, 1], [25, 2], [50, 3], [100, 5], [1000, 50], [10000, 500]])('rounds 5%% up for ao%i', (size, trim) => {
    expect(getAverageTrimCounts(size)).toEqual({ better: trim, worse: trim, counted: size - trim * 2 })
  })
  it('supports fixed counts, independent sides, Auto and the even/odd median', () => {
    expect(DEFAULT_AVERAGE_TRIMMING).toEqual({ better: 'p5', worse: 'auto' })
    expect(getAverageTrimCounts(1000, { better: '1', worse: 'auto' })).toEqual({ better: 1, worse: 1, counted: 998 })
    expect(getAverageTrimCounts(100, { better: 'p1', worse: 'p10' })).toEqual({ better: 1, worse: 10, counted: 89 })
    expect(getAverageTrimCounts(5, { better: 'median', worse: 'auto' })).toEqual({ better: 2, worse: 2, counted: 1 })
    expect(getAverageTrimCounts(4, { better: 'median', worse: 'auto' })).toEqual({ better: 1, worse: 1, counted: 2 })
  })
  it('always retains results for every supported side combination and small window', () => {
    for (let size = 3; size <= 100; size++) for (const left of AVERAGE_TRIM_OPTIONS) for (const right of AVERAGE_TRIM_OPTIONS) {
      const result = getAverageTrimCounts(size, { better: left.value, worse: right.value })
      expect(result.counted).toBeGreaterThan(0)
      expect(result.better + result.worse + result.counted).toBe(size)
    }
  })
  it('rejects corrupt rules and sizes', () => {
    for (const value of ['auto', 'p50', 'p99', '2', '', 1, null, {}]) expect(isAverageTrimRule(value)).toBe(false)
    expect(() => getAverageTrimCounts(2)).toThrow()
    expect(() => getAverageTrimCounts(5.5)).toThrow()
  })
})
