import { describe, expect, it } from 'vitest'
import type { Session, SessionsData, Solve } from '../types'
import {
  DEFAULT_SETTINGS,
  SESSIONS_STORAGE_KEY,
  SETTINGS_STORAGE_KEY,
  SOLVES_STORAGE_KEY,
  loadSessions,
  loadSettings,
  loadSolves,
  parseSettingsData,
  saveSessions,
  saveSettings,
  type StorageLike,
} from './storage'
import { DEFAULT_SESSION_NAME } from './sessions'

class MemoryStorage implements StorageLike {
  private values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }

  seed(key: string, value: string): void {
    this.values.set(key, value)
  }
}

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

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    name: DEFAULT_SESSION_NAME,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    solves: [],
    ...overrides,
  }
}

function sessionsData(overrides: Partial<SessionsData> = {}): SessionsData {
  return {
    activeSessionId: 'session-1',
    sessions: [session()],
    ...overrides,
  }
}

function seedLegacy(storage: MemoryStorage, solves: readonly Solve[]): void {
  storage.seed(SOLVES_STORAGE_KEY, JSON.stringify({ version: 1, solves }))
}

describe('legacy solve persistence', () => {
  it('reads valid legacy solves from storage', () => {
    const storage = new MemoryStorage()
    const original = [
      solve(),
      solve({
        id: 'solve-2',
        rawMs: 9_999,
        penalty: '+2',
        createdAt: 1_700_000_001_000,
      }),
      solve({
        id: 'solve-3',
        rawMs: 11_111,
        penalty: 'dnf',
        createdAt: 1_700_000_002_000,
      }),
    ]

    seedLegacy(storage, original)
    expect(loadSolves(storage)).toEqual(original)
  })

  it('filters invalid and duplicate legacy records without losing valid solves', () => {
    const storage = new MemoryStorage()
    storage.seed(
      SOLVES_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        solves: [
          solve(),
          { ...solve(), id: '', rawMs: 10 },
          { ...solve(), id: 'bad-penalty', penalty: 'double' },
          { ...solve(), id: 'bad-event', event: '222' },
          solve({ id: 'duplicate-id' }),
          { ...solve(), id: 'duplicate-id', rawMs: 99_999 },
          solve({ id: 'valid-2', rawMs: 10_000 }),
        ],
      }),
    )

    const loaded = loadSolves(storage)
    expect(loaded.map((item) => item.id)).toEqual([
      'solve-1',
      'duplicate-id',
      'valid-2',
    ])
  })

  it('recovers safely from corrupt legacy JSON', () => {
    const storage = new MemoryStorage()
    storage.seed(SOLVES_STORAGE_KEY, '{not valid json')
    expect(loadSolves(storage)).toEqual([])
  })

  it('rejects an unknown legacy storage version', () => {
    const storage = new MemoryStorage()
    storage.seed(
      SOLVES_STORAGE_KEY,
      JSON.stringify({ version: 99, solves: [solve()] }),
    )
    expect(loadSolves(storage)).toEqual([])
  })
})

