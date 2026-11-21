import type { StorageLike } from './storage'
import { CUBELAB_VERSION } from './version'

/**
 * Verified pre-upgrade archives.
 *
 * The archive is local-only and deliberately stores the exact original string
 * values. It never parses/reserializes them and never includes OAuth tokens.
 * IndexedDB is preferred; a localStorage fallback is used only when IndexedDB
 * cannot be opened. Both are CubeLab-owned names so the explicit site reset
 * removes them.
 */

export const UPGRADE_ARCHIVE_FORMAT = 'cubelab-upgrade-archive'
export const UPGRADE_ARCHIVE_VERSION = 1
export const UPGRADE_ARCHIVE_DB_NAME = 'cubelab-upgrade-archive'
export const UPGRADE_ARCHIVE_STORE_NAME = 'archives'
export const UPGRADE_ARCHIVE_FALLBACK_PREFIX = 'cubelab:upgrade-archive:v1:'
export const UPGRADE_ARCHIVE_INDEX_KEY = 'cubelab:upgrade-archive-index:v1'

export type UpgradeArchiveReason =
  | 'schema-migration'
  | 'legacy-migration'
  | 'normalization'
  | 'pre-restore'

export type UpgradeArchiveStatus = 'verified' | 'complete' | 'failed'

export interface UpgradeArchiveEntry {
  /** Exact localStorage key. */
  key: string
  /** False distinguishes a genuinely absent key from an unreadable value. */
  present: boolean
  /** Exact original string; null for an absent key. */
  raw: string | null
  sourceVersion: number | null
  byteLength: number
  checksum: string
}

export interface UpgradeArchiveRecord {
  format: typeof UPGRADE_ARCHIVE_FORMAT
  version: typeof UPGRADE_ARCHIVE_VERSION
  id: string
  createdAt: number
  appVersion: string
  reason: UpgradeArchiveReason
  sourceVersions: Record<string, number | null>
  includedKeys: string[]
  entries: Record<string, UpgradeArchiveEntry>
  integrity: {
    algorithm: 'fnv1a32'
    overall: string
  }
  /** `complete` means the verified migration commit was also observed. */
  status: UpgradeArchiveStatus
}

export interface UpgradeArchiveStore {
  readonly backend: 'indexeddb' | 'localstorage' | 'memory'
  put(record: UpgradeArchiveRecord): Promise<void>
  get(id: string): Promise<UpgradeArchiveRecord | null>
  list(): Promise<UpgradeArchiveRecord[]>
  delete(id: string): Promise<void>
}

export interface UpgradeArchiveSource {
  key: string
  raw: string | null
  sourceVersion?: number | null
}

export interface CreateUpgradeArchiveOptions {
  reason: UpgradeArchiveReason
  sources: readonly UpgradeArchiveSource[]
  /** Defaults to `store`; tests can supply a synthetic timestamp. */
  now?: number
  appVersion?: string
}

export class UpgradeArchiveError extends Error {
  readonly retryable: boolean
  constructor(message: string, retryable = true) {
    super(message)
    this.name = 'UpgradeArchiveError'
    this.retryable = retryable
  }
}

function createArchiveId(now: number): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `archive-${now}-${Math.random().toString(36).slice(2, 12)}`
}

