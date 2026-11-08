import type { CustomEventDefinition, Session, SessionsData, Solve } from '../types'
import { createId } from './id'
import { unionCustomEvents } from './customEvents'
import { reconcileExternalSessions } from './sessions'
import {
  SYNC_STORAGE_KEY,
  isActiveTombstone,
  loadSyncStorage,
  type Tombstone,
} from './syncStorage'
import {
  loadSessionsForStartup,
  parseSolve,
  saveSessions,
  type StorageLike,
} from './storage'

export const PENDING_COMPLETION_STORAGE_KEY =
  'cubelab:replacement-completion:v1'
export const PENDING_COMPLETION_ENTRY_PREFIX =
  `${PENDING_COMPLETION_STORAGE_KEY}:entry:`
export const PENDING_COMPLETION_VERSION = 1

export interface PendingCompletionEntry {
  /** Source session metadata; its solves are stored separately. */
  session: Session
  solves: Solve[]
}

export interface PendingCompletion {
  version: typeof PENDING_COMPLETION_VERSION
  operationId: string
  createdAt: number
  entries: PendingCompletionEntry[]
  customEvents?: CustomEventDefinition[]
}

export type PendingCompletionLoad =
  | { status: 'none' }
  | { status: 'ok'; completion: PendingCompletion }
  | { status: 'invalid'; message: string }

export type ApplyPendingCompletionResult =
  | { ok: true }
  | { ok: false; message: string }

export interface AcknowledgePendingCompletionOptions {
  storage?: StorageLike | null
  data: SessionsData
  tombstones?: readonly Tombstone[]
}

interface EnumerableStorage extends StorageLike {
  readonly length: number
  key(index: number): string | null
}

function getDefaultStorage(): StorageLike | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    return window.localStorage
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isEnumerableStorage(
  storage: StorageLike | null,
): storage is EnumerableStorage {
  if (!storage) return false
  const candidate = storage as Partial<EnumerableStorage>
  return (
    typeof candidate.key === 'function' &&
    typeof candidate.length === 'number'
  )
}

function entryStorageKey(solveId: string): string {
  return `${PENDING_COMPLETION_ENTRY_PREFIX}${encodeURIComponent(solveId)}`
}

function listEntryStorageKeys(storage: EnumerableStorage): string[] {
  const keys: string[] = []
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (key?.startsWith(PENDING_COMPLETION_ENTRY_PREFIX)) keys.push(key)
  }
  return keys
}

function parseEntry(value: unknown): PendingCompletionEntry | null {
  if (!isRecord(value) || !isRecord(value.session)) return null
  if (!Array.isArray(value.solves)) return null
  const session = value.session as unknown as Session
  if (
    typeof session.id !== 'string' ||
    session.id.length === 0 ||
    typeof session.name !== 'string' ||
    !Array.isArray(session.solves)
  ) {
    return null
  }
  const solves: Solve[] = []
  for (const candidate of value.solves) {
    const solve = parseSolve(candidate)
    if (!solve) return null
    solves.push(solve)
  }
  return {
    session: { ...session, solves: [] },
    solves,
  }
}

function parseCompletion(value: unknown): PendingCompletion | null {
  if (!isRecord(value)) return null
  if (
    value.version !== PENDING_COMPLETION_VERSION ||
    typeof value.operationId !== 'string' ||
    value.operationId.length === 0 ||
    typeof value.createdAt !== 'number' ||
    !Number.isFinite(value.createdAt) ||
    value.createdAt < 0 ||
    !Array.isArray(value.entries)
  ) {
    return null
  }
  const entries: PendingCompletionEntry[] = []
  for (const candidate of value.entries) {
    const entry = parseEntry(candidate)
    if (!entry) return null
    entries.push(entry)
  }
  if (entries.length === 0) return null
  const customEvents = Array.isArray(value.customEvents)
    ? (value.customEvents as CustomEventDefinition[])
    : undefined
  return {
    version: PENDING_COMPLETION_VERSION,
    operationId: value.operationId,
    createdAt: value.createdAt,
    entries,
    ...(customEvents ? { customEvents } : {}),
  }
}

