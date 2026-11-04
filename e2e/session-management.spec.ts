import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { chooseTestOption, selectSession, sessionNames } from './interactions'

const NOW = Date.now()

interface SeedSolve {
  id: string
  event: string
  rawMs: number
  penalty: 'none' | '+2' | 'dnf'
  scramble: string
  comment: string
  createdAt: number
  importSource?: {
    provider: 'cstimer'
    scrType: string
    sessionNumber: number
    solveIndex: number
  }
}

interface SeedSession {
  id: string
  name: string
  event: string
  createdAt: number
  updatedAt: number
  solves: SeedSolve[]
}

interface SeedData {
  version: number
  activeSessionId: string
  sessions: SeedSession[]
  sessionOrder?: { ids: string[]; updatedAt: number; editorId: string }
  customEvents?: Array<{
    id: string
    name: string
    placeholder: string
    createdAt: number
    updatedAt: number
  }>
}

function solve(
  id: string,
  rawMs: number,
  penalty: SeedSolve['penalty'] = 'none',
  offset = 0,
): SeedSolve {
  return {
    id,
    event: '333',
    rawMs,
    penalty,
    scramble: `R U R' U' F2 L D B2 ${id}`,
    comment: id === 's1' ? 'Preserve this comment' : '',
    createdAt: NOW + offset,
    ...(id === 's1'
      ? {
          importSource: {
            provider: 'cstimer' as const,
            scrType: '333',
            sessionNumber: 1,
            solveIndex: 1,
          },
        }
      : {}),
  }
}

function seedData(overrides: Partial<SeedData> = {}): SeedData {
  return {
    version: 5,
    activeSessionId: 'a',
    sessions: [
      {
        id: 'a',
        name: 'Morning',
        event: '333',
        createdAt: NOW - 90_000,
        updatedAt: NOW,
        solves: [
          solve('s1', 10_000, 'none', -1_000),
          solve('s2', 12_000, '+2', -2_000),
          solve('s3', 14_000, 'dnf', -3_000),
        ],
      },
      {
        id: 'b',
        name: 'Evening',
        event: '333',
        createdAt: NOW - 80_000,
        updatedAt: NOW,
        solves: [solve('b1', 5_000, '+2', -4_000)],
      },
      {
        id: 'c',
        name: 'Empty',
        event: '333',
        createdAt: NOW - 70_000,
        updatedAt: NOW,
        solves: [],
      },
    ],
    sessionOrder: {
      ids: ['a', 'b', 'c'],
      updatedAt: NOW - 60_000,
      editorId: 'seed',
    },
    customEvents: [
      {
        id: 'custom:fto',
        name: 'FTO',
        placeholder: '',
        createdAt: NOW - 60_000,
        updatedAt: NOW - 60_000,
      },
    ],
    ...overrides,
  }
}

async function seed(page: Page, data: SeedData = seedData()) {
  await page.addInitScript((payload) => {
    if (sessionStorage.getItem('cubelab-session-seeded')) return
    sessionStorage.setItem('cubelab-session-seeded', '1')
    localStorage.setItem('cubelab:sessions:v1', JSON.stringify(payload))
    localStorage.removeItem('cubelab:settings:v1')
    localStorage.removeItem('cubelab:sync:v1')
  }, data)
}

async function waitForApp(page: Page) {
  await expect(page.locator('.scramble-text')).toBeVisible({ timeout: 30_000 })
}

async function stored(page: Page): Promise<SeedData | null> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('cubelab:sessions:v1')
    return raw ? (JSON.parse(raw) as SeedData) : null
  })
}

async function openSettings(page: Page) {
  await page.getByTestId('settings-button').click()
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await expect(dialog).toBeVisible()
  return dialog
}

async function openDeveloper(page: Page) {
  const settings = await openSettings(page)
  await settings.getByText('Developer options').click()
  await expect(settings.getByTestId('settings-developer')).toHaveAttribute(
    'open',
    '',
  )
  return settings
}

