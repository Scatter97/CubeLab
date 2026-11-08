import type {
  CustomEventDefinition,
  FieldUpdate,
  PuzzleEvent,
  Session,
  SessionsData,
  Solve,
} from '../types'
import type { SyncConflict } from './syncStorage'
import { createId } from './id'
import {
  CUBELAB_EVENTS,
  getEventLabel,
  isCustomEventId,
  isPuzzleEventValue,
} from './events'

export const MAX_CUSTOM_EVENT_NAME_LENGTH = 40
export const MAX_CUSTOM_EVENT_PLACEHOLDER_LENGTH = 120
export const DEFAULT_CUSTOM_EVENT_NAME = 'Custom event'

/**
 * csTimer's supported official scramble types. Empty and unavailable
 * identifiers are deliberately absent so they do not silently inherit 3×3;
 * the importer resolves a valid omitted `opt.scrType` to csTimer's explicit
 * `333` default before this map is used.
 */
export const CSTIMER_SCR_TYPE_MAP: Readonly<Record<string, PuzzleEvent>> = {
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
  pyrso: 'pyram',
  pyram: 'pyram',
  pyraminx: 'pyram',
  skbso: 'skewb',
  skewb: 'skewb',
  sqrs: 'sq1',
  sq1: 'sq1',
  square1: 'sq1',
  clkwca: 'clock',
  clock: 'clock',
  mgmp: 'minx',
  minx: 'minx',
  megaminx: 'minx',
}

