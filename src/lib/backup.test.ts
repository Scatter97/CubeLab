import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from './storage'
import type { SessionsData, Solve } from '../types'
import {
  BACKUP_APP,
  BACKUP_FORMAT,
  BACKUP_VERSION,
  MAX_BACKUP_BYTES,
  backupFileName,
  createBackup,
  parseBackup,
  serializeBackup,
  serializeBackupChecked,
} from './backup'

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

function sessions(): SessionsData {
  return {
    activeSessionId: 'session-2',
    sessions: [
      {
        id: 'session-1',
        name: 'Morning',
        event: '333',
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_001_000,
        solves: [solve()],
      },
      {
        id: 'session-2',
        name: 'Evening',
        event: '333',
        createdAt: 1_700_000_002_000,
        updatedAt: 1_700_000_003_000,
        solves: [solve({ id: 'solve-2', penalty: '+2' })],
      },
    ],
  }
}

describe('backup format', () => {
  it('round-trips sessions and settings', () => {
    const backup = createBackup(
      sessions(),
      {
        ...DEFAULT_SETTINGS,
        inspectionEnabled: true,
        statMetricVisibility: {
          ...DEFAULT_SETTINGS.statMetricVisibility,
          target: true,
          bpa: true,
          wpa: true,
        },
      },
      new Date('2026-10-23T18:00:00.000Z'),
    )
    const result = parseBackup(serializeBackup(backup))

    expect(result).toEqual({ ok: true, backup })
    expect(backup.app).toBe(BACKUP_APP)
    expect(backup.format).toBe(BACKUP_FORMAT)
    expect(backup.version).toBe(BACKUP_VERSION)
  })

  it('round-trips session split transfer metadata', () => {
    const source = sessions()
    const withTransfer: SessionsData = {
      ...source,
      sessionTransfers: [
        {
          id: 'transfer-1',
          fromSessionId: 'session-1',
          toSessionId: 'session-2',
          solveIds: ['solve-1'],
          transferredAt: 1_700_000_004_000,
          byDeviceId: 'laptop',
        },
      ],
    }
    const backup = createBackup(withTransfer, DEFAULT_SETTINGS)
    const result = parseBackup(serializeBackup(backup))

    expect(result).toEqual({ ok: true, backup })
    expect(result.ok && result.backup.sessions.sessionTransfers).toEqual(
      withTransfer.sessionTransfers,
    )
  })

  it('round-trips a collection containing only empty sessions', () => {
    const empty: SessionsData = {
      activeSessionId: 'empty-2',
      sessions: [
        {
          id: 'empty-1',
          name: 'Empty one',
          event: '333',
          createdAt: 1_700_000_000_000,
          updatedAt: 1_700_000_000_000,
          solves: [],
        },
        {
          id: 'empty-2',
          name: 'Empty two',
          event: '444',
          createdAt: 1_700_000_001_000,
          updatedAt: 1_700_000_001_000,
          solves: [],
        },
      ],
    }
    const backup = createBackup(empty, DEFAULT_SETTINGS)
    const result = parseBackup(serializeBackup(backup))

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.backup.sessions).toEqual(empty)
  })

  it('preserves every supported solve puzzle event in backups', () => {
    const events = [
      '333',
      '222',
      '444',
      '333oh',
      '555',
      '666',
      '777',
      'pyram',
      'skewb',
      'sq1',
      'clock',
      'minx',
    ] as const
    const mixedSessions: SessionsData = {
      activeSessionId: `session-${events[events.length - 1]}`,
      sessions: events.map((event, index) => ({
        id: `session-${event}`,
        name: `Event ${event}`,
        event,
        createdAt: 1_700_000_000_000 + index * 2_000,
        updatedAt: 1_700_000_001_000 + index * 2_000,
        solves: [solve({ id: `solve-${event}`, event })],
      })),
    }
    const backup = createBackup(mixedSessions, {
      ...DEFAULT_SETTINGS,
      inspectionEnabled: false,
    })
    const result = parseBackup(serializeBackup(backup))

    expect(result).toEqual({ ok: true, backup })
    expect(
      result.ok
        ? result.backup.sessions.sessions.map((session) => session.solves[0]?.event)
        : [],
    ).toEqual([...events])
  })

  it('takes a detached snapshot', () => {
    const source = sessions()
    const backup = createBackup(source, { ...DEFAULT_SETTINGS, inspectionEnabled: false })
    const firstSolve = source.sessions[0]?.solves[0]
    if (!firstSolve) throw new Error('Fixture is missing a solve')
    firstSolve.rawMs = 99_999

    expect(backup.sessions.sessions[0]?.solves[0]?.rawMs).toBe(12_340)
  })

  it('builds a dated file name', () => {
    expect(backupFileName(new Date('2026-10-23T18:00:00.000Z'))).toBe(
      'cubelab-backup-2026-10-23.json',
    )
  })
})

