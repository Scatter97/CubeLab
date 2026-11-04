import type { Backup } from './backup'
import { createBackup } from './backup'
import type {
  CsTimerScrTypeSource,
  CsTimerSolveSource,
  CustomEventDefinition,
  Session,
  SessionsData,
  Settings,
  Solve,
} from '../types'
import { createId } from './id'
import { getEventDefinition } from './events'
import type { PuzzleEvent } from '../types'
import {
  builtInEventForCsTimerType,
  resolveCsTimerEvent,
} from './customEvents'
import type { CsTimerEventResolution } from './customEvents'
import { normalizeSessionName, resolveUniqueSessionNames } from './sessions'

export type CsTimerMappingKind = 'built-in' | 'custom' | 'new-custom'

export interface CsTimerSessionPreview {
  /** Position in csTimer's ranked source order. */
  index: number
  /** Original csTimer `sessionN` number, used for ordering and provenance. */
  sessionNumber: number
  /** Final, collision-free name that will be stored by the import. */
  name: string
  scrType: string
  event: PuzzleEvent
  eventLabel: string
  mapping: CsTimerMappingKind
  solveCount: number
}

export interface CsTimerEventMapping {
  /** Original value, including an empty string when the type is unavailable. */
  sourceType: string
  scrType: string
  event: PuzzleEvent
  label: string
  mapping: CsTimerMappingKind
}

export interface CsTimerImportPreview {
  totalSessions: number
  totalSolves: number
  /** Every source session, in ranked source order, including empty sessions. */
  sessions: CsTimerSessionPreview[]
  mappings: CsTimerEventMapping[]
  newCustomEventCount: number
  hasUnknown: boolean
}

export interface CsTimerImportOptions {
  /** Current definitions; repeated imports reuse their deterministic IDs. */
  existingCustomEvents?: readonly CustomEventDefinition[]
  /** Optional display name keyed by the original `scrType` (including ''). */
  customEventNames?: Readonly<Record<string, string>>
  /** Stored local names used to resolve duplicate imported session names. */
  existingSessionNames?: readonly string[]
}

interface ResolvedScrType {
  scrType: string
  source: CsTimerScrTypeSource
}

interface SourceSession {
  key: string
  sessionNumber: number
  originalIndex: number
  meta: Record<string, unknown> | null
  times: unknown[]
  rawName: string
  rank: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isCsTimerBackup(raw: string): boolean {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) return false
    return Object.keys(parsed).some((key) => /^session\d+$/.test(key))
  } catch {
    return false
  }
}

function mapPenalty(code: unknown): Solve['penalty'] {
  if (code === 2000 || code === '+2' || code === 2) return '+2'
  if (code === -1 || code === 'DNF' || code === 'dnf') return 'dnf'
  return 'none'
}

/** Match storage's positive timestamps and JavaScript's representable date range. */
function validUnixSeconds(value: unknown): boolean {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false
  const milliseconds = value * 1000
  return Number.isFinite(milliseconds) && milliseconds > 0 && milliseconds <= 8_640_000_000_000_000
}

function sessionDataError(times: readonly unknown[], dates: readonly unknown[], sessionNumber: number): string | null {
  // Empty sessions carry no solve data. csTimer can export null/missing dates
  // for them; import time is a safe fallback instead of rejecting the file.
  if (times.length === 0) return null
  if (dates.length > 0 && !validUnixSeconds(dates[0])) {
    return `csTimer session ${sessionNumber}: invalid session date. No data was imported.`
  }
  for (const [index, entry] of times.entries()) {
    const prefix = `csTimer session ${sessionNumber}, solve ${index + 1}:`
    if (!Array.isArray(entry) || entry.length < 2) {
      return `${prefix} invalid solve record. No data was imported.`
    }
    const duration = Array.isArray(entry[0]) ? entry[0][1] : entry[0]
    if (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0) {
      return `${prefix} duration must be a finite nonnegative number. No data was imported.`
    }
    if (typeof entry[1] !== 'string') {
      return `${prefix} missing scramble. No data was imported.`
    }
    if (entry[3] !== undefined && !validUnixSeconds(entry[3])) {
      return `${prefix} invalid solve date. No data was imported.`
    }
  }
  return null
}

interface SessionDataResult {
  data: Record<string, unknown>
  available: boolean
}

