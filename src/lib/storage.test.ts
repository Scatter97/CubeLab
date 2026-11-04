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
    comment: '',
    createdAt: 1_700_000_000_000,
    ...overrides,
  }
}

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    name: DEFAULT_SESSION_NAME,
    event: '333',
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

  it('rejects legacy records tagged with a non-3x3 event', () => {
    const storage = new MemoryStorage()
    seedLegacy(storage, [
      solve({ id: 'legacy-333' }),
      solve({ id: 'legacy-222', event: '222' }),
      solve({ id: 'legacy-444', event: '444' }),
      solve({ id: 'legacy-oh', event: '333oh' }),
      solve({ id: 'legacy-555', event: '555' }),
      solve({ id: 'legacy-666', event: '666' }),
      solve({ id: 'legacy-777', event: '777' }),
    ])

    expect(loadSolves(storage).map((item) => item.id)).toEqual([
      'legacy-333',
    ])
    expect(loadSessions(storage).sessions[0]?.solves.map((item) => item.id)).toEqual([
      'legacy-333',
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
      JSON.stringify({ version: 3, solves: [solve()] }),
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
        session({
          solves: [solve({ comment: 'First solve' })],
          inspectionEnabled: false,
        }),
        session({
          id: 'session-2',
          name: 'Evening',
          solves: [
            solve({ id: 'solve-2', penalty: '+2', comment: 'Locked up' }),
          ],
          inspectionEnabled: true,
        }),
      ],
    })

    expect(saveSessions(original, storage)).toBe(true)
    expect(loadSessions(storage)).toEqual(original)
  })

  it('round-trips per-field session sync metadata', () => {
    const storage = new MemoryStorage()
    const original = sessionsData({
      sessions: [
        session({
          fieldUpdates: {
            name: { updatedAt: 1, editorId: 'laptop' },
            event: { updatedAt: 2, editorId: 'laptop' },
            inspectionEnabled: { updatedAt: 3, editorId: 'laptop' },
            preferences: {
              timerUpdateMode: { updatedAt: 4, editorId: 'phone' },
              inspectionWarning8s: { updatedAt: 5, editorId: 'phone' },
            },
          },
        }),
      ],
    })

    expect(saveSessions(original, storage)).toBe(true)
    expect(loadSessions(storage)).toEqual(original)
  })

  it('drops malformed session field metadata without losing the session', () => {
    const storage = new MemoryStorage()
    const malformedMetadata = {
      name: { updatedAt: 10, editorId: 'laptop' },
      event: { updatedAt: -1, editorId: 'laptop' },
      inspectionEnabled: { updatedAt: 20, editorId: '' },
      preferences: {
        timerUpdateMode: { updatedAt: 30, editorId: 'phone' },
        unknownPreference: { updatedAt: 40, editorId: 'phone' },
      },
    } as unknown as Session['fieldUpdates']
    storage.seed(
      SESSIONS_STORAGE_KEY,
      JSON.stringify({
        version: 4,
        activeSessionId: 'session-1',
        sessions: [
          session({
            fieldUpdates: malformedMetadata,
          }),
        ],
      }),
    )

    expect(loadSessions(storage).sessions[0]?.fieldUpdates).toEqual({
      name: { updatedAt: 10, editorId: 'laptop' },
      preferences: {
        timerUpdateMode: { updatedAt: 30, editorId: 'phone' },
      },
    })
  })

  it('round-trips every supported puzzle event in modern sessions', () => {
    const storage = new MemoryStorage()
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
    const original = sessionsData({
      activeSessionId: 'session-333oh',
      sessions: events.map((event) =>
        session({
          id: `session-${event}`,
          name: `Event ${event}`,
          event,
          solves: [solve({ id: `solve-${event}`, event })],
        }),
      ),
    })

    expect(saveSessions(original, storage)).toBe(true)
    expect(loadSessions(storage)).toEqual(original)
  })

  it('preserves solves with unknown puzzle events while keeping valid records', () => {
    const storage = new MemoryStorage()
    storage.seed(
      SESSIONS_STORAGE_KEY,
      JSON.stringify({
        version: 4,
        activeSessionId: 'session-1',
        sessions: [
          session({
            solves: [
              solve({ id: 'valid-pyram', event: 'pyram' }),
              { ...solve({ id: 'unknown-event' }), event: '333bf' as unknown as Solve['event'] },
            ],
          }),
        ],
      }),
    )

    const loaded = loadSessions(storage)
    expect(loaded.sessions[0]?.solves.map((item) => item.id)).toEqual([
      'valid-pyram',
      'unknown-event',
    ])
    expect(loaded.sessions[0]?.solves[1]?.event).toBe('333bf')
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

  it('migrates a legacy history larger than the argument-spread limit', () => {
    const storage = new MemoryStorage()
    const count = 130_000
    const base = 1_700_000_000_000
    const solves = Array.from({ length: count }, (_, index) =>
      solve({
        id: `large-${index}`,
        rawMs: 10_000 + (index % 1_000),
        createdAt: base + index,
      }),
    )
    seedLegacy(storage, solves)

    const loaded = loadSessions(storage)
    expect(loaded.sessions).toHaveLength(1)
    expect(loaded.sessions[0]?.solves).toHaveLength(count)
    expect(loaded.sessions[0]?.createdAt).toBe(base)
    expect(loaded.sessions[0]?.updatedAt).toBe(base + count - 1)
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
      JSON.stringify({ version: 99, sessions: [] }),
    )

    expect(loadSessions(storage).sessions[0]?.solves[0]?.id).toBe('legacy')
  })

  it('migrates v1 sessions with empty comments and no inspection override', () => {
    const storage = new MemoryStorage()
    storage.seed(
      SESSIONS_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        activeSessionId: 'session-1',
        sessions: [
          {
            id: 'session-1',
            name: 'Session 1',
            createdAt: 1_700_000_000_000,
            updatedAt: 1_700_000_000_000,
            solves: [
              {
                id: 'solve-1',
                event: '333',
                rawMs: 12_340,
                penalty: 'none',
                scramble: "R U R' U'",
                createdAt: 1_700_000_000_000,
              },
            ],
          },
        ],
      }),
    )

    const loaded = loadSessions(storage)
    expect(loaded.sessions[0]?.solves[0]?.comment).toBe('')
    expect(loaded.sessions[0]?.inspectionEnabled).toBeUndefined()
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
        alertVolume: 85,
        inspectionWarning8s: true,
        inspectionWarning12s: true,
        inspectionCountDirection: 'up',
        theme: 'dark',
        accentColor: 'violet',
        statPrecision: 'tenths',
        statVisibility: {
          single: false,
          mo3: true,
          ao5: false,
          ao12: true,
          ao25: true,
        },
        customAverages: [
          { id: 'custom-1', size: 7, visible: true },
          { id: 'custom-2', size: 50, visible: false },
        ],
      }),
    ).toMatchObject({
      alertChannel: 'sound-haptic',
      alertVolume: 85,
      inspectionWarning8s: true,
      inspectionWarning12s: true,
      inspectionCountDirection: 'up',
      theme: 'dark',
      accentColor: 'violet',
      statPrecision: 'tenths',
      statVisibility: {
        single: false,
        mo3: true,
        ao5: false,
        ao12: true,
        ao25: true,
      },
      customAverages: [
        { id: 'custom-1', size: 7, visible: true },
        { id: 'custom-2', size: 50, visible: false },
      ],
    })
  })

  it('falls back field-by-field for invalid newer preferences', () => {
    expect(
      parseSettingsData({
        inspectionEnabled: true,
        alertChannel: 'telepathy',
        alertVolume: 0,
        inspectionWarning: '5s',
        theme: 'sepia',
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
      alertVolume: DEFAULT_SETTINGS.alertVolume,
      inspectionWarning8s: DEFAULT_SETTINGS.inspectionWarning8s,
      inspectionWarning12s: DEFAULT_SETTINGS.inspectionWarning12s,
      theme: DEFAULT_SETTINGS.theme,
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

  it('upgrades a v2 record with defaults for newer preferences', () => {
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

  it('upgrades a v3 record with the default alert volume', () => {
    const storage = new MemoryStorage()
    storage.seed(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({
        version: 3,
        settings: {
          inspectionEnabled: true,
          alertChannel: 'sound',
          inspectionWarning: '8s',
          accentColor: 'blue',
          statPrecision: 'tenths',
          statVisibility: {
            single: true,
            mo3: false,
            ao5: true,
            ao12: false,
          },
        },
      }),
    )
    expect(loadSettings(storage)).toMatchObject({
      inspectionEnabled: true,
      alertChannel: 'sound',
      alertVolume: DEFAULT_SETTINGS.alertVolume,
      inspectionWarning8s: true,
      inspectionWarning12s: false,
      accentColor: 'blue',
      statPrecision: 'tenths',
      statVisibility: {
        single: true,
        mo3: false,
        ao5: true,
        ao12: false,
      },
    })
  })

  it('upgrades a v4 record with the new inspection and custom-average fields', () => {
    const storage = new MemoryStorage()
    storage.seed(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({
        version: 4,
        settings: {
          inspectionEnabled: true,
          alertChannel: 'visual',
          alertVolume: 50,
          inspectionWarning: '12s',
          accentColor: 'amber',
          statPrecision: 'tenths',
          statVisibility: {
            single: true,
            mo3: false,
            ao5: true,
            ao12: false,
          },
        },
      }),
    )

    expect(loadSettings(storage)).toMatchObject({
      inspectionEnabled: true,
      inspectionCountDirection: 'down',
      inspectionWarning8s: false,
      inspectionWarning12s: true,
      customAverages: [],
      statVisibility: {
        single: true,
        mo3: false,
        ao5: true,
        ao12: false,
        ao25: false,
        ao10000: false,
      },
    })
  })

  it('upgrades a v6 record with the default light theme', () => {
    const storage = new MemoryStorage()
    storage.seed(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({
        version: 6,
        settings: {
          inspectionEnabled: true,
          accentColor: 'blue',
          stopWithAnyKey: true,
        },
      }),
    )

    expect(loadSettings(storage)).toMatchObject({
      inspectionEnabled: true,
      accentColor: 'blue',
      stopWithAnyKey: true,
      theme: DEFAULT_SETTINGS.theme,
    })
  })

  it('round-trips an explicit theme preference at schema v8', () => {
    const storage = new MemoryStorage()
    saveSettings({ ...DEFAULT_SETTINGS, theme: 'dark' }, storage)
    expect(loadSettings(storage)).toMatchObject({ theme: 'dark' })
    expect(JSON.parse(storage.getItem(SETTINGS_STORAGE_KEY) ?? '{}')).toMatchObject({
      version: 10,
    })
  })

  it('filters invalid, duplicate, built-in, and excess custom averages', () => {
    const parsed = parseSettingsData({
      inspectionEnabled: false,
      customAverages: [
        { id: 'custom-1', size: 7, visible: true },
        { id: 'custom-1', size: 8, visible: true },
        { id: 'custom-2', size: 7, visible: true },
        { id: 'custom-3', size: 5, visible: true },
        { id: 'custom-4', size: 2, visible: true },
        { id: 'custom-5', size: 9.5, visible: true },
        { id: 'custom-6', size: 9, visible: false },
        { id: 'custom-7', size: 10, visible: true },
        { id: 'custom-8', size: 11, visible: true },
        { id: 'custom-9', size: 13, visible: true },
      ],
    })

    expect(parsed).not.toBeNull()
    expect(parsed?.customAverages).toEqual([
      { id: 'custom-1', size: 7, visible: true },
      { id: 'custom-6', size: 9, visible: false },
      { id: 'custom-7', size: 10, visible: true },
      { id: 'custom-8', size: 11, visible: true },
      { id: 'custom-9', size: 13, visible: true },
    ])
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
      JSON.stringify({ version: 11, settings: { inspectionEnabled: true } }),
    )
    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS)
  })
})


describe('trimming settings schema v8', () => {
  it.each([1, 2, 3, 4, 5, 6, 7])('migrates v%i to default percentage trimming without losing preferences', (version) => {
    const storage = new MemoryStorage()
    storage.seed(SETTINGS_STORAGE_KEY, JSON.stringify({ version, settings: { inspectionEnabled: true, theme: 'dark' } }))
    const settings = loadSettings(storage)
    expect(settings).toMatchObject({ inspectionEnabled: true, theme: 'dark', averageTrimBetter: 'p5', averageTrimWorse: 'auto' })
    expect(saveSettings(settings, storage)).toBe(true)
    expect(JSON.parse(storage.getItem(SETTINGS_STORAGE_KEY)!)).toMatchObject({ version: 10, settings: { averageTrimBetter: 'p5', averageTrimWorse: 'auto' } })
  })
  it('round-trips independent side choices and recovers bad fields independently', () => {
    const storage = new MemoryStorage()
    const settings = { ...DEFAULT_SETTINGS, averageTrimBetter: 'p10' as const, averageTrimWorse: '0' as const }
    saveSettings(settings, storage)
    expect(loadSettings(storage)).toEqual(settings)
    expect(parseSettingsData({ inspectionEnabled: true, averageTrimBetter: 'auto', averageTrimWorse: '1' })).toMatchObject({ averageTrimBetter: 'p5', averageTrimWorse: '1', inspectionEnabled: true })
    expect(parseSettingsData({ inspectionEnabled: false, averageTrimBetter: 'median', averageTrimWorse: 'garbage' })).toMatchObject({ averageTrimBetter: 'median', averageTrimWorse: 'auto' })
  })
})

describe('custom event persistence', () => {
  it('round-trips custom definitions and custom-event solves without changing them', () => {
    const storage = new MemoryStorage()
    const customId = 'custom:test-event'
    const original = sessionsData({
      customEvents: [
        {
          id: customId,
          name: 'Test puzzle',
          placeholder: 'Type a scramble',
          createdAt: 1_700_000_000_000,
          updatedAt: 1_700_000_002_000,
          fieldUpdates: {
            placeholder: { updatedAt: 1_700_000_002_000, editorId: 'laptop' },
          },
        },
      ],
      activeSessionId: 'session-1',
      sessions: [
        session({
          event: customId,
          solves: [
            solve({
              event: customId,
              scramble: 'recorded scramble',
              importSource: {
                provider: 'cstimer',
                scrType: 'test',
                sessionNumber: 2,
                solveIndex: 3,
              },
              fieldUpdates: {
                event: { updatedAt: 1_700_000_003_000, editorId: 'laptop' },
              },
            }),
          ],
        }),
      ],
    })

    expect(saveSessions(original, storage)).toBe(true)
    expect(loadSessions(storage)).toEqual(original)
  })

  it('preserves present unknown event IDs instead of defaulting to 3×3', () => {
    const storage = new MemoryStorage()
    const original = sessionsData({
      sessions: [
        session({
          event: 'custom:kept',
          solves: [solve({ event: 'custom:kept' })],
        }),
      ],
    })
    expect(saveSessions(original, storage)).toBe(true)
    expect(loadSessions(storage).sessions[0]!.event).toBe('custom:kept')

    storage.seed(
      SESSIONS_STORAGE_KEY,
      JSON.stringify({
        version: 4,
        activeSessionId: 'session-1',
        sessions: [
          {
            ...session(),
            event: 'not a valid event',
            solves: [{ ...solve(), event: 'not a valid event' }],
          },
        ],
      }),
    )
    const loaded = loadSessions(storage)
    expect(loaded.sessions[0]!.event).toBe('not a valid event')
    expect(loaded.sessions[0]!.solves[0]!.event).toBe('not a valid event')
  })

  it('preserves empty scrambles and present unknown event IDs through save/load', () => {
    const storage = new MemoryStorage()
    const original = sessionsData({
      sessions: [
        session({
          event: '333bf',
          solves: [solve({ event: '333bf', scramble: '' })],
        }),
      ],
    })

    expect(saveSessions(original, storage)).toBe(true)
    const loaded = loadSessions(storage)
    expect(loaded).toEqual(original)
    expect(loaded.sessions[0]!.event).toBe('333bf')
    expect(loaded.sessions[0]!.solves[0]).toMatchObject({
      event: '333bf',
      scramble: '',
      rawMs: 12_340,
      penalty: 'none',
      comment: '',
      createdAt: 1_700_000_000_000,
    })
  })

  it('keeps the 3×3 fallback only when a legacy event field is missing', () => {
    const storage = new MemoryStorage()
    storage.seed(
      SESSIONS_STORAGE_KEY,
      JSON.stringify({
        version: 4,
        activeSessionId: 'legacy-session',
        sessions: [
          {
            id: 'legacy-session',
            name: 'Legacy',
            createdAt: 1_700_000_000_000,
            updatedAt: 1_700_000_000_000,
            solves: [
              {
                id: 'legacy-solve',
                rawMs: 12_000,
                penalty: 'none',
                scramble: '',
                comment: '',
                createdAt: 1_700_000_000_000,
              },
            ],
          },
        ],
      }),
    )

    const loaded = loadSessions(storage)
    expect(loaded.sessions[0]!.event).toBe('333')
    expect(loaded.sessions[0]!.solves[0]).toMatchObject({
      event: '333',
      scramble: '',
    })
  })
})

describe('session ordering persistence', () => {
  it('round-trips ordering metadata and sorts the loaded collection', () => {
    const storage = new MemoryStorage()
    const data = sessionsData({
      activeSessionId: 'session-2',
      sessions: [
        session({ id: 'session-1', name: 'First' }),
        session({ id: 'session-2', name: 'Second' }),
        session({ id: 'session-3', name: 'Third' }),
      ],
      sessionOrder: {
        ids: ['session-3', 'session-1', 'session-2'],
        updatedAt: 500,
        editorId: 'laptop',
      },
    })
    expect(saveSessions(data, storage)).toBe(true)
    const loaded = loadSessions(storage)
    expect(loaded.sessions.map((entry) => entry.id)).toEqual([
      'session-3',
      'session-1',
      'session-2',
    ])
    expect(loaded.sessionOrder).toEqual(data.sessionOrder)
  })

  it('drops unknown and duplicate ordering IDs on load', () => {
    const storage = new MemoryStorage()
    storage.seed(
      SESSIONS_STORAGE_KEY,
      JSON.stringify({
        version: 5,
        activeSessionId: 'session-1',
        sessions: [
          session({ id: 'session-1', name: 'First' }),
          session({ id: 'session-2', name: 'Second' }),
        ],
        sessionOrder: {
          ids: ['session-2', 'missing', 'session-2', 'session-1'],
          updatedAt: 900,
          editorId: 'phone',
        },
      }),
    )
    const loaded = loadSessions(storage)
    expect(loaded.sessions.map((entry) => entry.id)).toEqual([
      'session-2',
      'session-1',
    ])
    expect(loaded.sessionOrder?.ids).toEqual(['session-2', 'session-1'])
  })

  it('ignores malformed ordering metadata without losing sessions', () => {
    const storage = new MemoryStorage()
    storage.seed(
      SESSIONS_STORAGE_KEY,
      JSON.stringify({
        version: 5,
        activeSessionId: 'session-1',
        sessions: [session({ id: 'session-1' }), session({ id: 'session-2' })],
        sessionOrder: { ids: 'not-an-array', updatedAt: 1, editorId: 'x' },
      }),
    )
    const loaded = loadSessions(storage)
    expect(loaded.sessions).toHaveLength(2)
    expect(loaded.sessionOrder).toBeUndefined()
  })
})

describe('session summary settings migration', () => {
  it('defaults both new summaries to off for older settings', () => {
    const parsed = parseSettingsData({ inspectionEnabled: false })
    expect(parsed?.showSessionSolveProgress).toBe(false)
    expect(parsed?.showSessionTotalTime).toBe(false)
  })

  it('persists independent summary choices', () => {
    const storage = new MemoryStorage()
    const settings = {
      ...DEFAULT_SETTINGS,
      showSessionSolveProgress: true,
      showSessionTotalTime: false,
    }
    expect(saveSettings(settings, storage)).toBe(true)
    expect(loadSettings(storage)).toMatchObject({
      showSessionSolveProgress: true,
      showSessionTotalTime: false,
    })
  })
})
