import type {
  PuzzleEvent,
  Session,
  SessionsData,
} from '../types'
import { createId } from './id'
import { getEventLabel } from './events'
import {
  isUntouchedDefaultSession,
  normalizeSessionName,
  resolveUniqueSessionNames,
} from './sessions'
import { DRIVE_STORAGE_KEY } from './driveStorage'
import {
  SETTINGS_STORAGE_KEY,
  type StorageLike,
} from './storage'
import { SYNC_STORAGE_KEY } from './syncStorage'
import { isSiteResetInProgress } from './siteReset'

export const ONBOARDING_STORAGE_KEY = 'cubelab:onboarding:v1'
export const ONBOARDING_VERSION = 1

export type OnboardingDecisionStatus = 'completed' | 'skipped'
export type OnboardingPath = 'fresh' | 'cstimer' | 'returning'
export type OnboardingStage =
  | 'welcome'
  | 'events'
  | 'import'
  | 'settings'
  | 'appearance'
  | 'sync'
  | 'signin'
  | 'restore'
  | 'device'
  | 'complete'

export interface OnboardingDecision {
  status: OnboardingDecisionStatus
  at: number
}

export interface OnboardingImportPreviewSession {
  sessionNumber: number
  name: string
  event: PuzzleEvent
  solveCount: number
}

/**
 * Durable progress for an additive csTimer import. The checkpoint records the
 * final preview names before the commit so a reload can distinguish "nothing
 * was imported" from "the atomic durable replacement already committed the
 * whole batch". No raw file contents or credentials are stored.
 */
export interface OnboardingImportCheckpoint {
  status: 'committing' | 'committed'
  fileName: string
  beforeSessionIds: string[]
  preview: OnboardingImportPreviewSession[]
  importedSessionCount: number
  importedSolveCount: number
  sessionIds?: string[]
}

/**
 * Non-sensitive onboarding progress. OAuth tokens are deliberately never
 * persisted; a reload asks the existing Google integration to reconnect.
 */
export interface OnboardingDraft {
  path: OnboardingPath
  stage: OnboardingStage
  runId: string
  updatedAt: number
  selectedEvents?: string[]
  mainEvent?: string
  createdSessionIdsByEvent?: Record<string, string>
  localCommitted?: boolean
  importCheckpoint?: OnboardingImportCheckpoint
}

export interface OnboardingStore {
  version: typeof ONBOARDING_VERSION
  decision?: OnboardingDecision
  draft?: OnboardingDraft
}

export type OnboardingMode = 'first-run' | 'reopen'

export interface OnboardingBootstrap {
  show: boolean
  mode: OnboardingMode
  draft?: OnboardingDraft
}

export interface FreshSessionSetup {
  data: SessionsData
  sessionIdsByEvent: Record<string, string>
  /** Sessions newly created or repurposed from the untouched placeholder. */
  configuredSessionIds: string[]
  createdSessionIds: string[]
  reusedSessionIds: string[]
}

export interface ImportReconciliation {
  committed: boolean
  sessionIds: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getDefaultStorage(): StorageLike | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    return window.localStorage
  } catch {
    return null
  }
}

function isPath(value: unknown): value is OnboardingPath {
  return value === 'fresh' || value === 'cstimer' || value === 'returning'
}

function isStage(value: unknown): value is OnboardingStage {
  return (
    value === 'welcome' ||
    value === 'events' ||
    value === 'import' ||
    value === 'settings' ||
    value === 'appearance' ||
    value === 'sync' ||
    value === 'signin' ||
    value === 'restore' ||
    value === 'device' ||
    value === 'complete'
  )
}

function parseDecision(value: unknown): OnboardingDecision | undefined {
  if (!isRecord(value)) return undefined
  if (value.status !== 'completed' && value.status !== 'skipped') return undefined
  if (typeof value.at !== 'number' || !Number.isFinite(value.at) || value.at < 0) {
    return undefined
  }
  return { status: value.status, at: value.at }
}

