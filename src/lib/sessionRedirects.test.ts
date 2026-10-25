import { describe, expect, it } from 'vitest'
import type { Session, SessionsData, Solve } from '../types'
import {
  applySessionRedirects,
  normalizeSessionRedirects,
} from './sessionRedirects'

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
    event: '333',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    solves: [],
    ...overrides,
  }
}

function sessions(overrides: Partial<SessionsData> = {}): SessionsData {
  return {
    activeSessionId: 'session-1',
    sessions: [session()],
    ...overrides,
  }
}

describe('normalizeSessionRedirects', () => {
  it('keeps the newest approval and flattens chained approvals', () => {
    const redirects = normalizeSessionRedirects([
      { fromId: 'A', toId: 'B', approvedAt: 1, byDeviceId: 'laptop' },
      { fromId: 'A', toId: 'C', approvedAt: 2, byDeviceId: 'phone' },
      { fromId: 'B', toId: 'D', approvedAt: 1, byDeviceId: 'phone' },
    ])

    expect(redirects.map(({ fromId, toId }) => ({ fromId, toId }))).toEqual([
      { fromId: 'A', toId: 'C' },
      { fromId: 'B', toId: 'D' },
    ])
  })

  it('drops self redirects and cycle-closing approvals', () => {
    const redirects = normalizeSessionRedirects([
      { fromId: 'A', toId: 'A', approvedAt: 1 },
      { fromId: 'A', toId: 'B', approvedAt: 2 },
      { fromId: 'B', toId: 'A', approvedAt: 3 },
    ])

    expect(redirects).toHaveLength(1)
    // The newest approval is retained; the older one would close a cycle.
    expect(redirects[0]).toMatchObject({ fromId: 'B', toId: 'A' })
  })

  it('normalizes the same approval set identically regardless of input order', () => {
    const input = [
      { fromId: 'A', toId: 'B', approvedAt: 1, byDeviceId: 'laptop' },
      { fromId: 'A', toId: 'C', approvedAt: 2, byDeviceId: 'phone' },
      { fromId: 'B', toId: 'D', approvedAt: 1, byDeviceId: 'phone' },
      { fromId: 'D', toId: 'A', approvedAt: 4, byDeviceId: 'tablet' },
      { fromId: 'E', toId: 'C', approvedAt: 2, byDeviceId: 'laptop' },
    ]
    const expected = normalizeSessionRedirects(input)

    const permutations = [
      [...input].reverse(),
      [input[2]!, input[4]!, input[0]!, input[3]!, input[1]!],
      [input[4]!, input[3]!, input[2]!, input[1]!, input[0]!],
    ]
    for (const permutation of permutations) {
      expect(normalizeSessionRedirects(permutation)).toEqual(expected)
    }
  })

  it('resolves divergent approvals for one source deterministically', () => {
    const laptop = normalizeSessionRedirects([
      { fromId: 'A', toId: 'B', approvedAt: 10, byDeviceId: 'laptop' },
      { fromId: 'A', toId: 'C', approvedAt: 20, byDeviceId: 'phone' },
    ])
    const phone = normalizeSessionRedirects([
      { fromId: 'A', toId: 'C', approvedAt: 20, byDeviceId: 'phone' },
      { fromId: 'A', toId: 'B', approvedAt: 10, byDeviceId: 'laptop' },
    ])

    expect(laptop).toEqual(phone)
    expect(laptop[0]).toMatchObject({ fromId: 'A', toId: 'C' })
  })
})

describe('applySessionRedirects', () => {
  it('merges approved sessions, deduplicates solves, and keeps the target ID', () => {
    const data = sessions({
      activeSessionId: 'source',
      sessions: [
        session({
          id: 'source',
          name: 'Practice',
          solves: [
            solve({ id: 'shared', rawMs: 8_000, createdAt: 1_700_000_002_000 }),
            solve({ id: 'source-only', createdAt: 1_700_000_001_000 }),
          ],
        }),
        session({
          id: 'target',
          name: 'Work',
          solves: [
            solve({ id: 'target-only', createdAt: 1_700_000_003_000 }),
            solve({ id: 'shared', rawMs: 9_000, createdAt: 1_700_000_002_000 }),
          ],
        }),
      ],
    })
    const redirects = [
      { fromId: 'source', toId: 'target', approvedAt: 5, byDeviceId: 'd' },
    ]

    const merged = applySessionRedirects(data, redirects)

    expect(merged.sessions).toHaveLength(1)
    expect(merged.sessions[0]?.id).toBe('target')
    expect(merged.sessions[0]?.name).toBe('Work')
    expect(merged.activeSessionId).toBe('target')
    expect(merged.sessions[0]?.solves.map((item) => item.id).sort()).toEqual([
      'shared',
      'source-only',
      'target-only',
    ])
  })

  it('is idempotent when the same approval is applied repeatedly', () => {
    const data = sessions({
      sessions: [
        session({ id: 'source', solves: [solve({ id: 'A' })] }),
        session({ id: 'target', solves: [solve({ id: 'B', createdAt: 1_700_000_001_000 })] }),
      ],
    })
    const redirects = [
      { fromId: 'source', toId: 'target', approvedAt: 5, byDeviceId: 'd' },
    ]

    const first = applySessionRedirects(data, redirects)
    const second = applySessionRedirects(first, redirects)

    expect(second).toEqual(first)
    expect(second.sessions).toHaveLength(1)
    expect(second.sessions[0]?.solves).toHaveLength(2)
  })

  it('refuses to merge sessions or solves with incompatible events', () => {
    const data = sessions({
      sessions: [
        session({ id: 'source', event: '333', solves: [solve({ id: 'A' })] }),
        session({ id: 'target', event: '444', solves: [solve({ id: 'B', event: '444' })] }),
      ],
    })
    const redirects = [
      { fromId: 'source', toId: 'target', approvedAt: 5, byDeviceId: 'd' },
    ]

    expect(() => applySessionRedirects(data, redirects)).toThrow(
      /incompatible puzzle events/,
    )

    const mismatched = sessions({
      sessions: [
        session({ id: 'source', solves: [solve({ id: 'A', event: '222' })] }),
      ],
    })
    expect(() =>
      applySessionRedirects(mismatched, [
        { fromId: 'source', toId: 'source-2', approvedAt: 5, byDeviceId: 'd' },
      ]),
    ).toThrow(/incompatible event/)
  })
})
