import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { SessionsData, Solve } from '../types'
import {
  loadSessions,
  saveSessions,
  SESSIONS_STORAGE_KEY,
} from '../lib/storage'
import {
  beginReplacement,
  clearReplacementJournal,
  markReplacementCommitted,
} from '../lib/replacement'
import {
  loadPendingCompletion,
  recordPendingCompletion,
} from '../lib/pendingCompletion'
import { useSessions } from './useSessions'

const NOW = new Date(2026, 10, 7, 12).getTime()

function solve(overrides: Partial<Solve> = {}): Solve {
  return {
    id: 'solve-a',
    event: '333',
    rawMs: 12_000,
    penalty: 'none',
    scramble: "R U R' U'",
    comment: '',
    createdAt: NOW,
    ...overrides,
  }
}

function sessionsData(): SessionsData {
  return {
    activeSessionId: 'session-1',
    sessions: [
      {
        id: 'session-1',
        name: 'Main',
        event: '333',
        createdAt: NOW,
        updatedAt: NOW,
        solves: [solve()],
      },
    ],
  }
}

describe('useSessions durable solve deletion', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('does not publish a deletion when the session collection cannot be saved', () => {
    const initial = sessionsData()
    saveSessions(initial)
    const { result } = renderHook(() => useSessions())

    const original = Storage.prototype.setItem
    const spy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(function setItem(this: Storage, key, value) {
        if (key === SESSIONS_STORAGE_KEY) {
          throw new DOMException('Quota exceeded', 'QuotaExceededError')
        }
        return original.call(this, key, value)
      })
    try {
      let removed: ReturnType<typeof result.current.deleteSolve> = null
      act(() => {
        removed = result.current.deleteSolve('solve-a')
      })

      expect(removed).toBeNull()
      expect(result.current.sessions[0]?.solves).toHaveLength(1)
      expect(result.current.storageOk).toBe(false)
      expect(loadSessions().sessions[0]?.solves).toHaveLength(1)
    } finally {
      spy.mockRestore()
    }
  })

  it('clears only the active session after the empty collection is durable', () => {
    const initial: SessionsData = {
      activeSessionId: 'session-1',
      sessions: [
        {
          ...sessionsData().sessions[0]!,
          solves: [solve({ id: 'clear-a' }), solve({ id: 'clear-b' })],
        },
        {
          id: 'session-2',
          name: 'Other',
          event: '333',
          createdAt: NOW,
          updatedAt: NOW,
          solves: [solve({ id: 'keep-other' })],
        },
      ],
    }
    saveSessions(initial)
    const { result } = renderHook(() => useSessions())

    let cleared: unknown = false
    act(() => {
      cleared = result.current.clearSolves()
    })

    expect(cleared).toBe(true)
    expect(result.current.sessions[0]?.solves).toEqual([])
    expect(result.current.sessions[1]?.solves.map((item) => item.id)).toEqual([
      'keep-other',
    ])
    const disk = loadSessions()
    expect(disk.sessions[0]?.solves).toEqual([])
    expect(disk.sessions[1]?.solves.map((item) => item.id)).toEqual([
      'keep-other',
    ])
  })

  it('does not publish a cleared session when the empty collection cannot be saved', () => {
    const initial = sessionsData()
    saveSessions(initial)
    const { result } = renderHook(() => useSessions())

    const original = Storage.prototype.setItem
    const spy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(function setItem(this: Storage, key, value) {
        if (key === SESSIONS_STORAGE_KEY) {
          throw new DOMException('Quota exceeded', 'QuotaExceededError')
        }
        return original.call(this, key, value)
      })
    try {
      let cleared: unknown = true
      act(() => {
        cleared = result.current.clearSolves()
      })

      expect(cleared).toBe(false)
      expect(result.current.sessions[0]?.solves.map((item) => item.id)).toEqual([
        'solve-a',
      ])
      expect(result.current.storageOk).toBe(false)
      expect(loadSessions().sessions[0]?.solves.map((item) => item.id)).toEqual([
        'solve-a',
      ])
    } finally {
      spy.mockRestore()
    }
  })
})

