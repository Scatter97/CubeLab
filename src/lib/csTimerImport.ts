import type { Backup } from './backup'
import { createBackup } from './backup'
import type { Session, SessionsData, Settings, Solve } from '../types'
import { createId } from './id'
import { getEventDefinition } from './events'
import type { PuzzleEvent } from '../types'

const CSTIMER_SCR_TYPE_MAP: Record<string, PuzzleEvent> = {
  '': '333',
  '333': '333',
  '333wca': '333',
  '333ni': '333',
  '333oh': '333oh',
  '222': '222',
  '222so': '222',
  '222wca': '222',
  '444': '444',
  '444wca': '444',
  '555': '555',
  '555wca': '555',
  '666': '666',
  '666wca': '666',
  '777': '777',
  '777wca': '777',
  // csTimer's official WCA scramble type IDs for the remaining events.
  'pyrso': 'pyram',
  'pyram': 'pyram',
  'pyraminx': 'pyram',
  'skbso': 'skewb',
  'skewb': 'skewb',
  'sqrs': 'sq1',
  'sq1': 'sq1',
  'square1': 'sq1',
  'clkwca': 'clock',
  'clock': 'clock',
  'mgmp': 'minx',
  'minx': 'minx',
  'megaminx': 'minx',
}

export interface CsTimerSessionPreview {
  index: number
  name: string
  scrType: string
  event: PuzzleEvent | null
  solveCount: number
  supported: boolean
  reason?: string
}

export interface CsTimerImportPreview {
  totalSessions: number
  totalSolves: number
  supportedSessions: number
  supportedSolves: number
  skippedSessions: number
  skippedSolves: number
  sessions: CsTimerSessionPreview[]
  hasUnknown: boolean
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

function eventForScrType(scrType: string): PuzzleEvent | null {
  const key = scrType.trim().toLowerCase()
  if (key in CSTIMER_SCR_TYPE_MAP) return CSTIMER_SCR_TYPE_MAP[key]!
  return null
}

function analyze(raw: string): { ok: true; preview: CsTimerImportPreview } | { ok: false; error: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, error: 'That file is not valid JSON.' }
  }
  if (!isRecord(parsed)) {
    return { ok: false, error: 'That csTimer file is not an object.' }
  }

  const sessionKeys = Object.keys(parsed)
    .filter((key) => /^session\d+$/.test(key))
    .sort((a, b) => Number(a.slice(7)) - Number(b.slice(7)))

  if (sessionKeys.length === 0) {
    return { ok: false, error: 'No csTimer sessions found in that file.' }
  }

  const props = isRecord(parsed.properties) ? parsed.properties : {}
  let sessionData: Record<string, unknown> = {}
  if (typeof props.sessionData === 'string') {
    try {
      const parsedSd = JSON.parse(props.sessionData)
      if (isRecord(parsedSd)) sessionData = parsedSd
    } catch {
      // ignore; fall back to defaults
    }
  } else if (isRecord(props.sessionData)) {
    sessionData = props.sessionData as Record<string, unknown>
  }

  const previews: CsTimerSessionPreview[] = []
  let totalSolves = 0
  let supportedSessions = 0
  let supportedSolves = 0
  let skippedSessions = 0
  let skippedSolves = 0

  sessionKeys.forEach((key, idx) => {
    const sessionNum = Number(key.slice(7))
    const meta = isRecord(sessionData[String(sessionNum)])
      ? (sessionData[String(sessionNum)] as Record<string, unknown>)
      : {}
    const rawName =
      typeof meta.name === 'string' && meta.name.trim()
        ? meta.name.trim().slice(0, 40)
        : `csTimer session ${sessionNum}`
    const opt = isRecord(meta.opt) ? meta.opt : {}
    const scrType = typeof opt.scrType === 'string' ? opt.scrType : ''
    const event = eventForScrType(scrType)
    const times = Array.isArray(parsed[key]) ? (parsed[key] as unknown[]) : []
    const solveCount = times.length

    let supported = true
    let reason: string | undefined
    if (!event) {
      supported = false
      reason = scrType ? `Unknown puzzle: ${scrType}` : 'Unknown puzzle'
    }

    previews.push({
      index: idx,
      name: rawName,
      scrType: scrType || '(default 3x3)',
      event,
      solveCount,
      supported,
      reason,
    })

    totalSolves += solveCount
    if (supported) {
      supportedSessions += 1
      supportedSolves += solveCount
    } else {
      skippedSessions += 1
      skippedSolves += solveCount
    }
  })

  return {
    ok: true,
    preview: {
      totalSessions: sessionKeys.length,
      totalSolves,
      supportedSessions,
      supportedSolves,
      skippedSessions,
      skippedSolves,
      sessions: previews,
      hasUnknown: skippedSessions > 0,
    },
  }
}