describe('backup validation', () => {
  it('rejects malformed JSON', () => {
    expect(parseBackup('{not json')).toEqual({
      ok: false,
      error: 'That file is not valid JSON.',
    })
  })

  it('rejects another application or format', () => {
    const base = createBackup(sessions(), { ...DEFAULT_SETTINGS, inspectionEnabled: false })
    expect(parseBackup(JSON.stringify({ ...base, app: 'Other' }))).toEqual({
      ok: false,
      error: 'That file is not a CubeLab backup.',
    })
    expect(parseBackup(JSON.stringify({ ...base, format: 'other' }))).toEqual({
      ok: false,
      error: 'That file is not a CubeLab backup.',
    })
  })

  it('rejects unsupported versions and missing dates', () => {
    const base = createBackup(sessions(), { ...DEFAULT_SETTINGS, inspectionEnabled: false })
    expect(parseBackup(JSON.stringify({ ...base, version: 2 }))).toEqual({
      ok: false,
      error: 'This backup version is not supported.',
    })
    expect(parseBackup(JSON.stringify({ ...base, exportedAt: '' }))).toEqual({
      ok: false,
      error: 'The backup is missing its export date.',
    })
  })

  it('rejects backups without usable sessions or settings', () => {
    const base = createBackup(sessions(), { ...DEFAULT_SETTINGS, inspectionEnabled: false })
    expect(
      parseBackup(JSON.stringify({ ...base, sessions: { sessions: [] } })),
    ).toEqual({
      ok: false,
      error: 'The backup contains no valid sessions.',
    })
    expect(parseBackup(JSON.stringify({ ...base, settings: {} }))).toEqual({
      ok: false,
      error: 'The backup is missing valid settings.',
    })
  })

  it('keeps valid records while skipping corrupt ones', () => {
    const base = createBackup(sessions(), { ...DEFAULT_SETTINGS, inspectionEnabled: false })
    const payload = JSON.parse(serializeBackup(base)) as {
      sessions: { activeSessionId: string; sessions: unknown[] }
    }
    payload.sessions.activeSessionId = 'missing'
    payload.sessions.sessions.push(
      { id: 'broken', name: '', createdAt: 0, updatedAt: 0, solves: [] },
      {
        id: 'session-1',
        name: 'Duplicate ID',
        createdAt: 1,
        updatedAt: 1,
        solves: [],
      },
    )
    const first = payload.sessions.sessions[0] as {
      solves: unknown[]
    }
    first.solves.push(
      { ...solve({ id: '' }) },
      { ...solve() },
      { ...solve({ id: 'solve-2' }), rawMs: 9_000 },
    )

    const result = parseBackup(JSON.stringify(payload))
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.backup.sessions.activeSessionId).toBe('session-1')
    expect(result.backup.sessions.sessions).toHaveLength(2)
    expect(result.backup.sessions.sessions[0]?.solves.map((item) => item.id)).toEqual([
      'solve-1',
      'solve-2',
    ])
  })
})

