import { expect, test, type Page } from '@playwright/test'
import { selectSessionByName } from './interactions'

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
