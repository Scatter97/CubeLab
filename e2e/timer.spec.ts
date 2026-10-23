import { expect, test, type Page } from '@playwright/test'

const TIMER = '[data-testid="timer-surface"]'

async function waitForApp(page: Page) {
  await expect(page.locator('.scramble-text')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.queue-label')).toContainText('Queue ready', {
    timeout: 30_000,
  })
}

async function holdSpace(page: Page) {
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

async function recordSolve(page: Page, solveDurationMs = 120) {
  await holdSpace(page)
  await page.waitForTimeout(solveDurationMs)
  await stopWithSpace(page)
}

async function storedSolves(page: Page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem('cubelab:solves:v1')
    return raw ? (JSON.parse(raw) as { solves: unknown[] }).solves : []
  })
}

test('keyboard timing records exactly one solve and advances the scramble', async ({
  page,
}) => {
  await page.goto('/')
  await waitForApp(page)

  const firstScramble = await page.locator('.scramble-text').innerText()
  await expect(page.getByTestId('solve-count')).toHaveText('0')

  // A short tap must cancel the arm sequence instead of starting the timer.
  await page.keyboard.down('Space')
  await page.keyboard.up('Space')
  await expect(page.locator(TIMER)).toHaveAttribute('data-phase', 'idle')
  await expect(page.getByTestId('solve-count')).toHaveText('0')

  await recordSolve(page, 180)
  await expect(page.getByTestId('solve-count')).toHaveText('1')
  await expect(page.locator('[data-testid="history-time"]')).toHaveCount(1)

  // The key-up after stopping must not add another solve.
  await page.waitForTimeout(350)
  await expect(page.getByTestId('solve-count')).toHaveText('1')

  // The next scramble is promoted from the queue.
  await expect
    .poll(async () => page.locator('.scramble-text').innerText())
    .not.toBe(firstScramble)

  const solves = await storedSolves(page)
  expect(solves).toHaveLength(1)
  expect((solves[0] as { scramble: string }).scramble).toBe(firstScramble)
})

test('penalties survive reload and delete supports undo', async ({ page }) => {
  await page.goto('/')
  await waitForApp(page)
  await recordSolve(page, 100)

  const plusTwoButton = page.getByRole('button', {
    name: 'Toggle plus two penalty for solve 1',
  })
  await plusTwoButton.click()
  await expect(plusTwoButton).toHaveAttribute('aria-pressed', 'true')

  const storedBeforeReload = await storedSolves(page)
  expect((storedBeforeReload[0] as { penalty: string }).penalty).toBe('+2')

  await page.reload()
  await waitForApp(page)
  await expect(page.getByTestId('solve-count')).toHaveText('1')
  await expect(
    page.getByRole('button', {
      name: 'Toggle plus two penalty for solve 1',
    }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('timer-display')).toContainText('+2')

  await page.getByRole('button', { name: 'Delete solve 1' }).click()
  await expect(page.getByTestId('solve-count')).toHaveText('0')
  await expect(page.getByText('No solves yet.')).toBeVisible()
  await expect(page.getByRole('status')).toContainText('Solve deleted')

  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(page.getByTestId('solve-count')).toHaveText('1')
  await expect(page.getByText('No solves yet.')).toBeHidden()

  // Clearing requires explicit confirmation and can be cancelled.
  await page.getByRole('button', { name: 'Clear session' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Keep solves' }).click()
  await expect(page.getByTestId('solve-count')).toHaveText('1')

  await page.getByRole('button', { name: 'Clear session' }).click()
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Clear session' }).click()
  await expect(page.getByTestId('solve-count')).toHaveText('0')
  expect(await storedSolves(page)).toHaveLength(0)
})

test('inspection starts, arms, times a solve, and persists its setting', async ({
  page,
}) => {
  await page.goto('/')
  await waitForApp(page)

  const inspectionSwitch = page.getByRole('switch', { name: /Inspection/ })
  await expect(inspectionSwitch).toHaveAttribute('aria-checked', 'false')
  await inspectionSwitch.click()
  await expect(inspectionSwitch).toHaveAttribute('aria-checked', 'true')

  // The switch keeps focus after the click. Space must still control the timer.
  await page.keyboard.press('Space')
  await expect(page.locator(TIMER)).toHaveAttribute('data-phase', 'inspection', {
    timeout: 3_000,
  })
  await expect(inspectionSwitch).toBeDisabled()
  await expect(page.locator(TIMER)).toContainText('15s + 2s')

  await holdSpace(page)
  await page.waitForTimeout(120)
  await stopWithSpace(page)
  await expect(page.getByTestId('solve-count')).toHaveText('1')

  const solves = await storedSolves(page)
  expect((solves[0] as { penalty: string }).penalty).toBe('none')

  await page.reload()
  await waitForApp(page)
  await expect(page.getByTestId('solve-count')).toHaveText('1')
  await expect(page.getByRole('switch', { name: /Inspection/ })).toHaveAttribute(
    'aria-checked',
    'true',
  )
})

test('mobile layout supports hold-to-time pointer controls', async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  })
  const page = await context.newPage()

  await page.goto('/')
  await waitForApp(page)

  const noHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth + 1,
  )
  expect(noHorizontalOverflow).toBe(true)

  const timer = page.locator(TIMER)
  await timer.scrollIntoViewIfNeeded()
  const box = await timer.boundingBox()
  expect(box).not.toBeNull()
  if (!box) throw new Error('Timer has no bounding box')

  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await expect(timer).toHaveAttribute('data-phase', 'ready', { timeout: 3_000 })
  await page.mouse.up()
  await expect(timer).toHaveAttribute('data-phase', 'running')
  await page.waitForTimeout(120)
  await page.mouse.down()
  await page.mouse.up()
  await expect(timer).toHaveAttribute('data-phase', 'idle')
  await expect(page.getByTestId('solve-count')).toHaveText('1')

  await context.close()
})

test('installed app loads scrambles while completely offline', async ({
  page,
  context,
}) => {
  await page.goto('/')
  await waitForApp(page)

  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), {
      timeout: 15_000,
    })
    .toBe(true)

  await context.setOffline(true)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.locator('.brand-name')).toContainText('CubeLab')
  await waitForApp(page)
  await recordSolve(page, 80)
  await expect(page.getByTestId('solve-count')).toHaveText('1')

  await context.setOffline(false)
})
