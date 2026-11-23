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

function twoSessionsData(): SessionsData {
  return {
    activeSessionId: 'session-1',
    sessions: [
      sessionsData().sessions[0]!,
      {
        id: 'session-2',
        name: 'Other',
        event: '333',
        createdAt: NOW + 1,
        updatedAt: NOW + 1,
        solves: [solve({ id: 'solve-b', createdAt: NOW + 1 })],
      },
    ],
  }
}

describe('useSessions durable solve edits', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('persists a trimmed comment before reporting success', () => {
    const initial = sessionsData()
    saveSessions(initial)
    const { result } = renderHook(() => useSessions())

    let saved = false
    act(() => {
      saved = result.current.setComment('solve-a', 'Durable note')
    })

    expect(saved).toBe(true)
    expect(result.current.sessions[0]?.solves[0]?.comment).toBe('Durable note')
    expect(loadSessions().sessions[0]?.solves[0]?.comment).toBe('Durable note')
  })

  it('does not report a comment saved when a prepared replacement only holds another buffered solve', () => {
    const initial = sessionsData()
    saveSessions(initial)
    const { result } = renderHook(() => useSessions())
    const buffered = {
      ...initial,
      sessions: [
        {
          ...initial.sessions[0]!,
          solves: [
            solve({ id: 'buffered-A', createdAt: NOW + 1 }),
            ...initial.sessions[0]!.solves,
          ],
        },
      ],
    }
    expect(recordPendingCompletion(initial, buffered)).toBe(true)
    const begun = beginReplacement('native-import', ['sessions'])
    expect(begun.ok).toBe(true)
    if (!begun.ok) return

    let saved = true
    act(() => {
      saved = result.current.setComment('solve-a', 'Pending note')
    })

    expect(saved).toBe(false)
    expect(result.current.sessions[0]?.solves[0]?.comment).toBe('')
    expect(loadSessions().sessions[0]?.solves[0]?.comment).toBe('')
    const pending = loadPendingCompletion()
    expect(pending.status).toBe('ok')
    if (pending.status !== 'ok') return
    expect(
      pending.completion.entries.flatMap((entry) =>
        entry.solves.map((solve) => solve.id),
      ),
    ).toEqual(['buffered-A'])

    expect(clearReplacementJournal()).toBe(true)
    act(() => {
      saved = result.current.setComment('solve-a', 'Pending note')
    })
    expect(saved).toBe(true)
    expect(loadSessions().sessions[0]?.solves[0]?.comment).toBe('Pending note')
  })

  it('does not let a newly buffered solve make an older comment look saved', () => {
    const initial = sessionsData()
    saveSessions(initial)
    const { result } = renderHook(() => useSessions())
    const begun = beginReplacement('native-import', ['sessions'])
    expect(begun.ok).toBe(true)
    if (!begun.ok) return

    let newlyTimedId = ''
    act(() => {
      newlyTimedId = result.current.addSolve(
        { rawMs: 9_876, penalty: 'none', scramble: "F R U'" },
        '333',
      ).id
    })
    expect(newlyTimedId).not.toBe('')

    let saved = true
    act(() => {
      saved = result.current.setComment('solve-a', 'Pending note')
    })

    expect(saved).toBe(false)
    expect(
      result.current.sessions[0]?.solves.find((entry) => entry.id === 'solve-a')
        ?.comment,
    ).toBe('')
    expect(
      loadSessions().sessions[0]?.solves.find((entry) => entry.id === 'solve-a')
        ?.comment,
    ).toBe('')
    const pending = loadPendingCompletion()
    expect(pending.status).toBe('ok')
    if (pending.status !== 'ok') return
    const pendingIds = pending.completion.entries.flatMap((entry) =>
      entry.solves.map((solve) => solve.id),
    )
    expect(pendingIds).toEqual([newlyTimedId])
    expect(pendingIds).not.toContain('solve-a')

    expect(clearReplacementJournal()).toBe(true)
    act(() => {
      saved = result.current.setComment('solve-a', 'Pending note')
    })
    expect(saved).toBe(true)
    expect(
      loadSessions().sessions[0]?.solves.find((entry) => entry.id === 'solve-a')
        ?.comment,
    ).toBe('Pending note')
  })

  it('updates the completion buffer when the comment belongs to a newly timed solve', () => {
    const initial = sessionsData()
    saveSessions(initial)
    const { result } = renderHook(() => useSessions())
    const begun = beginReplacement('native-import', ['sessions'])
    expect(begun.ok).toBe(true)
    if (!begun.ok) return

    let newlyTimedId = ''
    act(() => {
      newlyTimedId = result.current.addSolve(
        { rawMs: 9_876, penalty: 'none', scramble: "F R U'" },
        '333',
      ).id
    })
    let saved = false
    act(() => {
      saved = result.current.setComment(newlyTimedId, 'Buffered note')
    })

    expect(saved).toBe(true)
    const pending = loadPendingCompletion()
    expect(pending.status).toBe('ok')
    if (pending.status !== 'ok') return
    expect(
      pending.completion.entries
        .flatMap((entry) => entry.solves)
        .find((solve) => solve.id === newlyTimedId)?.comment,
    ).toBe('Buffered note')
  })

  it('persists a penalty before reporting success', () => {
    const initial = sessionsData()
    saveSessions(initial)
    const { result } = renderHook(() => useSessions())

    let saved = false
    act(() => {
      saved = result.current.setPenalty('solve-a', '+2')
    })

    expect(saved).toBe(true)
    expect(result.current.sessions[0]?.solves[0]?.penalty).toBe('+2')
    expect(loadSessions().sessions[0]?.solves[0]?.penalty).toBe('+2')
  })

  it('does not publish a penalty during a prepared replacement', () => {
    const initial = sessionsData()
    saveSessions(initial)
    const { result } = renderHook(() => useSessions())
    const begun = beginReplacement('native-import', ['sessions'])
    expect(begun.ok).toBe(true)
    if (!begun.ok) return

    let saved = true
    act(() => {
      saved = result.current.setPenalty('solve-a', 'dnf')
    })

    expect(saved).toBe(false)
    expect(result.current.sessions[0]?.solves[0]?.penalty).toBe('none')
    expect(loadSessions().sessions[0]?.solves[0]?.penalty).toBe('none')
    expect(result.current.storageOk).toBe(false)
  })

  it('buffers a penalty for a newly timed solve during a prepared replacement', () => {
    const initial = sessionsData()
    saveSessions(initial)
    const { result } = renderHook(() => useSessions())
    const begun = beginReplacement('native-import', ['sessions'])
    expect(begun.ok).toBe(true)
    if (!begun.ok) return

    let newlyTimedId = ''
    act(() => {
      newlyTimedId = result.current.addSolve(
        { rawMs: 9_876, penalty: 'none', scramble: "F R U'" },
        '333',
      ).id
    })
    let saved = false
    act(() => {
      saved = result.current.setPenalty(newlyTimedId, 'dnf')
    })

    expect(saved).toBe(true)
    expect(
      result.current.sessions[0]?.solves.find((solve) => solve.id === newlyTimedId)
        ?.penalty,
    ).toBe('dnf')
    const pending = loadPendingCompletion()
    expect(pending.status).toBe('ok')
    if (pending.status !== 'ok') return
    expect(
      pending.completion.entries
        .flatMap((entry) => entry.solves)
        .find((solve) => solve.id === newlyTimedId)?.penalty,
    ).toBe('dnf')
  })

  it('does not publish a penalty when the collection cannot be saved', () => {
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
      let saved = true
      act(() => {
        saved = result.current.setPenalty('solve-a', '+2')
      })

      expect(saved).toBe(false)
      expect(result.current.sessions[0]?.solves[0]?.penalty).toBe('none')
      expect(result.current.storageOk).toBe(false)
      expect(loadSessions().sessions[0]?.solves[0]?.penalty).toBe('none')
    } finally {
      spy.mockRestore()
    }
  })

  it('does not publish or report a comment when the collection cannot be saved', () => {
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
      let saved = true
      act(() => {
        saved = result.current.setComment('solve-a', 'Keep this draft')
      })

      expect(saved).toBe(false)
      expect(result.current.sessions[0]?.solves[0]?.comment).toBe('')
      expect(result.current.storageOk).toBe(false)
      expect(loadSessions().sessions[0]?.solves[0]?.comment).toBe('')
    } finally {
      spy.mockRestore()
    }
  })
})

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

  it('blocks a destructive edit during a prepared replacement', () => {
    const initial = sessionsData()
    saveSessions(initial)
    const { result } = renderHook(() => useSessions())
    const begun = beginReplacement('native-import', ['sessions'])
    expect(begun.ok).toBe(true)
    if (!begun.ok) return

    // A buffered new solve must not make an unrelated deletion look durable.
    act(() => {
      result.current.addSolve(
        { rawMs: 9_876, penalty: 'none', scramble: "F R U'" },
        '333',
      )
    })
    let removed: ReturnType<typeof result.current.deleteSolve> = null
    act(() => {
      removed = result.current.deleteSolve('solve-a')
    })

    expect(removed).toBeNull()
    expect(
      result.current.sessions[0]?.solves.some((solve) => solve.id === 'solve-a'),
    ).toBe(true)
    expect(
      loadSessions()
        .sessions[0]?.solves.some((solve) => solve.id === 'solve-a'),
    ).toBe(true)
    expect(result.current.storageOk).toBe(false)
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

describe('useSessions durable session deletion', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('does not publish a session deletion when the collection cannot be saved', () => {
    saveSessions(twoSessionsData())
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
      let deleted = true
      act(() => {
        deleted = result.current.deleteSession('session-2')
      })

      expect(deleted).toBe(false)
      expect(result.current.sessions.map((session) => session.id)).toEqual([
        'session-1',
        'session-2',
      ])
      expect(result.current.storageOk).toBe(false)
      expect(loadSessions().sessions.map((session) => session.id)).toEqual([
        'session-1',
        'session-2',
      ])
    } finally {
      spy.mockRestore()
    }
  })

  it('writes once per session deletion and keeps the final session', () => {
    saveSessions(twoSessionsData())
    const { result } = renderHook(() => useSessions())
    const original = Storage.prototype.setItem
    const spy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(function setItem(this: Storage, key, value) {
        return original.call(this, key, value)
      })
    try {
      spy.mockClear()
      let deleted = false
      act(() => {
        deleted = result.current.deleteSession('session-2')
      })

      expect(deleted).toBe(true)
      expect(result.current.sessions.map((session) => session.id)).toEqual([
        'session-1',
      ])
      expect(loadSessions().sessions.map((session) => session.id)).toEqual([
        'session-1',
      ])
      expect(
        spy.mock.calls.filter(([key]) => key === SESSIONS_STORAGE_KEY),
      ).toHaveLength(1)

      spy.mockClear()
      let deletedLast = true
      act(() => {
        deletedLast = result.current.deleteSession('session-1')
      })

      expect(deletedLast).toBe(false)
      expect(result.current.sessions.map((session) => session.id)).toEqual([
        'session-1',
      ])
      expect(
        spy.mock.calls.filter(([key]) => key === SESSIONS_STORAGE_KEY),
      ).toHaveLength(0)
    } finally {
      spy.mockRestore()
    }
  })
})