function parsePreviewSession(value: unknown): OnboardingImportPreviewSession | null {
  if (!isRecord(value)) return null
  if (
    typeof value.sessionNumber !== 'number' ||
    !Number.isFinite(value.sessionNumber) ||
    value.sessionNumber < 0
  ) {
    return null
  }
  if (typeof value.name !== 'string' || !value.name.trim()) return null
  if (typeof value.event !== 'string' || !value.event) return null
  if (
    typeof value.solveCount !== 'number' ||
    !Number.isFinite(value.solveCount) ||
    value.solveCount < 0
  ) {
    return null
  }
  return {
    sessionNumber: value.sessionNumber,
    name: value.name,
    event: value.event,
    solveCount: value.solveCount,
  }
}

function parseImportCheckpoint(value: unknown): OnboardingImportCheckpoint | undefined {
  if (!isRecord(value)) return undefined
  if (value.status !== 'committing' && value.status !== 'committed') return undefined
  if (typeof value.fileName !== 'string') return undefined
  if (
    !Array.isArray(value.beforeSessionIds) ||
    !value.beforeSessionIds.every((id) => typeof id === 'string' && id.length > 0)
  ) {
    return undefined
  }
  if (!Array.isArray(value.preview)) return undefined
  const preview: OnboardingImportPreviewSession[] = []
  for (const candidate of value.preview) {
    const session = parsePreviewSession(candidate)
    if (!session) return undefined
    preview.push(session)
  }
  if (preview.length === 0) return undefined
  if (
    typeof value.importedSessionCount !== 'number' ||
    !Number.isFinite(value.importedSessionCount) ||
    value.importedSessionCount < 0 ||
    typeof value.importedSolveCount !== 'number' ||
    !Number.isFinite(value.importedSolveCount) ||
    value.importedSolveCount < 0
  ) {
    return undefined
  }
  const sessionIds = Array.isArray(value.sessionIds)
    ? value.sessionIds.filter(
        (id): id is string => typeof id === 'string' && id.length > 0,
      )
    : undefined
  return {
    status: value.status,
    fileName: value.fileName,
    beforeSessionIds: [...new Set(value.beforeSessionIds)],
    preview,
    importedSessionCount: value.importedSessionCount,
    importedSolveCount: value.importedSolveCount,
    ...(sessionIds && sessionIds.length > 0 ? { sessionIds } : {}),
  }
}

function parseDraft(value: unknown): OnboardingDraft | undefined {
  if (!isRecord(value)) return undefined
  if (!isPath(value.path) || !isStage(value.stage)) return undefined
  if (typeof value.runId !== 'string' || value.runId.length === 0) return undefined
  if (
    typeof value.updatedAt !== 'number' ||
    !Number.isFinite(value.updatedAt) ||
    value.updatedAt < 0
  ) {
    return undefined
  }
  const selectedEvents = Array.isArray(value.selectedEvents)
    ? value.selectedEvents.filter(
        (event): event is string => typeof event === 'string' && event.length > 0,
      )
    : undefined
  const createdSessionIdsByEvent = isRecord(value.createdSessionIdsByEvent)
    ? Object.fromEntries(
        Object.entries(value.createdSessionIdsByEvent).filter(
          (entry): entry is [string, string] =>
            typeof entry[1] === 'string' && entry[1].length > 0,
        ),
      )
    : undefined
  const importCheckpoint = parseImportCheckpoint(value.importCheckpoint)
  return {
    path: value.path,
    stage: value.stage,
    runId: value.runId,
    updatedAt: value.updatedAt,
    ...(selectedEvents && selectedEvents.length > 0 ? { selectedEvents } : {}),
    ...(typeof value.mainEvent === 'string' && value.mainEvent
      ? { mainEvent: value.mainEvent }
      : {}),
    ...(createdSessionIdsByEvent && Object.keys(createdSessionIdsByEvent).length > 0
      ? { createdSessionIdsByEvent }
      : {}),
    ...(value.localCommitted === true ? { localCommitted: true } : {}),
    ...(importCheckpoint ? { importCheckpoint } : {}),
  }
}

export function parseOnboardingStore(value: unknown): OnboardingStore | null {
  if (!isRecord(value)) return null
  if (value.version !== ONBOARDING_VERSION) return null
  const decision = parseDecision(value.decision)
  const draft = parseDraft(value.draft)
  return {
    version: ONBOARDING_VERSION,
    ...(decision ? { decision } : {}),
    ...(draft ? { draft } : {}),
  }
}

