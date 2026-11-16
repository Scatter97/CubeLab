import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

// Onboarding itself must be tested from a genuinely empty browser profile. The
// shared Playwright storage state suppresses setup for every existing suite.
test.use({ storageState: { cookies: [], origins: [] } })

const CS_TIMER_FILE = JSON.stringify({
  session1: [
    [12_345, 'R U R\' U\'', '', 1_700_000_000],
    [9_876, 'F R U', '', 1_700_000_010],
  ],
  session2: [[7_654, 'R U', '', 1_700_000_020]],
  session3: [[20_000, 'custom scramble', '', 1_700_000_030]],
  properties: {
    sessionData: JSON.stringify({
      1: { name: 'Main 3x3', opt: { scrType: '333' }, rank: 1, date: [1_700_000_000] },
      2: { name: 'Two', opt: { scrType: '222' }, rank: 2, date: [1_700_000_020] },
      3: { name: 'FTO', opt: { scrType: 'fto' }, rank: 3, date: [1_700_000_030] },
    }),
  },
})

async function storedSessions(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('cubelab:sessions:v1') ?? '{}'))
}

async function storedSettings(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('cubelab:settings:v1') ?? '{}'))
}

async function seedCloudBackup(page: Page) {
  await page.evaluate(async () => {
    const storedSettings = JSON.parse(
      localStorage.getItem('cubelab:settings:v1') ?? '{}',
    ) as { settings: Record<string, unknown> }
    const now = Date.now()
    const backup = {
      app: 'CubeLab',
      format: 'cubelab-backup',
      version: 1,
      exportedAt: new Date(now).toISOString(),
      sessions: {
        version: 6,
        activeSessionId: 'cloud-333',
        sessions: [
          {
            id: 'cloud-333',
            name: 'Cloud 3x3',
            event: '333',
            createdAt: now - 100_000,
            updatedAt: now,
            solves: [
              {
                id: 'cloud-solve-1',
                event: '333',
                rawMs: 12_000,
                penalty: 'none',
                scramble: 'R U',
                comment: '',
                createdAt: now - 30_000,
              },
              {
                id: 'cloud-solve-2',
                event: '333',
                rawMs: 11_000,
                penalty: '+2',
                scramble: 'U R',
                comment: '',
                createdAt: now - 20_000,
              },
              {
                id: 'cloud-solve-3',
                event: '333',
                rawMs: 10_000,
                penalty: 'none',
                scramble: 'F R',
                comment: '',
                createdAt: now - 10_000,
              },
            ],
          },
          {
            id: 'cloud-fto',
            name: 'Cloud FTO',
            event: 'custom:fto',
            createdAt: now - 90_000,
            updatedAt: now,
            solves: [
              {
                id: 'cloud-solve-fto',
                event: 'custom:fto',
                rawMs: 30_000,
                penalty: 'none',
                scramble: 'custom scramble',
                comment: '',
                createdAt: now - 5_000,
              },
            ],
          },
        ],
        customEvents: [
          {
            id: 'custom:fto',
            name: 'FTO',
            placeholder: '',
            createdAt: now - 200_000,
            updatedAt: now - 200_000,
          },
        ],
        sessionOrder: {
          ids: ['cloud-333', 'cloud-fto'],
          updatedAt: now,
          editorId: 'remote-device',
        },
      },
      settings: {
        ...storedSettings.settings,
        theme: 'dark',
        inspectionEnabled: true,
      },
      sync: {
        protocolVersion: 1,
        revision: 4,
        deviceId: 'remote-device',
        updatedAt: now,
        tombstones: [],
        conflicts: [],
        sessionRedirects: [],
        settingsFieldUpdates: {
          theme: { updatedAt: now, editorId: 'remote-device' },
          inspectionEnabled: { updatedAt: now, editorId: 'remote-device' },
        },
        activeSessionFieldUpdate: { updatedAt: now, editorId: 'remote-device' },
      },
    }
    const mockDrive = (
      window as {
        __cubeLabMockDrive?: {
          connect: () => Promise<void>
          disconnect: () => void
          uploadDeviceBackup: (
            content: string,
            deviceId: string,
          ) => Promise<unknown>
        }
      }
    ).__cubeLabMockDrive
    await mockDrive?.connect()
    await mockDrive?.uploadDeviceBackup(
      JSON.stringify(backup),
      'remote-device',
    )
    mockDrive?.disconnect()
  })
}

