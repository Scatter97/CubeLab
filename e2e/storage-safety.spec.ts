import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

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

test('corrupt settings keep valid sessions intact and export exact recovery bytes', async ({ page }) => {
  const settingsRaw = JSON.stringify({ version: 99, settings: { future: true } })
  await page.addInitScript(({ data, settingsRaw }) => {
    if (sessionStorage.getItem('settings-recovery-seeded')) return
    sessionStorage.setItem('settings-recovery-seeded', '1')
    localStorage.setItem('cubelab:sessions:v1', JSON.stringify(data))
    localStorage.setItem('cubelab:settings:v1', settingsRaw)
  }, { data: original, settingsRaw })
  await page.goto('/')
  await expect(page.getByTestId('startup-recovery')).toBeVisible()
  await expect(page.getByTestId('timer-surface')).toHaveCount(0)
  expect(await page.evaluate(() => localStorage.getItem('cubelab:settings:v1'))).toBe(settingsRaw)
  expect(await page.evaluate(() => localStorage.getItem('cubelab:sessions:v1'))).toBe(JSON.stringify(original))

  await page.getByRole('button', { name: 'View recovery information' }).click()
  await expect(page.getByText(/Unsupported version/)).toBeVisible()
  await expect(page.getByText(/Sessions/).first()).toBeVisible()

  const downloadPromise = page.waitForEvent('download')
  await page.getByTestId('recovery-download').click()
  const download = await downloadPromise
  const path = await download.path()
  expect(path).not.toBeNull()
  const text = await readFile(path!, 'utf8')
  const pkg = JSON.parse(text) as {
    format: string
    records: Array<{ key: string; raw: string | null; sourceVersion: number | null }>
  }
  expect(pkg.format).toBe('cubelab-recovery')
  expect(pkg.records.find((record) => record.key === 'cubelab:settings:v1')).toMatchObject({
    raw: settingsRaw,
    sourceVersion: 99,
  })
  expect(pkg.records.find((record) => record.key === 'cubelab:sessions:v1')?.raw).toBe(JSON.stringify(original))
  expect(await page.evaluate(() => localStorage.getItem('cubelab:settings:v1'))).toBe(settingsRaw)
})

test('backup export blocks a pending Undo when deletion provenance is unreadable', async ({ page }) => {
  await page.addInitScript(({ data, now }) => {
    if (sessionStorage.getItem('pending-undo-export-seeded')) return
    sessionStorage.setItem('pending-undo-export-seeded', '1')
    localStorage.setItem('cubelab:sessions:v1', JSON.stringify(data))
    localStorage.setItem('cubelab:recovery:v1', JSON.stringify({
      version: 1,
      operations: [{
        operationId: 'pending-undo',
        sessionId: data.activeSessionId,
        index: 0,
        createdAt: now,
        solve: { ...data.sessions[0]!.solves[0]!, id: 'pending-restore' },
      }],
    }))
    localStorage.setItem('cubelab:sync:v1', '{broken sync provenance')
  }, { data: original, now })
  await page.goto('/')
  await expect(page.locator('.scramble-text')).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('settings-button').click()
  await page.getByTestId('settings-backup-button').click()
  await page.getByRole('button', { name: 'Export backup' }).click()
  await expect(page.getByTestId('backup-error')).toContainText(/provenance|deletion records/i)
  expect(await page.evaluate(() => localStorage.getItem('cubelab:sync:v1'))).toBe('{broken sync provenance')
  expect(await page.evaluate(() => localStorage.getItem('cubelab:recovery:v1'))).not.toBeNull()
})

test('a verified pre-upgrade archive restores exact old settings after corruption', async ({ page }) => {
  const oldSessions = JSON.stringify({
    version: 6,
    activeSessionId: 'archive-session',
    sessions: [{
      id: 'archive-session',
      name: 'Archive history',
      event: '333',
      createdAt: now,
      updatedAt: now,
      solves: [{ id: 'archive-solve', event: '333', rawMs: 11_111, penalty: 'none', scramble: 'R U', comment: 'keep', createdAt: now }],
    }],
  })
  const oldSettings = JSON.stringify({
    version: 2,
    settings: { inspectionEnabled: true, theme: 'dark', scratch: true },
  })
  await page.addInitScript(({ oldSessions, oldSettings }) => {
    if (sessionStorage.getItem('archive-restore-seeded')) return
    sessionStorage.setItem('archive-restore-seeded', '1')
    localStorage.setItem('cubelab:sessions:v1', oldSessions)
    localStorage.setItem('cubelab:settings:v1', oldSettings)
  }, { oldSessions, oldSettings })

  await page.goto('/')
  await expect(page.locator('.scramble-text')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('solve-count')).toHaveText('1')
  const migratedSettings = await page.evaluate(() => JSON.parse(localStorage.getItem('cubelab:settings:v1')!))
  expect(migratedSettings.version).toBe(13)
  expect(migratedSettings.settings.theme).toBe('dark')

  await page.evaluate(() => localStorage.setItem('cubelab:settings:v1', '{broken settings'))
  await page.reload()
  await expect(page.getByTestId('startup-recovery')).toBeVisible()
  await page.getByRole('button', { name: 'View recovery information' }).click()
  await expect(page.getByText(/schema migration/)).toBeVisible()
  await page.getByRole('button', { name: 'Preview and restore this archive' }).first().click()
  await expect(page.getByText(/This replaces the current sessions/)).toBeVisible()
  await page.getByRole('button', { name: 'Confirm archive restore' }).click()
  await expect(page.getByText(/verified local archive was restored/)).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('cubelab:settings:v1'))).not.toBe('{broken settings')
  expect(await page.evaluate(() => localStorage.getItem('cubelab:sessions:v1'))).toBe(oldSessions)
  await page.reload()
  await expect(page.locator('.scramble-text')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('solve-count')).toHaveText('1')
})
