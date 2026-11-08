import { expect, test } from '@playwright/test'

const now = Date.now()
const original = { version: 6, activeSessionId: 'safe-session', sessions: [{ id: 'safe-session', name: 'Keep history', event: '333', createdAt: now, updatedAt: now, solves: [{ id: 'safe-solve', event: '333', rawMs: 12340, penalty: 'none', scramble: 'R U', comment: 'Keep me', createdAt: now }] }] }

for (const failedKey of ['cubelab:sessions:v1', 'cubelab:solves:v1']) {
  test(`startup preserves bytes after an unreadable ${failedKey} and retries safely`, async ({ page }) => {
    await page.addInitScript(({ data, failedKey }) => {
      if (!sessionStorage.getItem('safety-seeded')) {
        sessionStorage.setItem('safety-seeded', '1')
        if (failedKey === 'cubelab:sessions:v1') localStorage.setItem(failedKey, JSON.stringify(data))
        else localStorage.setItem(failedKey, JSON.stringify({ version: 1, solves: data.sessions[0]!.solves }))
      }
      const read = Storage.prototype.getItem
      let failed = false
      Storage.prototype.getItem = function(key) {
        if (key === failedKey && !failed) { failed = true; throw new Error('Synthetic first-read failure') }
        return read.call(this, key)
      }
    }, { data: original, failedKey })
    await page.goto('/')
    await expect(page.getByTestId('startup-recovery')).toBeVisible()
    await expect(page.getByTestId('timer-surface')).toHaveCount(0)
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), failedKey)).toEqual(failedKey === 'cubelab:sessions:v1' ? original : { version: 1, solves: original.sessions[0]!.solves })
    if (failedKey === 'cubelab:solves:v1') expect(await page.evaluate(() => localStorage.getItem('cubelab:sessions:v1'))).toBeNull()
    await page.getByTestId('startup-recovery-retry').click()
    await expect(page.locator('.scramble-text')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('solve-count')).toHaveText('1')
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('cubelab:sessions:v1')!).sessions[0].solves[0])).toEqual(original.sessions[0]!.solves[0])
  })
}

test('native import rejects an invalid date while leaving the current collection intact', async ({ page }) => {
  await page.addInitScript(data => localStorage.setItem('cubelab:sessions:v1', JSON.stringify(data)), original)
  await page.goto('/')
  await expect(page.locator('.scramble-text')).toBeVisible({ timeout: 30_000 })
  const before = await page.evaluate(() => localStorage.getItem('cubelab:sessions:v1'))
  const settings = await page.evaluate(() => JSON.parse(localStorage.getItem('cubelab:settings:v1')!))
  const invalid = structuredClone(original)
  invalid.sessions[0]!.solves[0]!.createdAt = 1e20
  const backup = { app: 'CubeLab', format: 'cubelab-backup', version: 1, exportedAt: new Date().toISOString(), sessions: invalid, settings }
  await page.getByTestId('settings-button').click()
  await page.getByTestId('settings-backup-button').click()
  await page.getByTestId('backup-file-input').setInputFiles({ name: 'invalid-date.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) })
  await expect(page.getByTestId('backup-error')).toContainText(/date/i)
  expect(await page.evaluate(() => localStorage.getItem('cubelab:sessions:v1'))).toBe(before)
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('solve-count')).toHaveText('1')
})

test('previously stored invalid dates show recovery without rewriting the original records', async ({ page }) => {
  const invalid = structuredClone(original)
  invalid.sessions[0]!.solves[0]!.createdAt = 1e20
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(data => localStorage.setItem('cubelab:sessions:v1', JSON.stringify(data)), invalid)
  await page.goto('/')
  await expect(page.getByTestId('startup-recovery')).toBeVisible()
  await expect(page.getByTestId('startup-recovery')).toContainText(/date/i)
  await expect(page.getByTestId('timer-surface')).toHaveCount(0)
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('cubelab:sessions:v1')!))).toEqual(invalid)
  expect(errors).toEqual([])
})
