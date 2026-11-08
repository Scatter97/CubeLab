import { beforeEach, describe, expect, it } from 'vitest'
import type { SessionsData, Solve } from '../types'
import { createBackup, parseBackup } from './backup'
import { DEFAULT_SETTINGS, findSessionEventMismatches } from './storage'
import {
  addPendingSolveRestore,
  applyPendingSolveRestores,
  createPendingSolveRestore,
  loadSolveRecovery,
  removePendingSolveRestore,
  saveSolveRecovery,
  SOLVE_RECOVERY_STORAGE_KEY,
  SOLVE_RECOVERY_VERSION,
} from './solveRecovery'
import type { Tombstone } from './syncStorage'

const NOW = new Date(2026, 10, 7, 12).getTime()

function solve(overrides: Partial<Solve> = {}): Solve {
  return {
    id: 'recovered-solve',
    event: '333',
    rawMs: 12_000,
    penalty: '+2',
    scramble: "R U R' U'",
    comment: 'Recover me',
    createdAt: NOW,
    ...overrides,
  }
}

function sessionsData(overrides: Partial<SessionsData> = {}): SessionsData {
  return {
    activeSessionId: 'session-1',
    sessions: [
      {
        id: 'session-1',
        name: 'Main',
        event: '333',
        createdAt: NOW,
        updatedAt: NOW,
        solves: [],
      },
    ],
    ...overrides,
  }
}

function revokedTombstone(id: string): Tombstone {
  return {
    kind: 'solve',
    id,
    deletedAt: NOW,
    deletedByDeviceId: 'device-a',
    restoredAt: NOW + 1,
  }
}

function activeTombstone(id: string): Tombstone {
  return {
    kind: 'solve',
    id,
    deletedAt: NOW + 2,
    deletedByDeviceId: 'device-a',
  }
}

