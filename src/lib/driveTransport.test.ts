import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DRIVE_BACKUP_SCOPE,
  DrivePreconditionError,
  createGoogleDriveTransport,
  createMemoryDriveTransport,
  deviceBackupFileName,
  fetchDriveBackupFiles,
  isDriveBackupFileName,
  isDrivePreconditionError,
  type DriveFile,
  type DrivePageResponse,
  type DriveTransport,
} from './driveTransport'
import { deleteAllRemoteBackups } from './remoteBackups'

function file(
  id: string,
  name = deviceBackupFileName(id),
  modifiedTime: string | null = '2026-01-01T00:00:00.000Z',
): DriveFile {
  return { id, name, modifiedTime }
}

function page(
  files: unknown[],
  nextPageToken?: unknown,
  extra: Record<string, unknown> = {},
): DrivePageResponse {
  return {
    ok: true,
    status: 200,
    async json() {
      return {
        files,
        ...(nextPageToken === undefined ? {} : { nextPageToken }),
        ...extra,
      }
    },
  }
}

function failedPage(status: number): DrivePageResponse {
  return {
    ok: false,
    status,
    async json() {
      return {}
    },
  }
}

function pagedReader(pages: DrivePageResponse[]) {
  const tokens: Array<string | undefined> = []
  return {
    tokens,
    read: async (pageToken?: string): Promise<DrivePageResponse> => {
      tokens.push(pageToken)
      if (pageToken === undefined) return pages[0]!
      const index = Number(pageToken.replace('page-', ''))
      const next = pages[index]
      if (!next) throw new Error(`Unexpected page token ${pageToken}`)
      return next
    },
  }
}