test('Start Fresh creates one usable empty session per selected event and skips sync', async ({
  page,
}) => {
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: 'Welcome to CubeLab' }),
  ).toBeVisible()

  await page.getByTestId('onboarding-start-fresh').click()
  await expect(
    page.getByRole('heading', { name: 'Select your events' }),
  ).toBeVisible()
  await expect(page.getByTestId('onboarding-event-333')).toBeChecked()
  await page.getByTestId('onboarding-event-card-222').click()
  await page.getByTestId('onboarding-event-card-444').click()
  await page.getByTestId('onboarding-events-continue').click()

  await expect(
    page.getByRole('heading', { name: 'Set up CubeLab' }),
  ).toBeVisible()
  await expect(page.getByTestId('onboarding-main-333')).toBeChecked()
  await page.getByTestId('onboarding-settings-continue').click()
  await expect(
    page.getByRole('heading', { name: 'Turn on Sync?' }),
  ).toBeVisible()
  await page.getByTestId('onboarding-maybe-later').click()

  await expect(
    page.getByRole('heading', { name: "You're all set!" }),
  ).toBeVisible()
  await expect(page.getByText('Events selected')).toBeVisible()
  await expect(page.getByText('Sessions ready', { exact: true })).toBeVisible()
  await expect(
    page.getByRole('button', { name: /start cubing/i }),
  ).toHaveCount(0)

  // The completion screen requires no interaction and opens the timer.
  await expect(page.getByTestId('timer-surface')).toBeVisible({
    timeout: 6_000,
  })
  const sessions = await storedSessions(page)
  expect(sessions.sessions.map((session: { name: string }) => session.name)).toEqual([
    '3×3',
    '2×2',
    '4×4',
  ])
  expect(
    sessions.sessions.every(
      (session: { solves: unknown[] }) => session.solves.length === 0,
    ),
  ).toBe(true)
  expect(sessions.activeSessionId).toBe(
    sessions.sessions.find(
      (session: { event: string }) => session.event === '333',
    ).id,
  )

  await page.reload()
  await expect(page.getByTestId('timer-surface')).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Welcome to CubeLab' }),
  ).toHaveCount(0)
})

test('csTimer import keeps imported sessions, solves and settings without event setup', async ({
  page,
}) => {
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: 'Welcome to CubeLab' }),
  ).toBeVisible()
  await page.getByTestId('onboarding-import-cstimer').click()
  await expect(
    page.getByRole('heading', { name: 'Import from csTimer' }),
  ).toBeVisible()
  await expect(
    page.getByTestId('onboarding-event-333'),
  ).toHaveCount(0)

  await page.getByTestId('onboarding-import-file').setInputFiles({
    name: 'timer.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(CS_TIMER_FILE),
  })
  await expect(page.getByRole('button', { name: 'Import 3 sessions' })).toBeVisible()
  await expect(page.getByText('Main 3x3')).toBeVisible()
  await expect(page.getByText('Two')).toBeVisible()
  await expect(page.getByText('FTO', { exact: true })).toBeVisible()
  await expect(
    page.getByText(/Unknown puzzle types stay on their own event/),
  ).toBeVisible()
  await page.getByTestId('onboarding-import-confirm').click()

  await expect(
    page.getByRole('heading', { name: 'Set up CubeLab' }),
  ).toBeVisible()
  await expect(page.getByTestId('onboarding-main-222')).toBeVisible()
  await page.getByTestId('onboarding-main-card-222').click()
  const inspection = page.getByRole('switch', { name: 'WCA inspection' })
  await inspection.click()
  await expect(inspection).toHaveAttribute('aria-checked', 'true')
  await page.getByTestId('onboarding-settings-continue').click()
  await expect(
    page.getByRole('heading', { name: 'Turn on Sync?' }),
  ).toBeVisible()
  await page.getByTestId('onboarding-maybe-later').click()

  await expect(
    page.getByRole('heading', { name: "You're all set!" }),
  ).toBeVisible()
  await expect(page.getByText('Imported sessions')).toBeVisible()
  await expect(page.getByText('Imported solves')).toBeVisible()
  await expect(page.getByTestId('timer-surface')).toBeVisible({
    timeout: 6_000,
  })

  const sessions = await storedSessions(page)
  expect(sessions.sessions).toHaveLength(3)
  expect(
    sessions.sessions.map(
      (session: { name: string; event: string; solves: unknown[] }) => [
        session.name,
        session.event,
        session.solves.length,
      ],
    ),
  ).toEqual([
    ['Main 3x3', '333', 2],
    ['Two', '222', 1],
    ['FTO', expect.stringMatching(/^custom:cstimer:fto-/), 1],
  ])
  expect(sessions.customEvents).toHaveLength(1)
  expect(sessions.customEvents[0]).toMatchObject({
    id: expect.stringMatching(/^custom:cstimer:fto-/),
    name: 'csTimer: fto',
  })
  expect(sessions.activeSessionId).toBe(
    sessions.sessions.find(
      (session: { event: string }) => session.event === '222',
    ).id,
  )
  const settings = await storedSettings(page)
  expect(settings.settings.inspectionEnabled).toBe(true)

  // A reload resumes the timer without duplicating the import.
  await page.reload()
  await expect(page.getByTestId('timer-surface')).toBeVisible()
  expect((await storedSessions(page)).sessions).toHaveLength(3)
})

