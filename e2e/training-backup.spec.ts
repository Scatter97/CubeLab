import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { closedTrainingHistory, NOW, setup } from '../src/lib/training/persistenceFixtures.test-support'
import { createTrainingAttempt, createTrainingVisit } from '../src/lib/training/records'
import { createEmptyTrainingData, TRAINING_STORAGE_KEY } from '../src/lib/training/storage'
import type { TrainingData } from '../src/lib/training/types'
import { createBackup } from '../src/lib/backup'
import { DEFAULT_SETTINGS } from '../src/lib/storage'

const TIMER = '[data-testid="timer-surface"]'

async function waitForApp(page: Page) {
  await expect(page.locator('.scramble-text')).toBeVisible({ timeout: 30_000 })
}

async function openBackup(page: Page) {
  await page.getByTestId('settings-button').click()
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await expect(settings).toBeVisible()
  await settings.getByTestId('settings-backup-button').click()
  await expect(settings).toBeHidden()
  const dialog = page.getByRole('dialog', { name: 'Your local data' })
  await expect(dialog).toBeVisible()
  return dialog
}

async function trainingRaw(page: Page): Promise<TrainingData | null> {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  }, TRAINING_STORAGE_KEY)
}

function largeTrainingHistory(count: number): TrainingData {
  const base = createEmptyTrainingData()
  const template = createTrainingAttempt({
    id: 'large-0',
    visitId: 'large-visit',
    setup: setup('oll', 'execution'),
    rawMs: 1_234,
    createdAt: NOW,
  })
  const attempts = Array.from({ length: count }, (_, index) => ({
    ...template,
    id: `large-${index}`,
    createdAt: NOW + index,
  }))
  return {
    ...base,
    attempts,
    visits: [
      {
        version: 1,
        id: 'large-visit',
        startedAt: NOW,
        endedAt: NOW + count + 1,
        startedCategoryId: 'oll:execution',
        categoryIds: ['oll:execution'],
        attemptIds: attempts.map((attempt) => attempt.id),
        summaryId: null,
      },
    ],
  }
}

