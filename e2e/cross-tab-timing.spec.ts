import { expect, test, type Page } from '@playwright/test'
import { selectSessionByName, sessionNames } from './interactions'

const TIMER = '[data-testid="timer-surface"]'

async function waitForApp(page: Page) {
  await expect(page.locator('.scramble-text')).toBeVisible({ timeout: 30_000 })
}

async function holdSpace(page: Page) {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
  })
  await page.keyboard.down('Space')
  await expect(page.locator(TIMER)).toHaveAttribute('data-phase', 'ready', {
    timeout: 3_000,
  })
  await page.keyboard.up('Space')
  await expect(page.locator(TIMER)).toHaveAttribute('data-phase', 'running')
}

async function stopWithSpace(page: Page) {
  await page.keyboard.press('Space')
  await expect(page.locator(TIMER)).toHaveAttribute('data-phase', 'idle')
}

async function selectedSessionName(page: Page): Promise<string> {
  return page
    .getByTestId('session-select')
    .evaluate((element) => element.textContent?.trim() ?? '')
}

async function storedSessions(page: Page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem('cubelab:sessions:v1')
    return raw ? JSON.parse(raw) : null
  })
}

test('cross-tab timing is not redirected and reconciles when idle', async ({
  browser,
  browserName,
}) => {
  test.skip(browserName === 'webkit', 'WebKit keyboard timing is not reliable in this flow.')
  const pageErrors: string[] = []
  const context = await browser.newContext()
  const pageA = await context.newPage()
  const pageB = await context.newPage()
  pageA.on('pageerror', (error) => pageErrors.push(error.message))
  pageB.on('pageerror', (error) => pageErrors.push(error.message))

  const seed = () => {
    const now = Date.now()
    localStorage.setItem(
      'cubelab:sessions:v1',
      JSON.stringify({
        version: 4,
        activeSessionId: 'session-1',
        sessions: [
          {
            id: 'session-1',
            name: 'Morning',
            event: '333',
            createdAt: now,
            updatedAt: now,
            solves: [],
          },
          {
            id: 'session-2',
            name: 'Evening',
            event: '333',
            createdAt: now,
            updatedAt: now,
            solves: [],
          },
        ],
      }),
    )
  }
  await pageA.addInitScript(seed)
  await pageB.addInitScript(seed)

  await pageA.goto('/')
  await pageB.goto('/')
  await waitForApp(pageA)
  await waitForApp(pageB)

  expect(await selectedSessionName(pageA)).toBe('Morning')
  expect(await selectedSessionName(pageB)).toBe('Morning')

  // Page A starts timing.
  await holdSpace(pageA)
  await expect(pageA.locator(TIMER)).toHaveAttribute('data-phase', 'running')

  // Page B switches the active session while Page A is timing.
  await selectSessionByName(pageB, 'Evening')
  expect(await selectedSessionName(pageB)).toBe('Evening')
  await pageB.waitForTimeout(200)

  // Page A must not redirect or replace its collection mid-timing.
  await expect(pageA.locator(TIMER)).toHaveAttribute('data-phase', 'running')
  expect(await selectedSessionName(pageA)).toBe('Morning')
  await expect(pageA.getByTestId('solve-count')).toHaveText('0')

  // Close Page B so its idle storage listener cannot adopt Page A's solve write
  // and race the active selection back to Morning. Page A's deferred external
  // snapshot is now stable: Evening is active and Morning has no solves.
  await pageB.close()

  await pageA.waitForTimeout(120)

  // Finish the solve, then reconciliation runs once idle. The external active
  // selection is authoritative, so Page A adopts Evening; the completed solve
  // must still land in Morning.
  await stopWithSpace(pageA)
  await expect
    .poll(() => selectedSessionName(pageA))
    .toBe('Evening')
  await expect(pageA.getByTestId('solve-count')).toHaveText('0')

  // The solve stays with the original session.
  const stored = await storedSessions(pageA)
  const morning = stored?.sessions.find(
    (session: { id: string }) => session.id === 'session-1',
  )
  expect(morning?.solves).toHaveLength(1)

  expect(pageErrors).toEqual([])
  await context.close()
})

test('an idle tab adopts split ownership metadata from another tab', async ({
  browser,
}) => {
  const context = await browser.newContext()
  const pageA = await context.newPage()
  const pageB = await context.newPage()
  const seed = () => {
    const now = Date.now()
    localStorage.setItem(
      'cubelab:sessions:v1',
      JSON.stringify({
        version: 6,
        activeSessionId: 'session-1',
        sessions: [
          {
            id: 'session-1',
            name: 'Morning',
            event: '333',
            createdAt: now,
            updatedAt: now,
            solves: [
              {
                id: 'solve-1',
                event: '333',
                rawMs: 10_000,
                penalty: 'none',
                scramble: 'R U',
                comment: 'Keep me',
                createdAt: now - 1_000,
              },
              {
                id: 'solve-2',
                event: '333',
                rawMs: 11_000,
                penalty: '+2',
                scramble: "F R U'",
                comment: '',
                createdAt: now - 2_000,
              },
            ],
          },
          {
            id: 'session-2',
            name: 'Evening',
            event: '333',
            createdAt: now,
            updatedAt: now,
            solves: [],
          },
        ],
      }),
    )
  }
  await pageA.addInitScript(seed)
  await pageB.addInitScript(seed)
  await pageA.goto('/')
  await pageB.goto('/')
  await waitForApp(pageA)
  await waitForApp(pageB)

  await pageA.getByTestId('session-settings').click()
  const settings = pageA.getByRole('dialog', { name: 'Session settings' })
  await settings.getByTestId('session-split').click()
  const split = pageA.getByRole('dialog', {
    name: 'Move solves to a new session',
  })
  await split.getByTestId('split-select-all').click()
  await split.getByLabel('Typed confirmation').fill('SPLIT SESSION')
  await split.getByRole('button', { name: 'Confirm split' }).click()
  await expect(split).toBeHidden()

  await expect
    .poll(() => sessionNames(pageB))
    .toEqual(['Morning', 'Morning (split)', 'Evening'])
  const storedB = await pageB.evaluate(() => {
    const raw = localStorage.getItem('cubelab:sessions:v1')
    return raw ? JSON.parse(raw) : null
  })
  expect(storedB.sessionTransfers).toEqual([
    expect.objectContaining({
      fromSessionId: 'session-1',
      toSessionId: expect.any(String),
      solveIds: ['solve-1', 'solve-2'],
    }),
  ])
  expect(
    storedB.sessions
      .flatMap((session: { solves: Array<{ id: string }> }) =>
        session.solves.map((solve) => solve.id),
      )
      .sort(),
  ).toEqual(['solve-1', 'solve-2'])

  await context.close()
})
