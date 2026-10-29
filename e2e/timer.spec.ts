import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { CUBELAB_EVENTS, type CubeLabEvent } from '../src/lib/events'

const TIMER = '[data-testid="timer-surface"]'

interface StoredSolve {
  id: string
  event: string
  scramble: string
  penalty: string
  comment: string
}

interface StoredSession {
  id: string
  name: string
  event?: string
  solves: StoredSolve[]
  inspectionEnabled?: boolean
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

/**
 * Waits until the visible scramble is no longer the one captured before an
 * event/session switch and both queue slots are filled again. Without this,
 * the new event's badge can render for a frame while the previous event's
 * scramble is still on screen.
 */
async function waitForFreshEventScramble(page: Page, previous: string) {
  await expect
    .poll(
      async () =>
        (await page.locator('.scramble-text').allInnerTexts())[0] ?? '',
      { timeout: 30_000 },
    )
    .not.toBe(previous)
  await expect(page.locator('.queue-label')).toContainText('Queue ready', {
    timeout: 30_000,
  })
  await expect(page.locator('.scramble-text')).toBeVisible()
}

async function storedSessions(page: Page): Promise<StoredSessions | null> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('cubelab:sessions:v1')
    return raw ? (JSON.parse(raw) as StoredSessions) : null
  })
}

async function storedSolves(page: Page): Promise<StoredSolve[]> {
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

async function openSessionSettings(page: Page) {
  await page.getByTestId('session-settings').click()
  const dialog = page.getByRole('dialog', { name: 'Session settings' })
  await expect(dialog).toBeVisible()
  return dialog
}

async function openFirstSolveMenu(page: Page) {
  await page.locator('[data-testid="history-main"]').first().click()
  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible()
  return menu
}

/**
 * Exercises one puzzle event end to end: switch (if needed), generate
 * scrambles, record three solves, apply +2 then DNF to the newest solve, check
 * WCA statistics, and verify the session, event, scrambles, and penalty
 * survive a reload.
 */
async function runEventScenario(page: Page, event: CubeLabEvent) {
  await page.goto('/')
  await waitForApp(page)

  if (event.id !== '333') {
    const previousScramble = await page.locator('.scramble-text').innerText()
    const sessionDialog = await openSessionSettings(page)
    await sessionDialog.locator('select').selectOption(event.id)
    await sessionDialog.getByTestId('session-settings-done').click()
    await expect(sessionDialog).toBeHidden()
    await waitForFreshEventScramble(page, previousScramble)
  }

  await expect(page.locator('.scramble-badge')).toContainText(
    `${event.label} · scramble`,
  )
  await expect(page.locator('.header-context .context-meta')).toContainText(
    event.label,
  )

  const scrambles: string[] = []
  for (let index = 0; index < 3; index += 1) {
    const scramble = await page.locator('.scramble-text').innerText()
    scrambles.push(scramble)
    await recordSolve(page, 90)
    if (index < 2) {
      await waitForFreshEventScramble(page, scramble)
    }
  }

  expect(new Set(scrambles).size).toBe(3)
  await expect(page.getByTestId('solve-count')).toHaveText('3')

  const newestRow = page.locator('[data-testid="history-row"]').first()
  await newestRow.getByTestId('solve-plus-two').click()
  await expect(newestRow.locator('.history-time')).toContainText('+2')
  await newestRow.getByTestId('solve-dnf').click()
  await expect(newestRow.locator('.history-time')).toContainText('DNF')

  // A DNF makes mo3 a DNF, while the best single still comes from the valid
  // solves. This is the same WCA rule for every event.
  await expect(page.getByTestId('best-single')).not.toHaveText('—')
  await expect(
    page.locator('.stat-tile').filter({ hasText: 'mo3' }).locator('.stat-latest'),
  ).toContainText('DNF')

  const stored = await storedSessions(page)
  const active = stored?.sessions.find(
    (session) => session.id === stored.activeSessionId,
  )
  expect(active?.event ?? '333').toBe(event.id)
  expect(active?.solves.map((solve) => solve.event)).toEqual([
    event.id,
    event.id,
    event.id,
  ])
  expect(active?.solves.map((solve) => solve.scramble)).toEqual(
    [...scrambles].reverse(),
  )
  expect(active?.solves[0]?.penalty).toBe('dnf')

  await page.reload()
  await waitForApp(page)
  await expect(page.getByTestId('solve-count')).toHaveText('3')
  await expect(page.locator('.scramble-badge')).toContainText(
    `${event.label} · scramble`,
  )
  await expect(
    page.locator('[data-testid="history-row"]').first().locator('.history-time'),
  ).toContainText('DNF')

  const reloaded = await storedSessions(page)
  expect(
    reloaded?.sessions.find(
      (session) => session.id === reloaded.activeSessionId,
    )?.event ?? '333',
  ).toBe(event.id)

  const noHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth + 1,
  )
  expect(noHorizontalOverflow).toBe(true)
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
  expect(solves[0]?.scramble).toBe(firstScramble)
})

test('solve menu handles penalties, comments, copying, undo, and typed clear', async ({
  page,
  context,
  browserName,
}) => {
  if (browserName === 'chromium') {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  }
  await page.goto('/')
  await waitForApp(page)
  await recordSolve(page, 120)

  const row = page.locator('[data-testid="history-row"]').first()
  await expect(row.getByTestId('solve-plus-two')).toBeVisible()
  await expect(row.getByTestId('solve-dnf')).toBeVisible()

  const inlinePlusTwo = row.getByTestId('solve-plus-two')
  const inlineDnf = row.getByTestId('solve-dnf')
  await inlinePlusTwo.click()
  await expect(row.locator('.history-time')).toContainText('+2')
  await inlinePlusTwo.click()
  await expect(row.locator('.history-time')).not.toContainText('+2')

  await inlineDnf.click()
  await expect(row.locator('.history-time')).toContainText('DNF')
  await inlineDnf.click()
  await expect(row.locator('.history-time')).not.toContainText('DNF')

  let menu = await openFirstSolveMenu(page)
  await expect(menu).toContainText('Solve #1')
  await menu.getByRole('menuitem', { name: 'Add +2 penalty' }).click()
  await expect(menu).toBeHidden()
  await expect(row.locator('.history-time')).toContainText('+2')

  let solves = await storedSolves(page)
  expect(solves[0]?.penalty).toBe('+2')

  await page.reload()
  await waitForApp(page)
  await expect(page.getByTestId('solve-count')).toHaveText('1')

  menu = await openFirstSolveMenu(page)
  await expect(
    menu.getByRole('menuitem', { name: 'Remove +2 penalty' }),
  ).toBeVisible()
  await menu.getByRole('menuitem', { name: 'Add comment' }).click()
  const commentBox = page.getByRole('textbox', { name: 'Solve comment' })
  await expect(commentBox).toBeFocused()
  await commentBox.fill('  Locked up on F2L  ')
  await page.getByRole('button', { name: 'Save comment' }).click()
  await expect(page.getByRole('status')).toContainText('Solve comment saved')
  await expect(row.locator('.history-comment')).toHaveText('Locked up on F2L')

  solves = await storedSolves(page)
  expect(solves[0]?.comment).toBe('Locked up on F2L')
  const scramble = solves[0]?.scramble ?? ''

  menu = await openFirstSolveMenu(page)
  await expect(menu).toContainText('Locked up on F2L')
  await menu.getByRole('menuitem', { name: 'Copy scramble' }).click()
  await expect(page.getByRole('status')).toContainText(
    'Scramble copied to clipboard',
  )
  if (browserName === 'chromium') {
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe(scramble)
  }

  menu = await openFirstSolveMenu(page)
  await menu.getByRole('menuitem', { name: 'Delete solve' }).click()
  await expect(page.getByTestId('solve-count')).toHaveText('0')
  await expect(page.getByRole('status')).toContainText('Solve deleted')
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(page.getByTestId('solve-count')).toHaveText('1')
  await expect(page.locator('.history-comment')).toHaveText('Locked up on F2L')

  // Clear lives in per-session settings and requires the exact typed phrase.
  const sessionDialog = await openSessionSettings(page)
  await sessionDialog.getByTestId('session-clear').click()
  const confirm = page.getByRole('dialog', { name: 'Delete every solve?' })
  await expect(confirm).toBeVisible()
  const typed = confirm.getByTestId('confirm-text')
  await expect(typed).toBeFocused()
  const clearButton = confirm.getByRole('button', { name: 'Clear session' })
  await expect(clearButton).toBeDisabled()

  await typed.fill('clear this session')
  await expect(clearButton).toBeDisabled()
  await typed.fill('CLEAR THIS SESSION')
  await expect(clearButton).toBeEnabled()
  await clearButton.click()

  await expect(page.getByRole('status')).toContainText('Session cleared')
  await expect(page.getByTestId('solve-count')).toHaveText('0')
  await expect(sessionDialog).toBeHidden()
  expect(await storedSolves(page)).toHaveLength(0)
})