function readSessionData(parsed: Record<string, unknown>): SessionDataResult {
  const props = isRecord(parsed.properties) ? parsed.properties : null
  if (!props || !Object.prototype.hasOwnProperty.call(props, 'sessionData')) {
    return { data: {}, available: false }
  }
  const raw = props.sessionData
  if (typeof raw === 'string') {
    try {
      const parsedData = JSON.parse(raw)
      if (isRecord(parsedData)) return { data: parsedData, available: true }
    } catch {
      // Malformed metadata is unavailable, not an implicit 3×3 default.
    }
    return { data: {}, available: false }
  }
  return isRecord(raw)
    ? { data: raw, available: true }
    : { data: {}, available: false }
}

function sortedSessionKeys(parsed: Record<string, unknown>): string[] {
  return Object.keys(parsed)
    .filter((key) => /^session\d+$/.test(key))
    .sort((a, b) => Number(a.slice(7)) - Number(b.slice(7)))
}

function mappingKind(
  scrType: string,
  resolution: CsTimerEventResolution,
): CsTimerMappingKind {
  if (builtInEventForCsTimerType(scrType)) return 'built-in'
  return resolution.created ? 'new-custom' : 'custom'
}

function resolveSessionEvent(
  scrType: string,
  definitions: readonly CustomEventDefinition[],
  options: CsTimerImportOptions,
  now?: number,
): { resolution: CsTimerEventResolution; definitions: CustomEventDefinition[] } {
  return resolveCsTimerEvent({
    scrType,
    definitions,
    name: options.customEventNames?.[scrType],
    ...(now !== undefined ? { now } : {}),
  })
}

function readRawSessionName(
  meta: Record<string, unknown> | null,
  sessionNumber: number,
): string {
  const value = meta?.name
  if (typeof value === 'string' && normalizeSessionName(value)) return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return `csTimer session ${sessionNumber}`
}

function sessionRank(
  meta: Record<string, unknown> | null,
  sessionNumber: number,
): number {
  const value = meta?.rank
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : sessionNumber
}

/**
 * csTimer's session manager reads `opt.scrType || '333'` for valid session
 * metadata. An omitted value is therefore the official 3×3 default. Missing or
 * malformed metadata is not treated as an omission, and explicit unsupported
 * identifiers remain custom events.
 */
function resolveScrType(meta: Record<string, unknown> | null): ResolvedScrType {
  if (!meta) return { scrType: '', source: 'unavailable' }
  if (!Object.prototype.hasOwnProperty.call(meta, 'opt')) {
    return { scrType: '333', source: 'default' }
  }
  const opt = meta.opt
  if (!isRecord(opt)) return { scrType: '', source: 'unavailable' }
  if (!Object.prototype.hasOwnProperty.call(opt, 'scrType')) {
    return { scrType: '333', source: 'default' }
  }
  return {
    scrType: typeof opt.scrType === 'string' ? opt.scrType : '',
    source: 'explicit',
  }
}

interface BuiltImport {
  preview: CsTimerImportPreview
  sessions: Session[]
  definitions: CustomEventDefinition[]
}

