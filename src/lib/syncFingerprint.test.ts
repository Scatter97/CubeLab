import { describe, expect, it } from 'vitest'
import { syncStateFingerprint } from './syncFingerprint'
import { DEFAULT_SETTINGS } from './storage'
import type { SessionsData } from '../types'

describe('syncStateFingerprint', () => {
  it('memoizes the latest immutable identity pair', () => {
    let reads = 0
    const sessions: SessionsData = {
      activeSessionId: 'session-1',
      sessions: [],
    }
    Object.defineProperty(sessions, 'activeSessionId', {
      configurable: true,
      get() {
        reads += 1
        return 'session-1'
      },
    })
    const first = syncStateFingerprint(sessions, DEFAULT_SETTINGS)
    const second = syncStateFingerprint(sessions, DEFAULT_SETTINGS)
    expect(second).toBe(first)
    expect(reads).toBe(1)
  })

  it('recomputes when either identity changes', () => {
    const sessions: SessionsData = { activeSessionId: 'session-1', sessions: [] }
    const first = syncStateFingerprint(sessions, DEFAULT_SETTINGS)
    const changedSessions = { ...sessions, activeSessionId: 'session-2' }
    expect(syncStateFingerprint(changedSessions, DEFAULT_SETTINGS)).not.toBe(
      first,
    )
    const changedSettings = { ...DEFAULT_SETTINGS, theme: 'dark' as const }
    expect(syncStateFingerprint(sessions, changedSettings)).not.toBe(first)
  })
})