describe('Google Drive backup pagination', () => {
  it('reads one page containing fewer than 1,000 files', async () => {
    const reader = pagedReader([page([file('a'), file('b')])])
    const files = await fetchDriveBackupFiles(reader.read)
    expect(files.map((item) => item.id)).toEqual(['a', 'b'])
    expect(reader.tokens).toEqual([undefined])
  })

  it('reads exactly 1,000 files without inventing another page', async () => {
    const pageFiles = Array.from({ length: 1_000 }, (_, index) =>
      file(`file-${index}`),
    )
    const reader = pagedReader([page(pageFiles)])
    const files = await fetchDriveBackupFiles(reader.read)
    expect(files).toHaveLength(1_000)
    expect(reader.tokens).toEqual([undefined])
  })

  it('aggregates multiple pages and finds a snapshot only on the third page', async () => {
    const reader = pagedReader([
      page([file('page-one')], 'page-1'),
      page([file('page-two')], 'page-2'),
      page([file('only-on-third')]),
    ])
    const files = await fetchDriveBackupFiles(reader.read)
    expect(files.map((item) => item.id).sort()).toEqual([
      'only-on-third',
      'page-one',
      'page-two',
    ])
    expect(reader.tokens).toEqual([undefined, 'page-1', 'page-2'])
  })

  it('continues past an empty page that still carries a continuation token', async () => {
    const reader = pagedReader([
      page([], 'page-1'),
      page([file('after-empty')]),
    ])
    const files = await fetchDriveBackupFiles(reader.read)
    expect(files.map((item) => item.id)).toEqual(['after-empty'])
  })

  it('keeps legacy and device-owned snapshots from different pages', async () => {
    const reader = pagedReader([
      page([
        file('legacy', 'cubelab-backup.json', '2026-01-01T00:00:00.000Z'),
        file('not-cubelab', 'notes.json'),
      ], 'page-1'),
      page([
        file('device-a', deviceBackupFileName('device-a'), '2026-02-01T00:00:00.000Z'),
      ]),
    ])
    const files = await fetchDriveBackupFiles(reader.read)
    expect(files.map((item) => item.id)).toEqual(['device-a', 'legacy'])
  })

  it('rejects a malformed page token instead of treating it as the end', async () => {
    await expect(
      fetchDriveBackupFiles(pagedReader([page([file('a')], 42)]).read),
    ).rejects.toThrow(/malformed page token/)
    await expect(
      fetchDriveBackupFiles(pagedReader([page([file('a')], '')]).read),
    ).rejects.toThrow(/malformed page token/)
  })

  it('rejects a repeated continuation token', async () => {
    const reader = pagedReader([
      page([file('a')], 'page-1'),
      page([file('b')], 'page-1'),
    ])
    await expect(fetchDriveBackupFiles(reader.read)).rejects.toThrow(
      /repeated page token/,
    )
  })

  it('propagates a network error on a later page instead of returning a partial list', async () => {
    let calls = 0
    await expect(
      fetchDriveBackupFiles(async () => {
        calls += 1
        if (calls === 1) return page([file('first')], 'page-1')
        throw new Error('Network interrupted.')
      }),
    ).rejects.toThrow('Network interrupted.')
    expect(calls).toBe(2)
  })

  it('rejects malformed list responses and file entries', async () => {
    const invalidJson: DrivePageResponse = {
      ok: true,
      status: 200,
      async json() {
        throw new Error('bad json')
      },
    }
    await expect(fetchDriveBackupFiles(async () => invalidJson)).rejects.toThrow(
      /invalid file list/,
    )

    await expect(
      fetchDriveBackupFiles(async () => ({
        ok: true,
        status: 200,
        async json() {
          return null
        },
      })),
    ).rejects.toThrow(/invalid file list/)

    await expect(
      fetchDriveBackupFiles(async () => ({
        ok: true,
        status: 200,
        async json() {
          return { files: 'not-an-array' }
        },
      })),
    ).rejects.toThrow(/invalid file list/)

    await expect(
      fetchDriveBackupFiles(async () => page([{ name: 'cubelab-backup-a.json' }])),
    ).rejects.toThrow(/without an ID/)

    await expect(
      fetchDriveBackupFiles(async () => page([{ id: 'a' }])),
    ).rejects.toThrow(/without a name/)

    await expect(
      fetchDriveBackupFiles(async () =>
        page([{ id: 'a', name: 'cubelab-backup-a.json', modifiedTime: 123 }]),
      ),
    ).rejects.toThrow(/invalid date/)
  })

  it('surfaces permission, rate-limit, server, and incomplete-search failures', async () => {
    await expect(
      fetchDriveBackupFiles(async () => failedPage(403)),
    ).rejects.toThrow(/permission denied/)
    await expect(
      fetchDriveBackupFiles(async () => failedPage(429)),
    ).rejects.toThrow(/rate limit/)
    await expect(
      fetchDriveBackupFiles(async () => failedPage(503)),
    ).rejects.toThrow(/temporarily unavailable/)
    await expect(
      fetchDriveBackupFiles(async () =>
        page([file('a')], undefined, { incompleteSearch: true }),
      ),
    ).rejects.toThrow(/incomplete file list/)
  })

  it('de-duplicates a file that appears on more than one page', async () => {
    const reader = pagedReader([
      page([file('a')], 'page-1'),
      page([file('a'), file('b')]),
    ])
    const files = await fetchDriveBackupFiles(reader.read)
    expect(files.map((item) => item.id)).toEqual(['a', 'b'])
  })

  it('sorts snapshots newest first after aggregating every page', async () => {
    const reader = pagedReader([
      page([
        file('old', deviceBackupFileName('old'), '2026-01-01T00:00:00.000Z'),
      ], 'page-1'),
      page([
        file('new', deviceBackupFileName('new'), '2026-03-01T00:00:00.000Z'),
      ]),
    ])
    const files = await fetchDriveBackupFiles(reader.read)
    expect(files.map((item) => item.id)).toEqual(['new', 'old'])
  })
})

describe('delete-all with paginated discovery', () => {
  it('deletes every CubeLab snapshot discovered across pages', async () => {
    const legacy = file('legacy', 'cubelab-backup.json')
    const deviceA = file('device-a', deviceBackupFileName('device-a'))
    const deviceB = file('device-b', deviceBackupFileName('device-b'))
    const reader = pagedReader([
      page([legacy], 'page-1'),
      page([deviceA], 'page-2'),
      page([deviceB]),
    ])
    const deleted: string[] = []
    const transport: DriveTransport = {
      configured: true,
      accountLabel: null,
      connect: async () => {},
      disconnect: () => {},
      isConnected: () => true,
      findBackup: async () => null,
      uploadBackup: async () => legacy,
      downloadBackup: async () => '',
      deleteBackup: async (id) => {
        deleted.push(id)
      },
      listBackups: () => fetchDriveBackupFiles(reader.read),
    }

    await expect(deleteAllRemoteBackups(transport)).resolves.toBe(3)
    expect(deleted.sort()).toEqual(['device-a', 'device-b', 'legacy'])
  })
})

