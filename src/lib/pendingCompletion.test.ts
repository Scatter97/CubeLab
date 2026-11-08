import { beforeEach, describe, expect, it } from 'vitest'
import type { CustomEventDefinition, Session, SessionsData, Solve } from '../types'
import type { StorageLike } from './storage'
import {
  DEFAULT_SETTINGS,
  SESSIONS_STORAGE_KEY,
  findSessionEventMismatches,
  loadSessions,
  saveSessions,
} from './storage'
import { createBackup, parseBackup } from './backup'
import {
  PENDING_COMPLETION_ENTRY_PREFIX,
  PENDING_COMPLETION_STORAGE_KEY,
  acknowledgePendingCompletion,
  acknowledgePendingCompletionForData,
  applyPendingCompletion,
  applyPendingCompletionAtStartup,
  clearPendingCompletion,
  loadPendingCompletion,
  recordPendingCompletion,
} from './pendingCompletion'

const NOW = 1_700_000_000_000

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>()
  failSet = new Set<string>()
  failRemove = new Set<string>()

  get length(): number {
    return this.values.size
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    if (this.failSet.has(key)) throw new Error(`set failed: ${key}`)
    this.values.set(key, value)
  }

  removeItem(key: string): void {
    if (this.failRemove.has(key)) throw new Error(`remove failed: ${key}`)
    this.values.delete(key)
  }
}

function solve(overrides: Partial<Solve> = {}): Solve {
  return {
    id: 'solve-new',
    event: '333',
    rawMs: 12_345,
    penalty: 'none',
    scramble: "R U R' U'",
    comment: '',
    createdAt: NOW,
    ...overrides,
  }
}

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-a',
    name: 'Morning',
    event: '333',
    createdAt: NOW,
    updatedAt: NOW,
    solves: [],
    ...overrides,
  }
}

function data(overrides: Partial<SessionsData> = {}): SessionsData {
  return {
    activeSessionId: 'session-a',
    sessions: [session()],
    ...overrides,
  }
}

