import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

async function seedHistory(page: Page) {
  await page.addInitScript(() => {
    if (localStorage.getItem('cubelab:sessions:v1')) return
    const now = Date.UTC(2026, 9, 31)
    localStorage.setItem('cubelab:sessions:v1', JSON.stringify({ version: 4, activeSessionId: 'trim-session', sessions: [{
      id: 'trim-session', name: 'Trimming practice', event: '333', createdAt: now - 1005 * 60000, updatedAt: now,
      solves: Array.from({ length: 1005 }, (_, index) => ({ id: `trim-${index}`, event: '333', rawMs: index === 1004 ? 9000 : 10000,
        penalty: (index >= 800 && index < 847) || (index >= 960 && index < 963) ? 'dnf' : 'none',
        scramble: 'R U F2', comment: index === 1004 ? 'PB with 50 prior DNFs in its ao1000' : '', createdAt: now - (1004 - index) * 60000,
      })).reverse(),
    }] }))
    // A real v7 record without trimming fields exercises migration on mount.
    localStorage.setItem('cubelab:settings:v1', JSON.stringify({ version: 7, settings: {
      inspectionEnabled: false, theme: 'dark', statVisibility: { ao1000: true }, customAverages: [{ id: 'trim-custom', size: 50, visible: true }],
    } }))
  })
  await page.goto('/')
}

async function openSettings(page: Page) {
  await page.getByTestId('settings-button').click()
  return page.getByRole('dialog', { name: 'Settings' })
}

async function openTrend(page: Page) {
  const panel = page.getByTestId('tool-panel')
  if (await panel.count() === 0) await page.getByTestId('current-tool-button').click()
  if (await panel.getAttribute('data-tool') !== 'timeTrend') {
    await page.getByTestId('tool-select-button').click()
    await page.getByRole('menuitemradio', { name: 'Time Trend' }).click()
  }
  await page.getByTestId('time-trend-expand').click()
  return page.getByRole('dialog', { name: 'Time Trend' })
}

async function storedSolves(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('cubelab:sessions:v1')!).sessions.flatMap((session: { solves: unknown[] }) => session.solves))
}

test('trimming migrates, recalculates stats/chart/PB details, and persists without changing solves', async ({ page }) => {
  await seedHistory(page)
  // The resizable Statistics panel initially shows only the first few enabled
  // rows; expand it so all average/trim assertions are visible during the test.
  const _divider = page.getByTestId('stats-solves-divider')
  if (await _divider.count()) {
    await _divider.focus()
    for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowDown')
    await page.waitForTimeout(250)
  }
  const original = await storedSolves(page)
  const __testids = await page.locator('[data-testid^="best-"]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('data-testid')))
  console.log('DEBUG testids', JSON.stringify(__testids))
  await expect(page.getByTestId('best-ao1000')).toHaveText('10.00')
  await expect(page.getByTestId('best-mo3')).toHaveText('9.67')
  let settings = await openSettings(page)
  await expect(settings.getByTestId('average-trim-better')).toHaveValue('p5')
  await expect(settings.getByTestId('average-trim-worse')).toHaveValue('auto')
  await expect(settings.getByTestId('average-trim-example')).toContainText('50 fastest and 50 worst; 900 solves count')
  await settings.getByTestId('settings-done').click()

  let trend = await openTrend(page)
  await trend.getByRole('button', { name: 'ao1000', exact: true }).click()
  await expect(trend.locator('[data-series="ao1000"]')).not.toHaveAttribute('d', '')
  const pb = page.getByRole('button', { name: 'PB solve #1005, 9.00. Show stats' })
  await pb.click()
  let details = page.getByRole('dialog', { name: 'Personal best' })
  await expect(details.getByTestId('pb-stats-ao1000')).toHaveText('10.00')
  await expect(details.getByTestId('pb-stats-ao50')).toHaveText('10.00')
  await expect(details.getByTestId('pb-stats-mo3')).toHaveText('9.67')
  await details.getByRole('button', { name: 'Close PB stats' }).click()
  await trend.getByRole('button', { name: 'Close Time Trend' }).click()

  settings = await openSettings(page)
  await settings.getByTestId('average-trim-better').selectOption('1')
  await expect(settings.getByTestId('average-trim-example')).toContainText('1 fastest and 1 worst; 998 solves count')
  await settings.getByTestId('settings-done').click()
  const _divider2 = page.getByTestId('stats-solves-divider')
  if (await _divider2.count()) {
    await _divider2.focus()
    for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowDown')
    await page.waitForTimeout(250)
  }
  await expect(page.getByTestId('best-ao1000')).toHaveText('—')
  await expect(page.getByTestId('best-ao1000').locator('..').locator('.stat-latest')).toContainText('DNF')
  await expect(page.getByTestId('best-ao50').locator('..').locator('.stat-latest')).toContainText('DNF')
  await expect(page.getByTestId('best-mo3')).toHaveText('9.67')
  trend = await openTrend(page)
  await expect(trend.locator('[data-series="ao1000"]')).toHaveAttribute('d', '')
  await pb.click()
  details = page.getByRole('dialog', { name: 'Personal best' })
  await expect(details.getByTestId('pb-stats-time')).toHaveText('9.00')
  await expect(details.getByTestId('pb-stats-ao1000')).toHaveText('DNF')
  await expect(details.getByTestId('pb-stats-ao50')).toHaveText('DNF')
  await expect(details.getByTestId('pb-stats-mo3')).toHaveText('9.67')
  await details.getByRole('button', { name: 'Close PB stats' }).click()
  await trend.getByRole('button', { name: 'Close Time Trend' }).click()
  expect(await storedSolves(page)).toEqual(original)
  await page.reload()
  settings = await openSettings(page)
  await expect(settings.getByTestId('average-trim-better')).toHaveValue('1')
  await expect(settings.getByTestId('average-trim-worse')).toHaveValue('auto')
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('cubelab:settings:v1')!).version)).toBe(9)
  expect(await storedSolves(page)).toEqual(original)
})

