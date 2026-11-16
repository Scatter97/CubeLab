/**
 * Local site reset.
 *
 * This module owns the destructive, browser-local half of "Reset All Site
 * Data". It deliberately never talks to Google Drive: callers must block the
 * Drive transport and disable synchronization before invoking it. The reset is
 * limited to storage that CubeLab owns:
 *
 * - localStorage/sessionStorage keys with the `cubelab:` prefix
 * - IndexedDB databases whose names start with `cubelab`
 * - Workbox precache/runtime caches for this application's scope, plus cache
 *   names that contain `cubelab`
 * - service worker registrations whose script is this application's `sw.js`
 * - CubeLab-prefixed cookies (none are currently written, but the cleanup is
 *   safe and future-proof)
 *
 * Browser-managed data outside these APIs (for example the HTTP cache or
 * Google Identity Services' own cookies) cannot be fully erased by page
 * JavaScript. The UI must describe that limit rather than claiming otherwise.
 */

export const CUBELAB_STORAGE_PREFIX = 'cubelab:'
export const SITE_RESET_CHANNEL_NAME = 'cubelab-site-reset'
export const SITE_RESET_SIGNAL_STORAGE_KEY = 'cubelab:site-reset-signal:v1'

/** Names used by CubeLab's current and future IndexedDB stores. */
export const KNOWN_CUBELAB_DATABASE_NAMES = [
  'cubelab',
  'cubelab-solves',
  'cubelab-sessions',
  'cubelab-training',
  'cubelab-sync',
] as const

export type SiteResetSignalPhase =
  | 'begin'
  | 'complete'
  | 'failed'
  | 'abandoned'

export interface SiteResetSignal {
  type: 'cubelab-site-reset'
  phase: SiteResetSignalPhase
  runId: string
  at: number
}