export function normalizeCustomEventName(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

export function getCustomEventNameError(
  value: string,
  definitions: readonly CustomEventDefinition[],
  currentId?: string,
): string | null {
  const name = normalizeCustomEventName(value)
  if (!name) return 'Enter an event name.'
  if (name.length > MAX_CUSTOM_EVENT_NAME_LENGTH) {
    return `Use ${MAX_CUSTOM_EVENT_NAME_LENGTH} characters or fewer.`
  }
  const normalized = name.toLowerCase()
  const builtInNames = new Set(
    CUBELAB_EVENTS.map((event) => event.label.toLowerCase()),
  )
  if (builtInNames.has(normalized)) {
    return 'That name is already used by a built-in event.'
  }
  if (
    definitions.some(
      (definition) =>
        definition.id !== currentId &&
        normalizeCustomEventName(definition.name).toLowerCase() === normalized,
    )
  ) {
    return 'Event name already exists. Please choose a different name.'
  }
  return null
}

export function getCustomEventPlaceholderError(value: string): string | null {
  return value.trim().length > MAX_CUSTOM_EVENT_PLACEHOLDER_LENGTH
    ? `Use ${MAX_CUSTOM_EVENT_PLACEHOLDER_LENGTH} characters or fewer.`
    : null
}

export function createCustomEvent(
  data: SessionsData,
  input: {
    name: string
    placeholder?: string
    id?: string
    now?: number
    source?: CustomEventDefinition['source']
  },
): { data: SessionsData; eventId: string } | null {
  const definitions = data.customEvents ?? []
  const name = normalizeCustomEventName(input.name)
  if (getCustomEventNameError(name, definitions)) return null
  const placeholder = input.placeholder ?? ''
  if (getCustomEventPlaceholderError(placeholder)) return null

  const eventId = input.id ?? `custom:${createId()}`
  if (!isCustomEventId(eventId)) return null
  if (definitions.some((definition) => definition.id === eventId)) return null

  const now = input.now ?? Date.now()
  const definition: CustomEventDefinition = {
    id: eventId,
    name,
    placeholder,
    createdAt: now,
    updatedAt: now,
    ...(input.source ? { source: input.source } : {}),
  }
  return {
    data: { ...data, customEvents: [...definitions, definition] },
    eventId,
  }
}

export function renameCustomEvent(
  data: SessionsData,
  eventId: string,
  name: string,
  now = Date.now(),
  editorId = 'legacy',
): SessionsData | null {
  const definitions = data.customEvents ?? []
  const normalized = normalizeCustomEventName(name)
  if (getCustomEventNameError(normalized, definitions, eventId)) return null
  const existing = definitions.find((definition) => definition.id === eventId)
  if (!existing) return null
  if (existing.name === normalized) return data

  return {
    ...data,
    customEvents: definitions.map((definition) =>
      definition.id === eventId
        ? {
            ...definition,
            name: normalized,
            updatedAt: now,
            fieldUpdates: {
              ...definition.fieldUpdates,
              name: { updatedAt: now, editorId },
            },
          }
        : definition,
    ),
  }
}

export function setCustomEventPlaceholder(
  data: SessionsData,
  eventId: string,
  placeholder: string,
  now = Date.now(),
  editorId = 'legacy',
): SessionsData | null {
  if (getCustomEventPlaceholderError(placeholder)) return null
  const definitions = data.customEvents ?? []
  const existing = definitions.find((definition) => definition.id === eventId)
  if (!existing) return null
  const next = placeholder.trim()
  if (existing.placeholder === next) return data

  return {
    ...data,
    customEvents: definitions.map((definition) =>
      definition.id === eventId
        ? {
            ...definition,
            placeholder: next,
            updatedAt: now,
            fieldUpdates: {
              ...definition.fieldUpdates,
              placeholder: { updatedAt: now, editorId },
            },
          }
        : definition,
    ),
  }
}

export function isCustomEventReferenced(
  sessions: readonly Session[],
  eventId: string,
): boolean {
  return sessions.some(
    (session) =>
      session.event === eventId ||
      session.solves.some((solve) => solve.event === eventId),
  )
}

export function getCustomEventDeleteError(
  data: SessionsData,
  eventId: string,
): string | null {
  const definitions = data.customEvents ?? []
  if (!definitions.some((definition) => definition.id === eventId)) {
    return 'That custom event no longer exists.'
  }
  if (isCustomEventReferenced(data.sessions, eventId)) {
    return 'This custom event still has sessions or solves. Reassign them to another event before deleting it.'
  }
  return null
}

export function deleteCustomEvent(
  data: SessionsData,
  eventId: string,
): { data: SessionsData } | { error: string } {
  const error = getCustomEventDeleteError(data, eventId)
  if (error) return { error }
  return {
    data: {
      ...data,
      customEvents: (data.customEvents ?? []).filter(
        (definition) => definition.id !== eventId,
      ),
    },
  }
}

function isFieldUpdate(value: unknown): value is FieldUpdate {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as FieldUpdate).updatedAt === 'number' &&
    Number.isFinite((value as FieldUpdate).updatedAt) &&
    (value as FieldUpdate).updatedAt >= 0 &&
    typeof (value as FieldUpdate).editorId === 'string' &&
    (value as FieldUpdate).editorId.length > 0
  )
}

