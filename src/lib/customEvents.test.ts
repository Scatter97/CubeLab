import { describe, expect, it } from 'vitest'
import type { CustomEventDefinition, SessionsData, Solve } from '../types'
import {
  correctImportedSolveEvents,
  createCustomEvent,
  csTimerCustomEventId,
  deleteCustomEvent,
  findImportedEventCorrections,
  getCustomEventNameError,
  mergeCustomEvents,
  parseCustomEvents,
  reassignSessionsEvent,
  renameCustomEvent,
  resolveCsTimerEvent,
  setCustomEventPlaceholder,
} from './customEvents'

function solve(overrides: Partial<Solve> = {}): Solve {
  return {
    id: 'solve-1',
    event: '333',
    rawMs: 12_000,
    penalty: 'none',
    scramble: 'R U',
    comment: 'keep me',
    createdAt: 1_700_000_000_000,
    ...overrides,
  }
}

function data(overrides: Partial<SessionsData> = {}): SessionsData {
  return {
    activeSessionId: 'session-1',
    sessions: [
      {
        id: 'session-1',
        name: 'Session 1',
        event: '333',
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_000_000,
        solves: [solve()],
      },
    ],
    ...overrides,
  }
}

function definition(
  overrides: Partial<CustomEventDefinition> = {},
): CustomEventDefinition {
  return {
    id: 'custom:test',
    name: 'Test puzzle',
    placeholder: '',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  }
}

describe('custom event definitions', () => {
  it('creates, renames and updates a placeholder without touching solves', () => {
    const created = createCustomEvent(data(), {
      name: '  FTO  ',
      placeholder: '',
      id: 'custom:fto',
      now: 100,
    })
    expect(created).not.toBeNull()
    if (!created) return
    expect(created.data.customEvents).toEqual([
      expect.objectContaining({ id: 'custom:fto', name: 'FTO', placeholder: '' }),
    ])
    expect(created.data.sessions).toEqual(data().sessions)

    const renamed = renameCustomEvent(created.data, 'custom:fto', 'Face turning octahedron', 200, 'laptop')
    expect(renamed?.customEvents?.[0]).toMatchObject({
      name: 'Face turning octahedron',
      updatedAt: 200,
      fieldUpdates: { name: { updatedAt: 200, editorId: 'laptop' } },
    })
    const withPlaceholder = setCustomEventPlaceholder(renamed!, 'custom:fto', 'No scramble yet', 300, 'laptop')
    expect(withPlaceholder?.customEvents?.[0]).toMatchObject({
      placeholder: 'No scramble yet',
      updatedAt: 300,
      fieldUpdates: {
        name: { updatedAt: 200, editorId: 'laptop' },
        placeholder: { updatedAt: 300, editorId: 'laptop' },
      },
    })
    expect(withPlaceholder?.sessions).toEqual(data().sessions)
  })

  it('rejects duplicate names and malformed input', () => {
    const withEvent = createCustomEvent(data(), { name: 'FTO', id: 'custom:fto' })!.data
    expect(getCustomEventNameError('fto', withEvent.customEvents!)).toMatch(/already exists/i)
    expect(getCustomEventNameError('3×3', withEvent.customEvents!)).toMatch(/built-in/i)
    expect(createCustomEvent(withEvent, { name: 'FTO' })).toBeNull()
    expect(parseCustomEvents([{ id: 'not-custom', name: 'x', createdAt: 1, updatedAt: 1 }])).toEqual([])
    expect(parseCustomEvents([{ id: 'custom:ok', name: '', createdAt: 1, updatedAt: 1 }])).toEqual([])
  })

  it('blocks deletion while sessions or solves still reference the event', () => {
    const withEvent = createCustomEvent(data(), { name: 'FTO', id: 'custom:fto' })!.data
    const referenced: SessionsData = {
      ...withEvent,
      sessions: [
        {
          ...withEvent.sessions[0]!,
          event: 'custom:fto',
          solves: [solve({ event: 'custom:fto' })],
        },
      ],
    }
    expect(deleteCustomEvent(referenced, 'custom:fto')).toEqual({
      error: expect.stringMatching(/reassign/i),
    })
    const unused = {
      ...withEvent,
      sessions: [{ ...withEvent.sessions[0]!, solves: [] }],
    }
    expect(deleteCustomEvent(unused, 'custom:fto')).toEqual({
      data: { ...unused, customEvents: [] },
    })
  })

  it('reassigns whole sessions while preserving solve data', () => {
    const withEvent = createCustomEvent(data(), { name: 'FTO', id: 'custom:fto' })!.data
    const reassigned = reassignSessionsEvent(withEvent, ['session-1'], 'custom:fto', 500, 'laptop')
    expect(reassigned?.sessions[0]).toMatchObject({
      event: 'custom:fto',
      updatedAt: 500,
      fieldUpdates: { event: { updatedAt: 500, editorId: 'laptop' } },
    })
    expect(reassigned?.sessions[0]!.solves[0]).toMatchObject({
      event: 'custom:fto',
      rawMs: 12_000,
      penalty: 'none',
      scramble: 'R U',
      comment: 'keep me',
      createdAt: 1_700_000_000_000,
      fieldUpdates: { event: { updatedAt: 500, editorId: 'laptop' } },
    })
    expect(reassignSessionsEvent(withEvent, ['session-1'], 'custom:missing')).toBeNull()
  })
})