export function loadOnboardingStore(
  storage: StorageLike | null = getDefaultStorage(),
): OnboardingStore {
  if (!storage) return { version: ONBOARDING_VERSION }
  try {
    const raw = storage.getItem(ONBOARDING_STORAGE_KEY)
    if (!raw) return { version: ONBOARDING_VERSION }
    return parseOnboardingStore(JSON.parse(raw)) ?? { version: ONBOARDING_VERSION }
  } catch {
    return { version: ONBOARDING_VERSION }
  }
}

export function saveOnboardingStore(
  store: OnboardingStore,
  storage: StorageLike | null = getDefaultStorage(),
): boolean {
  if (!storage || isSiteResetInProgress()) return false
  try {
    storage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(store))
    return true
  } catch {
    return false
  }
}

export function createOnboardingDraft(
  path: OnboardingPath,
  stage: OnboardingStage,
  now = Date.now(),
): OnboardingDraft {
  return {
    path,
    stage,
    runId: createId(),
    updatedAt: now,
  }
}

/**
 * Persists the initial welcome draft before the editable application mounts.
 * This keeps first-run onboarding visible after a reload even though mounting
 * the application writes its default settings and sync identity.
 */
export function startOnboardingWelcomeDraft(
  storage: StorageLike | null = getDefaultStorage(),
): OnboardingDraft | null {
  const current = loadOnboardingStore(storage)
  if (current.decision) return null
  if (current.draft) return current.draft
  const draft = createOnboardingDraft('fresh', 'welcome')
  if (!saveOnboardingDraft(draft, storage)) return null
  return draft
}

export function saveOnboardingDraft(
  draft: OnboardingDraft,
  storage: StorageLike | null = getDefaultStorage(),
): boolean {
  const current = loadOnboardingStore(storage)
  return saveOnboardingStore(
    {
      version: ONBOARDING_VERSION,
      ...(current.decision ? { decision: current.decision } : {}),
      draft,
    },
    storage,
  )
}

export function markOnboardingDecision(
  status: OnboardingDecisionStatus,
  now = Date.now(),
  storage: StorageLike | null = getDefaultStorage(),
): boolean {
  return saveOnboardingStore(
    {
      version: ONBOARDING_VERSION,
      decision: { status, at: now },
    },
    storage,
  )
}

export function clearOnboardingDraft(
  storage: StorageLike | null = getDefaultStorage(),
): boolean {
  const current = loadOnboardingStore(storage)
  return saveOnboardingStore(
    {
      version: ONBOARDING_VERSION,
      ...(current.decision ? { decision: current.decision } : {}),
    },
    storage,
  )
}

/**
 * True when local storage contains a session, solve, custom event, ordering or
 * transfer record that onboarding must not replace. The untouched auto-created
 * placeholder does not count.
 */
export function hasMeaningfulLocalData(data: SessionsData): boolean {
  if (data.sessions.length > 1) return true
  if ((data.customEvents?.length ?? 0) > 0) return true
  if (data.sessionOrder) return true
  if ((data.sessionTransfers?.length ?? 0) > 0) return true
  return data.sessions.some(
    (session) => session.solves.length > 0 || !isUntouchedDefaultSession(session),
  )
}

function hasStoredKey(
  storage: StorageLike | null,
  key: string,
): boolean {
  if (!storage) return false
  try {
    return storage.getItem(key) !== null
  } catch {
    return true
  }
}

/**
 * Decides whether first-run onboarding belongs in front of the application.
 * This runs before editable hooks mount, so the settings/sync keys still tell
 * us whether this browser has been used before. A saved draft always resumes,
 * even though the application may already have written its default settings.
 */
export function loadOnboardingBootstrap(
  data: SessionsData,
  storage: StorageLike | null = getDefaultStorage(),
): OnboardingBootstrap {
  if (!storage) return { show: false, mode: 'first-run' }
  const state = loadOnboardingStore(storage)
  if (state.decision) return { show: false, mode: 'reopen' }
  if (state.draft) {
    return { show: true, mode: 'first-run', draft: state.draft }
  }
  if (hasMeaningfulLocalData(data)) return { show: false, mode: 'first-run' }
  if (
    hasStoredKey(storage, SETTINGS_STORAGE_KEY) ||
    hasStoredKey(storage, SYNC_STORAGE_KEY) ||
    hasStoredKey(storage, DRIVE_STORAGE_KEY)
  ) {
    // Settings, sync identity or Drive metadata means this browser has run
    // CubeLab before. An untouched placeholder alone deliberately does not.
    return { show: false, mode: 'first-run' }
  }
  return { show: true, mode: 'first-run' }
}

