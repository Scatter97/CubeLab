import type { StorageLike } from './storage'

/**
 * Browser-managed persistence helpers. These APIs are advisory: persistence
 * reduces eviction risk but cannot protect against user-initiated clearing.
 * Every method is optional and may reject or throw.
 */
export const PERSISTENCE_REQUEST_KEY = 'cubelab:persistence-request:v1'

export interface StorageHealth {
  supported: boolean
  persisted: boolean | null
  usage: number | null
  quota: number | null
  error: string | null
}

export interface StorageHealthNavigator {
  storage?: {
    persisted?: () => Promise<boolean>
    persist?: () => Promise<boolean>
    estimate?: () => Promise<{ usage?: number; quota?: number }>
  }
}

function defaultStorage(): StorageLike | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    return window.localStorage
  } catch {
    return null
  }
}

function normalizeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null
}

export async function readStorageHealth(
  navigatorLike: StorageHealthNavigator | null | undefined =
    typeof navigator === 'undefined' ? null : navigator,
): Promise<StorageHealth> {
  const storage = navigatorLike?.storage
  if (!storage) {
    return {
      supported: false,
      persisted: null,
      usage: null,
      quota: null,
      error: 'The browser does not expose StorageManager.',
    }
  }
  let persisted: boolean | null = null
  let usage: number | null = null
  let quota: number | null = null
  let error: string | null = null

  if (typeof storage.persisted === 'function') {
    try {
      persisted = await storage.persisted()
    } catch {
      error = 'Persistent-storage status could not be read.'
    }
  } else {
    error = 'Persistent-storage status is not supported.'
  }

  if (typeof storage.estimate === 'function') {
    try {
      const estimate = await storage.estimate()
      usage = normalizeNumber(estimate?.usage)
      quota = normalizeNumber(estimate?.quota)
    } catch {
      error = error ?? 'Storage usage could not be estimated.'
    }
  }

  return {
    supported:
      typeof storage.persisted === 'function' ||
      typeof storage.persist === 'function' ||
      typeof storage.estimate === 'function',
    persisted,
    usage,
    quota,
    error,
  }
}

export interface RequestPersistenceResult extends StorageHealth {
  requested: boolean
  granted: boolean | null
}

let requestInFlight: Promise<RequestPersistenceResult> | null = null

function hasRequestMarker(storage: StorageLike | null): boolean {
  if (!storage) return false
  try {
    return storage.getItem(PERSISTENCE_REQUEST_KEY) !== null
  } catch {
    return false
  }
}

function writeRequestMarker(storage: StorageLike | null, now: number): void {
  if (!storage) return
  try {
    storage.setItem(
      PERSISTENCE_REQUEST_KEY,
      JSON.stringify({ version: 1, requestedAt: now }),
    )
  } catch {
    // The in-memory guard still prevents repeated prompts in this document.
  }
}

/**
 * Requests persistence at most once per browser profile unless `force` is used.
 * Call only after a user interaction. Never blocks timing or a solve write.
 */
export async function requestStoragePersistence(options: {
  navigatorLike?: StorageHealthNavigator | null
  storage?: StorageLike | null
  force?: boolean
  now?: number
} = {}): Promise<RequestPersistenceResult> {
  const navigatorLike =
    options.navigatorLike === undefined
      ? typeof navigator === 'undefined'
        ? null
        : navigator
      : options.navigatorLike
  const storage =
    options.storage === undefined ? defaultStorage() : options.storage
  if (!options.force && hasRequestMarker(storage)) {
    return {
      ...(await readStorageHealth(navigatorLike)),
      requested: false,
      granted: null,
    }
  }
  if (requestInFlight) return requestInFlight

  requestInFlight = (async () => {
    const before = await readStorageHealth(navigatorLike)
    const persist = navigatorLike?.storage?.persist
    if (typeof persist !== 'function') {
      return {
        ...before,
        requested: false,
        granted: null,
      }
    }
    writeRequestMarker(storage, options.now ?? Date.now())
    let granted: boolean | null = null
    let error = before.error
    try {
      granted = await persist.call(navigatorLike!.storage)
    } catch {
      error = 'The browser rejected the persistent-storage request.'
    }
    const after = await readStorageHealth(navigatorLike)
    return {
      ...after,
      persisted: granted ?? after.persisted,
      error: error ?? after.error,
      requested: true,
      granted,
    }
  })()

  try {
    return await requestInFlight
  } finally {
    requestInFlight = null
  }
}
