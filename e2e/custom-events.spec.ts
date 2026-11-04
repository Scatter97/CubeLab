import { expect, test, type Page } from '@playwright/test'
import { chooseOption } from './interactions'

const TIMER = '[data-testid="timer-surface"]'

async function waitForApp(page: Page) {
  await expect(page.locator('.scramble-text')).toBeVisible({ timeout: 30_000 })
}

async function openSessionSettings(page: Page) {
  await page.getByTestId('session-settings').click()
  const dialog = page.getByRole('dialog', { name: 'Session settings' })
  await expect(dialog).toBeVisible()
  return dialog
}

async function openEventManager(page: Page) {
  const sessionDialog = await openSessionSettings(page)
  await sessionDialog.getByTestId('manage-events').click()
  await expect(sessionDialog).toBeHidden()
  const dialog = page.getByRole('dialog', { name: 'Custom events' })
  await expect(dialog).toBeVisible()
  return dialog
}

async function recordSolve(page: Page, durationMs = 80) {
  await page.keyboard.down('Space')
  await expect(page.locator(TIMER)).toHaveAttribute('data-phase', 'ready', {
    timeout: 3_000,
  })
  await page.keyboard.up('Space')
  await expect(page.locator(TIMER)).toHaveAttribute('data-phase', 'running')
  await page.waitForTimeout(durationMs)
  await page.keyboard.press('Space')
  await expect(page.locator(TIMER)).toHaveAttribute('data-phase', 'idle')
}

async function storedSessions(page: Page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem('cubelab:sessions:v1')
    return raw
      ? (JSON.parse(raw) as {
          activeSessionId: string
          sessions: Array<{
            id: string
            name: string
            event?: string
            solves: Array<{ id: string; event: string; scramble: string }>
          }>
          customEvents?: Array<{
            id: string
            name: string
            placeholder: string
          }>
        })
      : null
  })
}

test('creates, uses, renames, reassigns and deletes a custom event', async ({
  page,
}) => {
  await page.goto('/')
  await waitForApp(page)

  let manager = await openEventManager(page)
  await manager.getByTestId('custom-event-name').fill('FTO')
  await manager.getByTestId('custom-event-placeholder').fill('No FTO scramble')
  await manager.getByTestId('create-custom-event').click()
  await expect(manager.getByTestId('custom-event-status')).toContainText('Created FTO')
  await expect(manager.getByTestId('custom-event-row')).toHaveCount(1)
  await manager.getByRole('button', { name: 'Done' }).click()

  const sessionDialog = await openSessionSettings(page)
  await chooseOption(
    sessionDialog.getByTestId('session-event-select'),
    'FTO (custom)',
  )
  await sessionDialog.getByTestId('session-settings-done').click()
  await expect(sessionDialog).toBeHidden()

  await expect(page.locator('.scramble-badge')).toContainText('FTO')
  await expect(page.locator('.scramble-text')).toHaveText('No FTO scramble')
  await expect(page.locator('.header-context .context-meta')).toContainText('FTO')

  await recordSolve(page)
  await recordSolve(page)
  await expect(page.getByTestId('solve-count')).toHaveText('2')

  let stored = await storedSessions(page)
  const customId = stored?.customEvents?.[0]?.id
  expect(customId).toMatch(/^custom:/)
  expect(stored?.sessions[0]?.event).toBe(customId)
  expect(stored?.sessions[0]?.solves.every((solve) => solve.event === customId)).toBe(true)

  // Renaming updates the live selector label while preserving solves.
  manager = await openEventManager(page)
  const row = manager.getByTestId('custom-event-row')
  await row.getByRole('textbox', { name: /Name for FTO/ }).fill('FTO renamed')
  await row.getByRole('button', { name: 'Save' }).click()
  await manager.getByRole('button', { name: 'Done' }).click()
  await expect(page.locator('.scramble-badge')).toContainText('FTO renamed')

  // Create a second event and move the whole session to it.
  manager = await openEventManager(page)
  await manager.getByTestId('custom-event-name').fill('FTO alt')
  await manager.getByTestId('create-custom-event').click()
  await expect(manager.getByTestId('custom-event-row')).toHaveCount(2)
  await chooseOption(
    manager.getByTestId('custom-event-target'),
    'FTO alt (custom)',
  )
  await manager
    .locator('.custom-event-session-list input[type="checkbox"]')
    .first()
    .check()
  await manager.getByTestId('reassign-sessions').click()
  await manager.getByTestId('confirm-reassign-sessions').click()
  await expect(manager.getByTestId('custom-event-status')).toContainText('Reassigned')
  await manager.getByRole('button', { name: 'Done' }).click()
  await expect(page.locator('.scramble-badge')).toContainText('FTO alt')

  stored = await storedSessions(page)
  expect(stored?.sessions[0]?.solves).toHaveLength(2)
  expect(stored?.sessions[0]?.solves.every((solve) => solve.scramble.length > 0)).toBe(true)

  // The original event is unused now and can be deleted safely.
  manager = await openEventManager(page)
  const originalRow = manager
    .getByTestId('custom-event-row')
    .filter({ has: page.getByRole('textbox', { name: /Name for FTO renamed/ }) })
  await originalRow.getByRole('button', { name: 'Delete' }).click()
  await expect(manager.getByTestId('custom-event-row')).toHaveCount(1)
  await manager.getByRole('button', { name: 'Done' }).click()

  await page.reload()
  await waitForApp(page)
  await expect(page.locator('.scramble-text')).toHaveText('No scramble for this event')
  stored = await storedSessions(page)
  expect(stored?.customEvents).toHaveLength(1)
  expect(stored?.sessions[0]?.event).toBe(stored?.customEvents?.[0]?.id)
  expect(stored?.sessions[0]?.solves).toHaveLength(2)
})

