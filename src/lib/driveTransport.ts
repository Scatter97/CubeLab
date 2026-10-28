export interface DriveFile {
  id: string
  name: string
  modifiedTime: string | null
  /**
   * Provider ETag for the file's metadata. Google Drive v3 no longer exposes
   * ETags, so the legacy mutable file's ETag is read through v2. Immutable
   * per-device snapshots do not need one.
   */
  etag?: string | null
}

export interface DriveUploadOptions {
  /**
   * ETag observed before the merge. Google Drive v2 checks it server-side with
   * `If-Match`; a stale value is rejected with HTTP 412. When the provider does
   * not return an ETag the legacy update fails closed instead of overwriting a
   * concurrent write.
   */
  expectedEtag?: string | null
}

/**
 * A conditional write was refused because the mutable backup changed, or
 * because the provider could not supply an ETag to verify it. Callers must
 * re-read and merge instead of retrying the same content blindly.
 */
export class DrivePreconditionError extends Error {
  readonly code = 'drive-precondition-failed'

  constructor(
    message = 'The Google Drive backup changed before this write. CubeLab did not overwrite it.',
  ) {
    super(message)
    this.name = 'DrivePreconditionError'
  }
}

export function isDrivePreconditionError(
  value: unknown,
): value is DrivePreconditionError {
  return (
    value instanceof DrivePreconditionError ||
    (value instanceof Error &&
      (value as Error & { code?: unknown }).code ===
        'drive-precondition-failed')
  )
}

export interface DriveTransport {
  configured: boolean
  accountLabel: string | null
  __corruptRemote?(): void
  connect(): Promise<void>
  disconnect(): void
  isConnected(): boolean
  findBackup(): Promise<DriveFile | null>
  uploadBackup(
    content: string,
    existingFileId?: string | null,
    options?: DriveUploadOptions,
  ): Promise<DriveFile>
  downloadBackup(fileId: string): Promise<string>
  deleteBackup(fileId: string): Promise<void>
  /**
   * Per-device synchronization snapshots. Legacy transports may omit these;
   * callers fall back to findBackup/uploadBackup.
   *
   * Each call creates a **new immutable snapshot** with a unique name. A
   * writer never overwrites an existing file, so two writers sharing a device
   * ID (for example a copied browser profile) cannot destroy each other's
   * unique solves; every snapshot stays discoverable and is merged by the next
   * synchronization run.
   */
  listBackups?(): Promise<DriveFile[]>
  uploadDeviceBackup?(content: string, deviceId: string): Promise<DriveFile>
}

export const DRIVE_BACKUP_FILE_NAME = 'cubelab-backup.json'
export const DRIVE_BACKUP_FILE_PREFIX = 'cubelab-backup'
export const DRIVE_BACKUP_SCOPE = 'https://www.googleapis.com/auth/drive.appdata'
export const DRIVE_LIST_PAGE_SIZE = 1000

