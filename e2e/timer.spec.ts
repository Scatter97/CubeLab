import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

const TIMER = '[data-testid="timer-surface"]'

interface StoredSession {
  id: string
  name: string
  solves: unknown[]
}

interface StoredSessions {
  activeSessionId: string
  sessions: StoredSession[]
}

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

async function storedSessions(page: Page): Promise<StoredSessions | null> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('cubelab:sessions:v1')
    return raw ? (JSON.parse(raw) as StoredSessions) : null
  })
}

async function storedSolves(page: Page): Promise<unknown[]> {
  const data = await storedSessions(page)
  return (
    data?.sessions.find((session) => session.id === data.activeSessionId)
      ?.solves ?? []
  )
}

async function selectedSessionName(page: Page): Promise<string> {
  return page.getByTestId('session-select').evaluate((element) => {
    const select = element as HTMLSelectElement
    return select.selectedOptions[0]?.textContent?.trim() ?? ''
  })
}

async function openSettings(page: Page) {
  await page.getByTestId('settings-button').click()
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await expect(dialog).toBeVisible()
  return dialog
}

async function openBackup(page: Page) {
  const settings = await openSettings(page)
  await settings.getByTestId('settings-backup-button').click()
  await expect(settings).toBeHidden()
  const dialog = page.getByRole('dialog', { name: 'Your local data' })
  await expect(dialog).toBeVisible()
  return dialog
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
  await expect(dialog.getByRole('button', { name: 'Keep solves' })).toBeFocused()

  // Tab and Shift+Tab stay inside the modal dialog.
  await page.keyboard.press('Shift+Tab')
  await expect(dialog.getByRole('button', { name: 'Clear session' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(dialog.getByRole('button', { name: 'Keep solves' })).toBeFocused()

  await dialog.getByRole('button', { name: 'Keep solves' }).click()
  await expect(page.getByTestId('solve-count')).toHaveText('1')
  await expect(page.getByRole('button', { name: 'Clear session' })).toBeFocused()

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

  const settings = await openSettings(page)
  const inspectionSwitch = settings.getByRole('switch', { name: /Inspection/ })
  await expect(inspectionSwitch).toHaveAttribute('aria-checked', 'false')
  await inspectionSwitch.click()
  await expect(inspectionSwitch).toHaveAttribute('aria-checked', 'true')
  await settings.getByTestId('settings-done').click()
  await expect(settings).toBeHidden()
  await expect(page.getByTestId('settings-button')).toBeFocused()

  // The header Settings button keeps focus after closing. Space still controls
  // the timer, and Settings cannot be reopened while timing is active.
  await page.keyboard.press('Space')
  await expect(page.locator(TIMER)).toHaveAttribute('data-phase', 'inspection', {
    timeout: 3_000,
  })
  await expect(page.getByTestId('settings-button')).toBeDisabled()
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
  const reopenedSettings = await openSettings(page)
  await expect(
    reopenedSettings.getByRole('switch', { name: /Inspection/ }),
  ).toHaveAttribute('aria-checked', 'true')
})

test('settings dialog contains focus and restores it to the header button', async ({
  page,
}) => {
  await page.goto('/')
  await waitForApp(page)

  const settings = await openSettings(page)
  const closeButton = settings.getByRole('button', { name: 'Close settings' })
  const doneButton = settings.getByTestId('settings-done')

  await closeButton.focus()
  await page.keyboard.press('Shift+Tab')
  await expect(doneButton).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(closeButton).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(settings).toBeHidden()
  await expect(page.getByTestId('settings-button')).toBeFocused()
})

test('custom Space hold time changes the arm threshold and persists', async ({
  page,
}) => {
  await page.goto('/')
  await waitForApp(page)

  const settings = await openSettings(page)
  const holdDuration = settings.getByTestId('hold-duration')
  await expect(holdDuration).toHaveValue('300')
  await holdDuration.fill('1000')
  await settings.getByTestId('settings-done').click()
  await expect(settings).toBeHidden()

  // A hold shorter than the configured threshold must cancel.
  await page.keyboard.down('Space')
  await page.waitForTimeout(350)
  await page.keyboard.up('Space')
  await expect(page.locator(TIMER)).toHaveAttribute('data-phase', 'idle')

  // A hold beyond the threshold arms; release starts timing.
  await page.keyboard.down('Space')
  await page.waitForTimeout(1_100)
  await page.keyboard.up('Space')
  await expect(page.locator(TIMER)).toHaveAttribute('data-phase', 'running')
  await page.waitForTimeout(100)
  await stopWithSpace(page)
  await expect(page.getByTestId('solve-count')).toHaveText('1')

  await page.reload()
  await waitForApp(page)
  const reopened = await openSettings(page)
  await expect(reopened.getByTestId('hold-duration')).toHaveValue('1000')
})

test('interface zoom fills the viewport and keeps dialogs usable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/')
  await waitForApp(page)

  const settings = await openSettings(page)
  await settings.getByTestId('ui-zoom').selectOption('70')
  await settings.getByTestId('settings-done').click()
  await expect(settings).toBeHidden()

  const zoomedOut = await page.evaluate(() => {
    const shell = document.querySelector('.app-shell')
    if (!shell) throw new Error('Missing app shell')
    const rect = shell.getBoundingClientRect()
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      shell: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    }
  })
  expect(zoomedOut.scrollWidth).toBeLessThanOrEqual(zoomedOut.innerWidth + 1)
  expect(zoomedOut.scrollHeight).toBeLessThanOrEqual(zoomedOut.innerHeight + 1)
  expect(zoomedOut.shell.x).toBeCloseTo(0, 0)
  expect(zoomedOut.shell.width).toBeCloseTo(zoomedOut.innerWidth, 0)
  expect(zoomedOut.shell.height).toBeGreaterThanOrEqual(zoomedOut.innerHeight - 1)

  const zoomedSettings = await openSettings(page)
  await zoomedSettings.getByTestId('ui-zoom').selectOption('150')
  await zoomedSettings.getByTestId('settings-done').click()
  await expect(zoomedSettings).toBeHidden()

  const zoomedIn = await page.evaluate(() => {
    const shell = document.querySelector('.app-shell')
    if (!shell) throw new Error('Missing app shell')
    const rect = shell.getBoundingClientRect()
    return {
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      shell: { x: rect.x, width: rect.width },
    }
  })
  expect(zoomedIn.scrollWidth).toBeLessThanOrEqual(zoomedIn.innerWidth + 1)
  expect(zoomedIn.shell.x).toBeCloseTo(0, 0)
  expect(zoomedIn.shell.width).toBeCloseTo(zoomedIn.innerWidth, 0)

  // The Settings dialog must still fit and expose its footer at 150%.
  const largeSettings = await openSettings(page)
  const done = largeSettings.getByTestId('settings-done')
  await expect(done).toBeVisible()
  const doneBox = await done.boundingBox()
  expect(doneBox).not.toBeNull()
  if (!doneBox) throw new Error('Settings Done button has no bounding box')
  expect(doneBox.y + doneBox.height).toBeLessThanOrEqual(
    page.viewportSize()?.height ?? 1000,
  )
  await done.click()
  await expect(largeSettings).toBeHidden()
})

