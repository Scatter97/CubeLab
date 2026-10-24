import { describe, expect, it } from 'vitest'
import type { Session, SessionsData, Solve } from '../types'
import {
  DEFAULT_SESSION_NAME,
  addSolve,
  clearActiveSolves,
  countSolves,
  createSession,
  deleteSession,
  getActiveSession,
  getSessionNameError,
  nextSessionName,
  normalizeSessionName,
  removeSolve,
  renameSession,
  restoreSolve,
  setActiveSession,
  setSessionInspection,
  setSolveComment,
  setSolvePenalty,
  MAX_SOLVE_COMMENT_LENGTH,
} from './sessions'

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
    name: DEFAULT_SESSION_NAME,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    solves: [],
    ...overrides,
  }
}

function data(overrides: Partial<SessionsData> = {}): SessionsData {
  return {
    activeSessionId: 'session-1',
    sessions: [session()],
    ...overrides,
  }
}

describe('session names', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeSessionName('  Morning   solves  ')).toBe('Morning solves')
  })

  it('rejects empty, long, and duplicate names', () => {
    const sessions = [session({ name: 'Morning' })]
    expect(getSessionNameError('   ', sessions)).toBe('Enter a session name.')
    expect(getSessionNameError('x'.repeat(41), sessions)).toMatch(
      /40 characters or fewer/,
    )
    expect(getSessionNameError(' morning ', sessions)).toBe(
      'Session names must be unique.',
    )
    expect(getSessionNameError('Morning', sessions, 'session-1')).toBeNull()
  })

  it('finds the smallest unused default name', () => {
    expect(nextSessionName([])).toBe('Session 1')
    expect(
      nextSessionName([
        session({ id: 'a', name: 'Session 1' }),
        session({ id: 'b', name: 'Session 3' }),
      ]),
    ).toBe('Session 2')
  })
})

describe('session collection', () => {
  it('creates and activates a session', () => {
    const result = createSession(data(), '  Evening  ', {
      id: 'session-2',
      now: 1_700_000_100_000,
    })
    expect(result).not.toBeNull()
    if (!result) return

    expect(result.sessionId).toBe('session-2')
    expect(result.data.activeSessionId).toBe('session-2')
    expect(result.data.sessions).toHaveLength(2)
    expect(result.data.sessions[1]).toMatchObject({
      id: 'session-2',
      name: 'Evening',
      createdAt: 1_700_000_100_000,
      updatedAt: 1_700_000_100_000,
      solves: [],
    })
  })

  it('inherits the requested inspection value when creating a session', () => {
    const result = createSession(data(), 'Evening', {
      id: 'session-2',
      inspectionEnabled: true,
    })
    expect(result?.data.sessions[1]?.inspectionEnabled).toBe(true)
  })

  it('refuses duplicate names and duplicate IDs', () => {
    const current = data()
    expect(createSession(current, 'session 1')).toBeNull()
    expect(
      createSession(current, 'Another', { id: 'session-1' }),
    ).toBeNull()
  })

  it('renames a session without touching its solves', () => {
    const current = data({
      sessions: [session({ solves: [solve()] })],
    })
    const renamed = renameSession(current, 'session-1', '  Morning ', 5)
    expect(renamed).not.toBeNull()
    if (!renamed) return

    expect(renamed.sessions[0]?.name).toBe('Morning')
    expect(renamed.sessions[0]?.updatedAt).toBe(5)
    expect(renamed.sessions[0]?.solves).toEqual([solve()])
    expect(renameSession(current, 'session-1', '  Session 1  ', 5)).toBe(current)
  })

  it('rejects renaming to an empty or duplicate name', () => {
    const current = data({
      sessions: [session(), session({ id: 'session-2', name: 'Evening' })],
    })
    expect(renameSession(current, 'session-2', '')).toBeNull()
    expect(renameSession(current, 'session-2', 'session 1')).toBeNull()
    expect(renameSession(current, 'missing', 'Morning')).toBeNull()
  })

  it('switches the active session and ignores unknown IDs', () => {
    const current = data({
      sessions: [session(), session({ id: 'session-2', name: 'Evening' })],
    })
    expect(setActiveSession(current, 'session-2').activeSessionId).toBe(
      'session-2',
    )
    expect(setActiveSession(current, 'missing')).toBe(current)
  })

  it('deletes a session and chooses a neighboring active session', () => {
    const current = data({
      activeSessionId: 'session-2',
      sessions: [
        session(),
        session({ id: 'session-2', name: 'Evening' }),
        session({ id: 'session-3', name: 'Late night' }),
      ],
    })
    const deleted = deleteSession(current, 'session-2')
    expect(deleted).not.toBeNull()
    if (!deleted) return
    expect(deleted.activeSessionId).toBe('session-3')
    expect(deleted.sessions.map((item) => item.id)).toEqual([
      'session-1',
      'session-3',
    ])
  })

  it('refuses to delete the last session', () => {
    expect(deleteSession(data(), 'session-1')).toBeNull()
    expect(deleteSession(data(), 'missing')).toBeNull()
  })
})

