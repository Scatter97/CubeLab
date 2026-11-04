import { describe, expect, it } from 'vitest'
import {
  analyzeCsTimerBackup,
  isCsTimerBackup,
  parseCsTimerBackup,
} from './csTimerImport'
import { loadSettings, parseSessionsData } from './storage'
import { parseBackup, serializeBackup } from './backup'

const settings = loadSettings()

function cstimer(input: {
  sessions: Record<string, unknown[]>
  sessionData?: Record<string, unknown> | string
  omitProperties?: boolean
}): string {
  const parsed: Record<string, unknown> = { ...input.sessions }
  if (!input.omitProperties) {
    parsed.properties = { sessionData: input.sessionData ?? {} }
  }
  return JSON.stringify(parsed)
}

function row(
  duration = 1000,
  scramble = 'R U',
  comment = '',
  date: number | null = 1700000000,
): unknown[] {
  return [[0, duration], scramble, comment, date]
}

function emptySessions(
  result: ReturnType<typeof parseCsTimerBackup>,
): Extract<ReturnType<typeof parseCsTimerBackup>, { ok: true }> {
  expect(result.ok).toBe(true)
  return result as Extract<ReturnType<typeof parseCsTimerBackup>, { ok: true }>
}

describe('isCsTimerBackup', () => {
  it('detects session keys', () => {
    expect(isCsTimerBackup('{"session1":[]}')).toBe(true)
    expect(isCsTimerBackup('{"foo":"bar"}')).toBe(false)
    expect(isCsTimerBackup('not json')).toBe(false)
  })
})

describe('analyzeCsTimerBackup', () => {
  it('rejects invalid json and missing sessions', () => {
    expect(analyzeCsTimerBackup('not json').ok).toBe(false)
    expect(analyzeCsTimerBackup('{"foo":1}').ok).toBe(false)
  })

  it('rejects malformed session solve lists before preview', () => {
    for (const value of ['{}', 'null', '"not a list"', '1']) {
      expect(analyzeCsTimerBackup(`{"session1":${value}}`).ok).toBe(false)
    }
  })
})