test('display and scramble preferences apply and keyboard activation works', async ({
  page,
}) => {
  await page.goto('/')
  await waitForApp(page)

  const settings = await openSettings(page)
  await settings.locator('#decimal-small').check()
  await settings.getByTestId('scramble-alignment').selectOption('right')
  await settings.locator('#scramble-limit-height').check()
  await settings.getByTestId('scramble-action').selectOption('next')
  await settings.getByTestId('settings-done').click()
  await expect(settings).toBeHidden()

  const decimal = page.locator('.timer-decimal')
  await expect(decimal).toHaveText('.00')
  const fontSizes = await page.evaluate(() => {
    const display = document.querySelector('.timer-display')
    const decimalPart = document.querySelector('.timer-decimal')
    if (!display || !decimalPart) throw new Error('Missing timer decimal')
    return {
      display: Number.parseFloat(getComputedStyle(display).fontSize),
      decimal: Number.parseFloat(getComputedStyle(decimalPart).fontSize),
    }
  })
  expect(fontSizes.decimal).toBeLessThan(fontSizes.display)

  const scramble = page.locator('.scramble-text')
  await expect(scramble).toHaveClass(/is-aligned-right/)
  await expect(scramble).toHaveClass(/is-height-limited/)
  expect(
    await scramble.evaluate((element) => getComputedStyle(element).textAlign),
  ).toBe('right')

  const before = await scramble.innerText()
  await scramble.focus()
  await page.keyboard.press('Enter')
  await expect.poll(() => scramble.innerText()).not.toBe(before)
  await waitForApp(page)

  // Space must still belong to the timer even while the scramble is focused.
  await holdSpace(page)
  await stopWithSpace(page)
  await expect(page.getByTestId('solve-count')).toHaveText('1')
})