export function parseCustomEvents(value: unknown): CustomEventDefinition[] {
  if (!Array.isArray(value)) return []
  const definitions: CustomEventDefinition[] = []
  const seen = new Set<string>()

  for (const candidate of value) {
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
      continue
    }
    const record = candidate as Record<string, unknown>
    if (!isCustomEventId(record.id) || seen.has(record.id)) continue
    if (typeof record.name !== 'string') continue
    const name = normalizeCustomEventName(record.name)
    if (!name || name.length > MAX_CUSTOM_EVENT_NAME_LENGTH) continue
    if (
      typeof record.createdAt !== 'number' ||
      !Number.isFinite(record.createdAt) ||
      record.createdAt <= 0 ||
      typeof record.updatedAt !== 'number' ||
      !Number.isFinite(record.updatedAt) ||
      record.updatedAt <= 0
    ) {
      continue
    }

    let source: CustomEventDefinition['source']
    if (
      typeof record.source === 'object' &&
      record.source !== null &&
      !Array.isArray(record.source) &&
      (record.source as Record<string, unknown>).provider === 'cstimer'
    ) {
      const rawIdentifiers = (record.source as Record<string, unknown>).identifiers
      const identifiers = Array.isArray(rawIdentifiers)
        ? [
            ...new Set(
              rawIdentifiers.filter(
                (identifier): identifier is string =>
                  typeof identifier === 'string' && identifier.length <= 200,
              ),
            ),
          ].slice(0, 20)
        : []
      if (identifiers.length > 0) source = { provider: 'cstimer', identifiers }
    }

    let fieldUpdates: CustomEventDefinition['fieldUpdates']
    if (
      typeof record.fieldUpdates === 'object' &&
      record.fieldUpdates !== null &&
      !Array.isArray(record.fieldUpdates)
    ) {
      const updates = record.fieldUpdates as Record<string, unknown>
      const parsed: NonNullable<CustomEventDefinition['fieldUpdates']> = {}
      if (isFieldUpdate(updates.name)) parsed.name = updates.name
      if (isFieldUpdate(updates.placeholder)) parsed.placeholder = updates.placeholder
      if (Object.keys(parsed).length > 0) fieldUpdates = parsed
    }

    definitions.push({
      id: record.id,
      name,
      placeholder:
        typeof record.placeholder === 'string'
          ? record.placeholder.slice(0, MAX_CUSTOM_EVENT_PLACEHOLDER_LENGTH)
          : '',
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      ...(fieldUpdates ? { fieldUpdates } : {}),
      ...(source ? { source } : {}),
    })
    seen.add(record.id)
  }
  return definitions
}

function eventFieldUpdate(
  definition: CustomEventDefinition,
  field: 'name' | 'placeholder',
): FieldUpdate | undefined {
  return definition.fieldUpdates?.[field]
}

function newestUpdate(left: FieldUpdate, right: FieldUpdate): FieldUpdate {
  if (left.updatedAt !== right.updatedAt) {
    return left.updatedAt > right.updatedAt ? left : right
  }
  return left.editorId <= right.editorId ? left : right
}

function valuesEqual(left: unknown, right: unknown): boolean {
  return Object.is(left, right)
}

function findResolvedEventConflict(
  id: string,
  field: 'name' | 'placeholder',
  localValue: unknown,
  remoteValue: unknown,
  localUpdatedAt: number,
  remoteUpdatedAt: number,
  resolvedConflicts: readonly SyncConflict[],
): SyncConflict | undefined {
  return resolvedConflicts
    .filter(
      (conflict) =>
        conflict.kind === 'event' &&
        conflict.id === id &&
        conflict.field === field &&
        conflict.resolution !== 'manual-pending' &&
        localUpdatedAt <= conflict.updatedAt &&
        remoteUpdatedAt <= conflict.updatedAt &&
        ((valuesEqual(conflict.localValue, localValue) &&
          valuesEqual(conflict.remoteValue, remoteValue)) ||
          (valuesEqual(conflict.localValue, remoteValue) &&
            valuesEqual(conflict.remoteValue, localValue))) &&
        (localUpdatedAt === conflict.updatedAt ||
          remoteUpdatedAt === conflict.updatedAt ||
          localUpdatedAt === conflict.priorUpdatedAt ||
          remoteUpdatedAt === conflict.priorUpdatedAt ||
          (localUpdatedAt === conflict.localUpdatedAt &&
            remoteUpdatedAt === conflict.remoteUpdatedAt) ||
          (localUpdatedAt === conflict.remoteUpdatedAt &&
            remoteUpdatedAt === conflict.localUpdatedAt)),
    )
    .sort((left, right) => right.updatedAt - left.updatedAt)[0]
}