test('inspection supports count-down, count-up, and independent warnings', async ({
  page,
}) => {
  await page.goto('/')
  await waitForApp(page)
  await page.clock.install()

  let settings = await openSettings(page)
  await settings.getByTestId('inspection-setting').click()
  await settings.getByTestId('inspection-direction').selectOption('down')
  await expect(settings.getByTestId('inspection-warning-8s').locator('..')).toContainText(
    '7 seconds remaining',
  )
  await expect(settings.getByTestId('inspection-warning-12s').locator('..')).toContainText(
    '3 seconds remaining',
  )
  await settings.getByTestId('inspection-warning-8s').check()
  await settings.getByTestId('inspection-warning-12s').check()
  // Inspection warnings keep their visual pulse regardless of the channel.
  await settings.getByTestId('alert-channel').selectOption('visual')
  await settings.getByTestId('settings-done').click()
  await expect(settings).toBeHidden()

  await page.keyboard.press('Space')
  await expect(page.locator(TIMER)).toHaveAttribute('data-phase', 'inspection')
  await expect(page.getByTestId('timer-display')).toHaveText('15')

  await page.clock.fastForward(8_100)
  await expect(page.getByTestId('timer-display')).toHaveText('7')
  await expect(page.locator('.timer-alert')).toHaveClass(/is-warning/)
  await expect(page.locator('.sr-only[aria-live="polite"]')).toContainText(
    '7 seconds remaining',
  )

  await page.clock.fastForward(4_000)
  await expect(page.getByTestId('timer-display')).toHaveText('3')
  await expect(page.locator('.timer-alert')).toHaveClass(/is-danger/)
  await expect(page.locator('.sr-only[aria-live="polite"]')).toContainText(
    '3 seconds remaining',
  )

  await page.keyboard.press('Escape')
  await expect(page.locator(TIMER)).toHaveAttribute('data-phase', 'idle')

  settings = await openSettings(page)
  await settings.getByTestId('inspection-direction').selectOption('up')
  await settings.getByTestId('settings-done').click()
  await expect(settings).toBeHidden()

  await page.keyboard.press('Space')
  await expect(page.getByTestId('timer-display')).toHaveText('0')
  await page.clock.fastForward(8_100)
  await expect(page.getByTestId('timer-display')).toHaveText('8')
  await expect(page.locator('.timer-alert')).toHaveClass(/is-warning/)
  await expect(page.locator('.sr-only[aria-live="polite"]')).toContainText('8 seconds')

  await page.clock.fastForward(4_000)
  await expect(page.getByTestId('timer-display')).toHaveText('12')
  await expect(page.locator('.timer-alert')).toHaveClass(/is-danger/)

  await page.keyboard.press('Escape')
  const stored = await page.evaluate(() => {
    const raw = localStorage.getItem('cubelab:settings:v1')
    return raw ? (JSON.parse(raw) as { settings: Record<string, unknown> }) : null
  })
  expect(stored?.settings.inspectionCountDirection).toBe('up')
  expect(stored?.settings.inspectionWarning8s).toBe(true)
  expect(stored?.settings.inspectionWarning12s).toBe(true)
})