test('independent and median trimming controls fit 320px and remain accessible', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 })
  await seedHistory(page)
  const settings = await openSettings(page)
  await settings.getByTestId('average-trim-better').selectOption('p1')
  await settings.getByTestId('average-trim-worse').selectOption('p10')
  await expect(settings.getByTestId('average-trim-example')).toContainText('10 fastest and 100 worst; 890 solves count')
  await settings.getByTestId('average-trim-better').selectOption('median')
  await settings.getByTestId('average-trim-worse').selectOption('auto')
  await expect(settings.getByTestId('average-trim-example')).toContainText('499 fastest and 499 worst; 2 solves count')
  await settings.getByTestId('average-trim-better').selectOption('0')
  await expect(settings.getByTestId('average-trim-example')).toContainText('0 fastest and 0 worst; 1000 solves count')
  await settings.getByTestId('average-trimming-settings').scrollIntoViewIfNeeded()
  expect(await settings.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)
  const result = await new AxeBuilder({ page }).include('.settings-dialog').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  expect(result.violations).toEqual([])
})

test('Drive trimming conflicts show readable choices and apply the selected rule', async ({ page }) => {
  test.setTimeout(60000)
  await seedHistory(page)
  const settings = await openSettings(page)
  // Both devices must have edited this field; an untouched default is adopted without a conflict.
  await settings.getByTestId('average-trim-better').selectOption('p10')
  await settings.getByTestId('settings-drive-button').click()
  const drive = page.getByRole('dialog', { name: 'Google Drive backup' })
  await drive.getByTestId('drive-connect').click()
  await drive.getByTestId('sync-now').click()
  await expect(drive.getByTestId('sync-status')).toContainText('synced', { timeout: 15000 })
  await drive.getByRole('button', { name: /Advanced settings/ }).click()
  await drive.getByLabel('Manual conflict review').check()
  await page.evaluate(async () => {
    const sessions = JSON.parse(localStorage.getItem('cubelab:sessions:v1')!)
    const settings = JSON.parse(localStorage.getItem('cubelab:settings:v1')!).settings
    const updatedAt = Date.now() + 60000
    const backup = { app: 'CubeLab', format: 'cubelab-backup', version: 1, exportedAt: new Date().toISOString(),
      sessions, settings: { ...settings, averageTrimBetter: '1' },
      sync: { protocolVersion: 1, revision: 100, deviceId: 'trim-remote', updatedAt, tombstones: [], conflicts: [], sessionRedirects: [],
        settingsFieldUpdates: { averageTrimBetter: { updatedAt, editorId: 'trim-remote' } },
      },
    }
    const mock = (window as unknown as { __cubeLabMockDrive: { uploadBackup: (content: string, id: string | null) => Promise<unknown> } }).__cubeLabMockDrive
    await mock.uploadBackup(JSON.stringify(backup), null)
  })
  await drive.getByTestId('sync-now').click()
  const conflicts = drive.getByTestId('sync-conflicts')
  await expect(conflicts).toBeVisible()
  await expect(conflicts).toContainText('average trimming (better side)')
  await expect(conflicts).toContainText('This device: 10%')
  await expect(conflicts).toContainText('Cloud: 1 solve')
  await conflicts.getByRole('button', { name: 'Use cloud', exact: true }).click()
  await expect(drive.getByTestId('sync-status')).toContainText('synced', { timeout: 15000 })
  await drive.getByTestId('drive-done').click()
  const _divider2 = page.getByTestId('stats-solves-divider')
  if (await _divider2.count()) {
    await _divider2.focus()
    for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowDown')
    await page.waitForTimeout(250)
  }
  await expect(page.getByTestId('best-ao1000')).toHaveText('—')
  const after = await openSettings(page)
  await expect(after.getByTestId('average-trim-better')).toHaveValue('1')
  await expect(after.getByTestId('average-trim-worse')).toHaveValue('auto')
})