export interface ResettableStorage {
  readonly length: number
  key(index: number): string | null
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface IndexedDbLike {
  databases?: () => Promise<Array<{ name?: string }>>
  deleteDatabase(name: string): IDBOpenDBRequest
}

export interface CacheStorageLike {
  keys(): Promise<string[]>
  delete(name: string): Promise<boolean>
}

export interface ServiceWorkerRegistrationLike {
  scope?: string
  active?: { scriptURL: string } | null
  installing?: { scriptURL: string } | null
  waiting?: { scriptURL: string } | null
  unregister(): Promise<boolean>
}

export interface ServiceWorkerContainerLike {
  getRegistrations(): Promise<readonly ServiceWorkerRegistrationLike[]>
}

export interface CookieDocumentLike {
  cookie: string
}

export interface SiteResetStorageResult {
  ok: boolean
  localStorageKeysRemoved: string[]
  sessionStorageKeysRemoved: string[]
  databasesDeleted: string[]
  databasesBlocked: string[]
  cachesDeleted: string[]
  workersUnregistered: number
  errors: string[]
}

export interface ResetSiteStorageOptions {
  localStorage?: ResettableStorage | null
  sessionStorage?: ResettableStorage | null
  indexedDb?: IndexedDbLike | null
  cacheStorage?: CacheStorageLike | null
  serviceWorker?: ServiceWorkerContainerLike | null
  document?: CookieDocumentLike | null
  /** Application URL scope, normally `https://origin/`. */
  scope?: string
  /** How long to wait for a blocked IndexedDB deletion before reporting it. */
  databaseBlockedTimeoutMs?: number
}

export interface SiteResetChannelLike {
  postMessage(message: SiteResetSignal): void
  close?(): void
  onmessage: ((event: { data: unknown }) => void) | null
}

export type SiteResetChannelFactory = () => SiteResetChannelLike | null

export interface SiteResetBroadcastOptions {
  channelFactory?: SiteResetChannelFactory
  storage?: ResettableStorage | null
}

export interface SiteResetSubscribeOptions {
  channelFactory?: SiteResetChannelFactory
  target?: {
    addEventListener(type: string, listener: EventListener): void
    removeEventListener(type: string, listener: EventListener): void
  } | null
}

const SYNC_STOP_TIMEOUT_MS = 10_000
const SYNC_STOP_POLL_MS = 25

let siteResetInProgress = false

/**
 * Permanently (for this document) blocks CubeLab persistence while the app is
 * being reset or after another tab has started a reset. A successful reset
 * reloads the page, which naturally clears this in-memory gate.
 */
export function beginSiteResetGate(): void {
  siteResetInProgress = true
}

export function isSiteResetInProgress(): boolean {
  return siteResetInProgress
}

/** Test-only escape hatch; production uses the reload to clear the gate. */
export function resetSiteResetGateForTests(): void {
  siteResetInProgress = false
}

export function createSiteResetRunId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `reset-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function isCubeLabStorageKey(key: string): boolean {
  return key.startsWith(CUBELAB_STORAGE_PREFIX)
}

export function isCubeLabDatabaseName(name: string): boolean {
  return /^cubelab(?:[:_-]|$)/i.test(name)
}

export function applicationScope(href: string): string {
  try {
    return new URL('./', href).href
  } catch {
    return '/'
  }
}

/**
 * Workbox names precache caches as `workbox-precache-v2-<scope>` and runtime
 * caches as `workbox-runtime-<scope>`. Newer CubeLab builds may also include
 * `cubelab` in the name. Anything else is left alone.
 */
export function isCubeLabCacheName(name: string, scope: string): boolean {
  const lower = name.toLowerCase()
  if (lower.includes('cubelab')) return true
  const scopeKey = scope.toLowerCase()
  if (!scopeKey) return false
  return (
    (lower.startsWith('workbox-precache') ||
      lower.startsWith('workbox-runtime-')) &&
    lower.includes(scopeKey)
  )
}

export function isCubeLabServiceWorkerScript(
  scriptURL: string,
  scope: string,
): boolean {
  try {
    const script = new URL(scriptURL)
    const scopeURL = new URL(scope)
    if (script.origin !== scopeURL.origin) return false
    return script.href === new URL('sw.js', scopeURL).href
  } catch {
    return false
  }
}

function getBrowserStorage(kind: 'localStorage' | 'sessionStorage'): ResettableStorage | null {
  if (typeof window === 'undefined') return null
  try {
    return window[kind]
  } catch {
    return null
  }
}

function getBrowserIndexedDb(): IndexedDbLike | null {
  if (typeof indexedDB === 'undefined') return null
  return indexedDB
}

function getBrowserCaches(): CacheStorageLike | null {
  if (typeof caches === 'undefined') return null
  return caches
}

function getBrowserServiceWorker(): ServiceWorkerContainerLike | null {
  if (typeof navigator === 'undefined' || !navigator.serviceWorker) return null
  return navigator.serviceWorker
}

function getBrowserDocument(): CookieDocumentLike | null {
  return typeof document === 'undefined' ? null : document
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Removes every key with CubeLab's prefix and verifies the result. A storage
 * implementation that silently ignores `removeItem` is reported as a failure
 * instead of allowing the caller to claim a clean reset.
 */
export function deleteCubeLabStorage(
  storage: ResettableStorage | null,
  label: string,
  errors: string[],
): string[] {
  if (!storage) return []
  const removed: string[] = []
  try {
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index)
      if (key !== null && isCubeLabStorageKey(key)) {
        storage.removeItem(key)
        removed.push(key)
      }
    }
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index)
      if (key !== null && isCubeLabStorageKey(key)) {
        errors.push(
          `CubeLab data could not be removed from ${label} (${key}). Reload CubeLab and retry.`,
        )
      }
    }
  } catch (error) {
    errors.push(`Could not clear ${label}: ${errorMessage(error)}`)
  }
  return removed
}

/**
 * Starts `indexedDB.deleteDatabase` without assuming it resolves. `onblocked`
 * is not an immediate failure: another tab may receive our reset broadcast,
 * close, and let the request succeed. The timeout turns a permanently blocked
 * deletion into an explicit partial failure that the UI can retry.
 */
export function deleteIndexedDbDatabase(
  factory: IndexedDbLike,
  name: string,
  blockedTimeoutMs = 750,
): Promise<'deleted' | 'blocked' | 'error'> {
  return new Promise((resolve) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const finish = (result: 'deleted' | 'blocked' | 'error') => {
      if (settled) return
      settled = true
      if (timer !== null) clearTimeout(timer)
      resolve(result)
    }

    let request: IDBOpenDBRequest
    try {
      request = factory.deleteDatabase(name)
    } catch {
      finish('error')
      return
    }

    timer = setTimeout(() => finish('blocked'), blockedTimeoutMs)
    request.onsuccess = () => finish('deleted')
    request.onerror = () => finish('error')
    request.onblocked = () => {
      // Keep waiting until the timeout or a late success. The connection may
      // belong to another CubeLab tab that is reloading after our broadcast.
    }
  })
}

export async function listCubeLabDatabaseNames(
  factory: IndexedDbLike,
  errors: string[],
): Promise<string[]> {
  const names = new Set<string>(KNOWN_CUBELAB_DATABASE_NAMES)
  if (!factory.databases) return [...names]
  try {
    for (const database of await factory.databases()) {
      if (database.name && isCubeLabDatabaseName(database.name)) {
        names.add(database.name)
      }
    }
  } catch (error) {
    errors.push(`Could not list IndexedDB databases: ${errorMessage(error)}`)
  }
  return [...names]
}

export async function deleteCubeLabDatabases(
  factory: IndexedDbLike | null,
  blockedTimeoutMs: number,
  errors: string[],
  result: Pick<SiteResetStorageResult, 'databasesDeleted' | 'databasesBlocked'>,
): Promise<void> {
  if (!factory) return
  const names = await listCubeLabDatabaseNames(factory, errors)
  const statuses = await Promise.all(
    names.map(async (name) => ({
      name,
      status: await deleteIndexedDbDatabase(factory, name, blockedTimeoutMs),
    })),
  )
  for (const { name, status } of statuses) {
    if (status === 'deleted') {
      result.databasesDeleted.push(name)
    } else if (status === 'blocked') {
      result.databasesBlocked.push(name)
      errors.push(
        `IndexedDB database "${name}" is still open in another CubeLab tab. Close other CubeLab tabs, then retry.`,
      )
    } else {
      errors.push(`IndexedDB database "${name}" could not be deleted.`)
    }
  }
}

export async function deleteCubeLabCaches(
  cacheStorage: CacheStorageLike | null,
  scope: string,
  errors: string[],
  deleted: string[],
): Promise<void> {
  if (!cacheStorage) return
  try {
    const names = await cacheStorage.keys()
    for (const name of names) {
      if (!isCubeLabCacheName(name, scope)) continue
      try {
        if (await cacheStorage.delete(name)) deleted.push(name)
      } catch (error) {
        errors.push(`Cache "${name}" could not be removed: ${errorMessage(error)}`)
      }
    }
  } catch (error) {
    errors.push(`Could not read application caches: ${errorMessage(error)}`)
  }
}

export async function unregisterCubeLabServiceWorkers(
  serviceWorker: ServiceWorkerContainerLike | null,
  scope: string,
  errors: string[],
): Promise<number> {
  if (!serviceWorker) return 0
  let unregistered = 0
  try {
    const registrations = await serviceWorker.getRegistrations()
    for (const registration of registrations) {
      const scripts = [
        registration.active?.scriptURL,
        registration.installing?.scriptURL,
        registration.waiting?.scriptURL,
      ].filter((value): value is string => typeof value === 'string')
      if (
        !scripts.some((scriptURL) =>
          isCubeLabServiceWorkerScript(scriptURL, scope),
        )
      ) {
        continue
      }
      try {
        if (await registration.unregister()) unregistered += 1
      } catch (error) {
        errors.push(
          `CubeLab service worker could not be unregistered: ${errorMessage(error)}`,
        )
      }
    }
  } catch (error) {
    errors.push(`Could not list service workers: ${errorMessage(error)}`)
  }
  return unregistered
}

/** Deletes only cookies explicitly named with a CubeLab prefix. */
export function deleteCubeLabCookies(
  documentLike: CookieDocumentLike | null,
  errors: string[],
): string[] {
  if (!documentLike) return []
  const removed: string[] = []
  try {
    if (!documentLike.cookie) return removed
    for (const part of documentLike.cookie.split(';')) {
      const name = part.split('=')[0]?.trim()
      if (!name || !name.toLowerCase().startsWith('cubelab')) continue
      documentLike.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`
      removed.push(name)
    }
  } catch (error) {
    errors.push(`Could not clear CubeLab cookies: ${errorMessage(error)}`)
  }
  return removed
}