test('effective +2 labels are not clipped in the history rail', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 1000 })
  await page.addInitScript(() => {
    const now = Date.now()
    localStorage.setItem(
      'cubelab:sessions:v1',
      JSON.stringify({
        version: 1,
        activeSessionId: 'history-session',
        sessions: [
          {
            id: 'history-session',
            name: 'Session 1',
            createdAt: now - 60_000,
            updatedAt: now,
            solves: [
              {
                id: 'history-solve',
                event: '333',
                rawMs: 10_250,
                penalty: '+2',
                scramble: "R U R' U' F2 D2 L2 B2 R2 U2",
                createdAt: now - 86_400_000 * 400,
              },
            ],
          },
        ],
      }),
    )
  })

  await page.goto('/')
  await waitForApp(page)

  const effective = page.locator('.effective-time')
  await expect(effective).toHaveText('Effective 12.25')
  const dimensions = await effective.evaluate((element) => ({
    display: getComputedStyle(element).display,
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }))
  expect(dimensions.display).not.toBe('none')
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1)
})

test('alerts, accent, and controls settings apply and persist', async ({
  page,
}) => {
  await page.goto('/')
  await waitForApp(page)

  const settings = await openSettings(page)
  await expect(settings.getByText('Controls', { exact: true })).toBeVisible()
  await expect(
    settings.getByText('Hold to arm, release to start; press again to stop.'),
  ).toBeVisible()

  await settings.getByTestId('alert-channel').selectOption('visual')
  await settings.getByTestId('inspection-warning').selectOption('8s')
  await settings.getByTestId('accent-color').selectOption('blue')
  await settings.getByTestId('settings-done').click()
  await expect(settings).toBeHidden()

  const shell = page.locator('.app-shell')
  await expect(shell).toHaveAttribute('data-accent', 'blue')
  expect(
    await shell.evaluate((element) =>
      getComputedStyle(element).getPropertyValue('--accent').trim(),
    ),
  ).toBe('#1f5f99')

  await recordSolve(page)
  await expect(page.locator('.timer-alert')).toHaveClass(/is-success/)

  await page.reload()
  await waitForApp(page)
  const reopened = await openSettings(page)
  await expect(reopened.getByTestId('alert-channel')).toHaveValue('visual')
  await expect(reopened.getByTestId('inspection-warning')).toHaveValue('8s')
  await expect(reopened.getByTestId('accent-color')).toHaveValue('blue')
})

test('inspection warning fires at the configured threshold', async ({ page }) => {
  await page.goto('/')
  await waitForApp(page)
  await page.clock.install()

  const settings = await openSettings(page)
  await settings.getByTestId('inspection-setting').click()
  await settings.getByTestId('inspection-warning').selectOption('8s')
  await settings.getByTestId('alert-channel').selectOption('visual')
  await settings.getByTestId('settings-done').click()
  await expect(settings).toBeHidden()

  await page.keyboard.press('Space')
  await expect(page.locator(TIMER)).toHaveAttribute('data-phase', 'inspection')
  await page.clock.fastForward(8_100)

  await expect(page.locator('.timer-alert')).toHaveClass(/is-warning/)
  await expect(page.locator('.sr-only[aria-live="polite"]')).toContainText(
    '8 seconds of inspection remaining.',
  )
})

test('DNF feedback uses the danger visual alert', async ({ page }) => {
  await page.goto('/')
  await waitForApp(page)
  await page.clock.install()

  const settings = await openSettings(page)
  await settings.getByTestId('inspection-setting').click()
  await settings.getByTestId('alert-channel').selectOption('visual')
  await settings.getByTestId('settings-done').click()
  await expect(settings).toBeHidden()

  await page.keyboard.press('Space')
  await expect(page.locator(TIMER)).toHaveAttribute('data-phase', 'inspection')
  await page.clock.fastForward(17_100)

  await page.keyboard.down('Space')
  await page.clock.fastForward(350)
  await page.keyboard.up('Space')
  await expect(page.locator(TIMER)).toHaveAttribute('data-phase', 'running')

  await page.clock.fastForward(1_000)
  await page.keyboard.press('Space')
  await expect(page.locator(TIMER)).toHaveAttribute('data-phase', 'idle')
  await expect(page.locator('.timer-alert')).toHaveClass(/is-danger/)
  await expect(page.locator('.sr-only[aria-live="polite"]')).toContainText(
    'Solve recorded. DNF.',
  )
})

