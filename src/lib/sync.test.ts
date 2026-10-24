import { describe, expect, it } from 'vitest'
import type { Session, SessionsData, Solve } from '../types'
import { mergeSessionsData } from './sync'
import type { Tombstone } from './syncStorage'

function solve(overrides: Partial<Solve> = {}): Solve {
  return {
    id: 'solve-1',
    event: '333',
    rawMs: 12_340,
    penalty: 'none',
    scramble: "R U R' U'",
    comment: '',
    createdAt: 1_700_000_000_000,
    ...overrides,
  }
}

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    name: 'Session 1',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    solves: [],
    ...overrides,
  }
}

function sessionsData(overrides: Partial<SessionsData> = {}): SessionsData {
  return {
    activeSessionId: 'session-1',
    sessions: [session()],
    ...overrides,
  }
}

function totalSolves(data: SessionsData): number {
  return data.sessions.reduce((total, item) => total + item.solves.length, 0)
}

describe('mergeSessionsData', () => {
  it('merges cloud A/B/C with local D into four unique solves', () => {
    const local = sessionsData({
      sessions: [session({ id: 'local-session', solves: [solve({ id: 'D', createdAt: 1_700_000_004_000 })] })],
      activeSessionId: 'local-session',
    })
    const remote = sessionsData({
      sessions: [session({ id: 'remote-session', solves: [
        solve({ id: 'A', createdAt: 1_700_000_001_000 }),
        solve({ id: 'B', createdAt: 1_700_000_002_000 }),
        solve({ id: 'C', createdAt: 1_700_000_003_000 }),
      ] })],
      activeSessionId: 'remote-session',
    })

    const result = mergeSessionsData({
      local,
      remote,
      tombstones: [],
      deviceId: 'device-local',
      manualConflictReview: false,
    })

    expect(totalSolves(result.merged)).toBe(4)
    expect(result.addedSolves).toBe(3)
  })

  it('does not duplicate on repeated synchronization', () => {
    const local = sessionsData({
      sessions: [session({ id: 'session-1', solves: [
        solve({ id: 'A', createdAt: 1_700_000_001_000 }),
        solve({ id: 'D', createdAt: 1_700_000_004_000 }),
      ] })],
    })
    const remote = sessionsData({
      sessions: [session({ id: 'session-1', solves: [
        solve({ id: 'A', createdAt: 1_700_000_001_000 }),
        solve({ id: 'B', createdAt: 1_700_000_002_000 }),
        solve({ id: 'C', createdAt: 1_700_000_003_000 }),
      ] })],
    })

    const first = mergeSessionsData({ local, remote, tombstones: [], deviceId: 'd', manualConflictReview: false })
    const second = mergeSessionsData({ local: first.merged, remote: first.merged, tombstones: first.mergedTombstones, deviceId: 'd', manualConflictReview: false })
    expect(totalSolves(second.merged)).toBe(4)
  })

  it('merges solves with identical timestamps but different IDs', () => {
    const ts = 1_700_000_001_000
    const local = sessionsData({ sessions: [session({ solves: [solve({ id: 'A', createdAt: ts })] })] })
    const remote = sessionsData({ sessions: [session({ solves: [solve({ id: 'B', createdAt: ts })] })] })
    const result = mergeSessionsData({ local, remote, tombstones: [], deviceId: 'd', manualConflictReview: false })
    expect(totalSolves(result.merged)).toBe(2)
  })

  it('merges an older cloud solve when local has newer solves', () => {
    const local = sessionsData({ sessions: [session({ solves: [
      solve({ id: 'newer', createdAt: 1_700_000_003_000 }),
    ] })] })
    const remote = sessionsData({ sessions: [session({ solves: [
      solve({ id: 'older', createdAt: 1_700_000_001_000 }),
    ] })] })
    const result = mergeSessionsData({ local, remote, tombstones: [], deviceId: 'd', manualConflictReview: false })
    expect(totalSolves(result.merged)).toBe(2)
  })

  it('preserves tombstoned deletion against a stale remote copy', () => {
    const local = sessionsData({ sessions: [session({ solves: [] })] })
    const remote = sessionsData({ sessions: [session({ solves: [solve({ id: 'deleted-solve' })] })] })
    const tombstones: Tombstone[] = [{ kind: 'solve', id: 'deleted-solve', deletedAt: Date.now(), deletedByDeviceId: 'd' }]
    const result = mergeSessionsData({ local, remote, tombstones, deviceId: 'd', manualConflictReview: false })
    expect(totalSolves(result.merged)).toBe(0)
  })

  it('merges non-conflicting field edits from both sides', () => {
    const local = sessionsData({ sessions: [session({ solves: [
      solve({
        id: 'A',
        penalty: '+2',
        comment: '',
        updatedAt: 2,
        fieldUpdates: {
          penalty: { updatedAt: 2, editorId: 'laptop' },
          comment: { updatedAt: 1, editorId: 'laptop' },
        },
      }),
    ] })] })
    const remote = sessionsData({ sessions: [session({ solves: [
      solve({
        id: 'A',
        penalty: 'none',
        comment: 'nice',
        updatedAt: 3,
        fieldUpdates: {
          penalty: { updatedAt: 1, editorId: 'phone' },
          comment: { updatedAt: 3, editorId: 'phone' },
        },
      }),
    ] })] })
    const result = mergeSessionsData({ local, remote, tombstones: [], deviceId: 'd', manualConflictReview: false })
    const mergedSolve = result.merged.sessions.flatMap((s) => s.solves).find((s) => s.id === 'A')!
    expect(mergedSolve.penalty).toBe('+2')
    expect(mergedSolve.comment).toBe('nice')
  })

  it('records same-field conflicts', () => {
    const local = sessionsData({ sessions: [session({ solves: [
      solve({ id: 'A', comment: 'local', updatedAt: 5 }),
    ] })] })
    const remote = sessionsData({ sessions: [session({ solves: [
      solve({ id: 'A', comment: 'remote', updatedAt: 3 }),
    ] })] })
    const result = mergeSessionsData({ local, remote, tombstones: [], deviceId: 'd', manualConflictReview: false })
    expect(result.conflicts.length).toBeGreaterThan(0)
    const mergedSolve = result.merged.sessions.flatMap((s) => s.solves).find((s) => s.id === 'A')!
    expect(mergedSolve.comment).toBe('local')
  })

  it('preserves independently created sessions by name', () => {
    const local = sessionsData({ sessions: [session({ id: 'remote-created-locally? no', name: 'Practice', solves: [solve({ id: 'L1' })] })] })
    const remote = sessionsData({ sessions: [session({ id: 'session-remote', name: 'Practice', solves: [solve({ id: 'R1' })] })] })
    const result = mergeSessionsData({ local, remote, tombstones: [], deviceId: 'd', manualConflictReview: false })
    expect(result.merged.sessions).toHaveLength(2)
    expect(totalSolves(result.merged)).toBe(2)
  })
})

