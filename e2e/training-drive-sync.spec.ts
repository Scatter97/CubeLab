import { expect, test, type Browser, type Locator, type Page } from '@playwright/test'
import {
  closedTrainingHistory,
  NOW,
  setup,
} from '../src/lib/training/persistenceFixtures.test-support'
import {
  appendTrainingAttempt,
  createTrainingAttempt,
  createTrainingVisit,
  finishTrainingVisit,
} from '../src/lib/training/records'
import { TRAINING_STORAGE_KEY, createEmptyTrainingData } from '../src/lib/training/storage'
import type { TrainingData } from '../src/lib/training/types'
import { TRAINING_SYNC_STORAGE_KEY } from '../src/lib/trainingSyncStorage'
import { createBackup } from '../src/lib/backup'
import { DEFAULT_SETTINGS } from '../src/lib/storage'

const STORAGE_STATE = 'e2e/storage-state.json'

async function waitForApp(page: Page) {
  await expect(page.getByTestId('settings-button')).toBeVisible({
    timeout: 30_000,
  })
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

async function enableTrainingSync(dialog: Locator) {
  const toggle = dialog.getByTestId('training-sync-enabled')
  if (!(await toggle.isChecked())) await toggle.check()
}

async function syncTrainingNow(page: Page, dialog: Locator) {
  const status = dialog.getByTestId('training-sync-status')
  const before = await status.textContent()
  await dialog.getByTestId('training-sync-now').click()
  await expect
    .poll(async () => status.textContent(), { timeout: 30_000 })
    .not.toBe(before)
  await expect(status).toContainText(/synced|conflict|failed|pending/, {
    timeout: 30_000,
  })
}

async function trainingRemoteFiles(page: Page): Promise<Array<{ name: string; content: string }>> {
  return page.evaluate(() => {
    const transport = (
      window as {
        __cubeLabMockDrive?: {
          __peekRemote?: () => Array<{ name: string; content: string }>
        }
      }
    ).__cubeLabMockDrive
    return (transport?.__peekRemote?.() ?? []).filter((file) =>
      file.name.startsWith('cubelab-training-'),
    )
  })
}

async function injectTrainingFiles(
  page: Page,
  files: ReadonlyArray<{ content: string }>,
) {
  await page.evaluate(async (contents) => {
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
    for (const content of contents) {
      const parsed = JSON.parse(content) as { deviceId?: string }
      await transport.uploadTrainingBackup(
        content,
        parsed.deviceId ?? 'imported-training-device',
      )
    }
  }, files.map((file) => file.content))
}

async function readTraining(page: Page): Promise<TrainingData | null> {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as TrainingData) : null
  }, TRAINING_STORAGE_KEY)
}

async function writeTraining(page: Page, data: TrainingData) {
  await page.evaluate(
    ({ key, raw }) => localStorage.setItem(key, raw),
    { key: TRAINING_STORAGE_KEY, raw: JSON.stringify(data) },
  )
}

function addLegacyAttempt(
  data: TrainingData,
  id: string,
  at: number,
): TrainingData {
  const visit = createTrainingVisit('oll:execution', at, `visit-${id}`)
  let next: TrainingData = {
    ...data,
    visits: [...data.visits, visit],
    activeVisitId: visit.id,
  }
  next = appendTrainingAttempt(
    next,
    createTrainingAttempt({
      id,
      setup: setup('oll', 'execution'),
      visitId: visit.id,
      rawMs: 1_500,
      createdAt: at + 1_000,
    }),
  )
  return finishTrainingVisit(next, visit.id, at + 2_000, 'navigation')
}