test('native backup includes Training history and leaves it unchanged without a section', async ({ page }) => {
  test.setTimeout(90_000)
  const training = closedTrainingHistory()
  await page.addInitScript(
    ({ key, raw }) => {
      if (!sessionStorage.getItem('training-backup-seeded')) {
        localStorage.setItem(key, raw)
        sessionStorage.setItem('training-backup-seeded', 'true')
      }
    },
    { key: TRAINING_STORAGE_KEY, raw: JSON.stringify(training) },
  )
  await page.goto('/')
  await waitForApp(page)

  const dialog = await openBackup(page)
  await expect(dialog.getByTestId('data-training-summary')).toContainText(
    'Training: 1 attempt · 1 session · 1 calibration',
  )
  await expect(dialog.getByTestId('training-backup-note')).toContainText(
    'Training history is included in new backups',
  )
  const downloadPromise = page.waitForEvent('download')
  await dialog.getByTestId('export-backup').click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(
    /^cubelab-backup-\d{4}-\d{2}-\d{2}\.json$/,
  )
  const downloadPath = await download.path()
  expect(downloadPath).not.toBeNull()
  if (!downloadPath) throw new Error('Backup download has no path')
  const backup = JSON.parse(readFileSync(downloadPath, 'utf8')) as {
    training?: { version: number; data: TrainingData }
  }
  expect(backup.training?.version).toBe(1)
  expect(backup.training?.data.attempts).toHaveLength(1)
  expect(backup.training?.data.visits.find((visit) => visit.session)?.session?.name).toBe(
    'Backup fixture',
  )

  await page.evaluate((key) => localStorage.removeItem(key), TRAINING_STORAGE_KEY)
  await page.reload()
  await waitForApp(page)
  expect(await trainingRaw(page)).toBeNull()

  await openBackup(page)
  const previewStarted = performance.now()
  await page.getByTestId('backup-file-input').setInputFiles(downloadPath)
  const confirm = page.getByRole('dialog', {
    name: 'Replace local sessions and Training?',
  })
  await expect(confirm).toBeVisible()
  const previewMs = Math.round(performance.now() - previewStarted)
  await expect(confirm).toContainText('Training history will be replaced')
  await expect(confirm).toContainText('1 attempt')
  await expect(confirm).toContainText('1 saved session')
  await expect(confirm).toContainText('1 calibration')
  await expect(confirm).toContainText('Imported Training sessions stay ended')
  const restoreStarted = performance.now()
  await confirm.getByRole('button', { name: 'Import backup' }).click()
  await expect(page.getByRole('status')).toContainText('Backup imported')
  const restoreMs = Math.round(performance.now() - restoreStarted)
  await expect
    .poll(async () => (await trainingRaw(page))?.attempts.length)
    .toBe(1)
  expect((await trainingRaw(page))?.activeVisitId).toBeNull()
  expect((await trainingRaw(page))?.calibrations).toHaveLength(1)
  expect(
    (await trainingRaw(page))?.preferences.selectedSetId,
  ).toBe('oll')

  const hubStarted = performance.now()
  await page.getByTestId('training-nav').click()
  const hub = page.getByRole('main', { name: 'Training Hub' })
  await expect(hub).toBeVisible()
  const hubMs = Math.round(performance.now() - hubStarted)
  await expect(hub.getByRole('heading', { name: 'Recent sessions' })).toBeVisible()
  await expect(hub.getByRole('button', { name: 'Review Backup fixture' })).toBeVisible()
  await hub.getByRole('button', { name: 'View all practice history' }).click()
  const history = page.getByRole('dialog', { name: 'Practice history' })
  await history.getByRole('button', { name: 'Review Backup fixture' }).click()
  const report = page.getByRole('dialog', { name: 'Backup fixture' })
  await expect(report.getByRole('region', { name: 'Practice report' })).toContainText(
    '1.23',
  )
  await expect(report).toContainText('OLL execution')
  await expect(report).toContainText('Successes')
  await report.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(history).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(history).toBeHidden()

  const algorithmsStarted = performance.now()
  await hub.getByRole('button', { name: 'Algorithms', exact: true }).click()
  const analytics = page.getByRole('main', { name: 'Algorithms' })
  await analytics.getByLabel('Date range').selectOption('0')
  await expect(analytics.getByTestId('algorithms-attempt-count')).toHaveText('1')
  await expect(analytics.getByTestId('algorithms-progression')).toBeVisible()
  const algorithmsMs = Math.round(performance.now() - algorithmsStarted)
  test.info().annotations.push({
    type: 'measurement',
    description: `small Training backup preview ${previewMs} ms, restore ${restoreMs} ms, Hub ${hubMs} ms, Algorithms ${algorithmsMs} ms`,
  })

  // A backup without Training must not clear or replace the restored store.
  const withoutTraining = JSON.parse(readFileSync(downloadPath, 'utf8')) as Record<
    string,
    unknown
  >
  delete withoutTraining.training
  const before = await page.evaluate((key) => localStorage.getItem(key), TRAINING_STORAGE_KEY)
  await openBackup(page)
  await page.getByTestId('backup-file-input').setInputFiles({
    name: 'cubelab-backup-without-training.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(withoutTraining)),
  })
  const noTrainingConfirm = page.getByRole('dialog', {
    name: 'Replace local sessions?',
  })
  await expect(noTrainingConfirm).toBeVisible()
  await expect(noTrainingConfirm).toContainText(
    'This backup has no Training section, so local Training stays unchanged.',
  )
  await noTrainingConfirm.getByRole('button', { name: 'Import backup' }).click()
  await expect(page.getByRole('status')).toContainText('Backup imported')
  expect(
    await page.evaluate((key) => localStorage.getItem(key), TRAINING_STORAGE_KEY),
  ).toBe(before)
})