describe('empty default session adoption', () => {
  const defaultSession = (overrides: Partial<import('../types').Session> = {}) =>
    session({ id: 'local-default', name: 'Session 1', solves: [], createdAt: 1, updatedAt: 1, ...overrides })

  it('adopts the cloud session when the local default is untouched', () => {
    const local = sessionsData({
      activeSessionId: 'local-default',
      sessions: [defaultSession()],
    })
    const remote = sessionsData({
      activeSessionId: 'remote-session',
      sessions: [session({ id: 'remote-session', name: 'Session 1', solves: [solve({ id: 'A' })] })],
    })

    const result = mergeSessionsData({ local, remote, tombstones: [], deviceId: 'd', manualConflictReview: false })

    expect(result.adoptedLocalDefault).toBe(true)
    expect(result.merged.sessions).toHaveLength(1)
    expect(result.merged.sessions[0]?.id).toBe('remote-session')
    expect(result.merged.activeSessionId).toBe('remote-session')
    expect(result.merged.sessions[0]?.solves.map((solve) => solve.id)).toEqual(['A'])
    expect(result.conflicts).toHaveLength(0)
  })

  it('does not adopt when the default session has solves', () => {
    const local = sessionsData({
      activeSessionId: 'local-default',
      sessions: [defaultSession({ solves: [solve({ id: 'D' })] })],
    })
    const remote = sessionsData({
      activeSessionId: 'remote-session',
      sessions: [session({ id: 'remote-session', name: 'Work', solves: [solve({ id: 'A' })] })],
    })

    const result = mergeSessionsData({ local, remote, tombstones: [], deviceId: 'd', manualConflictReview: false })

    expect(result.adoptedLocalDefault).toBe(false)
    expect(result.merged.sessions).toHaveLength(2)
  })

  it('does not adopt a modified or legacy-uncertain default session', () => {
    const local = sessionsData({
      activeSessionId: 'local-default',
      sessions: [defaultSession({ updatedAt: 2 })],
    })
    const remote = sessionsData({
      activeSessionId: 'remote-session',
      sessions: [session({ id: 'remote-session', name: 'Work', solves: [solve({ id: 'A' })] })],
    })

    const result = mergeSessionsData({ local, remote, tombstones: [], deviceId: 'd', manualConflictReview: false })

    expect(result.adoptedLocalDefault).toBe(false)
    expect(result.merged.sessions).toHaveLength(2)
  })

  it('does not resurrect a solve suppressed by a tombstone', () => {
    const local = sessionsData({
      activeSessionId: 'local-default',
      sessions: [defaultSession()],
    })
    const remote = sessionsData({
      activeSessionId: 'remote-session',
      sessions: [session({ id: 'remote-session', name: 'Session 1', solves: [solve({ id: 'deleted-solve' })] })],
    })
    const tombstones = [{ kind: 'solve' as const, id: 'deleted-solve', deletedAt: Date.now(), deletedByDeviceId: 'd' }]

    const result = mergeSessionsData({ local, remote, tombstones, deviceId: 'd', manualConflictReview: false })

    expect(result.adoptedLocalDefault).toBe(false)
    expect(result.merged.sessions.flatMap((session) => session.solves)).toHaveLength(0)
  })
})