describe('import trust boundaries', () => {
  it('rejects a session containing a solve from another event', () => {
    const backup = createBackup(sessions(), DEFAULT_SETTINGS)
    const mixed = {
      ...backup,
      sessions: {
        ...backup.sessions,
        sessions: backup.sessions.sessions.map((session, index) =>
          index === 0
            ? {
                ...session,
                solves: [solve({ id: 'mixed', event: '222' })],
              }
            : session,
        ),
      },
    }

    const result = parseBackup(JSON.stringify(mixed))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('Session "Morning"')
    expect(result.error).toContain('222')
    expect(result.error).toContain('did not change your local data')
  })

  it('rejects a session mixing a new puzzle event with its session event', () => {
    const backup = createBackup(sessions(), DEFAULT_SETTINGS)
    const mixed = {
      ...backup,
      sessions: {
        ...backup.sessions,
        sessions: backup.sessions.sessions.map((session, index) =>
          index === 0
            ? {
                ...session,
                event: 'pyram',
                solves: [solve({ id: 'mixed-pyram', event: 'skewb' })],
              }
            : session,
        ),
      },
    }

    const result = parseBackup(JSON.stringify(mixed))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('pyram')
    expect(result.error).toContain('skewb')
    expect(result.error).toContain('did not change your local data')
  })

  it('keeps legacy backups without a session event compatible', () => {
    const backup = createBackup(sessions(), DEFAULT_SETTINGS)
    const legacy = {
      ...backup,
      sessions: {
        ...backup.sessions,
        sessions: backup.sessions.sessions.map((session) => {
          const { event: _event, ...rest } = session
          return rest
        }),
      },
    }

    const result = parseBackup(JSON.stringify(legacy))
    expect(result.ok).toBe(true)
  })

  it.each([
    ['null tombstone', { tombstones: [null] }],
    ['malformed tombstone date', { tombstones: [{ kind: 'solve', id: 's', deletedAt: 'x', deletedByDeviceId: 'd' }] }],
    ['empty tombstone id', { tombstones: [{ kind: 'solve', id: '', deletedAt: 1, deletedByDeviceId: 'd' }] }],
    ['missing conflict values', { conflicts: [{ id: 'c', kind: 'solve', field: 'penalty', localUpdatedAt: 1, remoteUpdatedAt: 2, resolution: 'local', updatedAt: 3 }] }],
    ['invalid redirect', { sessionRedirects: [{ fromId: 'a', toId: 'a', approvedAt: 1 }] }],
    ['malformed redirect date', { sessionRedirects: [{ fromId: 'a', toId: 'b', approvedAt: 'x' }] }],
  ])('rejects a sync envelope with %s', (_label, change) => {
    const backup = createBackup(sessions(), DEFAULT_SETTINGS, new Date(), {
      protocolVersion: 1,
      revision: 2,
      deviceId: 'device-a',
      updatedAt: 1_700_000_000_000,
      tombstones: [],
      conflicts: [],
      sessionRedirects: [],
    })
    const payload = {
      ...backup,
      sync: { ...backup.sync, ...change },
    }

    const result = parseBackup(JSON.stringify(payload))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('malformed synchronization envelope')
  })

  it('accepts a valid restored tombstone', () => {
    const backup = createBackup(sessions(), DEFAULT_SETTINGS, new Date(), {
      protocolVersion: 1,
      revision: 2,
      deviceId: 'device-a',
      updatedAt: 1_700_000_000_000,
      tombstones: [
        {
          kind: 'solve',
          id: 'solve-1',
          deletedAt: 10,
          deletedByDeviceId: 'device-a',
          restoredAt: 20,
        },
      ],
      conflicts: [],
      sessionRedirects: [],
    })

    expect(parseBackup(JSON.stringify(backup)).ok).toBe(true)
  })

  it('detaches nested settings from later mutation', () => {
    const live = {
      ...DEFAULT_SETTINGS,
      statVisibility: { ...DEFAULT_SETTINGS.statVisibility },
      customAverages: [{ id: 'custom', size: 7, visible: true }],
      statMetricVisibility: {
        ...DEFAULT_SETTINGS.statMetricVisibility,
        target: true,
        bpa: true,
      },
      statTargetsMs: { '333': { ao5: 15_000 } },
    }
    const backup = createBackup(sessions(), live)

    live.statVisibility.ao5 = false
    live.customAverages[0]!.visible = false
    live.statMetricVisibility.bpa = false
    live.statTargetsMs['333']!.ao5 = 12_000

    expect(backup.settings.statVisibility.ao5).toBe(true)
    expect(backup.settings.customAverages[0]?.visible).toBe(true)
    expect(backup.settings.statMetricVisibility.bpa).toBe(true)
    expect(backup.settings.statTargetsMs['333']?.ao5).toBe(15_000)
  })
})

it('preserves trimming choices in backups and upgrades older backups to 5% / Auto', () => {
  const backup = createBackup(sessions(), { ...DEFAULT_SETTINGS, averageTrimBetter: 'p10', averageTrimWorse: '1' })
  const roundTrip = parseBackup(serializeBackup(backup))
  expect(roundTrip).toEqual({ ok: true, backup })
  const old = JSON.parse(serializeBackup(backup))
  delete old.settings.averageTrimBetter
  delete old.settings.averageTrimWorse
  delete old.settings.statMetricVisibility
  const migrated = parseBackup(JSON.stringify(old))
  expect(migrated.ok).toBe(true)
  if (migrated.ok) {
    expect(migrated.backup.settings).toMatchObject({
      averageTrimBetter: 'p5',
      averageTrimWorse: 'auto',
      statMetricVisibility: DEFAULT_SETTINGS.statMetricVisibility,
    })
    expect(migrated.backup.sessions).toEqual(backup.sessions)
  }
})