test('an open Training decision blocks a Training restore with an explicit reason', async ({ page }) => {
  test.setTimeout(60_000)
  const visit = createTrainingVisit('oll:execution', Date.now(), 'open-training-visit')
  await page.addInitScript(
    ({ key, raw }) => {
      if (!sessionStorage.getItem('training-block-seeded')) {
        localStorage.setItem(key, raw)
        sessionStorage.setItem('training-block-seeded', 'true')
      }
    },
    {
      key: TRAINING_STORAGE_KEY,
      raw: JSON.stringify({
        ...createEmptyTrainingData(),
        visits: [visit],
        activeVisitId: visit.id,
      }),
    },
  )
  await page.goto('/')
  await waitForApp(page)

  const backup = createBackup(
    {
      activeSessionId: 'session-1',
      sessions: [
        {
          id: 'session-1',
          name: 'Morning',
          event: '333',
          createdAt: 1_700_000_000_000,
          updatedAt: 1_700_000_000_000,
          solves: [],
        },
      ],
    },
    DEFAULT_SETTINGS,
    new Date(),
    undefined,
    closedTrainingHistory(),
  )
  const before = await page.evaluate((key) => localStorage.getItem(key), TRAINING_STORAGE_KEY)

  await openBackup(page)
  await page.getByTestId('backup-file-input').setInputFiles({
    name: 'training-backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup)),
  })
  const error = page.getByTestId('backup-error')
  await expect(error).toContainText('Training history cannot be replaced yet')
  await expect(error).toContainText('resume or end decision')
  await expect(error).toContainText('The backup was not imported.')
  await expect(
    page.getByRole('dialog', { name: 'Replace local sessions and Training?' }),
  ).toHaveCount(0)
  expect(
    await page.evaluate((key) => localStorage.getItem(key), TRAINING_STORAGE_KEY),
  ).toBe(before)
})

test('a failed Training write during import rolls back every key', async ({ page }) => {
  test.setTimeout(60_000)
  const training = closedTrainingHistory()
  await page.addInitScript(
    ({ key, raw }) => {
      if (!sessionStorage.getItem('training-failure-seeded')) {
        localStorage.setItem(key, raw)
        sessionStorage.setItem('training-failure-seeded', 'true')
      }
    },
    { key: TRAINING_STORAGE_KEY, raw: JSON.stringify(training) },
  )
  await page.goto('/')
  await waitForApp(page)

  const trainingBefore = await page.evaluate(
    (key) => localStorage.getItem(key),
    TRAINING_STORAGE_KEY,
  )
  const sessionsBefore = await page.evaluate(() =>
    localStorage.getItem('cubelab:sessions:v1'),
  )

  const backup = createBackup(
    {
      activeSessionId: 'imported-session',
      sessions: [
        {
          id: 'imported-session',
          name: 'Imported session',
          event: '333',
          createdAt: 1_700_000_000_000,
          updatedAt: 1_700_000_000_000,
          solves: [],
        },
      ],
    },
    { ...DEFAULT_SETTINGS, theme: 'dark' },
    new Date(),
    undefined,
    training,
  )

  await page.evaluate(
    ({ key }) => {
      const original = Storage.prototype.setItem
      Storage.prototype.setItem = function (storageKey, value) {
        if (storageKey === key) {
          throw new DOMException('Synthetic Training failure', 'QuotaExceededError')
        }
        original.call(this, storageKey, value)
      }
    },
    { key: TRAINING_STORAGE_KEY },
  )

  await openBackup(page)
  await page.getByTestId('backup-file-input').setInputFiles({
    name: 'training-backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup)),
  })
  const confirm = page.getByRole('dialog', {
    name: 'Replace local sessions and Training?',
  })
  await expect(confirm).toBeVisible()
  await confirm.getByRole('button', { name: 'Import backup' }).click()

  const status = page.getByRole('status')
  await expect(status).toContainText('Training history could not be saved')
  await expect(status).toContainText('Nothing was replaced')
  expect(
    await page.evaluate((key) => localStorage.getItem(key), TRAINING_STORAGE_KEY),
  ).toBe(trainingBefore)
  expect(
    await page.evaluate(() => localStorage.getItem('cubelab:sessions:v1')),
  ).toBe(sessionsBefore)
  expect(
    await page.evaluate(() => localStorage.getItem('cubelab:replacement:v1')),
  ).toBeNull()
})