function uniqueSessionId(
  desired: string,
  usedIds: Set<string>,
): string {
  let candidate = desired
  let counter = 2
  while (usedIds.has(candidate)) {
    candidate = `${desired}-${counter}`
    counter += 1
  }
  usedIds.add(candidate)
  return candidate
}

/**
 * Builds the committed session collection for the Start Fresh path. Exactly one
 * usable empty session exists for each selected event. An untouched default
 * placeholder is reused for 3×3 when possible; otherwise it is removed without
 * touching meaningful sessions. Existing empty sessions for selected events are
 * reused so retries and a reopened setup do not create duplicates.
 */
export function buildFreshSessionSetup(input: {
  data: SessionsData
  events: readonly string[]
  mainEvent?: string
  runId: string
  now?: number
  editorId?: string
  createdSessionIdsByEvent?: Readonly<Record<string, string>>
}): FreshSessionSetup | null {
  const events = [...new Set(input.events.filter((event) => event.length > 0))]
  if (events.length === 0) return null
  const now = input.now ?? Date.now()
  const editorId = input.editorId ?? 'onboarding'

  const placeholder = input.data.sessions.find(isUntouchedDefaultSession) ?? null
  const reusedIds = new Set<string>()
  const usedIds = new Set(input.data.sessions.map((session) => session.id))
  const usedNames = new Set(
    input.data.sessions
      .filter((session) => session.id !== placeholder?.id)
      .map((session) => normalizeSessionName(session.name).toLowerCase()),
  )

  const sessionIdsByEvent: Record<string, string> = {}
  const createdSessionIds: string[] = []
  const reusedSessionIds: string[] = []
  const configuredSessionIds: string[] = []
  const transformed = new Map<string, Session>()
  const created: Session[] = []

  const chooseReusable = (event: string): Session | undefined => {
    if (
      placeholder &&
      !reusedIds.has(placeholder.id) &&
      (placeholder.event ?? '333') === event
    ) {
      return placeholder
    }
    return input.data.sessions.find(
      (session) =>
        session.id !== placeholder?.id &&
        !reusedIds.has(session.id) &&
        session.solves.length === 0 &&
        (session.event ?? '333') === event,
    )
  }

  for (const [index, event] of events.entries()) {
    const reusable = chooseReusable(event)
    if (reusable) {
      reusedIds.add(reusable.id)
      sessionIdsByEvent[event] = reusable.id
      reusedSessionIds.push(reusable.id)
      configuredSessionIds.push(reusable.id)
      const repurposedPlaceholder = reusable.id === placeholder?.id
      if (repurposedPlaceholder) {
        const name = resolveUniqueSessionNames(
          [getEventLabel(event)],
          [...usedNames],
        )[0]!
        usedNames.add(normalizeSessionName(name).toLowerCase())
        const rest: Session = { ...reusable }
        delete rest.isAutoCreatedDefault
        transformed.set(reusable.id, {
          ...rest,
          name,
          event,
          updatedAt: now,
          fieldUpdates: {
            ...reusable.fieldUpdates,
            name: { updatedAt: now, editorId },
            event: { updatedAt: now, editorId },
          },
        })
      } else {
        usedNames.add(normalizeSessionName(reusable.name).toLowerCase())
      }
      continue
    }

    const desiredId =
      input.createdSessionIdsByEvent?.[event] ??
      `onboarding-${input.runId}-${index + 1}`
    const id = uniqueSessionId(desiredId, usedIds)
    const name = resolveUniqueSessionNames(
      [getEventLabel(event)],
      [...usedNames],
    )[0]!
    usedNames.add(normalizeSessionName(name).toLowerCase())
    const session: Session = {
      id,
      name,
      event,
      createdAt: now,
      updatedAt: now,
      solves: [],
    }
    created.push(session)
    sessionIdsByEvent[event] = id
    createdSessionIds.push(id)
    configuredSessionIds.push(id)
  }

  const finalSessions = [
    ...input.data.sessions
      .filter(
        (session) =>
          session.id !== placeholder?.id || reusedIds.has(session.id),
      )
      .map((session) => transformed.get(session.id) ?? session),
    ...created,
  ]

  const mainEvent =
    input.mainEvent && sessionIdsByEvent[input.mainEvent]
      ? input.mainEvent
      : events[0]!
  const activeSessionId = sessionIdsByEvent[mainEvent] ?? finalSessions[0]?.id
  if (!activeSessionId) return null

  let sessionOrder = input.data.sessionOrder
  if (sessionOrder) {
    const present = new Set(finalSessions.map((session) => session.id))
    const ids = sessionOrder.ids.filter((id) => present.has(id))
    for (const session of finalSessions) {
      if (!ids.includes(session.id)) ids.push(session.id)
    }
    sessionOrder = { ids, updatedAt: now, editorId }
  }

  return {
    data: {
      ...input.data,
      activeSessionId,
      sessions: finalSessions,
      ...(sessionOrder ? { sessionOrder } : {}),
    },
    sessionIdsByEvent,
    configuredSessionIds,
    createdSessionIds,
    reusedSessionIds,
  }
}