export function analyzeCsTimerBackup(raw: string): ReturnType<typeof analyze> {
  return analyze(raw)
}

export function parseCsTimerBackup(
  raw: string,
  settings: Settings,
): { ok: true; backup: Backup; preview: CsTimerImportPreview } | { ok: false; error: string } {
  const analyzed = analyze(raw)
  if (!analyzed.ok) return analyzed

  const parsed = JSON.parse(raw) as Record<string, unknown>
  const sessionKeys = Object.keys(parsed)
    .filter((key) => /^session\d+$/.test(key))
    .sort((a, b) => Number(a.slice(7)) - Number(b.slice(7)))

  const props = isRecord(parsed.properties) ? parsed.properties : {}
  let sessionData: Record<string, unknown> = {}
  if (typeof props.sessionData === 'string') {
    try {
      const parsedSd = JSON.parse(props.sessionData)
      if (isRecord(parsedSd)) sessionData = parsedSd
    } catch {
      // ignore
    }
  } else if (isRecord(props.sessionData)) {
    sessionData = props.sessionData as Record<string, unknown>
  }

  const sessions: Session[] = []
  const usedNames = new Set<string>()

  for (const key of sessionKeys) {
    const sessionNum = Number(key.slice(7))
    const meta = isRecord(sessionData[String(sessionNum)])
      ? (sessionData[String(sessionNum)] as Record<string, unknown>)
      : {}
    const opt = isRecord(meta.opt) ? meta.opt : {}
    const scrType = typeof opt.scrType === 'string' ? opt.scrType : ''
    const event = eventForScrType(scrType)
    if (!event || !getEventDefinition(event)) continue

    const rawName =
      typeof meta.name === 'string' && meta.name.trim()
        ? meta.name.trim().slice(0, 40)
        : `csTimer session ${sessionNum}`

    let name = rawName
    let counter = 2
    while (usedNames.has(name.toLowerCase())) {
      name = `${rawName} ${counter}`
      counter += 1
    }
    usedNames.add(name.toLowerCase())

    const times = Array.isArray(parsed[key]) ? (parsed[key] as unknown[]) : []
    const sessionDates = Array.isArray(meta.date) ? meta.date : []

    const solves: Solve[] = []
    for (const entry of times) {
      if (!Array.isArray(entry) || entry.length < 2) continue
      const head = entry[0]
      let penaltyCode: unknown = 0
      let timeMs = 0
      if (Array.isArray(head)) {
        penaltyCode = head[0]
        timeMs = typeof head[1] === 'number' ? head[1] : 0
      } else if (typeof head === 'number') {
        timeMs = head
      }

      const penalty = mapPenalty(penaltyCode)
      const scramble = typeof entry[1] === 'string' ? entry[1] : ''
      const comment = typeof entry[2] === 'string' ? entry[2].slice(0, 500) : ''
      let createdAt = Date.now()
      if (typeof entry[3] === 'number') createdAt = entry[3] * 1000
      else if (sessionDates.length > 0 && typeof sessionDates[0] === 'number') createdAt = (sessionDates[0] as number) * 1000

      solves.push({
        id: createId(),
        event: event as Solve['event'],
        rawMs: Math.max(0, Math.floor(timeMs)),
        penalty,
        scramble,
        comment,
        createdAt,
      })
    }

    const now = Date.now()
    const createdAtSession =
      sessionDates.length > 0 && typeof sessionDates[0] === 'number'
        ? (sessionDates[0] as number) * 1000
        : now
    sessions.push({
      id: createId(),
      name,
      event: event as Session['event'],
      createdAt: createdAtSession,
      updatedAt: createdAtSession,
      solves: solves.reverse(),
    })
  }

  if (sessions.length === 0) {
    return { ok: false, error: 'No supported csTimer sessions found.' }
  }

  const activeSessionId = sessions[0]!.id
  const sessionsData: SessionsData = { activeSessionId, sessions }
  const backup = createBackup(sessionsData, settings)
  backup.importMode = 'add'
  return { ok: true, backup, preview: analyzed.preview }
}
