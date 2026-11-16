import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { simulateLegacyConcurrentTabs } from './legacy-tabs'

// The reset must be exercised from a genuinely empty browser profile, then
// seeded with a returning-user state so onboarding suppression is realistic.
test.use({ storageState: { cookies: [], origins: [] } })

const WELCOME = { name: 'Welcome to CubeLab' }
const RESET_PROGRESS = 'site-reset-progress'

const EMPTY_TRAINING = {
  version: 1,
  preferences: {
    version: 1,
    selectedSetId: 'oll',
    sets: {
      oll: {
        enabledCaseIds: [],
        difficultCaseIds: [],
        includeSetupMoves: false,
        selectedPresetId: null,
        recognition: { renewalDays: 7, renewalAttempts: 100 },
      },
      pll: {
        enabledCaseIds: [],
        difficultCaseIds: [],
        includeSetupMoves: false,
        selectedPresetId: null,
        recognition: { renewalDays: 7, renewalAttempts: 100 },
      },
    },
    preferredAlgorithms: [],
    categories: {
      'oll:execution': { recognitionMetric: 'raw' },
      'oll:recognition': { recognitionMetric: 'raw' },
      'pll:execution': { recognitionMetric: 'raw' },
      'pll:recognition': { recognitionMetric: 'raw' },
    },
    reportSettings: {},
  },
  recognitionCounts: { oll: 0, pll: 0 },
  attempts: [],
  visits: [],
  presets: [],
  customAlgorithms: [],
  calibrations: [],
  activeVisitId: null,
}

async function seedReturningUser(page: Page) {
  await page.addInitScript((training) => {
    // A plain marker survives the reset and prevents the init script from
    // re-seeding the data during the post-reset reload.
    if (localStorage.getItem('e2e-site-reset-seeded') === '1') return
    localStorage.setItem('e2e-site-reset-seeded', '1')

    const now = Date.now()
    localStorage.setItem(
      'cubelab:sessions:v1',
      JSON.stringify({
        version: 6,
        activeSessionId: 'reset-session',
        sessions: [
          {
            id: 'reset-session',
            name: 'Reset me',
            event: '333',
            createdAt: now - 120_000,
            updatedAt: now,
            solves: [
              {
                id: 'reset-solve',
                event: '333',
                rawMs: 12_345,
                penalty: 'none',
                scramble: "R U R' U'",
                comment: 'seeded solve',
                createdAt: now - 30_000,
              },
            ],
          },
        ],
      }),
    )
    localStorage.setItem(
      'cubelab:settings:v1',
      JSON.stringify({
        version: 11,
        settings: { inspectionEnabled: false, theme: 'dark' },
      }),
    )
    localStorage.setItem(
      'cubelab:onboarding:v1',
      JSON.stringify({
        version: 1,
        decision: { status: 'completed', at: now - 60_000 },
      }),
    )
    localStorage.setItem('cubelab:training:v1', JSON.stringify(training))
    localStorage.setItem(
      'cubelab:sync:v1',
      JSON.stringify({
        version: 1,
        preferences: { enabled: false },
        runtime: { deviceId: 'e2e-seed-device' },
      }),
    )
    localStorage.setItem(
      'cubelab:drive:v1',
      JSON.stringify({
        version: 1,
        remoteFileId: 'seeded-remote-file',
        remoteModifiedTime: '2026-01-01T00:00:00.000Z',
        lastBackupAt: now - 120_000,
        lastRestoreAt: null,
        connectedAccountLabel: 'Seeded account',
      }),
    )
    localStorage.setItem('other-app:keep', 'keep-local')
    sessionStorage.setItem('cubelab:e2e-session-marker', 'remove-me')
    sessionStorage.setItem('other-app:keep', 'keep-session')
  }, EMPTY_TRAINING)
}

async function waitForApp(page: Page) {
  await expect(page.getByTestId('timer-surface')).toBeVisible({
    timeout: 20_000,
  })
}

async function openDeveloper(page: Page) {
  await page.getByTestId('settings-button').click()
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await expect(settings).toBeVisible()
  await settings.getByText('Developer options').click()
  await expect(settings.getByTestId('settings-developer')).toHaveAttribute(
    'open',
    '',
  )
  return settings
}

async function requestSiteReset(page: Page) {
  const settings = await openDeveloper(page)
  await expect(settings.getByTestId('settings-reset-site-zone')).toContainText(
    'Permanently delete all local CubeLab data, caches, settings, and authentication state. Restart as a new user.',
  )
  await settings.getByTestId('settings-reset-all-site-data').click()
  await expect(settings).toBeHidden()
  const dialog = page.getByRole('dialog', { name: 'Reset all site data?' })
  await expect(dialog).toBeVisible()
  return dialog
}

