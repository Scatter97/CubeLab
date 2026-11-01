import { describe, expect, it } from 'vitest'
import { analyzeCsTimerBackup, isCsTimerBackup, parseCsTimerBackup } from './csTimerImport'
import { loadSettings } from './storage'

describe('isCsTimerBackup', () => {
  it('detects session keys', () => {
    expect(isCsTimerBackup('{"session1":[]}')).toBe(true)
    expect(isCsTimerBackup('{"foo":"bar"}')).toBe(false)
    expect(isCsTimerBackup('not json')).toBe(false)
  })
})

describe('analyzeCsTimerBackup', () => {
  it('rejects invalid json', () => {
    const r = analyzeCsTimerBackup('not json')
    expect(r.ok).toBe(false)
  })
  it('rejects missing sessions', () => {
    const r = analyzeCsTimerBackup('{"foo":1}')
    expect(r.ok).toBe(false)
  })
})

describe('parseCsTimerBackup', () => {
  const settings = loadSettings()

  it('handles penalty codes without doubling +2', () => {
    const raw = JSON.stringify({
      session1: [[[2000, 12345], 'R U', 'comment', 1700000000]],
      properties: { sessionData: JSON.stringify({ '1': { name: 's', opt: { scrType: '333' }, date: [1700000000, 1700000000] } }) },
    })
    const r = parseCsTimerBackup(raw, settings)
    expect(r.ok).toBe(true)
    if (r.ok) {
      const solve = r.backup.sessions.sessions[0]!.solves[0]!
      expect(solve.rawMs).toBe(12345)
      expect(solve.penalty).toBe('+2')
    }
  })

  it('handles DNF', () => {
    const raw = JSON.stringify({
      session1: [[[-1, 5000], 'R U', '', 1700000000]],
      properties: { sessionData: JSON.stringify({ '1': { name: 's', opt: { scrType: '333' }, date: [1700000000, 1700000000] } }) },
    })
    const r = parseCsTimerBackup(raw, settings)
    expect(r.ok).toBe(true)
    if (r.ok) {
      const solve = r.backup.sessions.sessions[0]!.solves[0]!
      expect(solve.penalty).toBe('dnf')
    }
  })

  it('converts unix seconds to ms', () => {
    const raw = JSON.stringify({
      session1: [[[0, 1000], 'R U', 'c', 1700000000]],
      properties: { sessionData: JSON.stringify({ '1': { name: 's', opt: { scrType: '333' }, date: [1700000000, 1700000000] } }) },
    })
    const r = parseCsTimerBackup(raw, settings)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.backup.sessions.sessions[0]!.solves[0]!.createdAt).toBe(1700000000000)
    }
  })

  it('preserves empty sessions', () => {
    const raw = JSON.stringify({
      session1: [],
      properties: { sessionData: JSON.stringify({ '1': { name: 'empty', opt: { scrType: '333' }, date: [1700000000, 1700000000] } }) },
    })
    const r = parseCsTimerBackup(raw, settings)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.backup.sessions.sessions[0]!.solves).toHaveLength(0)
    }
  })

  it('ignores 5th element without rejecting', () => {
    const raw = JSON.stringify({
      session1: [[[0, 2000], 'R U', '', 1700000000, ['x@1', 'y@2']]],
      properties: { sessionData: JSON.stringify({ '1': { name: 's', opt: { scrType: '333' }, date: [1700000000, 1700000000] } }) },
    })
    const r = parseCsTimerBackup(raw, settings)
    expect(r.ok).toBe(true)
  })

  it('skips unknown puzzle sessions, marks them unsupported', () => {
    const raw = JSON.stringify({
      session1: [[[0, 1000], 'R U', '', 1700000000]],
      session2: [[[0, 1000], 'R U', '', 1700000000]],
      properties: { sessionData: JSON.stringify({
        '1': { name: 'known', opt: { scrType: '333' }, date: [1700000000, 1700000000] },
        '2': { name: 'unknown', opt: { scrType: 'oll' }, date: [1700000000, 1700000000] },
      }) },
    })
    const a = analyzeCsTimerBackup(raw)
    expect(a.ok).toBe(true)
    if (a.ok) {
      expect(a.preview.totalSessions).toBe(2)
      expect(a.preview.supportedSessions).toBe(1)
      expect(a.preview.skippedSessions).toBe(1)
      expect(a.preview.hasUnknown).toBe(true)
    }
    const r = parseCsTimerBackup(raw, settings)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.backup.sessions.sessions.length).toBe(1)
      expect(r.backup.sessions.sessions[0]!.name).toBe('known')
    }
  })

  it('all-unknown returns error', () => {
    const raw = JSON.stringify({
      session1: [[[0, 1000], 'R U', '', 1700000000]],
      properties: { sessionData: JSON.stringify({ '1': { name: 'u', opt: { scrType: 'oll' }, date: [1700000000, 1700000000] } }) },
    })
    const r = parseCsTimerBackup(raw, settings)
    expect(r.ok).toBe(false)
  })
})