test('returning user restores cloud sessions, custom events and settings, then only asks for device-local options', async ({
  page,
}) => {
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: 'Welcome to CubeLab' }),
  ).toBeVisible()
  await seedCloudBackup(page)

  await page.getByTestId('onboarding-returning').click()
  await expect(
    page.getByRole('heading', { name: 'Welcome Back' }),
  ).toBeVisible()
  await page.getByTestId('onboarding-returning-connect').click()

  await expect(
    page.getByRole('heading', { name: 'Device settings' }),
  ).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('WCA inspection')).toHaveCount(0)
  await expect(page.getByText('Stored only in this browser.')).toBeVisible()
  await page.getByTestId('onboarding-device-finish').click()

  await expect(
    page.getByRole('heading', { name: "You're all set!" }),
  ).toBeVisible()
  await expect(page.getByText('Restored sessions')).toBeVisible()
  await expect(page.getByTestId('timer-surface')).toBeVisible({
    timeout: 6_000,
  })

  const sessions = await storedSessions(page)
  expect(sessions.sessions.map((session: { id: string }) => session.id).sort()).toEqual([
    'cloud-333',
    'cloud-fto',
  ])
  expect(sessions.activeSessionId).toBe('cloud-333')
  expect(
    sessions.sessions.find(
      (session: { id: string }) => session.id === 'cloud-333',
    ).solves,
  ).toHaveLength(3)
  expect(sessions.customEvents?.[0]).toMatchObject({ id: 'custom:fto', name: 'FTO' })
  const settings = await storedSettings(page)
  expect(settings.settings.theme).toBe('dark')
  expect(settings.settings.inspectionEnabled).toBe(true)
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})

test('fresh setup detects existing cloud data and can stay local without overwriting it', async ({
  page,
}) => {
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: 'Welcome to CubeLab' }),
  ).toBeVisible()
  await seedCloudBackup(page)

  await page.getByTestId('onboarding-start-fresh').click()
  await page.getByTestId('onboarding-event-card-222').click()
  await page.getByTestId('onboarding-events-continue').click()
  await page.getByTestId('onboarding-settings-continue').click()
  await page.getByTestId('onboarding-connect-google').click()

  await expect(
    page.getByRole('heading', { name: 'Existing CubeLab data found' }),
  ).toBeVisible()
  await expect(page.getByText(/already contains 2 sessions and 4 solves/)).toBeVisible()
  await page.getByRole('button', { name: 'Keep this setup local' }).click()

  await expect(
    page.getByRole('heading', { name: "You're all set!" }),
  ).toBeVisible()
  await expect(page.getByTestId('timer-surface')).toBeVisible({
    timeout: 6_000,
  })
  const sessions = await storedSessions(page)
  expect(sessions.sessions.map((session: { name: string }) => session.name)).toEqual([
    '3×3',
    '2×2',
  ])
  const syncStorage = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('cubelab:sync:v1') ?? '{}'),
  )
  expect(syncStorage.preferences.enabled).toBe(false)
})

