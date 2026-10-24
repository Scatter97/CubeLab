import type {
  AccentColor,
  AlertChannel,
  CustomAverageSetting,
  InspectionCountDirection,
  Penalty,
  ScrambleAction,
  ScrambleAlignment,
  Session,
  SessionsData,
  Settings,
  Solve,
  StatPrecision,
  StatVisibility,
  TimerUpdateMode,
} from '../types'
import { createId } from './id'
import {
  DEFAULT_SESSION_NAME,
  MAX_SOLVE_COMMENT_LENGTH,
  normalizeSessionName,
} from './sessions'
import {
  BUILT_IN_STAT_DEFINITIONS,
  MAX_CUSTOM_AVERAGES,
  isValidCustomAverageSize,
} from './statDefinitions'

export const SOLVES_STORAGE_KEY = 'cubelab:solves:v1'
export const SESSIONS_STORAGE_KEY = 'cubelab:sessions:v1'
export const SETTINGS_STORAGE_KEY = 'cubelab:settings:v1'
export const STORAGE_VERSION = 1
export const SESSIONS_VERSION = 2
export const SETTINGS_STORAGE_VERSION = 6

export const DEFAULT_SETTINGS: Settings = {
  inspectionEnabled: false,
  inspectionCountDirection: 'down',
  timerUpdateMode: 'live',
  holdDurationMs: 300,
  stopWithAnyKey: false,
  showTimerDecimalSmall: false,
  uiZoomPercent: 100,
  scrambleAlignment: 'center',
  scrambleLimitHeight: false,
  scrambleAction: 'copy',
  alertChannel: 'off',
  alertVolume: 70,
  inspectionWarning8s: false,
  inspectionWarning12s: false,
  inspectionWarningVisualScope: 'timer',
  accentColor: 'green',
  statVisibility: {
    single: true,
    mo3: true,
    ao5: true,
    ao12: true,
    ao25: false,
    ao100: false,
    ao200: false,
    ao500: false,
    ao1000: false,
    ao5000: false,
    ao10000: false,
  },
  customAverages: [],
  statPrecision: 'centiseconds',
}

function cloneDefaultSettings(): Settings {
  return {
    ...DEFAULT_SETTINGS,
    statVisibility: { ...DEFAULT_SETTINGS.statVisibility },
    customAverages: DEFAULT_SETTINGS.customAverages.map((average) => ({
      ...average,
    })),
  }
}

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

interface StoredSessions {
  version: number
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
    comment:
      typeof value.comment === 'string'
        ? value.comment.slice(0, MAX_SOLVE_COMMENT_LENGTH)
        : '',
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
    ...(typeof value.inspectionEnabled === 'boolean'
      ? { inspectionEnabled: value.inspectionEnabled }
      : {}),
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

function isValidAlertChannel(value: unknown): value is AlertChannel {
  return (
    value === 'off' ||
    value === 'visual' ||
    value === 'sound' ||
    value === 'haptic' ||
    value === 'sound-haptic'
  )
}

function isValidInspectionCountDirection(
  value: unknown,
): value is InspectionCountDirection {
  return value === 'down' || value === 'up'
}

function isValidAccentColor(value: unknown): value is AccentColor {
  return (
    value === 'green' ||
    value === 'blue' ||
    value === 'violet' ||
    value === 'amber'
  )
}

function isValidStatPrecision(value: unknown): value is StatPrecision {
  return value === 'centiseconds' || value === 'tenths'
}

function parseStatVisibility(value: unknown): StatVisibility {
  const fallback = DEFAULT_SETTINGS.statVisibility
  if (!isRecord(value)) return { ...fallback }

  const visibility: StatVisibility = { ...fallback }
  for (const { key } of BUILT_IN_STAT_DEFINITIONS) {
    if (typeof value[key] === 'boolean') visibility[key] = value[key]
  }
  return visibility
}

function parseCustomAverages(value: unknown): CustomAverageSetting[] {
  if (!Array.isArray(value)) return []

  const averages: CustomAverageSetting[] = []
  const usedIds = new Set<string>()
  const usedSizes = new Set<number>()

  for (const candidate of value) {
    if (averages.length >= MAX_CUSTOM_AVERAGES) break
    if (!isRecord(candidate)) continue
    if (typeof candidate.id !== 'string' || candidate.id.length === 0) continue
    if (usedIds.has(candidate.id)) continue
    if (
      typeof candidate.size !== 'number' ||
      !isValidCustomAverageSize(candidate.size) ||
      usedSizes.has(candidate.size)
    ) {
      continue
    }

    averages.push({
      id: candidate.id,
      size: candidate.size,
      visible:
        typeof candidate.visible === 'boolean' ? candidate.visible : true,
    })
    usedIds.add(candidate.id)
    usedSizes.add(candidate.size)
  }

  return averages
}

export function parseSettingsData(value: unknown): Settings | null {
  if (!isRecord(value)) return null
  if (typeof value.inspectionEnabled !== 'boolean') return null

  const inspectionEnabled = value.inspectionEnabled

  return {
    inspectionEnabled,
    inspectionCountDirection: isValidInspectionCountDirection(
      value.inspectionCountDirection,
    )
      ? value.inspectionCountDirection
      : DEFAULT_SETTINGS.inspectionCountDirection,
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
    stopWithAnyKey:
      typeof value.stopWithAnyKey === 'boolean'
        ? value.stopWithAnyKey
        : DEFAULT_SETTINGS.stopWithAnyKey,
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
    alertChannel: isValidAlertChannel(value.alertChannel)
      ? value.alertChannel
      : DEFAULT_SETTINGS.alertChannel,
    alertVolume:
      typeof value.alertVolume === 'number' &&
      Number.isFinite(value.alertVolume) &&
      value.alertVolume >= 0 &&
      value.alertVolume <= 100
        ? Math.round(value.alertVolume)
        : DEFAULT_SETTINGS.alertVolume,
    inspectionWarning8s:
      typeof value.inspectionWarning8s === 'boolean'
        ? value.inspectionWarning8s
        : value.inspectionWarning === '8s',
    inspectionWarning12s:
      typeof value.inspectionWarning12s === 'boolean'
        ? value.inspectionWarning12s
        : value.inspectionWarning === '12s',
    inspectionWarningVisualScope:
      value.inspectionWarningVisualScope === 'timer' ||
      value.inspectionWarningVisualScope === 'screen'
        ? value.inspectionWarningVisualScope
        : DEFAULT_SETTINGS.inspectionWarningVisualScope,
    accentColor: isValidAccentColor(value.accentColor)
      ? value.accentColor
      : DEFAULT_SETTINGS.accentColor,
    statVisibility: parseStatVisibility(value.statVisibility),
    customAverages: parseCustomAverages(value.customAverages),
    statPrecision: isValidStatPrecision(value.statPrecision)
      ? value.statPrecision
      : DEFAULT_SETTINGS.statPrecision,
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
      if (
        isRecord(parsed) &&
        (parsed.version === 1 || parsed.version === SESSIONS_VERSION)
      ) {
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
  if (!storage) return cloneDefaultSettings()

  try {
    const raw = storage.getItem(SETTINGS_STORAGE_KEY)
    if (!raw) return cloneDefaultSettings()
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed) || !isRecord(parsed.settings)) {
      return cloneDefaultSettings()
    }

    if (
      typeof parsed.version === 'number' &&
      parsed.version >= 1 &&
      parsed.version <= SETTINGS_STORAGE_VERSION
    ) {
      return parseSettingsData(parsed.settings) ?? cloneDefaultSettings()
    }

    return cloneDefaultSettings()
  } catch {
    return cloneDefaultSettings()
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
