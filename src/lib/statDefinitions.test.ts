import { getAverageTrimCounts } from './averageTrimming'
import { describe, expect, it } from 'vitest'
import {
  MAX_CUSTOM_AVERAGES,
  isBuiltInAverageSize,
  isValidAverageSize,
  isValidCustomAverageSize,
  nextCustomAverageSize,
} from './statDefinitions'

describe('stat definitions', () => {
  it('rejects duplicate built-in average sizes for custom cards', () => {
    expect(isBuiltInAverageSize(5)).toBe(true)
    expect(isBuiltInAverageSize(12)).toBe(true)
    expect(isValidCustomAverageSize(5)).toBe(false)
    expect(isValidCustomAverageSize(7)).toBe(true)
    expect(isValidCustomAverageSize(3)).toBe(true)
    expect(isValidCustomAverageSize(10_001)).toBe(false)
  })

  it('validates the shared average-size range', () => {
    expect(isValidAverageSize(3)).toBe(true)
    expect(isValidAverageSize(10_000)).toBe(true)
    expect(isValidAverageSize(2)).toBe(false)
    expect(isValidAverageSize(10_001)).toBe(false)
    expect(isValidAverageSize(7.5)).toBe(false)
  })

  it('picks the next free custom size above ao5', () => {
    expect(nextCustomAverageSize([])).toBe(6)
    expect(nextCustomAverageSize([6, 7, 12])).toBe(8)
    expect(MAX_CUSTOM_AVERAGES).toBe(5)
  })
})


it('uses the same trimming policy for built-in and custom average sizes', () => {
  expect(getAverageTrimCounts(25)).toEqual({ better: 2, worse: 2, counted: 21 })
  expect(getAverageTrimCounts(50)).toEqual({ better: 3, worse: 3, counted: 44 })
})