async function confirmSiteReset(page: Page) {
  const dialog = await requestSiteReset(page)
  await dialog.getByTestId('confirm-text').fill('RESET')
  await expect(
    dialog.getByRole('button', { name: 'Reset All Data' }),
  ).toBeEnabled()
  await dialog.getByRole('button', { name: 'Reset All Data' }).click()
  await expect(dialog).toBeHidden()
}

async function readLocalState(page: Page) {
  return page.evaluate(async () => {
    const parse = (key: string) => {
      const raw = localStorage.getItem(key)
      return raw === null ? null : JSON.parse(raw)
    }
    const databases =
      typeof indexedDB.databases === 'function'
        ? (await indexedDB.databases()).map((database) => database.name ?? '')
        : []
    return {
      sessions: parse('cubelab:sessions:v1'),
      settings: parse('cubelab:settings:v1'),
      onboarding: parse('cubelab:onboarding:v1'),
      training: localStorage.getItem('cubelab:training:v1'),
      drive: localStorage.getItem('cubelab:drive:v1'),
      sync: localStorage.getItem('cubelab:sync:v1'),
      localOther: localStorage.getItem('other-app:keep'),
      sessionOther: sessionStorage.getItem('other-app:keep'),
      sessionMarker: sessionStorage.getItem('cubelab:e2e-session-marker'),
      databases,
      cubeLabCache: await caches.has('cubelab-e2e-cache'),
      unrelatedCache: await caches.has('unrelated-e2e-cache'),
    }
  })
}

test('the typed reset confirmation gates the exact phrase and Cancel keeps data', async ({
  page,
}) => {
  await seedReturningUser(page)
  await page.goto('/')
  await waitForApp(page)

  const dialog = await requestSiteReset(page)
  await expect(
    dialog.getByRole('heading', { name: 'Reset all site data?' }),
  ).toBeVisible()
  await expect(dialog).toContainText(
    'This action cannot be undone. Google Drive cloud data will not be deleted.',
  )
  await expect(dialog).toContainText('All locally stored solves and sessions')
  await expect(dialog).toContainText('All Training attempts, calibration, and practice history')
  await expect(dialog).toContainText('All settings and preferences')
  await expect(dialog).toContainText('All onboarding and first-visit flags')
  await expect(dialog).toContainText('All IndexedDB databases owned by CubeLab')
  await expect(dialog).toContainText('All CubeLab localStorage and sessionStorage')
  await expect(dialog).toContainText(
    'All locally stored Google authentication and synchronization state',
  )

  const confirm = dialog.getByRole('button', { name: 'Reset All Data' })
  const input = dialog.getByTestId('confirm-text')
  await expect(confirm).toBeDisabled()
  await input.fill('reset')
  await expect(confirm).toBeDisabled()
  await input.fill('RESET ')
  await expect(confirm).toBeDisabled()
  await input.fill('RESET')
  await expect(confirm).toBeEnabled()

  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toBeHidden()

  const state = await readLocalState(page)
  expect(state.sessions.sessions[0].name).toBe('Reset me')
  expect(state.sessions.sessions[0].solves[0].id).toBe('reset-solve')
  expect(state.settings.settings.theme).toBe('dark')
  expect(state.onboarding.decision.status).toBe('completed')
  expect(state.training).not.toBeNull()
  expect(state.drive).not.toBeNull()
  expect(await page.getByTestId(RESET_PROGRESS).count()).toBe(0)
})

