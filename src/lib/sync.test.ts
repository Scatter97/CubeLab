import { describe, expect, it } from 'vitest'
import type { Session, SessionsData, Solve } from '../types'
import { mergeSessionsData } from './sync'
import type { SyncConflict, Tombstone } from './syncStorage'

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

  it('removes a session deleted on either device and keeps its solve tombstones', () => {
    const local = sessionsData({
      sessions: [
        session({ id: 'session-keep', solves: [solve({ id: 'keep' })] }),
        session({ id: 'session-deleted', name: 'Gone', solves: [solve({ id: 'gone' })] }),
      ],
    })
    const remote = sessionsData({
      sessions: [
        session({ id: 'session-keep', solves: [solve({ id: 'keep' })] }),
        session({ id: 'session-deleted', name: 'Gone', solves: [solve({ id: 'gone' })] }),
      ],
    })
    const tombstones: Tombstone[] = [
      { kind: 'session', id: 'session-deleted', deletedAt: Date.now(), deletedByDeviceId: 'd' },
    ]

    const result = mergeSessionsData({ local, remote, tombstones, deviceId: 'd', manualConflictReview: false })

    expect(result.merged.sessions.map((item) => item.id)).toEqual(['session-keep'])
    expect(totalSolves(result.merged)).toBe(1)
    expect(result.removedSolves).toBe(2)
  })

  it('stops instead of mixing sessions whose puzzle events disagree', () => {
    const local = sessionsData({
      sessions: [session({ id: 'shared', event: '333', solves: [solve({ id: 'A' })] })],
    })
    const remote = sessionsData({
      sessions: [session({ id: 'shared', event: '444', solves: [solve({ id: 'B', event: '444' })] })],
    })

    expect(() =>
      mergeSessionsData({ local, remote, tombstones: [], deviceId: 'd', manualConflictReview: false }),
    ).toThrow(/incompatible puzzle events/)
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

  it('adopts generated defaults that carry the explicit auto-created marker', () => {
    const local = sessionsData({
      activeSessionId: 'local-default',
      sessions: [defaultSession({ isAutoCreatedDefault: true })],
    })
    const remote = sessionsData({
      activeSessionId: 'remote-session',
      sessions: [session({ id: 'remote-session', name: 'Session 1', solves: [solve({ id: 'A' })] })],
    })

    const result = mergeSessionsData({ local, remote, tombstones: [], deviceId: 'd', manualConflictReview: false })

    expect(result.adoptedLocalDefault).toBe(true)
    expect(result.addedSolves).toBe(1)
    expect(result.merged.sessions.map((item) => item.id)).toEqual(['remote-session'])
  })

  it('adopts a generated default collection idempotently without duplicating sessions', () => {
    const local = sessionsData({
      activeSessionId: 'local-default',
      sessions: [defaultSession()],
    })
    const remote = sessionsData({
      activeSessionId: 'remote-session',
      sessions: [session({ id: 'remote-session', name: 'Session 1', solves: [solve({ id: 'A' })] })],
    })

    const first = mergeSessionsData({ local, remote, tombstones: [], deviceId: 'd', manualConflictReview: false })
    const second = mergeSessionsData({
      local: first.merged,
      remote,
      tombstones: first.mergedTombstones,
      deviceId: 'd',
      manualConflictReview: false,
    })

    expect(first.adoptedLocalDefault).toBe(true)
    expect(second.adoptedLocalDefault).toBe(false)
    expect(second.merged.sessions).toHaveLength(1)
    expect(second.merged.sessions[0]?.id).toBe('remote-session')
    expect(totalSolves(second.merged)).toBe(1)
  })

  it('preserves a deliberately created empty default-named session', () => {
    const local = sessionsData({
      activeSessionId: 'local-default',
      sessions: [
        defaultSession({
          inspectionEnabled: false,
          preferences: { holdDurationMs: 500 },
        }),
      ],
    })
    const remote = sessionsData({
      activeSessionId: 'remote-session',
      sessions: [session({ id: 'remote-session', name: 'Session 1', solves: [solve({ id: 'A' })] })],
    })

    const result = mergeSessionsData({ local, remote, tombstones: [], deviceId: 'd', manualConflictReview: false })

    expect(result.adoptedLocalDefault).toBe(false)
    expect(result.merged.sessions).toHaveLength(2)
    expect(result.merged.sessions.find((item) => item.id === 'local-default')).toBeDefined()
  })

  it('does not adopt an untouched-looking session with an explicit false marker', () => {
    const local = sessionsData({
      activeSessionId: 'local-default',
      sessions: [defaultSession({ isAutoCreatedDefault: false })],
    })
    const remote = sessionsData({
      activeSessionId: 'remote-session',
      sessions: [session({ id: 'remote-session', name: 'Session 1', solves: [solve({ id: 'A' })] })],
    })

    const result = mergeSessionsData({ local, remote, tombstones: [], deviceId: 'd', manualConflictReview: false })

    expect(result.adoptedLocalDefault).toBe(false)
    expect(result.merged.sessions).toHaveLength(2)
  })

  it('does not adopt a non-3x3 placeholder with no solves', () => {
    const local = sessionsData({
      activeSessionId: 'local-default',
      sessions: [defaultSession({ event: '222' })],
    })
    const remote = sessionsData({
      activeSessionId: 'remote-session',
      sessions: [session({ id: 'remote-session', name: 'Session 1', solves: [solve({ id: 'A' })] })],
    })

    const result = mergeSessionsData({ local, remote, tombstones: [], deviceId: 'd', manualConflictReview: false })

    expect(result.adoptedLocalDefault).toBe(false)
    expect(result.merged.sessions).toHaveLength(2)
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

describe('cross-device session ownership safety', () => {
  it('keeps a shared solve in a compatible event session when owners disagree', () => {
    const shared = solve({ id: 'shared-333', event: '333', updatedAt: 7 })
    const local = sessionsData({
      activeSessionId: 'local-333',
      sessions: [session({ id: 'local-333', event: '333', solves: [shared] })],
    })
    const remote = sessionsData({
      activeSessionId: 'remote-333',
      sessions: [session({ id: 'remote-333', event: '333', solves: [{ ...shared, updatedAt: 9 }] })],
    })
    const result = mergeSessionsData({ local, remote, tombstones: [], deviceId: 'd', manualConflictReview: false })
    expect(totalSolves(result.merged)).toBe(1)
    expect(result.merged.sessions.find((s) => s.id === 'remote-333')?.solves.map((s) => s.id)).toEqual(['shared-333'])
  })

  it('rejects invalid cross-event solve ownership without mixing event statistics', () => {
    const local = sessionsData({ sessions: [session({ id: 'local-333', event: '333', solves: [solve({ id: 'bad-owner' })] })] })
    const remote = sessionsData({ sessions: [session({ id: 'remote-444', event: '444', solves: [solve({ id: 'bad-owner' })] })] })
    expect(() => mergeSessionsData({ local, remote, tombstones: [], deviceId: 'd', manualConflictReview: false })).toThrow(/does not match its session event/)
  })
})

describe('manual conflict resolution', () => {
  const localSolve = solve({
    penalty: 'none',
    fieldUpdates: { penalty: { updatedAt: 100, editorId: 'local-device' } },
  })
  const remoteSolve = solve({
    penalty: '+2',
    fieldUpdates: { penalty: { updatedAt: 200, editorId: 'remote-device' } },
  })
  const local = sessionsData({ sessions: [session({ solves: [localSolve] })] })
  const remote = sessionsData({ sessions: [session({ solves: [remoteSolve] })] })
  const pending: SyncConflict = {
    id: 'solve-1',
    kind: 'solve',
    field: 'penalty',
    localValue: 'none',
    remoteValue: '+2',
    localUpdatedAt: 100,
    remoteUpdatedAt: 200,
    resolution: 'manual-pending',
    updatedAt: 300,
  }

  it('raises a pending conflict without publishing an automatic winner', () => {
    const result = mergeSessionsData({
      local,
      remote,
      tombstones: [],
      deviceId: 'd',
      manualConflictReview: true,
    })

    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0]?.resolution).toBe('manual-pending')
  })

  it('honors an approved local value and stamps it as the newest edit', () => {
    const result = mergeSessionsData({
      local,
      remote,
      tombstones: [],
      deviceId: 'd',
      manualConflictReview: true,
      resolvedConflicts: [{ ...pending, resolution: 'local', updatedAt: 400 }],
    })

    expect(result.conflicts).toHaveLength(0)
    const merged = result.merged.sessions[0]?.solves[0]
    expect(merged?.penalty).toBe('none')
    expect(merged?.fieldUpdates?.penalty?.updatedAt).toBe(400)
  })

  it('honors an approved cloud value', () => {
    const result = mergeSessionsData({
      local,
      remote,
      tombstones: [],
      deviceId: 'd',
      manualConflictReview: true,
      resolvedConflicts: [{ ...pending, resolution: 'remote', updatedAt: 400 }],
    })

    expect(result.conflicts).toHaveLength(0)
    expect(result.merged.sessions[0]?.solves[0]?.penalty).toBe('+2')
  })

  it('raises a new conflict when either side changes after approval', () => {
    const result = mergeSessionsData({
      local,
      remote,
      tombstones: [],
      deviceId: 'd',
      manualConflictReview: true,
      // The approval predates the current remote edit, so it no longer applies.
      resolvedConflicts: [{ ...pending, resolution: 'local', updatedAt: 150 }],
    })

    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0]?.resolution).toBe('manual-pending')
  })
})