function mergeCompletionEntries(
  entries: Map<string, { session: Session; solves: Map<string, Solve> }>,
  completion: PendingCompletion,
) {
  for (const entry of completion.entries) {
    const current = entries.get(entry.session.id) ?? {
      session: { ...entry.session, solves: [] },
      solves: new Map<string, Solve>(),
    }
    current.session = { ...entry.session, solves: [] }
    for (const solve of entry.solves) {
      current.solves.set(solve.id, solve)
    }
    entries.set(entry.session.id, current)
  }
}

function sortedCompletionEntries(
  entries: Map<string, { session: Session; solves: Map<string, Solve> }>,
): PendingCompletionEntry[] {
  return [...entries.values()].map((entry) => ({
    session: { ...entry.session, solves: [] },
    solves: [...entry.solves.values()].sort(
      (left, right) =>
        right.createdAt - left.createdAt || left.id.localeCompare(right.id),
    ),
  }))
}

function mergeCustomEventLists(
  records: readonly PendingCompletion[],
): CustomEventDefinition[] {
  let definitions: CustomEventDefinition[] = []
  for (const record of records) {
    if (!record.customEvents) continue
    definitions = unionCustomEvents(definitions, record.customEvents)
  }
  return definitions
}

export function loadPendingCompletion(
  storage: StorageLike | null = getDefaultStorage(),
): PendingCompletionLoad {
  if (!storage) return { status: 'none' }

  let raw: string | null
  try {
    raw = storage.getItem(PENDING_COMPLETION_STORAGE_KEY)
  } catch {
    return {
      status: 'invalid',
      message:
        'The local completion recovery record could not be read. The editable application stays closed until browser storage recovers.',
    }
  }

  const records: PendingCompletion[] = []
  if (raw) {
    try {
      const completion = parseCompletion(JSON.parse(raw))
      if (!completion) {
        return {
          status: 'invalid',
          message:
            'A malformed local completion recovery record is present. The editable application stays closed and the record is retained.',
        }
      }
      records.push(completion)
    } catch {
      return {
        status: 'invalid',
        message:
          'A malformed local completion recovery record is present. The editable application stays closed and the record is retained.',
      }
    }
  }

  if (isEnumerableStorage(storage)) {
    for (const key of listEntryStorageKeys(storage)) {
      let value: string | null
      try {
        value = storage.getItem(key)
      } catch {
        return {
          status: 'invalid',
          message:
            'The local completion recovery record could not be read. The editable application stays closed until browser storage recovers.',
        }
      }
      if (!value) continue
      try {
        const completion = parseCompletion(JSON.parse(value))
        if (!completion) {
          return {
            status: 'invalid',
            message:
              'A malformed local completion recovery record is present. The editable application stays closed and the record is retained.',
          }
        }
        records.push(completion)
      } catch {
        return {
          status: 'invalid',
          message:
            'A malformed local completion recovery record is present. The editable application stays closed and the record is retained.',
        }
      }
    }
  }

  if (records.length === 0) return { status: 'none' }

  const entries = new Map<
    string,
    { session: Session; solves: Map<string, Solve> }
  >()
  for (const record of records) mergeCompletionEntries(entries, record)
  const customEvents = mergeCustomEventLists(records)
  const first = records[0]!
  return {
    status: 'ok',
    completion: {
      version: PENDING_COMPLETION_VERSION,
      operationId: first.operationId,
      createdAt: Math.min(...records.map((record) => record.createdAt)),
      entries: sortedCompletionEntries(entries),
      ...(customEvents.length > 0 ? { customEvents } : {}),
    },
  }
}

function savePendingCompletion(
  completion: PendingCompletion,
  storage: StorageLike | null,
): boolean {
  if (!storage) return false
  try {
    storage.setItem(
      PENDING_COMPLETION_STORAGE_KEY,
      JSON.stringify(completion),
    )
    return true
  } catch {
    return false
  }
}