test('statistics visibility and precision are display-only', async ({ page }) => {
  const now = Date.now()
  await page.addInitScript(
    ({ now }) => {
      const solves = Array.from({ length: 12 }, (_, index) => ({
        id: `stats-solve-${index}`,
        event: '333',
        rawMs: 10_000 + index * 1_000,
        penalty: 'none',
        scramble: "R U R' U'",
        createdAt: now - index * 1_000,
      }))
      localStorage.setItem(
        'cubelab:sessions:v1',
        JSON.stringify({
          version: 1,
          activeSessionId: 'stats-session',
          sessions: [
            {
              id: 'stats-session',
              name: 'Session 1',
              createdAt: now - 60_000,
              updatedAt: now,
              solves,
            },
          ],
        }),
      )
    },
    { now },
  )

  await page.goto('/')
  await waitForApp(page)

  const settings = await openSettings(page)
  await settings.getByTestId('stat-visible-mo3').uncheck()
  await settings.getByTestId('stat-precision').selectOption('tenths')
  await settings.getByTestId('settings-done').click()
  await expect(settings).toBeHidden()

  await expect(page.getByTestId('best-mo3')).toHaveCount(0)
  await expect(page.getByTestId('best-single')).toHaveText('10.0')

  const reopened = await openSettings(page)
  await reopened.getByTestId('stat-visible-single').uncheck()
  await reopened.getByTestId('stat-visible-ao5').uncheck()
  await reopened.getByTestId('stat-visible-ao12').uncheck()
  await reopened.getByTestId('settings-done').click()
  await expect(reopened).toBeHidden()

  await expect(page.locator('.stats-empty')).toBeVisible()
  await expect(page.locator('.quick-stats')).toHaveCount(0)
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

test('narrow mobile layout keeps settings and session touch targets', async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 320, height: 700 },
    hasTouch: true,
    isMobile: true,
  })
  const page = await context.newPage()

  await page.goto('/')
  await waitForApp(page)

  const settingsButton = page.getByTestId('settings-button')
  await expect(settingsButton).toBeVisible()
  const settingsButtonBox = await settingsButton.boundingBox()
  expect(settingsButtonBox).not.toBeNull()
  if (!settingsButtonBox) throw new Error('Settings button has no bounding box')
  expect(settingsButtonBox.height).toBeGreaterThanOrEqual(28)

  const settings = await openSettings(page)
  await expect(settings.getByText('Inspection', { exact: true })).toBeVisible()

  const inspectionSwitch = settings.getByRole('switch', {
    name: /Inspection/,
  })
  const switchBox = await inspectionSwitch.boundingBox()
  expect(switchBox).not.toBeNull()
  if (!switchBox) throw new Error('Inspection switch has no bounding box')
  expect(switchBox.height).toBeGreaterThanOrEqual(28)

  const settingsBox = await settings.boundingBox()
  expect(settingsBox).not.toBeNull()
  if (!settingsBox) throw new Error('Settings dialog has no bounding box')
  expect(settingsBox.width).toBeLessThanOrEqual(320)

  const settingsBody = await settings.locator('.settings-body').evaluate(
    (element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    }),
  )
  expect(settingsBody.scrollHeight).toBeGreaterThan(settingsBody.clientHeight)
  await expect(settings.getByTestId('settings-done')).toBeVisible()

  const noHorizontalOverflowWithSettings = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth + 1,
  )
  expect(noHorizontalOverflowWithSettings).toBe(true)

  await settings.getByTestId('settings-done').click()
  await expect(settings).toBeHidden()

  const clearButton = page.getByRole('button', { name: 'Clear session' })
  const clearBox = await clearButton.boundingBox()
  expect(clearBox).not.toBeNull()
  if (!clearBox) throw new Error('Clear session has no bounding box')
  expect(clearBox.height).toBeGreaterThanOrEqual(28)

  const sessionSelectBox = await page.getByTestId('session-select').boundingBox()
  expect(sessionSelectBox).not.toBeNull()
  if (!sessionSelectBox) throw new Error('Session select has no bounding box')
  expect(sessionSelectBox.height).toBeGreaterThanOrEqual(28)

  const newSessionBox = await page.getByTestId('new-session').boundingBox()
  expect(newSessionBox).not.toBeNull()
  if (!newSessionBox) throw new Error('New session button has no bounding box')
  expect(newSessionBox.width).toBeGreaterThanOrEqual(28)
  expect(newSessionBox.height).toBeGreaterThanOrEqual(28)

  await recordSolve(page, 80)
  const miniButtonBoxes = await page.locator('.mini-button').evaluateAll((buttons) =>
    buttons.map((button) => {
      const rect = button.getBoundingClientRect()
      return { width: rect.width, height: rect.height }
    }),
  )
  expect(miniButtonBoxes.length).toBeGreaterThanOrEqual(3)
  for (const box of miniButtonBoxes) {
    expect(box.width).toBeGreaterThanOrEqual(28)
    expect(box.height).toBeGreaterThanOrEqual(28)
  }

  const noHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth + 1,
  )
  expect(noHorizontalOverflow).toBe(true)

  await context.close()
})

