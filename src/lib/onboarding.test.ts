import { describe, expect, it } from 'vitest'
import type { Session, SessionsData } from '../types'
import {
  buildFreshSessionSetup,
  chooseImportedMainSession,
  createOnboardingDraft,
  hasMeaningfulLocalData,
  importedPreviewEvents,
  loadOnboardingBootstrap,
  loadOnboardingStore,
  markOnboardingDecision,
  ONBOARDING_STORAGE_KEY,
  reconcileImportCheckpoint,
  saveOnboardingDraft,
  saveOnboardingStore,
  startOnboardingWelcomeDraft,
  type OnboardingImportCheckpoint,
} from './onboarding'
import { DEFAULT_SESSION_NAME } from './sessions'
import type { StorageLike } from './storage'
import { SETTINGS_FIELD_KEYS } from './settingsMerge'

function memoryStorage(seed: Record<string, string> = {}): StorageLike {
  const values = new Map(Object.entries(seed))
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: (key) => void values.delete(key),
  }
}

function defaultSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'default',
    name: DEFAULT_SESSION_NAME,
    isAutoCreatedDefault: true,
    createdAt: 10,
    updatedAt: 10,
    solves: [],
    ...overrides,
  }
}

function data(sessions: Session[] = [defaultSession()]): SessionsData {
  return { activeSessionId: sessions[0]?.id ?? '', sessions }
}

describe('onboarding first-run detection', () => {
  it('shows onboarding for a clean browser and resumes a saved draft', () => {
    const empty = memoryStorage()
    expect(loadOnboardingBootstrap(data([]), empty)).toMatchObject({
      show: true,
      mode: 'first-run',
    })
    const draft = createOnboardingDraft('fresh', 'welcome', 1)
    saveOnboardingDraft(draft, empty)
    expect(loadOnboardingBootstrap(data([]), empty)).toEqual({
      show: true,
      mode: 'first-run',
      draft,
    })
  })

  it('does not show after a completed or skipped decision', () => {
    const storage = memoryStorage()
    saveOnboardingDraft(createOnboardingDraft('fresh', 'welcome'), storage)
    markOnboardingDecision('skipped', 20, storage)
    expect(loadOnboardingBootstrap(data([]), storage).show).toBe(false)
    markOnboardingDecision('completed', 30, storage)
    expect(loadOnboardingBootstrap(data([]), storage).show).toBe(false)
    expect(loadOnboardingStore(storage).draft).toBeUndefined()
  })

  it('treats meaningful local data as an existing user', () => {
    const storage = memoryStorage()
    expect(
      loadOnboardingBootstrap(
        data([
          defaultSession({
            solves: [
              {
                id: 'solve',
                event: '333',
                rawMs: 12_000,
                penalty: 'none',
                scramble: 'R U',
                comment: '',
                createdAt: 20,
              },
            ],
          }),
        ]),
        storage,
      ).show,
    ).toBe(false)
    expect(
      loadOnboardingBootstrap(
        data([defaultSession({ id: 'second', name: 'Practice', createdAt: 30, updatedAt: 30 })]),
        storage,
      ).show,
    ).toBe(false)
  })

  it('does not count an untouched placeholder as meaningful data', () => {
    const storage = memoryStorage()
    expect(hasMeaningfulLocalData(data())).toBe(false)
    expect(loadOnboardingBootstrap(data(), storage).show).toBe(true)

    const priorSettings = memoryStorage({
      'cubelab:settings:v1': '{"version":11,"settings":{}}',
    })
    expect(loadOnboardingBootstrap(data(), priorSettings).show).toBe(false)
    const priorSync = memoryStorage({
      'cubelab:sync:v1': '{"version":1}',
    })
    expect(loadOnboardingBootstrap(data(), priorSync).show).toBe(false)
  })

  it('persists a welcome draft before the editable app mounts', () => {
    const storage = memoryStorage()
    const draft = startOnboardingWelcomeDraft(storage)
    expect(draft).not.toBeNull()
    expect(JSON.parse(storage.getItem(ONBOARDING_STORAGE_KEY)!)).toMatchObject({
      version: 1,
      draft: { path: 'fresh', stage: 'welcome' },
    })
    expect(startOnboardingWelcomeDraft(storage)).toEqual(draft)
  })

  it('keeps malformed state from hiding a genuinely new browser', () => {
    const storage = memoryStorage({ [ONBOARDING_STORAGE_KEY]: '{broken' })
    expect(loadOnboardingBootstrap(data(), storage).show).toBe(true)
  })
})