test('existing users are not shown onboarding after upgrading', async ({ page }) => {
  await page.addInitScript(() => {
    const now = Date.now()
    localStorage.setItem(
      'cubelab:sessions:v1',
      JSON.stringify({
        version: 6,
        activeSessionId: 'existing',
        sessions: [
          {
            id: 'existing',
            name: 'Existing',
            event: '333',
            createdAt: now - 100_000,
            updatedAt: now,
            solves: [
              {
                id: 'existing-solve',
                event: '333',
                rawMs: 14_000,
                penalty: 'none',
                scramble: 'R U',
                comment: '',
                createdAt: now - 10_000,
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
  })
  await page.goto('/')
  await expect(page.getByTestId('timer-surface')).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Welcome to CubeLab' }),
  ).toHaveCount(0)
  await expect(page.getByTestId('solve-count')).toHaveText('1')
})

test('Skip Setup persists without changing the default session', async ({ page }) => {
  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: 'Welcome to CubeLab' }),
  ).toBeVisible()
  await page.getByTestId('onboarding-skip').click()
  await expect(page.getByTestId('timer-surface')).toBeVisible()
  const sessions = await storedSessions(page)
  expect(sessions.sessions).toHaveLength(1)
  expect(sessions.sessions[0].solves).toHaveLength(0)
  const onboarding = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('cubelab:onboarding:v1') ?? '{}'),
  )
  expect(onboarding.decision.status).toBe('skipped')

  await page.reload()
  await expect(page.getByTestId('timer-surface')).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Welcome to CubeLab' }),
  ).toHaveCount(0)
})

test('interrupted onboarding resumes the staged event selection', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('onboarding-start-fresh').click()
  await page.getByTestId('onboarding-event-card-222').click()
  await page.reload()

  await expect(
    page.getByRole('heading', { name: 'Select your events' }),
  ).toBeVisible()
  await expect(page.getByTestId('onboarding-event-333')).toBeChecked()
  await expect(page.getByTestId('onboarding-event-222')).toBeChecked()
  await expect(page.getByTestId('timer-surface')).toHaveCount(0)
})

test('reopened setup preserves existing solves and does not create duplicate sessions', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const now = Date.now()
    localStorage.setItem(
      'cubelab:sessions:v1',
      JSON.stringify({
        version: 6,
        activeSessionId: 'practice',
        sessions: [
          {
            id: 'practice',
            name: 'Practice',
            event: '222',
            createdAt: now - 100_000,
            updatedAt: now,
            solves: [
              {
                id: 'practice-solve',
                event: '222',
                rawMs: 4_000,
                penalty: 'none',
                scramble: 'R U',
                comment: 'keep me',
                createdAt: now - 10_000,
              },
            ],
          },
        ],
      }),
    )
    localStorage.setItem(
      'cubelab:settings:v1',
      JSON.stringify({ version: 11, settings: { inspectionEnabled: false } }),
    )
    localStorage.setItem(
      'cubelab:onboarding:v1',
      JSON.stringify({
        version: 1,
        decision: { status: 'completed', at: 1 },
      }),
    )
  })
  await page.goto('/')
  await expect(page.getByTestId('timer-surface')).toBeVisible()
  await page.getByTestId('settings-button').click()
  await page.getByTestId('settings-onboarding-button').click()
  await expect(
    page.getByRole('heading', { name: 'Welcome to CubeLab' }),
  ).toBeVisible()

  await page.getByTestId('onboarding-start-fresh').click()
  await page.getByTestId('onboarding-events-continue').click()
  await page.getByTestId('onboarding-settings-continue').click()
  await page.getByTestId('onboarding-maybe-later').click()
  await expect(
    page.getByRole('heading', { name: "You're all set!" }),
  ).toBeVisible()
  await expect(page.getByTestId('timer-surface')).toBeVisible({
    timeout: 6_000,
  })

  const sessions = await storedSessions(page)
  expect(sessions.sessions).toHaveLength(2)
  const practice = sessions.sessions.find(
    (session: { id: string }) => session.id === 'practice',
  )
  expect(practice.solves).toHaveLength(1)
  expect(practice.solves[0].comment).toBe('keep me')
  expect(
    sessions.sessions.filter(
      (session: { event: string }) => session.event === '333',
    ),
  ).toHaveLength(1)
})