async function setPreference(
  page: Page,
  selectedSetId: 'oll' | 'pll',
  updatedAt: number,
  editorId: string,
) {
  await page.evaluate(
    ({ key, syncKey, selectedSetId, updatedAt, editorId }) => {
      const raw = localStorage.getItem(key)
      if (!raw) throw new Error('missing Training data')
      const data = JSON.parse(raw) as {
        preferences: { selectedSetId: string }
      }
      data.preferences.selectedSetId = selectedSetId
      localStorage.setItem(key, JSON.stringify(data))
      const syncRaw = localStorage.getItem(syncKey)
      if (!syncRaw) throw new Error('missing Training sync state')
      const sync = JSON.parse(syncRaw) as {
        runtime: { fieldUpdates: Record<string, unknown> }
      }
      sync.runtime.fieldUpdates.preferences = { updatedAt, editorId }
      localStorage.setItem(syncKey, JSON.stringify(sync))
    },
    {
      key: TRAINING_STORAGE_KEY,
      syncKey: TRAINING_SYNC_STORAGE_KEY,
      selectedSetId,
      updatedAt,
      editorId,
    },
  )
}

async function setAttemptTombstone(
  page: Page,
  attemptId: string,
  options: { active: boolean; at: number },
) {
  await page.evaluate(
    ({ syncKey, attemptId, active, at }) => {
      const raw = localStorage.getItem(syncKey)
      if (!raw) throw new Error('missing Training sync state')
      const sync = JSON.parse(raw) as {
        runtime: {
          deviceId: string
          tombstones: Array<Record<string, unknown>>
        }
      }
      const existing = sync.runtime.tombstones.find(
        (tombstone) =>
          tombstone.kind === 'attempt' && tombstone.id === attemptId,
      )
      if (existing) {
        if (active) delete existing.restoredAt
        else existing.restoredAt = at
      } else {
        sync.runtime.tombstones.push({
          kind: 'attempt',
          id: attemptId,
          visitId: `visit-${attemptId}`,
          deletedAt: at,
          deletedByDeviceId: sync.runtime.deviceId,
          ...(active ? {} : { restoredAt: at + 1 }),
        })
      }
      localStorage.setItem(syncKey, JSON.stringify(sync))
    },
    {
      syncKey: TRAINING_SYNC_STORAGE_KEY,
      attemptId,
      active: options.active,
      at: options.at,
    },
  )
}

function removeAttempt(data: TrainingData, attemptId: string): TrainingData {
  return {
    ...data,
    attempts: data.attempts.filter((attempt) => attempt.id !== attemptId),
    visits: data.visits.map((visit) => ({
      ...visit,
      attemptIds: visit.attemptIds.filter((id) => id !== attemptId),
    })),
  }
}

function restoreAttempt(data: TrainingData, attemptId: string): TrainingData {
  const original = data.attempts.find((attempt) => attempt.id === attemptId)
  if (original) return data
  const visit = data.visits.find((candidate) => candidate.id === `visit-${attemptId}`)
  if (!visit) throw new Error('missing legacy visit')
  const attempt = createTrainingAttempt({
    id: attemptId,
    setup: setup('oll', 'execution'),
    visitId: visit.id,
    rawMs: 1_500,
    createdAt: visit.startedAt + 1_000,
  })
  return {
    ...data,
    attempts: [...data.attempts, attempt],
    visits: data.visits.map((candidate) =>
      candidate.id === visit.id
        ? { ...candidate, attemptIds: [...candidate.attemptIds, attemptId] }
        : candidate,
    ),
  }
}

async function closeDrive(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Google Drive backup' })
  if (await dialog.isVisible()) await page.getByTestId('drive-done').click()
}

