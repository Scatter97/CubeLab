import { expect, test } from '@playwright/test'

const TIMER = '[data-testid="timer-surface"]'
const SEEDED_AT = Date.UTC(2026, 10, 21, 13, 18)
const SEEDED_SOLVE = {
  id: 'tools-solve',
  event: '333',
  rawMs: 12_340,
  penalty: 'none',
  scramble: "R U R' U' F2 D L2 B' R2 U2",
  comment: '',
  createdAt: SEEDED_AT,
}
const SEEDED_SESSIONS = {
  version: 4,
  activeSessionId: 'tools-session',
  sessions: [
    {
      id: 'tools-session',
      name: 'Tools',
      event: '333',
      createdAt: SEEDED_AT,
      updatedAt: SEEDED_AT,
      solves: [SEEDED_SOLVE],
    },
  ],
}

async function waitForApp(page: import('@playwright/test').Page) {
  await page.addInitScript((data) => {
    if (sessionStorage.getItem('tools-seeded')) return
    sessionStorage.setItem('tools-seeded', '1')
    localStorage.setItem('cubelab:sessions:v1', JSON.stringify(data))
  }, SEEDED_SESSIONS)
  await page.goto('/')
  await expect(page.locator('.scramble-text')).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('current-tool-button').click()
  await expect(page.getByTestId('tool-panel')).toBeVisible()
}

async function selectTool(page: import('@playwright/test').Page, name: string) {
  await page.getByTestId('tool-select-button').click()
  await page.getByRole('menuitemradio', { name }).click()
}

test('tool panel offers the csTimer-style extras without arming the timer', async ({ page }) => {
  await waitForApp(page)
  await page.getByTestId('tool-select-button').click()
  await expect(page.getByRole('menuitemradio')).toHaveCount(8)
  await page.keyboard.press('Escape')

  await selectTool(page, 'Confirm Time')
  const panel = page.getByTestId('tool-panel')
  await expect(panel.getByTestId('confirm-time-heading')).toContainText(
    'Solve #1',
  )
  await expect(panel.getByTestId('confirm-time-value')).toHaveText('12.34')
  await expect(panel.getByTestId('confirm-time-scramble')).toHaveText(
    SEEDED_SOLVE.scramble,
  )
  await expect(panel.getByTestId('confirm-time-date')).toContainText('2026')
  await expect(page.locator(TIMER)).toHaveAttribute('data-phase', 'idle')

  await panel.getByTestId('confirm-time-plus-two').click()
  await expect(panel.getByTestId('confirm-time-value')).toHaveText('12.34+2')
  await expect(panel.getByTestId('confirm-time-secondary')).toHaveText(
    'Effective 14.34',
  )

  await panel.getByTestId('confirm-time-dnf').click()
  await expect(panel.getByTestId('confirm-time-value')).toHaveText('DNF')
  await expect(panel.getByTestId('confirm-time-secondary')).toHaveText(
    'Raw 12.34',
  )

  await panel.getByTestId('confirm-time-ok').click()
  await expect(panel.getByTestId('confirm-time-value')).toHaveText('12.34')
  await expect(panel.getByTestId('confirm-time-secondary')).toHaveCount(0)

  await panel.getByTestId('confirm-time-comment').fill('Confirmed note')
  await panel.getByTestId('confirm-time-save-comment').click()
  await expect(page.getByTestId('history-row').first()).toContainText(
    'Confirmed note',
  )

  await panel.getByTestId('confirm-time-delete').click()
  await expect(page.getByTestId('solve-count')).toHaveText('0')
  await expect(panel.getByTestId('confirm-time-empty')).toBeVisible()
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(page.getByTestId('solve-count')).toHaveText('1')
  await expect(panel.getByTestId('confirm-time-value')).toHaveText('12.34')
  await expect(panel.getByTestId('confirm-time-comment')).toHaveValue(
    'Confirmed note',
  )

  await selectTool(page, 'Statistics')
  await expect(panel.getByText('Solves', { exact: true })).toBeVisible()
  await expect(panel.getByText('Best', { exact: true })).toBeVisible()

  await selectTool(page, 'Time Distribution')
  await expect(page.locator('.tool-bar-row').first()).toBeVisible()

  await selectTool(page, 'Daily Stats')
  await expect(page.locator('.tool-table')).toContainText('Solves')

  await selectTool(page, 'Metronome')
  await page.getByRole('button', { name: 'Start', exact: true }).click()
  await expect(page.getByText(/[1-9]\d* beats/)).toBeVisible({ timeout: 4_000 })
  await page.getByRole('button', { name: 'Stop', exact: true }).click()
  await expect(page.locator(TIMER)).toHaveAttribute('data-phase', 'idle')
})

