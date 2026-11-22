import type {
  AccentColor,
  AlertChannel,
  CsTimerSolveSource,
  CustomEventDefinition,
  CustomAverageSetting,
  FieldUpdate,
  InspectionCountDirection,
  Penalty,
  ScrambleAction,
  ScrambleAlignment,
  Session,
  SessionFieldUpdates,
  SessionOrdering,
  SessionPreferences,
  SessionPreferenceKey,
  SessionsData,
  SessionTransfer,
  Settings,
  Solve,
  StatMetricVisibility,
  StatPrecision,
  StatTargetsMs,
  StatVisibility,
  ThemePreference,
  TimerUpdateMode,
  TimeTrendCutoff,
  TimeTrendScale,
} from '../types'
import { DEFAULT_AVERAGE_TRIMMING, isAverageTrimRule } from './averageTrimming'
import {
  isCompetitionFormat,
  isValidRoundId,
  isValidRoundIndex,
} from './competition'
import {
  createDefaultAnalyticsSettings,
  parseAnalyticsSettings,
} from './analyticsSettings'
import { createId } from './id'
import { isDateTimestamp } from './dates'
import { normalizeStoredEvent } from './events'
import {
  DEFAULT_SESSION_NAME,
  MAX_SOLVE_COMMENT_LENGTH,
  normalizeSessionName,
  sortSessionsByOrder,
} from './sessions'
import {
  BUILT_IN_STAT_DEFINITIONS,
  MAX_CUSTOM_AVERAGES,
  isValidCustomAverageSize,
} from './statDefinitions'
import { SESSION_PREFERENCE_KEYS } from './sessionPreferenceKeys'
import { normalizeSessionTransfers } from './sessionTransfers'
import {
  isValidStatTargetKey,
  MAX_STAT_TARGET_MS,
  MIN_STAT_TARGET_MS,
} from './statTargets'
import { isSiteResetInProgress } from './siteReset'

export const SOLVES_STORAGE_KEY = 'cubelab:solves:v1'
export const SESSIONS_STORAGE_KEY = 'cubelab:sessions:v1'
export const SETTINGS_STORAGE_KEY = 'cubelab:settings:v1'
export const STORAGE_VERSION = 1
export const SESSIONS_VERSION = 7
export const SETTINGS_STORAGE_VERSION = 13

export const DEFAULT_SETTINGS: Settings = {
  inspectionEnabled: true,
  inspectionCountDirection: 'down',
  timerUpdateMode: 'live',
  holdDurationMs: 300,
  stopWithAnyKey: false,
  showTimerDecimalSmall: false,
  hideEvenTimerSeconds: false,
  uiZoomPercent: 100,
  statsPanelHeightPercent: 36,
  scrambleAlignment: 'center',
  scrambleLimitHeight: false,
  scrambleAction: 'copy',
  alertChannel: 'off',
  alertVolume: 70,
  inspectionWarning8s: false,
  inspectionWarning12s: false,
  inspectionWarningVisualScope: 'timer',
  theme: 'light',
  accentColor: 'green',
  appearance: {
    accent: null,
    background: null,
    timerBackground: null,
    timerText: null,
  },
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
  statMetricVisibility: {
    current: true,
    best: true,
    target: false,
    bpa: false,
    wpa: false,
  },
  statTargetsMs: {},
  statPrecision: 'centiseconds',
  timeTrendScale: 'auto',
  timeTrendCutoff: 'balanced',
  averageTrimBetter: DEFAULT_AVERAGE_TRIMMING.better,
  averageTrimWorse: DEFAULT_AVERAGE_TRIMMING.worse,
  showSessionSolveProgress: false,
  showSessionTotalTime: false,
  analytics: createDefaultAnalyticsSettings(),
}

function cloneDefaultSettings(): Settings {
  return {
    ...DEFAULT_SETTINGS,
    statVisibility: { ...DEFAULT_SETTINGS.statVisibility },
    customAverages: DEFAULT_SETTINGS.customAverages.map((average) => ({
      ...average,
    })),
    statMetricVisibility: { ...DEFAULT_SETTINGS.statMetricVisibility },
    appearance: { ...DEFAULT_SETTINGS.appearance },
    statTargetsMs: {},
    analytics: createDefaultAnalyticsSettings(),
  }
}

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem?(key: string): void
}

export type CheckedSettingsFailureReason =
  | 'unavailable'
  | 'read-error'
  | 'invalid-json'
  | 'invalid-schema'
  | 'unsupported-version'

/** A validated settings read that may be used as writable state. */
export interface SettingsSnapshot {
  settings: Settings
  /** Exact bytes from the checked read; undefined denotes memory-only mode. */
  raw: string | null | undefined
  sourceVersion: number | null
  memoryOnly: boolean
}