test('inspection warnings stay visible with sound-only alerts', async ({
  page,
}) => {
  await page.goto('/')
  await waitForApp(page)
  await page.clock.install()

  const settings = await openSettings(page)
  await settings.getByTestId('inspection-setting').click()
  await settings.getByTestId('alert-channel').selectOption('sound')
  await settings.getByTestId('inspection-warning-8s').check()
  await settings.getByTestId('settings-done').click()
  await expect(settings).toBeHidden()

  await page.keyboard.press('Space')
  await expect(page.locator(TIMER)).toHaveAttribute('data-phase', 'inspection')
  await page.clock.fastForward(8_100)

  await expect(page.locator('.timer-alert')).toBeVisible()
  await expect(page.locator('.timer-alert')).toHaveClass(/is-warning/)
  await expect(page.locator('.sr-only[aria-live="polite"]')).toContainText(
    '7 seconds remaining',
  )
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

test('optional any-key stop records exactly one solve and persists', async ({
  page,
}) => {
  await page.goto('/')
  await waitForApp(page)

  let settings = await openSettings(page)
  const toggle = settings.getByTestId('stop-with-any-key')
  await expect(toggle).not.toBeChecked()
  await toggle.check()
  await settings.getByTestId('settings-done').click()
  await expect(settings).toBeHidden()

  await holdSpace(page)
  await page.keyboard.press('a')
  await expect(page.locator(TIMER)).toHaveAttribute('data-phase', 'idle')
  await expect(page.getByTestId('solve-count')).toHaveText('1')

  await page.reload()
  await waitForApp(page)
  settings = await openSettings(page)
  await expect(settings.getByTestId('stop-with-any-key')).toBeChecked()
  await settings.getByTestId('stop-with-any-key').uncheck()
  await settings.getByTestId('settings-done').click()
  await expect(settings).toBeHidden()

  await holdSpace(page)
  await page.keyboard.press('a')
  await expect(page.locator(TIMER)).toHaveAttribute('data-phase', 'running')
  await stopWithSpace(page)
  await expect(page.getByTestId('solve-count')).toHaveText('2')
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
  expect(zoomedOut.shell.height).toBeGreaterThanOrEqual(
    zoomedOut.innerHeight - 1,
  )

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
  context,
  browserName,
}) => {
  if (browserName === 'chromium') {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  }
  await page.goto('/')
  await waitForApp(page)

  const initialScramble = await page.locator('.scramble-text').innerText()
  const scrambleBody = page.locator('.scramble-body')
  const bodyBox = await scrambleBody.boundingBox()
  expect(bodyBox).not.toBeNull()
  if (!bodyBox) throw new Error('Scramble body has no bounding box')
  await page.mouse.click(bodyBox.x + 4, bodyBox.y + bodyBox.height / 2)
  await expect(page.getByRole('status')).toContainText(
    'Scramble copied to clipboard',
  )
  if (browserName === 'chromium') {
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe(initialScramble)
  }

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
  await scrambleBody.focus()
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
        version: 2,
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
                comment: '',
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
  const volume = settings.getByTestId('alert-volume')
  await expect(volume).toHaveValue('70')
  await volume.press('ArrowRight')
  await volume.press('ArrowRight')
  await volume.press('ArrowRight')
  await expect(volume).toHaveValue('85')
  await settings.getByTestId('inspection-direction').selectOption('up')
  await settings.getByTestId('inspection-warning-8s').check()
  await settings.getByTestId('inspection-warning-12s').check()
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
  await expect(reopened.getByTestId('alert-volume')).toHaveValue('85')
  await expect(reopened.getByTestId('inspection-direction')).toHaveValue('up')
  await expect(reopened.getByTestId('inspection-warning-8s')).toBeChecked()
  await expect(reopened.getByTestId('inspection-warning-12s')).toBeChecked()
  await expect(reopened.getByTestId('accent-color')).toHaveValue('blue')
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

test('expanded and custom statistics are display-only and persist', async ({
  page,
}) => {
  const now = Date.now()
  await page.addInitScript(
    ({ now }) => {
      const solves = Array.from({ length: 130 }, (_, index) => ({
        id: `stats-solve-${index}`,
        event: '333',
        rawMs: 10_000 + index * 100,
        penalty: 'none',
        scramble: "R U R' U'",
        comment: '',
        createdAt: now - index * 1_000,
      }))
      localStorage.setItem(
        'cubelab:sessions:v1',
        JSON.stringify({
          version: 2,
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

  let settings = await openSettings(page)
  await settings.getByTestId('stat-visible-mo3').uncheck()
  await settings.getByTestId('stat-visible-ao25').check()
  await settings.getByTestId('stat-visible-ao100').check()
  await settings.getByTestId('stat-precision').selectOption('tenths')
  await settings.getByTestId('add-custom-average').click()
  const customSize = settings.getByTestId('custom-average-size-0')
  await expect(customSize).toHaveValue('6')

  // Typing a multi-digit size must not clamp or reject intermediate digits.
  await customSize.fill('')
  await customSize.pressSequentially('101')
  await expect(customSize).toHaveValue('101')
  await customSize.press('Enter')
  await expect(customSize).toHaveValue('101')

  await customSize.fill('7')
  await customSize.press('Enter')
  await expect(customSize).toHaveValue('7')

  // A validation error does not survive closing and reopening Settings.
  await customSize.fill('5')
  await customSize.press('Enter')
  await expect(settings.getByRole('alert')).toContainText(
    'ao5 is already available above.',
  )
  await settings.getByTestId('settings-done').click()
  await expect(settings).toBeHidden()

  await expect(page.getByTestId('best-mo3')).toHaveCount(0)
  await expect(page.getByTestId('best-single')).toHaveText('10.0')
  await expect(page.getByTestId('best-ao25')).toBeVisible()
  await expect(page.getByTestId('best-ao100')).toBeVisible()
  await expect(page.getByTestId('best-ao7')).toBeVisible()

  settings = await openSettings(page)
  await expect(settings.getByTestId('stat-visible-mo3')).not.toBeChecked()
  await expect(settings.getByTestId('stat-visible-ao25')).toBeChecked()
  await expect(settings.getByTestId('stat-visible-ao100')).toBeChecked()
  await expect(settings.getByTestId('custom-average-size-0')).toHaveValue('7')
  await expect(settings.getByRole('alert')).toHaveCount(0)

  await settings.getByTestId('stat-visible-single').uncheck()
  await settings.getByTestId('stat-visible-ao5').uncheck()
  await settings.getByTestId('stat-visible-ao12').uncheck()
  await settings.getByTestId('stat-visible-ao25').uncheck()
  await settings.getByTestId('stat-visible-ao100').uncheck()
  await settings.getByTestId('custom-average-visible-0').uncheck()
  await settings.getByTestId('settings-done').click()
  await expect(settings).toBeHidden()

  await expect(page.locator('.stats-empty')).toBeVisible()
  await expect(page.locator('.quick-stats')).toHaveCount(0)
})

test('mobile layout supports hold-to-time pointer controls', async ({
  browser,
  browserName,
}) => {
  test.skip(
    browserName !== 'chromium',
    'Pointer hold-to-time emulation is only exercised in Chromium.',
  )
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

test('narrow mobile layout keeps settings, session, and solve-menu targets usable', async ({
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

  const sessionSettingsButton = page.getByTestId('session-settings')
  const sessionSettingsBox = await sessionSettingsButton.boundingBox()
  expect(sessionSettingsBox).not.toBeNull()
  if (!sessionSettingsBox) {
    throw new Error('Session settings button has no bounding box')
  }
  expect(sessionSettingsBox.width).toBeGreaterThanOrEqual(28)
  expect(sessionSettingsBox.height).toBeGreaterThanOrEqual(28)

  const sessionSelectBox = await page.getByTestId('session-select').boundingBox()
  expect(sessionSelectBox).not.toBeNull()
  if (!sessionSelectBox) throw new Error('Session select has no bounding box')
  expect(sessionSelectBox.height).toBeGreaterThanOrEqual(28)

  const newSessionBox = await page.getByTestId('new-session').boundingBox()
  expect(newSessionBox).not.toBeNull()
  if (!newSessionBox) throw new Error('New session button has no bounding box')
  expect(newSessionBox.width).toBeGreaterThanOrEqual(28)
  expect(newSessionBox.height).toBeGreaterThanOrEqual(28)

  const sessionDialog = await openSessionSettings(page)
  const sessionDialogBox = await sessionDialog.boundingBox()
  expect(sessionDialogBox).not.toBeNull()
  if (!sessionDialogBox) throw new Error('Session dialog has no bounding box')
  expect(sessionDialogBox.width).toBeLessThanOrEqual(320)
  const sessionSwitchBox = await sessionDialog
    .getByTestId('session-inspection-setting')
    .boundingBox()
  expect(sessionSwitchBox).not.toBeNull()
  if (!sessionSwitchBox) throw new Error('Session switch has no bounding box')
  expect(sessionSwitchBox.height).toBeGreaterThanOrEqual(28)
  await sessionDialog.getByTestId('session-settings-done').click()
  await expect(sessionDialog).toBeHidden()

  await recordSolve(page, 80)
  const row = page.locator('[data-testid="history-row"]').first()
  await row.scrollIntoViewIfNeeded()
  await row.locator('[data-testid="history-main"]').click()
  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible()
  const menuBox = await menu.boundingBox()
  expect(menuBox).not.toBeNull()
  if (!menuBox) throw new Error('Solve menu has no bounding box')
  expect(menuBox.width).toBeLessThanOrEqual(320)
  expect(menuBox.x).toBeGreaterThanOrEqual(0)
  expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(320)

  const actionBoxes = await menu
    .getByRole('menuitem')
    .evaluateAll((items) =>
      items.map((item) => {
        const rect = item.getBoundingClientRect()
        return { width: rect.width, height: rect.height }
      }),
    )
  expect(actionBoxes.length).toBeGreaterThanOrEqual(6)
  for (const box of actionBoxes) {
    expect(box.height).toBeGreaterThanOrEqual(28)
  }

  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()

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
      comment: '',
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

test('large histories window rows without losing actions or access', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.addInitScript(() => {
    const now = Date.now()
    const solves = Array.from({ length: 2000 }, (_, index) => ({
      id: `history-${index}`,
      event: '333',
      rawMs: 9000 + index,
      penalty: 'none',
      scramble: "R U R' U' F2 D L2 B' R2 U2 F R2",
      comment: index % 53 === 0 ? 'A persisted comment that makes this row taller.' : '',
      createdAt: now - index * 1000,
    }))
    localStorage.setItem(
      'cubelab:sessions:v1',
      JSON.stringify({
        version: 4,
        activeSessionId: 'history-session',
        sessions: [
          {
            id: 'history-session',
            name: 'Session 1',
            event: '333',
            createdAt: now,
            updatedAt: now,
            solves,
          },
        ],
      }),
    )
  })

  await page.goto('/')
  await waitForApp(page)
  await expect(page.getByTestId('solve-count')).toHaveText('2000')

  const list = page.getByTestId('history-list')
  await expect(list).toHaveAttribute('data-virtualized', 'true')
  const rows = page.locator('[data-testid="history-row"]')
  expect(await rows.count()).toBeLessThan(100)
  expect(await rows.count()).toBeGreaterThan(0)
  await expect(rows.first()).toHaveAttribute('aria-setsize', '2000')

  // Scrolling reaches the oldest solve while keeping the rendered set small.
  const scroller = page.locator('.history-scroll')
  await scroller.evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })
  await expect(rows.last()).toHaveAttribute('data-solve-id', 'history-1999', {
    timeout: 10_000,
  })
  expect(await rows.count()).toBeLessThan(100)

  // Penalty toggles still work on a windowed row and persist.
  const oldest = rows.last()
  await oldest.getByTestId('solve-plus-two').click()
  await expect(oldest.locator('.history-time')).toContainText('+2')

  // Deletion and durable undo work without rendering every row.
  await oldest.locator('[data-testid="history-main"]').click()
  await page.getByRole('menu').getByRole('menuitem', { name: 'Delete solve' }).click()
  await expect(page.getByTestId('solve-count')).toHaveText('1999')
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(page.getByTestId('solve-count')).toHaveText('2000')

  // "Show all" restores full access for find-in-page and assistive technology.
  await scroller.evaluate((element) => {
    element.scrollTop = 0
  })
  await page.getByTestId('history-window-toggle').click()
  await expect(list).toHaveAttribute('data-virtualized', 'false')
  await expect(rows).toHaveCount(2000, { timeout: 30_000 })
  await page.getByTestId('history-window-toggle').click()
  await expect(list).toHaveAttribute('data-virtualized', 'true')

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth + 1,
  )
  expect(overflow).toBe(true)
})

test('large histories stay contained on mobile widths', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => {
    const now = Date.now()
    const solves = Array.from({ length: 2000 }, (_, index) => ({
      id: `history-${index}`,
      event: '333',
      rawMs: 9000 + index,
      penalty: 'none',
      scramble: "R U R' U' F2 D L2 B' R2 U2 F R2",
      comment: '',
      createdAt: now - index * 1000,
    }))
    localStorage.setItem(
      'cubelab:sessions:v1',
      JSON.stringify({
        version: 4,
        activeSessionId: 'history-session',
        sessions: [
          {
            id: 'history-session',
            name: 'Session 1',
            event: '333',
            createdAt: now,
            updatedAt: now,
            solves,
          },
        ],
      }),
    )
  })

  await page.goto('/')
  await waitForApp(page)
  await expect(page.getByTestId('solve-count')).toHaveText('2000')
  await expect(page.getByTestId('history-list')).toHaveAttribute(
    'data-virtualized',
    'true',
  )

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth + 1,
  )
  expect(overflow).toBe(true)
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
  await page.waitForTimeout(300)
  page.on('console', (msg) => console.error('BROWSER_CONSOLE:', msg.text()))
  page.on('pageerror', (err) => console.error('BROWSER_PAGEERROR:', err.message))
  await expect(page.getByTestId('new-session')).toBeEnabled()
  await page.getByTestId('new-session').click()
  const input = page.getByRole('textbox', { name: 'Session name' })
  await expect(input).toBeVisible()
  await expect(input).toHaveValue('3×3')
  await expect(input).toBeFocused()

  // Duplicate names are rejected case-insensitively without closing the dialog.
  await input.fill('session 1')
  await page.getByRole('button', { name: 'Create session', exact: true }).click()
  const sessionError = page.getByTestId('session-error')
  await expect(sessionError).toHaveAttribute('role', 'alert')
  await expect(sessionError).toContainText(
    'Session name already exists. Please choose a different name.',
  )
  await expect(sessionError.locator('svg')).toHaveCount(1)
  await expect(sessionError).toHaveCSS('color', 'rgb(198, 40, 40)')
  await expect(input).toHaveAttribute('aria-invalid', 'true')
  await expect(page.getByTestId('session-select').locator('option')).toHaveCount(1)
  await expect(input).toBeVisible()

  // The validation message and invalid highlight clear as soon as the name is
  // corrected, and the corrected name can be created.
  await input.fill('Evening')
  await expect(sessionError).toHaveCount(0)
  await expect(input).not.toHaveAttribute('aria-invalid', 'true')
  await page.getByRole('button', { name: 'Create session', exact: true }).click()
  await expect(page.getByTestId('session-error')).toHaveCount(0)
  expect(await selectedSessionName(page)).toBe('Evening')
  await expect(page.getByTestId('solve-count')).toHaveText('0')
  const activeElementId = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))
  console.error('SESSION_CREATE_ACTIVE_ELEMENT=' + (activeElementId ?? 'null'))
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

  const sessionDialog = await openSessionSettings(page)
  await sessionDialog.getByTestId('session-delete').click()
  const confirm = page.getByRole('dialog', { name: /Delete .*Morning/ })
  await expect(confirm).toBeVisible()
  await expect(confirm.getByRole('button', { name: 'Keep session' })).toBeVisible()
  await confirm.getByRole('button', { name: 'Keep session' }).click()
  await expect(confirm).toBeHidden()
  await expect(sessionDialog).toBeVisible()
  expect(await selectedSessionName(page)).toBe('Morning')
  await expect(page.getByTestId('solve-count')).toHaveText('1')

  await sessionDialog.getByTestId('session-delete').click()
  const deleteConfirm = page.getByRole('dialog', {
    name: /Delete .*Morning/,
  })
  const deleteButton = deleteConfirm.getByRole('button', {
    name: 'Delete session',
  })
  await expect(deleteButton).toBeDisabled()
  await deleteConfirm.getByTestId('confirm-text').fill('DELETE THIS SESSION')
  await expect(deleteButton).toBeEnabled()
  await deleteButton.click()

  await expect(page.getByRole('status')).toContainText('Session deleted')
  await expect(sessionDialog).toBeHidden()
  expect(await selectedSessionName(page)).toBe('Evening')
  await expect(page.getByTestId('solve-count')).toHaveText('1')

  const afterDelete = await openSessionSettings(page)
  await expect(afterDelete.getByTestId('session-delete')).toBeDisabled()
  await afterDelete.getByTestId('session-settings-done').click()
  await expect(afterDelete).toBeHidden()

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

test('per-session inspection overrides the global default and persists', async ({
  page,
}) => {
  await page.goto('/')
  await waitForApp(page)

  let settings = await openSettings(page)
  await expect(
    settings.getByRole('switch', { name: /Inspection/ }),
  ).toHaveAttribute('aria-checked', 'false')
  await settings.getByTestId('settings-done').click()
  await expect(settings).toBeHidden()

  let sessionDialog = await openSessionSettings(page)
  const sessionSwitch = sessionDialog.getByTestId('session-inspection-setting')
  await expect(sessionSwitch).toHaveAttribute('aria-checked', 'false')
  await sessionSwitch.click()
  await expect(sessionSwitch).toHaveAttribute('aria-checked', 'true')
  await sessionDialog.getByTestId('session-settings-done').click()
  await expect(sessionDialog).toBeHidden()
  await expect(page.getByTestId('settings-button')).toHaveAttribute(
    'aria-label',
    /Inspection on/,
  )

  // New sessions inherit the active session's effective inspection value.
  await page.getByTestId('new-session').click()
  await page.getByRole('textbox', { name: 'Session name' }).fill('Session 2')
  await page.getByRole('button', { name: 'Create session', exact: true }).click()
  expect(await selectedSessionName(page)).toBe('Session 2')

  sessionDialog = await openSessionSettings(page)
  await expect(
    sessionDialog.getByTestId('session-inspection-setting'),
  ).toHaveAttribute('aria-checked', 'true')
  await sessionDialog.getByTestId('session-inspection-setting').click()
  await sessionDialog.getByTestId('session-settings-done').click()
  await expect(page.getByTestId('settings-button')).toHaveAttribute(
    'aria-label',
    /Inspection off/,
  )

  await page.getByTestId('session-select').selectOption({ label: 'Session 1' })
  await expect(page.getByTestId('settings-button')).toHaveAttribute(
    'aria-label',
    /Inspection on/,
  )

  await page.reload()
  await waitForApp(page)
  await expect(page.getByTestId('settings-button')).toHaveAttribute(
    'aria-label',
    /Inspection on/,
  )
  await page.getByTestId('session-select').selectOption({ label: 'Session 2' })
  await expect(page.getByTestId('settings-button')).toHaveAttribute(
    'aria-label',
    /Inspection off/,
  )

  // The global default remains unchanged.
  settings = await openSettings(page)
  await expect(
    settings.getByRole('switch', { name: /Inspection/ }),
  ).toHaveAttribute('aria-checked', 'false')
})

test('per-session inspection can be cleared back to the global setting', async ({
  page,
}) => {
  await page.goto('/')
  await waitForApp(page)

  let sessionDialog = await openSessionSettings(page)
  const sessionSwitch = sessionDialog.getByTestId('session-inspection-setting')
  await expect(sessionSwitch).toHaveAttribute('aria-checked', 'false')
  await sessionSwitch.click()
  await expect(sessionSwitch).toHaveAttribute('aria-checked', 'true')
  await expect(
    sessionDialog.getByTestId('session-inspection-use-global'),
  ).toBeVisible()

  await sessionDialog.getByTestId('session-inspection-use-global').click()
  await expect(
    sessionDialog.getByTestId('session-inspection-use-global'),
  ).toHaveCount(0)
  await expect(sessionSwitch).toHaveAttribute('aria-checked', 'false')
  await expect(sessionDialog).toContainText(
    'This session is using the global inspection default.',
  )
  await sessionDialog.getByTestId('session-settings-done').click()
  await expect(sessionDialog).toBeHidden()

  const settings = await openSettings(page)
  await settings.getByRole('switch', { name: /Inspection/ }).click()
  await settings.getByTestId('settings-done').click()
  await expect(settings).toBeHidden()

  sessionDialog = await openSessionSettings(page)
  await expect(
    sessionDialog.getByTestId('session-inspection-setting'),
  ).toHaveAttribute('aria-checked', 'true')
  await expect(
    sessionDialog.getByTestId('session-inspection-use-global'),
  ).toHaveCount(0)
  await sessionDialog.getByTestId('session-settings-done').click()
  await expect(sessionDialog).toBeHidden()

  await page.reload()
  await waitForApp(page)
  sessionDialog = await openSessionSettings(page)
  await expect(
    sessionDialog.getByTestId('session-inspection-setting'),
  ).toHaveAttribute('aria-checked', 'true')
  await expect(
    sessionDialog.getByTestId('session-inspection-use-global'),
  ).toHaveCount(0)
})

test('changing a session event saves its default name immediately', async ({
  page,
}) => {
  await page.goto('/')
  await waitForApp(page)
  expect(await selectedSessionName(page)).toBe('Session 1')

  const sessionDialog = await openSessionSettings(page)
  await sessionDialog.locator('select').selectOption('222')
  // Close without focusing or blurring the name field. The rename must already
  // have been committed when the event-driven default name was chosen.
  await sessionDialog.getByTestId('session-settings-done').click()
  await expect(sessionDialog).toBeHidden()
  expect(await selectedSessionName(page)).toBe('2×2')

  const stored = await storedSessions(page)
  expect(stored?.sessions[0]?.name).toBe('2×2')

  await page.reload()
  await waitForApp(page)
  expect(await selectedSessionName(page)).toBe('2×2')
})

test.describe('per-event coverage — desktop', () => {
  for (const event of CUBELAB_EVENTS) {
    test(`records, penalizes, and persists ${event.label} solves`, async ({
      page,
    }) => {
      await runEventScenario(page, event)
    })
  }
})

test.describe('per-event coverage — mobile', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  })

  for (const event of CUBELAB_EVENTS) {
    test(`records, penalizes, and persists ${event.label} solves`, async ({
      page,
    }) => {
      await runEventScenario(page, event)
    })
  }
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
  await expect(page.getByTestId('session-settings')).toBeDisabled()
  await expect(page.getByTestId('settings-button')).toBeDisabled()

  await stopWithSpace(page)
  await expect(select).toBeEnabled()
  await expect(page.getByTestId('new-session')).toBeEnabled()
  await expect(page.getByTestId('session-settings')).toBeEnabled()
  await expect(page.getByTestId('settings-button')).toBeEnabled()
})

test('backup export and import restore sessions, comments, and settings', async ({
  page,
}) => {
  await page.goto('/')
  await waitForApp(page)

  await recordSolve(page, 100)
  const menu = await openFirstSolveMenu(page)
  await menu.getByRole('menuitem', { name: 'Add comment' }).click()
  await page
    .getByRole('textbox', { name: 'Solve comment' })
    .fill('Backup comment')
  await page.getByRole('button', { name: 'Save comment' }).click()
  await expect(page.getByRole('status')).toContainText('Solve comment saved')

  await page.getByTestId('new-session').click()
  const previousScramble = await page.locator('.scramble-text').innerText()
  await page.getByRole('textbox', { name: 'Session name' }).fill('Evening')
  await page
    .getByRole('dialog', { name: 'Create new session' })
    .locator('select')
    .selectOption('555')
  await page.getByRole('button', { name: 'Create session', exact: true }).click()
  await waitForFreshEventScramble(page, previousScramble)
  await expect(page.locator('.scramble-badge')).toContainText('5×5 · scramble')
  await recordSolve(page, 100)

  const settings = await openSettings(page)
  await settings.getByRole('switch', { name: /Inspection/ }).click()
  await settings.getByTestId('inspection-direction').selectOption('up')
  await settings.getByTestId('inspection-warning-8s').check()
  await settings.getByTestId('add-custom-average').click()
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
    sessions: StoredSessions
    settings: {
      inspectionEnabled: boolean
      inspectionCountDirection: string
      inspectionWarning8s: boolean
      customAverages: { size: number }[]
    }
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
    backup.sessions.sessions.map((session) => session.event ?? '333'),
  ).toEqual(['333', '555'])
  expect(
    backup.sessions.sessions.reduce(
      (total, session) => total + session.solves.length,
      0,
    ),
  ).toBe(2)
  expect(backup.sessions.sessions[0]?.solves[0]?.comment).toBe('Backup comment')
  expect(backup.settings.inspectionEnabled).toBe(true)
  expect(backup.settings.inspectionCountDirection).toBe('up')
  expect(backup.settings.inspectionWarning8s).toBe(true)
  expect(backup.settings.customAverages[0]?.size).toBe(6)
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
  const cancelDialog = page.getByRole('dialog', {
    name: 'Replace local sessions?',
  })
  await expect(cancelDialog).toBeVisible()
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
  const importDialog = page.getByRole('dialog', {
    name: 'Replace local sessions?',
  })
  await expect(importDialog).toBeVisible()
  await importDialog.getByRole('button', { name: 'Import backup' }).click()
  await expect(page.getByRole('status')).toContainText('Backup imported')
  await expect(page.getByTestId('settings-button')).toBeFocused()
  expect(await selectedSessionName(page)).toBe('Evening')
  await expect(page.getByTestId('solve-count')).toHaveText('1')
  await expect(page.locator('.scramble-badge')).toContainText('5×5 · scramble')
  await expect(page.getByTestId('session-select').locator('option')).toHaveCount(
    2,
  )

  const importedSettings = await openSettings(page)
  await expect(
    importedSettings.getByRole('switch', { name: /Inspection/ }),
  ).toHaveAttribute('aria-checked', 'true')
  await expect(
    importedSettings.getByTestId('inspection-direction'),
  ).toHaveValue('up')
  await expect(
    importedSettings.getByTestId('inspection-warning-8s'),
  ).toBeChecked()
  await expect(importedSettings.getByTestId('custom-average-size-0')).toHaveValue(
    '6',
  )
  await importedSettings.getByTestId('settings-done').click()
  await expect(importedSettings).toBeHidden()

  await page.getByTestId('session-select').selectOption({ label: 'Session 1' })
  await expect(page.getByTestId('solve-count')).toHaveText('1')
  await expect(page.locator('.scramble-badge')).toContainText('3×3 · scramble')
  await expect(page.locator('.history-comment')).toHaveText('Backup comment')

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
  await expect(
    error.getByRole('button', { name: 'Retry', exact: true }),
  ).toBeVisible()
})

test('installed app loads scrambles while completely offline', async ({
  page,
  context,
  browserName,
}) => {
  test.skip(
    browserName !== 'chromium',
    'Service-worker offline coverage remains Chromium-only in this environment.',
  )
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

test('google drive backup and restore work in mock mode', async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto('/')
  await waitForApp(page)

  const settings = await openSettings(page)
  await settings.getByTestId('settings-drive-button').click()
  await expect(settings).toBeHidden()
  const drive = page.getByRole('dialog', { name: 'Google Drive backup' })
  await expect(drive).toBeVisible()

  await drive.getByTestId('drive-connect').click()
  await expect(drive.getByTestId('drive-status')).toContainText('Connected')
  await expect(drive.getByTestId('drive-account-label')).toContainText(
    'Google Drive (mock)',
  )
  await expect(drive.getByTestId('sync-status')).toContainText('pending')
  await drive.getByTestId('sync-now').click()
  await expect(drive).toContainText('Last sync')

  await drive.getByRole('button', { name: /Advanced settings/ }).click()
  await drive.getByTestId('drive-delete-remote').click()
  const deleteDialog = page.getByRole('dialog', {
    name: 'Delete all Google Drive backups?',
  })
  await expect(deleteDialog).toBeVisible()
  await deleteDialog.getByRole('button', { name: 'Delete backups' }).click()
  await expect(drive).toContainText('No remote backup found yet.')

  // Disconnecting turns automatic synchronization off instead of leaving a
  // preference that can only fail with an auth-required status.
  await drive.getByTestId('drive-disconnect').click()
  await expect(page.locator('.toast')).toContainText(
    'Google Drive disconnected. Automatic synchronization is off.',
  )
  await expect(
    drive.getByRole('checkbox', { name: 'Automatic synchronization' }),
  ).not.toBeChecked()
  await expect(drive.getByTestId('sync-now')).toBeDisabled()

  // Reconnecting restores the opt-in synchronization preference.
  await drive.getByTestId('drive-connect').click()
  await expect(drive.getByTestId('drive-status')).toContainText('Connected')
  await expect(
    drive.getByRole('checkbox', { name: 'Automatic synchronization' }),
  ).toBeChecked()

  await drive.getByTestId('drive-done').click()
  await expect(drive).toBeHidden()
})

test('delete remote backups works without a local snapshot', async ({ page }) => {
  await page.goto('/')
  await waitForApp(page)

  // Only another device's snapshot exists. This browser has no remote file ID.
  await page.evaluate(async () => {
    const storedSettings = JSON.parse(
      localStorage.getItem('cubelab:settings:v1') ?? '{}',
    ) as { settings: Record<string, unknown> }
    const storedSessions = JSON.parse(
      localStorage.getItem('cubelab:sessions:v1') ?? '{}',
    ) as Record<string, unknown>
    const now = Date.now()
    const backup = {
      app: 'CubeLab',
      format: 'cubelab-backup',
      version: 1,
      exportedAt: new Date(now).toISOString(),
      sessions: storedSessions,
      settings: storedSettings.settings,
      sync: {
        protocolVersion: 1,
        revision: 1,
        deviceId: 'remote-device',
        updatedAt: now,
        tombstones: [],
        conflicts: [],
        sessionRedirects: [],
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

  const settings = await openSettings(page)
  await settings.getByTestId('settings-drive-button').click()
  const drive = page.getByRole('dialog', { name: 'Google Drive backup' })
  await expect(drive).toBeVisible()
  await drive.getByRole('button', { name: /Advanced settings/ }).click()

  // Deletion is available before this browser owns a remote file. The action
  // connects first, then removes every CubeLab snapshot.
  const deleteButton = drive.getByTestId('drive-delete-remote')
  await expect(deleteButton).toBeEnabled()
  await deleteButton.click()
  const deleteDialog = page.getByRole('dialog', {
    name: 'Delete all Google Drive backups?',
  })
  await deleteDialog.getByRole('button', { name: 'Delete backups' }).click()
  await expect(drive.getByTestId('drive-status')).toContainText('Connected')
  await expect(page.locator('.toast')).toContainText(
    'Google Drive backup deleted',
  )

  const remaining = await page.evaluate(async () => {
    const mockDrive = (
      window as {
        __cubeLabMockDrive?: {
          listBackups: () => Promise<unknown[]>
        }
      }
    ).__cubeLabMockDrive
    return (await mockDrive?.listBackups())?.length ?? 0
  })
  expect(remaining).toBe(0)
})

test('remote snapshots show ownership, selective delete, and manual cleanup', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await page.goto('/')
  await waitForApp(page)

  // Seed six snapshots owned by this browser and five by another device. The
  // mock transport records device ownership in app-private metadata, which is
  // what the management section displays without downloading the files.
  await page.evaluate(async () => {
    const syncRaw = JSON.parse(
      localStorage.getItem('cubelab:sync:v1') ?? '{}',
    ) as { runtime?: { deviceId?: string } }
    const deviceId = syncRaw.runtime?.deviceId
    if (!deviceId) throw new Error('missing local device ID')
    const storedSettings = JSON.parse(
      localStorage.getItem('cubelab:settings:v1') ?? '{}',
    ) as { settings: Record<string, unknown> }
    const storedSessions = JSON.parse(
      localStorage.getItem('cubelab:sessions:v1') ?? '{}',
    ) as Record<string, unknown>
    const now = Date.now()
    const backupFor = (ownerDeviceId: string, revision: number) => ({
      app: 'CubeLab',
      format: 'cubelab-backup',
      version: 1,
      exportedAt: new Date(now - (20 - revision) * 1000).toISOString(),
      sessions: storedSessions,
      settings: storedSettings.settings,
      sync: {
        protocolVersion: 1,
        revision,
        deviceId: ownerDeviceId,
        updatedAt: now - (20 - revision) * 1000,
        tombstones: [],
        conflicts: [],
        sessionRedirects: [],
      },
    })
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
    for (let index = 0; index < 6; index += 1) {
      await mockDrive?.uploadDeviceBackup(
        JSON.stringify(backupFor(deviceId, index + 1)),
        deviceId,
      )
    }
    for (let index = 0; index < 5; index += 1) {
      await mockDrive?.uploadDeviceBackup(
        JSON.stringify(backupFor('other', index + 1)),
        'other',
      )
    }
    mockDrive?.disconnect()
  })

  const settings = await openSettings(page)
  await settings.getByTestId('settings-drive-button').click()
  const drive = page.getByRole('dialog', { name: 'Google Drive backup' })
  await expect(drive).toBeVisible()
  await drive.getByTestId('drive-connect').click()
  await expect(drive.getByTestId('drive-status')).toContainText('Connected')

  // Stop automatic synchronization so the fallback timer cannot publish a new
  // snapshot in the middle of the manual-management flow.
  await drive
    .getByRole('checkbox', { name: 'Automatic synchronization' })
    .uncheck()

  await expect(drive.getByTestId('remote-snapshot-summary')).toContainText(
    '11 files',
  )
  await expect(drive.getByTestId('remote-snapshot-group')).toHaveCount(2)
  const ownGroup = drive
    .getByTestId('remote-snapshot-group')
    .filter({ hasText: 'This device' })
  const foreignGroup = drive
    .getByTestId('remote-snapshot-group')
    .filter({ hasText: 'Device other' })
  await expect(ownGroup).toContainText('6 snapshots')
  await expect(foreignGroup).toContainText('5 snapshots')

  // Selectively remove one foreign snapshot.
  await foreignGroup.getByTestId('delete-remote-snapshot').first().click()
  const snapshotDelete = page.getByRole('dialog', {
    name: 'Delete this cloud snapshot?',
  })
  await expect(snapshotDelete).toBeVisible()
  await expect(snapshotDelete).toContainText('Another device snapshot')
  await snapshotDelete
    .getByRole('button', { name: 'Delete snapshot' })
    .click()
  await expect(page.locator('.toast')).toContainText('Remote snapshot deleted')
  await expect(foreignGroup).toContainText('4 snapshots')
  await expect(drive.getByTestId('remote-snapshot-summary')).toContainText(
    '10 files',
  )

  // Manual cleanup is restricted to this device's superseded snapshots.
  await drive.getByLabel('Snapshots kept per device').selectOption('3')
  await drive.getByTestId('cleanup-remote-snapshots').click()
  const cleanup = page.getByRole('dialog', {
    name: 'Remove superseded snapshots?',
  })
  await expect(cleanup).toBeVisible()
  await expect(cleanup).toContainText(
    "3 of this device’s older snapshots",
  )
  await cleanup.getByRole('button', { name: 'Clean up' }).click()
  await expect(page.locator('.toast')).toContainText('3 old snapshots removed')

  await expect(ownGroup).toContainText('3 snapshots')
  await expect(foreignGroup).toContainText('4 snapshots')
  await expect(drive.getByTestId('remote-snapshot-summary')).toContainText(
    '7 files',
  )
  const storedPreference = await page.evaluate(() => {
    const syncRaw = JSON.parse(
      localStorage.getItem('cubelab:sync:v1') ?? '{}',
    ) as { preferences?: { snapshotKeepPerDevice?: number } }
    return syncRaw.preferences?.snapshotKeepPerDevice
  })
  expect(storedPreference).toBe(3)

  await drive.getByTestId('drive-done').click()
  await expect(drive).toBeHidden()
})

test('invalid google drive backup is rejected', async ({ page }) => {
  await page.goto('/')
  await waitForApp(page)

  const settings = await openSettings(page)
  await settings.getByTestId('settings-drive-button').click()
  const drive = page.getByRole('dialog', { name: 'Google Drive backup' })
  await expect(drive).toBeVisible()

  await drive.getByTestId('drive-connect').click()
  await drive.getByTestId('sync-now').click()
  await page.evaluate(() => {
    ;(window as { __cubeLabMockDrive?: { __corruptRemote?: () => void } })
      .__cubeLabMockDrive?.__corruptRemote?.()
  })

  await drive.getByTestId('sync-now').click()
  await expect(drive.getByTestId('sync-error')).toBeVisible()
  await expect(drive.getByTestId('sync-error')).toContainText('valid JSON')
  await drive.getByTestId('drive-done').click()
  await expect(drive).toBeHidden()
})

test('manual conflict review pauses and resumes after choosing a version', async ({
  page,
}) => {
  test.setTimeout(60_000)
  await page.goto('/')
  await waitForApp(page)
  await recordSolve(page, 120)

  const settings = await openSettings(page)
  await settings.getByTestId('settings-drive-button').click()
  const drive = page.getByRole('dialog', { name: 'Google Drive backup' })
  await expect(drive).toBeVisible()
  await drive.getByTestId('drive-connect').click()
  await expect(drive.getByTestId('drive-status')).toContainText('Connected')

  // Seed a cloud backup with the same solve but a conflicting penalty.
  await page.evaluate(() => {
    const storedSessions = JSON.parse(
      localStorage.getItem('cubelab:sessions:v1') ?? '{}',
    ) as {
      activeSessionId: string
      sessions: Array<{
        solves: Array<Record<string, unknown>>
      }>
    }
    const storedSettings = JSON.parse(
      localStorage.getItem('cubelab:settings:v1') ?? '{}',
    ) as { settings: Record<string, unknown> }
    const remoteAt = Date.now() + 60_000
    const remoteSessions = {
      activeSessionId: storedSessions.activeSessionId,
      sessions: storedSessions.sessions.map((session) => ({
        ...session,
        solves: session.solves.map((solve) => ({
          ...solve,
          penalty: '+2',
          updatedAt: remoteAt,
          fieldUpdates: {
            ...((solve.fieldUpdates as Record<string, unknown> | undefined) ?? {}),
            penalty: { updatedAt: remoteAt, editorId: 'remote-device' },
          },
        })),
      })),
    }
    const backup = {
      app: 'CubeLab',
      format: 'cubelab-backup',
      version: 1,
      exportedAt: new Date().toISOString(),
      sessions: remoteSessions,
      settings: storedSettings.settings,
      sync: {
        protocolVersion: 1,
        revision: 1,
        deviceId: 'remote-device',
        updatedAt: remoteAt,
        tombstones: [],
        conflicts: [],
        sessionRedirects: [],
      },
    }
    const mockDrive = (
      window as {
        __cubeLabMockDrive?: {
          uploadBackup: (content: string, id: string | null) => Promise<unknown>
        }
      }
    ).__cubeLabMockDrive
    return mockDrive?.uploadBackup(JSON.stringify(backup), null)
  })

  await drive.getByRole('button', { name: /Advanced settings/ }).click()
  await drive.getByLabel('Manual conflict review').check()
  await drive.getByTestId('sync-now').click()

  const conflicts = drive.getByTestId('sync-conflicts')
  await expect(conflicts).toBeVisible()
  await expect(drive.getByTestId('sync-conflict')).toHaveCount(1)
  await expect(conflicts).toContainText('penalty')
  await expect(conflicts).toContainText('This device: none')
  await expect(conflicts).toContainText('Cloud: +2')

  await drive.getByRole('button', { name: 'Use this device' }).click()
  await expect(drive.getByTestId('sync-conflicts')).toHaveCount(0)
  await expect(drive.getByTestId('sync-status')).toContainText('synced', {
    timeout: 15_000,
  })

  const solves = await storedSolves(page)
  expect(solves[0]?.penalty).toBe('none')

  // The reviewed choice is recorded locally and can be reversed. Undo must
  // apply the other side on the next sync, even though the cloud snapshot that
  // still carries it is merged before the snapshot this device just wrote.
  const history = drive.getByTestId('sync-audit-history')
  await expect(history).toBeVisible()
  await expect(history).toContainText('Chose this device')
  await expect(drive.getByTestId('sync-audit-entry')).toHaveCount(1)
  await drive.getByTestId('undo-conflict-resolution').click()
  await expect(history).toContainText('Reversed to')
  await expect(drive.getByTestId('sync-status')).toContainText('synced', {
    timeout: 15_000,
  })
  await expect
    .poll(async () => (await storedSolves(page))[0]?.penalty, {
      timeout: 15_000,
    })
    .toBe('+2')
  await expect(drive.getByTestId('sync-audit-entry')).toHaveCount(2)

  // Repair only clears derived bookkeeping. Deletions, approvals, and review
  // history are correctness state and must survive it.
  await drive
    .getByRole('checkbox', { name: 'Automatic synchronization' })
    .uncheck()
  const beforeRepair = await page.evaluate(() => {
    const runtime = (
      JSON.parse(localStorage.getItem('cubelab:sync:v1') ?? '{}') as {
        runtime?: {
          lastSyncedFingerprint?: string | null
          tombstones?: unknown[]
          conflictAudit?: unknown[]
        }
      }
    ).runtime
    return {
      fingerprint: runtime?.lastSyncedFingerprint,
      tombstones: runtime?.tombstones?.length ?? 0,
      audit: runtime?.conflictAudit?.length ?? 0,
    }
  })
  expect(beforeRepair.fingerprint).toBeTruthy()
  expect(beforeRepair.tombstones).toBe(0)
  expect(beforeRepair.audit).toBe(2)

  await drive.getByTestId('repair-sync-state').click()
  await expect(page.locator('.toast')).toContainText('Sync state repaired')
  const afterRepair = await page.evaluate(() => {
    const runtime = (
      JSON.parse(localStorage.getItem('cubelab:sync:v1') ?? '{}') as {
        runtime?: {
          lastSyncedFingerprint?: string | null
          lastRemoteRevision?: number | null
          lastSyncStatus?: string
          lastError?: string | null
          tombstones?: unknown[]
          conflictAudit?: unknown[]
        }
      }
    ).runtime
    return {
      fingerprint: runtime?.lastSyncedFingerprint,
      revision: runtime?.lastRemoteRevision,
      status: runtime?.lastSyncStatus,
      error: runtime?.lastError,
      tombstones: runtime?.tombstones?.length ?? 0,
      audit: runtime?.conflictAudit?.length ?? 0,
    }
  })
  expect(afterRepair).toEqual({
    fingerprint: null,
    revision: null,
    status: 'disabled',
    error: null,
    tombstones: 0,
    audit: 2,
  })

  await drive.getByTestId('drive-done').click()
  await expect(drive).toBeHidden()
})

test('duplicate session names from Drive are reviewed and merged', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await page.goto('/')
  await waitForApp(page)

  const settings = await openSettings(page)
  await settings.getByTestId('settings-drive-button').click()
  const drive = page.getByRole('dialog', { name: 'Google Drive backup' })
  await expect(drive).toBeVisible()
  await drive.getByTestId('drive-connect').click()
  await expect(drive.getByTestId('drive-status')).toContainText('Connected')

  await page.evaluate(async () => {
    const storedSettings = JSON.parse(
      localStorage.getItem('cubelab:settings:v1') ?? '{}',
    ) as { settings: Record<string, unknown> }
    const now = Date.now()
    const makeSolve = (id: string) => ({
      id,
      event: '333',
      rawMs: 10_000,
      penalty: 'none',
      scramble: "R U R' U'",
      comment: '',
      createdAt: now,
    })
    const backup = {
      app: 'CubeLab',
      format: 'cubelab-backup',
      version: 1,
      exportedAt: new Date(now).toISOString(),
      sessions: {
        activeSessionId: 'shared-a',
        sessions: [
          {
            id: 'shared-a',
            name: 'Shared',
            event: '333',
            createdAt: now,
            updatedAt: now,
            solves: [makeSolve('a-1')],
          },
          {
            id: 'shared-b',
            name: 'Shared',
            event: '333',
            createdAt: now,
            updatedAt: now,
            solves: [makeSolve('b-1')],
          },
        ],
      },
      settings: storedSettings.settings,
      sync: {
        protocolVersion: 1,
        revision: 1,
        deviceId: 'remote-device',
        updatedAt: now,
        tombstones: [],
        conflicts: [],
        sessionRedirects: [],
      },
    }
    const mockDrive = (
      window as {
        __cubeLabMockDrive?: {
          uploadDeviceBackup: (
            content: string,
            deviceId: string,
          ) => Promise<unknown>
        }
      }
    ).__cubeLabMockDrive
    await mockDrive?.uploadDeviceBackup(
      JSON.stringify(backup),
      'remote-device',
    )
  })

  await drive.getByTestId('sync-now').click()

  const toast = page.locator('.toast')
  await expect(toast).toContainText("separate sessions named 'Shared'")
  await expect(
    toast.getByRole('button', { name: 'Review Merge' }),
  ).toBeVisible()
  await expect(drive.getByTestId('sync-duplicate-names')).toBeVisible()
  await expect(drive.getByTestId('sync-duplicate-names')).toContainText(
    "'Shared'",
  )
  await expect(drive.getByTestId('review-duplicate-sessions')).toBeVisible()

  // A typed confirmation is scoped to one open dialog. Cancelling and opening
  // the review again must not leave the destructive action pre-approved.
  await drive.getByTestId('review-duplicate-sessions').click()
  const reviewMerge = page.getByRole('dialog', { name: 'Merge sessions' })
  await expect(reviewMerge).toBeVisible()
  await reviewMerge.getByLabel('Typed confirmation').fill('MERGE SESSIONS')
  await expect(
    reviewMerge.getByRole('button', { name: 'Confirm merge' }),
  ).toBeEnabled()
  await reviewMerge.getByRole('button', { name: 'Cancel merge' }).click()
  await expect(reviewMerge).toBeHidden()
  await expect(drive).toBeVisible()

  await drive.getByTestId('review-duplicate-sessions').click()
  await expect(reviewMerge).toBeVisible()
  await expect(reviewMerge.getByLabel('Typed confirmation')).toHaveValue('')
  await expect(
    reviewMerge.getByRole('button', { name: 'Confirm merge' }),
  ).toBeDisabled()
  await reviewMerge.getByRole('button', { name: 'Cancel merge' }).click()
  await expect(reviewMerge).toBeHidden()

  // Close the modal dialog so the actionable toast can be clicked.
  await drive.getByTestId('drive-done').click()
  await expect(drive).toBeHidden()
  await toast.getByRole('button', { name: 'Review Merge' }).click()

  const merge = page.getByRole('dialog', { name: 'Merge sessions' })
  await expect(merge).toBeVisible()
  await expect(merge).toContainText('Found 2 separate sessions named')
  await merge.getByLabel('Typed confirmation').fill('MERGE SESSIONS')
  await merge.getByRole('button', { name: 'Confirm merge' }).click()
  await expect(merge).toBeHidden()

  await expect(page.getByTestId('session-select').locator('option')).toHaveCount(1)
  await expect(page.getByTestId('session-select').locator('option')).toHaveText(
    'Shared',
  )

  // Reopen Drive: the persistent review action disappears once the merged
  // collection has no duplicate name left.
  const settingsAgain = await openSettings(page)
  await settingsAgain.getByTestId('settings-drive-button').click()
  const driveAgain = page.getByRole('dialog', { name: 'Google Drive backup' })
  await expect(driveAgain).toBeVisible()
  await expect(driveAgain.getByTestId('sync-duplicate-names')).toHaveCount(0)
  await driveAgain.getByTestId('drive-done').click()
  await expect(driveAgain).toBeHidden()
})