describe('Google Identity Services authorization', () => {
  afterEach(() => {
    delete (window as Window & { google?: unknown }).google
    vi.restoreAllMocks()
  })

  it('requests only the Drive app-data scope and never calls userinfo', async () => {
    const initTokenClient = vi.fn(
      (config: {
        scope: string
        callback: (response: { access_token?: string; error?: string }) => void
      }) => {
        config.callback({ access_token: 'access-token' })
        return { requestAccessToken: vi.fn() }
      },
    )
    ;(window as Window & { google?: unknown }).google = {
      accounts: {
        oauth2: {
          initTokenClient,
          revoke: vi.fn(),
        },
      },
    }
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    const transport = createGoogleDriveTransport('client-id')
    await transport.connect()

    expect(initTokenClient).toHaveBeenCalledTimes(1)
    expect(initTokenClient.mock.calls[0]?.[0].scope).toBe(DRIVE_BACKUP_SCOPE)
    expect(initTokenClient.mock.calls[0]?.[0].scope).toBe(
      'https://www.googleapis.com/auth/drive.appdata',
    )
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(transport.accountLabel).toBe('Google Drive connected')
    expect(transport.isConnected()).toBe(true)

    transport.disconnect()
    expect(transport.accountLabel).toBeNull()
    expect(transport.isConnected()).toBe(false)
  })
})

describe('backup file names', () => {
  it('recognizes legacy and sanitized device snapshot names only', () => {
    expect(isDriveBackupFileName('cubelab-backup.json')).toBe(true)
    expect(isDriveBackupFileName(deviceBackupFileName('abc-123'))).toBe(true)
    expect(isDriveBackupFileName('cubelab-backup-.json')).toBe(false)
    expect(isDriveBackupFileName('cubelab-backup-abc.txt')).toBe(false)
    expect(isDriveBackupFileName('notes.json')).toBe(false)
  })

  it('sanitizes unsafe device IDs without producing an empty name', () => {
    expect(deviceBackupFileName('device/with spaces')).toBe(
      'cubelab-backup-device-with-spaces.json',
    )
    expect(deviceBackupFileName('***')).toBe('cubelab-backup-unknown-device.json')
  })
})

function fakeResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body
    },
    async text() {
      return JSON.stringify(body)
    },
  } as Response
}

async function connectedGoogleTransport() {
  const initTokenClient = vi.fn(
    (config: {
      callback: (response: { access_token?: string; error?: string }) => void
    }) => {
      config.callback({ access_token: 'access-token' })
      return { requestAccessToken: vi.fn() }
    },
  )
  ;(window as Window & { google?: unknown }).google = {
    accounts: {
      oauth2: {
        initTokenClient,
        revoke: vi.fn(),
      },
    },
  }
  const transport = createGoogleDriveTransport('client-id')
  await transport.connect()
  return transport
}

