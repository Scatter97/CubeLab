import { describe, expect, it } from 'vitest'
import {
  formatStatTarget,
  isValidStatTargetKey,
  parseStatTarget,
} from './statTargets'

describe('statistics targets', () => {
  it.each([
    ['15', 15_000],
    ['15.00', 15_000],
    ['15.004', 15_000],
    ['1:05', 65_000],
    ['1:05.12', 65_120],
    ['0.01', 10],
    ['3600', 3_600_000],
  ])('parses %s', (input, expected) => {
    expect(parseStatTarget(input)).toEqual({ ok: true, ms: expected })
  })

  it.each([
    ['', 'Enter a target time.'],
    ['abc', 'Enter seconds'],
    ['-1', 'Enter seconds'],
    ['1:60', 'Enter seconds'],
    ['0.001', 'Use a target between'],
    ['3600.01', 'Use a target between'],
  ])('rejects %s', (input, message) => {
    const result = parseStatTarget(input)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain(message)
  })

  it('formats targets in timer notation', () => {
    expect(formatStatTarget(15_000)).toBe('15.00')
    expect(formatStatTarget(65_120)).toBe('1:05.12')
    expect(formatStatTarget(null)).toBe('')
  })

  it('accepts built-in and custom statistic keys only', () => {
    for (const key of ['single', 'mo3', 'ao5', 'ao10000', 'custom:abc']) {
      expect(isValidStatTargetKey(key)).toBe(true)
    }
    for (const key of ['', 'best-single', 'ao', 'custom:', 'other']) {
      expect(isValidStatTargetKey(key)).toBe(false)
    }
  })
})