export function createFailedSiteResetResult(
  message: string,
): SiteResetStorageResult {
  return {
    ...emptyResult(),
    ok: false,
    errors: [message],
  }
}

function emptyResult(): SiteResetStorageResult {
  return {
    ok: true,
    localStorageKeysRemoved: [],
    sessionStorageKeysRemoved: [],
    databasesDeleted: [],
    databasesBlocked: [],
    cachesDeleted: [],
    workersUnregistered: 0,
    errors: [],
  }
}

/**
 * Clears all locally owned CubeLab state. The caller is responsible for
 * disabling synchronization, blocking Google authentication, and publishing
 * the cross-tab reset signal first.
 */
export async function resetSiteStorage(
  options: ResetSiteStorageOptions = {},
): Promise<SiteResetStorageResult> {
  beginSiteResetGate()
  const result = emptyResult()
  const localStorageImpl =
    options.localStorage !== undefined
      ? options.localStorage
      : getBrowserStorage('localStorage')
  const sessionStorageImpl =
    options.sessionStorage !== undefined
      ? options.sessionStorage
      : getBrowserStorage('sessionStorage')
  const indexedDbImpl =
    options.indexedDb !== undefined ? options.indexedDb : getBrowserIndexedDb()
  const cacheStorageImpl =
    options.cacheStorage !== undefined
      ? options.cacheStorage
      : getBrowserCaches()
  const serviceWorkerImpl =
    options.serviceWorker !== undefined
      ? options.serviceWorker
      : getBrowserServiceWorker()
  const documentImpl =
    options.document !== undefined ? options.document : getBrowserDocument()
  const scope =
    options.scope ??
    (typeof window !== 'undefined'
      ? applicationScope(window.location.href)
      : '/')

  result.localStorageKeysRemoved = deleteCubeLabStorage(
    localStorageImpl,
    'localStorage',
    result.errors,
  )
  result.sessionStorageKeysRemoved = deleteCubeLabStorage(
    sessionStorageImpl,
    'sessionStorage',
    result.errors,
  )

  await deleteCubeLabDatabases(
    indexedDbImpl,
    options.databaseBlockedTimeoutMs ?? 750,
    result.errors,
    result,
  )
  await deleteCubeLabCaches(
    cacheStorageImpl,
    scope,
    result.errors,
    result.cachesDeleted,
  )
  result.workersUnregistered = await unregisterCubeLabServiceWorkers(
    serviceWorkerImpl,
    scope,
    result.errors,
  )
  deleteCubeLabCookies(documentImpl, result.errors)

  result.ok =
    result.errors.length === 0 && result.databasesBlocked.length === 0
  return result
}