describe('session persistence', () => {
  it('creates one empty default session when no data exists', () => {
    const loaded = loadSessions(new MemoryStorage())
    expect(loaded.sessions).toHaveLength(1)
    expect(loaded.sessions[0]).toMatchObject({
      name: DEFAULT_SESSION_NAME,
      solves: [],
    })
    expect(loaded.sessions[0]?.createdAt).toBeGreaterThan(0)
    expect(loaded.activeSessionId).toBe(loaded.sessions[0]?.id)
  })

  it('round-trips multiple sessions and the active session', () => {
    const storage = new MemoryStorage()
    const original = sessionsData({
      activeSessionId: 'session-2',
      sessions: [
        session({ solves: [solve()] }),
        session({
          id: 'session-2',
          name: 'Evening',
          solves: [solve({ id: 'solve-2', penalty: '+2' })],
        }),
      ],
    })

    expect(saveSessions(original, storage)).toBe(true)
    expect(loadSessions(storage)).toEqual(original)
  })

  it('migrates a valid legacy single session', () => {
    const storage = new MemoryStorage()
    seedLegacy(storage, [
      solve({ id: 'newer', createdAt: 1_700_000_002_000 }),
      solve({ id: 'older', createdAt: 1_700_000_001_000 }),
    ])

    const loaded = loadSessions(storage)
    expect(loaded.sessions).toHaveLength(1)
    expect(loaded.sessions[0]?.name).toBe(DEFAULT_SESSION_NAME)
    expect(loaded.sessions[0]?.solves.map((item) => item.id)).toEqual([
      'newer',
      'older',
    ])
    expect(loaded.sessions[0]?.createdAt).toBe(1_700_000_001_000)
    expect(loaded.sessions[0]?.updatedAt).toBe(1_700_000_002_000)
    expect(loaded.activeSessionId).toBe(loaded.sessions[0]?.id)
  })

  it('prefers valid session data over the legacy record', () => {
    const storage = new MemoryStorage()
    seedLegacy(storage, [solve({ id: 'legacy' })])
    saveSessions(
      sessionsData({
        sessions: [
          session({ solves: [solve({ id: 'current' })] }),
        ],
      }),
      storage,
    )

    expect(loadSessions(storage).sessions[0]?.solves[0]?.id).toBe('current')
  })

  it('falls back to the legacy record when session data is corrupt', () => {
    const storage = new MemoryStorage()
    seedLegacy(storage, [solve({ id: 'legacy' })])
    storage.seed(SESSIONS_STORAGE_KEY, '{not valid json')

    expect(loadSessions(storage).sessions[0]?.solves[0]?.id).toBe('legacy')
  })

  it('filters invalid and duplicate sessions and solves', () => {
    const storage = new MemoryStorage()
    storage.seed(
      SESSIONS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        activeSessionId: 'missing',
        sessions: [
          session({
            solves: [
              solve(),
              { ...solve(), id: 'bad-solve', rawMs: -1 },
              solve({ id: 'duplicate-solve' }),
              { ...solve(), id: 'duplicate-solve', rawMs: 99_999 },
            ],
          }),
          { ...session(), id: '', name: 'Broken' },
          session({ id: 'session-1', name: 'Duplicate session' }),
          session({
            id: 'session-2',
            name: '  Evening  ',
            solves: [solve({ id: 'solve-2' })],
          }),
        ],
      }),
    )

    const loaded = loadSessions(storage)
    expect(loaded.activeSessionId).toBe('session-1')
    expect(loaded.sessions.map((item) => item.id)).toEqual([
      'session-1',
      'session-2',
    ])
    expect(loaded.sessions[0]?.solves.map((item) => item.id)).toEqual([
      'solve-1',
      'duplicate-solve',
    ])
    expect(loaded.sessions[1]?.name).toBe('Evening')
  })

  it('falls back to legacy when the sessions version is unsupported', () => {
    const storage = new MemoryStorage()
    seedLegacy(storage, [solve({ id: 'legacy' })])
    storage.seed(
      SESSIONS_STORAGE_KEY,
      JSON.stringify({ version: 2, sessions: [] }),
    )

    expect(loadSessions(storage).sessions[0]?.solves[0]?.id).toBe('legacy')
  })

  it('recovers with a default session when storage access throws', () => {
    const storage: StorageLike = {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => undefined,
    }
    expect(loadSessions(storage).sessions).toHaveLength(1)
  })

  it('reports failure when a session write is rejected', () => {
    const storage: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    }
    expect(saveSessions(sessionsData(), storage)).toBe(false)
  })
})