export type CheckedSettingsResult =
  | ({ ok: true } & SettingsSnapshot)
  | {
      ok: false
      reason: CheckedSettingsFailureReason
      raw: string | null | undefined
      message: string
    }

export type CheckedSessionsFailureReason =
  | 'unavailable'
  | 'read-error'
  | 'invalid-json'
  | 'invalid-schema'
  | 'unsupported-version'
  | 'absent'

/** A validated session read that may be used as writable state. */
export interface CheckedSessionsResult {
  ok: true
  data: SessionsData
  /** Current-key bytes; null means an absent current key (possibly legacy). */
  raw: string | null
  sourceVersion: number | null
  /** Exact legacy bytes when this result came from the legacy collection. */
  legacyRaw: string | null
}

export type CheckedSessionsRead =
  | CheckedSessionsResult
  | {
      ok: false
      reason: CheckedSessionsFailureReason
      raw: string | null | undefined
      message: string
    }

interface StoredSessions {
  version: number
  activeSessionId: string
  sessions: Session[]
  customEvents?: CustomEventDefinition[]
  sessionOrder?: SessionOrdering
  sessionTransfers?: SessionTransfer[]
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
  return isDateTimestamp(value) && value > 0
}

function parseFieldUpdate(value: unknown): FieldUpdate | null {
  if (!isRecord(value)) return null
  if (
    typeof value.updatedAt !== 'number' ||
    !Number.isFinite(value.updatedAt) ||
    value.updatedAt < 0
  ) {
    return null
  }
  if (typeof value.editorId !== 'string' || value.editorId.length === 0) return null
  return { updatedAt: value.updatedAt, editorId: value.editorId }
}

function parseImportSource(value: unknown): CsTimerSolveSource | undefined {
  if (!isRecord(value) || value.provider !== 'cstimer') return undefined
  if (typeof value.scrType !== 'string' || value.scrType.length > 200) return undefined
  if (
    typeof value.sessionNumber !== 'number' ||
    !Number.isFinite(value.sessionNumber) ||
    value.sessionNumber < 0
  ) {
    return undefined
  }
  if (
    typeof value.solveIndex !== 'number' ||
    !Number.isFinite(value.solveIndex) ||
    value.solveIndex < 0
  ) {
    return undefined
  }
  const scrTypeSource =
    value.scrTypeSource === 'explicit' ||
    value.scrTypeSource === 'default' ||
    value.scrTypeSource === 'unavailable'
      ? value.scrTypeSource
      : undefined
  return {
    provider: 'cstimer',
    scrType: value.scrType,
    ...(scrTypeSource ? { scrTypeSource } : {}),
    sessionNumber: value.sessionNumber,
    solveIndex: value.solveIndex,
  }
}

export function parseSolve(value: unknown): Solve | null {
  if (!isRecord(value)) return null
  if (typeof value.id !== 'string' || value.id.length === 0) return null
  const rawEvent = value.event === undefined ? '333' : value.event
  const event = normalizeStoredEvent(rawEvent)
  if (!event) return null
  if (
    typeof value.rawMs !== 'number' ||
    !Number.isFinite(value.rawMs) ||
    value.rawMs < 0
  ) {
    return null
  }
  if (!isPenalty(value.penalty)) return null
  if (typeof value.scramble !== 'string') {
    return null
  }
  if (!isPositiveTimestamp(value.createdAt)) return null

  return {
    id: value.id,
    event,
    rawMs: value.rawMs,
    penalty: value.penalty,
    scramble: value.scramble,
    comment:
      typeof value.comment === 'string'
        ? value.comment.slice(0, MAX_SOLVE_COMMENT_LENGTH)
        : '',
    createdAt: value.createdAt,
    // updatedAt is optional; sync code resolves missing values to createdAt.
    ...(isPositiveTimestamp(value.updatedAt)
      ? { updatedAt: value.updatedAt }
      : {}),
    ...(isRecord(value.fieldUpdates)
      ? {
          fieldUpdates: {
            ...(parseFieldUpdate(value.fieldUpdates.rawMs)
              ? { rawMs: parseFieldUpdate(value.fieldUpdates.rawMs)! }
              : {}),
            ...(parseFieldUpdate(value.fieldUpdates.penalty)
              ? { penalty: parseFieldUpdate(value.fieldUpdates.penalty)! }
              : {}),
            ...(parseFieldUpdate(value.fieldUpdates.scramble)
              ? { scramble: parseFieldUpdate(value.fieldUpdates.scramble)! }
              : {}),
            ...(parseFieldUpdate(value.fieldUpdates.comment)
              ? { comment: parseFieldUpdate(value.fieldUpdates.comment)! }
              : {}),
            ...(parseFieldUpdate(value.fieldUpdates.event)
              ? { event: parseFieldUpdate(value.fieldUpdates.event)! }
              : {}),
          },
        }
      : {}),
    ...(parseImportSource(value.importSource)
      ? { importSource: parseImportSource(value.importSource) }
      : {}),
    ...(isValidRoundId(value.roundId) ? { roundId: value.roundId } : {}),
    ...(isValidRoundIndex(value.roundIndex)
      ? { roundIndex: value.roundIndex }
      : {}),
  }
}