function mergeEventField(input: {
  local: CustomEventDefinition
  remote: CustomEventDefinition
  field: 'name' | 'placeholder'
  manualConflictReview: boolean
  conflicts: SyncConflict[]
  resolvedConflicts: readonly SyncConflict[]
}): { value: string; update?: FieldUpdate; resolvedAt: number } {
  const { local, remote, field, manualConflictReview, conflicts, resolvedConflicts } = input
  const localValue = local[field]
  const remoteValue = remote[field]
  const localExplicit = eventFieldUpdate(local, field)
  const remoteExplicit = eventFieldUpdate(remote, field)

  if (localValue === remoteValue) {
    return {
      value: localValue,
      update:
        localExplicit && remoteExplicit
          ? newestUpdate(localExplicit, remoteExplicit)
          : localExplicit ?? remoteExplicit,
      resolvedAt: 0,
    }
  }

  const localUpdate = localExplicit ?? {
    updatedAt: local.updatedAt,
    editorId: 'legacy',
  }
  const remoteUpdate = remoteExplicit ?? {
    updatedAt: remote.updatedAt,
    editorId: 'legacy',
  }
  const resolved = findResolvedEventConflict(
    local.id,
    field,
    localValue,
    remoteValue,
    localUpdate.updatedAt,
    remoteUpdate.updatedAt,
    resolvedConflicts,
  )

  let winner: 'local' | 'remote'
  if (resolved) {
    const sameOrientation =
      valuesEqual(localValue, resolved.localValue) &&
      valuesEqual(remoteValue, resolved.remoteValue)
    winner =
      (sameOrientation ? resolved.resolution : resolved.resolution === 'local' ? 'remote' : 'local') ===
      'local'
        ? 'local'
        : 'remote'
  } else if (localExplicit && !remoteExplicit) {
    // An explicit rename outranks a legacy definition that has no provenance
    // for this field.
    winner = 'local'
  } else if (remoteExplicit && !localExplicit) {
    winner = 'remote'
  } else if (localUpdate.updatedAt !== remoteUpdate.updatedAt) {
    winner = localUpdate.updatedAt > remoteUpdate.updatedAt ? 'local' : 'remote'
  } else if (localUpdate.editorId !== remoteUpdate.editorId) {
    winner = localUpdate.editorId < remoteUpdate.editorId ? 'local' : 'remote'
  } else {
    winner = localValue <= remoteValue ? 'local' : 'remote'
  }

  if (!resolved) {
    conflicts.push({
      id: local.id,
      kind: 'event',
      field,
      localValue,
      remoteValue,
      localUpdatedAt: localUpdate.updatedAt,
      remoteUpdatedAt: remoteUpdate.updatedAt,
      resolution: manualConflictReview ? 'manual-pending' : winner,
      updatedAt: Math.max(localUpdate.updatedAt, remoteUpdate.updatedAt, Date.now()),
    })
  }

  const winningUpdate = winner === 'local' ? localUpdate : remoteUpdate
  return {
    value: winner === 'local' ? localValue : remoteValue,
    update: resolved
      ? {
          updatedAt: Math.max(
            resolved.updatedAt,
            localUpdate.updatedAt,
            remoteUpdate.updatedAt,
          ),
          editorId: winningUpdate.editorId,
        }
      : winner === 'local'
        ? localExplicit
        : remoteExplicit,
    resolvedAt: resolved?.updatedAt ?? 0,
  }
}

/**
 * Merges custom event definitions by stable ID. Definitions are immutable
 * identities: two devices editing the same event merge field-by-field, while
 * independently created events survive the union. A tombstoned definition is
 * dropped unless a merged session or solve still references it.
 */