test('reset clears owned storage, IDB and caches; preserves unrelated data and Drive', async ({
  page,
}) => {
  await seedReturningUser(page)
  await page.goto('/')
  await waitForApp(page)

  await page.evaluate(async () => {
    const openDatabase = (name: string) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(name, 1)
        request.onupgradeneeded = () => {
          request.result.createObjectStore('records')
        }
        request.onsuccess = () => {
          request.result.close()
          resolve()
        }
        request.onerror = () => reject(request.error)
      })

    await openDatabase('cubelab-e2e-reset')
    await openDatabase('unrelated-e2e-db')
    await caches.open('cubelab-e2e-cache')
    await caches.open('unrelated-e2e-cache')
  })

  await page.evaluate(async () => {
    const mock = (
      window as typeof window & {
        __cubeLabMockDrive?: {
          connect: () => Promise<void>
          uploadDeviceBackup: (
            content: string,
            deviceId: string,
          ) => Promise<unknown>
          uploadBackup: (
            content: string,
            existingFileId?: string | null,
          ) => Promise<unknown>
          deleteBackup: (fileId: string) => Promise<void>
          __peekRemote?: () => Array<Record<string, unknown>>
        }
      }
    ).__cubeLabMockDrive
    if (!mock) throw new Error('Mock Drive transport is unavailable')

    await mock.connect()
    await mock.uploadDeviceBackup(
      JSON.stringify({
        app: 'CubeLab',
        format: 'cubelab-backup',
        sentinel: 'cloud-survives-site-reset',
      }),
      'e2e-device',
    )

    const counters = { upload: 0, deviceUpload: 0, delete: 0, connect: 0 }
    const writeCounters = () =>
      sessionStorage.setItem('e2e-drive-ops', JSON.stringify(counters))
    writeCounters()

    const uploadBackup = mock.uploadBackup.bind(mock)
    mock.uploadBackup = async (...args) => {
      counters.upload += 1
      writeCounters()
      return uploadBackup(...args)
    }
    const uploadDeviceBackup = mock.uploadDeviceBackup.bind(mock)
    mock.uploadDeviceBackup = async (...args) => {
      counters.deviceUpload += 1
      writeCounters()
      return uploadDeviceBackup(...args)
    }
    const deleteBackup = mock.deleteBackup.bind(mock)
    mock.deleteBackup = async (...args) => {
      counters.delete += 1
      writeCounters()
      return deleteBackup(...args)
    }
    const connect = mock.connect.bind(mock)
    mock.connect = async () => {
      counters.connect += 1
      writeCounters()
      return connect()
    }

    // Capture the mock cloud exactly when the reset publishes completion,
    // before this document reloads and its in-memory transport is recreated.
    const channel = new BroadcastChannel('cubelab-site-reset')
    channel.onmessage = (event: MessageEvent) => {
      if (event.data?.phase !== 'complete') return
      sessionStorage.setItem(
        'e2e-remote-at-complete',
        JSON.stringify(mock.__peekRemote?.() ?? []),
      )
    }
    ;(
      window as typeof window & { __e2eResetChannel?: BroadcastChannel }
    ).__e2eResetChannel = channel
  })

  await confirmSiteReset(page)
  await expect(page.getByRole('heading', WELCOME)).toBeVisible({
    timeout: 20_000,
  })

  const remoteAtComplete = await page.evaluate(() => {
    const raw = sessionStorage.getItem('e2e-remote-at-complete')
    return raw === null ? null : JSON.parse(raw)
  })
  expect(remoteAtComplete).toHaveLength(1)
  expect(remoteAtComplete[0].content).toContain('cloud-survives-site-reset')

  expect(
    await page.evaluate(() => JSON.parse(sessionStorage.getItem('e2e-drive-ops') ?? '{}')),
  ).toEqual({ upload: 0, deviceUpload: 0, delete: 0, connect: 0 })

  const state = await readLocalState(page)
  // The old collection, preferences, Training data, sync identity and Drive
  // metadata are gone. Onboarding and application hooks may create new
  // defaults, so these keys can exist with fresh values.
  expect(JSON.stringify(state.sessions)).not.toContain('reset-session')
  expect(JSON.stringify(state.sessions)).not.toContain('reset-solve')
  expect(state.settings?.settings?.theme).not.toBe('dark')
  expect(state.onboarding?.decision ?? null).toBeNull()
  expect(state.training).toBeNull()
  expect(state.drive).toBeNull()
  expect(state.sync).not.toContain('e2e-seed-device')
  expect(state.localOther).toBe('keep-local')
  expect(state.sessionOther).toBe('keep-session')
  expect(state.sessionMarker).toBeNull()
  expect(state.databases).not.toContain('cubelab-e2e-reset')
  expect(state.databases).toContain('unrelated-e2e-db')
  expect(state.cubeLabCache).toBe(false)
  expect(state.unrelatedCache).toBe(true)

  // First-visit state must survive a normal refresh.
  await page.reload()
  await expect(page.getByRole('heading', WELCOME)).toBeVisible({
    timeout: 20_000,
  })
  const refreshed = await readLocalState(page)
  expect(JSON.stringify(refreshed.sessions)).not.toContain('reset-session')
  expect(refreshed.onboarding?.decision ?? null).toBeNull()

  // A user can continue as a new installation, then reset again safely.
  await page.getByTestId('onboarding-skip').click()
  await waitForApp(page)
  await confirmSiteReset(page)
  await expect(page.getByRole('heading', WELCOME)).toBeVisible({
    timeout: 20_000,
  })
  const repeated = await readLocalState(page)
  expect(JSON.stringify(repeated.sessions)).not.toContain('reset-session')
  expect(repeated.onboarding?.decision ?? null).toBeNull()
})

