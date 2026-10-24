import { describe, expect, it } from 'vitest'
import {
  formatOptionalTime,
  formatRelativeTime,
  formatSolveTime,
  formatStatValue,
  formatTime,
} from './format'

describe('time formatting', () => {
  it('formats centiseconds with two decimal places', () => {
    expect(formatTime(0)).toBe('0.00')
    expect(formatTime(9_876)).toBe('9.87')
    expect(formatTime(12_345)).toBe('12.34')
    expect(formatTime(999)).toBe('0.99')
  })

  it('adds minutes for long solves', () => {
    expect(formatTime(60_000)).toBe('1:00.00')
    expect(formatTime(83_456)).toBe('1:23.45')
    expect(formatTime(3_723_456)).toBe('62:03.45')
  })

  it('defends against invalid values', () => {
    expect(formatTime(Number.NaN)).toBe('0.00')
    expect(formatTime(-100)).toBe('0.00')
  })

  it('formats solve penalties', () => {
    expect(formatSolveTime(12_340, 'none')).toEqual({
      display: '12.34',
      suffix: null,
    })
    expect(formatSolveTime(12_340, '+2')).toEqual({
      display: '12.34',
      suffix: '+2',
    })
    expect(formatSolveTime(12_340, 'dnf')).toEqual({
      display: 'DNF',
      suffix: null,
    })
  })

  it('formats stat results including DNF and empty states', () => {
    expect(formatStatValue({ status: 'value', ms: 10_000 })).toBe('10.00')
    expect(formatStatValue({ status: 'dnf' })).toBe('DNF')
    expect(formatStatValue(null)).toBe('—')
    expect(formatOptionalTime(22_000)).toBe('22.00')
    expect(formatOptionalTime(null)).toBe('—')
  })

  it('formats statistics at tenths precision without changing the value', () => {
    expect(
      formatStatValue({ status: 'value', ms: 12_345 }, 'tenths'),
    ).toBe('12.3')
    expect(formatOptionalTime(83_456, 'tenths')).toBe('1:23.4')
    expect(formatOptionalTime(60_000, 'tenths')).toBe('1:00.0')
    expect(formatOptionalTime(null, 'tenths')).toBe('—')
  })

  it('formats relative timestamps', () => {
    const now = 1_700_000_000_000
    expect(formatRelativeTime(now, now)).toBe('Just now')
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe('5m ago')
    expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe('3h ago')
    expect(formatRelativeTime(now - 2 * 86_400_000, now)).toBe('2d ago')
  })
})