test('implements unknown csTimer types as separate custom events', async ({
  page,
}) => {
  await page.goto('/')
  await waitForApp(page)

  const csTimer = {
    session1: [[[0, 1200], 'R U', 'first', 1700000000]],
    session2: [[[0, 2200], 'R U', 'second', 1700000001]],
    properties: {
      sessionData: JSON.stringify({
        '1': { name: 'Odd one', opt: { scrType: 'fto' }, date: [1700000000, 1700000000] },
        '2': { name: 'Odd two', opt: { scrType: 'other-puzzle' }, date: [1700000001, 1700000001] },
      }),
    },
  }

  await page.getByTestId('settings-button').click()
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await settings.getByTestId('settings-backup-button').click()
  const dataDialog = page.getByRole('dialog', { name: 'Your local data' })
  await dataDialog.getByTestId('backup-file-input').setInputFiles({
    name: 'csTimer.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(csTimer)),
  })

  const preview = page.getByTestId('cs-preview')
  await expect(preview).toBeVisible()
  await expect(page.getByTestId('cs-preview-summary')).toHaveText(
    '2 sessions · 2 solves',
  )
  await expect(page.getByTestId('cs-preview-session')).toHaveCount(2)
  await expect(preview).toContainText('Odd one')
  await expect(preview).toContainText('Odd two')
  await expect(preview).not.toContainText('Event mappings')
  await expect(preview).not.toContainText('scrType')
  await expect(preview).not.toContainText('new custom event')
  await expect(page.getByTestId('cs-event-mapping')).toHaveCount(0)

  await page.getByTestId('cs-preview-import').click()
  await page.getByRole('button', { name: 'Import sessions' }).click()

  const stored = await storedSessions(page)
  expect(stored?.customEvents).toHaveLength(2)
  expect(stored?.customEvents?.map((event) => event.name)).toEqual(
    expect.arrayContaining(['csTimer: fto', 'csTimer: other-puzzle']),
  )
  const imported = (stored?.sessions ?? []).filter((session) =>
    ['Odd one', 'Odd two'].includes(session.name),
  )
  expect(imported).toHaveLength(2)
  for (const session of imported) {
    expect(session.event).not.toBe('333')
    expect(session.solves.every((solve) => solve.event === session.event)).toBe(true)
  }
})

test('shows custom events in the Analytics event filter', async ({ page }) => {
  await page.goto('/')
  await waitForApp(page)

  const manager = await openEventManager(page)
  await manager.getByTestId('custom-event-name').fill('Analytics event')
  await manager.getByTestId('create-custom-event').click()
  await manager.getByRole('button', { name: 'Done' }).click()

  await page.getByTestId('analytics-nav').click()
  const filter = page.getByRole('combobox', { name: 'Analytics event' })
  await expect(filter).toBeVisible()
  await filter.click()
  const customOption = page.getByRole('option', {
    name: 'Analytics event (custom)',
    exact: true,
  })
  await expect(customOption).toHaveCount(1)
  await customOption.click()
  await expect(filter).toContainText('Analytics event (custom)')
})
