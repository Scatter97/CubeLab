import { describe, expect, it } from 'vitest'
import { buildTrainingAnalytics } from './analytics'
import { calibration, NOW, setup } from './persistenceFixtures.test-support'
import { createTrainingAttempt } from './records'
import type { TrainingMode, TrainingSetId } from './types'

function attempt(setId: TrainingSetId, mode: TrainingMode, id: string, rawMs: number, time: number, dnf = false) {
  return createTrainingAttempt({
    id, visitId: id, rawMs, createdAt: time, setup: { ...setup(setId, mode), generatedAt: time },
    calibration: mode === 'recognition' ? calibration(setId) : null,
    result: { status: 'valid', penalty: dnf ? 'dnf' : 'none' },
  })
}

describe('Algorithms analytics', () => {
  it('groups saved historical identity by case and revision and keeps case-only records in totals', () => {
    const first = { id: 'historical', revision: 1, notation: null }
    const second = { ...first, revision: 2 }
    const attempts = [
      { ...attempt('oll', 'execution', 'old', 1000, NOW), attribution: { kind: 'user-corrected', algorithm: first, correctedAt: NOW } as const },
      { ...attempt('oll', 'execution', 'off', 1200, NOW), algorithmTracking: false },
      { ...attempt('oll', 'execution', 'new', 1400, NOW), attribution: { kind: 'user-corrected', algorithm: second, correctedAt: NOW } as const, algorithmTracking: true },
    ]
    const result = buildTrainingAnalytics(attempts, 'oll:execution').cases.find(item => item.caseId === 'oll:27')!
    expect(result.statistics.recordedAttempts).toBe(3)
    expect(result.revisions.map(revision => [revision.algorithm, revision.statistics.raw.meanMs])).toEqual([[first, 1000], [second, 1400]])
  })
  it('keeps all four categories separate and computes dated volume and successful time', () => {
    const day = new Date(2026, 10, 11).getTime()
    const attempts = [
      attempt('oll', 'execution', 'one', 1200, day + 1),
      attempt('oll', 'execution', 'two', 2000, day + 2, true),
      attempt('oll', 'execution', 'older', 3500, day - 86_400_000),
      attempt('pll', 'execution', 'three', 3000, day + 3),
      attempt('oll', 'recognition', 'four', 4000, Math.max(day + 4, NOW)),
      attempt('pll', 'recognition', 'five', 5000, Math.max(day + 5, NOW)),
    ]
    const selected = buildTrainingAnalytics(attempts, 'oll:execution', day)
    expect(selected.statistics).toMatchObject({ recordedAttempts: 2, dnfPercentage: 50, raw: { meanMs: 1200 } })
    expect(selected.days).toEqual([{ date: day, count: 2, meanMs: 1200 }])
    expect(selected.cases.find(row => row.caseId === 'oll:27')?.statistics.recordedAttempts).toBe(2)
    expect(buildTrainingAnalytics(attempts, 'pll:execution').statistics.raw.meanMs).toBe(3000)
    expect(buildTrainingAnalytics(attempts, 'oll:recognition').statistics.raw.meanMs).toBe(4000)
    expect(buildTrainingAnalytics(attempts, 'pll:recognition').statistics.raw.meanMs).toBe(5000)
    expect(buildTrainingAnalytics(attempts.slice(1), 'oll:execution', day).days[0]?.meanMs).toBeNull()
  })
})
