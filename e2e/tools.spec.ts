import { expect, test } from '@playwright/test'

const TIMER = '[data-testid="timer-surface"]'

async function waitForApp(page: import('@playwright/test').Page) {
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
  await page.getByTestId('confirm-time-input').fill('12.34')
  await page.getByRole('button', { name: 'Add solve', exact: true }).click()
  await expect(page.getByTestId('solve-count')).toHaveText('1')
  await expect(page.locator(TIMER)).toHaveAttribute('data-phase', 'idle')

  await selectTool(page, 'Statistics')
  const panel = page.getByTestId('tool-panel')
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