describe('start fresh session setup', () => {
  it('reuses the untouched 3×3 placeholder instead of creating a duplicate', () => {
    const setup = buildFreshSessionSetup({
      data: data(),
      events: ['333'],
      mainEvent: '333',
      runId: 'run-a',
      now: 100,
      editorId: 'onboarding',
    })
    expect(setup).not.toBeNull()
    expect(setup!.data.sessions).toHaveLength(1)
    expect(setup!.data.sessions[0]).toMatchObject({
      id: 'default',
      name: '3×3',
      event: '333',
      solves: [],
    })
    expect(setup!.data.sessions[0]?.isAutoCreatedDefault).toBeUndefined()
    expect(setup!.data.activeSessionId).toBe('default')
    expect(setup!.createdSessionIds).toEqual([])
    expect(setup!.reusedSessionIds).toEqual(['default'])
    expect(setup!.configuredSessionIds).toEqual(['default'])
  })

  it('creates exactly one empty session for every selected event', () => {
    const setup = buildFreshSessionSetup({
      data: data(),
      events: ['222', '333', '444', '333oh'],
      mainEvent: '444',
      runId: 'run-b',
      now: 100,
    })
    expect(setup).not.toBeNull()
    expect(setup!.data.sessions).toHaveLength(4)
    expect(
      setup!.data.sessions.map((session) => [
        session.name,
        session.event,
        session.solves.length,
      ]),
    ).toEqual([
      ['3×3', '333', 0],
      ['2×2', '222', 0],
      ['4×4', '444', 0],
      ['3×3 OH', '333oh', 0],
    ])
    expect(setup!.data.activeSessionId).toBe(
      setup!.sessionIdsByEvent['444'],
    )
    expect(setup!.createdSessionIds).toHaveLength(3)
    expect(setup!.reusedSessionIds).toEqual(['default'])
  })

  it('removes only the untouched placeholder when 3×3 is not selected', () => {
    const meaningful: Session = {
      id: 'practice',
      name: 'Practice',
      event: '222',
      createdAt: 5,
      updatedAt: 6,
      solves: [],
    }
    const setup = buildFreshSessionSetup({
      data: data([defaultSession(), meaningful]),
      events: ['444'],
      mainEvent: '444',
      runId: 'run-c',
      now: 100,
    })
    expect(setup).not.toBeNull()
    expect(setup!.data.sessions.map((session) => session.id)).toEqual([
      'practice',
      'onboarding-run-c-1',
    ])
  })

  it('reuses existing empty sessions on retry or a reopened setup', () => {
    const first = buildFreshSessionSetup({
      data: data(),
      events: ['222', '333'],
      mainEvent: '222',
      runId: 'run-d',
      now: 100,
    })!
    const retry = buildFreshSessionSetup({
      data: first.data,
      events: ['222', '333'],
      mainEvent: '222',
      runId: 'run-d',
      now: 200,
    })!
    expect(retry.data.sessions).toHaveLength(2)
    expect(retry.data.sessions.map((session) => session.id).sort()).toEqual(
      first.data.sessions.map((session) => session.id).sort(),
    )
    expect(retry.createdSessionIds).toEqual([])
  })

  it('rejects an empty event selection and keeps preset ordering metadata', () => {
    expect(
      buildFreshSessionSetup({
        data: data(),
        events: [],
        runId: 'run-e',
      }),
    ).toBeNull()

    const ordered = buildFreshSessionSetup({
      data: {
        ...data(),
        sessionOrder: { ids: ['default'], updatedAt: 1, editorId: 'old' },
      },
      events: ['333', '222'],
      mainEvent: '222',
      runId: 'run-f',
      now: 100,
      editorId: 'onboarding',
    })!
    expect(ordered.data.sessionOrder).toMatchObject({
      updatedAt: 100,
      editorId: 'onboarding',
    })
    expect(ordered.data.sessionOrder!.ids).toHaveLength(2)
  })
})