describe('custom event backups', () => {
  it('round-trips definitions, custom solves and import provenance', () => {
    const customId = 'custom:cstimer:fto-12345678'
    const data: SessionsData = {
      activeSessionId: 'custom-session',
      customEvents: [
        {
          id: customId,
          name: 'FTO',
          placeholder: 'No scramble for FTO',
          createdAt: 1_700_000_000_000,
          updatedAt: 1_700_000_002_000,
          fieldUpdates: {
            name: { updatedAt: 1_700_000_001_000, editorId: 'laptop' },
          },
          source: { provider: 'cstimer', identifiers: ['fto'] },
        },
      ],
      sessions: [
        {
          id: 'custom-session',
          name: 'FTO session',
          event: customId,
          createdAt: 1_700_000_000_000,
          updatedAt: 1_700_000_002_000,
          solves: [
            solve({
              id: 'custom-solve',
              event: customId,
              scramble: 'custom scramble',
              importSource: {
                provider: 'cstimer',
                scrType: 'fto',
                sessionNumber: 1,
                solveIndex: 0,
              },
              fieldUpdates: {
                event: { updatedAt: 1_700_000_002_000, editorId: 'laptop' },
              },
            }),
          ],
        },
      ],
    }
    const backup = createBackup(data, DEFAULT_SETTINGS)
    const result = parseBackup(serializeBackup(backup))
    expect(result).toEqual({ ok: true, backup })
    if (!result.ok) return
    expect(result.backup.sessions).toEqual(data)
  })

  it('preserves empty scrambles and unknown event IDs', () => {
    const data: SessionsData = {
      activeSessionId: 'unknown-session',
      sessions: [
        {
          id: 'unknown-session',
          name: 'Blindfold',
          event: '333bf',
          createdAt: 1_700_000_000_000,
          updatedAt: 1_700_000_001_000,
          solves: [
            solve({
              id: 'empty-scramble',
              event: '333bf',
              scramble: '',
            }),
          ],
        },
      ],
    }

    const backup = createBackup(data, DEFAULT_SETTINGS)
    const result = parseBackup(serializeBackup(backup))
    expect(result).toEqual({ ok: true, backup })
    if (!result.ok) return
    expect(result.backup.sessions).toEqual(data)
    expect(result.backup.sessions.sessions[0]!.event).toBe('333bf')
    expect(result.backup.sessions.sessions[0]!.solves[0]).toMatchObject({
      event: '333bf',
      scramble: '',
    })
  })
})

describe('checked backup serialization', () => {
  function fixture(comment = '') {
    const data = sessions()
    data.sessions[0]!.solves[0] = solve({ comment })
    return createBackup(data, DEFAULT_SETTINGS)
  }

  it('keeps readable formatting when the complete payload is exactly at the limit', () => {
    const backup = fixture()
    const pretty = serializeBackup(backup)
    const limit = new TextEncoder().encode(pretty).byteLength
    const result = serializeBackupChecked(backup, { limit, validate: true })

    expect(result).toMatchObject({
      ok: true,
      raw: pretty,
      bytes: limit,
      compact: false,
    })
    if (!result.ok) return
    expect(parseBackup(result.raw).ok).toBe(true)
  })

  it('falls back to compact JSON only when that makes the full payload readable', () => {
    const backup = fixture('é'.repeat(120))
    const pretty = serializeBackup(backup)
    const compact = JSON.stringify(backup)
    const prettyBytes = new TextEncoder().encode(pretty).byteLength
    const compactBytes = new TextEncoder().encode(compact).byteLength
    expect(compactBytes).toBeLessThan(prettyBytes)

    const result = serializeBackupChecked(backup, {
      limit: compactBytes,
      validate: true,
    })
    expect(result).toMatchObject({
      ok: true,
      raw: compact,
      bytes: compactBytes,
      compact: true,
    })
    if (!result.ok) return
    const parsed = parseBackup(result.raw)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.backup.sessions.sessions[0]?.solves[0]?.comment).toBe(
      'é'.repeat(120),
    )
  })

  it('rejects the compact payload when it is still over the limit', () => {
    const backup = fixture('é'.repeat(120))
    const compactBytes = new TextEncoder().encode(
      JSON.stringify(backup),
    ).byteLength
    const limit = compactBytes - 1
    const result = serializeBackupChecked(backup, { limit })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.bytes).toBe(compactBytes)
    expect(result.limit).toBe(limit)
    expect(result.error).toContain('backup limit was exceeded')
    expect(result.error).toContain('MB')
  })

  it('uses the shared 10 MB reader cap by default', () => {
    const backup = fixture()
    const result = serializeBackupChecked(backup, { validate: true })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.bytes).toBeLessThanOrEqual(MAX_BACKUP_BYTES)
  })
})

describe('backup session ordering', () => {
  it('round-trips order metadata without changing session or solve data', () => {
    const data: SessionsData = {
      ...sessions(),
      sessionOrder: {
        ids: ['session-2', 'session-1'],
        updatedAt: 1_700_000_004_000,
        editorId: 'laptop',
      },
    }
    const backup = createBackup(data, DEFAULT_SETTINGS)
    const raw = serializeBackup(backup)
    const result = parseBackup(raw)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.backup.sessions.sessionOrder).toEqual(data.sessionOrder)
    expect(result.backup.sessions.sessions.map((entry) => entry.id)).toEqual([
      'session-2',
      'session-1',
    ])
    expect(result.backup.sessions.sessions[0]?.solves[0]?.id).toBe('solve-2')
  })
})
