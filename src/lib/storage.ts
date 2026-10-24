import type {
  Penalty,
  ScrambleAction,
  ScrambleAlignment,
  Session,
  SessionsData,
  Settings,
  Solve,
  TimerUpdateMode,
} from '../types'
import { createId } from './id'
import { DEFAULT_SESSION_NAME, normalizeSessionName } from './sessions'

export const SOLVES_STORAGE_KEY = 'cubelab:solves:v1'
export const SESSIONS_STORAGE_KEY = 'cubelab:sessions:v1'
export const SETTINGS_STORAGE_KEY = 'cubelab:settings:v1'
export const STORAGE_VERSION = 1
export const SESSIONS_VERSION = 1
export const SETTINGS_STORAGE_VERSION = 2

export const DEFAULT_SETTINGS: Settings = {
  inspectionEnabled: false,
  timerUpdateMode: 'live',
  holdDurationMs: 300,
  showTimerDecimalSmall: false,
  uiZoomPercent: 100,
  scrambleAlignment: 'center',
  scrambleLimitHeight: false,
  scrambleAction: 'copy',
}

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

interface StoredSessions {
  version: typeof SESSIONS_VERSION
  activeSessionId: string
  sessions: Session[]
}

interface StoredSettings {
  version: typeof SETTINGS_STORAGE_VERSION
  settings: Settings
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPenalty(value: unknown): value is Penalty {
  return value === 'none' || value === '+2' || value === 'dnf'
}

function isPositiveTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function parseSolve(value: unknown): Solve | null {
  if (!isRecord(value)) return null
  if (typeof value.id !== 'string' || value.id.length === 0) return null
  if (value.event !== '333') return null
  if (
    typeof value.rawMs !== 'number' ||
    !Number.isFinite(value.rawMs) ||
    value.rawMs < 0
  ) {
    return null
  }
  if (!isPenalty(value.penalty)) return null
  if (typeof value.scramble !== 'string' || value.scramble.length === 0) {
    return null
  }
  if (!isPositiveTimestamp(value.createdAt)) return null

  return {
    id: value.id,
    event: '333',
    rawMs: value.rawMs,
    penalty: value.penalty,
    scramble: value.scramble,
    createdAt: value.createdAt,
  }
}

function parseSession(value: unknown): Session | null {
  if (!isRecord(value)) return null
  if (typeof value.id !== 'string' || value.id.length === 0) return null
  if (typeof value.name !== 'string') return null

  const name = normalizeSessionName(value.name)
  if (!name) return null
  if (!isPositiveTimestamp(value.createdAt)) return null
  if (!isPositiveTimestamp(value.updatedAt)) return null
  if (!Array.isArray(value.solves)) return null

  const seen = new Set<string>()
  const solves: Solve[] = []
  for (const candidate of value.solves) {
    const solve = parseSolve(candidate)
    if (solve && !seen.has(solve.id)) {
      seen.add(solve.id)
      solves.push(solve)
    }
  }

  return {
    id: value.id,
    name,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    solves,
  }
}

function getDefaultStorage(): StorageLike | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    return window.localStorage
  } catch {
    // Sandboxed iframes and privacy modes can throw on access.
    return null
  }
}

/**
 * Validates a session collection. Invalid sessions and solves are skipped
 * individually so one corrupt record cannot make every other session
 * unreadable. Duplicate session and solve IDs are ignored.
 */
export function parseSessionsData(value: unknown): SessionsData | null {
  if (!isRecord(value)) return null
  if (!Array.isArray(value.sessions)) return null

  const seen = new Set<string>()
  const sessions: Session[] = []
  for (const candidate of value.sessions) {
    const session = parseSession(candidate)
    if (session && !seen.has(session.id)) {
      seen.add(session.id)
      sessions.push(session)
    }
  }

  if (sessions.length === 0) return null

  const activeSessionId =
    typeof value.activeSessionId === 'string' &&
    sessions.some((session) => session.id === value.activeSessionId)
      ? value.activeSessionId
      : sessions[0]?.id

  if (!activeSessionId) return null
  return { activeSessionId, sessions }
}

function isValidTimerUpdateMode(value: unknown): value is TimerUpdateMode {
  return value === 'live' || value === 'tenths' || value === 'seconds'
}

function isValidScrambleAlignment(value: unknown): value is ScrambleAlignment {
  return value === 'left' || value === 'center' || value === 'right'
}

function isValidScrambleAction(value: unknown): value is ScrambleAction {
  return value === 'none' || value === 'copy' || value === 'next'
}