describe('csTimer import recovery', () => {
  const checkpoint: OnboardingImportCheckpoint = {
    status: 'committing',
    fileName: 'timer.txt',
    beforeSessionIds: ['default'],
    preview: [
      { sessionNumber: 1, name: '3x3 Main', event: '333', solveCount: 2 },
      { sessionNumber: 2, name: '2x2', event: '222', solveCount: 0 },
    ],
    importedSessionCount: 2,
    importedSolveCount: 2,
  }

  function importedSessions(): Session[] {
    return [
      defaultSession(),
      {
        id: 'import-1',
        name: '3x3 Main',
        event: '333',
        createdAt: 100,
        updatedAt: 100,
        solves: [
          {
            id: 's1',
            event: '333',
            rawMs: 10_000,
            penalty: 'none',
            scramble: 'R U',
            comment: '',
            createdAt: 100,
          },
          {
            id: 's2',
            event: '333',
            rawMs: 11_000,
            penalty: 'none',
            scramble: 'R U',
            comment: '',
            createdAt: 101,
          },
        ],
      },
      {
        id: 'import-2',
        name: '2x2',
        event: '222',
        createdAt: 100,
        updatedAt: 100,
        solves: [],
      },
    ]
  }

  it('recognizes a committed additive import from its preview signatures', () => {
    expect(reconcileImportCheckpoint(checkpoint, importedSessions())).toEqual({
      committed: true,
      sessionIds: ['import-1', 'import-2'],
    })
  })

  it('does not treat an uncommitted or partial import as complete', () => {
    expect(reconcileImportCheckpoint(checkpoint, [defaultSession()])).toEqual({
      committed: false,
      sessionIds: [],
    })
    expect(
      reconcileImportCheckpoint(checkpoint, importedSessions().slice(0, 2)),
    ).toEqual({ committed: false, sessionIds: [] })
  })

  it('uses explicit imported IDs and chooses a Main Event session by order', () => {
    expect(
      reconcileImportCheckpoint(
        { ...checkpoint, status: 'committed', sessionIds: ['import-2', 'import-1'] },
        importedSessions(),
      ),
    ).toEqual({ committed: true, sessionIds: ['import-2', 'import-1'] })

    const sessions = importedSessions()
    expect(importedPreviewEvents(checkpoint)).toEqual(['333', '222'])
    expect(
      chooseImportedMainSession({
        sessions,
        importedSessionIds: ['import-1', 'import-2'],
        activeSessionId: 'import-1',
        mainEvent: '222',
      })?.id,
    ).toBe('import-2')
  })
})

describe('device-specific onboarding settings', () => {
  it('does not ask for synchronized Settings fields after restore', () => {
    expect(SETTINGS_FIELD_KEYS).not.toContain(
      'drawScrambleMode' as keyof typeof SETTINGS_FIELD_KEYS,
    )
  })
})

describe('onboarding state serialization', () => {
  it('round trips a committed import checkpoint and drops malformed records', () => {
    const storage = memoryStorage()
    const draft = {
      ...createOnboardingDraft('cstimer', 'settings', 1),
      mainEvent: '333',
      importCheckpoint: {
        status: 'committed' as const,
        fileName: 'timer.txt',
        beforeSessionIds: ['a'],
        preview: [
          { sessionNumber: 1, name: 'Main', event: '333', solveCount: 1 },
        ],
        importedSessionCount: 1,
        importedSolveCount: 1,
        sessionIds: ['b'],
      },
    }
    saveOnboardingDraft(draft, storage)
    expect(loadOnboardingStore(storage).draft).toEqual(draft)

    saveOnboardingStore(
      { version: 1, draft: { path: 'nope' } } as never,
      storage,
    )
    expect(loadOnboardingStore(storage).draft).toBeUndefined()
  })
})