describe('solve mutations', () => {
  it('adds solves newest-first to the active session only', () => {
    const current = data({
      sessions: [session(), session({ id: 'session-2', name: 'Evening' })],
    })
    const next = addSolve(current, solve(), 5)
    expect(next.sessions[0]?.solves).toEqual([solve()])
    expect(next.sessions[1]?.solves).toEqual([])
    expect(next.sessions[0]?.updatedAt).toBe(5)

    const second = addSolve(
      next,
      solve({ id: 'solve-2', rawMs: 9_000 }),
      6,
    )
    expect(second.sessions[0]?.solves.map((item) => item.id)).toEqual([
      'solve-2',
      'solve-1',
    ])
  })

  it('does not add a duplicate solve ID', () => {
    const current = data({ sessions: [session({ solves: [solve()] })] })
    expect(addSolve(current, solve(), 5)).toBe(current)
  })

  it('stores and clears solve comments without touching raw time', () => {
    const current = data({ sessions: [session({ solves: [solve()] })] })
    const commented = setSolveComment(current, 'solve-1', '  Locked up on F2L  ', 5)
    expect(commented.sessions[0]?.solves[0]).toMatchObject({
      rawMs: 12_340,
      comment: '  Locked up on F2L  ',
    })
    expect(commented.sessions[0]?.updatedAt).toBe(5)

    const cleared = setSolveComment(commented, 'solve-1', '', 6)
    expect(cleared.sessions[0]?.solves[0]?.comment).toBe('')
    expect(setSolveComment(cleared, 'missing', 'x')).toBe(cleared)
  })

  it('truncates solve comments to the supported length', () => {
    const current = data({ sessions: [session({ solves: [solve()] })] })
    const long = 'x'.repeat(MAX_SOLVE_COMMENT_LENGTH + 20)
    const commented = setSolveComment(current, 'solve-1', long)
    expect(commented.sessions[0]?.solves[0]?.comment).toHaveLength(
      MAX_SOLVE_COMMENT_LENGTH,
    )
  })

  it('sets a per-session inspection override', () => {
    const current = data({
      sessions: [session(), session({ id: 'session-2', name: 'Evening' })],
    })
    const updated = setSessionInspection(current, 'session-2', true, 5)
    expect(updated.sessions[1]?.inspectionEnabled).toBe(true)
    expect(updated.sessions[1]?.updatedAt).toBe(5)
    expect(updated.sessions[0]?.inspectionEnabled).toBeUndefined()
    expect(setSessionInspection(updated, 'session-2', true, 6)).toBe(updated)
  })

  it('updates penalties without overwriting raw time', () => {
    const current = data({ sessions: [session({ solves: [solve()] })] })
    const next = setSolvePenalty(current, 'solve-1', '+2', 5)
    expect(next.sessions[0]?.solves[0]).toMatchObject({
      rawMs: 12_340,
      penalty: '+2',
    })
    expect(next.sessions[0]?.updatedAt).toBe(5)
    expect(setSolvePenalty(next, 'missing', 'dnf')).toBe(next)
  })

  it('removes a solve and restores it to its original session', () => {
    const current = data({
      sessions: [
        session({ solves: [solve(), solve({ id: 'solve-2' })] }),
        session({ id: 'session-2', name: 'Evening' }),
      ],
    })
    const removed = removeSolve(current, 'solve-1', 5)
    expect(removed).not.toBeNull()
    if (!removed) return

    expect(removed.removed).toEqual({
      solve: solve(),
      index: 0,
      sessionId: 'session-1',
    })
    expect(removed.data.sessions[0]?.solves.map((item) => item.id)).toEqual([
      'solve-2',
    ])

    const switched = setActiveSession(removed.data, 'session-2')
    const restored = restoreSolve(
      switched,
      removed.removed.sessionId,
      removed.removed.solve,
      removed.removed.index,
      6,
    )
    expect(restored).not.toBeNull()
    if (!restored) return
    expect(restored.activeSessionId).toBe('session-2')
    expect(restored.sessions[0]?.solves.map((item) => item.id)).toEqual([
      'solve-1',
      'solve-2',
    ])
  })

  it('does not restore into a deleted session or duplicate an existing solve', () => {
    const current = data({ sessions: [session({ solves: [solve()] })] })
    expect(restoreSolve(current, 'missing', solve(), 0)).toBeNull()
    expect(restoreSolve(current, 'session-1', solve(), 0)).toBeNull()
  })

  it('clears only the active session', () => {
    const current = data({
      sessions: [
        session({ solves: [solve()] }),
        session({ id: 'session-2', name: 'Evening', solves: [solve()] }),
      ],
    })
    const cleared = clearActiveSolves(current, 5)
    expect(cleared.sessions[0]?.solves).toEqual([])
    expect(cleared.sessions[0]?.updatedAt).toBe(5)
    expect(cleared.sessions[1]?.solves).toHaveLength(1)
    expect(clearActiveSolves(cleared, 6)).toBe(cleared)
  })

  it('reports the active session and total solve count', () => {
    const current = data({
      activeSessionId: 'missing',
      sessions: [
        session({ solves: [solve()] }),
        session({ id: 'session-2', name: 'Evening', solves: [solve()] }),
      ],
    })
    expect(getActiveSession(current)?.id).toBe('session-1')
    expect(countSolves(current.sessions)).toBe(2)
  })
})