export function parseSettingsData(value: unknown): Settings | null {
  if (!isRecord(value)) return null
  if (typeof value.inspectionEnabled !== 'boolean') return null

  const inspectionEnabled = value.inspectionEnabled

  return {
    inspectionEnabled,
    timerUpdateMode: isValidTimerUpdateMode(value.timerUpdateMode)
      ? value.timerUpdateMode
      : DEFAULT_SETTINGS.timerUpdateMode,
    holdDurationMs:
      typeof value.holdDurationMs === 'number' &&
      Number.isFinite(value.holdDurationMs) &&
      value.holdDurationMs >= 0 &&
      value.holdDurationMs <= 10000
        ? value.holdDurationMs
        : DEFAULT_SETTINGS.holdDurationMs,
    showTimerDecimalSmall:
      typeof value.showTimerDecimalSmall === 'boolean'
        ? value.showTimerDecimalSmall
        : DEFAULT_SETTINGS.showTimerDecimalSmall,
    uiZoomPercent:
      typeof value.uiZoomPercent === 'number' &&
      Number.isFinite(value.uiZoomPercent) &&
      value.uiZoomPercent >= 70 &&
      value.uiZoomPercent <= 150
        ? value.uiZoomPercent
        : DEFAULT_SETTINGS.uiZoomPercent,
    scrambleAlignment: isValidScrambleAlignment(value.scrambleAlignment)
      ? value.scrambleAlignment
      : DEFAULT_SETTINGS.scrambleAlignment,
    scrambleLimitHeight:
      typeof value.scrambleLimitHeight === 'boolean'
        ? value.scrambleLimitHeight
        : DEFAULT_SETTINGS.scrambleLimitHeight,
    scrambleAction: isValidScrambleAction(value.scrambleAction)
      ? value.scrambleAction
      : DEFAULT_SETTINGS.scrambleAction,
  }
}

function createEmptySessions(): SessionsData {
  const id = createId()
  const now = Date.now()
  return {
    activeSessionId: id,
    sessions: [
      {
        id,
        name: DEFAULT_SESSION_NAME,
        createdAt: now,
        updatedAt: now,
        solves: [],
      },
    ],
  }
}

function createSessionsFromLegacy(solves: readonly Solve[]): SessionsData {
  const id = createId()
  const timestamps = solves.map((solve) => solve.createdAt)
  const createdAt = Math.min(...timestamps)
  const updatedAt = Math.max(...timestamps)

  return {
    activeSessionId: id,
    sessions: [
      {
        id,
        name: DEFAULT_SESSION_NAME,
        createdAt,
        updatedAt,
        solves: [...solves],
      },
    ],
  }
}

/**
 * Loads the current session collection. If the versioned sessions key is
 * absent or unreadable, a valid legacy single-session record is migrated
 * instead of being discarded. With no usable data, one empty session is
 * created.
 */
export function loadSessions(storage = getDefaultStorage()): SessionsData {
  if (!storage) return createEmptySessions()

  try {
    const raw = storage.getItem(SESSIONS_STORAGE_KEY)
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      if (isRecord(parsed) && parsed.version === SESSIONS_VERSION) {
        const data = parseSessionsData(parsed)
        if (data) return data
      }
    }
  } catch {
    // Fall through to the legacy record, then to a fresh session.
  }

  const legacySolves = loadSolves(storage)
  if (legacySolves.length > 0) return createSessionsFromLegacy(legacySolves)
  return createEmptySessions()
}

export function saveSessions(
  data: SessionsData,
  storage = getDefaultStorage(),
): boolean {
  if (!storage) return false

  const payload: StoredSessions = {
    version: SESSIONS_VERSION,
    activeSessionId: data.activeSessionId,
    sessions: [...data.sessions],
  }

  try {
    storage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(payload))
    return true
  } catch {
    return false
  }
}

/**
 * Legacy single-session loader. Retained so existing local solves can be
 * migrated into the named-session store.
 */
export function loadSolves(storage = getDefaultStorage()): Solve[] {
  if (!storage) return []

  try {
    const raw = storage.getItem(SOLVES_STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed) || parsed.version !== STORAGE_VERSION) return []
    if (!Array.isArray(parsed.solves)) return []

    const seen = new Set<string>()
    const solves: Solve[] = []
    for (const candidate of parsed.solves) {
      const solve = parseSolve(candidate)
      if (solve && !seen.has(solve.id)) {
        seen.add(solve.id)
        solves.push(solve)
      }
    }
    return solves
  } catch {
    return []
  }
}

export function loadSettings(storage = getDefaultStorage()): Settings {
  if (!storage) return { ...DEFAULT_SETTINGS }

  try {
    const raw = storage.getItem(SETTINGS_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed) || !isRecord(parsed.settings)) {
      return { ...DEFAULT_SETTINGS }
    }

    if (parsed.version === 1 || parsed.version === SETTINGS_STORAGE_VERSION) {
      return parseSettingsData(parsed.settings) ?? { ...DEFAULT_SETTINGS }
    }

    return { ...DEFAULT_SETTINGS }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(
  settings: Settings,
  storage = getDefaultStorage(),
): boolean {
  if (!storage) return false

  const payload: StoredSettings = {
    version: SETTINGS_STORAGE_VERSION,
    settings: { ...settings },
  }

  try {
    storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(payload))
    return true
  } catch {
    return false
  }
}