export function clearPendingCompletion(
  storage: StorageLike | null = getDefaultStorage(),
): boolean {
  if (!storage?.removeItem) return false
  let ok = true
  try {
    storage.removeItem(PENDING_COMPLETION_STORAGE_KEY)
  } catch {
    ok = false
  }
  if (isEnumerableStorage(storage)) {
    for (const key of listEntryStorageKeys(storage)) {
      try {
        storage.removeItem(key)
      } catch {
        ok = false
      }
    }
  }
  return ok
}

function stableValue(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableValue(item)).join(',')}]`
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableValue(record[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function solveVersion(solve: Solve): string {
  return stableValue(solve)
}

function additionsBySession(
  baseline: SessionsData,
  local: SessionsData,
): PendingCompletionEntry[] {
  const baselineSolveIds = new Set<string>()
  for (const session of baseline.sessions) {
    for (const solve of session.solves) baselineSolveIds.add(solve.id)
  }
  const entries: PendingCompletionEntry[] = []
  for (const session of local.sessions) {
    const solves = session.solves.filter(
      (solve) => !baselineSolveIds.has(solve.id),
    )
    if (solves.length === 0) continue
    entries.push({
      session: { ...session, solves: [] },
      solves,
    })
  }
  return entries
}

/**
 * Durably records solves accepted while a prepared/committed replacement has
 * not been reconciled. Existing buffered solves are retained and deduplicated
 * by stable solve ID.
 *
 * New layouts write one key per solve so competing appends cannot overwrite
 * each other. Storage implementations without key enumeration keep the older
 * single-record fallback.
 */
export function recordPendingCompletion(
  baseline: SessionsData,
  local: SessionsData,
  storage: StorageLike | null = getDefaultStorage(),
): boolean {
  const existing = loadPendingCompletion(storage)
  if (existing.status === 'invalid') return false

  const entries = new Map<
    string,
    { session: Session; solves: Map<string, Solve> }
  >()
  if (existing.status === 'ok') {
    mergeCompletionEntries(entries, existing.completion)
  }
  const additions = additionsBySession(baseline, local)
  for (const entry of additions) {
    mergeCompletionEntries(entries, {
      version: PENDING_COMPLETION_VERSION,
      operationId: 'addition',
      createdAt: 0,
      entries: [entry],
    })
  }
  if (entries.size === 0) {
    // There is no completed solve to preserve. Refuse the write instead of
    // claiming that an edit was saved into the staged collection.
    return false
  }

  const previous = existing.status === 'ok' ? existing.completion : null
  const customEvents = unionCustomEvents(
    previous?.customEvents ?? [],
    local.customEvents ?? [],
  )
  const completion: PendingCompletion = {
    version: PENDING_COMPLETION_VERSION,
    operationId: previous?.operationId ?? createId(),
    createdAt: previous?.createdAt ?? Date.now(),
    entries: sortedCompletionEntries(entries),
    ...(customEvents.length > 0 ? { customEvents } : {}),
  }

  if (!isEnumerableStorage(storage)) {
    return savePendingCompletion(completion, storage)
  }

  const newSolveIds = new Set(
    additions.flatMap((entry) => entry.solves.map((solve) => solve.id)),
  )
  let ok = true
  for (const entry of entries.values()) {
    for (const solve of entry.solves.values()) {
      const key = entryStorageKey(solve.id)
      let existingRaw: string | null
      try {
        existingRaw = storage.getItem(key)
      } catch {
        ok = false
        continue
      }
      if (existingRaw && !newSolveIds.has(solve.id)) {
        // This solve already has its own durable record. Do not replace it
        // with an older snapshot; only a fresh addition may update its key.
        continue
      }
      const record: PendingCompletion = {
        version: PENDING_COMPLETION_VERSION,
        operationId: completion.operationId,
        createdAt: completion.createdAt,
        entries: [
          {
            session: { ...entry.session, solves: [] },
            solves: [solve],
          },
        ],
        ...(customEvents.length > 0 ? { customEvents } : {}),
      }
      try {
        storage.setItem(key, JSON.stringify(record))
      } catch {
        ok = false
      }
    }
  }
  return ok
}

function solveExistsInData(
  data: SessionsData,
  solveId: string,
  version: string,
): boolean {
  for (const session of data.sessions) {
    for (const solve of session.solves) {
      if (solve.id === solveId && solveVersion(solve) === version) return true
    }
  }
  return false
}

function readTombstones(
  storage: StorageLike | null,
): Tombstone[] | null {
  if (!storage) return []
  try {
    // Avoid creating a fresh sync record here; only read existing deletion
    // provenance. A read failure keeps buffered solves pending conservatively.
    if (storage.getItem(SYNC_STORAGE_KEY) === null) return []
    return loadSyncStorage(storage).runtime.tombstones
  } catch {
    return null
  }
}

function activeSolveTombstone(
  tombstones: readonly Tombstone[],
  solveId: string,
): boolean {
  return tombstones.some(
    (tombstone) =>
      tombstone.kind === 'solve' &&
      tombstone.id === solveId &&
      isActiveTombstone(tombstone),
  )
}

function acknowledgeLegacyRecord(
  storage: StorageLike,
  versions: ReadonlyMap<string, string>,
  removeIds: ReadonlySet<string>,
): boolean {
  let raw: string | null
  try {
    raw = storage.getItem(PENDING_COMPLETION_STORAGE_KEY)
  } catch {
    return false
  }
  if (!raw) return true

  let current: PendingCompletion | null
  try {
    current = parseCompletion(JSON.parse(raw))
  } catch {
    return false
  }
  if (!current) return false

  let changed = false
  const entries: PendingCompletionEntry[] = []
  for (const entry of current.entries) {
    const solves = entry.solves.filter((solve) => {
      if (!removeIds.has(solve.id)) return true
      const version = versions.get(solve.id)
      if (version !== solveVersion(solve)) return true
      changed = true
      return false
    })
    if (solves.length > 0) {
      entries.push({ session: { ...entry.session, solves: [] }, solves })
    } else if (entry.solves.length > 0) {
      changed = true
    }
  }
  if (!changed) return true
  if (entries.length === 0) {
    try {
      storage.removeItem?.(PENDING_COMPLETION_STORAGE_KEY)
      return true
    } catch {
      return false
    }
  }
  return savePendingCompletion({ ...current, entries }, storage)
}

/**
 * Removes only the buffered solve versions that are now durably present in
 * `data` or superseded by an active deletion tombstone. A newer append with a
 * different solve ID (or a newer version of the same ID) is retained.
 */
export function acknowledgePendingCompletion(
  completion: PendingCompletion,
  options: AcknowledgePendingCompletionOptions,
): boolean {
  const storage =
    options.storage === undefined ? getDefaultStorage() : options.storage
  if (!storage) return false

  const versions = new Map<string, string>()
  for (const entry of completion.entries) {
    for (const solve of entry.solves) {
      versions.set(solve.id, solveVersion(solve))
    }
  }
  const removeIds = new Set<string>()
  for (const [solveId, version] of versions) {
    if (
      solveExistsInData(options.data, solveId, version) ||
      activeSolveTombstone(options.tombstones ?? [], solveId)
    ) {
      removeIds.add(solveId)
    }
  }
  if (removeIds.size === 0) return true

  let ok = true
  if (isEnumerableStorage(storage)) {
    for (const solveId of removeIds) {
      const key = entryStorageKey(solveId)
      let raw: string | null
      try {
        raw = storage.getItem(key)
      } catch {
        ok = false
        continue
      }
      if (!raw) continue
      try {
        const current = parseCompletion(JSON.parse(raw))
        const currentSolve = current?.entries[0]?.solves[0]
        if (
          currentSolve &&
          versions.get(solveId) === solveVersion(currentSolve)
        ) {
          storage.removeItem?.(key)
        }
      } catch {
        ok = false
      }
    }
  }
  if (!acknowledgeLegacyRecord(storage, versions, removeIds)) ok = false
  return ok
}

export function acknowledgePendingCompletionForData(
  data: SessionsData,
  options: {
    storage?: StorageLike | null
    tombstones?: readonly Tombstone[]
  } = {},
): boolean {
  const storage =
    options.storage === undefined ? getDefaultStorage() : options.storage
  const loaded = loadPendingCompletion(storage)
  if (loaded.status === 'none') return true
  if (loaded.status === 'invalid') return false
  const tombstones = options.tombstones ?? readTombstones(storage)
  if (!tombstones) return false
  return acknowledgePendingCompletion(loaded.completion, {
    storage,
    data,
    tombstones,
  })
}

/**
 * Replays buffered completions over the replacement outcome. Solve IDs keep
 * this idempotent; a missing or event-incompatible owner becomes a labelled
 * recovered session with the original solve event. Reconciliation performs the
 * event routing so other cross-tab adoptions cannot reintroduce a mixed-event
 * session.
 */
export function applyPendingCompletion(
  external: SessionsData,
  completion: PendingCompletion,
  tombstones: readonly Tombstone[] = [],
): SessionsData {
  const deletedSolveIds = new Set(
    tombstones
      .filter(
        (tombstone) =>
          tombstone.kind === 'solve' && isActiveTombstone(tombstone),
      )
      .map((tombstone) => tombstone.id),
  )
  const sessions = external.sessions.map((session) => ({
    ...session,
    solves: [...session.solves],
  }))
  const byId = new Map(sessions.map((session) => [session.id, session]))
  for (const entry of completion.entries) {
    const solves = entry.solves.filter(
      (solve) => !deletedSolveIds.has(solve.id),
    )
    if (solves.length === 0) continue
    let target = byId.get(entry.session.id)
    if (!target) {
      target = { ...entry.session, solves: [] }
      sessions.push(target)
      byId.set(target.id, target)
    }
    const existingIds = new Set(target.solves.map((solve) => solve.id))
    const newSolves = solves.filter((solve) => !existingIds.has(solve.id))
    if (newSolves.length === 0) continue
    target.solves = [...target.solves, ...newSolves].sort(
      (left, right) =>
        right.createdAt - left.createdAt || left.id.localeCompare(right.id),
    )
    target.updatedAt = Math.max(
      target.updatedAt,
      ...newSolves.map((solve) => solve.updatedAt ?? solve.createdAt),
    )
  }

  const customEvents = unionCustomEvents(
    external.customEvents ?? [],
    completion.customEvents ?? [],
  )
  const externalWithEvents: SessionsData = {
    ...external,
    ...(customEvents.length > 0 ? { customEvents } : {}),
  }
  const local: SessionsData = {
    activeSessionId: external.activeSessionId,
    sessions,
    ...(customEvents.length > 0 ? { customEvents } : {}),
  }
  const baseline: SessionsData = {
    activeSessionId: external.activeSessionId,
    sessions: external.sessions.map((session) => ({
      ...session,
      solves: [...session.solves],
    })),
    ...(external.customEvents ? { customEvents: external.customEvents } : {}),
  }
  return reconcileExternalSessions({
    external: externalWithEvents,
    local,
    baseline,
  })
}

/** Applies and acknowledges the local completion buffer before normal hooks mount. */
export function applyPendingCompletionAtStartup(
  storage: StorageLike | null = getDefaultStorage(),
): ApplyPendingCompletionResult {
  const loaded = loadPendingCompletion(storage)
  if (loaded.status === 'none') return { ok: true }
  if (loaded.status === 'invalid') {
    return { ok: false, message: loaded.message }
  }
  let data: SessionsData
  try {
    data = loadSessionsForStartup(storage).data
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'Saved history could not be read safely. The original data has been kept.' }
  }
  const tombstones = readTombstones(storage)
  if (!tombstones) {
    return {
      ok: false,
      message:
        'Accepted solve data is waiting for replacement recovery, but the deletion records could not be read. The editable application stays closed until browser storage recovers.',
    }
  }
  const next = applyPendingCompletion(data, loaded.completion, tombstones)
  if (!saveSessions(next, storage)) {
    return {
      ok: false,
      message:
        'Accepted solve data is still waiting to be saved after replacement recovery. Free browser storage, then retry.',
    }
  }
  // A cleanup failure leaves the durable buffer for an idempotent retry rather
  // than discarding the only copy or blocking normal application startup.
  acknowledgePendingCompletion(loaded.completion, {
    storage,
    data: next,
    tombstones,
  })
  return { ok: true }
}