/** The subset of a Drive file-list HTTP response needed by pagination. */
export interface DrivePageResponse {
  ok: boolean
  status: number
  json(): Promise<unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function drivePageError(status: number): Error {
  if (status === 401) {
    return new Error('Google authorization expired. Connect again and retry.')
  }
  if (status === 403) {
    return new Error('Google Drive permission denied while listing backups.')
  }
  if (status === 429) {
    return new Error(
      'Google Drive rate limit reached while listing backups. Try again later.',
    )
  }
  if (status >= 500) {
    return new Error(
      `Google Drive is temporarily unavailable while listing backups (status ${status}).`,
    )
  }
  return new Error(`Could not read Google Drive app data (status ${status}).`)
}

function parseDriveFile(value: unknown): DriveFile {
  if (!isRecord(value)) {
    throw new Error('Google Drive returned an invalid file entry.')
  }
  if (typeof value.id !== 'string' || value.id.length === 0) {
    throw new Error('Google Drive returned a file entry without an ID.')
  }
  if (typeof value.name !== 'string' || value.name.length === 0) {
    throw new Error('Google Drive returned a file entry without a name.')
  }
  if (
    value.modifiedTime !== undefined &&
    value.modifiedTime !== null &&
    typeof value.modifiedTime !== 'string'
  ) {
    throw new Error('Google Drive returned a file entry with an invalid date.')
  }
  if (
    value.etag !== undefined &&
    value.etag !== null &&
    typeof value.etag !== 'string'
  ) {
    throw new Error('Google Drive returned a file entry with an invalid ETag.')
  }
  return {
    id: value.id,
    name: value.name,
    modifiedTime: (value.modifiedTime as string | null | undefined) ?? null,
    etag: (value.etag as string | null | undefined) ?? null,
  }
}

/**
 * Reads every page of the app-data file list before filtering. Returning a
 * partial list would let synchronization silently miss another device snapshot,
 * so any failed page, malformed token, or repeated token is an explicit error.
 */
export async function fetchDriveBackupFiles(
  requestPage: (pageToken?: string) => Promise<DrivePageResponse>,
): Promise<DriveFile[]> {
  const files: DriveFile[] = []
  const seenIds = new Set<string>()
  const seenTokens = new Set<string>()
  let pageToken: string | undefined

  for (;;) {
    const response = await requestPage(pageToken)
    if (!response.ok) throw drivePageError(response.status)

    let data: unknown
    try {
      data = await response.json()
    } catch {
      throw new Error('Google Drive returned an invalid file list.')
    }
    if (!isRecord(data)) {
      throw new Error('Google Drive returned an invalid file list.')
    }
    if (data.incompleteSearch === true) {
      throw new Error(
        'Google Drive reported an incomplete file list. Synchronization stopped so no backup snapshot is missed.',
      )
    }
    const pageFiles = data.files ?? []
    if (!Array.isArray(pageFiles)) {
      throw new Error('Google Drive returned an invalid file list.')
    }
    for (const candidate of pageFiles) {
      const file = parseDriveFile(candidate)
      // A concurrent change can theoretically surface the same file on two
      // pages. Keep one identity so callers do not download or delete twice.
      if (seenIds.has(file.id)) continue
      seenIds.add(file.id)
      files.push(file)
    }

    const nextToken = data.nextPageToken
    if (nextToken === undefined || nextToken === null) break
    if (typeof nextToken !== 'string' || nextToken.length === 0) {
      throw new Error('Google Drive returned a malformed page token.')
    }
    if (seenTokens.has(nextToken)) {
      throw new Error(
        'Google Drive returned a repeated page token. Synchronization stopped to avoid an incomplete backup list.',
      )
    }
    seenTokens.add(nextToken)
    pageToken = nextToken
  }

  return files
    .filter((file) => isDriveBackupFileName(file.name))
    .sort(
      (left, right) =>
        (right.modifiedTime ?? '').localeCompare(left.modifiedTime ?? '') ||
        left.name.localeCompare(right.name) ||
        left.id.localeCompare(right.id),
    )
}

/** Sanitizes a device ID for use in a Drive file name. */
export function sanitizeDeviceId(deviceId: string): string {
  return (
    deviceId
      .replace(/[^A-Za-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'unknown-device'
  )
}

/**
 * The legacy mutable per-device snapshot name. Readers still discover and
 * merge files with this name, but new writes go to uniquely named immutable
 * snapshots instead of replacing it.
 */
export function deviceBackupFileName(deviceId: string): string {
  return `${DRIVE_BACKUP_FILE_PREFIX}-${sanitizeDeviceId(deviceId)}.json`
}

function snapshotUniqueToken(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`
  }
}

/**
 * A unique, immutable snapshot name for one write from one device. Because the
 * name is never reused, two concurrent writers sharing a device ID both keep
 * their files. No conditional write is needed for an immutable create; the
 * legacy mutable fixed-name file is the only path that uses an ETag/If-Match
 * precondition.
 */
export function deviceSnapshotFileName(deviceId: string): string {
  return `${DRIVE_BACKUP_FILE_PREFIX}-${sanitizeDeviceId(deviceId)}-${snapshotUniqueToken()}.json`
}

export function isDriveBackupFileName(name: string): boolean {
  if (name === DRIVE_BACKUP_FILE_NAME) return true
  return new RegExp(`^${DRIVE_BACKUP_FILE_PREFIX}-[A-Za-z0-9_-]+\\.json$`).test(name)
}

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            client_id: string
            scope: string
            callback: (response: { access_token?: string; error?: string }) => void
            error_callback?: (error: { type: string; message?: string }) => void
          }) => { requestAccessToken: (options?: { prompt?: string }) => void }
          revoke: (token: string, callback?: () => void) => void
        }
      }
    }
  }
}

export function createGoogleDriveTransport(
  clientId: string | undefined,
): DriveTransport {
  let accessToken: string | null = null
  let tokenExpiresAt = 0
  let accountLabel: string | null = null

  const configured = Boolean(clientId)

  async function loadGoogleIdentityServices(): Promise<void> {
    if (window.google?.accounts?.oauth2) return
    await new Promise<void>((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>(
        'script[data-cubelab-gis="true"]',
      )
      if (existing) {
        existing.addEventListener('load', () => resolve(), { once: true })
        existing.addEventListener('error', () => reject(new Error('Could not load Google Identity Services.')), {
          once: true,
        })
        return
      }
      const script = document.createElement('script')
      script.src = 'https://accounts.google.com/gsi/client'
      script.async = true
      script.defer = true
      script.dataset.cubelabGis = 'true'
      script.addEventListener('load', () => resolve(), { once: true })
      script.addEventListener('error', () => reject(new Error('Could not load Google Identity Services.')), {
        once: true,
      })
      document.head.appendChild(script)
    })
  }

  function isTokenValid(): boolean {
    return Boolean(accessToken && Date.now() < tokenExpiresAt - 30_000)
  }

  async function ensureToken(prompt = ''): Promise<string> {
    if (isTokenValid() && accessToken) return accessToken
    if (!clientId) throw new Error('Google Drive is not configured for this build.')

    await loadGoogleIdentityServices()
    const gis = window.google?.accounts?.oauth2
    if (!gis) throw new Error('Google Identity Services is unavailable.')

    return new Promise<string>((resolve, reject) => {
      const client = gis.initTokenClient({
        client_id: clientId,
        // App-data scope only. CubeLab deliberately does not request email,
        // profile, openid, or any other identity scope.
        scope: DRIVE_BACKUP_SCOPE,
        callback: (response) => {
          if (response.error || !response.access_token) {
            reject(new Error(response.error || 'Google sign-in was cancelled.'))
            return
          }
          accessToken = response.access_token
          tokenExpiresAt = Date.now() + 55 * 60 * 1000
          resolve(response.access_token)
        },
        error_callback: (error) => {
          reject(new Error(error.message || error.type || 'Google sign-in failed.'))
        },
      })
      client.requestAccessToken({ prompt })
    })
  }

  async function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
    const token = await ensureToken()
    const response = await fetch(url, {
      ...init,
      headers: {
        ...(init.headers || {}),
        Authorization: `Bearer ${token}`,
      },
    })
    if (response.status === 401) {
      accessToken = null
      tokenExpiresAt = 0
      throw new Error('Google authorization expired. Connect again and retry.')
    }
    return response
  }

  async function listBackupFiles(): Promise<DriveFile[]> {
    const files = await fetchDriveBackupFiles((pageToken) => {
      const params = new URLSearchParams({
        spaces: 'appDataFolder',
        q: 'trashed=false',
        // `nextPageToken` and `incompleteSearch` are top-level response fields.
        // Omitting them from `fields` makes pagination silently impossible.
        fields: 'nextPageToken,incompleteSearch,files(id,name,modifiedTime)',
        pageSize: String(DRIVE_LIST_PAGE_SIZE),
      })
      if (pageToken) params.set('pageToken', pageToken)
      return apiFetch(
        `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
      )
    })