export function mergeCustomEvents(input: {
  local: readonly CustomEventDefinition[]
  remote: readonly CustomEventDefinition[]
  deletedIds?: ReadonlySet<string>
  referencedIds?: ReadonlySet<string>
  manualConflictReview: boolean
  conflicts: SyncConflict[]
  resolvedConflicts: readonly SyncConflict[]
}): CustomEventDefinition[] {
  const byId = new Map<string, CustomEventDefinition>()
  for (const definition of [...input.local, ...input.remote]) {
    if (byId.has(definition.id)) continue
    byId.set(definition.id, definition)
  }
  const localById = new Map(input.local.map((definition) => [definition.id, definition]))
  const remoteById = new Map(input.remote.map((definition) => [definition.id, definition]))
  const merged: CustomEventDefinition[] = []

  for (const definition of byId.values()) {
    if (
      input.deletedIds?.has(definition.id) &&
      !input.referencedIds?.has(definition.id)
    ) {
      continue
    }
    const local = localById.get(definition.id)
    const remote = remoteById.get(definition.id)
    if (!local || !remote) {
      merged.push({
        ...definition,
        ...(definition.source
          ? { source: { ...definition.source, identifiers: [...definition.source.identifiers] } }
          : {}),
        ...(definition.fieldUpdates
          ? { fieldUpdates: { ...definition.fieldUpdates } }
          : {}),
      })
      continue
    }

    const name = mergeEventField({
      local,
      remote,
      field: 'name',
      manualConflictReview: input.manualConflictReview,
      conflicts: input.conflicts,
      resolvedConflicts: input.resolvedConflicts,
    })
    const placeholder = mergeEventField({
      local,
      remote,
      field: 'placeholder',
      manualConflictReview: input.manualConflictReview,
      conflicts: input.conflicts,
      resolvedConflicts: input.resolvedConflicts,
    })
    const identifiers = [
      ...new Set([
        ...(local.source?.identifiers ?? []),
        ...(remote.source?.identifiers ?? []),
      ]),
    ].slice(0, 20)
    const fieldUpdates: NonNullable<CustomEventDefinition['fieldUpdates']> = {}
    if (name.update) fieldUpdates.name = name.update
    if (placeholder.update) fieldUpdates.placeholder = placeholder.update

    merged.push({
      id: local.id,
      name: name.value,
      placeholder: placeholder.value,
      createdAt: Math.min(local.createdAt, remote.createdAt),
      updatedAt: Math.max(
        local.updatedAt,
        remote.updatedAt,
        name.resolvedAt,
        placeholder.resolvedAt,
      ),
      ...(Object.keys(fieldUpdates).length > 0 ? { fieldUpdates } : {}),
      ...(identifiers.length > 0
        ? { source: { provider: 'cstimer' as const, identifiers } }
        : {}),
    })
  }

  return merged.sort((left, right) => left.id.localeCompare(right.id))
}