test('a synthetic backup above 10 MB exports and restores through checked gzip', async ({ page }) => {
  test.setTimeout(180_000)
  const raw = JSON.stringify(largeTrainingHistory(10_500))
  expect(new TextEncoder().encode(raw).byteLength).toBeGreaterThan(10 * 1024 * 1024)

  await page.addInitScript(
    ({ key, raw }) => {
      let trainingValue: string | null = sessionStorage.getItem(
        'training-large-seeded',
      )
        ? null
        : raw
      sessionStorage.setItem('training-large-seeded', 'true')
      const originalGet = Storage.prototype.getItem
      const originalSet = Storage.prototype.setItem
      const originalRemove = Storage.prototype.removeItem
      Storage.prototype.getItem = function (storageKey) {
        if (storageKey === key) return trainingValue
        return originalGet.call(this, storageKey)
      }
      Storage.prototype.setItem = function (storageKey, value) {
        if (storageKey === key) {
          trainingValue = value
          return
        }
        originalSet.call(this, storageKey, value)
      }
      Storage.prototype.removeItem = function (storageKey) {
        if (storageKey === key) {
          trainingValue = null
          return
        }
        originalRemove.call(this, storageKey)
      }
      ;(window as unknown as {
        __trainingValue: () => string | null
        __clearTrainingValue: () => void
      }).__trainingValue = () => trainingValue
      ;(window as unknown as { __clearTrainingValue: () => void }).__clearTrainingValue =
        () => {
          trainingValue = null
        }
    },
    { key: TRAINING_STORAGE_KEY, raw },
  )
  await page.goto('/')
  await waitForApp(page)

  const dialog = await openBackup(page)
  await expect(dialog.getByTestId('data-training-summary')).toContainText(
    '10,500 attempts',
  )
  const downloadPromise = page.waitForEvent('download')
  const exportStarted = performance.now()
  await dialog.getByTestId('export-backup').click()
  const download = await downloadPromise
  const exportMs = Math.round(performance.now() - exportStarted)
  expect(download.suggestedFilename()).toMatch(
    /^cubelab-backup-\d{4}-\d{2}-\d{2}\.json\.gz$/,
  )
  const downloadPath = await download.path()
  expect(downloadPath).not.toBeNull()
  if (!downloadPath) throw new Error('Compressed backup download has no path')
  const encoded = readFileSync(downloadPath)
  expect(encoded[0]).toBe(0x1f)
  expect(encoded[1]).toBe(0x8b)
  const decoded = gunzipSync(encoded)
  expect(decoded.byteLength).toBeGreaterThan(10 * 1024 * 1024)
  const parsed = JSON.parse(decoded.toString('utf8')) as {
    training?: { data: TrainingData }
  }
  expect(parsed.training?.data.attempts).toHaveLength(10_500)

  await page.evaluate(() => {
    ;(window as unknown as { __clearTrainingValue: () => void }).__clearTrainingValue()
  })
  await page.reload()
  await waitForApp(page)
  expect(
    await page.evaluate(() => {
      const read = (window as unknown as { __trainingValue: () => string | null })
        .__trainingValue
      const value = read()
      return value === null ? null : (JSON.parse(value) as TrainingData).attempts.length
    }),
  ).toBeNull()

  await openBackup(page)
  const previewStarted = performance.now()
  await page.getByTestId('backup-file-input').setInputFiles(downloadPath)
  const confirm = page.getByRole('dialog', {
    name: 'Replace local sessions and Training?',
  })
  await expect(confirm).toBeVisible()
  const previewMs = Math.round(performance.now() - previewStarted)
  await expect(confirm).toContainText('10,500 attempts')
  const restoreStarted = performance.now()
  await confirm.getByRole('button', { name: 'Import backup' }).click()
  await expect(page.getByRole('status')).toContainText('Backup imported')
  const restoreMs = Math.round(performance.now() - restoreStarted)
  test.info().annotations.push({
    type: 'measurement',
    description: `compressed backup ${encoded.byteLength} encoded / ${decoded.byteLength} decoded bytes; export ${exportMs} ms, preview ${previewMs} ms, restore ${restoreMs} ms`,
  })
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const read = (window as unknown as { __trainingValue: () => string | null })
          .__trainingValue
        const value = read()
        return value === null
          ? null
          : (JSON.parse(value) as TrainingData).attempts.length
      }),
    )
    .toBe(10_500)
  expect(
    await page.evaluate(() => {
      const read = (window as unknown as { __trainingValue: () => string | null })
        .__trainingValue
      return (JSON.parse(read()!) as TrainingData).activeVisitId
    }),
  ).toBeNull()

  await page.getByTestId('training-nav').click()
  await expect(page.getByRole('main', { name: 'Training Hub' })).toBeVisible()
  await expect(page.locator(TIMER)).toHaveCount(0)
})