describe('deletion versus offline edits', () => {
  const deletedAt = 1_700_000_005_000
  const tombstones: Tombstone[] = [
    { kind: 'session', id: 'session-deleted', deletedAt, deletedByDeviceId: 'other-device' },
  ]

  it('recovers only solves created after the session deletion', () => {
    const local = sessionsData({
      sessions: [
        session({
          id: 'session-deleted',
          name: 'Gone',
          solves: [
            solve({ id: 'pre-existing', createdAt: deletedAt - 1_000 }),
            solve({ id: 'offline-new', createdAt: deletedAt + 1_000 }),
          ],
        }),
      ],
    })
    const remote = sessionsData({ sessions: [] })

    const result = mergeSessionsData({
      local,
      remote,
      tombstones,
      deviceId: 'd',
      manualConflictReview: false,
    })

    expect(result.recoveredSolves).toBe(1)
    expect(result.merged.sessions.map((item) => item.id)).toEqual([
      'recovered:session-deleted',
    ])
    expect(result.merged.sessions[0]?.name).toBe('Gone (recovered)')
    expect(result.merged.sessions[0]?.solves.map((item) => item.id)).toEqual([
      'offline-new',
    ])
  })

  it('keeps recovery idempotent across repeated merges', () => {
    const local = sessionsData({
      sessions: [
        session({
          id: 'session-deleted',
          name: 'Gone',
          solves: [solve({ id: 'offline-new', createdAt: deletedAt + 1_000 })],
        }),
      ],
    })
    const remote = sessionsData({ sessions: [] })
    const first = mergeSessionsData({
      local,
      remote,
      tombstones,
      deviceId: 'd',
      manualConflictReview: false,
    })

    const second = mergeSessionsData({
      local: first.merged,
      remote,
      tombstones,
      deviceId: 'd',
      manualConflictReview: false,
    })

    expect(second.recoveredSolves).toBe(0)
    expect(second.merged.sessions.map((item) => item.id)).toEqual([
      'recovered:session-deleted',
    ])
    expect(totalSolves(second.merged)).toBe(1)
  })

  it('does not duplicate a recovered solve that also exists in a live session', () => {
    const local = sessionsData({
      sessions: [
        session({
          id: 'session-deleted',
          name: 'Gone',
          solves: [solve({ id: 'moved-solve', createdAt: deletedAt + 1_000 })],
        }),
      ],
    })
    const remote = sessionsData({
      sessions: [
        session({
          id: 'session-live',
          name: 'Live',
          solves: [solve({ id: 'moved-solve', createdAt: deletedAt + 1_000 })],
        }),
      ],
    })

    const result = mergeSessionsData({
      local,
      remote,
      tombstones,
      deviceId: 'd',
      manualConflictReview: false,
    })

    expect(result.recoveredSolves).toBe(0)
    expect(totalSolves(result.merged)).toBe(1)
    expect(result.merged.sessions[0]?.id).toBe('session-live')
  })
})