describe('legacy mutable backup conditional updates', () => {
  afterEach(() => {
    delete (window as Window & { google?: unknown }).google
    vi.restoreAllMocks()
  })

  it('replaces the legacy file with a v2 ETag and If-Match', async () => {
    const transport = await connectedGoogleTransport()
    const calls: Array<{ url: string; init?: RequestInit }> = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (input, init?: RequestInit) => {
        const url = String(input)
        calls.push({ url, init })
        if (
          url.includes('https://www.googleapis.com/drive/v2/files/file-1?')
        ) {
          return fakeResponse(200, {
            id: 'file-1',
            title: 'cubelab-backup.json',
            modifiedDate: '2026-01-01T00:00:00.000Z',
            etag: '"etag-1"',
          })
        }
        if (
          url.includes(
            'https://www.googleapis.com/upload/drive/v2/files/file-1?uploadType=media',
          )
        ) {
          return fakeResponse(200, {
            id: 'file-1',
            title: 'cubelab-backup.json',
            modifiedDate: '2026-01-01T00:00:01.000Z',
            etag: '"etag-2"',
          })
        }
        throw new Error(`Unexpected fetch ${url}`)
      },
    )

    const result = await transport.uploadBackup('{}', 'file-1', {
      expectedEtag: '"etag-1"',
    })

    expect(calls).toHaveLength(2)
    expect(calls[0]?.init?.method).toBeUndefined()
    expect(calls[1]?.init?.method).toBe('PUT')
    expect(
      (calls[1]?.init?.headers as Record<string, string> | undefined)?.[
        'If-Match'
      ],
    ).toBe('"etag-1"')
    expect(result).toMatchObject({
      id: 'file-1',
      name: 'cubelab-backup.json',
      modifiedTime: '2026-01-01T00:00:01.000Z',
      etag: '"etag-2"',
    })
  })

  it('refuses a stale expected ETag without sending the upload', async () => {
    const transport = await connectedGoogleTransport()
    const methods: Array<string | undefined> = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (_input, init?: RequestInit) => {
        methods.push(init?.method)
        return fakeResponse(200, {
          id: 'file-1',
          title: 'cubelab-backup.json',
          modifiedDate: '2026-01-01T00:00:00.000Z',
          etag: '"etag-2"',
        })
      },
    )

    await expect(
      transport.uploadBackup('{}', 'file-1', { expectedEtag: '"etag-1"' }),
    ).rejects.toBeInstanceOf(DrivePreconditionError)
    expect(methods).toEqual([undefined])
  })

  it('maps a provider 412 to a precondition failure', async () => {
    const transport = await connectedGoogleTransport()
    const methods: Array<string | undefined> = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (input, init?: RequestInit) => {
        methods.push(init?.method)
        const url = String(input)
        if (url.includes('/upload/drive/v2/')) {
          return fakeResponse(412, { error: 'Precondition Failed' })
        }
        return fakeResponse(200, {
          id: 'file-1',
          title: 'cubelab-backup.json',
          modifiedDate: '2026-01-01T00:00:00.000Z',
          etag: '"etag-1"',
        })
      },
    )

    await expect(
      transport.uploadBackup('{}', 'file-1', { expectedEtag: '"etag-1"' }),
    ).rejects.toBeInstanceOf(DrivePreconditionError)
    expect(methods).toEqual([undefined, 'PUT'])
  })

  it('fails closed when Drive returns no ETag for the mutable file', async () => {
    const transport = await connectedGoogleTransport()
    const methods: Array<string | undefined> = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (_input, init?: RequestInit) => {
        methods.push(init?.method)
        return fakeResponse(200, {
          id: 'file-1',
          title: 'cubelab-backup.json',
          modifiedDate: '2026-01-01T00:00:00.000Z',
        })
      },
    )

    await expect(
      transport.uploadBackup('{}', 'file-1', { expectedEtag: null }),
    ).rejects.toBeInstanceOf(DrivePreconditionError)
    expect(methods).toEqual([undefined])
  })

  it('recognizes precondition failures across the error shape', () => {
    expect(isDrivePreconditionError(new DrivePreconditionError())).toBe(true)
    expect(
      isDrivePreconditionError(
        Object.assign(new Error('changed'), {
          code: 'drive-precondition-failed',
        }),
      ),
    ).toBe(true)
    expect(isDrivePreconditionError(new Error('other failure'))).toBe(false)
  })

  it('enforces the expected ETag in the in-memory transport', async () => {
    const memory = createMemoryDriveTransport()
    await memory.connect()
    const first = await memory.uploadBackup('one', null)
    expect(first.etag).toBeTruthy()

    await expect(
      memory.uploadBackup('two', first.id, { expectedEtag: '"stale"' }),
    ).rejects.toBeInstanceOf(DrivePreconditionError)
    expect(await memory.downloadBackup(first.id)).toBe('one')

    const second = await memory.uploadBackup('two', first.id, {
      expectedEtag: first.etag,
    })
    expect(second.etag).not.toBe(first.etag)
    expect(await memory.downloadBackup(first.id)).toBe('two')
  })
})