    // Drive v3 does not expose ETags. The legacy fixed-name file is the only
    // mutable file, so read its v2 ETag once per listing. A failure here must
    // not break reads; the conditional write path re-reads the ETag and fails
    // closed if it still cannot verify the precondition.
    const legacy = files.find((file) => file.name === DRIVE_BACKUP_FILE_NAME)
    if (!legacy) return files
    try {
      const metadata = await readV2FileMetadata(legacy.id)
      const etag =
        metadata && typeof metadata.etag === 'string' ? metadata.etag : null
      return files.map((file) =>
        file.id === legacy.id ? { ...file, etag } : file,
      )
    } catch {
      return files
    }
  }

  async function readV2FileMetadata(
    fileId: string,
  ): Promise<Record<string, unknown> | null> {
    const response = await apiFetch(
      `https://www.googleapis.com/drive/v2/files/${encodeURIComponent(
        fileId,
      )}?fields=etag,id,title,modifiedDate`,
    )
    if (response.status === 404) return null
    if (!response.ok) {
      throw new Error(
        `Could not read Google Drive file metadata (status ${response.status}).`,
      )
    }
    const data: unknown = await response.json()
    if (!isRecord(data)) {
      throw new Error('Google Drive returned invalid file metadata.')
    }
    return data
  }

  function v2DriveFile(
    data: Record<string, unknown>,
    fileId: string,
    fallbackName: string,
    fallbackEtag: string | null,
  ): DriveFile {
    return {
      id: typeof data.id === 'string' && data.id ? data.id : fileId,
      name:
        typeof data.title === 'string' && data.title
          ? data.title
          : typeof data.name === 'string' && data.name
            ? data.name
            : fallbackName,
      modifiedTime:
        typeof data.modifiedDate === 'string'
          ? data.modifiedDate
          : typeof data.modifiedTime === 'string'
            ? data.modifiedTime
            : null,
      etag:
        typeof data.etag === 'string' && data.etag
          ? data.etag
          : fallbackEtag,
    }
  }

  async function writeFile(
    content: string,
    name: string,
    existingFileId?: string | null,
    options: DriveUploadOptions = {},
  ): Promise<DriveFile> {
    if (existingFileId) {
      // Drive v3 dropped ETags; v2 still exposes one and honours If-Match on
      // the media update. Read the metadata ETag, verify the caller's expected
      // value, then send the same ETag so the provider rejects a write that
      // raced us (HTTP 412) instead of overwriting it.
      const metadata = await readV2FileMetadata(existingFileId)
      if (metadata) {
        const currentEtag =
          typeof metadata.etag === 'string' && metadata.etag.length > 0
            ? metadata.etag
            : null
        if (!currentEtag) {
          throw new DrivePreconditionError(
            'Google Drive did not provide an ETag for the mutable backup, so CubeLab refused to overwrite it. Try again later.',
          )
        }
        if (
          options.expectedEtag !== undefined &&
          options.expectedEtag !== null &&
          options.expectedEtag !== currentEtag
        ) {
          throw new DrivePreconditionError(
            'Another CubeLab writer changed the Google Drive backup before this upload. CubeLab did not overwrite it.',
          )
        }
        const response = await apiFetch(
          `https://www.googleapis.com/upload/drive/v2/files/${encodeURIComponent(
            existingFileId,
          )}?uploadType=media`,
          {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'If-Match': currentEtag,
            },
            body: content,
          },
        )
        if (response.status === 412) {
          throw new DrivePreconditionError(
            'The Google Drive backup changed while CubeLab was uploading. CubeLab did not overwrite the newer version.',
          )
        }
        if (!response.ok) {
          const text = await response.text()
          throw new Error(text || 'Google Drive upload failed.')
        }
        const result: unknown = await response.json()
        if (!isRecord(result)) {
          throw new Error('Google Drive returned an invalid upload result.')
        }
        return v2DriveFile(result, existingFileId, name, currentEtag)
      }
      // A 404 means the mutable file was deleted. Creating a fresh file cannot
      // overwrite anything, so fall through to the normal create path.
    }

    const metadata = {
      name,
      parents: ['appDataFolder'],
      appProperties: {
        app: 'CubeLab',
        format: 'cubelab-backup',
        backupVersion: 1,
      },
    }
    const boundary = `cubelab-${crypto.randomUUID()}`
    const body =
      `--${boundary}\r\n` +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\n` +
      'Content-Type: application/json\r\n\r\n' +
      `${content}\r\n` +
      `--${boundary}--`
    const response = await apiFetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
      {
        method: 'POST',
        headers: {
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body,
      },
    )
    if (!response.ok) {
      const text = await response.text()
      throw new Error(text || 'Google Drive upload failed.')
    }
    const result = (await response.json()) as DriveFile
    const refreshed = (await listBackupFiles()).find((file) => file.id === result.id)
    return refreshed ?? { ...result, name: result.name || name, etag: null }
  }

  return {
    configured,
    get accountLabel() {
      return accountLabel
    },
    async connect() {
      await ensureToken('consent')
      // No identity-network call: app-data access does not reveal the account
      // email, and requesting it would broaden consent unnecessarily.
      accountLabel = 'Google Drive connected'
    },
    disconnect() {
      if (accessToken && window.google?.accounts?.oauth2) {
        window.google.accounts.oauth2.revoke(accessToken)
      }
      accessToken = null
      tokenExpiresAt = 0
      accountLabel = null
    },
    isConnected() {
      return isTokenValid()
    },
    async findBackup() {
      return (await listBackupFiles())[0] ?? null
    },
    listBackups: listBackupFiles,
    async uploadBackup(content, existingFileId, options) {
      // Manual/legacy callers keep the fixed compatibility name. Existing
      // files are replaced only through the v2 ETag/If-Match check.
      return writeFile(
        content,
        DRIVE_BACKUP_FILE_NAME,
        existingFileId,
        options,
      )
    },
    async uploadDeviceBackup(content, deviceId) {
      // Immutable snapshot: a fresh unique name per write. Never overwrite an
      // existing file, so a concurrent writer sharing this device ID cannot
      // lose its unique data to this upload.
      return writeFile(content, deviceSnapshotFileName(deviceId), null)
    },
    async downloadBackup(fileId) {
      const response = await apiFetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
      )
      if (!response.ok) throw new Error('Could not download the Google Drive backup.')
      return response.text()
    },
    async deleteBackup(fileId) {
      const response = await apiFetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`,
        { method: 'DELETE' },
      )
      if (!response.ok && response.status !== 404) {
        throw new Error('Could not delete the Google Drive backup.')
      }
    },
  }
}