/** Union used by additive imports: local definitions keep their current name. */
export function unionCustomEvents(
  local: readonly CustomEventDefinition[],
  incoming: readonly CustomEventDefinition[],
): CustomEventDefinition[] {
  const result = [...local]
  for (const definition of incoming) {
    const existingIndex = result.findIndex((item) => item.id === definition.id)
    const existing = result[existingIndex]
    if (!existing) {
      result.push(definition)
      continue
    }
    if (definition.source) {
      const identifiers = [
        ...new Set([
          ...(existing.source?.identifiers ?? []),
          ...definition.source.identifiers,
        ]),
      ].slice(0, 20)
      result[existingIndex] = {
        ...existing,
        source: { provider: 'cstimer', identifiers },
      }
    }
  }
  return result
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** Deterministic across devices for the same original csTimer identifier. */
export function csTimerCustomEventId(scrType: string): string {
  const trimmed = scrType.trim()
  if (!trimmed) return 'custom:cstimer:unspecified'
  const slug =
    trimmed
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'type'
  return `custom:cstimer:${slug}-${fnv1a(trimmed.toLowerCase())}`
}

export function builtInEventForCsTimerType(scrType: string): PuzzleEvent | null {
  const key = scrType.trim().toLowerCase()
  if (!key) return null
  return CSTIMER_SCR_TYPE_MAP[key] ?? null
}

export function defaultCsTimerCustomEventName(scrType: string): string {
  const trimmed = scrType.trim()
  const base = trimmed ? `csTimer: ${trimmed}` : 'csTimer: unspecified type'
  return normalizeCustomEventName(base).slice(0, MAX_CUSTOM_EVENT_NAME_LENGTH)
}

function uniqueEventName(
  preferred: string,
  definitions: readonly CustomEventDefinition[],
): string {
  const base = normalizeCustomEventName(preferred).slice(0, MAX_CUSTOM_EVENT_NAME_LENGTH)
  const used = new Set(
    [
      ...CUBELAB_EVENTS.map((event) => event.label.toLowerCase()),
      ...definitions.map((definition) => definition.name.toLowerCase()),
    ],
  )
  if (!used.has(base.toLowerCase())) return base
  let counter = 2
  while (counter < 1000) {
    const suffix = ` (${counter})`
    const candidate = `${base.slice(0, MAX_CUSTOM_EVENT_NAME_LENGTH - suffix.length).trim()}${suffix}`
    if (!used.has(candidate.toLowerCase())) return candidate
    counter += 1
  }
  return `${base.slice(0, MAX_CUSTOM_EVENT_NAME_LENGTH - 12).trim()} (${fnv1a(base)})`
}

export interface CsTimerEventResolution {
  eventId: PuzzleEvent
  customEvent?: CustomEventDefinition
  created: boolean
}

/** Resolve one csTimer type without ever falling back to 3×3. */
export function resolveCsTimerEvent(input: {
  scrType: string
  definitions: readonly CustomEventDefinition[]
  name?: string
  now?: number
}): {
  resolution: CsTimerEventResolution
  definitions: CustomEventDefinition[]
} {
  const { scrType, definitions } = input
  const builtIn = builtInEventForCsTimerType(scrType)
  if (builtIn) {
    return { resolution: { eventId: builtIn, created: false }, definitions: [...definitions] }
  }

  const identifier = scrType.trim()
  const eventId = csTimerCustomEventId(scrType)
  const existing = definitions.find((definition) => definition.id === eventId)
  if (existing) {
    return { resolution: { eventId, customEvent: existing, created: false }, definitions: [...definitions] }
  }

  const preferred =
    input.name !== undefined
      ? normalizeCustomEventName(input.name)
      : defaultCsTimerCustomEventName(scrType)
  const name = uniqueEventName(
    preferred || defaultCsTimerCustomEventName(scrType),
    definitions,
  )
  const now = input.now ?? Date.now()
  const definition: CustomEventDefinition = {
    id: eventId,
    name,
    placeholder: '',
    createdAt: now,
    updatedAt: now,
    source: { provider: 'cstimer', identifiers: [identifier] },
  }
  return {
    resolution: { eventId, customEvent: definition, created: true },
    definitions: [...definitions, definition],
  }
}

function eventExists(data: SessionsData, eventId: PuzzleEvent): boolean {
  return (
    isPuzzleEventValue(eventId) ||
    isCustomEventId(eventId) &&
      (data.customEvents ?? []).some((definition) => definition.id === eventId)
  )
}

/**
 * Explicit bulk session reassignment. The whole session moves together so a
 * session never mixes puzzle statistics; solve IDs, times, penalties,
 * scrambles, comments and timestamps are preserved.
 */
export function reassignSessionsEvent(
  data: SessionsData,
  sessionIds: readonly string[],
  targetEvent: PuzzleEvent,
  now = Date.now(),
  editorId = 'legacy',
): SessionsData | null {
  if (!eventExists(data, targetEvent)) return null
  const selected = new Set(sessionIds)
  let changed = false

  const sessions = data.sessions.map((session) => {
    if (!selected.has(session.id) || session.event === targetEvent) return session
    changed = true
    return {
      ...session,
      event: targetEvent,
      updatedAt: now,
      fieldUpdates: {
        ...session.fieldUpdates,
        event: { updatedAt: now, editorId },
      },
      solves: session.solves.map((solve) =>
        solve.event === targetEvent
          ? solve
          : {
              ...solve,
              event: targetEvent,
              updatedAt: now,
              fieldUpdates: {
                ...solve.fieldUpdates,
                event: { updatedAt: now, editorId },
              },
            },
      ),
    }
  })

  return changed ? { ...data, sessions } : data
}

export interface ImportedEventCorrection {
  solveId: string
  sessionId: string
  scrType: string
  targetEvent: PuzzleEvent
}

/**
 * Finds solves carrying original csTimer provenance that no longer matches the
 * current mapping. This is the only automatic correction path; solve duration
 * is never used to infer a puzzle type.
 */
export function findImportedEventCorrections(
  data: SessionsData,
): ImportedEventCorrection[] {
  const corrections: ImportedEventCorrection[] = []
  for (const session of data.sessions) {
    for (const solve of session.solves) {
      if (solve.importSource?.provider !== 'cstimer') continue
      const target = builtInEventForCsTimerType(solve.importSource.scrType) ??
        csTimerCustomEventId(solve.importSource.scrType)
      // Automatic repair is deliberately limited to the historical 3×3
      // fallback. A solve already on a non-3×3 event may be an intentional
      // manual reassignment, so it is never moved automatically.
      if (solve.event !== '333' || target === '333') continue
      corrections.push({
        solveId: solve.id,
        sessionId: session.id,
        scrType: solve.importSource.scrType,
        targetEvent: target,
      })
    }
  }
  return corrections
}

/**
 * Applies the safe automatic correction above. Corrected solves move into a
 * deterministic per-source/target session so two devices converge on the same
 * session ID instead of duplicating sessions.
 */
export function correctImportedSolveEvents(
  data: SessionsData,
  now = Date.now(),
  editorId = 'legacy',
): { data: SessionsData; movedCount: number } {
  const corrections = findImportedEventCorrections(data)
  if (corrections.length === 0) return { data, movedCount: 0 }

  let definitions = [...(data.customEvents ?? [])]
  const resolutionById = new Map<string, CsTimerEventResolution>()
  for (const correction of corrections) {
    if (resolutionById.has(correction.targetEvent)) continue
    const resolved = resolveCsTimerEvent({
      scrType: correction.scrType,
      definitions,
      now,
    })
    definitions = resolved.definitions
    resolutionById.set(correction.targetEvent, resolved.resolution)
  }
  const definitionById = new Map(
    definitions.map((definition) => [definition.id, definition]),
  )

  const correctionBySolve = new Map(
    corrections.map((correction) => [correction.solveId, correction]),
  )
  const grouped = new Map<
    string,
    { source: Session; targetEvent: PuzzleEvent; solves: Solve[] }
  >()

  const sessions = data.sessions.map((session) => {
    const moved: Solve[] = []
    const remaining: Solve[] = []
    for (const solve of session.solves) {
      const correction = correctionBySolve.get(solve.id)
      if (!correction) {
        remaining.push(solve)
        continue
      }
      moved.push({
        ...solve,
        event: correction.targetEvent,
        updatedAt: now,
        fieldUpdates: {
          ...solve.fieldUpdates,
          event: { updatedAt: now, editorId },
        },
      })
    }
    if (moved.length === 0) return session

    const byTarget = new Map<PuzzleEvent, Solve[]>()
    for (const solve of moved) {
      const target = correctionBySolve.get(solve.id)!.targetEvent
      byTarget.set(target, [...(byTarget.get(target) ?? []), solve])
    }
    for (const [targetEvent, targetSolves] of byTarget) {
      const key = `${session.id}\u0000${targetEvent}`
      grouped.set(key, { source: session, targetEvent, solves: targetSolves })
    }
    return { ...session, solves: remaining, updatedAt: now }
  })

  const byId = new Map(sessions.map((session) => [session.id, session]))
  for (const { source, targetEvent, solves } of grouped.values()) {
    const targetId = `reclass:${source.id}:${targetEvent}`
    let target = byId.get(targetId)
    if (!target) {
      const targetLabel =
        definitionById.get(targetEvent)?.name ?? getEventLabel(targetEvent)
      const suffix = ` (${targetLabel})`
      const base = normalizeCustomEventName(source.name) || 'Session'
      target = {
        id: targetId,
        name: `${base.slice(0, Math.max(1, 40 - suffix.length)).trim()}${suffix}`,
        event: targetEvent,
        createdAt: now,
        updatedAt: now,
        solves: [],
      }
      byId.set(targetId, target)
      sessions.push(target)
    }
    target.solves = [...target.solves, ...solves].sort(
      (left, right) =>
        right.createdAt - left.createdAt || left.id.localeCompare(right.id),
    )
    target.updatedAt = now
  }

  return { data: { ...data, customEvents: definitions, sessions }, movedCount: corrections.length }
}
