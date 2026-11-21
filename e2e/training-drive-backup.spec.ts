import { expect, test, type Locator, type Page } from '@playwright/test'
import { closedTrainingHistory, NOW } from '../src/lib/training/persistenceFixtures.test-support'
import { createTrainingVisit } from '../src/lib/training/records'
import {
  createEmptyTrainingData,
  TRAINING_STORAGE_KEY,
} from '../src/lib/training/storage'
import {
  createTrainingDriveBackup,
  serializeTrainingDriveBackup,
} from '../src/lib/trainingDrive'

async function waitForApp(page: Page) {
  await expect(page.locator('.scramble-text')).toBeVisible({ timeout: 30_000 })
}

async function openDrive(page: Page) {
  await page.getByTestId('settings-button').click()
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await expect(settings).toBeVisible()
  await settings.getByTestId('settings-drive-button').click()
  await expect(settings).toBeHidden()
  const dialog = page.getByRole('dialog', { name: 'Google Drive backup' })
  await expect(dialog).toBeVisible()
  return dialog
}

async function connectDrive(dialog: Locator) {
  if (await dialog.getByTestId('drive-connect').isVisible()) {
    await dialog.getByTestId('drive-connect').click()
  }
  await expect(dialog.getByTestId('drive-disconnect')).toBeVisible()
}

async function trainingRaw(page: Page) {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  }, TRAINING_STORAGE_KEY)
}

test('manual Training cloud backup and replace-only restore round trip', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const training = closedTrainingHistory()
  await page.addInitScript(
    ({ key, raw }) => {
      if (!sessionStorage.getItem('training-drive-seeded')) {
        localStorage.setItem(key, raw)
        sessionStorage.setItem('training-drive-seeded', 'true')
      }
    },
    { key: TRAINING_STORAGE_KEY, raw: JSON.stringify(training) },
  )
  await page.goto('/')
  await waitForApp(page)

  let dialog = await openDrive(page)
  await connectDrive(dialog)
  await expect(dialog.getByTestId('training-local-summary')).toContainText(
    '1 attempt',
  )
  await dialog.getByTestId('training-backup-upload').click()
  await expect(page.getByRole('status')).toContainText(
    'Training history backed up to Google Drive',
  )
  await expect(dialog.getByTestId('training-remote-snapshot')).toHaveCount(1)
  await expect(dialog.getByTestId('training-last-upload')).toContainText(
    'Latest remote Training snapshot',
  )

  const remote = await page.evaluate(async () => {
    const transport = (
      window as {
        __cubeLabMockDrive?: {
          listTrainingBackups?: () => Promise<Array<{ id: string; name: string }>>
          downloadBackup: (id: string) => Promise<string>
          listBackups?: () => Promise<unknown[]>
        }
      }
    ).__cubeLabMockDrive
    if (!transport?.listTrainingBackups) throw new Error('mock transport missing')
    const trainingFiles = await transport.listTrainingBackups()
    const solveFiles = (await transport.listBackups?.()) ?? []
    return {
      count: trainingFiles.length,
      solveCount: solveFiles.length,
      name: trainingFiles[0]?.name ?? '',
      content: trainingFiles[0]
        ? await transport.downloadBackup(trainingFiles[0].id)
        : '',
    }
  })
  expect(remote.count).toBe(1)
  expect(remote.solveCount).toBe(0)
  expect(remote.name).toContain('cubelab-training-')
  expect(remote.content).toContain('"format":"cubelab-training-backup"')

  // The solve snapshot section must not list a Training file.
  await expect(dialog.getByTestId('remote-snapshot-empty')).toBeVisible()
  await page.getByTestId('drive-done').click()

  await page.evaluate((key) => localStorage.removeItem(key), TRAINING_STORAGE_KEY)
  await page.reload()
  await waitForApp(page)
  expect(await trainingRaw(page)).toBeNull()

  // The mock Drive is document-local, so re-seed the captured remote file into
  // this newly loaded document to represent the same cloud account.
  await page.evaluate(async (content) => {
    const transport = (
      window as {
        __cubeLabMockDrive?: {
          connect: () => Promise<void>
          uploadTrainingBackup: (value: string, deviceId: string) => Promise<unknown>
        }
      }
    ).__cubeLabMockDrive
    if (!transport) throw new Error('mock transport missing')
    await transport.connect()
    await transport.uploadTrainingBackup(content, 'remote-training-device')
  }, remote.content)

  dialog = await openDrive(page)
  await connectDrive(dialog)
  await expect(dialog.getByTestId('training-remote-snapshot')).toHaveCount(1)
  await dialog.getByTestId('training-restore-snapshot').click()
  const confirm = page.getByRole('dialog', {
    name: 'Replace local Training history?',
  })
  await expect(confirm).toBeVisible()
  await expect(confirm).toContainText('No imported Training visit will be resumed')
  await expect(confirm).toContainText('1 attempt')
  await confirm.getByTestId('confirm-text').fill('RESTORE TRAINING')
  await confirm.getByRole('button', { name: 'Replace Training' }).click()
  await expect(page.getByRole('status')).toContainText(
    'Training history restored from Google Drive',
  )

  await expect
    .poll(async () => (await trainingRaw(page))?.attempts.length)
    .toBe(1)
  expect((await trainingRaw(page))?.activeVisitId).toBeNull()

  await page.getByTestId('training-nav').click()
  const hub = page.getByRole('main', { name: 'Training Hub' })
  await expect(hub).toBeVisible()
  await expect(hub.getByRole('button', { name: 'Review Backup fixture' })).toBeVisible()
  await hub.getByRole('button', { name: 'View all practice history' }).click()
  const history = page.getByRole('dialog', { name: 'Practice history' })
  await history.getByRole('button', { name: 'Review Backup fixture' }).click()
  const report = page.getByRole('dialog', { name: 'Backup fixture' })
  await expect(report.getByRole('region', { name: 'Practice report' })).toContainText(
    '1.23',
  )
  await expect(report).toContainText('OLL execution')
  await report.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(history).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(history).toBeHidden()
  await hub.getByRole('button', { name: 'Algorithms', exact: true }).click()
  const analytics = page.getByRole('main', { name: 'Algorithms' })
  await analytics.getByLabel('Date range').selectOption('0')
  await expect(analytics.getByTestId('algorithms-attempt-count')).toHaveText('1')
  await expect(analytics.getByTestId('algorithms-progression')).toBeVisible()
})