describe('parseCsTimerBackup', () => {
  it('handles penalty codes without doubling +2 and DNF', () => {
    const raw = cstimer({
      sessions: {
        session1: [
          [[2000, 12345], 'R U', 'comment', 1700000000],
          [[-1, 5000], 'F R', '', 1700000001],
        ],
      },
      sessionData: {
        '1': { name: 's', opt: { scrType: '333' }, date: [1700000000] },
      },
    })
    const result = emptySessions(parseCsTimerBackup(raw, settings))
    const solves = result.backup.sessions.sessions[0]!.solves
    expect(solves.map((solve) => [solve.rawMs, solve.penalty])).toEqual([
      [5000, 'dnf'],
      [12345, '+2'],
    ])
  })

  it('converts unix seconds to ms', () => {
    const raw = cstimer({
      sessions: { session1: [row(1000, 'R U', 'c', 1700000000)] },
      sessionData: {
        '1': {
          name: 's',
          opt: { scrType: '333' },
          date: [1700000000, 1700000000],
        },
      },
    })
    const result = emptySessions(parseCsTimerBackup(raw, settings))
    expect(result.backup.sessions.sessions[0]!.solves[0]!.createdAt).toBe(
      1700000000000,
    )
  })

  it('ignores a 5th solve element without rejecting', () => {
    const raw = cstimer({
      sessions: {
        session1: [[[0, 2000], 'R U', '', 1700000000, ['x@1', 'y@2']]],
      },
      sessionData: {
        '1': {
          name: 's',
          opt: { scrType: '333' },
          date: [1700000000, 1700000000],
        },
      },
    })
    expect(parseCsTimerBackup(raw, settings).ok).toBe(true)
  })

  it('maps the remaining WCA puzzle scramble types', () => {
    const cases = [
      ['pyrso', 'pyram'],
      ['skbso', 'skewb'],
      ['sqrs', 'sq1'],
      ['clkwca', 'clock'],
      ['mgmp', 'minx'],
    ] as const

    for (const [scrType, event] of cases) {
      const raw = cstimer({
        sessions: { session1: [row(1000, 'scramble')] },
        sessionData: {
          '1': {
            name: scrType,
            opt: { scrType },
            date: [1700000000, 1700000000],
          },
        },
      })
      const result = emptySessions(parseCsTimerBackup(raw, settings))
      expect(result.backup.sessions.sessions[0]!.event, scrType).toBe(event)
      expect(
        result.backup.sessions.sessions[0]!.solves[0]!.event,
        scrType,
      ).toBe(event)
    }
  })

  it('imports unknown explicit puzzle sessions as custom events, never as 3×3', () => {
    const raw = cstimer({
      sessions: {
        session1: [row(1000, 'R U')],
        session2: [row(1000, 'R U')],
      },
      sessionData: {
        '1': {
          name: 'known',
          opt: { scrType: '333' },
          date: [1700000000, 1700000000],
        },
        '2': {
          name: 'unknown',
          opt: { scrType: 'oll' },
          date: [1700000000, 1700000000],
        },
      },
    })
    const analyzed = analyzeCsTimerBackup(raw)
    expect(analyzed.ok).toBe(true)
    if (analyzed.ok) {
      expect(analyzed.preview.totalSessions).toBe(2)
      expect(analyzed.preview.totalSolves).toBe(2)
      expect(analyzed.preview.hasUnknown).toBe(true)
      expect(analyzed.preview.newCustomEventCount).toBe(1)
      expect(analyzed.preview.mappings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sourceType: 'oll',
            mapping: 'new-custom',
          }),
        ]),
      )
    }
    const result = emptySessions(parseCsTimerBackup(raw, settings))
    expect(result.backup.sessions.sessions.length).toBe(2)
    const known = result.backup.sessions.sessions.find(
      (session) => session.name === 'known',
    )!
    const unknown = result.backup.sessions.sessions.find(
      (session) => session.name === 'unknown',
    )!
    expect(known.event).toBe('333')
    expect(unknown.event).not.toBe('333')
    expect(unknown.event).toMatch(/^custom:cstimer:/)
    expect(unknown.solves[0]!.event).toBe(unknown.event)
    expect(unknown.solves[0]!.importSource).toMatchObject({
      provider: 'cstimer',
      scrType: 'oll',
      scrTypeSource: 'explicit',
    })
    expect(result.backup.sessions.customEvents).toEqual([
      expect.objectContaining({
        id: unknown.event,
        name: 'csTimer: oll',
        source: { provider: 'cstimer', identifiers: ['oll'] },
      }),
    ])
  })

  it('keeps distinct unknown types separate and reuses definitions on repeat imports', () => {
    const raw = cstimer({
      sessions: {
        session1: [row(1000, 'R U')],
        session2: [row(1000, 'R U')],
      },
      sessionData: {
        '1': {
          name: 'fto',
          opt: { scrType: 'fto' },
          date: [1700000000],
        },
        '2': {
          name: 'other',
          opt: { scrType: 'other-puzzle' },
          date: [1700000000],
        },
      },
    })
    const first = emptySessions(parseCsTimerBackup(raw, settings))
    const events = first.backup.sessions.sessions.map((session) => session.event)
    expect(new Set(events).size).toBe(2)
    expect(events).not.toContain('333')
    const definitions = first.backup.sessions.customEvents!
    expect(definitions).toHaveLength(2)

    const repeated = emptySessions(
      parseCsTimerBackup(raw, settings, {
        existingCustomEvents: definitions,
      }),
    )
    expect(repeated.backup.sessions.sessions.map((session) => session.event)).toEqual(
      events,
    )
    expect(repeated.backup.sessions.customEvents).toHaveLength(2)
    expect(repeated.preview.newCustomEventCount).toBe(0)
  })

  it('uses csTimer’s 333 default only when valid metadata omits scrType', () => {
    const raw = cstimer({
      sessions: {
        session1: [row()],
        session2: [row()],
        session3: [row()],
      },
      sessionData: {
        '1': { name: '9x9', opt: {}, date: [1700000000] },
        '2': { name: 'No opt', date: [1700000000] },
        '3': {
          name: 'Explicit WCA',
          opt: { scrType: '333wca' },
          date: [1700000000],
        },
      },
    })
    const result = emptySessions(parseCsTimerBackup(raw, settings))
    const [defaultWithEmptyOpt, defaultWithoutOpt, explicit] =
      result.backup.sessions.sessions

    expect(defaultWithEmptyOpt).toMatchObject({ name: '9x9', event: '333' })
    expect(defaultWithoutOpt).toMatchObject({ name: 'No opt', event: '333' })
    expect(explicit).toMatchObject({ name: 'Explicit WCA', event: '333' })
    expect(defaultWithEmptyOpt!.solves[0]!.importSource).toMatchObject({
      scrType: '333',
      scrTypeSource: 'default',
    })
    expect(defaultWithoutOpt!.solves[0]!.importSource).toMatchObject({
      scrType: '333',
      scrTypeSource: 'default',
    })
    expect(explicit!.solves[0]!.importSource).toMatchObject({
      scrType: '333wca',
      scrTypeSource: 'explicit',
    })
  })

  it.each([
    [
      'missing session metadata',
      cstimer({ sessions: { session1: [row()] }, omitProperties: true }),
      'unavailable',
    ],
    [
      'unreadable session metadata',
      cstimer({
        sessions: { session1: [row()] },
        sessionData: '{not json',
      }),
      'unavailable',
    ],
    [
      'non-object session metadata',
      cstimer({
        sessions: { session1: [row()] },
        sessionData: { '1': 'invalid' },
      }),
      'unavailable',
    ],
    [
      'non-object opt metadata',
      cstimer({
        sessions: { session1: [row()] },
        sessionData: {
          '1': { name: 'bad opt', opt: 'invalid', date: [1700000000] },
        },
      }),
      'unavailable',
    ],
    [
      'non-string explicit scrType',
      cstimer({
        sessions: { session1: [row()] },
        sessionData: {
          '1': { name: 'bad type', opt: { scrType: 42 }, date: [1700000000] },
        },
      }),
      'explicit',
    ],
    [
      'empty explicit scrType',
      cstimer({
        sessions: { session1: [row()] },
        sessionData: {
          '1': { name: 'empty type', opt: { scrType: '' }, date: [1700000000] },
        },
      }),
      'explicit',
    ],
  ])(
    'does not turn %s into 3×3',
    (_label, raw, expectedSource) => {
      const result = emptySessions(parseCsTimerBackup(raw, settings))
      const session = result.backup.sessions.sessions[0]!
      expect(session.event).not.toBe('333')
      expect(session.solves[0]!.event).toBe(session.event)
      expect(session.solves[0]!.importSource?.scrTypeSource).toBe(
        expectedSource,
      )
    },
  )

  it('allows naming new custom events internally without exposing it in the preview', () => {
    const raw = cstimer({
      sessions: { session1: [row()] },
      sessionData: {
        '1': { name: 'odd', opt: { scrType: 'odd' }, date: [1700000000] },
      },
    })
    const result = emptySessions(
      parseCsTimerBackup(raw, settings, {
        customEventNames: { odd: 'Odd puzzle' },
      }),
    )
    expect(result.backup.sessions.customEvents?.[0]?.name).toBe('Odd puzzle')
    expect(result.backup.sessions.sessions[0]!.event).toBe(
      result.backup.sessions.customEvents?.[0]?.id,
    )

    const collision = emptySessions(
      parseCsTimerBackup(raw, settings, {
        customEventNames: { odd: '3×3' },
      }),
    )
    expect(collision.backup.sessions.customEvents?.[0]?.name).toBe('3×3 (2)')
    expect(collision.preview.sessions[0]!.name).toBe('odd')
  })

  it('all-unknown input still imports as custom events', () => {
    const raw = cstimer({
      sessions: { session1: [row()] },
      sessionData: {
        '1': { name: 'u', opt: { scrType: 'oll' }, date: [1700000000] },
      },
    })
    const result = emptySessions(parseCsTimerBackup(raw, settings))
    expect(result.backup.sessions.sessions).toHaveLength(1)
    expect(result.backup.sessions.sessions[0]!.event).not.toBe('333')
  })

  it('preserves numeric session names and final preview names', () => {
    const raw = cstimer({
      sessions: {
        session1: [row()],
        session2: [row()],
        session3: [row()],
        session4: [row()],
      },
      sessionData: {
        '1': { name: 14, opt: {}, rank: 1, date: [1700000000] },
        '2': { name: 'Practice', opt: {}, rank: 2, date: [1700000000] },
        '3': { name: 'practice', opt: {}, rank: 3, date: [1700000000] },
        '4': {
          name: 'x'.repeat(45),
          opt: {},
          rank: 4,
          date: [1700000000],
        },
      },
    })
    const options = {
      existingSessionNames: ['14', 'Practice', 'Practice(1)'],
    }
    const analyzed = analyzeCsTimerBackup(raw, options)
    expect(analyzed.ok).toBe(true)
    if (!analyzed.ok) return
    const expectedNames = [
      '14(1)',
      'Practice(2)',
      'practice(3)',
      'x'.repeat(40),
    ]
    expect(analyzed.preview.sessions.map((session) => session.name)).toEqual(
      expectedNames,
    )

    const result = emptySessions(parseCsTimerBackup(raw, settings, options))
    expect(
      result.backup.sessions.sessions.map((session) => session.name),
    ).toEqual(expectedNames)
    expect(result.preview.sessions.map((session) => session.name)).toEqual(
      expectedNames,
    )
  })

  it('preserves a numeric session name when it is available', () => {
    const raw = cstimer({
      sessions: { session1: [row()] },
      sessionData: {
        '1': { name: 14, opt: { scrType: '333' }, date: [1700000000] },
      },
    })
    const result = emptySessions(parseCsTimerBackup(raw, settings))
    expect(result.backup.sessions.sessions[0]!.name).toBe('14')
    expect(result.preview.sessions[0]!.name).toBe('14')
  })

  it('numbers an already-numbered duplicate instead of appending another suffix', () => {
    const raw = cstimer({
      sessions: { session1: [row()] },
      sessionData: {
        '1': { name: 'Practice(1)', opt: {}, rank: 1, date: [1700000000] },
      },
    })
    const result = emptySessions(
      parseCsTimerBackup(raw, settings, {
        existingSessionNames: ['Practice(1)'],
      }),
    )
    expect(result.backup.sessions.sessions[0]!.name).toBe('Practice(2)')
    expect(result.preview.sessions[0]!.name).toBe('Practice(2)')
  })

  it('numbers repeated imports rather than merging or deduplicating sessions', () => {
    const raw = cstimer({
      sessions: {
        session1: [row()],
        session2: [row()],
      },
      sessionData: {
        '1': { name: 'Practice', opt: {}, rank: 1, date: [1700000000] },
        '2': { name: 'practice', opt: {}, rank: 2, date: [1700000000] },
      },
    })
    const first = emptySessions(parseCsTimerBackup(raw, settings))
    expect(
      first.backup.sessions.sessions.map((session) => session.name),
    ).toEqual(['Practice', 'practice(1)'])

    const repeated = emptySessions(
      parseCsTimerBackup(raw, settings, {
        existingSessionNames: first.backup.sessions.sessions.map(
          (session) => session.name,
        ),
      }),
    )
    expect(
      repeated.backup.sessions.sessions.map((session) => session.name),
    ).toEqual(['Practice(2)', 'practice(3)'])
    expect(repeated.backup.sessions.sessions).toHaveLength(2)
  })

  it('orders sessions by valid rank, ties, and session-number fallback', () => {
    const raw = cstimer({
      sessions: {
        session1: [row()],
        session2: [row()],
        session3: [row()],
        session4: [row()],
        session5: [row()],
      },
      sessionData: {
        '1': { name: 'Rank 30', opt: {}, rank: 30, date: [1700000000] },
        '2': { name: 'Tie A', opt: {}, rank: 10, date: [1700000000] },
        '3': { name: 'Tie B', opt: {}, rank: 10, date: [1700000000] },
        '4': { name: 'Missing rank', opt: {}, date: [1700000000] },
        '5': {
          name: 'Invalid rank',
          opt: {},
          rank: 'invalid',
          date: [1700000000],
        },
      },
    })
    const expected = [
      'Missing rank',
      'Invalid rank',
      'Tie A',
      'Tie B',
      'Rank 30',
    ]
    const analyzed = analyzeCsTimerBackup(raw)
    expect(analyzed.ok).toBe(true)
    if (!analyzed.ok) return
    expect(analyzed.preview.sessions.map((session) => session.name)).toEqual(
      expected,
    )

    const result = emptySessions(parseCsTimerBackup(raw, settings))
    expect(
      result.backup.sessions.sessions.map((session) => session.name),
    ).toEqual(expected)
  })

  it('shows accurate totals including empty sessions', () => {
    const raw = cstimer({
      sessions: {
        session1: [row(), row()],
        session2: [],
        session3: [],
        session4: [row()],
      },
      sessionData: {
        '1': { name: 'Two', opt: {}, rank: 1, date: [1700000000] },
        '2': { name: 'Zero A', opt: {}, rank: 2, date: [1700000000] },
        '3': { name: 'Zero B', opt: {}, rank: 3, date: [1700000000] },
        '4': { name: 'One', opt: {}, rank: 4, date: [1700000000] },
      },
    })
    const analyzed = analyzeCsTimerBackup(raw)
    expect(analyzed.ok).toBe(true)
    if (!analyzed.ok) return
    expect(analyzed.preview.totalSessions).toBe(4)
    expect(analyzed.preview.totalSolves).toBe(3)
    expect(
      analyzed.preview.sessions.map((session) => [
        session.name,
        session.solveCount,
      ]),
    ).toEqual([
      ['Two', 2],
      ['Zero A', 0],
      ['Zero B', 0],
      ['One', 1],
    ])
  })

  it('imports empty sessions with date fallback, persistence, and native round trips', () => {
    const before = Date.now()
    const raw = cstimer({
      sessions: {
        session1: [],
        session2: [],
        session3: [],
      },
      sessionData: {
        '1': {
          name: 'Dated empty',
          opt: { scrType: 'oll' },
          date: [1700000000],
        },
        '2': {
          name: 'Null date empty',
          opt: {},
          date: [null, null],
        },
        '3': {
          name: 'Invalid date empty',
          opt: {},
          date: [-1, 'invalid'],
        },
      },
    })
    const result = emptySessions(parseCsTimerBackup(raw, settings))
    const after = Date.now()
    const sessions = result.backup.sessions.sessions
    expect(sessions).toHaveLength(3)
    expect(result.preview.totalSessions).toBe(3)
    expect(result.preview.totalSolves).toBe(0)
    expect(sessions.map((session) => session.solves.length)).toEqual([0, 0, 0])
    expect(sessions[0]!.createdAt).toBe(1700000000000)
    expect(sessions[0]!.event).not.toBe('333')
    expect(sessions[1]!.event).toBe('333')
    expect(sessions[2]!.event).toBe('333')
    for (const session of sessions.slice(1)) {
      expect(session.createdAt).toBeGreaterThanOrEqual(before)
      expect(session.createdAt).toBeLessThanOrEqual(after)
    }

    const reloaded = parseSessionsData(
      JSON.parse(JSON.stringify(result.backup.sessions)),
    )
    expect(reloaded).toEqual(result.backup.sessions)

    const native = parseBackup(serializeBackup(result.backup))
    expect(native.ok).toBe(true)
    if (native.ok) {
      expect(native.backup.sessions).toEqual(result.backup.sessions)
      expect(native.backup.sessions.sessions.map((session) => session.name)).toEqual(
        ['Dated empty', 'Null date empty', 'Invalid date empty'],
      )
    }
  })

  it('imports a file containing only empty sessions', () => {
    const raw = cstimer({
      sessions: { session1: [], session2: [] },
      sessionData: {
        '1': { name: 'First empty', opt: {}, date: [1700000000] },
        '2': { name: 'Second empty', opt: {}, date: [null, null] },
      },
    })
    const result = emptySessions(parseCsTimerBackup(raw, settings))
    expect(result.backup.importMode).toBe('add')
    expect(result.backup.sessions.sessions).toHaveLength(2)
    expect(result.preview.totalSessions).toBe(2)
    expect(result.preview.totalSolves).toBe(0)
    expect(parseBackup(serializeBackup(result.backup)).ok).toBe(true)
  })
})

