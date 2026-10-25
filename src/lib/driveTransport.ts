export interface DriveFile {
  id: string
  name: string
  modifiedTime: string | null
}

export interface DriveTransport {
  configured: boolean
  accountLabel: string | null
  __corruptRemote?(): void
  connect(): Promise<void>
  disconnect(): void
  isConnected(): boolean
  findBackup(): Promise<DriveFile | null>
  uploadBackup(content: string, existingFileId?: string | null): Promise<DriveFile>
  downloadBackup(fileId: string): Promise<string>
  deleteBackup(fileId: string): Promise<void>
  /**
   * Per-device synchronization snapshots. Legacy transports may omit these;
   * callers fall back to findBackup/uploadBackup.
   */
  listBackups?(): Promise<DriveFile[]>
  uploadDeviceBackup?(
    content: string,
    deviceId: string,
    existingFileId?: string | null,
  ): Promise<DriveFile>
}

export const DRIVE_BACKUP_FILE_NAME = 'cubelab-backup.json'
export const DRIVE_BACKUP_FILE_PREFIX = 'cubelab-backup'
export const DRIVE_BACKUP_SCOPE = 'https://www.googleapis.com/auth/drive.appdata'

/** Sanitizes a device ID for use in a Drive file name. */
export function deviceBackupFileName(deviceId: string): string {
  const safe =
    deviceId
      .replace(/[^A-Za-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'unknown-device'
  return `${DRIVE_BACKUP_FILE_PREFIX}-${safe}.json`
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
        scope: `${DRIVE_BACKUP_SCOPE} openid email https://www.googleapis.com/auth/userinfo.email`,
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
    const params = new URLSearchParams({
      spaces: 'appDataFolder',
      q: "trashed=false",
      fields: 'files(id,name,modifiedTime)',
      pageSize: '1000',
    })
    const response = await apiFetch(
      `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
    )
    if (!response.ok) throw new Error('Could not read Google Drive app data.')
    const data = (await response.json()) as { files?: DriveFile[] }
    return (data.files ?? [])
      .filter((file) => isDriveBackupFileName(file.name))
      .sort(
        (left, right) =>
          (right.modifiedTime ?? '').localeCompare(left.modifiedTime ?? '') ||
          left.name.localeCompare(right.name) ||
          left.id.localeCompare(right.id),
      )
  }

  async function writeFile(
    content: string,
    name: string,
    existingFileId?: string | null,
  ): Promise<DriveFile> {
    if (existingFileId) {
      const response = await apiFetch(
        `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(
          existingFileId,
        )}?uploadType=media`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: content,
        },
      )
      if (!response.ok) {
        const text = await response.text()
        throw new Error(text || 'Google Drive upload failed.')
      }
      const result = (await response.json()) as DriveFile
      return { ...result, name: result.name || name }
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
    return refreshed ?? { ...result, name: result.name || name }
  }

  return {
    configured,
    get accountLabel() {
      return accountLabel
    },
    async connect() {
      await ensureToken('consent')
      try {
        const response = await fetch(
          'https://www.googleapis.com/oauth2/v3/userinfo',
          { headers: { Authorization: `Bearer ${accessToken}` } },
        )
        if (response.ok) {
          const data = (await response.json()) as { email?: string; name?: string }
          accountLabel = data.email || data.name || 'Google account connected'
        } else {
          accountLabel = 'Google account connected'
        }
      } catch {
        accountLabel = 'Google account connected'
      }
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
    async uploadBackup(content, existingFileId) {
      // Manual/legacy callers keep the fixed compatibility name.
      return writeFile(content, DRIVE_BACKUP_FILE_NAME, existingFileId)
    },
    async uploadDeviceBackup(content, deviceId, existingFileId) {
      const name = deviceBackupFileName(deviceId)
      if (existingFileId) return writeFile(content, name, existingFileId)
      const existing = (await listBackupFiles()).find((file) => file.name === name)
      return writeFile(content, name, existing?.id)
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
  }
  const files = new Map<string, MemoryFile>()
  let nextFileNumber = 1

  const publicFile = (file: MemoryFile): DriveFile => ({
    id: file.id,
    name: file.name,
    modifiedTime: file.modifiedTime,
  })

  const sortedFiles = () =>
    [...files.values()].sort(
      (left, right) =>
        right.modifiedTime.localeCompare(left.modifiedTime) ||
        left.name.localeCompare(right.name) ||
        left.id.localeCompare(right.id),
    )

  function writeFile(content: string, name: string, existingFileId?: string | null): DriveFile {
    const modifiedTime = new Date().toISOString()
    if (existingFileId) {
      const existing = files.get(existingFileId)
      if (existing) {
        const next = { ...existing, name, modifiedTime, content }
        files.set(existingFileId, next)
        return publicFile(next)
      }
    }
    const byName = [...files.values()].find((file) => file.name === name)
    if (byName) {
      const next = { ...byName, modifiedTime, content }
      files.set(byName.id, next)
      return publicFile(next)
    }
    const id = `drive-file-${nextFileNumber}`
    nextFileNumber += 1
    const next: MemoryFile = { id, name, modifiedTime, content }
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
    async uploadBackup(content) {
      if (!connected) throw new Error('Connect Google Drive first.')
      const existing = [...files.values()].find(
        (file) => file.name === DRIVE_BACKUP_FILE_NAME,
      )
      return writeFile(content, DRIVE_BACKUP_FILE_NAME, existing?.id)
    },
    async uploadDeviceBackup(content, deviceId) {
      if (!connected) throw new Error('Connect Google Drive first.')
      return writeFile(content, deviceBackupFileName(deviceId))
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