test('every tool reflows during a resize gesture before release', async ({ page }) => {
  await waitForApp(page)
  const panel = page.getByTestId('tool-panel')
  const tools = [
    ['Draw Scramble', '.scramble-draw-stage'],
    ['Time Trend', '.time-trend-chart'],
    ['Confirm Time', '[data-testid="confirm-time-tool"]'],
    ['Statistics', '.tool-stat-grid'],
    ['Time Distribution', '.tool-bars'],
    ['Daily Stats', '.tool-table'],
    ['Metronome', '.tool-field'],
    ['Online Battle', '.battle-room'],
  ] as const

  for (const [name, selector] of tools) {
    await selectTool(page, name)
    const content = panel.locator(selector)
    await expect(content).toBeVisible()
    const before = await content.boundingBox()
    const panelBefore = await panel.boundingBox()
    expect(before).not.toBeNull()
    expect(panelBefore).not.toBeNull()
    if (!before || !panelBefore) return

    const handle = await page.getByTestId('tool-panel-resize-handle').boundingBox()
    expect(handle).not.toBeNull()
    if (!handle) return
    const centre = {
      x: handle.x + handle.width / 2,
      y: handle.y + handle.height / 2,
    }
    await page.mouse.move(centre.x, centre.y)
    await page.mouse.down()
    await page.mouse.move(centre.x + 6, centre.y + 6, { steps: 2 })
    await expect(panel).toHaveAttribute('data-interaction', 'resize')
    await expect(panel).toHaveClass(/is-live-resize/)
    await expect
      .poll(async () => (await content.boundingBox())?.width ?? Infinity)
      .toBeLessThan(before.width)
    await page.mouse.up()
    await expect(panel).not.toHaveAttribute('data-interaction')
    const panelAfter = await panel.boundingBox()
    expect(panelAfter).not.toBeNull()
    if (panelAfter) {
      expect(
        Math.abs(
          panelAfter.x + panelAfter.width -
            (panelBefore.x + panelBefore.width),
        ),
      ).toBeLessThanOrEqual(1)
      expect(
        Math.abs(
          panelAfter.y + panelAfter.height -
            (panelBefore.y + panelBefore.height),
        ),
      ).toBeLessThanOrEqual(1)
      expect(panelAfter.width).toBeLessThan(panelBefore.width)
      expect(panelAfter.height).toBeLessThan(panelBefore.height)
    }
    await expect(page.locator(TIMER)).toHaveAttribute('data-phase', 'idle')
  }
})

test('online battle validates room credentials and invalid invitation codes without a backend', async ({ page }) => {
  await waitForApp(page)
  await selectTool(page, 'Online Battle')
  await expect(page.getByLabel('Room ID')).toBeVisible()
  await expect(page.getByLabel('Password')).toBeVisible()
  await page.getByLabel('Invitation code').fill('not-a-real-code')
  await page.getByRole('button', { name: 'Join with code', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText(
    'not a valid battle invitation code',
  )
  await expect(page.locator(TIMER)).toHaveAttribute('data-phase', 'idle')
})