/** Stable 32-bit checksum for detecting accidental byte changes. */
export function archiveChecksum(raw: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < raw.length; index += 1) {
    hash ^= raw.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `${raw.length.toString(16)}-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

function buildEntries(
  sources: readonly UpgradeArchiveSource[],
): Record<string, UpgradeArchiveEntry> {
  const entries: Record<string, UpgradeArchiveEntry> = {}
  for (const source of sources) {
    if (Object.hasOwn(entries, source.key)) continue
    const present = source.raw !== null
    entries[source.key] = {
      key: source.key,
      present,
      raw: source.raw,
      sourceVersion: source.sourceVersion ?? null,
      byteLength: present ? source.raw!.length : 0,
      checksum: present ? archiveChecksum(source.raw!) : archiveChecksum(''),
    }
  }
  return entries
}

function overallChecksum(entries: Record<string, UpgradeArchiveEntry>): string {
  const manifest = Object.keys(entries)
    .sort()
    .map((key) => `${key}\u0000${entries[key]!.checksum}`)
    .join('\u0001')
  return archiveChecksum(manifest)
}

export function verifyUpgradeArchiveRecord(value: unknown): value is UpgradeArchiveRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Partial<UpgradeArchiveRecord>
  if (
    record.format !== UPGRADE_ARCHIVE_FORMAT ||
    record.version !== UPGRADE_ARCHIVE_VERSION ||
    typeof record.id !== 'string' ||
    record.id.length === 0 ||
    typeof record.createdAt !== 'number' ||
    !Number.isFinite(record.createdAt) ||
    typeof record.appVersion !== 'string' ||
    (record.reason !== 'schema-migration' &&
      record.reason !== 'legacy-migration' &&
      record.reason !== 'normalization' &&
      record.reason !== 'pre-restore') ||
    (record.status !== 'verified' &&
      record.status !== 'complete' &&
      record.status !== 'failed') ||
    typeof record.entries !== 'object' ||
    record.entries === null ||
    Array.isArray(record.entries) ||
    typeof record.integrity !== 'object' ||
    record.integrity === null ||
    record.integrity.algorithm !== 'fnv1a32' ||
    typeof record.integrity.overall !== 'string'
  ) {
    return false
  }
  for (const entry of Object.values(record.entries)) {
    if (typeof entry !== 'object' || entry === null) return false
    if (
      typeof entry.key !== 'string' ||
      typeof entry.present !== 'boolean' ||
      (entry.raw !== null && typeof entry.raw !== 'string') ||
      (entry.present !== (entry.raw !== null)) ||
      (entry.sourceVersion !== null &&
        (typeof entry.sourceVersion !== 'number' ||
          !Number.isFinite(entry.sourceVersion))) ||
      typeof entry.byteLength !== 'number' ||
      typeof entry.checksum !== 'string'
    ) {
      return false
    }
    if (
      entry.present &&
      (entry.byteLength !== entry.raw!.length ||
        entry.checksum !== archiveChecksum(entry.raw!))
    ) {
      return false
    }
  }
  return overallChecksum(record.entries) === record.integrity.overall
}

export async function createUpgradeArchive(
  options: CreateUpgradeArchiveOptions,
  store: UpgradeArchiveStore,
): Promise<UpgradeArchiveRecord> {
  const now = options.now ?? Date.now()
  const entries = buildEntries(options.sources)
  const includedKeys = Object.keys(entries).sort()
  if (includedKeys.length === 0) {
    throw new UpgradeArchiveError('No CubeLab-owned records were available to archive.', false)
  }
  const sourceVersions: Record<string, number | null> = {}
  for (const key of includedKeys) {
    sourceVersions[key] = entries[key]!.sourceVersion
  }
  const record: UpgradeArchiveRecord = {
    format: UPGRADE_ARCHIVE_FORMAT,
    version: UPGRADE_ARCHIVE_VERSION,
    id: createArchiveId(now),
    createdAt: now,
    appVersion: options.appVersion ?? CUBELAB_VERSION,
    reason: options.reason,
    sourceVersions,
    includedKeys,
    entries,
    integrity: {
      algorithm: 'fnv1a32',
      overall: overallChecksum(entries),
    },
    status: 'verified',
  }

  await store.put(record)
  // Re-read from the actual backend. A successful `put` promise is not enough:
  // a partially accepted or normalized write must never be reported as verified.
  const stored = await store.get(record.id)
  if (!stored || !verifyUpgradeArchiveRecord(stored)) {
    await store.delete(record.id).catch(() => undefined)
    throw new UpgradeArchiveError(
      'The recovery archive could not be verified after it was written. The original data was not changed.',
    )
  }
  for (const key of includedKeys) {
    const before = entries[key]!
    const after = stored.entries[key]
    if (
      !after ||
      after.present !== before.present ||
      after.raw !== before.raw ||
      after.checksum !== before.checksum
    ) {
      await store.delete(record.id).catch(() => undefined)
      throw new UpgradeArchiveError(
        'The recovery archive did not preserve the exact original bytes. The original data was not changed.',
      )
    }
  }
  return record
}

export async function markUpgradeArchiveStatus(
  id: string,
  status: UpgradeArchiveStatus,
  store: UpgradeArchiveStore,
): Promise<UpgradeArchiveRecord | null> {
  const current = await store.get(id)
  if (!current) return null
  const next: UpgradeArchiveRecord = { ...current, status }
  await store.put(next)
  const verified = await store.get(id)
  return verified && verifyUpgradeArchiveRecord(verified) ? verified : null
}

/**
 * Keeps the two newest verified archives plus the newest completed checkpoint.
 * Deletion only considers records that re-read successfully; an unreadable
 * archive is retained rather than treated as disposable.
 */
export async function retainUpgradeArchives(
  store: UpgradeArchiveStore,
  keepRecent = 2,
): Promise<{ kept: string[]; deleted: string[] }> {
  const records = (await store.list())
    .slice()
    .sort((left, right) => right.createdAt - left.createdAt)
  const keep = new Set<string>()
  for (const record of records.slice(0, keepRecent)) keep.add(record.id)
  const lastKnownGood = records.find((record) => record.status === 'complete')
  if (lastKnownGood) keep.add(lastKnownGood.id)
  const deleted: string[] = []
  for (const record of records) {
    if (keep.has(record.id)) continue
    if (!verifyUpgradeArchiveRecord(record)) continue
    try {
      await store.delete(record.id)
      deleted.push(record.id)
    } catch {
      // A failed cleanup is nonessential; preserve the record.
    }
  }
  return { kept: [...keep], deleted }
}

export async function listUpgradeArchives(
  store: UpgradeArchiveStore,
): Promise<UpgradeArchiveRecord[]> {
  return (await store.list()).filter(verifyUpgradeArchiveRecord)
}

export async function lastKnownGoodArchive(
  store: UpgradeArchiveStore,
): Promise<UpgradeArchiveRecord | null> {
  const records = await listUpgradeArchives(store)
  return (
    records
      .filter((record) => record.status === 'complete')
      .sort((left, right) => right.createdAt - left.createdAt)[0] ?? null
  )
}

export function createMemoryUpgradeArchiveStore(): UpgradeArchiveStore {
  const records = new Map<string, UpgradeArchiveRecord>()
  return {
    backend: 'memory',
    async put(record) {
      records.set(record.id, structuredClone(record))
    },
    async get(id) {
      const record = records.get(id)
      return record ? structuredClone(record) : null
    },
    async list() {
      return [...records.values()].map((record) => structuredClone(record))
    },
    async delete(id) {
      records.delete(id)
    },
  }
}

export function createLocalStorageUpgradeArchiveStore(
  storage: StorageLike,
): UpgradeArchiveStore {
  const readIndex = (): string[] => {
    try {
      const raw = storage.getItem(UPGRADE_ARCHIVE_INDEX_KEY)
      if (!raw) return []
      const parsed: unknown = JSON.parse(raw)
      return Array.isArray(parsed)
        ? parsed.filter((id): id is string => typeof id === 'string' && id.length > 0)
        : []
    } catch {
      return []
    }
  }
  const writeIndex = (ids: readonly string[]) => {
    storage.setItem(UPGRADE_ARCHIVE_INDEX_KEY, JSON.stringify([...new Set(ids)]))
  }
  return {
    backend: 'localstorage',
    async put(record) {
      storage.setItem(
        `${UPGRADE_ARCHIVE_FALLBACK_PREFIX}${record.id}`,
        JSON.stringify(record),
      )
      writeIndex([...readIndex(), record.id])
    },
    async get(id) {
      try {
        const raw = storage.getItem(`${UPGRADE_ARCHIVE_FALLBACK_PREFIX}${id}`)
        return raw ? (JSON.parse(raw) as UpgradeArchiveRecord) : null
      } catch {
        return null
      }
    },
    async list() {
      const records: UpgradeArchiveRecord[] = []
      for (const id of readIndex()) {
        const record = await this.get(id)
        if (record) records.push(record)
      }
      return records
    },
    async delete(id) {
      if (storage.removeItem) {
        storage.removeItem(`${UPGRADE_ARCHIVE_FALLBACK_PREFIX}${id}`)
      } else {
        storage.setItem(`${UPGRADE_ARCHIVE_FALLBACK_PREFIX}${id}`, '')
      }
      writeIndex(readIndex().filter((candidate) => candidate !== id))
    },
  }
}

function openIndexedDbArchiveStore(): Promise<UpgradeArchiveStore> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable.'))
      return
    }
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      callback()
    }
    const request = indexedDB.open(UPGRADE_ARCHIVE_DB_NAME, 1)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(UPGRADE_ARCHIVE_STORE_NAME)) {
        database.createObjectStore(UPGRADE_ARCHIVE_STORE_NAME, { keyPath: 'id' })
      }
    }
    request.onerror = () =>
      finish(() => reject(request.error ?? new Error('IndexedDB open failed.')))
    request.onblocked = () =>
      finish(() =>
        reject(new Error('IndexedDB archive upgrade is blocked by another tab.')),
      )
    request.onsuccess = () => {
      const database = request.result
      const withStore = <T>(
        mode: IDBTransactionMode,
        run: (store: IDBObjectStore) => IDBRequest<T>,
      ): Promise<T> =>
        new Promise<T>((resolveRequest, rejectRequest) => {
          let transaction: IDBTransaction
          try {
            transaction = database.transaction(UPGRADE_ARCHIVE_STORE_NAME, mode)
          } catch (error) {
            rejectRequest(error)
            return
          }
          const store = transaction.objectStore(UPGRADE_ARCHIVE_STORE_NAME)
          let value: T
          try {
            const result = run(store)
            result.onsuccess = () => {
              value = result.result
            }
            result.onerror = () => rejectRequest(result.error)
          } catch (error) {
            rejectRequest(error)
            return
          }
          transaction.oncomplete = () => resolveRequest(value)
          transaction.onerror = () => rejectRequest(transaction.error)
          transaction.onabort = () => rejectRequest(transaction.error)
        })
      const store: UpgradeArchiveStore = {
        backend: 'indexeddb',
        async put(record) {
          await withStore('readwrite', (objectStore) => objectStore.put(record))
        },
        get(id) {
          return withStore<UpgradeArchiveRecord | null>('readonly', (objectStore) =>
            objectStore.get(id),
          ).then((value) => value ?? null)
        },
        list() {
          return withStore<UpgradeArchiveRecord[]>('readonly', (objectStore) =>
            objectStore.getAll(),
          )
        },
        async delete(id) {
          await withStore('readwrite', (objectStore) => objectStore.delete(id))
        },
      }
      finish(() => resolve(store))
    }
  })
}

/**
 * Opens the verified archive store. IndexedDB is preferred; when it cannot be
 * opened at all, localStorage is used only if it is available and writable.
 */
export async function openDefaultUpgradeArchiveStore(
  storage: StorageLike | null,
): Promise<UpgradeArchiveStore> {
  try {
    return await openIndexedDbArchiveStore()
  } catch {
    if (storage) return createLocalStorageUpgradeArchiveStore(storage)
    throw new UpgradeArchiveError(
      'No browser storage is available for a verified recovery archive.',
      false,
    )
  }
}