test('two isolated devices merge Training, review a conflict, delete/Undo and keep solve sync separate', async ({
  browser,
}: {
  browser: Browser
}) => {
  test.setTimeout(240_000)
  const contextA = await browser.newContext({ storageState: STORAGE_STATE })
  const contextB = await browser.newContext({ storageState: STORAGE_STATE })
  const pageA = await contextA.newPage()
  const pageB = await contextB.newPage()

  const initial = addLegacyAttempt(
    closedTrainingHistory(),
    'legacy-attempt',
    NOW + 10_000,
  )
  await pageA.addInitScript(
    ({ key, raw }) => {
      if (!sessionStorage.getItem('drive-sync-a-seeded')) {
        localStorage.setItem(key, raw)
        sessionStorage.setItem('drive-sync-a-seeded', 'true')
      }
    },
    { key: TRAINING_STORAGE_KEY, raw: JSON.stringify(initial) },
  )
  await pageA.goto('/')
  await waitForApp(pageA)

  let dialogA = await openDrive(pageA)
  await connectDrive(dialogA)
  await enableTrainingSync(dialogA)
  await syncTrainingNow(pageA, dialogA)
  await expect(dialogA.getByTestId('training-sync-status')).toContainText('synced')
  const filesA = await trainingRemoteFiles(pageA)
  expect(filesA.length).toBeGreaterThan(0)

  // Solve synchronization is independent and must not list Training files.
  await dialogA.getByTestId('sync-now').click()
  await expect(dialogA.getByTestId('sync-status')).toContainText('synced', {
    timeout: 20_000,
  })
  const remoteAfterSolve = await pageA.evaluate(() => {
    const transport = (
      window as {
        __cubeLabMockDrive?: { __peekRemote?: () => Array<{ name: string }> }
      }
    ).__cubeLabMockDrive
    return (transport?.__peekRemote?.() ?? []).map((file) => file.name)
  })
  expect(remoteAfterSolve.some((name) => name.startsWith('cubelab-backup'))).toBe(
    true,
  )
  expect(
    remoteAfterSolve.some((name) => name.startsWith('cubelab-training-')),
  ).toBe(true)
  expect(
    (await dialogA.getByTestId('remote-snapshot').allTextContents()).join(' '),
  ).not.toContain('cubelab-training')
  await closeDrive(pageA)

  await pageB.goto('/')
  await waitForApp(pageB)
  await injectTrainingFiles(pageB, filesA)
  let dialogB = await openDrive(pageB)
  await connectDrive(dialogB)
  await enableTrainingSync(dialogB)
  await syncTrainingNow(pageB, dialogB)
  await expect(dialogB.getByTestId('training-sync-status')).toContainText('synced')
  expect((await readTraining(pageB))?.attempts).toHaveLength(2)
  await closeDrive(pageB)

  await pageB.getByTestId('training-nav').click()
  const hubB = pageB.getByRole('main', { name: 'Training Hub' })
  await expect(hubB.getByRole('button', { name: 'Review Backup fixture' })).toBeVisible()

  // Device B adds a legacy attempt. Direct storage is used only for this
  // synthetic fixture; the synchronization path below is the real hook.
  const adoptedB = (await readTraining(pageB))!
  const withB = addLegacyAttempt(adoptedB, 'device-b-attempt', NOW + 30_000)
  await writeTraining(pageB, withB)
  await pageB.reload()
  await waitForApp(pageB)
  await injectTrainingFiles(pageB, filesA)
  dialogB = await openDrive(pageB)
  await connectDrive(dialogB)
  await syncTrainingNow(pageB, dialogB)
  await expect(dialogB.getByTestId('training-sync-status')).toContainText('synced')
  const filesB = await trainingRemoteFiles(pageB)
  const newestB = filesB[0]!
  const parsedB = JSON.parse(newestB.content) as { training: { data: TrainingData } }
  expect(parsedB.training.data.attempts).toHaveLength(3)
  await closeDrive(pageB)

  // Device A adopts B's addition.
  await pageA.reload()
  await waitForApp(pageA)
  await injectTrainingFiles(pageA, filesB)
  dialogA = await openDrive(pageA)
  await connectDrive(dialogA)
  await syncTrainingNow(pageA, dialogA)
  await expect(dialogA.getByTestId('training-sync-status')).toContainText('synced')
  expect((await readTraining(pageA))?.attempts).toHaveLength(3)
  await closeDrive(pageA)

  // Delete and Undo the legacy attempt on B, then let A adopt both states.
  const deletedB = removeAttempt((await readTraining(pageB))!, 'legacy-attempt')
  await writeTraining(pageB, deletedB)
  await setAttemptTombstone(pageB, 'legacy-attempt', {
    active: true,
    at: NOW + 40_000,
  })
  await pageB.reload()
  await waitForApp(pageB)
  await injectTrainingFiles(pageB, filesB)
  dialogB = await openDrive(pageB)
  await connectDrive(dialogB)
  await syncTrainingNow(pageB, dialogB)
  const afterDeleteFiles = await trainingRemoteFiles(pageB)
  const afterDelete = JSON.parse(afterDeleteFiles[0]!.content) as {
    training: { data: TrainingData }
    sync: { tombstones: Array<{ id: string; restoredAt?: number }> }
  }
  expect(
    afterDelete.training.data.attempts.some(
      (attempt) => attempt.id === 'legacy-attempt',
    ),
  ).toBe(false)
  expect(
    afterDelete.sync.tombstones.some(
      (tombstone) =>
        tombstone.id === 'legacy-attempt' && tombstone.restoredAt === undefined,
    ),
  ).toBe(true)
  await closeDrive(pageB)

  const restoredB = restoreAttempt(deletedB, 'legacy-attempt')
  await writeTraining(pageB, restoredB)
  await setAttemptTombstone(pageB, 'legacy-attempt', {
    active: false,
    at: NOW + 41_000,
  })
  await pageB.reload()
  await waitForApp(pageB)
  await injectTrainingFiles(pageB, afterDeleteFiles)
  dialogB = await openDrive(pageB)
  await connectDrive(dialogB)
  await syncTrainingNow(pageB, dialogB)
  const afterUndoFiles = await trainingRemoteFiles(pageB)
  const afterUndo = JSON.parse(afterUndoFiles[0]!.content) as {
    training: { data: TrainingData }
    sync: { tombstones: Array<{ id: string; restoredAt?: number }> }
  }
  expect(
    afterUndo.training.data.attempts.some(
      (attempt) => attempt.id === 'legacy-attempt',
    ),
  ).toBe(true)
  expect(
    afterUndo.sync.tombstones.find(
      (tombstone) => tombstone.id === 'legacy-attempt',
    )?.restoredAt,
  ).toBeGreaterThan(0)
  await closeDrive(pageB)

  // Same-timestamp preference edits require exact manual approval on B.
  await setPreference(pageA, 'oll', 5_000, 'device-a')
  await setPreference(pageB, 'pll', 5_000, 'device-b')
  await pageA.reload()
  await waitForApp(pageA)
  await injectTrainingFiles(pageA, afterUndoFiles)
  dialogA = await openDrive(pageA)
  await connectDrive(dialogA)
  await syncTrainingNow(pageA, dialogA)
  const filesA2 = await trainingRemoteFiles(pageA)
  await closeDrive(pageA)

  await pageB.reload()
  await waitForApp(pageB)
  await injectTrainingFiles(pageB, filesA2)
  dialogB = await openDrive(pageB)
  await connectDrive(dialogB)
  await syncTrainingNow(pageB, dialogB)
  await expect(dialogB.getByTestId('training-sync-conflict')).toHaveCount(1)
  await expect(dialogB.getByTestId('training-sync-status')).toContainText(
    'conflict',
  )
  await dialogB.getByRole('button', { name: 'Use cloud' }).click()
  await dialogB.getByTestId('training-sync-now').click()
  await expect(dialogB.getByTestId('training-sync-status')).toContainText('synced')
  expect((await readTraining(pageB))?.preferences.selectedSetId).toBe('oll')

  // Native Training restore is blocked while Training sync is enabled.
  const native = createBackup(
    {
      activeSessionId: 'native-session',
      sessions: [
        {
          id: 'native-session',
          name: 'Native session',
          createdAt: NOW,
          updatedAt: NOW,
          solves: [],
        },
      ],
    },
    DEFAULT_SETTINGS,
    new Date(NOW),
    undefined,
    closedTrainingHistory(),
  )
  await closeDrive(pageB)
  await pageB.getByTestId('settings-button').click()
  const settings = pageB.getByRole('dialog', { name: 'Settings' })
  await settings.getByTestId('settings-backup-button').click()
  const dataDialog = pageB.getByRole('dialog', { name: 'Your local data' })
  await dataDialog.getByTestId('backup-file-input').setInputFiles({
    name: 'native-training-backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(native)),
  })
  await expect(dataDialog.getByTestId('backup-error')).toContainText(
    /Training history cannot be replaced yet: Training Drive sync is enabled/,
  )
  await expect(
    pageB.getByRole('dialog', { name: 'Replace local sessions and Training?' }),
  ).toHaveCount(0)
  await pageB.keyboard.press('Escape')

  // Disabling Training sync stops the automatic path.
  dialogB = await openDrive(pageB)
  await connectDrive(dialogB)
  const beforeDisable = (await trainingRemoteFiles(pageB)).length
  await dialogB.getByTestId('training-sync-enabled').uncheck()
  await expect(dialogB.getByTestId('training-sync-now')).toHaveCount(0)
  const local = (await readTraining(pageB))!
  await writeTraining(
    pageB,
    addLegacyAttempt(local, 'disabled-attempt', NOW + 60_000),
  )
  await pageB.waitForTimeout(6_000)
  expect((await trainingRemoteFiles(pageB)).length).toBe(beforeDisable)

  await contextA.close()
  await contextB.close()
})