/**
 * Reconciles a checkpoint written immediately before a durable additive import.
 * A complete match of the preview signatures proves the atomic replacement
 * committed; otherwise nothing from that attempt is considered imported.
 */
export function reconcileImportCheckpoint(
  checkpoint: OnboardingImportCheckpoint,
  sessions: readonly Session[],
): ImportReconciliation {
  if (checkpoint.sessionIds && checkpoint.sessionIds.length > 0) {
    const present = new Set(sessions.map((session) => session.id))
    if (checkpoint.sessionIds.every((id) => present.has(id))) {
      return { committed: true, sessionIds: checkpoint.sessionIds }
    }
  }

  const before = new Set(checkpoint.beforeSessionIds)
  const candidates = sessions.filter((session) => !before.has(session.id))
  const used = new Set<string>()
  const matched: string[] = []
  for (const expected of checkpoint.preview) {
    const expectedName = normalizeSessionName(expected.name).toLowerCase()
    const match = candidates.find(
      (session) =>
        !used.has(session.id) &&
        normalizeSessionName(session.name).toLowerCase() === expectedName &&
        (session.event ?? '333') === expected.event &&
        session.solves.length === expected.solveCount,
    )
    if (!match) return { committed: false, sessionIds: [] }
    used.add(match.id)
    matched.push(match.id)
  }
  return { committed: true, sessionIds: matched }
}

/** Events represented by an imported preview, in source order. */
export function importedPreviewEvents(
  checkpoint: OnboardingImportCheckpoint,
): string[] {
  const seen = new Set<string>()
  const events: string[] = []
  for (const session of checkpoint.preview) {
    if (seen.has(session.event)) continue
    seen.add(session.event)
    events.push(session.event)
  }
  return events
}

/**
 * Chooses the imported session that represents the Main Event without creating
 * another session. The currently active imported session wins; otherwise the
 * first imported session for that event in the established order is used.
 */
export function chooseImportedMainSession(input: {
  sessions: readonly Session[]
  importedSessionIds: readonly string[]
  activeSessionId: string
  mainEvent: string
}): Session | null {
  const imported = new Set(input.importedSessionIds)
  const candidates = input.sessions.filter(
    (session) =>
      imported.has(session.id) && (session.event ?? '333') === input.mainEvent,
  )
  if (candidates.length === 0) return null
  return (
    candidates.find((session) => session.id === input.activeSessionId) ??
    candidates[0]!
  )
}

export function countOnboardingSessionSolves(
  sessions: readonly Session[],
): number {
  return sessions.reduce((total, session) => total + session.solves.length, 0)
}

/**
 * Device-specific onboarding options are deliberately limited to preferences
 * that are not part of `Settings` and therefore are not restored from Drive.
 * Timer input, inspection, appearance and every other `Settings` field are
 * synchronized and must not be requested again after a restore.
 */
export interface DeviceSpecificOnboardingSetting {
  id: 'drawScrambleMode'
  label: string
  description: string
}

export const DEVICE_SPECIFIC_ONBOARDING_SETTINGS: readonly DeviceSpecificOnboardingSetting[] =
  [
    {
      id: 'drawScrambleMode',
      label: 'Scramble view',
      description: 'Stored only in this browser.',
    },
  ]