describe('useSessions custom event references', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('reuses a stable empty custom event collection across renders', () => {
    saveSessions(sessionsData())
    const { result, rerender } = renderHook(() => useSessions())
    const empty = result.current.customEvents
    expect(empty).toEqual([])

    rerender()
    expect(result.current.customEvents).toBe(empty)

    act(() => {
      result.current.addSolve(
        { rawMs: 9_876, penalty: 'none', scramble: "F R U'" },
        '333',
      )
    })
    expect(result.current.customEvents).toBe(empty)
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

  it('saves normally right after a successful save without buffering', () => {
    const initial = sessionsData()
    saveSessions(initial)
    const { result } = renderHook(() => useSessions())

    act(() => {
      result.current.addSolve(
        { rawMs: 9_876, penalty: 'none', scramble: "F R U'" },
        '333',
      )
    })
    act(() => {
      expect(result.current.renameSession('session-1', 'Renamed')).toBe(true)
    })

    // The first save must track the exact bytes it wrote. Otherwise the
    // second save would mistake its own earlier write for an external
    // replacement candidate and buffer the edit instead of persisting it.
    const disk = loadSessions()
    expect(disk.sessions[0]?.name).toBe('Renamed')
    expect(disk.sessions[0]?.solves).toHaveLength(2)
    expect(loadPendingCompletion().status).toBe('none')
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

describe('useSessions competition operations', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('creates a competition session, assigns timed solves, converts and persists', () => {
    saveSessions(sessionsData())
    const { result } = renderHook(() => useSessions())
    let created: string | null = null
    act(() => {
      created = result.current.createSession(
        'Friday',
        false,
        '333',
        { inspectionEnabled: false },
        { type: 'ao', size: 5 },
      )
    })
    expect(created).not.toBeNull()
    expect(result.current.activeSession).toMatchObject({
      id: created,
      kind: 'competition',
      competitionFormat: { type: 'ao', size: 5 },
    })

    act(() => {
      result.current.addSolve({
        rawMs: 10_000,
        penalty: 'none',
        scramble: "R U R' U'",
      })
    })
    expect(result.current.activeSession.solves[0]).toMatchObject({
      roundIndex: 0,
    })
    expect(result.current.activeSession.solves[0]?.roundId).toBeTruthy()
    expect(
      loadSessions().sessions.find((session) => session.id === created)?.kind,
    ).toBe('competition')

    let converted = false
    act(() => {
      converted = result.current.convertSessionToPractice(created!)
    })
    expect(converted).toBe(true)
    expect(result.current.activeSession.kind).toBeUndefined()
    expect(result.current.activeSession.solves[0]).not.toHaveProperty(
      'roundId',
    )
    expect(
      loadSessions().sessions.find((session) => session.id === created)
        ?.competitionFormat,
    ).toBeUndefined()
  })

  it('splits into a competition session with the chosen format', () => {
    const competition: SessionsData = {
      activeSessionId: 'competition',
      sessions: [
        {
          id: 'competition',
          name: 'Friday',
          kind: 'competition',
          competitionFormat: { type: 'ao', size: 5 },
          createdAt: NOW,
          updatedAt: NOW,
          solves: [
            solve({ id: 'b', createdAt: NOW + 1_000 }),
            solve({ id: 'a', createdAt: NOW }),
          ],
        },
      ],
    }
    saveSessions(competition)
    const { result } = renderHook(() => useSessions())
    let created: string | null = null
    act(() => {
      created = result.current.splitSession(
        'competition',
        'Saturday',
        ['a', 'b'],
        { type: 'mo', size: 3 },
      )
    })
    expect(created).not.toBeNull()
    const split = result.current.sessions.find((session) => session.id === created)
    expect(split).toMatchObject({
      kind: 'competition',
      competitionFormat: { type: 'mo', size: 3 },
    })
    expect(split?.solves.every((entry) => entry.roundId !== undefined)).toBe(true)
    expect(result.current.sessions.find((entry) => entry.id === 'competition')?.kind).toBe(
      'competition',
    )
  })
})