describe('settings persistence', () => {
  it('uses safe defaults when empty', () => {
    expect(loadSettings(new MemoryStorage())).toEqual(DEFAULT_SETTINGS)
  })

  it('round-trips the complete settings object', () => {
    const storage = new MemoryStorage()
    saveSettings({ ...DEFAULT_SETTINGS, inspectionEnabled: true }, storage)
    expect(loadSettings(storage)).toEqual({
      ...DEFAULT_SETTINGS,
      inspectionEnabled: true,
    })
  })

  it('accepts custom hold and zoom values inside their supported ranges', () => {
    expect(
      parseSettingsData({
        inspectionEnabled: false,
        holdDurationMs: 1_200,
        uiZoomPercent: 125,
      }),
    ).toMatchObject({
      holdDurationMs: 1_200,
      uiZoomPercent: 125,
    })
  })

  it('falls back for out-of-range hold and zoom values', () => {
    expect(
      parseSettingsData({
        inspectionEnabled: false,
        holdDurationMs: 10_001,
        uiZoomPercent: 200,
      }),
    ).toMatchObject({
      holdDurationMs: DEFAULT_SETTINGS.holdDurationMs,
      uiZoomPercent: DEFAULT_SETTINGS.uiZoomPercent,
    })
  })

  it('parses alert, appearance, and statistics preferences', () => {
    expect(
      parseSettingsData({
        inspectionEnabled: true,
        alertChannel: 'sound-haptic',
        inspectionWarning: '12s',
        accentColor: 'violet',
        statPrecision: 'tenths',
        statVisibility: {
          single: false,
          mo3: true,
          ao5: false,
          ao12: true,
        },
      }),
    ).toMatchObject({
      alertChannel: 'sound-haptic',
      inspectionWarning: '12s',
      accentColor: 'violet',
      statPrecision: 'tenths',
      statVisibility: {
        single: false,
        mo3: true,
        ao5: false,
        ao12: true,
      },
    })
  })

  it('falls back field-by-field for invalid newer preferences', () => {
    expect(
      parseSettingsData({
        inspectionEnabled: true,
        alertChannel: 'telepathy',
        inspectionWarning: '5s',
        accentColor: 'red',
        statPrecision: 'minutes',
        statVisibility: {
          single: false,
          mo3: 'yes',
          ao5: null,
        },
      }),
    ).toMatchObject({
      alertChannel: DEFAULT_SETTINGS.alertChannel,
      inspectionWarning: DEFAULT_SETTINGS.inspectionWarning,
      accentColor: DEFAULT_SETTINGS.accentColor,
      statPrecision: DEFAULT_SETTINGS.statPrecision,
      statVisibility: {
        single: false,
        mo3: true,
        ao5: true,
        ao12: true,
      },
    })
  })

  it('upgrades a v1 record with defaults for newer preferences', () => {
    expect(parseSettingsData({ inspectionEnabled: true })).toEqual({
      ...DEFAULT_SETTINGS,
      inspectionEnabled: true,
    })
  })

  it('upgrades a v2 record with defaults for v3 preferences', () => {
    const storage = new MemoryStorage()
    storage.seed(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({
        version: 2,
        settings: {
          inspectionEnabled: true,
          timerUpdateMode: 'tenths',
          holdDurationMs: 500,
          showTimerDecimalSmall: true,
          uiZoomPercent: 90,
          scrambleAlignment: 'right',
          scrambleLimitHeight: true,
          scrambleAction: 'next',
        },
      }),
    )
    expect(loadSettings(storage)).toEqual({
      ...DEFAULT_SETTINGS,
      inspectionEnabled: true,
      timerUpdateMode: 'tenths',
      holdDurationMs: 500,
      showTimerDecimalSmall: true,
      uiZoomPercent: 90,
      scrambleAlignment: 'right',
      scrambleLimitHeight: true,
      scrambleAction: 'next',
    })
  })

  it('falls back on malformed settings', () => {
    const storage = new MemoryStorage()
    storage.seed(SETTINGS_STORAGE_KEY, '["unexpected"]')
    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS)
  })

  it('falls back when the version is unsupported', () => {
    const storage = new MemoryStorage()
    storage.seed(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ version: 4, settings: { inspectionEnabled: true } }),
    )
    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS)
  })
})
