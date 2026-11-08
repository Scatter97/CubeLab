import { describe, expect, it } from 'vitest'
import type { Session, SessionsData, Solve } from '../types'
import {
  DEFAULT_SESSION_NAME,
  addSolve,
  clearActiveSolves,
  clearAllSolves,
  countSolves,
  appendSessionsInOrder,
  deleteAllSessions,
  getOrderedSessions,
  getSessionMergeError,
  getSessionSummary,
  mergeSessions,
  moveSession,
  moveSessionTo,
  resolveSessionOrdering,
  createSession,
  deleteSession,
  getActiveSession,
  getSessionDisplayNames,
  getSessionNameError,
  nextSessionName,
  normalizeSessionName,
  removeSolve,
  renameSession,
  resolveUniqueSessionNames,
  restoreSolve,
  reconcileExternalSessions,
  setActiveSession,
  setSessionEvent,
  setSessionInspection,
  setSessionPreferences,
  setSolveComment,
  setSolvePenalty,
  splitSession,
  MAX_SESSION_NAME_LENGTH,
  MAX_SOLVE_COMMENT_LENGTH,
} from './sessions'
import { reassignSessionsEvent } from './customEvents'
import {
  createAnalyticsFilters,
  filterAnalyticsSolves,
} from './analytics'
import { buildTrendData } from './timeTrend'

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
      'Session name already exists. Please choose a different name.',
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