function parseSessionFieldUpdates(value: unknown): SessionFieldUpdates | undefined {
  if (!isRecord(value)) return undefined
  const updates: SessionFieldUpdates = {}
  const name = parseFieldUpdate(value.name)
  if (name) updates.name = name
  const event = parseFieldUpdate(value.event)
  if (event) updates.event = event
  const inspectionEnabled = parseFieldUpdate(value.inspectionEnabled)
  if (inspectionEnabled) updates.inspectionEnabled = inspectionEnabled
  if (isRecord(value.preferences)) {
    const preferences: Partial<Record<SessionPreferenceKey, FieldUpdate>> = {}
    for (const key of SESSION_PREFERENCE_KEYS) {
      const update = parseFieldUpdate(value.preferences[key])
      if (update) preferences[key] = update
    }
    if (Object.keys(preferences).length > 0) updates.preferences = preferences
  }
  return Object.keys(updates).length > 0 ? updates : undefined
}

function parseSessionPreferences(value: unknown): SessionPreferences | undefined {
  if (!isRecord(value)) return undefined
  const preferences: SessionPreferences = {}
  if (typeof value.inspectionEnabled === 'boolean') preferences.inspectionEnabled = value.inspectionEnabled
  if (value.inspectionCountDirection === 'down' || value.inspectionCountDirection === 'up') preferences.inspectionCountDirection = value.inspectionCountDirection
  if (typeof value.inspectionWarning8s === 'boolean') preferences.inspectionWarning8s = value.inspectionWarning8s
  if (typeof value.inspectionWarning12s === 'boolean') preferences.inspectionWarning12s = value.inspectionWarning12s
  if (value.inspectionWarningVisualScope === 'timer' || value.inspectionWarningVisualScope === 'screen') preferences.inspectionWarningVisualScope = value.inspectionWarningVisualScope
  if (value.scrambleAlignment === 'left' || value.scrambleAlignment === 'center' || value.scrambleAlignment === 'right') preferences.scrambleAlignment = value.scrambleAlignment
  if (typeof value.scrambleLimitHeight === 'boolean') preferences.scrambleLimitHeight = value.scrambleLimitHeight
  if (value.scrambleAction === 'none' || value.scrambleAction === 'copy' || value.scrambleAction === 'next') preferences.scrambleAction = value.scrambleAction
  if (value.timerUpdateMode === 'live' || value.timerUpdateMode === 'tenths' || value.timerUpdateMode === 'seconds') preferences.timerUpdateMode = value.timerUpdateMode
  if (typeof value.holdDurationMs === 'number' && value.holdDurationMs >= 0 && value.holdDurationMs <= 10000) preferences.holdDurationMs = value.holdDurationMs
  if (typeof value.stopWithAnyKey === 'boolean') preferences.stopWithAnyKey = value.stopWithAnyKey
  if (typeof value.showTimerDecimalSmall === 'boolean') preferences.showTimerDecimalSmall = value.showTimerDecimalSmall
  return Object.keys(preferences).length > 0 ? preferences : undefined
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

  const kind =
    value.kind === 'competition' &&
    isCompetitionFormat(value.competitionFormat)
      ? ('competition' as const)
      : value.kind === 'practice'
        ? ('practice' as const)
        : undefined

  return {
    id: value.id,
    name,
    ...(kind ? { kind } : {}),
    ...(kind === 'competition' && isCompetitionFormat(value.competitionFormat)
      ? { competitionFormat: value.competitionFormat }
      : {}),
    event:
      value.event === undefined
        ? '333'
        : normalizeStoredEvent(value.event) ?? '333',
    ...(value.isAutoCreatedDefault === true ? { isAutoCreatedDefault: true } : {}),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    solves,
    ...(typeof value.inspectionEnabled === 'boolean'
      ? { inspectionEnabled: value.inspectionEnabled }
      : {}),
    ...(parseSessionPreferences(value.preferences)
      ? { preferences: parseSessionPreferences(value.preferences) }
      : {}),
    ...(parseSessionFieldUpdates(value.fieldUpdates)
      ? { fieldUpdates: parseSessionFieldUpdates(value.fieldUpdates) }
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
 * Finds sessions whose solve events disagree with the session event. Imports
 * reject these outright instead of dropping solves or silently changing the
 * session event: a mixed-event session would otherwise wedge synchronization.
 */
export function findSessionEventMismatches(value: unknown): string[] {
  if (!isRecord(value) || !Array.isArray(value.sessions)) return []
  const errors: string[] = []
  for (const [sessionIndex, candidate] of value.sessions.entries()) {
    if (!isRecord(candidate)) continue
    const normalizedName =
      typeof candidate.name === 'string' ? normalizeSessionName(candidate.name) : ''
    const name = normalizedName || `Session ${sessionIndex + 1}`
    const event =
      candidate.event === undefined
        ? '333'
        : normalizeStoredEvent(candidate.event) ?? '333'
    if (!Array.isArray(candidate.solves)) continue
    for (const rawSolve of candidate.solves) {
      const solve = parseSolve(rawSolve)
      if (solve && solve.event !== event) {
        errors.push(
          `Session "${name}" is set to ${event} but contains a ${solve.event} solve (${solve.id}).`,
        )
      }
    }
  }
  return errors
}

/** Reject unrepresentable provided dates before tolerant parsers can drop records. */
export function findSessionDateErrors(value: unknown): string[] {
  if (!isRecord(value) || !Array.isArray(value.sessions)) return []
  for (const [index, session] of value.sessions.entries()) {
    if (!isRecord(session)) continue
    const name = typeof session.name === 'string' ? session.name : `Session ${index + 1}`
    const invalid = (record: Record<string, unknown>) =>
      ['createdAt', 'updatedAt'].some((key) => typeof record[key] === 'number' && !isDateTimestamp(record[key]))
    if (invalid(session)) return [`Session "${name}" has an invalid date.`]
    if (!Array.isArray(session.solves)) continue
    for (const solve of session.solves) {
      if (isRecord(solve) && invalid(solve)) return [`A solve in session "${name}" has an invalid date.`]
    }
  }
  return []
}

function parseSessionOrdering(value: unknown): SessionOrdering | undefined {
  if (!isRecord(value)) return undefined
  if (!Array.isArray(value.ids)) return undefined
  if (
    typeof value.updatedAt !== 'number' ||
    !Number.isFinite(value.updatedAt) ||
    value.updatedAt < 0
  ) {
    return undefined
  }
  if (typeof value.editorId !== 'string' || value.editorId.length === 0) {
    return undefined
  }
  const ids: string[] = []
  const seen = new Set<string>()
  for (const id of value.ids) {
    if (typeof id !== 'string' || id.length === 0 || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return { ids, updatedAt: value.updatedAt, editorId: value.editorId }
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
  const parsedOrder = parseSessionOrdering(value.sessionOrder)
  const sessionOrder = parsedOrder
    ? {
        ...parsedOrder,
        ids: parsedOrder.ids.filter((id) => seen.has(id)),
      }
    : undefined
  const sessionTransfers = Array.isArray(value.sessionTransfers)
    ? normalizeSessionTransfers(value.sessionTransfers)
    : []
  return {
    activeSessionId,
    sessions: sessionOrder ? sortSessionsByOrder(sessions, sessionOrder) : sessions,
    ...(sessionOrder ? { sessionOrder } : {}),
    ...(sessionTransfers.length > 0 ? { sessionTransfers } : {}),
  }
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
    value === 'sound-visual' ||
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

function isValidThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system'
}

function isValidStatPrecision(value: unknown): value is StatPrecision {
  return value === 'centiseconds' || value === 'tenths'
}

function isValidTimeTrendScale(value: unknown): value is TimeTrendScale {
  return value === 'auto' || value === 'full'
}

function isValidTimeTrendCutoff(value: unknown): value is TimeTrendCutoff {
  return value === 'gentle' || value === 'balanced' || value === 'strong'
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

function parseStatMetricVisibility(value: unknown): StatMetricVisibility {
  const fallback = DEFAULT_SETTINGS.statMetricVisibility
  if (!isRecord(value)) return { ...fallback }
  return {
    current:
      typeof value.current === 'boolean' ? value.current : fallback.current,
    best: typeof value.best === 'boolean' ? value.best : fallback.best,
    target: typeof value.target === 'boolean' ? value.target : fallback.target,
    bpa: typeof value.bpa === 'boolean' ? value.bpa : fallback.bpa,
    wpa: typeof value.wpa === 'boolean' ? value.wpa : fallback.wpa,
  }
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

function parseStatTargets(value: unknown): StatTargetsMs {
  if (!isRecord(value)) return {}
  const targets: StatTargetsMs = {}
  for (const [event, entries] of Object.entries(value)) {
    if (typeof event !== 'string' || event.length === 0 || !isRecord(entries)) {
      continue
    }
    const eventTargets: Record<string, number> = {}
    for (const [key, target] of Object.entries(entries)) {
      if (
        !isValidStatTargetKey(key) ||
        typeof target !== 'number' ||
        !Number.isFinite(target) ||
        target < MIN_STAT_TARGET_MS ||
        target > MAX_STAT_TARGET_MS
      ) {
        continue
      }
      eventTargets[key] = Math.round(target / 10) * 10
    }
    if (Object.keys(eventTargets).length > 0) targets[event] = eventTargets
  }
  return targets
}

export function parseSettingsData(value: unknown): Settings | null {
  if (!isRecord(value)) return null
  if (typeof value.inspectionEnabled !== 'boolean') return null

  const inspectionEnabled = value.inspectionEnabled
  const appearanceValue = isRecord(value.appearance) ? value.appearance : {}
  const parseColor = (color: unknown): string | null =>
    typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color)
      ? color.toLocaleLowerCase()
      : null

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
    hideEvenTimerSeconds:
      typeof value.hideEvenTimerSeconds === 'boolean'
        ? value.hideEvenTimerSeconds
        : DEFAULT_SETTINGS.hideEvenTimerSeconds,
    uiZoomPercent:
      typeof value.uiZoomPercent === 'number' &&
      Number.isFinite(value.uiZoomPercent) &&
      value.uiZoomPercent >= 70 &&
      value.uiZoomPercent <= 150
        ? value.uiZoomPercent
        : DEFAULT_SETTINGS.uiZoomPercent,
    statsPanelHeightPercent:
      typeof value.statsPanelHeightPercent === 'number' &&
      Number.isFinite(value.statsPanelHeightPercent) &&
      value.statsPanelHeightPercent >= 5 &&
      value.statsPanelHeightPercent <= 95
        ? value.statsPanelHeightPercent
        : DEFAULT_SETTINGS.statsPanelHeightPercent,
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
      value.alertVolume >= 50 &&
      value.alertVolume <= 150
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
    theme: isValidThemePreference(value.theme)
      ? value.theme
      : DEFAULT_SETTINGS.theme,
    appearance: {
      accent: parseColor(appearanceValue.accent),
      background: parseColor(appearanceValue.background),
      timerBackground: parseColor(appearanceValue.timerBackground),
      timerText: parseColor(appearanceValue.timerText),
    },
    averageTrimBetter: isAverageTrimRule(value.averageTrimBetter) ? value.averageTrimBetter : DEFAULT_SETTINGS.averageTrimBetter,
    averageTrimWorse: value.averageTrimWorse === 'auto' || isAverageTrimRule(value.averageTrimWorse) ? value.averageTrimWorse : DEFAULT_SETTINGS.averageTrimWorse,
    showSessionSolveProgress:
      typeof value.showSessionSolveProgress === 'boolean'
        ? value.showSessionSolveProgress
        : DEFAULT_SETTINGS.showSessionSolveProgress,
    showSessionTotalTime:
      typeof value.showSessionTotalTime === 'boolean'
        ? value.showSessionTotalTime
        : DEFAULT_SETTINGS.showSessionTotalTime,
    statVisibility: parseStatVisibility(value.statVisibility),
    customAverages: parseCustomAverages(value.customAverages),
    statMetricVisibility: parseStatMetricVisibility(value.statMetricVisibility),
    statTargetsMs: parseStatTargets(value.statTargetsMs),
    statPrecision: isValidStatPrecision(value.statPrecision)
      ? value.statPrecision
      : DEFAULT_SETTINGS.statPrecision,
    timeTrendScale: isValidTimeTrendScale(value.timeTrendScale)
      ? value.timeTrendScale
      : DEFAULT_SETTINGS.timeTrendScale,
    timeTrendCutoff: isValidTimeTrendCutoff(value.timeTrendCutoff)
      ? value.timeTrendCutoff
      : DEFAULT_SETTINGS.timeTrendCutoff,
    analytics: parseAnalyticsSettings(value.analytics),
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
        isAutoCreatedDefault: true,
        createdAt: now,
        updatedAt: now,
        solves: [],
      },
    ],
  }
}

function createSessionsFromLegacy(solves: readonly Solve[]): SessionsData {
  const id = createId()
  // Reduce instead of spreading an unbounded history into Math.min/Math.max:
  // very large legacy arrays exceed the engine argument limit and throw.
  let createdAt = Number.POSITIVE_INFINITY
  let updatedAt = 0
  for (const solve of solves) {
    if (solve.createdAt < createdAt) createdAt = solve.createdAt
    if (solve.createdAt > updatedAt) updatedAt = solve.createdAt
  }
  if (!Number.isFinite(createdAt)) createdAt = Date.now()
  if (updatedAt === 0) updatedAt = createdAt

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
 * Strict startup/adoption check: the parser may intentionally filter invalid
 * records for the tolerant read-only loader, but a writable checked result must
 * not silently drop stored sessions or solves. Duplicate IDs and malformed
 * records therefore fail the whole read and leave the raw bytes for recovery.
 */
function findSessionRecordLoss(
  value: Record<string, unknown>,
  data: SessionsData,
): string | null {
  if (!Array.isArray(value.sessions)) return 'Saved session data has no session list.'
  if (data.sessions.length !== value.sessions.length) {
    return 'Saved session data contains a session that could not be validated. The original data has been kept for recovery.'
  }
  for (const candidate of value.sessions) {
    if (!isRecord(candidate)) {
      return 'Saved session data contains an invalid session record. The original data has been kept for recovery.'
    }
    const parsed = data.sessions.find((session) => session.id === candidate.id)
    if (!parsed) {
      return 'Saved session data contains an invalid or duplicate session. The original data has been kept for recovery.'
    }
    if (!Array.isArray(candidate.solves)) {
      return 'Saved session data contains a session without a solve list. The original data has been kept for recovery.'
    }
    if (parsed.solves.length !== candidate.solves.length) {
      return `Session "${parsed.name}" contains a solve that could not be validated. The original data has been kept for recovery.`
    }
    const solving = new Set(parsed.solves.map((solve) => solve.id))
    if (solving.size !== parsed.solves.length) {
      return `Session "${parsed.name}" contains duplicate solve IDs. The original data has been kept for recovery.`
    }
    for (const rawSolve of candidate.solves) {
      if (!isRecord(rawSolve) || typeof rawSolve.id !== 'string' || !solving.has(rawSolve.id)) {
        return `Session "${parsed.name}" contains a solve that could not be validated. The original data has been kept for recovery.`
      }
    }
  }
  return null
}

/**
 * Strictly reads the authoritative session collection without writing or
 * falling back to defaults. Only a genuinely absent key (and no usable legacy
 * record) reports `absent`; callers may create a fresh session only when they
 * have established that this is a first install or an explicitly destructive
 * reset.
 */
export function loadSessionsChecked(
  storage = getDefaultStorage(),
): CheckedSessionsRead {
  if (!storage) {
    return {
      ok: false,
      reason: 'unavailable',
      raw: undefined,
      message: 'Browser storage is unavailable. Saved history was not read or changed.',
    }
  }

  let raw: string | null
  try {
    raw = storage.getItem(SESSIONS_STORAGE_KEY)
  } catch {
    return {
      ok: false,
      reason: 'read-error',
      raw: undefined,
      message:
        'Saved history could not be read safely. The original data has been kept. Retry after browser storage recovers.',
    }
  }

  if (raw !== null) {
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return {
        ok: false,
        reason: 'invalid-json',
        raw,
        message:
          'Saved session data is not valid JSON. The original data has been kept for recovery.',
      }
    }
    if (
      !isRecord(parsed) ||
      typeof parsed.version !== 'number' ||
      !Number.isInteger(parsed.version)
    ) {
      return {
        ok: false,
        reason: 'invalid-schema',
        raw,
        message:
          'Saved session data has an unsupported format. The original data has been kept for recovery.',
      }
    }
    if (parsed.version < 1 || parsed.version > SESSIONS_VERSION) {
      return {
        ok: false,
        reason: 'unsupported-version',
        raw,
        message: `Saved session data uses schema v${parsed.version}, which this build cannot safely edit. The original data has been kept for recovery.`,
      }
    }
    if (!Array.isArray(parsed.sessions)) {
      return {
        ok: false,
        reason: 'invalid-schema',
        raw,
        message:
          'Saved session data could not be validated. The original data has been kept for recovery.',
      }
    }
    const dateErrors = findSessionDateErrors(parsed)
    if (dateErrors.length > 0) {
      return {
        ok: false,
        reason: 'invalid-schema',
        raw,
        message: `${dateErrors[0]} The original data has been kept for recovery.`,
      }
    }
    const data = parseSessionsData(parsed)
    if (!data) {
      return {
        ok: false,
        reason: 'invalid-schema',
        raw,
        message:
          'Saved session data could not be validated. The original data has been kept for recovery.',
      }
    }
    const recordLoss = findSessionRecordLoss(parsed, data)
    if (recordLoss) {
      return {
        ok: false,
        reason: 'invalid-schema',
        raw,
        message: recordLoss,
      }
    }
    return {
      ok: true,
      data,
      raw,
      sourceVersion: parsed.version,
      legacyRaw: null,
    }
  }

  // Only an absent current key permits legacy migration. Cache the legacy read
  // so a transient failure cannot be mistaken for an empty history.
  let legacyRaw: string | null
  try {
    legacyRaw = storage.getItem(SOLVES_STORAGE_KEY)
  } catch {
    return {
      ok: false,
      reason: 'read-error',
      raw: null,
      message:
        'Saved history could not be read safely. The original data has been kept. Retry after browser storage recovers.',
    }
  }
  if (legacyRaw === null) {
    return {
      ok: false,
      reason: 'absent',
      raw: null,
      message: 'No saved session collection exists yet.',
    }
  }

  let legacy: unknown
  try {
    legacy = JSON.parse(legacyRaw)
  } catch {
    return {
      ok: false,
      reason: 'invalid-json',
      raw: legacyRaw,
      message:
        'Saved legacy history is not valid JSON. The original data has been kept for recovery.',
    }
  }
  if (
    !isRecord(legacy) ||
    typeof legacy.version !== 'number' ||
    legacy.version !== STORAGE_VERSION ||
    !Array.isArray(legacy.solves)
  ) {
    return {
      ok: false,
      reason:
        isRecord(legacy) && typeof legacy.version === 'number' && legacy.version !== STORAGE_VERSION
          ? 'unsupported-version'
          : 'invalid-schema',
      raw: legacyRaw,
      message:
        'Saved legacy history could not be validated. The original data has been kept for recovery.',
    }
  }
  const dateErrors = findSessionDateErrors({
    sessions: [{ name: 'Legacy history', solves: legacy.solves }],
  })
  if (dateErrors.length > 0) {
    return {
      ok: false,
      reason: 'invalid-schema',
      raw: legacyRaw,
      message: `${dateErrors[0]} The original data has been kept for recovery.`,
    }
  }
  const solves = loadSolves({ getItem: () => legacyRaw, setItem: () => {} })
  if (solves.length === 0) {
    return {
      ok: false,
      reason: 'absent',
      raw: null,
      message: 'No usable saved solve history exists yet.',
    }
  }
  if (solves.length !== legacy.solves.length) {
    return {
      ok: false,
      reason: 'invalid-schema',
      raw: legacyRaw,
      message:
        'Saved legacy history contains a solve that could not be validated. The original data has been kept for recovery.',
    }
  }
  return {
    ok: true,
    data: createSessionsFromLegacy(solves),
    raw: null,
    sourceVersion: null,
    legacyRaw,
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
        typeof parsed.version === 'number' &&
        parsed.version >= 1 &&
        parsed.version <= SESSIONS_VERSION
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

class SessionLoadError extends Error {}

export interface SessionsSnapshot {
  data: SessionsData
  /** Raw bytes from the same checked read; undefined denotes memory-only mode. */
  raw: string | null | undefined
  /** Source schema, or null for a legacy/fresh collection. */
  sourceVersion?: number | null
  /** Exact legacy bytes when the collection was migrated from `cubelab:solves:v1`. */
  legacyRaw?: string | null
}

/**
 * Read once before mounting editable hooks. Unlike the tolerant read-only loader,
 * startup never turns an unreadable or unsupported stored collection into an
 * empty writable one. The original bytes are retained for explicit recovery.
 */
export function loadSessionsForStartup(storage = getDefaultStorage()): SessionsSnapshot {
  if (!storage) {
    return {
      data: createEmptySessions(),
      raw: undefined,
      sourceVersion: null,
      legacyRaw: null,
    }
  }
  const checked = loadSessionsChecked(storage)
  if (checked.ok) {
    return {
      data: checked.data,
      raw: checked.raw,
      sourceVersion: checked.sourceVersion,
      legacyRaw: checked.legacyRaw,
    }
  }
  if (checked.reason === 'absent') {
    return {
      data: createEmptySessions(),
      raw: checked.raw,
      sourceVersion: null,
      legacyRaw: null,
    }
  }
  throw new SessionLoadError(checked.message)
}

export function serializeSessionsData(data: SessionsData): string {
  const payload: StoredSessions = {
    version: SESSIONS_VERSION,
    activeSessionId: data.activeSessionId,
    sessions: [...data.sessions],
    ...(data.sessionOrder ? { sessionOrder: data.sessionOrder } : {}),
    ...(data.sessionTransfers && data.sessionTransfers.length > 0
      ? { sessionTransfers: data.sessionTransfers }
      : {}),
  }
  return JSON.stringify(payload)
}

/**
 * Serializes the collection once, writes those exact bytes and returns them so
 * callers that track the persisted payload can reuse the stored string instead
 * of serializing again. `null` means nothing was written.
 */
export function saveSessionsSerialized(
  data: SessionsData,
  storage = getDefaultStorage(),
): string | null {
  if (!storage || isSiteResetInProgress()) return null
  const raw = serializeSessionsData(data)
  try {
    storage.setItem(SESSIONS_STORAGE_KEY, raw)
    return raw
  } catch {
    return null
  }
}

export function saveSessions(
  data: SessionsData,
  storage = getDefaultStorage(),
): boolean {
  return saveSessionsSerialized(data, storage) !== null
}

/**
 * Returns the current raw collection so a writer can detect an external
 * replacement candidate before overwriting it. `undefined` means the read
 * itself failed, which callers must treat conservatively.
 */
export function readSessionsRaw(
  storage = getDefaultStorage(),
): string | null | undefined {
  if (!storage) return undefined
  try {
    return storage.getItem(SESSIONS_STORAGE_KEY)
  } catch {
    return undefined
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
      // `cubelab:solves:v1` predates multi-event sessions and was only ever
      // written for 3x3. Do not migrate records tagged for another event into
      // the 3x3 legacy session.
      if (solve && solve.event === '333' && !seen.has(solve.id)) {
        seen.add(solve.id)
        solves.push(solve)
      }
    }
    return solves
  } catch {
    return []
  }
}

/**
 * Strictly reads the authoritative settings record. Only a genuinely absent
 * key permits defaults. A read error, malformed JSON, invalid schema or an
 * unsupported/future version fails closed and never writes.
 */
export function loadSettingsChecked(
  storage = getDefaultStorage(),
): CheckedSettingsResult {
  if (!storage) {
    return {
      ok: false,
      reason: 'unavailable',
      raw: undefined,
      message:
        'Browser storage is unavailable. Settings were not read or changed.',
    }
  }

  let raw: string | null
  try {
    raw = storage.getItem(SETTINGS_STORAGE_KEY)
  } catch {
    return {
      ok: false,
      reason: 'read-error',
      raw: undefined,
      message:
        'Saved settings could not be read safely. The original data has been kept. Retry after browser storage recovers.',
    }
  }

  if (raw === null) {
    return {
      ok: true,
      settings: cloneDefaultSettings(),
      raw,
      sourceVersion: null,
      memoryOnly: false,
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {
      ok: false,
      reason: 'invalid-json',
      raw,
      message:
        'Saved settings are not valid JSON. The original data has been kept for recovery.',
    }
  }
  if (!isRecord(parsed) || !isRecord(parsed.settings)) {
    return {
      ok: false,
      reason: 'invalid-schema',
      raw,
      message:
        'Saved settings have an unsupported format. The original data has been kept for recovery.',
    }
  }
  if (
    typeof parsed.version !== 'number' ||
    !Number.isInteger(parsed.version)
  ) {
    return {
      ok: false,
      reason: 'invalid-schema',
      raw,
      message:
        'Saved settings are missing a supported schema version. The original data has been kept for recovery.',
    }
  }
  if (
    parsed.version < 1 ||
    parsed.version > SETTINGS_STORAGE_VERSION
  ) {
    return {
      ok: false,
      reason: 'unsupported-version',
      raw,
      message: `Saved settings use schema v${parsed.version}, which this build cannot safely edit. The original data has been kept for recovery.`,
    }
  }
  const settings = parseSettingsData(parsed.settings)
  if (!settings) {
    return {
      ok: false,
      reason: 'invalid-schema',
      raw,
      message:
        'Saved settings could not be validated. The original data has been kept for recovery.',
    }
  }
  return {
    ok: true,
    settings,
    raw,
    sourceVersion: parsed.version,
    memoryOnly: false,
  }
}

/**
 * Startup wrapper that preserves the documented memory-only mode when the
 * browser exposes no storage API. Every other failure stays structured.
 */
export function loadSettingsForStartup(
  storage = getDefaultStorage(),
): CheckedSettingsResult {
  if (!storage) {
    return {
      ok: true,
      settings: cloneDefaultSettings(),
      raw: undefined,
      sourceVersion: null,
      memoryOnly: true,
    }
  }
  return loadSettingsChecked(storage)
}

/**
 * Tolerant presentation-only reader. Never use this result as writable state:
 * malformed, unsupported or unreadable records fall back to defaults here.
 */
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

export function serializeSettingsData(settings: Settings): string {
  const payload: StoredSettings = {
    version: SETTINGS_STORAGE_VERSION,
    settings: { ...settings },
  }
  return JSON.stringify(payload)
}

export function saveSettings(
  settings: Settings,
  storage = getDefaultStorage(),
): boolean {
  if (!storage || isSiteResetInProgress()) return false

  try {
    storage.setItem(SETTINGS_STORAGE_KEY, serializeSettingsData(settings))
    return true
  } catch {
    return false
  }
}