describe('csTimer numeric validation before preview and import', () => {
  const rowSource = (duration: string, date = '1700000001') =>
    `[[0,${duration}],"R U","incoming",${date}]`
  const raw = (entry: string) =>
    `{"session1":[[[2000,12345],"F R","keep",1700000000],${entry}]}`

  it.each(['1e400', '-1e400', '-1', 'null', '"invalid"'])(
    'rejects duration %s before preview without mutating existing local data',
    (duration) => {
      const before = localStorage.getItem('cubelab:sessions:v1')
      for (const result of [
        analyzeCsTimerBackup(raw(rowSource(duration))),
        parseCsTimerBackup(raw(rowSource(duration)), loadSettings()),
      ]) {
        expect(result.ok).toBe(false)
        if (!result.ok) {
          expect(result.error).toMatch(/session 1, solve 2.*duration/i)
        }
      }
      expect(localStorage.getItem('cubelab:sessions:v1')).toBe(before)
    },
  )

  it('rejects a missing duration instead of inventing a zero result', () => {
    expect(
      parseCsTimerBackup(raw('[[0],"R U","",1700000001]'), loadSettings()).ok,
    ).toBe(false)
  })

  it.each(['1e400', '1e308', '-1', '0', '8640000000001', 'null', '"invalid"'])(
    'rejects date %s before preview and import',
    (date) => {
      expect(analyzeCsTimerBackup(raw(rowSource('12000', date))).ok).toBe(false)
      expect(
        parseCsTimerBackup(raw(rowSource('12000', date)), loadSettings()).ok,
      ).toBe(false)
    },
  )

  it('rejects invalid session fallback dates when the session contains solves', () => {
    const invalid = JSON.stringify({
      session1: [[[0, 12000], 'R U']],
      properties: { sessionData: { '1': { date: [-1] } } },
    })
    expect(analyzeCsTimerBackup(invalid).ok).toBe(false)
    expect(parseCsTimerBackup(invalid, loadSettings()).ok).toBe(false)
  })

  it('preserves empty sessions with missing, null, or invalid dates', () => {
    const input = JSON.stringify({
      session1: [[[2000, 12345], 'R U', 'keep', 1700000000]],
      session2: [],
      session3: [],
      session4: [],
      properties: {
        sessionData: {
          '1': { name: 'Valid', opt: { scrType: '333' }, date: [1700000000] },
          '2': { name: 'Null date', opt: { scrType: '333' }, date: [null, null] },
          '3': { name: 'Missing date', opt: { scrType: '333' } },
          '4': {
            name: 'Invalid date',
            opt: { scrType: '333' },
            date: [-1],
          },
        },
      },
    })

    const analyzed = analyzeCsTimerBackup(input)
    expect(analyzed.ok).toBe(true)
    if (!analyzed.ok) return
    expect(analyzed.preview.totalSessions).toBe(4)
    expect(analyzed.preview.totalSolves).toBe(1)
    expect(analyzed.preview.sessions).toHaveLength(4)
    expect(
      analyzed.preview.sessions.map((session) => session.solveCount),
    ).toEqual([1, 0, 0, 0])

    const result = emptySessions(parseCsTimerBackup(input, loadSettings()))
    expect(result.backup.sessions.sessions).toHaveLength(4)
    expect(result.backup.sessions.sessions[0]).toMatchObject({
      name: 'Valid',
      event: '333',
    })
    expect(result.backup.sessions.sessions[0]!.solves[0]).toMatchObject({
      rawMs: 12345,
      penalty: '+2',
      scramble: 'R U',
      comment: 'keep',
      createdAt: 1700000000000,
    })
    expect(result.backup.sessions.sessions.slice(1).map((session) => session.name)).toEqual([
      'Null date',
      'Missing date',
      'Invalid date',
    ])
    expect(result.backup.sessions.customEvents).toBeUndefined()
  })

  it('rejects malformed supported rows and missing scrambles rather than overstating preview counts', () => {
    for (const entry of ['[]', 'null', '[[0,12000]]', '[[0,12000],null]']) {
      expect(analyzeCsTimerBackup(raw(entry)).ok).toBe(false)
      expect(parseCsTimerBackup(raw(entry), loadSettings()).ok).toBe(false)
    }
  })

  it('accepts empty-string scrambles, including for custom events', () => {
    const input = JSON.stringify({
      session1: [[[0, 12000], '', 'empty scramble', 1700000000]],
      properties: {
        sessionData: {
          '1': {
            name: 'Custom empty',
            opt: { scrType: 'fto' },
            date: [1700000000],
          },
        },
      },
    })
    const analyzed = analyzeCsTimerBackup(input)
    expect(analyzed.ok).toBe(true)
    if (analyzed.ok) expect(analyzed.preview.totalSolves).toBe(1)

    const result = emptySessions(parseCsTimerBackup(input, loadSettings()))
    const session = result.backup.sessions.sessions[0]!
    expect(session.event).toMatch(/^custom:/)
    expect(session.solves[0]).toMatchObject({
      event: session.event,
      scramble: '',
      rawMs: 12_000,
      comment: 'empty scramble',
    })
  })

  it('keeps valid numeric, zero and fractional results stable through export/storage reload', () => {
    const input =
      '{"session1":[[[2000,12345.75],"R U","note",1700000000],[0,"U R","zero",1700000001]]}'
    const result = emptySessions(parseCsTimerBackup(input, loadSettings()))
    expect(result.preview.totalSolves).toBe(2)
    expect(result.backup.importMode).toBe('add')
    const solves = result.backup.sessions.sessions[0]!.solves
    expect(
      solves.map((solve) => [
        solve.rawMs,
        solve.penalty,
        solve.comment,
        solve.createdAt,
      ]),
    ).toEqual([
      [0, 'none', 'zero', 1700000001000],
      [12345, '+2', 'note', 1700000000000],
    ])
    expect(
      parseSessionsData(JSON.parse(JSON.stringify(result.backup.sessions))),
    ).toEqual(result.backup.sessions)
    const native = parseBackup(serializeBackup(result.backup))
    expect(native.ok).toBe(true)
    if (native.ok) {
      expect(native.backup.sessions).toEqual(result.backup.sessions)
    }
  })

  it('retains the session-date fallback for missing solve dates and validates unknown-type rows', () => {
    const input =
      '{"session1":[[[0,12345],"R U"]],"properties":{"sessionData":{"1":{"date":[1700000000]}}}}'
    const result = emptySessions(parseCsTimerBackup(input, loadSettings()))
    expect(result.backup.sessions.sessions).toHaveLength(1)
    expect(result.backup.sessions.sessions[0]!.solves[0]!.createdAt).toBe(
      1700000000000,
    )

    const invalidUnknown =
      '{"session1":[[[0,12345],"R U"]],"session2":[[[0,1e400],"R U"]],"properties":{"sessionData":{"1":{"date":[1700000000]},"2":{"opt":{"scrType":"unknown"}}}}}'
    expect(parseCsTimerBackup(invalidUnknown, loadSettings()).ok).toBe(false)
  })
})
