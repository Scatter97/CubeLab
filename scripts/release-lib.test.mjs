import { describe, expect, it } from 'vitest'
import {
  formatReleaseVersion,
  formatTorontoDate,
  nextReleaseVersion,
  parseReleaseRecord,
} from './release-lib.mjs'

const current = {
  major: 0,
  feature: 1,
  date: '261104',
  patch: 1,
}

describe('release versioning', () => {
  it('formats the documented release string', () => {
    expect(formatReleaseVersion(current)).toBe('0.01.261104:1')
  })

  it('increments patch releases without changing feature or major', () => {
    const result = nextReleaseVersion(
      current,
      'patch',
      new Date('2026-11-05T15:00:00.000Z'),
    )
    expect(result.value).toEqual({
      major: 0,
      feature: 1,
      date: '261105',
      patch: 2,
    })
    expect(formatReleaseVersion(result.value)).toBe('0.01.261105:2')
  })

  it('continues patch numbering across different days', () => {
    const result = nextReleaseVersion(
      { ...current, date: '261105', patch: 2 },
      'patch',
      new Date('2026-11-07T15:00:00.000Z'),
    )
    expect(result.value).toEqual({
      major: 0,
      feature: 1,
      date: '261107',
      patch: 3,
    })
  })

  it('supports multiple patch releases on the same Toronto day', () => {
    const result = nextReleaseVersion(
      { ...current, date: '261105', patch: 1 },
      'patch',
      new Date('2026-11-05T20:00:00.000Z'),
    )
    expect(result.value.date).toBe('261105')
    expect(result.value.patch).toBe(2)
  })

  it('resets patch when the feature version increases', () => {
    const result = nextReleaseVersion(
      { ...current, date: '261105', patch: 4 },
      'feature',
      new Date('2026-11-10T15:00:00.000Z'),
    )
    expect(result.value).toEqual({
      major: 0,
      feature: 2,
      date: '261110',
      patch: 0,
    })
  })

  it('resets feature and patch for a major release', () => {
    const result = nextReleaseVersion(
      { major: 1, feature: 7, date: '261105', patch: 4 },
      'major',
      new Date('2026-11-10T15:00:00.000Z'),
    )
    expect(result.value).toEqual({
      major: 2,
      feature: 0,
      date: '261110',
      patch: 0,
    })
  })
})

describe('Toronto release dates', () => {
  it('uses the Toronto calendar date near midnight in winter', () => {
    expect(formatTorontoDate(new Date('2026-11-06T04:59:00.000Z'))).toBe(
      '261105',
    )
    expect(formatTorontoDate(new Date('2026-11-06T05:00:00.000Z'))).toBe(
      '261106',
    )
  })

  it('uses the Toronto calendar date near midnight in summer', () => {
    expect(formatTorontoDate(new Date('2026-07-01T03:59:00.000Z'))).toBe(
      '260630',
    )
    expect(formatTorontoDate(new Date('2026-07-01T04:00:00.000Z'))).toBe(
      '260701',
    )
  })

  it('handles year boundaries in the release date', () => {
    expect(formatTorontoDate(new Date('2027-01-01T04:59:00.000Z'))).toBe(
      '261231',
    )
    expect(formatTorontoDate(new Date('2027-01-01T05:00:00.000Z'))).toBe(
      '270101',
    )
  })

  it('rejects a release date earlier than the recorded release', () => {
    expect(() =>
      nextReleaseVersion(current, 'patch', new Date('2026-11-03T15:00:00.000Z')),
    ).toThrow('earlier than the current release date')
  })
})

describe('release record validation', () => {
  it('rejects malformed records', () => {
    expect(() => parseReleaseRecord(null)).toThrow('must be an object')
    expect(() => parseReleaseRecord({ ...current, patch: -1 })).toThrow(
      'non-negative integer',
    )
    expect(() => parseReleaseRecord({ ...current, date: '2026-11-05' })).toThrow(
      'YYMMDD',
    )
  })
})