describe('durable solve recovery journal', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('round-trips a pending Undo and restores the original solve fields and position', () => {
    const pending = createPendingSolveRestore(
      solve(),
      1,
      'session-1',
      'Main',
      { deletedAt: NOW - 1_000, deletedByDeviceId: 'device-a' },
    )
    expect(addPendingSolveRestore(pending)).toBe(true)
    expect(loadSolveRecovery().operations).toEqual([pending])

    const result = applyPendingSolveRestores({
      data: sessionsData(),
      tombstones: [revokedTombstone(pending.solve.id)],
      operations: loadSolveRecovery().operations,
    })

    expect(result.data.sessions[0]?.solves).toEqual([pending.solve])
    expect(result.recovered).toEqual([pending])
    expect(result.remaining).toEqual([])
    expect(result.discarded).toEqual([])
    expect(
      saveSolveRecovery({
        version: SOLVE_RECOVERY_VERSION,
        operations: result.remaining,
      }),
    ).toBe(true)
    expect(loadSolveRecovery().operations).toEqual([])
  })

  it('treats an already restored solve as idempotent and removes the journal entry', () => {
    const pending = createPendingSolveRestore(solve(), 0, 'session-1', 'Main')
    addPendingSolveRestore(pending)
    const result = applyPendingSolveRestores({
      data: sessionsData({
        sessions: [
          {
            ...sessionsData().sessions[0]!,
            solves: [pending.solve],
          },
        ],
      }),
      tombstones: [revokedTombstone(pending.solve.id)],
      operations: loadSolveRecovery().operations,
    })

    expect(result.recovered).toEqual([pending])
    expect(result.remaining).toEqual([])
    expect(result.data.sessions[0]?.solves).toEqual([pending.solve])
  })

  it('lets a causally later deliberate deletion supersede the pending restoration', () => {
    const originalDeletion = {
      deletedAt: NOW - 1_000,
      deletedByDeviceId: 'device-a',
    }
    const pending = createPendingSolveRestore(
      solve(),
      0,
      'session-1',
      'Main',
      originalDeletion,
    )
    addPendingSolveRestore(pending)
    const result = applyPendingSolveRestores({
      data: sessionsData(),
      tombstones: [
        {
          kind: 'solve',
          id: pending.solve.id,
          deletedAt: NOW + 2_000,
          deletedByDeviceId: 'device-b',
        },
      ],
      operations: loadSolveRecovery().operations,
    })

    expect(result.data.sessions[0]?.solves).toEqual([])
    expect(result.recovered).toEqual([])
    expect(result.remaining).toEqual([])
    expect(result.aborted).toEqual([])
    expect(result.discarded).toEqual([pending])
  })

  it('aborts an Undo interrupted before revocation while the original deletion is still active', () => {
    const originalDeletion = {
      deletedAt: NOW - 1_000,
      deletedByDeviceId: 'device-a',
    }
    const pending = createPendingSolveRestore(
      solve(),
      0,
      'session-1',
      'Main',
      originalDeletion,
    )
    const result = applyPendingSolveRestores({
      data: sessionsData(),
      tombstones: [
        {
          kind: 'solve',
          id: pending.solve.id,
          deletedAt: originalDeletion.deletedAt,
          deletedByDeviceId: originalDeletion.deletedByDeviceId,
        },
      ],
      operations: [pending],
    })

    expect(result.data.sessions[0]?.solves).toEqual([])
    expect(result.recovered).toEqual([])
    expect(result.remaining).toEqual([])
    expect(result.discarded).toEqual([])
    expect(result.aborted).toEqual([pending])
  })

  it('conservatively aborts an older journal that lacks original deletion metadata', () => {
    const pending = createPendingSolveRestore(solve(), 0, 'session-1', 'Main')
    const result = applyPendingSolveRestores({
      data: sessionsData(),
      tombstones: [activeTombstone(pending.solve.id)],
      operations: [pending],
    })

    expect(result.data.sessions[0]?.solves).toEqual([])
    expect(result.recovered).toEqual([])
    expect(result.remaining).toEqual([])
    expect(result.discarded).toEqual([])
    expect(result.aborted).toEqual([pending])
  })

  it('uses a labelled recovery session when the original session no longer exists', () => {
    const pending = createPendingSolveRestore(
      solve({ id: 'orphaned-undo' }),
      3,
      'deleted-session',
      'Evening',
    )
    addPendingSolveRestore(pending)
    const result = applyPendingSolveRestores({
      data: sessionsData(),
      tombstones: [revokedTombstone(pending.solve.id)],
      operations: loadSolveRecovery().operations,
    })

    expect(result.remaining).toEqual([])
    expect(result.data.activeSessionId).toBe('session-1')
    const recovered = result.data.sessions.find(
      (session) => session.id !== 'session-1',
    )
    expect(recovered?.name).toBe('Evening (recovered)')
    expect(recovered?.solves).toEqual([pending.solve])
  })

  it('preserves the solve event when its original session has been reclassified', () => {
    const pending = createPendingSolveRestore(
      solve({ id: 'mixed-event-undo', event: '333' }),
      0,
      'session-1',
      'Main',
    )
    addPendingSolveRestore(pending)
    const changed = sessionsData({
      sessions: [
        {
          ...sessionsData().sessions[0]!,
          event: '222',
        },
      ],
    })
    const result = applyPendingSolveRestores({
      data: changed,
      tombstones: [revokedTombstone(pending.solve.id)],
      operations: loadSolveRecovery().operations,
    })

    expect(result.remaining).toEqual([])
    expect(result.recovered).toEqual([pending])
    expect(result.data.sessions[0]).toMatchObject({
      id: 'session-1',
      event: '222',
      solves: [],
    })
    const recovered = result.data.sessions.find(
      (session) => session.id !== 'session-1',
    )
    expect(recovered?.event).toBe('333')
    expect(recovered?.solves).toEqual([pending.solve])
    expect(findSessionEventMismatches(result.data)).toEqual([])

    const parsed = parseBackup(
      JSON.stringify(createBackup(result.data, DEFAULT_SETTINGS)),
    )
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(
      parsed.backup.sessions.sessions
        .flatMap((session) => session.solves)
        .filter((entry) => entry.id === pending.solve.id),
    ).toEqual([pending.solve])
  })

  it('keeps reclassified-session recovery idempotent across repeated application', () => {
    const pending = createPendingSolveRestore(
      solve({ id: 'repeat-mixed-event', event: '333' }),
      0,
      'session-1',
      'Main',
    )
    const changed = sessionsData({
      sessions: [
        {
          ...sessionsData().sessions[0]!,
          event: '222',
        },
      ],
    })
    const first = applyPendingSolveRestores({
      data: changed,
      tombstones: [revokedTombstone(pending.solve.id)],
      operations: [pending],
    })
    const second = applyPendingSolveRestores({
      data: first.data,
      tombstones: [revokedTombstone(pending.solve.id)],
      operations: [pending],
    })

    expect(second.data.sessions).toHaveLength(2)
    expect(
      second.data.sessions.flatMap((session) =>
        session.solves.filter((entry) => entry.id === pending.solve.id),
      ),
    ).toHaveLength(1)
    expect(second.recovered).toEqual([pending])
    expect(second.remaining).toEqual([])
  })

  it('keeps custom-event recovery compatible without inventing an event', () => {
    const pending = createPendingSolveRestore(
      solve({ id: 'custom-event-undo', event: 'custom:fto' }),
      0,
      'session-1',
      'Main',
    )
    const data = sessionsData({
      sessions: [
        {
          ...sessionsData().sessions[0]!,
          event: '333',
        },
      ],
      customEvents: [
        {
          id: 'custom:fto',
          name: 'FTO',
          placeholder: 'No FTO scramble',
          createdAt: NOW,
          updatedAt: NOW,
        },
      ],
    })
    const result = applyPendingSolveRestores({
      data,
      tombstones: [revokedTombstone(pending.solve.id)],
      operations: [pending],
    })

    const recovered = result.data.sessions.find(
      (session) => session.id !== 'session-1',
    )
    expect(recovered?.event).toBe('custom:fto')
    expect(recovered?.solves).toEqual([pending.solve])
    expect(result.data.customEvents).toEqual(data.customEvents)
    expect(findSessionEventMismatches(result.data)).toEqual([])
  })

  it('treats a missing legacy session event as the 333 default', () => {
    const pending = createPendingSolveRestore(solve(), 0, 'session-1', 'Main')
    const data = sessionsData({
      sessions: [
        {
          ...sessionsData().sessions[0]!,
          event: undefined,
        },
      ],
    })
    const result = applyPendingSolveRestores({
      data,
      tombstones: [revokedTombstone(pending.solve.id)],
      operations: [pending],
    })

    expect(result.data.sessions).toHaveLength(1)
    expect(result.data.sessions[0]?.solves).toEqual([pending.solve])
  })

  it('ignores malformed records without losing unrelated valid operations', () => {
    const pending = createPendingSolveRestore(solve(), 0, 'session-1', 'Main')
    localStorage.setItem(
      SOLVE_RECOVERY_STORAGE_KEY,
      JSON.stringify({
        version: SOLVE_RECOVERY_VERSION,
        operations: [
          { operationId: '', sessionId: 'session-1' },
          { ...pending, solve: { ...pending.solve, rawMs: -1 } },
          pending,
        ],
      }),
    )
    expect(loadSolveRecovery().operations).toEqual([pending])
    expect(removePendingSolveRestore(pending.operationId)).toBe(true)
    expect(loadSolveRecovery().operations).toEqual([])

    localStorage.setItem(
      SOLVE_RECOVERY_STORAGE_KEY,
      JSON.stringify({ version: 2, operations: [pending] }),
    )
    expect(loadSolveRecovery().operations).toEqual([])
  })
})