async function requestDeleteAll(page: Page) {
  const settings = await openDeveloper(page)
  await settings.getByTestId('settings-delete-all-sessions').click()
  await expect(settings).toBeHidden()
  const dialog = page.getByRole('dialog', {
    name: 'Delete all sessions and solves?',
  })
  await expect(dialog).toBeVisible()
  return dialog
}

test.describe('session management', () => {
  test('corrects a solved session event with explicit confirmation and preserves every solve field', async ({
    page,
  }) => {
    await seed(page)
    await page.goto('/')
    await waitForApp(page)

    await page.getByTestId('session-settings').click()
    const dialog = page.getByRole('dialog', { name: 'Session settings' })
    await expect(dialog).toBeVisible()
    await expect(dialog).not.toContainText(
      'Event is locked because this session has solves',
    )
    await expect(dialog).not.toContainText(
      'Create a new session for another event',
    )

    const eventSelect = page.getByTestId('session-event-select')
    await chooseTestOption(page, 'session-event-select', '222')
    await expect(dialog).toContainText('Change Morning from 3×3 to 2×2?')
    await expect(dialog).toContainText('reassigns 3 solves')
    await dialog.getByTestId('cancel-session-event').click()
    await expect(eventSelect).toContainText('3×3')

    await chooseTestOption(page, 'session-event-select', '222')
    await dialog.getByTestId('confirm-session-event').click()
    await expect(eventSelect).toContainText('2×2')
    await dialog.getByTestId('session-settings-done').click()
    await expect(dialog).toBeHidden()

    const corrected = await stored(page)
    const morning = corrected?.sessions.find((session) => session.id === 'a')
    expect(morning?.event).toBe('222')
    expect(morning?.solves.map((entry) => entry.event)).toEqual([
      '222',
      '222',
      '222',
    ])
    expect(morning?.solves[0]).toMatchObject({
      id: 's1',
      rawMs: 10_000,
      penalty: 'none',
      scramble: `R U R' U' F2 L D B2 s1`,
      comment: 'Preserve this comment',
      createdAt: NOW - 1_000,
      importSource: {
        provider: 'cstimer',
        scrType: '333',
        sessionNumber: 1,
        solveIndex: 1,
      },
    })
    expect(morning?.solves[1]).toMatchObject({
      id: 's2',
      rawMs: 12_000,
      penalty: '+2',
    })
    expect(morning?.solves[2]?.penalty).toBe('dnf')

    await page.reload()
    await waitForApp(page)
    await expect(page.locator('.header-context .context-meta')).toContainText(
      '2×2',
    )
    expect(
      (await stored(page))?.sessions.find((session) => session.id === 'a')
        ?.event,
    ).toBe('222')

    const settings = await openSettings(page)
    await settings.getByTestId('settings-backup-button').click()
    const dataDialog = page.getByRole('dialog', { name: 'Your local data' })
    const downloadPromise = page.waitForEvent('download')
    await dataDialog.getByTestId('export-backup').click()
    const download = await downloadPromise
    const path = await download.path()
    expect(path).not.toBeNull()
    const backup = JSON.parse(readFileSync(path!, 'utf8')) as {
      sessions: SeedData
    }
    const backupMorning = backup.sessions.sessions.find(
      (session) => session.id === 'a',
    )
    expect(backupMorning?.event).toBe('222')
    expect(backupMorning?.solves.map((entry) => entry.event)).toEqual([
      '222',
      '222',
      '222',
    ])
  })

  test('reorders sessions with keyboard-accessible controls and persists the order', async ({
    page,
  }) => {
    await seed(page)
    await page.goto('/')
    await waitForApp(page)

    const trigger = page.getByTestId('session-select')
    await trigger.click()
    const panel = page.getByRole('group', { name: 'Session list' })
    await expect(panel).toBeVisible()
    const rows = panel.locator('.session-picker-row')
    await expect(rows).toHaveCount(3)
    await expect(rows.nth(0)).toContainText('Morning')
    await expect(rows.nth(1)).toContainText('Evening')

    const moveUp = page.getByTestId('session-move-up-b')
    await moveUp.focus()
    await expect(moveUp).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(rows.nth(0)).toContainText('Evening')
    await expect(rows.nth(1)).toContainText('Morning')
    await expect(
      page.getByTestId('session-move-up-b'),
    ).toHaveAttribute('aria-disabled', 'true')
    await expect(page.getByTestId('session-move-up-b')).toBeFocused()
    await expect(trigger).toContainText('Morning')
    await expect(
      page.locator('[data-testid^="session-option-"]').filter({ hasText: 'Morning' }),
    ).toHaveAttribute('aria-current', 'true')

    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()
    await expect(trigger).toBeFocused()
    expect(await sessionNames(page)).toEqual(['Evening', 'Morning', 'Empty'])

    await page.reload()
    await waitForApp(page)
    await expect(page.getByTestId('session-select')).toContainText('Morning')
    expect(await sessionNames(page)).toEqual(['Evening', 'Morning', 'Empty'])
    const persisted = await stored(page)
    expect(persisted?.sessionOrder?.ids).toEqual(['b', 'a', 'c'])
    expect(
      persisted?.sessions.find((session) => session.id === 'a')?.solves,
    ).toHaveLength(3)
  })

  test('keeps the integrated session menu inside a narrow viewport', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await seed(page)
    await page.goto('/')
    await waitForApp(page)

    const trigger = page.getByTestId('session-select')
    await trigger.scrollIntoViewIfNeeded()
    await trigger.click()
    const panel = page.getByRole('group', { name: 'Session list' })
    await expect(panel).toBeVisible()
    const box = await panel.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.y).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(391)
    expect(box!.y + box!.height).toBeLessThanOrEqual(845)
    await expect(page.getByTestId('session-option-a')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()
    await expect(trigger).toBeFocused()
  })

  test('deletes all sessions only after typed confirmation and records durable tombstones', async ({
    page,
  }) => {
    await seed(page)
    await page.goto('/')
    await waitForApp(page)

    const settings = await openSettings(page)
    await chooseTestOption(page, 'theme-setting', 'dark')
    await settings.getByTestId('session-solve-progress-setting').check()
    await settings.getByTestId('settings-done').click()

    let dialog = await requestDeleteAll(page)
    await dialog.getByTestId('confirm-text').fill('DELETE')
    await expect(
      dialog.getByRole('button', { name: 'Delete all sessions' }),
    ).toBeDisabled()
    await dialog.getByRole('button', { name: 'Cancel deletion' }).click()
    await expect(dialog).toBeHidden()
    expect((await stored(page))?.sessions).toHaveLength(3)

    dialog = await requestDeleteAll(page)
    await dialog.getByTestId('confirm-text').fill('DELETE ALL SESSIONS')
    await dialog.getByRole('button', { name: 'Delete all sessions' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.locator('.toast')).toContainText('All sessions deleted')

    const wiped = await stored(page)
    expect(wiped?.sessions).toHaveLength(1)
    expect(wiped?.sessions[0]?.name).toBe('Session 1')
    expect(wiped?.sessions[0]?.solves).toEqual([])
    expect(wiped?.activeSessionId).toBe(wiped?.sessions[0]?.id)
    expect(wiped?.customEvents?.map((entry) => entry.id)).toEqual(['custom:fto'])
    expect(await sessionNames(page)).toHaveLength(1)
    await expect(page.getByTestId('solve-count')).toHaveText('0')
    await expect(page.getByTestId('session-solve-progress')).toContainText(
      '0 / 0',
    )

    const settingsData = await page.evaluate(() => {
      const raw = localStorage.getItem('cubelab:settings:v1')
      return raw ? JSON.parse(raw) : null
    })
    expect(settingsData?.settings.theme).toBe('dark')
    expect(settingsData?.settings.showSessionSolveProgress).toBe(true)

    const tombstones = await page.evaluate(() => {
      const raw = localStorage.getItem('cubelab:sync:v1')
      return raw
        ? (JSON.parse(raw) as { runtime: { tombstones: unknown[] } }).runtime
            .tombstones
        : []
    })
    expect(tombstones).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'session', id: 'a' }),
        expect.objectContaining({ kind: 'session', id: 'b' }),
        expect.objectContaining({ kind: 'session', id: 'c' }),
        expect.objectContaining({ kind: 'solve', id: 's1' }),
        expect.objectContaining({ kind: 'solve', id: 'b1' }),
      ]),
    )
    expect(tombstones).toHaveLength(7)
  })

  test('keeps every session when the final storage write fails', async ({
    page,
  }) => {
    await seed(page)
    await page.goto('/')
    await waitForApp(page)

    await page.evaluate(() => {
      const original = Storage.prototype.setItem
      const target = window as typeof window & {
        __restoreSessionStorage?: () => void
        __failSessionStorage?: boolean
      }
      target.__failSessionStorage = true
      target.__restoreSessionStorage = () => {
        Storage.prototype.setItem = original
        target.__failSessionStorage = false
      }
      Storage.prototype.setItem = function setItem(key, value) {
        if (target.__failSessionStorage && key === 'cubelab:sessions:v1') {
          throw new DOMException('Quota exceeded', 'QuotaExceededError')
        }
        return original.call(this, key, value)
      }
    })

    const dialog = await requestDeleteAll(page)
    await dialog.getByTestId('confirm-text').fill('DELETE ALL SESSIONS')
    await dialog.getByRole('button', { name: 'Delete all sessions' }).click()
    await expect(dialog).toBeHidden()
    await expect(page.locator('.toast')).toContainText('could not be saved')
    expect((await stored(page))?.sessions).toHaveLength(3)

    await page.evaluate(() => {
      ;(
        window as typeof window & { __restoreSessionStorage?: () => void }
      ).__restoreSessionStorage?.()
    })
    expect(await sessionNames(page)).toHaveLength(3)
  })

  test('shows optional session summaries and recalculates after edits, deletion and switching', async ({
    page,
  }) => {
    const longSolves = Array.from({ length: 250 }, (_, index) =>
      solve(
        `summary-${index}`,
        570_000,
        index === 10 ? 'dnf' : index === 20 ? '+2' : 'none',
        -index * 60_000,
      ),
    )
    const summaryData = seedData({
      activeSessionId: 'a',
      sessions: [
        {
          id: 'a',
          name: 'Long session',
          event: '333',
          createdAt: NOW - 20_000_000,
          updatedAt: NOW,
          solves: longSolves,
        },
        {
          id: 'b',
          name: 'Evening',
          event: '333',
          createdAt: NOW - 10_000_000,
          updatedAt: NOW,
          solves: [solve('b1', 7_200_000, '+2', -1_000)],
        },
        {
          id: 'c',
          name: 'Empty',
          event: '333',
          createdAt: NOW - 9_000_000,
          updatedAt: NOW,
          solves: [],
        },
      ],
      sessionOrder: {
        ids: ['a', 'b', 'c'],
        updatedAt: NOW,
        editorId: 'seed',
      },
    })
    await seed(page, summaryData)
    await page.goto('/')
    await waitForApp(page)

    await expect(page.getByTestId('session-solve-progress')).toHaveCount(0)
    await expect(page.getByTestId('session-total-time')).toHaveCount(0)

    const settings = await openSettings(page)
    await settings.getByTestId('session-solve-progress-setting').check()
    await settings.getByTestId('settings-done').click()

    const summaryBar = page.locator(
      '.session-caption [data-testid="session-footer-summary"]',
    )
    await expect(summaryBar).toBeVisible()
    await expect(page.getByTestId('session-solve-progress')).toContainText(
      '249 / 250',
    )
    await expect(page.getByTestId('session-total-time')).toHaveCount(0)
    await expect(page.getByTestId('session-solve-progress')).not.toContainText(
      'solves',
    )
    await expect(
      page.locator('.history-heading [data-testid="session-solve-progress"]'),
    ).toHaveCount(0)
    await expect(
      page.locator('.history-heading [data-testid="session-total-time"]'),
    ).toHaveCount(0)
    await expect(page.getByTestId('history-window-toggle')).toBeVisible()
    await expect(page.getByTestId('history-window-toggle')).toHaveText(
      'Show all solves',
    )

    const settingsWithTime = await openSettings(page)
    await settingsWithTime
      .getByTestId('session-total-time-setting')
      .check()
    await settingsWithTime.getByTestId('settings-done').click()
    await expect(page.getByTestId('session-total-time')).toContainText('39.43 h')
    await expect(page.getByTestId('session-total-time')).toHaveAttribute(
      'aria-label',
      /Total completed solve time.*39\.43 hours/,
    )
    await expect(page.getByTestId('session-solve-progress')).toHaveAttribute(
      'aria-label',
      /249 of 250 solves completed/,
    )
    await expect(page.getByTestId('session-total-time')).not.toContainText(
      'solves',
    )

    const firstRow = page.locator('[data-testid="history-row"]').first()
    await firstRow.getByTestId('solve-dnf').click()
    await expect(page.getByTestId('session-solve-progress')).toContainText(
      '248 / 250',
    )
    await expect(page.getByTestId('session-total-time')).toContainText('39.27 h')

    await firstRow.locator('[data-testid="history-main"]').click()
    await page
      .getByRole('menu')
      .getByRole('menuitem', { name: 'Delete solve' })
      .click()
    await expect(page.getByTestId('session-solve-progress')).toContainText(
      '248 / 249',
    )
    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(page.getByTestId('session-solve-progress')).toContainText(
      '248 / 250',
    )

    await selectSession(page, 'b')
    await expect(page.getByTestId('session-solve-progress')).toContainText(
      '1 / 1',
    )
    await expect(page.getByTestId('session-total-time')).toContainText('2.00 h')
    await selectSession(page, 'c')
    await expect(page.getByTestId('session-solve-progress')).toContainText(
      '0 / 0',
    )
    await expect(page.getByTestId('session-total-time')).toContainText('0.00 h')

    const independentSettings = await openSettings(page)
    await independentSettings
      .getByTestId('session-solve-progress-setting')
      .uncheck()
    await independentSettings.getByTestId('settings-done').click()
    await expect(page.getByTestId('session-solve-progress')).toHaveCount(0)
    await expect(page.getByTestId('session-total-time')).toContainText('0.00 h')

    await page.reload()
    await waitForApp(page)
    await expect(page.getByTestId('session-solve-progress')).toHaveCount(0)
    await expect(page.getByTestId('session-total-time')).toContainText('0.00 h')
    await openSettings(page)
    await expect(
      page.getByTestId('session-solve-progress-setting'),
    ).not.toBeChecked()
    await expect(page.getByTestId('session-total-time-setting')).toBeChecked()
  })

  test('keeps destructive and reorder controls locked while timing', async ({
    page,
  }) => {
    await seed(page)
    await page.goto('/')
    await waitForApp(page)

    await page.keyboard.down('Space')
    await expect(page.locator('[data-testid="timer-surface"]')).toHaveAttribute(
      'data-phase',
      'ready',
      { timeout: 3_000 },
    )
    await page.keyboard.up('Space')
    await expect(page.locator('[data-testid="timer-surface"]')).toHaveAttribute(
      'data-phase',
      'running',
    )
    await expect(page.getByTestId('session-settings')).toBeDisabled()
    await expect(page.getByTestId('session-select')).toBeDisabled()
    await expect(page.getByTestId('settings-button')).toBeDisabled()
    await page.keyboard.press('Space')
    await expect(page.locator('[data-testid="timer-surface"]')).toHaveAttribute(
      'data-phase',
      'idle',
    )
  })

  test('keeps dropdown interaction out of the timer input boundary', async ({
    page,
  }) => {
    await seed(page)
    await page.goto('/')
    await waitForApp(page)

    const select = page.getByTestId('session-select')
    const timer = page.locator('[data-testid="timer-surface"]')
    await select.focus()
    await expect(select).toBeFocused()
    await page.keyboard.press('Space')
    await expect(select).toHaveAttribute('aria-expanded', 'true')
    await expect(timer).toHaveAttribute('data-phase', 'idle')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Escape')
    await expect(select).toHaveAttribute('aria-expanded', 'false')
    await expect(timer).toHaveAttribute('data-phase', 'idle')
    await expect(select).toBeFocused()

    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur()
      }
    })
    await page.keyboard.down('Space')
    await expect(timer).toHaveAttribute('data-phase', 'ready', {
      timeout: 3_000,
    })
    await page.keyboard.up('Space')
    await expect(timer).toHaveAttribute('data-phase', 'running')
    await page.keyboard.press('Space')
    await expect(timer).toHaveAttribute('data-phase', 'idle')
  })
})