test('long desktop sessions scroll inside the history panel', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.addInitScript(() => {
    const now = Date.now()
    const solves = Array.from({ length: 120 }, (_, index) => ({
      id: `history-${index}`,
      event: '333',
      rawMs: 9000 + index,
      penalty: 'none',
      scramble: "R U R' U' F2 D L2 B' R2 U2 F R2",
      createdAt: now - index * 1000,
    }))
    localStorage.setItem(
      'cubelab:solves:v1',
      JSON.stringify({ version: 1, solves }),
    )
  })

  await page.goto('/')
  await waitForApp(page)
  await expect(page.getByTestId('solve-count')).toHaveText('120')
  await expect(page.locator('.history-row')).toHaveCount(120)

  await expect
    .poll(async () => (await storedSessions(page))?.sessions[0]?.solves.length)
    .toBe(120)
  const migrated = await storedSessions(page)
  expect(migrated?.sessions).toHaveLength(1)
  expect(migrated?.sessions[0]?.name).toBe('Session 1')

  const metrics = await page.locator('.history-scroll').evaluate((element) => ({
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
    pageHeight: document.documentElement.scrollHeight,
    viewportHeight: window.innerHeight,
  }))
  expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight)
  expect(metrics.pageHeight).toBeLessThanOrEqual(metrics.viewportHeight + 1)
})

test('named sessions create, switch, rename, delete, and persist', async ({
  page,
}) => {
  await page.goto('/')
  await waitForApp(page)

  const select = page.getByTestId('session-select')
  await expect(page.getByTestId('solve-count')).toHaveText('0')
  expect(await selectedSessionName(page)).toBe('Session 1')

  await recordSolve(page, 100)
  await expect(page.getByTestId('solve-count')).toHaveText('1')

  await page.getByTestId('new-session').click()
  const input = page.getByRole('textbox', { name: 'Session name' })
  await expect(input).toBeVisible()
  await expect(input).toHaveValue('Session 2')
  await expect(input).toBeFocused()

  // Duplicate names are rejected case-insensitively without closing the form.
  await input.fill('session 1')
  await page.getByTestId('save-session-name').click()
  await expect(page.getByTestId('session-error')).toHaveText(
    'Session names must be unique.',
  )
  await expect(input).toBeVisible()

  await input.fill('Evening')
  await page.getByTestId('save-session-name').click()
  await expect(page.getByTestId('session-error')).toHaveCount(0)
  expect(await selectedSessionName(page)).toBe('Evening')
  await expect(page.getByTestId('solve-count')).toHaveText('0')
  await expect(select).toBeFocused()

  // Space still controls the timer while the session select is focused.
  await recordSolve(page, 100)
  await expect(page.getByTestId('solve-count')).toHaveText('1')

  await select.selectOption({ label: 'Session 1' })
  expect(await selectedSessionName(page)).toBe('Session 1')
  await expect(page.getByTestId('solve-count')).toHaveText('1')

  await page.getByTestId('rename-session').click()
  const renameInput = page.getByRole('textbox', { name: 'Session name' })
  await expect(renameInput).toHaveValue('Session 1')
  await renameInput.fill('Morning')
  await page.getByTestId('save-session-name').click()
  expect(await selectedSessionName(page)).toBe('Morning')
  await expect(select).toBeFocused()

  await page.reload()
  await waitForApp(page)
  expect(await selectedSessionName(page)).toBe('Morning')
  await expect(page.getByTestId('solve-count')).toHaveText('1')

  await page.getByTestId('delete-session').click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(
    dialog.getByRole('heading', { name: /Delete .*Morning/ }),
  ).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Keep session' })).toBeFocused()
  await dialog.getByRole('button', { name: 'Keep session' }).click()
  expect(await selectedSessionName(page)).toBe('Morning')
  await expect(page.getByTestId('solve-count')).toHaveText('1')

  await page.getByTestId('delete-session').click()
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Delete session' }).click()
  await expect(page.getByRole('status')).toContainText('Session deleted')
  expect(await selectedSessionName(page)).toBe('Evening')
  await expect(page.getByTestId('solve-count')).toHaveText('1')
  await expect(page.getByTestId('delete-session')).toBeDisabled()

  await expect
    .poll(async () => (await storedSessions(page))?.sessions.length)
    .toBe(1)
  const persisted = await storedSessions(page)
  expect(persisted?.sessions[0]?.name).toBe('Evening')
  expect(persisted?.sessions[0]?.solves).toHaveLength(1)

  await page.reload()
  await waitForApp(page)
  expect(await selectedSessionName(page)).toBe('Evening')
  await expect(page.getByTestId('solve-count')).toHaveText('1')
})