describe('useSessions staged replacements', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('saves a replacement without publishing React state', () => {
    const initial = sessionsData()
    saveSessions(initial)
    const { result } = renderHook(() => useSessions())
    const next: SessionsData = {
      activeSessionId: 'session-2',
      sessions: [
        {
          id: 'session-2',
          name: 'Imported',
          event: '222',
          createdAt: NOW,
          updatedAt: NOW,
          solves: [solve({ id: 'solve-b', event: '222' })],
        },
      ],
    }

    let staged = false
    act(() => {
      staged = result.current.stageSessions(next)
    })

    expect(staged).toBe(true)
    expect(result.current.sessions.map((session) => session.id)).toEqual([
      'session-1',
    ])
    expect(loadSessions().sessions.map((session) => session.id)).toEqual([
      'session-2',
    ])
    expect(loadSessions().activeSessionId).toBe('session-2')
  })

  it('buffers an accepted solve instead of overwriting a prepared replacement', () => {
    const initial = sessionsData()
    saveSessions(initial)
    const { result } = renderHook(() => useSessions())
    const begun = beginReplacement('native-import', ['sessions'])
    expect(begun.ok).toBe(true)
    if (!begun.ok) return
    const staged: SessionsData = {
      activeSessionId: 'session-2',
      sessions: [
        {
          id: 'session-2',
          name: 'Staged candidate',
          event: '222',
          createdAt: NOW,
          updatedAt: NOW,
          solves: [],
        },
      ],
    }
    saveSessions(staged)

    act(() => {
      result.current.addSolve(
        {
          rawMs: 9_876,
          penalty: 'none',
          scramble: "F R U'",
        },
        '333',
      )
    })

    expect(result.current.activeSession.solves.map((entry) => entry.rawMs)).toEqual([
      9_876,
      12_000,
    ])
    expect(loadSessions()).toEqual(staged)
    const pending = loadPendingCompletion()
    expect(pending.status).toBe('ok')
    if (pending.status !== 'ok') return
    expect(pending.completion.entries[0]?.solves).toEqual([
      expect.objectContaining({ rawMs: 9_876, event: '333' }),
    ])
    expect(clearReplacementJournal()).toBe(true)
  })

  it('keeps an unrelated buffered completion after an ordinary successful save', () => {
    const initial = sessionsData()
    saveSessions(initial)
    const { result } = renderHook(() => useSessions())
    const buffered = {
      ...initial,
      sessions: [
        {
          ...initial.sessions[0]!,
          solves: [solve({ id: 'buffered-A' }), ...initial.sessions[0]!.solves],
        },
      ],
    }
    expect(recordPendingCompletion(initial, buffered)).toBe(true)

    act(() => {
      expect(result.current.renameSession('session-1', 'Renamed')).toBe(true)
    })

    expect(loadSessions().sessions[0]?.name).toBe('Renamed')
    const pending = loadPendingCompletion()
    expect(pending.status).toBe('ok')
    if (pending.status !== 'ok') return
    expect(
      pending.completion.entries.flatMap((entry) =>
        entry.solves.map((solve) => solve.id),
      ),
    ).toContain('buffered-A')
  })

  it('does not erase a follower completion when publishing a committed candidate', () => {
    const initial = sessionsData()
    saveSessions(initial)
    const { result } = renderHook(() => useSessions())
    const begun = beginReplacement('native-import', ['sessions'])
    expect(begun.ok).toBe(true)
    if (!begun.ok) return
    const candidate: SessionsData = {
      activeSessionId: 'session-2',
      sessions: [
        {
          id: 'session-2',
          name: 'Imported A',
          event: '333',
          createdAt: NOW,
          updatedAt: NOW,
          solves: [],
        },
      ],
    }
    act(() => {
      expect(result.current.stageSessions(candidate)).toBe(true)
    })
    const buffered = {
      ...initial,
      sessions: [
        {
          ...initial.sessions[0]!,
          solves: [solve({ id: 'buffered-A' })],
        },
      ],
    }
    expect(recordPendingCompletion(initial, buffered)).toBe(true)
    expect(markReplacementCommitted(begun.journal)).toBe(true)

    act(() => {
      result.current.replaceSessions(candidate)
    })

    const diskIds = loadSessions().sessions.flatMap((session) =>
      session.solves.map((entry) => entry.id),
    )
    const pending = loadPendingCompletion()
    const bufferedIds =
      pending.status === 'ok'
        ? pending.completion.entries.flatMap((entry) =>
            entry.solves.map((entry) => entry.id),
          )
        : []
    expect([...diskIds, ...bufferedIds]).toContain('buffered-A')
    expect(clearReplacementJournal()).toBe(true)
  })

  it('reports a failed stage without changing the visible collection', () => {
    const initial = sessionsData()
    saveSessions(initial)
    const { result } = renderHook(() => useSessions())
    const original = Storage.prototype.setItem
    const spy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(function setItem(this: Storage, key, value) {
        if (key === SESSIONS_STORAGE_KEY) {
          throw new DOMException('Quota exceeded', 'QuotaExceededError')
        }
        return original.call(this, key, value)
      })
    try {
      let staged = true
      act(() => {
        staged = result.current.stageSessions({
          ...initial,
          activeSessionId: 'session-2',
          sessions: [
            {
              ...initial.sessions[0]!,
              id: 'session-2',
              name: 'Imported',
            },
          ],
        })
      })
      expect(staged).toBe(false)
      expect(result.current.sessions.map((session) => session.id)).toEqual([
        'session-1',
      ])
      expect(loadSessions().sessions.map((session) => session.id)).toEqual([
        'session-1',
      ])
    } finally {
      spy.mockRestore()
    }
  })
})