export function createMemoryDriveTransport(
  accountLabel = 'Google Drive (mock)',
): DriveTransport {
  let connected = false
  const currentAccountLabel: string | null = accountLabel
  interface MemoryFile {
    id: string
    name: string
    modifiedTime: string
    content: string
    etag: string
  }
  const files = new Map<string, MemoryFile>()
  let nextFileNumber = 1
  let nextEtagNumber = 1
  let lastModifiedMs = 0

  // Two rapid writes in the same millisecond must still look different to the
  // optimistic write check. Real Drive also advances the modification time.
  const nextModifiedTime = () => {
    lastModifiedMs = Math.max(Date.now(), lastModifiedMs + 1)
    return new Date(lastModifiedMs).toISOString()
  }
  const nextEtag = () => {
    const etag = `"cubelab-etag-${nextEtagNumber}"`
    nextEtagNumber += 1
    return etag
  }

  const publicFile = (file: MemoryFile): DriveFile => ({
    id: file.id,
    name: file.name,
    modifiedTime: file.modifiedTime,
    etag: file.etag,
  })

  const sortedFiles = () =>
    [...files.values()].sort(
      (left, right) =>
        right.modifiedTime.localeCompare(left.modifiedTime) ||
        left.name.localeCompare(right.name) ||
        left.id.localeCompare(right.id),
    )

  function writeFile(
    content: string,
    name: string,
    existingFileId?: string | null,
    options: DriveUploadOptions = {},
  ): DriveFile {
    const modifiedTime = nextModifiedTime()
    if (existingFileId) {
      const existing = files.get(existingFileId)
      if (existing) {
        if (
          options.expectedEtag !== undefined &&
          options.expectedEtag !== null &&
          options.expectedEtag !== existing.etag
        ) {
          throw new DrivePreconditionError(
            'Another CubeLab writer changed the Google Drive backup before this upload. CubeLab did not overwrite it.',
          )
        }
        const next = {
          ...existing,
          name,
          modifiedTime,
          content,
          etag: nextEtag(),
        }
        files.set(existingFileId, next)
        return publicFile(next)
      }
    }
    const byName = [...files.values()].find((file) => file.name === name)
    if (byName) {
      const next = {
        ...byName,
        modifiedTime,
        content,
        etag: nextEtag(),
      }
      files.set(byName.id, next)
      return publicFile(next)
    }
    const id = `drive-file-${nextFileNumber}`
    nextFileNumber += 1
    const next: MemoryFile = {
      id,
      name,
      modifiedTime,
      content,
      etag: nextEtag(),
    }
    files.set(id, next)
    return publicFile(next)
  }

  return {
    configured: true,
    get accountLabel() {
      return connected ? currentAccountLabel : null
    },
    async connect() {
      connected = true
    },
    disconnect() {
      connected = false
    },
    isConnected() {
      return connected
    },
    async findBackup() {
      if (!connected) throw new Error('Connect Google Drive first.')
      const newest = sortedFiles()[0]
      return newest ? publicFile(newest) : null
    },
    async listBackups() {
      if (!connected) throw new Error('Connect Google Drive first.')
      return sortedFiles().map(publicFile)
    },
    async uploadBackup(content, existingFileId, options) {
      if (!connected) throw new Error('Connect Google Drive first.')
      const existing = [...files.values()].find(
        (file) => file.name === DRIVE_BACKUP_FILE_NAME,
      )
      return writeFile(
        content,
        DRIVE_BACKUP_FILE_NAME,
        existingFileId ?? existing?.id,
        options,
      )
    },
    async uploadDeviceBackup(content, deviceId) {
      if (!connected) throw new Error('Connect Google Drive first.')
      // Immutable snapshot with a unique name: each upload adds a file instead
      // of replacing the device's previous snapshot, so a stale or concurrent
      // writer can never overwrite another writer's unique data.
      return writeFile(content, deviceSnapshotFileName(deviceId))
    },
    async downloadBackup(fileId) {
      if (!connected) throw new Error('Connect Google Drive first.')
      const file = files.get(fileId)
      if (!file) throw new Error('No Google Drive backup was found.')
      return file.content
    },
    async deleteBackup(fileId) {
      if (!connected) throw new Error('Connect Google Drive first.')
      files.delete(fileId)
    },
    __corruptRemote() {
      for (const [id, file] of files) {
        files.set(id, { ...file, content: '{not valid json' })
      }
    },
  }
}

export function createDriveTransport(): DriveTransport | null {
  if (import.meta.env.VITE_DRIVE_MOCK === 'true') {
    const transport = createMemoryDriveTransport()
    if (typeof window !== 'undefined') {
      ;(window as { __cubeLabMockDrive?: DriveTransport }).__cubeLabMockDrive = transport
    }
    return transport
  }
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
  if (!clientId) return null
  return createGoogleDriveTransport(clientId)
}