import { expect, test } from '@playwright/test'

test('only one tab mounts the app; closing it opens the waiting tab with saved history', async ({ page, context }) => {
  await page.addInitScript(() => {
    const now = Date.now()
    if (!localStorage.getItem('cubelab:sessions:v1')) localStorage.setItem('cubelab:sessions:v1', JSON.stringify({
      version: 6, activeSessionId: 'owner-session', sessions: [{
        id: 'owner-session', name: 'Saved history', event: '333', createdAt: now, updatedAt: now,
        solves: [{ id: 'saved-solve', event: '333', rawMs: 12340, penalty: 'none', scramble: 'R U', comment: 'Preserve me', createdAt: now }],
      }],
    }))
  })
  await page.goto('/')
  await expect(page.locator('.scramble-text')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('solve-count')).toHaveText('1')
  const before = await page.evaluate(() => localStorage.getItem('cubelab:sessions:v1'))
  const waiting = await context.newPage()
  await waiting.goto('/')
  await expect(waiting.getByTestId('single-tab-waiting')).toBeVisible()
  await expect(waiting.getByTestId('timer-surface')).toHaveCount(0)
  await expect(waiting.getByTestId('settings-button')).toHaveCount(0)
  expect(await waiting.evaluate(() => localStorage.getItem('cubelab:sessions:v1'))).toBe(before)
  await page.close()
  await expect(waiting.locator('.scramble-text')).toBeVisible({ timeout: 30_000 })
  expect(await waiting.evaluate(() => JSON.parse(localStorage.getItem('cubelab:sessions:v1')!).activeSessionId)).toBe(JSON.parse(before!).activeSessionId)
  await expect(waiting.getByTestId('solve-count')).toHaveText('1')
  await waiting.reload()
  await expect(waiting.locator('.scramble-text')).toBeVisible({ timeout: 30_000 })
  await expect(waiting.getByTestId('solve-count')).toHaveText('1')
})

test('simultaneous openings and reload never mount two editable tabs', async ({ page, context }) => {
  const other = await context.newPage()
  await Promise.all([page.goto('/'), other.goto('/')])
  await expect.poll(async () => (await page.getByTestId('timer-surface').count()) + (await other.getByTestId('timer-surface').count())).toBe(1)
  await expect.poll(async () => (await page.getByTestId('single-tab-waiting').count()) + (await other.getByTestId('single-tab-waiting').count())).toBe(1)
  const owner = await page.getByTestId('timer-surface').count() ? page : other
  await owner.reload()
  await expect.poll(async () => (await page.getByTestId('timer-surface').count()) + (await other.getByTestId('timer-surface').count())).toBe(1)
  await expect.poll(async () => (await page.getByTestId('single-tab-waiting').count()) + (await other.getByTestId('single-tab-waiting').count())).toBe(1)
})

test('focusing a waiting tab cannot take ownership during a solve', async ({ page, context }) => {
  await page.goto('/')
  await expect(page.locator('.scramble-text')).toBeVisible({ timeout: 30_000 })
  await page.locator('body').click({ position: { x: 2, y: 2 } })
  await page.keyboard.down('Space')
  await expect(page.getByTestId('timer-surface')).toHaveAttribute('data-phase', 'ready')
  await page.keyboard.up('Space')
  await expect(page.getByTestId('timer-surface')).toHaveAttribute('data-phase', 'running')
  const waiting = await context.newPage()
  await waiting.goto('/')
  await expect(waiting.getByTestId('single-tab-waiting')).toBeVisible()
  await waiting.bringToFront()
  await waiting.keyboard.press('Space')
  await expect(waiting.getByTestId('timer-surface')).toHaveCount(0)
  await expect(page.getByTestId('timer-surface')).toHaveAttribute('data-phase', 'running')
  await page.keyboard.press('Space')
  await expect(page.getByTestId('timer-surface')).toHaveAttribute('data-phase', 'idle')
})

test('unavailable ownership coordination keeps the editable app closed', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined }))
  await page.goto('/')
  await expect(page.getByTestId('single-tab-unavailable')).toBeVisible()
  await expect(page.getByTestId('timer-surface')).toHaveCount(0)
  expect(await page.evaluate(() => localStorage.getItem('cubelab:sessions:v1'))).toBeNull()
})

test('a rejected ownership request can be retried without starting recovery early', async ({ page }) => {
  await page.addInitScript(() => {
    const request = navigator.locks.request.bind(navigator.locks)
    let rejected = false
    navigator.locks.request = ((...args: unknown[]) => {
      if (args[0] === 'cubelab-active-tab' && !rejected) {
        rejected = true
        return Promise.reject(new Error('Synthetic coordination failure'))
      }
      return Reflect.apply(request, navigator.locks, args)
    }) as typeof navigator.locks.request
  })
  await page.goto('/')
  await expect(page.getByTestId('single-tab-unavailable')).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('cubelab:sessions:v1'))).toBeNull()
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.locator('.scramble-text')).toBeVisible({ timeout: 30_000 })
})