test.describe('delete-all synchronization', () => {
  test('does not resurrect deleted sessions or solves from an older cloud snapshot', async ({
    page,
  }) => {
    test.setTimeout(90_000)
    await seed(page)
    await page.goto('/')
    await waitForApp(page)

    const settings = await openSettings(page)
    await settings.getByTestId('settings-drive-button').click()
    let drive = page.getByRole('dialog', { name: 'Google Drive backup' })
    await drive.getByTestId('drive-connect').click()
    await expect(drive.getByTestId('drive-status')).toContainText('Connected')
    await drive.getByTestId('sync-now').click()
    await expect(drive.getByTestId('sync-status')).toContainText('synced', {
      timeout: 15_000,
    })
    await drive.getByTestId('drive-done').click()

    const dialog = await requestDeleteAll(page)
    await dialog.getByTestId('confirm-text').fill('DELETE ALL SESSIONS')
    await dialog.getByRole('button', { name: 'Delete all sessions' }).click()
    await expect(dialog).toBeHidden()
    expect(await sessionNames(page)).toHaveLength(1)

    // Publish an old snapshot without deletion metadata. The local durable
    // tombstones must still remove it rather than restoring the sessions.
    await page.evaluate(() => {
      const storedData = JSON.parse(
        localStorage.getItem('cubelab:sessions:v1')!,
      )
      const active = storedData.sessions[0]
      const oldSessions = {
        activeSessionId: 'a',
        sessions: [
          {
            id: 'a',
            name: 'Morning',
            event: '333',
            createdAt: active.createdAt,
            updatedAt: active.updatedAt,
            solves: [
              {
                id: 's1',
                event: '333',
                rawMs: 10000,
                penalty: 'none',
                scramble: 'R U',
                comment: '',
                createdAt: active.createdAt,
              },
            ],
          },
        ],
      }
      const cloud = {
        app: 'CubeLab',
        format: 'cubelab-backup',
        version: 1,
        exportedAt: new Date().toISOString(),
        sessions: oldSessions,
        settings: JSON.parse(localStorage.getItem('cubelab:settings:v1')!)
          .settings,
        sync: {
          protocolVersion: 1,
          revision: 999,
          deviceId: 'offline-device',
          updatedAt: Date.now() + 60_000,
          tombstones: [],
          conflicts: [],
          sessionRedirects: [],
        },
      }
      const mock = (
        window as typeof window & {
          __cubeLabMockDrive?: {
            uploadBackup: (content: string, id: string | null) => Promise<unknown>
          }
        }
      ).__cubeLabMockDrive
      if (!mock) throw new Error('Mock Drive is unavailable')
      return mock.uploadBackup(JSON.stringify(cloud), null)
    })

    const settingsAgain = await openSettings(page)
    await settingsAgain.getByTestId('settings-drive-button').click()
    drive = page.getByRole('dialog', { name: 'Google Drive backup' })
    await drive.getByTestId('sync-now').click()
    await expect(drive.getByTestId('sync-status')).toContainText('synced', {
      timeout: 15_000,
    })
    await drive.getByTestId('drive-done').click()

    const afterMerge = await stored(page)
    expect(afterMerge?.sessions).toHaveLength(1)
    expect(afterMerge?.sessions[0]?.name).toBe('Session 1')
    expect(afterMerge?.sessions[0]?.solves).toEqual([])
    await expect(page.getByTestId('solve-count')).toHaveText('0')
  })
})