test('onboarding screens have no serious accessibility violations in light and dark', async ({
  page,
}) => {
  const serious = async () => {
    const results = await new AxeBuilder({ page })
      .disableRules(['label-content-name-mismatch'])
      .analyze()
    return results.violations.filter(
      (violation) =>
        violation.impact === 'critical' || violation.impact === 'serious',
    )
  }

  await page.goto('/')
  await page.getByRole('heading', { name: 'Welcome to CubeLab' }).waitFor()
  expect(await serious()).toEqual([])

  await page.getByTestId('onboarding-start-fresh').click()
  await page.getByTestId('onboarding-events-continue').waitFor()
  expect(await serious()).toEqual([])

  await page.getByTestId('onboarding-events-continue').click()
  await page.getByText('Dark', { exact: true }).click()
  await page.getByRole('heading', { name: 'Set up CubeLab' }).waitFor()
  expect(await serious()).toEqual([])

  await page.getByTestId('onboarding-settings-continue').click()
  await page.getByRole('heading', { name: 'Turn on Sync?' }).waitFor()
  expect(await serious()).toEqual([])

  await page.getByTestId('onboarding-maybe-later').click()
  await page.getByRole('heading', { name: "You're all set!" }).waitFor()
  expect(await serious()).toEqual([])
})

test('a failed optional Google connection does not block the local setup', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('heading', { name: 'Welcome to CubeLab' }).waitFor()
  await seedCloudBackup(page)
  await page.evaluate(() => {
    ;(
      window as { __cubeLabMockDrive?: { __corruptRemote?: () => void } }
    ).__cubeLabMockDrive?.__corruptRemote?.()
  })

  await page.getByTestId('onboarding-start-fresh').click()
  await page.getByTestId('onboarding-events-continue').click()
  await page.getByTestId('onboarding-settings-continue').click()
  await page.getByTestId('onboarding-connect-google').click()
  await expect(
    page.getByRole('heading', { name: 'Synchronization did not complete' }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Continue without sync' }).click()

  await expect(
    page.getByRole('heading', { name: "You're all set!" }),
  ).toBeVisible()
  await expect(page.getByTestId('timer-surface')).toBeVisible({
    timeout: 6_000,
  })
  const sessions = await storedSessions(page)
  expect(sessions.sessions.map((session: { name: string }) => session.name)).toEqual([
    '3×3',
  ])
  const syncStorage = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('cubelab:sync:v1') ?? '{}'),
  )
  expect(syncStorage.preferences.enabled).toBe(false)
})

test('keyboard focus and selection work without pointer input', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('heading', { name: 'Welcome to CubeLab' }).waitFor()
  await page.keyboard.press('Tab')
  await expect(page.getByTestId('onboarding-start-fresh')).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(
    page.getByRole('heading', { name: 'Select your events' }),
  ).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByTestId('onboarding-event-333')).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByTestId('onboarding-event-222')).toBeFocused()
  await page.keyboard.press('Space')
  await expect(page.getByTestId('onboarding-event-222')).toBeChecked()
})

test('onboarding respects reduced motion and fits a mobile viewport', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByRole('heading', { name: 'Welcome to CubeLab' }).waitFor()
  const animationDuration = await page.locator('.onboarding-panel').evaluate(
    (panel) => Number.parseFloat(getComputedStyle(panel).animationDuration),
  )
  expect(animationDuration).toBeLessThan(0.01)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true)

  await page.getByTestId('onboarding-start-fresh').click()
  await expect(
    page.getByRole('heading', { name: 'Select your events' }),
  ).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true)
  await page.getByTestId('onboarding-events-continue').click()
  await page.getByText('Dark', { exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Set up CubeLab' }),
  ).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true)
})