test('a large synthetic Training history stays within the 16 MB Training cap and leaves solve files alone', async ({
  browser,
}: {
  browser: Browser
}) => {
  test.setTimeout(180_000)
  const context = await browser.newContext({ storageState: STORAGE_STATE })
  const page = await context.newPage()
  const base = createEmptyTrainingData()
  const template = createTrainingAttempt({
    id: 'large-0',
    visitId: 'large-visit',
    setup: setup('oll', 'execution'),
    rawMs: 1_234,
    createdAt: NOW,
  })
  const attempts = Array.from({ length: 4_000 }, (_, index) => ({
    ...template,
    id: `large-${index}`,
    createdAt: NOW + index,
  }))
  const large: TrainingData = {
    ...base,
    attempts,
    visits: [
      {
        version: 1,
        id: 'large-visit',
        startedAt: NOW,
        endedAt: NOW + attempts.length + 10,
        startedCategoryId: 'oll:execution',
        categoryIds: ['oll:execution'],
        attemptIds: attempts.map((attempt) => attempt.id),
        summaryId: null,
      },
    ],
  }
  await page.addInitScript(
    ({ key, raw }) => {
      if (!sessionStorage.getItem('drive-sync-large-seeded')) {
        localStorage.setItem(key, raw)
        sessionStorage.setItem('drive-sync-large-seeded', 'true')
      }
    },
    { key: TRAINING_STORAGE_KEY, raw: JSON.stringify(large) },
  )
  await page.goto('/')
  await waitForApp(page)
  const dialog = await openDrive(page)
  await connectDrive(dialog)
  await enableTrainingSync(dialog)
  const started = Date.now()
  await syncTrainingNow(page, dialog)
  const elapsed = Date.now() - started
  const files = await trainingRemoteFiles(page)
  expect(files.length).toBeGreaterThan(0)
  const newest = files[0]!
  expect(Buffer.byteLength(newest.content, 'utf8')).toBeLessThan(
    16 * 1024 * 1024,
  )
  const parsed = JSON.parse(newest.content) as {
    training: { data: TrainingData }
  }
  expect(parsed.training.data.attempts).toHaveLength(4_000)
  const solveNames = await page.evaluate(() => {
    const transport = (
      window as {
        __cubeLabMockDrive?: {
          listBackups?: () => Promise<Array<{ name: string }>>
        }
      }
    ).__cubeLabMockDrive
    return transport ? transport.listBackups?.() ?? [] : []
  })
  expect(
    (await solveNames).some((file) => file.name.startsWith('cubelab-training-')),
  ).toBe(false)
  test.info().annotations.push({
    type: 'measurement',
    description: `4,000-attempt Training sync ${elapsed} ms, ${Buffer.byteLength(
      newest.content,
      'utf8',
    )} bytes`,
  })
  await context.close()
})