describe('csTimer custom event mapping', () => {
  it('derives stable IDs for unknown and missing identifiers', () => {
    expect(csTimerCustomEventId('oll')).toBe(csTimerCustomEventId(' OLL '))
    expect(csTimerCustomEventId('oll')).not.toBe(csTimerCustomEventId('pll'))
    expect(csTimerCustomEventId('')).toBe('custom:cstimer:unspecified')
    expect(csTimerCustomEventId('')).toBe(csTimerCustomEventId('   '))
  })

  it('never maps a missing or unknown type to 3×3', () => {
    for (const scrType of ['', '   ', 'oll', 'unsupported-puzzle']) {
      const resolved = resolveCsTimerEvent({ scrType, definitions: [], now: 1 })
      expect(resolved.resolution.eventId).not.toBe('333')
      expect(resolved.resolution.eventId).toMatch(/^custom:/)
    }
    expect(
      resolveCsTimerEvent({ scrType: '333', definitions: [], now: 1 }).resolution,
    ).toEqual({ eventId: '333', created: false })
  })

  it('reuses existing definitions and keeps distinct types separate', () => {
    const first = resolveCsTimerEvent({ scrType: 'fto', definitions: [], now: 1 })
    const second = resolveCsTimerEvent({
      scrType: 'other',
      definitions: first.definitions,
      now: 2,
    })
    expect(first.definitions).toHaveLength(1)
    expect(second.definitions).toHaveLength(2)
    expect(new Set(second.definitions.map((item) => item.id)).size).toBe(2)

    const repeated = resolveCsTimerEvent({
      scrType: 'fto',
      definitions: second.definitions,
      now: 3,
    })
    expect(repeated.definitions).toEqual(second.definitions)
    expect(repeated.resolution.created).toBe(false)
  })
})

describe('custom event merging', () => {
  it('unions IDs and merges fields with explicit provenance', () => {
    const conflicts: Parameters<typeof mergeCustomEvents>[0]['conflicts'] = []
    const merged = mergeCustomEvents({
      local: [
        definition({
          id: 'custom:a',
          name: 'Local name',
          updatedAt: 200,
          fieldUpdates: { name: { updatedAt: 200, editorId: 'laptop' } },
        }),
      ],
      remote: [
        definition({
          id: 'custom:a',
          name: 'Cloud name',
          updatedAt: 100,
          fieldUpdates: { name: { updatedAt: 100, editorId: 'phone' } },
        }),
        definition({ id: 'custom:b', name: 'Cloud only' }),
      ],
      manualConflictReview: false,
      conflicts,
      resolvedConflicts: [],
    })
    expect(merged.map((item) => item.id)).toEqual(['custom:a', 'custom:b'])
    expect(merged[0]).toMatchObject({
      name: 'Local name',
      fieldUpdates: { name: { updatedAt: 200, editorId: 'laptop' } },
    })
    expect(conflicts).toEqual([
      expect.objectContaining({ kind: 'event', id: 'custom:a', field: 'name', resolution: 'local' }),
    ])
  })

  it('honors deletions unless a session still references the definition', () => {
    const merged = mergeCustomEvents({
      local: [definition({ id: 'custom:deleted' })],
      remote: [],
      deletedIds: new Set(['custom:deleted']),
      referencedIds: new Set(),
      manualConflictReview: false,
      conflicts: [],
      resolvedConflicts: [],
    })
    expect(merged).toEqual([])
    const retained = mergeCustomEvents({
      local: [definition({ id: 'custom:deleted' })],
      remote: [],
      deletedIds: new Set(['custom:deleted']),
      referencedIds: new Set(['custom:deleted']),
      manualConflictReview: false,
      conflicts: [],
      resolvedConflicts: [],
    })
    expect(retained).toHaveLength(1)
  })
})

describe('automatic imported solve correction', () => {
  it('uses original csTimer metadata, never solve duration', () => {
    const withEvent = createCustomEvent(data(), { name: 'FTO', id: csTimerCustomEventId('fto') })!.data
    const imported: SessionsData = {
      ...withEvent,
      customEvents: [],
      sessions: [
        {
          ...withEvent.sessions[0]!,
          solves: [
            solve({
              event: '333',
              importSource: {
                provider: 'cstimer',
                scrType: 'fto',
                sessionNumber: 1,
                solveIndex: 0,
              },
            }),
          ],
        },
      ],
    }
    expect(findImportedEventCorrections(imported)).toEqual([
      {
        solveId: 'solve-1',
        sessionId: 'session-1',
        scrType: 'fto',
        targetEvent: csTimerCustomEventId('fto'),
      },
    ])

    const corrected = correctImportedSolveEvents(imported, 500, 'laptop')
    expect(corrected.movedCount).toBe(1)
    expect(corrected.data.customEvents?.[0]?.id).toBe(csTimerCustomEventId('fto'))
    const moved = corrected.data.sessions.flatMap((session) => session.solves)[0]!
    expect(moved).toMatchObject({
      id: 'solve-1',
      event: csTimerCustomEventId('fto'),
      rawMs: 12_000,
      scramble: 'R U',
      comment: 'keep me',
      createdAt: 1_700_000_000_000,
    })
    expect(findImportedEventCorrections(corrected.data)).toEqual([])
  })

  it('does nothing when provenance is missing', () => {
    const input = data()
    const result = correctImportedSolveEvents(input, 500, 'laptop')
    expect(result.movedCount).toBe(0)
    expect(result.data).toBe(input)
  })
})