describe('unique session names', () => {
  it('numbers duplicates in source order without changing the first name', () => {
    expect(
      resolveUniqueSessionNames(['Practice', 'practice', 'PRACTICE']),
    ).toEqual(['Practice', 'practice(1)', 'PRACTICE(2)'])
  })

  it('avoids every existing name and already-numbered name case-insensitively', () => {
    expect(
      resolveUniqueSessionNames(
        ['Practice', 'Practice(1)', 'Practice'],
        ['practice', 'Practice(1)'],
      ),
    ).toEqual(['Practice(2)', 'Practice(3)', 'Practice(4)'])
  })

  it('keeps a later numbered original instead of generating its name first', () => {
    expect(
      resolveUniqueSessionNames(['Practice', 'Practice(1)'], ['practice']),
    ).toEqual(['Practice(2)', 'Practice(1)'])
  })

  it('respects the stored name-length limit when numbering', () => {
    const base = 'x'.repeat(MAX_SESSION_NAME_LENGTH)
    expect(resolveUniqueSessionNames([base, base])).toEqual([
      base,
      `${'x'.repeat(MAX_SESSION_NAME_LENGTH - 3)}(1)`,
    ])
  })

  it('labels existing duplicates without rewriting their stored names', () => {
    const sessions = [
      session({ id: 'a', name: 'Morning' }),
      session({ id: 'b', name: 'morning' }),
      session({ id: 'c', name: 'Morning(1)' }),
      session({ id: 'd', name: 'Evening' }),
    ]
    expect(getSessionDisplayNames(sessions)).toEqual([
      'Morning',
      'morning(2)',
      'Morning(1)',
      'Evening',
    ])
    expect(sessions.map((item) => item.name)).toEqual([
      'Morning',
      'morning',
      'Morning(1)',
      'Evening',
    ])
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

  it('creates and switches between event-specific sessions', () => {
    const twoByTwo = createSession(data(), '2×2', {
      id: 'session-222',
      event: '222',
    })
    expect(twoByTwo).not.toBeNull()
    if (!twoByTwo) return

    const fourByFour = createSession(twoByTwo.data, '4×4', {
      id: 'session-444',
      event: '444',
    })
    expect(fourByFour).not.toBeNull()
    if (!fourByFour) return

    expect(
      fourByFour.data.sessions.map((item) => [item.id, item.event ?? '333']),
    ).toEqual([
      ['session-1', '333'],
      ['session-222', '222'],
      ['session-444', '444'],
    ])
    expect(fourByFour.data.activeSessionId).toBe('session-444')

    const switched = setActiveSession(fourByFour.data, 'session-222')
    expect(switched.activeSessionId).toBe('session-222')
    expect(getActiveSession(switched)?.event).toBe('222')

    const deleted = deleteSession(switched, 'session-222')
    expect(deleted?.activeSessionId).toBe('session-444')
    expect(deleted?.sessions.map((item) => item.id)).toEqual([
      'session-1',
      'session-444',
    ])
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
    expect(next.sessions[0]?.solves).toEqual([
      solve({
        updatedAt: 5,
        fieldUpdates: {
          rawMs: { updatedAt: 1_700_000_000_000, editorId: 'legacy' },
          penalty: { updatedAt: 1_700_000_000_000, editorId: 'legacy' },
          scramble: { updatedAt: 1_700_000_000_000, editorId: 'legacy' },
          comment: { updatedAt: 5, editorId: 'legacy' },
        },
      }),
    ])
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

  it('clears a per-session inspection override back to the global setting', () => {
    const current = data({
      sessions: [
        session(),
        session({
          id: 'session-2',
          name: 'Evening',
          inspectionEnabled: true,
          preferences: {
            inspectionEnabled: true,
            inspectionWarning8s: true,
          },
          fieldUpdates: {
            inspectionEnabled: { updatedAt: 4, editorId: 'laptop' },
            preferences: {
              inspectionEnabled: { updatedAt: 4, editorId: 'laptop' },
              inspectionWarning8s: { updatedAt: 4, editorId: 'laptop' },
            },
          },
        }),
      ],
    })

    const cleared = setSessionInspection(
      current,
      'session-2',
      undefined,
      10,
      'laptop',
    )
    const sessionAfter = cleared.sessions[1]
    expect(sessionAfter?.inspectionEnabled).toBeUndefined()
    expect(sessionAfter?.preferences).toEqual({ inspectionWarning8s: true })
    expect(sessionAfter?.fieldUpdates?.inspectionEnabled).toEqual({
      updatedAt: 10,
      editorId: 'laptop',
    })
    // The legacy preference form is stamped too, so an older boolean cannot
    // resurrect the override from another snapshot.
    expect(
      sessionAfter?.fieldUpdates?.preferences?.inspectionEnabled,
    ).toEqual({ updatedAt: 10, editorId: 'laptop' })
    expect(
      sessionAfter?.fieldUpdates?.preferences?.inspectionWarning8s,
    ).toEqual({ updatedAt: 4, editorId: 'laptop' })

    // Clearing an already-global session is a no-op.
    expect(setSessionInspection(cleared, 'session-2', undefined, 11)).toBe(
      cleared,
    )
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

  it('does not restore a solve into a session with a different event', () => {
    const current = data({
      sessions: [
        session({ id: 'session-1', event: '222' }),
        session({ id: 'session-2', name: 'Three', event: '333' }),
      ],
    })

    expect(
      restoreSolve(current, 'session-1', solve({ event: '333' }), 0),
    ).toBeNull()
    expect(
      restoreSolve(current, 'session-2', solve({ event: '333' }), 0),
    ).not.toBeNull()
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

describe('developer reset', () => {
  it('clears every solve while preserving sessions, preferences and custom events', () => {
    const customEvent = {
      id: 'custom:fto',
      name: 'FTO',
      placeholder: 'No scramble',
      createdAt: 1,
      updatedAt: 1,
    }
    const current: SessionsData = {
      activeSessionId: 'session-2',
      customEvents: [customEvent],
      sessions: [
        session({
          id: 'session-1',
          name: 'Morning',
          event: '333',
          inspectionEnabled: true,
          preferences: { timerUpdateMode: 'tenths' },
          solves: [solve({ id: 'a' }), solve({ id: 'b' })],
        }),
        session({
          id: 'session-2',
          name: 'FTO practice',
          event: customEvent.id,
          preferences: { holdDurationMs: 500 },
          solves: [solve({ id: 'c', event: customEvent.id, scramble: '' })],
        }),
        session({ id: 'session-3', name: 'Empty', event: '222', solves: [] }),
      ],
    }

    const result = clearAllSolves(current, 9_999)
    expect(result.removed.map((entry) => entry.solve.id)).toEqual(['a', 'b', 'c'])
    expect(result.data.activeSessionId).toBe('session-2')
    expect(result.data.customEvents).toEqual([customEvent])
    expect(result.data.sessions.map((entry) => entry.solves)).toEqual([[], [], []])
    expect(result.data.sessions[0]).toMatchObject({
      id: 'session-1',
      name: 'Morning',
      event: '333',
      inspectionEnabled: true,
      preferences: { timerUpdateMode: 'tenths' },
      updatedAt: 9_999,
    })
    expect(result.data.sessions[1]).toMatchObject({
      id: 'session-2',
      name: 'FTO practice',
      event: customEvent.id,
      preferences: { holdDurationMs: 500 },
      updatedAt: 9_999,
    })
    expect(result.data.sessions[2]).toMatchObject({
      id: 'session-3',
      name: 'Empty',
      event: '222',
      updatedAt: 1_700_000_000_000,
    })
  })

  it('leaves an already empty collection unchanged', () => {
    const current = data({ sessions: [session(), session({ id: 'session-2', name: 'Empty' })] })
    expect(clearAllSolves(current, 5)).toEqual({ data: current, removed: [] })
  })
})

describe('session synchronization metadata', () => {
  it('stamps renamed, inspected, event, and preference fields independently', () => {
    const renamed = renameSession(data(), 'session-1', 'Practice', 10, 'laptop')!
    const inspected = setSessionInspection(renamed, 'session-1', true, 20, 'laptop')
    const eventChanged = setSessionEvent(inspected, 'session-1', '222', 30, 'laptop')!
    const preferred = setSessionPreferences(
      eventChanged,
      'session-1',
      { timerUpdateMode: 'seconds', stopWithAnyKey: true },
      40,
      'laptop',
    )

    expect(preferred.sessions[0]?.fieldUpdates).toEqual({
      name: { updatedAt: 10, editorId: 'laptop' },
      inspectionEnabled: { updatedAt: 20, editorId: 'laptop' },
      event: { updatedAt: 30, editorId: 'laptop' },
      preferences: {
        timerUpdateMode: { updatedAt: 40, editorId: 'laptop' },
        stopWithAnyKey: { updatedAt: 40, editorId: 'laptop' },
      },
    })
    expect(preferred.sessions[0]?.updatedAt).toBe(40)
    expect(preferred.sessions[0]?.preferences).toEqual({
      timerUpdateMode: 'seconds',
      stopWithAnyKey: true,
    })
  })

  it('removes a preference override while recording the deletion time', () => {
    const current = setSessionPreferences(
      data(),
      'session-1',
      { inspectionWarning8s: false },
      10,
      'laptop',
    )
    const removed = setSessionPreferences(
      current,
      'session-1',
      { inspectionWarning8s: undefined },
      20,
      'phone',
    )

    expect(removed.sessions[0]?.preferences?.inspectionWarning8s).toBeUndefined()
    expect(removed.sessions[0]?.fieldUpdates?.preferences?.inspectionWarning8s).toEqual({
      updatedAt: 20,
      editorId: 'phone',
    })
  })

  it('does not rewrite metadata when a preference value is unchanged', () => {
    const current = setSessionPreferences(
      data(),
      'session-1',
      { inspectionWarning8s: false },
      10,
      'laptop',
    )
    expect(
      setSessionPreferences(
        current,
        'session-1',
        { inspectionWarning8s: false },
        20,
        'phone',
      ),
    ).toBe(current)
  })
})

describe('deferred external session reconciliation', () => {
  it('adopts the external active session and keeps a solve recorded while timing', () => {
    const baseline = data({
      sessions: [
        session({ solves: [solve({ id: 'old', createdAt: 1_000 })] }),
        session({ id: 'session-2', name: 'Evening' }),
      ],
    })
    const local = data({
      sessions: [
        session({
          solves: [
            solve({ id: 'recorded-while-timing', createdAt: 3_000 }),
            solve({ id: 'old', createdAt: 1_000 }),
          ],
        }),
        session({ id: 'session-2', name: 'Evening' }),
      ],
    })
    const external = data({
      activeSessionId: 'session-2',
      sessions: [
        session({ solves: [solve({ id: 'old', createdAt: 1_000 })] }),
        session({ id: 'session-2', name: 'Evening' }),
      ],
    })

    const reconciled = reconcileExternalSessions({ external, local, baseline })

    expect(reconciled.activeSessionId).toBe('session-2')
    expect(reconciled.sessions[0]?.solves.map((item) => item.id)).toEqual([
      'recorded-while-timing',
      'old',
    ])
    expect(reconciled.sessions[1]?.solves).toEqual([])
  })

  it('does not resurrect a solve deleted by the external collection', () => {
    const baseline = data({
      sessions: [session({ solves: [solve({ id: 'deleted-elsewhere' })] })],
    })
    const local = baseline
    const external = data({
      sessions: [session({ solves: [] })],
    })

    const reconciled = reconcileExternalSessions({ external, local, baseline })

    expect(reconciled.sessions[0]?.solves).toEqual([])
  })

  it('preserves a timing solve if its session was removed externally', () => {
    const baseline = data({
      sessions: [
        session({ id: 'session-1', name: 'Morning' }),
        session({ id: 'session-2', name: 'Evening' }),
      ],
    })
    const local = data({
      sessions: [
        session({
          id: 'session-1',
          name: 'Morning',
          solves: [solve({ id: 'recorded-while-timing' })],
        }),
        session({ id: 'session-2', name: 'Evening' }),
      ],
    })
    const external = data({
      activeSessionId: 'session-2',
      sessions: [session({ id: 'session-2', name: 'Evening' })],
    })

    const reconciled = reconcileExternalSessions({ external, local, baseline })
    const recovered = reconciled.sessions.find(
      (item) => item.id === 'recovered:session-1',
    )

    expect(reconciled.activeSessionId).toBe('session-2')
    expect(recovered?.name).toBe('Morning (recovered)')
    expect(recovered?.solves.map((item) => item.id)).toEqual([
      'recorded-while-timing',
    ])
  })

  it('does not mix an added solve into an externally reclassified session', () => {
    const baseline = data()
    const local = data({
      sessions: [session({ solves: [solve({ id: 'recorded-before-reclass' })] })],
    })
    const external = data({
      sessions: [session({ event: '222', solves: [] })],
    })

    const reconciled = reconcileExternalSessions({ external, local, baseline })

    expect(
      reconciled.sessions.find((item) => item.id === 'session-1'),
    ).toMatchObject({ event: '222', solves: [] })
    const recovered = reconciled.sessions.find(
      (item) => item.id === 'recovered:session-1',
    )
    expect(recovered).toMatchObject({ event: '333' })
    expect(recovered?.solves.map((item) => item.id)).toEqual([
      'recorded-before-reclass',
    ])
  })

  it('returns the external collection unchanged when nothing was recorded', () => {
    const baseline = data()
    const external = data({
      activeSessionId: 'session-2',
      sessions: [
        session(),
        session({ id: 'session-2', name: 'Evening' }),
      ],
    })

    const reconciled = reconcileExternalSessions({
      external,
      local: baseline,
      baseline,
    })

    expect(reconciled).toBe(external)
  })
})

describe('session ordering', () => {
  const three = () =>
    data({
      activeSessionId: 'b',
      sessions: [
        session({ id: 'a', name: 'A', createdAt: 1 }),
        session({
          id: 'b',
          name: 'B',
          createdAt: 2,
          solves: [solve({ id: 'solve-b', event: '333' })],
        }),
        session({ id: 'c', name: 'C', createdAt: 3 }),
      ],
    })

  it('moves sessions, keeps the active selection and solve data intact', () => {
    const moved = moveSession(three(), 'c', -1, 50, 'laptop')
    expect(moved.sessions.map((entry) => entry.id)).toEqual(['a', 'c', 'b'])
    expect(moved.activeSessionId).toBe('b')
    expect(moved.sessions.find((entry) => entry.id === 'b')?.solves).toHaveLength(1)
    expect(moved.sessionOrder).toEqual({
      ids: ['a', 'c', 'b'],
      updatedAt: 50,
      editorId: 'laptop',
    })
    expect(moveSession(moved, 'a', -1, 60)).toBe(moved)
  })

  it('moves a session to an explicit final position without changing identity', () => {
    const moved = moveSessionTo(three(), 'c', 0, 50, 'laptop')
    expect(moved.sessions.map((entry) => entry.id)).toEqual(['c', 'a', 'b'])
    expect(moved.activeSessionId).toBe('b')
    expect(moved.sessions.find((entry) => entry.id === 'b')?.solves).toHaveLength(1)
    expect(moved.sessionOrder).toEqual({
      ids: ['c', 'a', 'b'],
      updatedAt: 50,
      editorId: 'laptop',
    })

    expect(moveSessionTo(moved, 'c', 0, 60)).toBe(moved)
    expect(moveSessionTo(moved, 'c', 99, 70).sessionOrder?.ids).toEqual([
      'a',
      'b',
      'c',
    ])
    expect(moveSessionTo(moved, 'c', -4, 80).sessionOrder?.ids).toEqual([
      'c',
      'a',
      'b',
    ])
    expect(moveSessionTo(moved, 'missing', 0, 90)).toBe(moved)
  })

  it('preserves stored array order before the first explicit reorder', () => {
    const legacy = data({
      sessions: [
        session({ id: 'later-created', name: 'Import rank 1', createdAt: 99 }),
        session({ id: 'earlier-created', name: 'Import rank 2', createdAt: 1 }),
      ],
    })
    expect(getOrderedSessions(legacy).map((entry) => entry.id)).toEqual([
      'later-created',
      'earlier-created',
    ])
  })

  it('appends sessions that are missing from ordering metadata', () => {
    const ordered = getOrderedSessions(
      data({
        sessionOrder: { ids: ['c'], updatedAt: 1, editorId: 'x' },
        sessions: [
          session({ id: 'a', name: 'A', createdAt: 1 }),
          session({ id: 'b', name: 'B', createdAt: 2 }),
          session({ id: 'c', name: 'C', createdAt: 3 }),
        ],
      }),
    )
    expect(ordered.map((entry) => entry.id)).toEqual(['c', 'a', 'b'])
  })

  it('converges concurrent reorders and additions without losing sessions', () => {
    const sessions = three().sessions
    const local = { ids: ['b', 'a', 'c'], updatedAt: 10, editorId: 'a' }
    const remote = { ids: ['c', 'b'], updatedAt: 20, editorId: 'b' }
    const resolved = resolveSessionOrdering(local, remote, sessions)
    expect(resolved?.ids).toEqual(['c', 'b', 'a'])
    expect(resolveSessionOrdering(local, remote, sessions)).toEqual(resolved)

    const tieA = resolveSessionOrdering(
      { ids: ['a', 'b', 'c'], updatedAt: 10, editorId: 'a' },
      { ids: ['c', 'b', 'a'], updatedAt: 10, editorId: 'b' },
      sessions,
    )
    const tieB = resolveSessionOrdering(
      { ids: ['c', 'b', 'a'], updatedAt: 10, editorId: 'b' },
      { ids: ['a', 'b', 'c'], updatedAt: 10, editorId: 'a' },
      sessions,
    )
    expect(tieA).toEqual(tieB)
    expect(tieA?.ids).toHaveLength(3)
  })

  it('retains imported tail order in the ordering record', () => {
    const current = three()
    const imported = [
      session({ id: 'imp-1', name: 'Import 1', createdAt: 4 }),
      session({ id: 'imp-2', name: 'Import 2', createdAt: 5 }),
    ]
    const next = appendSessionsInOrder(current, imported, 70, 'import')
    expect(next.sessionOrder?.ids).toEqual(['a', 'b', 'c', 'imp-1', 'imp-2'])
  })
})

describe('session event reassignment with solves', () => {
  it('updates the session and every solve without changing values', () => {
    const originalSolve = solve({
      id: 'solve-x',
      rawMs: 12_345,
      penalty: '+2',
      scramble: 'Original scramble',
      comment: 'keep me',
      createdAt: 123,
      importSource: {
        provider: 'cstimer',
        scrType: '333',
        sessionNumber: 1,
        solveIndex: 2,
      },
    })
    const reassigned = reassignSessionsEvent(
      data({ sessions: [session({ solves: [originalSolve] })] }),
      ['session-1'],
      '222',
      99,
      'laptop',
    )
    expect(reassigned?.sessions[0]?.event).toBe('222')
    expect(reassigned?.sessions[0]?.fieldUpdates?.event).toEqual({
      updatedAt: 99,
      editorId: 'laptop',
    })
    const nextSolve = reassigned?.sessions[0]?.solves[0]
    expect(nextSolve).toMatchObject({
      id: 'solve-x',
      event: '222',
      rawMs: 12_345,
      penalty: '+2',
      scramble: 'Original scramble',
      comment: 'keep me',
      createdAt: 123,
      importSource: originalSolve.importSource,
    })
    expect(nextSolve?.fieldUpdates?.event).toEqual({
      updatedAt: 99,
      editorId: 'laptop',
    })
  })
})

describe('delete all sessions', () => {
  it('creates exactly one empty default session and preserves custom events', () => {
    const customEvents = [
      {
        id: 'custom:fto',
        name: 'FTO',
        placeholder: '',
        createdAt: 1,
        updatedAt: 1,
      },
    ]
    const next = deleteAllSessions(
      data({
        sessions: [
          session({ id: 'a', name: 'Session 1', solves: [solve()] }),
          session({ id: 'b', name: 'Morning', solves: [solve({ id: 's2' })] }),
        ],
        customEvents,
      }),
      500,
      'laptop',
    )
    expect(next.sessions).toHaveLength(1)
    expect(next.sessions[0]).toMatchObject({
      name: DEFAULT_SESSION_NAME,
      event: '333',
      solves: [],
      isAutoCreatedDefault: true,
      createdAt: 500,
      updatedAt: 500,
    })
    expect(next.activeSessionId).toBe(next.sessions[0]?.id)
    expect(next.customEvents).toEqual(customEvents)
    expect(next.sessionOrder).toEqual({
      ids: [next.sessions[0]?.id],
      updatedAt: 500,
      editorId: 'laptop',
    })
    expect(countSolves(next.sessions)).toBe(0)
  })

  it('creates the default session from an empty collection too', () => {
    const next = deleteAllSessions(
      { activeSessionId: '', sessions: [] },
      600,
      'laptop',
    )
    expect(next.sessions).toHaveLength(1)
    expect(next.sessions[0]?.name).toBe(DEFAULT_SESSION_NAME)
    expect(next.activeSessionId).toBe(next.sessions[0]?.id)
  })
})

describe('session summary', () => {
  it('matches csTimer completed/total and sum semantics', () => {
    const summary = getSessionSummary([
      solve({ id: 'a', rawMs: 10_000, penalty: 'none' }),
      solve({ id: 'b', rawMs: 11_000, penalty: '+2' }),
      solve({ id: 'c', rawMs: 12_000, penalty: 'dnf' }),
    ])
    expect(summary).toEqual({
      completed: 2,
      total: 3,
      totalTimeMs: 23_000,
    })
    expect(getSessionSummary([])).toEqual({
      completed: 0,
      total: 0,
      totalTimeMs: 0,
    })
  })

  it('uses the shared recorded-result precision for the sum', () => {
    expect(
      getSessionSummary([
        solve({ id: 'a', rawMs: 12_345, penalty: 'none' }),
        solve({ id: 'b', rawMs: 12_345, penalty: '+2' }),
      ]),
    ).toEqual({
      completed: 2,
      total: 2,
      totalTimeMs: 12_340 + 14_340,
    })
  })
})

describe('merging sessions', () => {
  const imported = solve({
    id: 'imported',
    rawMs: 11_111,
    penalty: '+2',
    scramble: 'Imported scramble',
    comment: 'Keep this',
    createdAt: 1_000,
    importSource: {
      provider: 'cstimer',
      scrType: '333',
      scrTypeSource: 'explicit',
      sessionNumber: 4,
      solveIndex: 7,
    },
  })

  function mergeFixture(): SessionsData {
    return data({
      activeSessionId: 'source-empty',
      sessions: [
        session({
          id: 'destination',
          name: 'Destination',
          event: '333',
          createdAt: 100,
          updatedAt: 100,
          inspectionEnabled: true,
          preferences: { holdDurationMs: 450, timerUpdateMode: 'tenths' },
          solves: [
            solve({ id: 'dest-old', rawMs: 9_000, createdAt: 1_000 }),
          ],
        }),
        session({
          id: 'source-main',
          name: 'Source main',
          event: '333',
          createdAt: 200,
          updatedAt: 200,
          solves: [
            solve({ id: 'tie-b', rawMs: 12_000, createdAt: 2_000 }),
            solve({ id: 'tie-a', rawMs: 13_000, createdAt: 2_000 }),
            imported,
          ],
        }),
        session({
          id: 'source-empty',
          name: 'Source empty',
          event: '333',
          createdAt: 300,
          updatedAt: 300,
          solves: [],
        }),
        session({
          id: 'unrelated',
          name: 'Unrelated',
          event: '333',
          createdAt: 400,
          updatedAt: 400,
          solves: [solve({ id: 'unrelated-solve' })],
        }),
      ],
      sessionOrder: {
        ids: ['destination', 'source-main', 'source-empty', 'unrelated'],
        updatedAt: 50,
        editorId: 'seed',
      },
    })
  }

  it('merges multiple sources into the destination without changing destination metadata or solve fields', () => {
    const current = mergeFixture()
    const merged = mergeSessions(
      current,
      'destination',
      ['source-main', 'source-empty'],
      500,
    )
    expect(merged).not.toBeNull()
    if (!merged) return

    expect(merged.activeSessionId).toBe('destination')
    expect(merged.sessions.map((entry) => entry.id)).toEqual([
      'destination',
      'unrelated',
    ])
    expect(merged.sessionOrder).toEqual({
      ids: ['destination', 'unrelated'],
      updatedAt: 50,
      editorId: 'seed',
    })
    const destination = merged.sessions.find(
      (entry) => entry.id === 'destination',
    )
    expect(destination).toMatchObject({
      name: 'Destination',
      event: '333',
      inspectionEnabled: true,
      preferences: { holdDurationMs: 450, timerUpdateMode: 'tenths' },
      updatedAt: 500,
    })
    // Newest first; equal timestamps use descending stable IDs.
    expect(destination?.solves.map((entry) => entry.id)).toEqual([
      'tie-b',
      'tie-a',
      'imported',
      'dest-old',
    ])
    expect(destination?.solves.find((entry) => entry.id === 'imported')).toEqual(
      imported,
    )
    expect(getSessionSummary(destination?.solves ?? []).total).toBe(4)
    expect(
      filterAnalyticsSolves(
        merged.sessions,
        createAnalyticsFilters('all'),
        0,
      ),
    ).toHaveLength(5)
    expect(buildTrendData(destination?.solves ?? [], [3])).toHaveLength(4)
  })

  it('keeps empty sources mergeable and rejects incompatible or missing sessions', () => {
    const current = mergeFixture()
    expect(
      mergeSessions(current, 'destination', ['source-empty'], 500)?.sessions,
    ).toHaveLength(3)
    expect(mergeSessions(current, 'destination', [], 500)).toBeNull()
    expect(mergeSessions(current, 'missing', ['source-main'], 500)).toBeNull()
    expect(
      mergeSessions(current, 'destination', ['missing'], 500),
    ).toBeNull()
    expect(
      mergeSessions(current, 'destination', ['destination'], 500),
    ).toBeNull()

    const incompatible = {
      ...current,
      sessions: current.sessions.map((entry) =>
        entry.id === 'source-main'
          ? {
              ...entry,
              event: '222',
              solves: entry.solves.map((item) => ({
                ...item,
                event: '222',
              })),
            }
          : entry,
      ),
    }
    expect(
      mergeSessions(incompatible, 'destination', ['source-main'], 500),
    ).toBeNull()
    expect(
      getSessionMergeError(incompatible, 'destination', ['source-main']),
    ).toMatch(/same event/i)
  })

  it('merges and then splits a 10,000-solve history without losing or duplicating IDs', () => {
    const targetSolves = Array.from({ length: 5_000 }, (_, index) =>
      solve({
        id: `target-${index}`,
        createdAt: 1_000_000 - index,
      }),
    )
    const sourceSolves = Array.from({ length: 5_000 }, (_, index) =>
      solve({
        id: `source-${index}`,
        createdAt: 1_000_000 - index - 5_000,
      }),
    )
    const current = data({
      sessions: [
        session({
          id: 'target',
          name: 'Large target',
          solves: targetSolves,
        }),
        session({
          id: 'source',
          name: 'Large source',
          solves: sourceSolves,
        }),
      ],
      sessionOrder: {
        ids: ['target', 'source'],
        updatedAt: 1,
        editorId: 'bulk',
      },
    })
    const merged = mergeSessions(current, 'target', ['source'], 2_000)
    expect(merged?.sessions).toHaveLength(1)
    const mergedSolves = merged?.sessions[0]?.solves ?? []
    expect(mergedSolves).toHaveLength(10_000)
    expect(new Set(mergedSolves.map((entry) => entry.id)).size).toBe(10_000)

    const movedIds = mergedSolves.slice(0, 5_000).map((entry) => entry.id)
    const split = splitSession(
      merged!,
      'target',
      'Large split',
      movedIds,
      { id: 'large-split', now: 3_000, editorId: 'bulk' },
    )
    expect(split).not.toBeNull()
    if (!split) return
    expect(
      split.data.sessions.find((entry) => entry.id === 'target')?.solves,
    ).toHaveLength(5_000)
    expect(
      split.data.sessions.find((entry) => entry.id === 'large-split')?.solves,
    ).toHaveLength(5_000)
    expect(countSolves(split.data.sessions)).toBe(10_000)
    expect(
      new Set(
        split.data.sessions.flatMap((entry) =>
          entry.solves.map((solveEntry) => solveEntry.id),
        ),
      ).size,
    ).toBe(10_000)
  })

  it('keeps custom event identities isolated and deduplicates identical solve IDs', () => {
    const shared = solve({ id: 'shared', event: 'custom:fto', createdAt: 10 })
    const current = data({
      activeSessionId: 'custom-a',
      sessions: [
        session({
          id: 'custom-a',
          name: 'Custom A',
          event: 'custom:fto',
          solves: [shared],
        }),
        session({
          id: 'custom-b',
          name: 'Custom B',
          event: 'custom:fto',
          solves: [
            shared,
            solve({ id: 'custom-only', event: 'custom:fto', createdAt: 20 }),
          ],
        }),
        session({ id: 'other', name: 'Other custom', event: 'custom:other' }),
      ],
    })
    const merged = mergeSessions(current, 'custom-a', ['custom-b'], 30)
    expect(merged?.sessions[0]?.solves.map((entry) => entry.id)).toEqual([
      'custom-only',
      'shared',
    ])
    expect(
      mergeSessions(current, 'custom-a', ['other'], 30),
    ).toBeNull()
  })
})

describe('splitting sessions', () => {
  function splitFixture(): SessionsData {
    return data({
      activeSessionId: 'source',
      sessions: [
        session({
          id: 'before',
          name: 'Before',
          event: '333',
          createdAt: 1,
        }),
        session({
          id: 'source',
          name: 'Long source name',
          event: 'custom:fto',
          createdAt: 2,
          updatedAt: 2,
          inspectionEnabled: false,
          preferences: {
            timerUpdateMode: 'tenths',
            holdDurationMs: 500,
            inspectionWarning8s: true,
          },
          solves: [
            solve({
              id: 'newest',
              event: 'custom:fto',
              rawMs: 8_000,
              comment: 'Newest comment',
              createdAt: 5_000,
            }),
            solve({
              id: 'middle',
              event: 'custom:fto',
              rawMs: 9_000,
              penalty: '+2',
              scramble: 'Middle scramble',
              createdAt: 4_000,
            }),
            solve({
              id: 'oldest',
              event: 'custom:fto',
              rawMs: 10_000,
              penalty: 'dnf',
              createdAt: 3_000,
            }),
          ],
        }),
        session({
          id: 'after',
          name: 'After',
          event: '333',
          createdAt: 3,
        }),
      ],
      sessionOrder: {
        ids: ['before', 'source', 'after'],
        updatedAt: 10,
        editorId: 'seed',
      },
    })
  }

  it('moves selected solves into a new ordered session and copies the source settings', () => {
    const current = splitFixture()
    const result = splitSession(
      current,
      'source',
      '  Morning split  ',
      ['middle', 'oldest'],
      { id: 'split-session', now: 1_000, editorId: 'laptop' },
    )
    expect(result).not.toBeNull()
    if (!result) return

    expect(result.sessionId).toBe('split-session')
    expect(result.data.activeSessionId).toBe('split-session')
    expect(getOrderedSessions(result.data).map((entry) => entry.id)).toEqual([
      'before',
      'source',
      'split-session',
      'after',
    ])
    expect(result.data.sessionOrder).toEqual({
      ids: ['before', 'source', 'split-session', 'after'],
      updatedAt: 1_000,
      editorId: 'laptop',
    })
    const source = result.data.sessions.find((entry) => entry.id === 'source')
    const moved = result.data.sessions.find(
      (entry) => entry.id === 'split-session',
    )
    expect(source?.solves.map((entry) => entry.id)).toEqual(['newest'])
    expect(moved).toMatchObject({
      id: 'split-session',
      name: 'Morning split',
      event: 'custom:fto',
      createdAt: 1_000,
      updatedAt: 1_000,
      inspectionEnabled: false,
      preferences: {
        timerUpdateMode: 'tenths',
        holdDurationMs: 500,
        inspectionWarning8s: true,
      },
    })
    expect(moved?.solves.map((entry) => entry.id)).toEqual(['middle', 'oldest'])
    expect(moved?.solves[0]).toMatchObject({
      rawMs: 9_000,
      penalty: '+2',
      scramble: 'Middle scramble',
      createdAt: 4_000,
    })
    expect(result.data.sessionTransfers).toEqual([
      expect.objectContaining({
        fromSessionId: 'source',
        toSessionId: 'split-session',
        solveIds: ['middle', 'oldest'],
        transferredAt: 1_000,
        byDeviceId: 'laptop',
      }),
    ])
    expect(getSessionSummary(moved?.solves ?? []).total).toBe(2)
    expect(getSessionSummary(source?.solves ?? []).total).toBe(1)
  })

  it('retains an emptied source and supports splitting every solve without an order record', () => {
    const current = splitFixture()
    const { sessionOrder: _order, ...withoutOrder } = current
    const result = splitSession(
      withoutOrder,
      'source',
      'Everything moved',
      ['newest', 'middle', 'oldest'],
      { id: 'all-moved', now: 2_000, editorId: 'phone' },
    )
    expect(result).not.toBeNull()
    if (!result) return

    expect(result.data.sessions.map((entry) => entry.id)).toEqual([
      'before',
      'source',
      'all-moved',
      'after',
    ])
    expect(
      result.data.sessions.find((entry) => entry.id === 'source')?.solves,
    ).toEqual([])
    expect(
      result.data.sessions.find((entry) => entry.id === 'all-moved')?.solves,
    ).toHaveLength(3)
    expect(result.data.sessionOrder).toBeUndefined()
  })

  it('rejects invalid names, duplicate IDs, empty selections and unknown solves', () => {
    const current = splitFixture()
    expect(
      splitSession(current, 'source', 'Before', ['newest'], {
        id: 'x',
        now: 1,
      }),
    ).toBeNull()
    expect(
      splitSession(current, 'source', 'New', ['newest', 'newest'], {
        id: 'x',
        now: 1,
      }),
    ).toBeNull()
    expect(
      splitSession(current, 'source', 'New', ['newest', 'missing'], {
        id: 'x',
        now: 1,
      }),
    ).toBeNull()
    expect(
      splitSession(current, 'source', 'New', [], { id: 'x', now: 1 }),
    ).toBeNull()
    expect(
      splitSession(current, 'missing', 'New', ['newest'], {
        id: 'x',
        now: 1,
      }),
    ).toBeNull()
    expect(
      splitSession(current, 'source', 'New', ['newest'], {
        id: 'source',
        now: 1,
      }),
    ).toBeNull()
  })

  it('preserves transfer metadata when an external collection is adopted', () => {
    const transfer = {
      id: 'transfer-1',
      fromSessionId: 'source',
      toSessionId: 'split-session',
      solveIds: ['newest'],
      transferredAt: 1_000,
      byDeviceId: 'laptop',
    }
    const external = data({
      sessions: [session({ id: 'source', name: 'Source' })],
      sessionTransfers: [transfer],
    })
    const local = data({
      sessions: [session({ id: 'source', name: 'Source' })],
      sessionTransfers: [
        {
          ...transfer,
          id: 'transfer-2',
          solveIds: ['middle'],
        },
      ],
    })

    const reconciled = reconcileExternalSessions({
      external,
      local,
      baseline: external,
    })
    expect(reconciled.sessionTransfers?.map((entry) => entry.id).sort()).toEqual([
      'transfer-1',
      'transfer-2',
    ])
  })
})