test('session controls lock while the timer is active', async ({ page }) => {
  await page.goto('/')
  await waitForApp(page)

  const select = page.getByTestId('session-select')
  await expect(select).toBeEnabled()

  await holdSpace(page)
  await expect(select).toBeDisabled()
  await expect(page.getByTestId('new-session')).toBeDisabled()
  await expect(page.getByTestId('rename-session')).toBeDisabled()
  await expect(page.getByTestId('settings-button')).toBeDisabled()

  await stopWithSpace(page)
  await expect(select).toBeEnabled()
  await expect(page.getByTestId('new-session')).toBeEnabled()
  await expect(page.getByTestId('settings-button')).toBeEnabled()
})

test('backup export and import restore all sessions and settings', async ({
  page,
}) => {
  await page.goto('/')
  await waitForApp(page)

  await recordSolve(page, 100)
  await page.getByTestId('new-session').click()
  await page
    .getByRole('textbox', { name: 'Session name' })
    .fill('Evening')
  await page.getByTestId('save-session-name').click()
  await recordSolve(page, 100)

  const settings = await openSettings(page)
  const inspectionSwitch = settings.getByRole('switch', { name: /Inspection/ })
  await inspectionSwitch.click()
  await expect(inspectionSwitch).toHaveAttribute('aria-checked', 'true')
  await settings.getByTestId('settings-done').click()
  await expect(settings).toBeHidden()

  const dialog = await openBackup(page)
  await expect(dialog.locator('.data-summary')).toContainText('2 sessions')
  await expect(dialog.locator('.data-summary')).toContainText('2 solves')

  // Invalid files fail inline and leave the dialog open.
  await page.getByTestId('backup-file-input').setInputFiles({
    name: 'broken.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{not valid json'),
  })
  await expect(page.getByTestId('backup-error')).toHaveText(
    'That file is not valid JSON.',
  )
  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByTestId('settings-button')).toBeFocused()

  const backupDialog = await openBackup(page)
  const downloadPromise = page.waitForEvent('download')
  await backupDialog.getByTestId('export-backup').click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(
    /^cubelab-backup-\d{4}-\d{2}-\d{2}\.json$/,
  )
  const downloadPath = await download.path()
  expect(downloadPath).not.toBeNull()
  if (!downloadPath) throw new Error('Backup download has no path')

  const backup = JSON.parse(readFileSync(downloadPath, 'utf8')) as {
    app: string
    format: string
    version: number
    sessions: { activeSessionId: string; sessions: StoredSession[] }
    settings: { inspectionEnabled: boolean }
  }
  expect(backup.app).toBe('CubeLab')
  expect(backup.format).toBe('cubelab-backup')
  expect(backup.version).toBe(1)
  expect(backup.sessions.sessions).toHaveLength(2)
  expect(backup.sessions.sessions.map((session) => session.name)).toEqual([
    'Session 1',
    'Evening',
  ])
  expect(
    backup.sessions.sessions.reduce(
      (total, session) => total + session.solves.length,
      0,
    ),
  ).toBe(2)
  expect(backup.settings.inspectionEnabled).toBe(true)
  await expect(dialog).toBeHidden()

  // Start from empty local data so the restore is observable.
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await waitForApp(page)
  expect(await selectedSessionName(page)).toBe('Session 1')
  await expect(page.getByTestId('solve-count')).toHaveText('0')
  const emptySettings = await openSettings(page)
  await expect(
    emptySettings.getByRole('switch', { name: /Inspection/ }),
  ).toHaveAttribute('aria-checked', 'false')
  await emptySettings.getByTestId('settings-done').click()
  await expect(emptySettings).toBeHidden()

  // Importing requires explicit confirmation; cancelling keeps local data.
  await openBackup(page)
  await page.getByTestId('backup-file-input').setInputFiles(downloadPath)
  const cancelDialog = page.getByRole('dialog')
  await expect(cancelDialog).toBeVisible()
  await expect(
    cancelDialog.getByRole('heading', { name: 'Replace local sessions?' }),
  ).toBeVisible()
  await expect(cancelDialog).toContainText('2 sessions')
  await expect(cancelDialog).toContainText('2 solves')
  await expect(
    cancelDialog.getByRole('button', { name: 'Cancel import' }),
  ).toBeFocused()
  await cancelDialog.getByRole('button', { name: 'Cancel import' }).click()
  await expect(page.getByTestId('settings-button')).toBeFocused()
  expect(await selectedSessionName(page)).toBe('Session 1')
  await expect(page.getByTestId('solve-count')).toHaveText('0')
  await expect(page.getByTestId('session-select').locator('option')).toHaveCount(
    1,
  )

  await openBackup(page)
  await page.getByTestId('backup-file-input').setInputFiles(downloadPath)
  const importDialog = page.getByRole('dialog')
  await expect(
    importDialog.getByRole('heading', { name: 'Replace local sessions?' }),
  ).toBeVisible()
  await importDialog.getByRole('button', { name: 'Import backup' }).click()
  await expect(page.getByRole('status')).toContainText('Backup imported')
  await expect(page.getByTestId('settings-button')).toBeFocused()
  expect(await selectedSessionName(page)).toBe('Evening')
  await expect(page.getByTestId('solve-count')).toHaveText('1')
  await expect(page.getByTestId('session-select').locator('option')).toHaveCount(
    2,
  )
  const importedSettings = await openSettings(page)
  await expect(
    importedSettings.getByRole('switch', { name: /Inspection/ }),
  ).toHaveAttribute('aria-checked', 'true')
  await importedSettings.getByTestId('settings-done').click()
  await expect(importedSettings).toBeHidden()

  await page.getByTestId('session-select').selectOption({ label: 'Session 1' })
  await expect(page.getByTestId('solve-count')).toHaveText('1')

  await page.reload()
  await waitForApp(page)
  expect(await selectedSessionName(page)).toBe('Session 1')
  await expect(page.getByTestId('solve-count')).toHaveText('1')
  const persistedSettings = await openSettings(page)
  await expect(
    persistedSettings.getByRole('switch', { name: /Inspection/ }),
  ).toHaveAttribute('aria-checked', 'true')
  await persistedSettings.getByTestId('settings-done').click()
  await expect(persistedSettings).toBeHidden()
})

test('scramble failure disables timing and offers retry', async ({ page }) => {
  await page.route('**/search-worker-entry*', (route) => route.abort())
  await page.goto('/')

  const error = page.locator('.scramble-error')
  await expect(error).toBeVisible({ timeout: 30_000 })
  await expect(error).toContainText('Could not generate a scramble')
  await expect(page.locator('.queue-label')).toContainText('Scramble unavailable')
  await expect(page.locator('.timer-hint')).toContainText('Scramble unavailable')
  await expect(page.locator(TIMER)).toBeDisabled()
  await expect(page.locator(TIMER)).toHaveAttribute(
    'aria-label',
    /Scramble unavailable/,
  )
  await expect(error.getByRole('button', { name: 'Retry', exact: true })).toBeVisible()
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