/**
 * Polls a synchronization hook until its current run ends. The transport is
 * already blocked by the caller, so this is a bounded wait for local work to
 * settle before storage is cleared.
 */
export async function waitForSyncIdle(
  isRunning: () => boolean,
  timeoutMs = SYNC_STOP_TIMEOUT_MS,
  pollMs = SYNC_STOP_POLL_MS,
): Promise<boolean> {
  if (!isRunning()) return true
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, pollMs))
    if (!isRunning()) return true
  }
  return !isRunning()
}

function defaultChannelFactory(): SiteResetChannelLike | null {
  if (typeof BroadcastChannel === 'undefined') return null
  try {
    return new BroadcastChannel(
      SITE_RESET_CHANNEL_NAME,
    ) as unknown as SiteResetChannelLike
  } catch {
    return null
  }
}

export function parseSiteResetSignal(value: unknown): SiteResetSignal | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  if (
    record.type !== 'cubelab-site-reset' ||
    (record.phase !== 'begin' &&
      record.phase !== 'complete' &&
      record.phase !== 'failed' &&
      record.phase !== 'abandoned') ||
    typeof record.runId !== 'string' ||
    !record.runId ||
    typeof record.at !== 'number' ||
    !Number.isFinite(record.at)
  ) {
    return null
  }
  return {
    type: 'cubelab-site-reset',
    phase: record.phase,
    runId: record.runId,
    at: record.at,
  }
}

/**
 * Broadcasts to other tabs. The begin signal is also written to localStorage
 * as a secondary marker. Editable CubeLab tabs already require Web Locks, and
 * every browser that ships Web Locks also ships BroadcastChannel, so
 * completion, failure and abandonment are delivered over the channel and do
 * not write a marker that could outlive the reset.
 */
export function publishSiteResetSignal(
  signal: SiteResetSignal,
  options: SiteResetBroadcastOptions = {},
): void {
  const channelFactory = options.channelFactory ?? defaultChannelFactory
  const storage =
    options.storage !== undefined
      ? options.storage
      : getBrowserStorage('localStorage')
  try {
    channelFactory()?.postMessage(signal)
  } catch {
    // Cross-tab notification is best effort; storage cleanup remains safe.
  }
  if (!storage) return
  try {
    if (signal.phase === 'begin') {
      storage.setItem(SITE_RESET_SIGNAL_STORAGE_KEY, JSON.stringify(signal))
    } else {
      // Completion/failure must never leave a CubeLab key behind. Browsers
      // without BroadcastChannel already received the begin marker.
      storage.removeItem(SITE_RESET_SIGNAL_STORAGE_KEY)
    }
  } catch {
    // The reset itself reports storage failures.
  }
}

export function subscribeToSiteReset(
  handler: (signal: SiteResetSignal) => void,
  options: SiteResetSubscribeOptions = {},
): () => void {
  const channelFactory = options.channelFactory ?? defaultChannelFactory
  const target =
    options.target !== undefined ? options.target : typeof window === 'undefined' ? null : window
  const channel = channelFactory()
  if (channel) {
    channel.onmessage = (event) => {
      const signal = parseSiteResetSignal(event.data)
      if (signal) handler(signal)
    }
  }
  const onStorage = (event: Event) => {
    const storageEvent = event as StorageEvent
    if (
      storageEvent.key !== SITE_RESET_SIGNAL_STORAGE_KEY ||
      !storageEvent.newValue
    ) {
      return
    }
    try {
      const signal = parseSiteResetSignal(JSON.parse(storageEvent.newValue))
      if (signal) handler(signal)
    } catch {
      // Ignore malformed cross-tab markers.
    }
  }
  target?.addEventListener('storage', onStorage)
  return () => {
    if (channel) {
      channel.onmessage = null
      channel.close?.()
    }
    target?.removeEventListener('storage', onStorage)
  }
}