function definition(
  overrides: Partial<CustomEventDefinition> = {},
): CustomEventDefinition {
  return {
    id: 'custom:fto',
    name: 'FTO',
    placeholder: '',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

describe('pending completion buffer', () => {
  let storage: MemoryStorage

  beforeEach(() => {
    storage = new MemoryStorage()
  })

  it('keeps a completion out of the staged collection and replays it by owner ID', () => {
    const baseline = data()
    const local = data({
      sessions: [session({ solves: [solve()] })],
    })
    saveSessions(baseline, storage)

    expect(recordPendingCompletion(baseline, local, storage)).toBe(true)
    expect(loadSessions(storage).sessions[0]?.solves).toEqual([])

    const external = data({
      activeSessionId: 'session-b',
      sessions: [
        session({ solves: [solve({ id: 'external-solve', createdAt: NOW - 1 })] }),
        session({ id: 'session-b', name: 'Evening' }),
      ],
    })
    const loaded = loadPendingCompletion(storage)
    expect(loaded.status).toBe('ok')
    if (loaded.status !== 'ok') return
    const applied = applyPendingCompletion(external, loaded.completion)

    expect(applied.activeSessionId).toBe('session-b')
    expect(
      applied.sessions
        .find((entry) => entry.id === 'session-a')
        ?.solves.map((entry) => entry.id),
    ).toEqual(['solve-new', 'external-solve'])
    expect(
      applied.sessions.find((entry) => entry.id === 'session-b')?.solves,
    ).toEqual([])
  })

  it('uses a labelled same-event recovery session when the original owner was removed', () => {
    const baseline = data()
    const local = data({
      sessions: [
        session({
          event: '222',
          solves: [solve({ id: 'owned-by-missing', event: '222' })],
        }),
      ],
    })
    expect(recordPendingCompletion(baseline, local, storage)).toBe(true)
    const loaded = loadPendingCompletion(storage)
    if (loaded.status !== 'ok') throw new Error('completion missing')
    const applied = applyPendingCompletion(
      data({
        sessions: [session({ id: 'session-b', name: 'Evening' })],
      }),
      loaded.completion,
    )

    const recovered = applied.sessions.find(
      (entry) => entry.id === 'recovered:session-a',
    )
    expect(recovered?.name).toBe('Morning (recovered)')
    expect(recovered?.event).toBe('222')
    expect(recovered?.solves).toEqual([
      expect.objectContaining({ id: 'owned-by-missing', event: '222' }),
    ])
  })

  it('routes a buffered solve into a compatible recovery session when its owner was reclassified', () => {
    const baseline = data()
    const local = data({
      sessions: [session({ solves: [solve({ id: 'buffered-A' })] })],
    })
    expect(recordPendingCompletion(baseline, local, storage)).toBe(true)
    const loaded = loadPendingCompletion(storage)
    if (loaded.status !== 'ok') throw new Error('completion missing')

    const external = data({
      sessions: [session({ name: 'Original A', event: '222' })],
    })
    const applied = applyPendingCompletion(external, loaded.completion)

    expect(findSessionEventMismatches(applied)).toEqual([])
    expect(
      applied.sessions.find((entry) => entry.id === 'session-a'),
    ).toMatchObject({ event: '222', solves: [] })
    const recovered = applied.sessions.find(
      (entry) => entry.id === 'recovered:session-a',
    )
    expect(recovered).toMatchObject({ event: '333' })
    expect(recovered?.solves).toEqual([
      {
        id: 'buffered-A',
        event: '333',
        rawMs: 12_345,
        penalty: 'none',
        scramble: "R U R' U'",
        comment: '',
        createdAt: NOW,
      },
    ])

    const parsed = parseBackup(
      JSON.stringify(createBackup(applied, DEFAULT_SETTINGS)),
    )
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(
        parsed.backup.sessions.sessions
          .find((entry) => entry.id === 'recovered:session-a')
          ?.solves.map((entry) => entry.id),
      ).toEqual(['buffered-A'])
    }

    const replayed = applyPendingCompletion(applied, loaded.completion)
    expect(findSessionEventMismatches(replayed)).toEqual([])
    expect(
      replayed.sessions.filter((entry) => entry.id.startsWith('recovered:')),
    ).toHaveLength(1)
    expect(
      replayed.sessions.find((entry) => entry.id === 'recovered:session-a')
        ?.solves,
    ).toEqual(recovered?.solves)
  })

  it('keeps replacement custom-event definitions alongside recovered ones', () => {
    const fto = definition()
    const extra = definition({ id: 'custom:extra', name: 'Extra puzzle' })
    const replacementFto = definition({
      name: 'Replacement FTO',
      updatedAt: NOW + 1,
    })
    const keep = definition({ id: 'custom:keep', name: 'Replacement only' })
    const baseline = data({
      customEvents: [fto, extra],
      sessions: [session({ event: 'custom:fto' })],
    })
    const local = data({
      customEvents: [fto, extra],
      sessions: [
        session({
          event: 'custom:fto',
          solves: [solve({ id: 'custom-buffered', event: 'custom:fto' })],
        }),
      ],
    })
    expect(recordPendingCompletion(baseline, local, storage)).toBe(true)
    const loaded = loadPendingCompletion(storage)
    if (loaded.status !== 'ok') throw new Error('completion missing')

    const applied = applyPendingCompletion(
      data({
        customEvents: [replacementFto, keep],
        sessions: [session({ event: '222' })],
      }),
      loaded.completion,
    )

    expect(applied.customEvents).toEqual([
      replacementFto,
      keep,
      extra,
    ])
    const recovered = applied.sessions.find(
      (entry) => entry.id === 'recovered:session-a',
    )
    expect(recovered).toMatchObject({ event: 'custom:fto' })
    expect(recovered?.solves.map((entry) => entry.id)).toEqual([
      'custom-buffered',
    ])
    expect(
      parseBackup(JSON.stringify(createBackup(applied, DEFAULT_SETTINGS))).ok,
    ).toBe(true)
  })

  it('union-appends repeated recordings and remains idempotent on replay', () => {
    const baseline = data()
    const first = data({
      sessions: [session({ solves: [solve({ id: 'first' })] })],
    })
    const second = data({
      sessions: [
        session({
          solves: [
            solve({ id: 'second', createdAt: NOW + 1 }),
            solve({ id: 'first' }),
          ],
        }),
      ],
    })
    expect(recordPendingCompletion(baseline, first, storage)).toBe(true)
    expect(recordPendingCompletion(baseline, second, storage)).toBe(true)
    const loaded = loadPendingCompletion(storage)
    if (loaded.status !== 'ok') throw new Error('completion missing')
    expect(loaded.completion.entries[0]?.solves.map((entry) => entry.id)).toEqual([
      'second',
      'first',
    ])

    const external = data()
    const once = applyPendingCompletion(external, loaded.completion)
    const twice = applyPendingCompletion(once, loaded.completion)
    expect(twice.sessions[0]?.solves.map((entry) => entry.id)).toEqual([
      'second',
      'first',
    ])
  })

  it('applies and clears a durable buffer before normal startup', () => {
    saveSessions(data(), storage)
    expect(
      recordPendingCompletion(
        data(),
        data({ sessions: [session({ solves: [solve()] })] }),
        storage,
      ),
    ).toBe(true)

    expect(applyPendingCompletionAtStartup(storage)).toEqual({ ok: true })
    expect(loadSessions(storage).sessions[0]?.solves.map((entry) => entry.id)).toEqual([
      'solve-new',
    ])
    expect(loadPendingCompletion(storage).status).toBe('none')
  })

  it('recovers a reclassified owner during startup replay', () => {
    const baseline = data()
    saveSessions(
      data({
        sessions: [session({ name: 'Original A', event: '222' })],
      }),
      storage,
    )
    expect(
      recordPendingCompletion(
        baseline,
        data({ sessions: [session({ solves: [solve()] })] }),
        storage,
      ),
    ).toBe(true)

    expect(applyPendingCompletionAtStartup(storage)).toEqual({ ok: true })
    const disk = loadSessions(storage)
    expect(
      disk.sessions.find((entry) => entry.id === 'session-a'),
    ).toMatchObject({ event: '222', solves: [] })
    const recovered = disk.sessions.find(
      (entry) => entry.id === 'recovered:session-a',
    )
    expect(recovered).toMatchObject({ event: '333' })
    expect(recovered?.solves.map((entry) => entry.id)).toEqual(['solve-new'])
    expect(
      parseBackup(JSON.stringify(createBackup(disk, DEFAULT_SETTINGS))).ok,
    ).toBe(true)
    expect(loadPendingCompletion(storage).status).toBe('none')
  })

  it('keeps the buffer when startup cannot write the recovered collection', () => {
    saveSessions(data(), storage)
    expect(
      recordPendingCompletion(
        data(),
        data({ sessions: [session({ solves: [solve()] })] }),
        storage,
      ),
    ).toBe(true)
    storage.failSet.add(SESSIONS_STORAGE_KEY)

    const result = applyPendingCompletionAtStartup(storage)
    expect(result.ok).toBe(false)
    expect(loadPendingCompletion(storage).status).toBe('ok')
    expect(loadSessions(storage).sessions[0]?.solves).toEqual([])
  })

  it('acknowledges only the exact durable versions and preserves a newer append', () => {
    const baseline = data()
    const first = data({
      sessions: [session({ solves: [solve({ id: 'buffered-A' })] })],
    })
    expect(recordPendingCompletion(baseline, first, storage)).toBe(true)
    const snapshot = loadPendingCompletion(storage)
    if (snapshot.status !== 'ok') throw new Error('completion missing')

    // Simulate a follower appending between the snapshot and acknowledgement.
    const second = data({
      sessions: [
        session({
          solves: [
            solve({ id: 'buffered-B', createdAt: NOW + 1 }),
            solve({ id: 'buffered-A' }),
          ],
        }),
      ],
    })
    expect(recordPendingCompletion(baseline, second, storage)).toBe(true)

    expect(
      acknowledgePendingCompletion(snapshot.completion, {
        storage,
        data: first,
        tombstones: [],
      }),
    ).toBe(true)
    const remaining = loadPendingCompletion(storage)
    expect(remaining.status).toBe('ok')
    if (remaining.status !== 'ok') return
    expect(
      remaining.completion.entries.flatMap((entry) =>
        entry.solves.map((entry) => entry.id),
      ),
    ).toEqual(['buffered-B'])

    expect(
      acknowledgePendingCompletionForData(second, {
        storage,
        tombstones: [],
      }),
    ).toBe(true)
    expect(loadPendingCompletion(storage).status).toBe('none')
  })

  it('keeps both solves when two appends interleave', () => {
    const baseline = data()
    const first = data({
      sessions: [session({ solves: [solve({ id: 'competing-A' })] })],
    })
    const second = data({
      sessions: [session({ solves: [solve({ id: 'competing-B' })] })],
    })
    const interleaving = new (class extends MemoryStorage {
      beforeSet: ((key: string) => void) | null = null

      setItem(key: string, value: string): void {
        const hook = this.beforeSet
        if (hook) {
          this.beforeSet = null
          hook(key)
        }
        super.setItem(key, value)
      }
    })()

    interleaving.beforeSet = (key) => {
      if (key === `${PENDING_COMPLETION_ENTRY_PREFIX}competing-A`) {
        expect(recordPendingCompletion(baseline, second, interleaving)).toBe(
          true,
        )
      }
    }
    expect(recordPendingCompletion(baseline, first, interleaving)).toBe(true)

    const loaded = loadPendingCompletion(interleaving)
    expect(loaded.status).toBe('ok')
    if (loaded.status !== 'ok') return
    expect(
      loaded.completion.entries
        .flatMap((entry) => entry.solves.map((entry) => entry.id))
        .sort(),
    ).toEqual(['competing-A', 'competing-B'])
  })

  it('keeps the buffer when acknowledgement cannot remove an entry', () => {
    const baseline = data()
    const local = data({
      sessions: [session({ solves: [solve({ id: 'buffered-A' })] })],
    })
    expect(recordPendingCompletion(baseline, local, storage)).toBe(true)
    storage.failRemove.add(
      `${PENDING_COMPLETION_ENTRY_PREFIX}${encodeURIComponent('buffered-A')}`,
    )

    expect(
      acknowledgePendingCompletionForData(local, {
        storage,
        tombstones: [],
      }),
    ).toBe(false)
    const remaining = loadPendingCompletion(storage)
    expect(remaining.status).toBe('ok')
    if (remaining.status !== 'ok') return
    expect(
      remaining.completion.entries.flatMap((entry) =>
        entry.solves.map((entry) => entry.id),
      ),
    ).toEqual(['buffered-A'])
  })

  it('does not replay a solve superseded by a deliberate deletion tombstone', () => {
    const baseline = data()
    const local = data({
      sessions: [session({ solves: [solve({ id: 'deleted-buffered' })] })],
    })
    expect(recordPendingCompletion(baseline, local, storage)).toBe(true)
    const loaded = loadPendingCompletion(storage)
    if (loaded.status !== 'ok') throw new Error('completion missing')
    const tombstones = [
      {
        kind: 'solve' as const,
        id: 'deleted-buffered',
        deletedAt: NOW + 10,
        deletedByDeviceId: 'device-test',
      },
    ]

    const applied = applyPendingCompletion(
      data(),
      loaded.completion,
      tombstones,
    )
    expect(applied.sessions[0]?.solves).toEqual([])

    expect(
      acknowledgePendingCompletion(loaded.completion, {
        storage,
        data: applied,
        tombstones,
      }),
    ).toBe(true)
    expect(loadPendingCompletion(storage).status).toBe('none')
  })

  it('retries a failed startup cleanup idempotently without blocking startup', () => {
    saveSessions(data(), storage)
    expect(
      recordPendingCompletion(
        data(),
        data({ sessions: [session({ solves: [solve()] })] }),
        storage,
      ),
    ).toBe(true)
    const key = `${PENDING_COMPLETION_ENTRY_PREFIX}${encodeURIComponent('solve-new')}`
    storage.failRemove.add(key)

    expect(applyPendingCompletionAtStartup(storage)).toEqual({ ok: true })
    expect(loadSessions(storage).sessions[0]?.solves.map((entry) => entry.id)).toEqual([
      'solve-new',
    ])
    expect(loadPendingCompletion(storage).status).toBe('ok')

    storage.failRemove.delete(key)
    expect(applyPendingCompletionAtStartup(storage)).toEqual({ ok: true })
    expect(loadSessions(storage).sessions[0]?.solves.map((entry) => entry.id)).toEqual([
      'solve-new',
    ])
    expect(loadPendingCompletion(storage).status).toBe('none')
  })

  it('keeps the single-record fallback for storage without key enumeration', () => {
    const legacy = {
      values: new Map<string, string>(),
      getItem(key: string): string | null {
        return this.values.get(key) ?? null
      },
      setItem(key: string, value: string): void {
        this.values.set(key, value)
      },
      removeItem(key: string): void {
        this.values.delete(key)
      },
    }
    const baseline = data()
    const local = data({
      sessions: [session({ solves: [solve({ id: 'legacy-buffered' })] })],
    })

    expect(recordPendingCompletion(baseline, local, legacy)).toBe(true)
    expect(legacy.getItem(PENDING_COMPLETION_STORAGE_KEY)).not.toBeNull()
    const loaded = loadPendingCompletion(legacy)
    expect(loaded.status).toBe('ok')
    if (loaded.status !== 'ok') return
    expect(
      loaded.completion.entries.flatMap((entry) =>
        entry.solves.map((entry) => entry.id),
      ),
    ).toEqual(['legacy-buffered'])

    expect(
      acknowledgePendingCompletionForData(local, {
        storage: legacy,
        tombstones: [],
      }),
    ).toBe(true)
    expect(legacy.getItem(PENDING_COMPLETION_STORAGE_KEY)).toBeNull()
  })

  it('retains malformed buffers instead of discarding their evidence', () => {
    storage.setItem(PENDING_COMPLETION_STORAGE_KEY, '{broken')
    expect(loadPendingCompletion(storage).status).toBe('invalid')
    expect(applyPendingCompletionAtStartup(storage).ok).toBe(false)
    expect(storage.getItem(PENDING_COMPLETION_STORAGE_KEY)).toBe('{broken')
    expect(clearPendingCompletion(storage)).toBe(true)
    expect(storage.getItem(PENDING_COMPLETION_STORAGE_KEY)).toBeNull()
  })
})