function buildImport(
  raw: string,
  options: CsTimerImportOptions,
  now: number,
): { ok: true; result: BuiltImport } | { ok: false; error: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, error: 'That file is not valid JSON.' }
  }
  if (!isRecord(parsed)) {
    return { ok: false, error: 'That csTimer file is not an object.' }
  }

  const sessionKeys = sortedSessionKeys(parsed)
  if (sessionKeys.length === 0) {
    return { ok: false, error: 'No csTimer sessions found in that file.' }
  }

  const sessionData = readSessionData(parsed)
  const sourceSessions: SourceSession[] = []

  for (const [originalIndex, key] of sessionKeys.entries()) {
    const sessionNumber = Number(key.slice(7))
    const rawTimes = parsed[key]
    if (!Array.isArray(rawTimes)) {
      return {
        ok: false,
        error: `csTimer session ${sessionNumber}: invalid solve list. No data was imported.`,
      }
    }
    const meta =
      sessionData.available &&
      isRecord(sessionData.data[String(sessionNumber)])
        ? (sessionData.data[String(sessionNumber)] as Record<string, unknown>)
        : null
    sourceSessions.push({
      key,
      sessionNumber,
      originalIndex,
      meta,
      times: rawTimes,
      rawName: readRawSessionName(meta, sessionNumber),
      rank: sessionRank(meta, sessionNumber),
    })
  }

  sourceSessions.sort(
    (left, right) =>
      left.rank - right.rank ||
      left.sessionNumber - right.sessionNumber ||
      left.originalIndex - right.originalIndex,
  )

  const resolvedNames = resolveUniqueSessionNames(
    sourceSessions.map((session) => session.rawName),
    options.existingSessionNames ?? [],
  )

  let definitions = [...(options.existingCustomEvents ?? [])]
  const previews: CsTimerSessionPreview[] = []
  const mappings = new Map<string, CsTimerEventMapping>()
  const createdIds = new Set<string>()
  const sessions: Session[] = []
  let totalSolves = 0

  for (const [index, source] of sourceSessions.entries()) {
    const dates = Array.isArray(source.meta?.date) ? source.meta.date : []
    const error = sessionDataError(
      source.times,
      dates,
      source.sessionNumber,
    )
    if (error) return { ok: false, error }

    const resolvedScrType = resolveScrType(source.meta)
    const resolved = resolveSessionEvent(
      resolvedScrType.scrType,
      definitions,
      options,
      now,
    )
    definitions = resolved.definitions
    const event = resolved.resolution.eventId
    const kind = mappingKind(resolvedScrType.scrType, resolved.resolution)
    if (kind === 'new-custom' && resolved.resolution.customEvent) {
      createdIds.add(resolved.resolution.customEvent.id)
    }
    const eventLabel =
      resolved.resolution.customEvent?.name ??
      getEventDefinition(event)?.label ??
      event
    const solveCount = source.times.length
    const sessionCreatedAt =
      dates.length > 0 && validUnixSeconds(dates[0])
        ? (dates[0] as number) * 1000
        : now

    const solves: Solve[] = []
    for (const [solveIndex, entry] of source.times.entries()) {
      const record = entry as unknown[]
      const head = record[0]
      let penaltyCode: unknown = 0
      let timeMs = 0
      if (Array.isArray(head)) {
        penaltyCode = head[0]
        timeMs = typeof head[1] === 'number' ? head[1] : 0
      } else if (typeof head === 'number') {
        timeMs = head
      }

      const createdAt =
        typeof record[3] === 'number'
          ? record[3] * 1000
          : dates.length > 0 && typeof dates[0] === 'number'
            ? (dates[0] as number) * 1000
            : now
      const importSource: CsTimerSolveSource = {
        provider: 'cstimer',
        scrType: resolvedScrType.scrType,
        scrTypeSource: resolvedScrType.source,
        sessionNumber: source.sessionNumber,
        solveIndex,
      }
      solves.push({
        id: createId(),
        event,
        rawMs: Math.max(0, Math.floor(timeMs)),
        penalty: mapPenalty(penaltyCode),
        scramble: typeof record[1] === 'string' ? record[1] : '',
        comment: typeof record[2] === 'string' ? record[2].slice(0, 500) : '',
        createdAt,
        importSource,
      })
    }

    const name = resolvedNames[index] ?? source.rawName
    previews.push({
      index,
      sessionNumber: source.sessionNumber,
      name,
      scrType: resolvedScrType.scrType,
      event,
      eventLabel,
      mapping: kind,
      solveCount,
    })
    const mappingKey = `${resolvedScrType.source}\u0000${resolvedScrType.scrType}`
    mappings.set(mappingKey, {
      sourceType: resolvedScrType.scrType,
      scrType: resolvedScrType.scrType || '(missing)',
      event,
      label: eventLabel,
      mapping: kind,
    })
    sessions.push({
      id: createId(),
      name,
      event,
      createdAt: sessionCreatedAt,
      updatedAt: sessionCreatedAt,
      solves: solves.reverse(),
    })
    totalSolves += solveCount
  }

  return {
    ok: true,
    result: {
      sessions,
      definitions,
      preview: {
        totalSessions: sourceSessions.length,
        totalSolves,
        sessions: previews,
        mappings: [...mappings.values()],
        newCustomEventCount: createdIds.size,
        hasUnknown:
          createdIds.size > 0 ||
          previews.some((preview) => preview.mapping === 'custom'),
      },
    },
  }
}

export function analyzeCsTimerBackup(
  raw: string,
  options: CsTimerImportOptions = {},
): { ok: true; preview: CsTimerImportPreview } | { ok: false; error: string } {
  const built = buildImport(raw, options, Date.now())
  if (!built.ok) return built
  return { ok: true, preview: built.result.preview }
}

export function parseCsTimerBackup(
  raw: string,
  settings: Settings,
  options: CsTimerImportOptions = {},
): { ok: true; backup: Backup; preview: CsTimerImportPreview } | { ok: false; error: string } {
  const built = buildImport(raw, options, Date.now())
  if (!built.ok) return built

  const { sessions, definitions, preview } = built.result
  const activeSessionId = sessions[0]!.id
  const sessionsData: SessionsData = {
    activeSessionId,
    sessions,
    ...(definitions.length > 0 ? { customEvents: definitions } : {}),
  }
  const backup = createBackup(sessionsData, settings)
  backup.importMode = 'add'
  return { ok: true, backup, preview }
}