test('a blocked IndexedDB deletion reports a partial failure and retries cleanly', async ({
  page,
}) => {
  await seedReturningUser(page)
  await page.goto('/')
  await waitForApp(page)

  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('cubelab-blocked', 1)
      request.onupgradeneeded = () => {
        request.result.createObjectStore('records')
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    ;(
      window as typeof window & { __e2eBlockedDatabase?: IDBDatabase }
    ).__e2eBlockedDatabase = database
  })

  await confirmSiteReset(page)
  const failure = page.getByRole('dialog', { name: 'Reset could not finish' })
  await expect(failure).toBeVisible({ timeout: 20_000 })
  await expect(failure).toContainText('Reset could not finish')
  await expect(failure).toContainText(
    'IndexedDB database "cubelab-blocked" is still open in another CubeLab tab.',
  )
  await expect(failure).toContainText(
    'local sign-in remains blocked, and other CubeLab tabs stay locked',
  )

  await page.evaluate(() => {
    ;(
      window as typeof window & { __e2eBlockedDatabase?: IDBDatabase }
    ).__e2eBlockedDatabase?.close()
  })
  await failure.getByRole('button', { name: 'Retry reset' }).click()
  await expect(page.getByRole('heading', WELCOME)).toBeVisible({
    timeout: 20_000,
  })

  const databases = await page.evaluate(async () =>
    typeof indexedDB.databases === 'function'
      ? (await indexedDB.databases()).map((database) => database.name ?? '')
      : [],
  )
  expect(databases).not.toContain('cubelab-blocked')
})

test('another running tab is gated during reset and cannot write stale data back', async ({
  browser,
}) => {
  // Simulate legacy clients so both tabs mount the application. Production
  // tabs use the lifetime Web Lock and would not both mount.
  const context: BrowserContext = await browser.newContext()
  await simulateLegacyConcurrentTabs(context)
  await context.addInitScript((training) => {
    if (localStorage.getItem('e2e-cross-tab-seeded') === '1') return
    localStorage.setItem('e2e-cross-tab-seeded', '1')
    const now = Date.now()
    localStorage.setItem(
      'cubelab:sessions:v1',
      JSON.stringify({
        version: 6,
        activeSessionId: 'stale-session',
        sessions: [
          {
            id: 'stale-session',
            name: 'Stale tab data',
            event: '333',
            createdAt: now - 120_000,
            updatedAt: now,
            solves: [
              {
                id: 'stale-solve',
                event: '333',
                rawMs: 9_876,
                penalty: 'none',
                scramble: 'R U',
                comment: '',
                createdAt: now - 30_000,
              },
            ],
          },
        ],
      }),
    )
    localStorage.setItem(
      'cubelab:settings:v1',
      JSON.stringify({
        version: 11,
        settings: { inspectionEnabled: false, theme: 'dark' },
      }),
    )
    localStorage.setItem(
      'cubelab:onboarding:v1',
      JSON.stringify({
        version: 1,
        decision: { status: 'completed', at: now - 60_000 },
      }),
    )
    localStorage.setItem('cubelab:training:v1', JSON.stringify(training))
    localStorage.setItem(
      'cubelab:drive:v1',
      JSON.stringify({
        version: 1,
        remoteFileId: 'stale-remote-file',
        remoteModifiedTime: null,
        lastBackupAt: now - 120_000,
        lastRestoreAt: null,
        connectedAccountLabel: 'Stale account',
      }),
    )
  }, EMPTY_TRAINING)

  const pageA = await context.newPage()
  const pageB = await context.newPage()
  await pageA.goto('/')
  await pageB.goto('/')
  await waitForApp(pageA)
  await waitForApp(pageB)

  await expect(pageA.getByTestId('session-select')).toContainText(
    'Stale tab data',
  )
  await expect(pageB.getByTestId('session-select')).toContainText(
    'Stale tab data',
  )

  await confirmSiteReset(pageA)
  await expect(pageA.getByRole('heading', WELCOME)).toBeVisible({
    timeout: 20_000,
  })
  await expect(pageB.getByRole('heading', WELCOME)).toBeVisible({
    timeout: 20_000,
  })

  const stateB = await readLocalState(pageB)
  expect(JSON.stringify(stateB.sessions)).not.toContain('stale-session')
  expect(JSON.stringify(stateB.sessions)).not.toContain('stale-solve')
  expect(stateB.settings?.settings?.theme).not.toBe('dark')
  expect(stateB.onboarding?.decision ?? null).toBeNull()
  expect(stateB.drive).toBeNull()

  await context.close()
})