test('an open Training decision blocks upload and restore with explicit messages', async ({
  page,
}) => {
  test.setTimeout(90_000)
  const visit = createTrainingVisit('oll:execution', NOW, 'open-drive-visit')
  await page.addInitScript(
    ({ key, raw }) => {
      if (!sessionStorage.getItem('training-drive-block-seeded')) {
        localStorage.setItem(key, raw)
        sessionStorage.setItem('training-drive-block-seeded', 'true')
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

  // Seed a valid remote snapshot directly; it must not be restored over the
  // unresolved local visit.
  const remote = serializeTrainingDriveBackup(
    createTrainingDriveBackup(closedTrainingHistory(), 'remote-device'),
  )
  if (!remote.ok) throw new Error(remote.error)
  await page.evaluate(async (content) => {
    const transport = (
      window as {
        __cubeLabMockDrive?: {
          connect: () => Promise<void>
          uploadTrainingBackup: (value: string, deviceId: string) => Promise<unknown>
        }
      }
    ).__cubeLabMockDrive
    if (!transport) throw new Error('mock transport missing')
    await transport.connect()
    await transport.uploadTrainingBackup(content, 'remote-device')
  }, remote.raw)

  const dialog = await openDrive(page)
  await connectDrive(dialog)
  await expect(dialog.getByTestId('training-upload-blocked')).toContainText(
    /Training session|resume or end/,
  )
  await expect(dialog.getByTestId('training-backup-upload')).toBeDisabled()
  await expect(dialog.getByTestId('training-remote-snapshot')).toHaveCount(1)
  await dialog.getByTestId('training-restore-snapshot').click()
  const confirm = page.getByRole('dialog', {
    name: 'Replace local Training history?',
  })
  await confirm.getByTestId('confirm-text').fill('RESTORE TRAINING')
  await confirm.getByRole('button', { name: 'Replace Training' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Training restore blocked' })).toContainText(
    /Training restore blocked.*Nothing was replaced/,
  )
  expect((await trainingRaw(page))?.activeVisitId).toBe('open-drive-visit')
  expect((await trainingRaw(page))?.attempts).toHaveLength(0)
})
