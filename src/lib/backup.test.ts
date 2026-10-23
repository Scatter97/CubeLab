import { describe, expect, it } from 'vitest'
import type { SessionsData, Solve } from '../types'
import {
  BACKUP_APP,
  BACKUP_FORMAT,
  BACKUP_VERSION,
  backupFileName,
  createBackup,
  parseBackup,
  serializeBackup,
} from './backup'

function solve(overrides: Partial<Solve> = {}): Solve {
  return {
    id: 'solve-1',
    event: '333',
    rawMs: 12_340,
    penalty: 'none',
    scramble: "R U R' U'",
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
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_001_000,
        solves: [solve()],
      },
      {
        id: 'session-2',
        name: 'Evening',
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
      { inspectionEnabled: true },
      new Date('2026-10-23T18:00:00.000Z'),
    )
    const result = parseBackup(serializeBackup(backup))

    expect(result).toEqual({ ok: true, backup })
    expect(backup.app).toBe(BACKUP_APP)
    expect(backup.format).toBe(BACKUP_FORMAT)
    expect(backup.version).toBe(BACKUP_VERSION)
  })

  it('takes a detached snapshot', () => {
    const source = sessions()
    const backup = createBackup(source, { inspectionEnabled: false })
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
    const base = createBackup(sessions(), { inspectionEnabled: false })
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
    const base = createBackup(sessions(), { inspectionEnabled: false })
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
    const base = createBackup(sessions(), { inspectionEnabled: false })
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
    const base = createBackup(sessions(), { inspectionEnabled: false })
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
