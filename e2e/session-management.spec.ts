import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { chooseTestOption, selectSession, sessionNames } from './interactions'

import { simulateLegacyConcurrentTabs } from './legacy-tabs'

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
  inspectionEnabled?: boolean
  preferences?: Record<string, unknown>
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
  sessionTransfers?: Array<{
    id: string
    fromSessionId: string
    toSessionId: string
    solveIds: string[]
    transferredAt: number
    byDeviceId: string
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

function manySessions(count: number): SeedSession[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `long-${index}`,
    name: `Session ${index + 1}`,
    event: '333',
    createdAt: NOW - (count - index) * 1_000,
    updatedAt: NOW,
    solves: [],
  }))
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

async function failStorageKeys(page: Page, keys: string[]) {
  await page.evaluate((failingKeys) => {
    const original = Storage.prototype.setItem
    const target = window as typeof window & {
      __cubelabFailKeys?: string[]
      __cubelabRestoreStorage?: () => void
    }
    target.__cubelabFailKeys = failingKeys
    target.__cubelabRestoreStorage = () => {
      Storage.prototype.setItem = original
      delete target.__cubelabFailKeys
    }
    Storage.prototype.setItem = function setItem(key, value) {
      if (target.__cubelabFailKeys?.includes(key)) {
        throw new DOMException('Quota exceeded', 'QuotaExceededError')
      }
      return original.call(this, key, value)
    }
  }, keys)
}

async function restoreStorage(page: Page) {
  await page.evaluate(() => {
    ;(
      window as typeof window & { __cubelabRestoreStorage?: () => void }
    ).__cubelabRestoreStorage?.()
  })
}

async function openSettings(page: Page) {
  await page.getByTestId('settings-button').click()
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await expect(dialog).toBeVisible()
  return dialog
}

async function openBackup(page: Page) {
  const settings = await openSettings(page)
  await settings.getByTestId('settings-backup-button').click()
  const dialog = page.getByRole('dialog', { name: 'Your local data' })
  await expect(dialog).toBeVisible()
  return dialog
}

async function currentNativeBackup(page: Page) {
  return page.evaluate(() => {
    const sessions = JSON.parse(
      localStorage.getItem('cubelab:sessions:v1')!,
    ) as Record<string, unknown>
    const settingsRaw = localStorage.getItem('cubelab:settings:v1')
    if (!settingsRaw) throw new Error('Settings were not initialized')
    const settings = (
      JSON.parse(settingsRaw) as { settings: Record<string, unknown> }
    ).settings
    return {
      app: 'CubeLab',
      format: 'cubelab-backup',
      version: 1,
      exportedAt: new Date().toISOString(),
      sessions,
      settings,
    }
  })
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

  test('reorders sessions by dragging a handle without changing the active session and persists after reload', async ({
    page,
  }) => {
    await seed(page)
    await page.goto('/')
    await waitForApp(page)

    const trigger = page.getByTestId('session-select')
    await trigger.click()
    const panel = page.getByRole('group', { name: 'Session list' })
    await expect(panel).toBeVisible()
    const handle = page.getByTestId('session-drag-handle-b')
    const target = page.getByTestId('session-option-a')
    const handleBox = await handle.boundingBox()
    const targetBox = await target.boundingBox()
    expect(handleBox).not.toBeNull()
    expect(targetBox).not.toBeNull()

    await page.mouse.move(
      handleBox!.x + handleBox!.width / 2,
      handleBox!.y + handleBox!.height / 2,
    )
    await page.mouse.down()
    await page.mouse.move(
      handleBox!.x + handleBox!.width / 2,
      targetBox!.y + 3,
      { steps: 6 },
    )
    await expect(page.getByTestId('session-drop-indicator')).toBeVisible()
    await expect(
      panel.locator('[data-session-id="b"]'),
    ).toHaveClass(/is-dragging/)
    await page.mouse.up()

    const rows = panel.locator('.session-picker-row')
    await expect(rows.nth(0)).toContainText('Evening')
    await expect(rows.nth(1)).toContainText('Morning')
    await expect(trigger).toContainText('Morning')
    await expect(page.getByTestId('session-option-a')).toHaveAttribute(
      'aria-current',
      'true',
    )
    await expect(panel.getByRole('status')).toContainText(
      'Evening moved to position 1 of 3.',
    )
    await expect(panel).toBeVisible()

    await page.keyboard.press('Escape')
    expect(await sessionNames(page)).toEqual(['Evening', 'Morning', 'Empty'])
    await page.reload()
    await waitForApp(page)
    expect(await sessionNames(page)).toEqual(['Evening', 'Morning', 'Empty'])
    const persisted = await stored(page)
    expect(persisted?.sessionOrder?.ids).toEqual(['b', 'a', 'c'])
    expect(
      persisted?.sessions.find((session) => session.id === 'a')?.solves,
    ).toHaveLength(3)
  })

  test('auto-scrolls a long session list while dragging', async ({ page }) => {
    const sessions = manySessions(24)
    await seed(
      page,
      seedData({
        activeSessionId: 'long-0',
        sessions,
        sessionOrder: {
          ids: sessions.map((session) => session.id),
          updatedAt: NOW,
          editorId: 'seed',
        },
      }),
    )
    await page.goto('/')
    await waitForApp(page)

    const trigger = page.getByTestId('session-select')
    await trigger.click()
    const panel = page.getByRole('group', { name: 'Session list' })
    await expect(panel).toBeVisible()
    await panel.evaluate((element) => {
      element.scrollTop = element.scrollHeight
    })

    const handle = page.getByTestId('session-drag-handle-long-23')
    await expect(handle).toBeVisible()
    const handleBox = await handle.boundingBox()
    const panelBox = await panel.boundingBox()
    expect(handleBox).not.toBeNull()
    expect(panelBox).not.toBeNull()

    await page.mouse.move(
      handleBox!.x + handleBox!.width / 2,
      handleBox!.y + handleBox!.height / 2,
    )
    await page.mouse.down()
    await page.mouse.move(
      handleBox!.x + handleBox!.width / 2,
      panelBox!.y + 8,
      { steps: 10 },
    )
    await expect
      .poll(() => panel.evaluate((element) => element.scrollTop), {
        // WebKit's headless animation frames run slower than a real display.
        timeout: 20_000,
      })
      .toBe(0)
    await page.mouse.move(handleBox!.x + handleBox!.width / 2, panelBox!.y + 6)
    await page.mouse.up()

    await expect(panel.locator('.session-picker-row').first()).toContainText(
      'Session 24',
    )
    await expect(trigger).toContainText('Session 1')
    await page.keyboard.press('Escape')
    expect((await sessionNames(page))[0]).toBe('Session 24')

    await page.reload()
    await waitForApp(page)
    expect((await sessionNames(page))[0]).toBe('Session 24')
    const persisted = await stored(page)
    expect(persisted?.sessionOrder?.ids[0]).toBe('long-23')
    expect(persisted?.activeSessionId).toBe('long-0')
  })

  test('reveals keyboard-reordered rows in a long session list', async ({
    page,
  }) => {
    const sessions = manySessions(24)
    await seed(
      page,
      seedData({
        activeSessionId: 'long-0',
        sessions,
        sessionOrder: {
          ids: sessions.map((session) => session.id),
          updatedAt: NOW,
          editorId: 'seed',
        },
      }),
    )
    await page.goto('/')
    await waitForApp(page)

    const trigger = page.getByTestId('session-select')
    await trigger.click()
    const panel = page.getByRole('group', { name: 'Session list' })
    await expect(page.getByTestId('session-option-long-0')).toBeFocused()
    const handle = page.getByTestId('session-drag-handle-long-0')
    await handle.focus()
    await expect(handle).toBeFocused()

    for (let index = 0; index < 16; index += 1) {
      await page.keyboard.press('ArrowDown')
    }
    await expect
      .poll(() => panel.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0)
    const panelBox = await panel.boundingBox()
    const handleBox = await handle.boundingBox()
    expect(panelBox).not.toBeNull()
    expect(handleBox).not.toBeNull()
    expect(handleBox!.y).toBeGreaterThanOrEqual(panelBox!.y - 1)
    expect(handleBox!.y + handleBox!.height).toBeLessThanOrEqual(
      panelBox!.y + panelBox!.height + 1,
    )
    await expect(trigger).toContainText('Session 1')
    await expect(page.getByTestId('session-option-long-0')).toHaveAttribute(
      'aria-current',
      'true',
    )

    for (let index = 0; index < 16; index += 1) {
      await page.keyboard.press('ArrowUp')
    }
    const finalHandleBox = await handle.boundingBox()
    expect(finalHandleBox).not.toBeNull()
    expect(finalHandleBox!.y).toBeGreaterThanOrEqual(panelBox!.y - 1)
    expect(finalHandleBox!.y + finalHandleBox!.height).toBeLessThanOrEqual(
      panelBox!.y + panelBox!.height + 1,
    )
    await expect(panel.locator('.session-picker-row').first()).toContainText(
      'Session 1',
    )
    await expect(trigger).toContainText('Session 1')
  })

  test('recalculates the drop position when the session list scrolls under a held pointer', async ({
    page,
  }) => {
    const sessions = manySessions(20)
    await seed(
      page,
      seedData({
        activeSessionId: 'long-0',
        sessions,
        sessionOrder: {
          ids: sessions.map((session) => session.id),
          updatedAt: NOW,
          editorId: 'seed',
        },
      }),
    )
    await page.goto('/')
    await waitForApp(page)

    const trigger = page.getByTestId('session-select')
    await trigger.click()
    const panel = page.getByRole('group', { name: 'Session list' })
    await expect(panel).toBeVisible()
    await panel.evaluate((element) => {
      element.scrollTop = 0
    })

    const handle = page.getByTestId('session-drag-handle-long-2')
    const handleBox = await handle.boundingBox()
    expect(handleBox).not.toBeNull()
    const x = handleBox!.x + handleBox!.width / 2
    const startY = handleBox!.y + handleBox!.height / 2

    await page.mouse.move(x, startY)
    await page.mouse.down()
    await page.mouse.move(x, startY + 8, { steps: 2 })
    await panel.evaluate((element) => {
      element.scrollTop = 200
    })
    await expect
      .poll(() => panel.evaluate((element) => element.scrollTop))
      .toBe(200)

    const pointerY = startY + 8
    const expectedOrder = await page.evaluate(
      ({ pointerY: currentY, draggedId }) => {
        const rows = Array.from(
          document.querySelectorAll<HTMLElement>('.session-picker-row'),
        )
        const dragged = rows.find(
          (row) => row.dataset.sessionId === draggedId,
        )
        const others = rows.filter((row) => row !== dragged)
        let insertion = others.length
        for (let index = 0; index < others.length; index += 1) {
          const rect = others[index]!.getBoundingClientRect()
          if (currentY < (rect.top + rect.bottom) / 2) {
            insertion = index
            break
          }
        }
        const ids = others.map((row) => row.dataset.sessionId!)
        ids.splice(insertion, 0, draggedId)
        return ids
      },
      { pointerY, draggedId: 'long-2' },
    )

    await page.mouse.up()
    const order = await panel
      .locator('.session-picker-row')
      .evaluateAll((rows) =>
        rows.map((row) => (row as HTMLElement).dataset.sessionId),
      )
    expect(order).toEqual(expectedOrder)
    expect(order.indexOf('long-2')).not.toBe(2)
    await expect(trigger).toContainText('Session 1')
    await expect(page.getByTestId('session-option-long-0')).toHaveAttribute(
      'aria-current',
      'true',
    )

    await page.keyboard.press('Escape')
    await page.reload()
    await waitForApp(page)
    const persisted = await stored(page)
    expect(persisted?.sessionOrder?.ids).toEqual(expectedOrder)
    expect(persisted?.activeSessionId).toBe('long-0')
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

  test('keeps a solve when its deletion record or collection cannot be saved', async ({
    page,
  }) => {
    await seed(page)
    await page.goto('/')
    await waitForApp(page)

    const deleteFirstSolve = async () => {
      const firstRow = page.locator('[data-testid="history-row"]').first()
      await firstRow.locator('[data-testid="history-main"]').click()
      await page
        .getByRole('menu')
        .getByRole('menuitem', { name: 'Delete solve' })
        .click()
    }

    await failStorageKeys(page, ['cubelab:sync:v1'])
    await deleteFirstSolve()
    await expect(page.locator('.toast')).toContainText(
      'Solve deletion blocked: deletion records could not be saved',
    )
    await expect(page.getByTestId('solve-count')).toHaveText('3')
    expect(
      (await stored(page))?.sessions
        .find((session) => session.id === 'a')
        ?.solves.map((entry) => entry.id),
    ).toEqual(expect.arrayContaining(['s1', 's2', 's3']))
    expect(
      await page.evaluate(() => {
        const raw = localStorage.getItem('cubelab:sync:v1')
        return raw
          ? (JSON.parse(raw) as {
              runtime: { tombstones: Array<{ kind: string; id: string }> }
            }).runtime.tombstones
          : []
      }),
    ).not.toContainEqual(
      expect.objectContaining({ kind: 'solve', id: 's1' }),
    )
    await restoreStorage(page)

    await failStorageKeys(page, ['cubelab:sessions:v1'])
    await deleteFirstSolve()
    await expect(page.locator('.toast')).toContainText(
      'Solve deletion could not be saved',
    )
    await expect(page.getByTestId('solve-count')).toHaveText('3')
    expect(
      (await stored(page))?.sessions
        .find((session) => session.id === 'a')
        ?.solves.map((entry) => entry.id),
    ).toEqual(expect.arrayContaining(['s1', 's2', 's3']))
    const revoked = await page.evaluate(() => {
      const raw = localStorage.getItem('cubelab:sync:v1')
      const tombstones = raw
        ? (JSON.parse(raw) as {
            runtime: {
              tombstones: Array<{
                kind: string
                id: string
                deletedAt: number
                restoredAt?: number
              }>
            }
          }).runtime.tombstones
        : []
      return tombstones.find(
        (tombstone) => tombstone.kind === 'solve' && tombstone.id === 's1',
      )
    })
    expect(revoked?.restoredAt).toBeGreaterThan(revoked?.deletedAt ?? 0)
    await restoreStorage(page)

    await failStorageKeys(page, ['cubelab:sync:v1', 'cubelab:sessions:v1'])
    await deleteFirstSolve()
    await expect(page.locator('.toast')).toContainText(
      'Solve deletion blocked: deletion records could not be saved',
    )
    await expect(page.getByTestId('solve-count')).toHaveText('3')
    await restoreStorage(page)

    await page.reload()
    await waitForApp(page)
    await expect(page.getByTestId('solve-count')).toHaveText('3')
  })

  test('blocks Clear Session when deletion intent cannot be saved', async ({
    page,
  }) => {
    await seed(page)
    await page.goto('/')
    await waitForApp(page)

    const requestClear = async () => {
      await page.getByTestId('session-settings').click()
      const sessionDialog = page.getByRole('dialog', {
        name: 'Session settings',
      })
      await sessionDialog.getByTestId('session-clear').click()
      const confirm = page.getByRole('dialog', { name: 'Delete every solve?' })
      await confirm.getByTestId('confirm-text').fill('CLEAR THIS SESSION')
      return { sessionDialog, confirm }
    }

    const { confirm } = await requestClear()
    await failStorageKeys(page, ['cubelab:sync:v1'])
    await confirm.getByRole('button', { name: 'Clear session' }).click()
    await expect(page.locator('.toast')).toContainText(
      'Session clear blocked: deletion records could not be saved',
    )
    await expect(page.getByTestId('solve-count')).toHaveText('3')
    expect(
      (await stored(page))?.sessions
        .find((session) => session.id === 'a')
        ?.solves.map((entry) => entry.id),
    ).toEqual(expect.arrayContaining(['s1', 's2', 's3']))
    expect(
      await page.evaluate(() => {
        const raw = localStorage.getItem('cubelab:sync:v1')
        return raw
          ? (JSON.parse(raw) as {
              runtime: {
                tombstones: Array<{
                  kind: string
                  id: string
                  restoredAt?: number
                  deletedAt: number
                }>
              }
            }).runtime.tombstones
          : []
      }),
    ).not.toContainEqual(
      expect.objectContaining({ kind: 'solve', id: 's1' }),
    )
    await restoreStorage(page)
  })

  test('keeps clear intent when the empty collection cannot be saved and completes after recovery', async ({
    page,
  }) => {
    await seed(page)
    await page.goto('/')
    await waitForApp(page)

    const requestClear = async () => {
      await page.getByTestId('session-settings').click()
      const sessionDialog = page.getByRole('dialog', {
        name: 'Session settings',
      })
      await sessionDialog.getByTestId('session-clear').click()
      const confirm = page.getByRole('dialog', { name: 'Delete every solve?' })
      await confirm.getByTestId('confirm-text').fill('CLEAR THIS SESSION')
      return confirm
    }

    let confirm = await requestClear()
    await failStorageKeys(page, ['cubelab:sessions:v1'])
    await confirm.getByRole('button', { name: 'Clear session' }).click()
    await expect(page.locator('.toast')).toContainText(
      'Session clear could not be saved',
    )
    await expect(page.getByTestId('solve-count')).toHaveText('3')
    expect(
      (await stored(page))?.sessions
        .find((session) => session.id === 'a')
        ?.solves.map((entry) => entry.id),
    ).toEqual(expect.arrayContaining(['s1', 's2', 's3']))
    expect(
      await page.evaluate(() => {
        const raw = localStorage.getItem('cubelab:sync:v1')
        const tombstones = raw
          ? (JSON.parse(raw) as {
              runtime: {
                tombstones: Array<{
                  kind: string
                  id: string
                  restoredAt?: number
                  deletedAt: number
                }>
              }
            }).runtime.tombstones
          : []
        return tombstones.filter(
          (entry) =>
            entry.kind === 'solve' &&
            (entry.restoredAt === undefined || entry.restoredAt <= entry.deletedAt),
        )
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 's1' }),
        expect.objectContaining({ id: 's2' }),
        expect.objectContaining({ id: 's3' }),
      ]),
    )

    await restoreStorage(page)
    await page.reload()
    await waitForApp(page)
    await expect(page.getByTestId('solve-count')).toHaveText('3')

    confirm = await requestClear()
    await confirm.getByRole('button', { name: 'Clear session' }).click()
    await expect(page.locator('.toast')).toContainText('Session cleared')
    await expect(page.getByTestId('solve-count')).toHaveText('0')
    const cleared = await stored(page)
    expect(
      cleared?.sessions.find((session) => session.id === 'a')?.solves,
    ).toEqual([])
    expect(
      cleared?.sessions
        .find((session) => session.id === 'b')
        ?.solves.map((entry) => entry.id),
    ).toEqual(['b1'])
    expect(
      cleared?.sessions.find((session) => session.id === 'c')?.solves,
    ).toEqual([])
    await page.reload()
    await waitForApp(page)
    await expect(page.getByTestId('solve-count')).toHaveText('0')
  })

  test('keeps an Undo failure notification visible after the action toast is dismissed', async ({
    page,
  }) => {
    await seed(page)
    await page.goto('/')
    await waitForApp(page)

    const firstRow = page.locator('[data-testid="history-row"]').first()
    await firstRow.locator('[data-testid="history-main"]').click()
    await page
      .getByRole('menu')
      .getByRole('menuitem', { name: 'Delete solve' })
      .click()
    await expect(page.getByTestId('solve-count')).toHaveText('2')

    await failStorageKeys(page, ['cubelab:sync:v1'])
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect(page.getByTestId('solve-count')).toHaveText('2')
    await expect(page.locator('.toast')).toContainText('Undo blocked')
    await expect(page.locator('.toast')).toBeVisible()
    await restoreStorage(page)
  })

  test('blocks Undo before changing deletion intent when its recovery journal cannot be saved', async ({
    page,
  }) => {
    await seed(page)
    await page.goto('/')
    await waitForApp(page)

    const firstRow = page.locator('[data-testid="history-row"]').first()
    await firstRow.locator('[data-testid="history-main"]').click()
    await page
      .getByRole('menu')
      .getByRole('menuitem', { name: 'Delete solve' })
      .click()
    await expect(page.getByTestId('solve-count')).toHaveText('2')

    await failStorageKeys(page, ['cubelab:recovery:v1'])
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect(page.getByTestId('solve-count')).toHaveText('2')
    await expect(page.locator('.toast')).toContainText(
      'Undo blocked: the recovery record could not be saved',
    )
    expect(
      await page.evaluate(() => {
        const raw = localStorage.getItem('cubelab:recovery:v1')
        return raw
          ? (JSON.parse(raw) as { operations: unknown[] }).operations
          : []
      }),
    ).toEqual([])
    const tombstone = await page.evaluate(() => {
      const raw = localStorage.getItem('cubelab:sync:v1')
      const tombstones = raw
        ? (JSON.parse(raw) as {
            runtime: {
              tombstones: Array<{
                kind: string
                id: string
                deletedAt: number
                restoredAt?: number
              }>
            }
          }).runtime.tombstones
        : []
      return tombstones.find(
        (entry) => entry.kind === 'solve' && entry.id === 's1',
      )
    })
    expect(
      tombstone?.restoredAt === undefined ||
        (tombstone?.restoredAt ?? 0) <= (tombstone?.deletedAt ?? 0),
    ).toBe(true)
    await restoreStorage(page)
  })

  test('bounds recovery notifications when journal cleanup keeps failing', async ({
    page,
  }) => {
    test.setTimeout(20_000)
    await page.addInitScript(() => {
      const target = window as typeof window & { __recoveryToasts?: number }
      if (sessionStorage.getItem('journal-cleanup-seeded')) return
      sessionStorage.setItem('journal-cleanup-seeded', '1')
      const now = Date.now()
      const pendingSolve = {
        id: 'journal-cleanup-solve',
        event: '333',
        rawMs: 12_000,
        penalty: 'none',
        comment: '',
        scramble: 'R U',
        createdAt: now - 10_000,
      }
      localStorage.clear()
      localStorage.setItem(
        'cubelab:sessions:v1',
        JSON.stringify({
          version: 6,
          activeSessionId: 'main',
          sessions: [
            {
              id: 'main',
              name: 'Main',
              event: '333',
              createdAt: now - 10_000,
              updatedAt: now,
              solves: [],
            },
          ],
        }),
      )
      localStorage.setItem(
        'cubelab:recovery:v1',
        JSON.stringify({
          version: 1,
          operations: [
            {
              operationId: 'journal-cleanup-operation',
              sessionId: 'main',
              sessionName: 'Main',
              index: 0,
              solve: pendingSolve,
              createdAt: now,
            },
          ],
        }),
      )
      localStorage.setItem(
        'cubelab:sync:v1',
        JSON.stringify({
          version: 1,
          preferences: { enabled: false },
          runtime: {
            deviceId: 'journal-cleanup-device',
            tombstones: [
              {
                kind: 'solve',
                id: pendingSolve.id,
                sessionId: 'main',
                deletedAt: now - 1_000,
                restoredAt: now,
                deletedByDeviceId: 'journal-cleanup-device',
              },
            ],
          },
        }),
      )
      target.__recoveryToasts = 0
      new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (node instanceof Element && node.classList.contains('toast')) {
              target.__recoveryToasts = (target.__recoveryToasts ?? 0) + 1
            }
          }
        }
      }).observe(document, { subtree: true, childList: true })
      const original = Storage.prototype.setItem
      Storage.prototype.setItem = function setItem(key, value) {
        if (key === 'cubelab:recovery:v1') {
          throw new DOMException(
            'Synthetic journal cleanup failure',
            'QuotaExceededError',
          )
        }
        return original.call(this, key, value)
      }
    })

    const warnings: string[] = []
    page.on('console', (message) => {
      if (message.text().includes('Maximum update depth')) {
        warnings.push(message.text())
      }
    })
    page.on('pageerror', (error) => {
      if (error.message.includes('Maximum update depth')) {
        warnings.push(error.message)
      }
    })

    await page.goto('/')
    await waitForApp(page)
    await page.waitForTimeout(1_500)
    const recoveryToasts = await page.evaluate(
      () =>
        (window as typeof window & { __recoveryToasts?: number })
          .__recoveryToasts ?? 0,
    )
    expect(recoveryToasts).toBeLessThanOrEqual(5)
    expect(warnings).toEqual([])
    await expect(page.getByTestId('solve-count')).toHaveText('1')
    expect(
      await page.evaluate(() => {
        const raw = localStorage.getItem('cubelab:recovery:v1')
        return raw
          ? (JSON.parse(raw) as { operations: unknown[] }).operations
          : []
      }),
    ).toHaveLength(1)

    await page.reload()
    await waitForApp(page)
    await expect(page.getByTestId('solve-count')).toHaveText('1')
    expect(
      await page.evaluate(() => {
        const raw = localStorage.getItem('cubelab:recovery:v1')
        return raw
          ? (JSON.parse(raw) as { operations: unknown[] }).operations
          : []
      }),
    ).toEqual([])
    expect(
      (await stored(page))?.sessions
        .flatMap((session) => session.solves)
        .filter((entry) => entry.id === 'journal-cleanup-solve'),
    ).toHaveLength(1)
  })

  test('keeps a failed Undo recoverable across reload instead of leaving a durable restoration', async ({
    page,
  }) => {
    await seed(page)
    await page.goto('/')
    await waitForApp(page)

    const firstRow = page.locator('[data-testid="history-row"]').first()
    await firstRow.locator('[data-testid="history-main"]').click()
    await page
      .getByRole('menu')
      .getByRole('menuitem', { name: 'Delete solve' })
      .click()
    await expect(page.getByTestId('solve-count')).toHaveText('2')

    await page.evaluate(() => {
      const original = Storage.prototype.setItem
      let syncWrites = 0
      const target = window as typeof window & {
        __restoreUndoFailure?: () => void
      }
      target.__restoreUndoFailure = () => {
        Storage.prototype.setItem = original
      }
      Storage.prototype.setItem = function setItem(key, value) {
        if (key === 'cubelab:sessions:v1') {
          throw new DOMException('Synthetic session quota', 'QuotaExceededError')
        }
        if (key === 'cubelab:sync:v1' && ++syncWrites > 1) {
          throw new DOMException(
            'Synthetic rollback failure',
            'QuotaExceededError',
          )
        }
        return original.call(this, key, value)
      }
    })

    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect(page.getByTestId('solve-count')).toHaveText('2')
    await expect(page.locator('.toast')).toContainText('Undo is pending recovery')

    const pending = await page.evaluate(() => {
      const raw = localStorage.getItem('cubelab:recovery:v1')
      return raw ? JSON.parse(raw) : null
    })
    expect(pending?.operations).toContainEqual(
      expect.objectContaining({
        solve: expect.objectContaining({ id: 's1' }),
        sessionId: 'a',
      }),
    )
    const tombstone = await page.evaluate(() => {
      const raw = localStorage.getItem('cubelab:sync:v1')
      const tombstones = raw
        ? (JSON.parse(raw) as {
            runtime: {
              tombstones: Array<{
                kind: string
                id: string
                deletedAt: number
                restoredAt?: number
              }>
            }
          }).runtime.tombstones
        : []
      return tombstones.find(
        (entry) => entry.kind === 'solve' && entry.id === 's1',
      )
    })
    expect(tombstone?.restoredAt).toBeGreaterThan(tombstone?.deletedAt ?? 0)

    const settings = await openSettings(page)
    await settings.getByTestId('settings-backup-button').click()
    const dataDialog = page.getByRole('dialog', { name: 'Your local data' })
    const downloadPromise = page.waitForEvent('download')
    await dataDialog.getByTestId('export-backup').click()
    const download = await downloadPromise
    const downloadPath = await download.path()
    expect(downloadPath).not.toBeNull()
    if (!downloadPath) throw new Error('Backup download has no path')
    const exported = JSON.parse(readFileSync(downloadPath, 'utf8')) as {
      sessions: SeedData
    }
    expect(
      exported.sessions.sessions.flatMap((session) =>
        session.solves.map((entry) => entry.id),
      ),
    ).toContain('s1')

    await page.evaluate(() => {
      ;(
        window as typeof window & { __restoreUndoFailure?: () => void }
      ).__restoreUndoFailure?.()
    })
    await page.reload()
    await waitForApp(page)
    await expect(page.getByTestId('solve-count')).toHaveText('3')
    expect(
      (await stored(page))?.sessions
        .find((session) => session.id === 'a')
        ?.solves.map((entry) => entry.id),
    ).toContain('s1')
    expect(
      await page.evaluate(() => {
        const raw = localStorage.getItem('cubelab:recovery:v1')
        return raw
          ? (JSON.parse(raw) as { operations: Array<{ solve: { id: string } }> })
              .operations
          : []
      }),
    ).not.toContainEqual(
      expect.objectContaining({ solve: expect.objectContaining({ id: 's1' }) }),
    )
  })

  test('commits native imports only after durable staging and rolls back every failure boundary', async ({
    page,
  }) => {
    await seed(page)
    await page.goto('/')
    await waitForApp(page)
    const original = await stored(page)
    const backup = await currentNativeBackup(page)
    ;(
      backup.sessions.sessions as Array<{ name: string; solves: unknown[] }>
    )[0]!.name = 'Durable imported replacement'
    ;(
      backup.sessions.sessions as Array<{ name: string; solves: unknown[] }>
    )[0]!.solves = [
      (
        backup.sessions.sessions as Array<{
          solves: Array<{ id: string; comment: string }>
        }>
      )[0]!.solves[0]!,
    ]

    await openBackup(page)
    const importBackup = async () => {
      await page.getByTestId('backup-file-input').setInputFiles({
        name: 'durable-import.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(backup)),
      })
      const confirmation = page.getByRole('dialog', {
        name: 'Replace local sessions?',
      })
      await expect(confirmation).toBeVisible()
      return confirmation
    }

    let confirmation = await importBackup()
    expect(
      await page.evaluate(() =>
        localStorage.getItem('cubelab:replacement:v1'),
      ),
    ).toBeNull()
    await failStorageKeys(page, ['cubelab:sessions:v1'])
    await confirmation
      .getByRole('button', { name: 'Import backup', exact: true })
      .click()
    await expect(page.locator('.toast')).toContainText(
      'sessions could not be saved',
    )
    expect(await stored(page)).toEqual(original)
    expect(
      await page.evaluate(() => {
        const raw = localStorage.getItem('cubelab:replacement:v1')
        return raw
          ? (JSON.parse(raw) as { phase: string }).phase
          : null
      }),
    ).toBe('prepared')
    await restoreStorage(page)
    await page.reload()
    await waitForApp(page)
    expect(await stored(page)).toEqual(original)
    expect(
      await page.evaluate(() =>
        localStorage.getItem('cubelab:replacement:v1'),
      ),
    ).toBeNull()

    await openBackup(page)
    confirmation = await importBackup()
    await page.evaluate(() => {
      const originalSetItem = Storage.prototype.setItem
      const target = window as typeof window & {
        __restoreReplacementMarker?: () => void
      }
      target.__restoreReplacementMarker = () => {
        Storage.prototype.setItem = originalSetItem
      }
      Storage.prototype.setItem = function setItem(key, value) {
        if (
          key === 'cubelab:replacement:v1' &&
          value.includes('"phase":"committed"')
        ) {
          throw new DOMException('Quota exceeded', 'QuotaExceededError')
        }
        return originalSetItem.call(this, key, value)
      }
    })
    await confirmation
      .getByRole('button', { name: 'Import backup', exact: true })
      .click()
    await expect(page.locator('.toast')).toContainText(
      'durable commit marker could not be saved',
    )
    expect(await stored(page)).toEqual(original)
    expect(
      await page.evaluate(() =>
        localStorage.getItem('cubelab:replacement:v1'),
      ),
    ).toBeNull()
    await page.evaluate(() => {
      ;(
        window as typeof window & { __restoreReplacementMarker?: () => void }
      ).__restoreReplacementMarker?.()
    })

    await confirmation
      .getByRole('button', { name: 'Import backup', exact: true })
      .click()
    await expect(page.locator('.toast')).toContainText('Backup imported')
    await expect(confirmation).toBeHidden()
    await expect
      .poll(async () => (await stored(page))?.sessions[0]?.name)
      .toBe('Durable imported replacement')
    expect(
      await page.evaluate(() =>
        localStorage.getItem('cubelab:replacement:v1'),
      ),
    ).toBeNull()

    await page.reload()
    await waitForApp(page)
    expect((await stored(page))?.sessions[0]?.name).toBe(
      'Durable imported replacement',
    )
  })

  test('merges a buffered follower completion into a native import before acknowledging it', async ({
    page,
  }) => {
    await seed(page)
    await page.goto('/')
    await waitForApp(page)

    const bufferedSolve = {
      id: 'follower-buffered',
      event: '333',
      rawMs: 9_876,
      penalty: 'none',
      scramble: "F R U'",
      comment: 'Follower completion',
      createdAt: NOW + 5_000,
    }
    await page.evaluate((solve) => {
      const sessions = JSON.parse(
        localStorage.getItem('cubelab:sessions:v1')!,
      ) as {
        sessions: Array<Record<string, unknown> & { id: string }>
      }
      const source = sessions.sessions.find((session) => session.id === 'a')!
      localStorage.setItem(
        'cubelab:replacement-completion:v1',
        JSON.stringify({
          version: 1,
          operationId: 'follower-completion',
          createdAt: Date.now(),
          entries: [
            {
              session: { ...source, solves: [] },
              solves: [solve],
            },
          ],
        }),
      )
    }, bufferedSolve)

    const backup = await currentNativeBackup(page)
    const candidate = backup.sessions.sessions as Array<{
      id: string
      name: string
      solves: unknown[]
    }>
    candidate[0]!.name = 'Coordinated import'
    candidate[0]!.solves = []

    await openBackup(page)
    await page.getByTestId('backup-file-input').setInputFiles({
      name: 'coordinated-import.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(backup)),
    })
    const confirmation = page.getByRole('dialog', {
      name: 'Replace local sessions?',
    })
    await expect(confirmation).toBeVisible()
    await confirmation
      .getByRole('button', { name: 'Import backup', exact: true })
      .click()
    await expect(page.locator('.toast')).toContainText('Backup imported')

    const imported = await stored(page)
    expect(imported?.sessions.find((session) => session.id === 'a')).toMatchObject({
      name: 'Coordinated import',
      solves: [
        expect.objectContaining({
          id: 'follower-buffered',
          event: '333',
          rawMs: 9_876,
          comment: 'Follower completion',
          scramble: "F R U'",
        }),
      ],
    })
    expect(
      await page.evaluate(() => {
        const prefix = 'cubelab:replacement-completion:v1'
        return Object.keys(localStorage).filter((key) =>
          key.startsWith(prefix),
        )
      }),
    ).toEqual([])

    await page.reload()
    await waitForApp(page)
    const reloaded = await stored(page)
    expect(
      reloaded?.sessions.find((session) => session.id === 'a')?.solves,
    ).toEqual([
      expect.objectContaining({
        id: 'follower-buffered',
        event: '333',
        rawMs: 9_876,
      }),
    ])
  })

  test('ignores another tab\'s staged replacement until its commit marker', async ({
    page,
  }) => {
    // Exercise the protocol against a simulated older concurrent client.
    await simulateLegacyConcurrentTabs(page.context())
    await seed(page)
    await page.goto('/')
    await waitForApp(page)
    const follower = await page.context().newPage()
    await follower.goto('/')
    await expect(follower.locator('.scramble-text')).toBeVisible({
      timeout: 30_000,
    })
    await expect(follower.getByTestId('solve-count')).toHaveText('3')

    const staged = await page.evaluate(() => {
      const sessionsRaw = localStorage.getItem('cubelab:sessions:v1')!
      const settingsRaw = localStorage.getItem('cubelab:settings:v1')!
      const syncRaw = localStorage.getItem('cubelab:sync:v1')!
      const sessions = JSON.parse(sessionsRaw) as {
        activeSessionId: string
        sessions: Array<{
          id: string
          name: string
          solves: unknown[]
        }>
      }
      sessions.sessions[0]!.name = 'Cross-tab committed'
      sessions.sessions[0]!.solves = []
      localStorage.setItem(
        'cubelab:replacement:v1',
        JSON.stringify({
          version: 1,
          operationId: 'cross-tab-operation',
          kind: 'native-import',
          phase: 'prepared',
          createdAt: Date.now(),
          before: {
            sessions: sessionsRaw,
            settings: settingsRaw,
            sync: syncRaw,
          },
        }),
      )
      localStorage.setItem('cubelab:sessions:v1', JSON.stringify(sessions))
      return sessions
    })

    await expect(follower.getByTestId('solve-count')).toHaveText('3')
    await expect(follower.getByTestId('session-select')).not.toContainText(
      staged.sessions[0]!.name,
    )

    await page.evaluate(() => {
      const raw = localStorage.getItem('cubelab:replacement:v1')!
      const journal = JSON.parse(raw) as Record<string, unknown>
      localStorage.setItem(
        'cubelab:replacement:v1',
        JSON.stringify({ ...journal, phase: 'committed', before: {} }),
      )
    })

    await expect(follower.getByTestId('solve-count')).toHaveText('0')
    await expect(follower.getByTestId('session-select')).toContainText(
      'Cross-tab committed',
    )
    await expect
      .poll(() =>
        follower.evaluate(() =>
          localStorage.getItem('cubelab:replacement:v1'),
        ),
      )
      .toBeNull()
    await follower.close()
  })

  test('blocks editable startup until a failed prepared rollback can be completed', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      if (sessionStorage.getItem('d5-v2-failed-rollback-seed')) return
      sessionStorage.setItem('d5-v2-failed-rollback-seed', '1')
      const now = Date.now()
      const old = {
        version: 6,
        activeSessionId: 'v2-old',
        sessions: [
          {
            id: 'v2-old',
            name: 'Old committed',
            event: '333',
            createdAt: now,
            updatedAt: now,
            solves: [],
          },
        ],
      }
      const candidate = {
        ...old,
        activeSessionId: 'v2-new',
        sessions: [
          {
            ...old.sessions[0]!,
            id: 'v2-new',
            name: 'Uncommitted candidate',
          },
        ],
      }
      localStorage.clear()
      localStorage.setItem('cubelab:sessions:v1', JSON.stringify(candidate))
      localStorage.setItem(
        'cubelab:replacement:v1',
        JSON.stringify({
          version: 1,
          operationId: 'v2-failed-rollback',
          kind: 'native-import',
          phase: 'prepared',
          createdAt: now,
          before: { sessions: JSON.stringify(old) },
        }),
      )
      const originalSetItem = Storage.prototype.setItem
      const target = window as typeof window & {
        __restoreV2Storage?: () => void
      }
      target.__restoreV2Storage = () => {
        Storage.prototype.setItem = originalSetItem
      }
      Storage.prototype.setItem = function setItem(key, value) {
        if (key === 'cubelab:sessions:v1') {
          throw new DOMException('Synthetic rollback failure', 'QuotaExceededError')
        }
        return originalSetItem.call(this, key, value)
      }
    })
    await page.goto('/')

    const recovery = page.getByTestId('startup-recovery')
    await expect(recovery).toBeVisible({ timeout: 5_000 })
    await expect(page.locator('.scramble-text')).toHaveCount(0)
    await expect(page.getByTestId('session-select')).toHaveCount(0)
    await expect(recovery).not.toContainText('Uncommitted candidate')
    expect(
      await page.evaluate(() => {
        const raw = localStorage.getItem('cubelab:replacement:v1')
        return raw
          ? (JSON.parse(raw) as { phase: string }).phase
          : null
      }),
    ).toBe('prepared')

    await page.evaluate(() => {
      ;(
        window as typeof window & { __restoreV2Storage?: () => void }
      ).__restoreV2Storage?.()
    })
    // Recovery is an explicit retry, not a render/event loop.
    await expect(recovery).toBeVisible()
    await page.getByTestId('startup-recovery-retry').click()
    await waitForApp(page)
    await expect(page.getByTestId('session-select')).toContainText(
      'Old committed',
    )
    await expect(page.getByTestId('solve-count')).toHaveText('0')
    expect(
      await page.evaluate(() =>
        localStorage.getItem('cubelab:replacement:v1'),
      ),
    ).toBeNull()

    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur()
      }
    })
    const timer = page.locator('[data-testid="timer-surface"]')
    await page.keyboard.down('Space')
    await expect(timer).toHaveAttribute('data-phase', 'ready', {
      timeout: 3_000,
    })
    await page.keyboard.up('Space')
    await expect(timer).toHaveAttribute('data-phase', 'running')
    await page.keyboard.press('Space')
    await expect(timer).toHaveAttribute('data-phase', 'idle')
    await expect(page.getByTestId('solve-count')).toHaveText('1')

    await page.reload()
    await waitForApp(page)
    await expect(page.getByTestId('session-select')).toContainText(
      'Old committed',
    )
    await expect(page.getByTestId('solve-count')).toHaveText('1')
  })

  test('keeps startup gated when rollback succeeds but journal cleanup fails', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      if (sessionStorage.getItem('d5-v2-cleanup-seed')) return
      sessionStorage.setItem('d5-v2-cleanup-seed', '1')
      const now = Date.now()
      const old = {
        version: 6,
        activeSessionId: 'v2-cleanup-old',
        sessions: [
          {
            id: 'v2-cleanup-old',
            name: 'Cleanup old committed',
            event: '333',
            createdAt: now,
            updatedAt: now,
            solves: [],
          },
        ],
      }
      const candidate = {
        ...old,
        sessions: [
          { ...old.sessions[0]!, name: 'Cleanup uncommitted candidate' },
        ],
      }
      localStorage.clear()
      localStorage.setItem('cubelab:sessions:v1', JSON.stringify(candidate))
      localStorage.setItem(
        'cubelab:replacement:v1',
        JSON.stringify({
          version: 1,
          operationId: 'v2-cleanup-failure',
          kind: 'native-import',
          phase: 'prepared',
          createdAt: now,
          before: { sessions: JSON.stringify(old) },
        }),
      )
      const originalRemoveItem = Storage.prototype.removeItem
      const target = window as typeof window & {
        __restoreV2Cleanup?: () => void
      }
      target.__restoreV2Cleanup = () => {
        Storage.prototype.removeItem = originalRemoveItem
      }
      Storage.prototype.removeItem = function removeItem(key) {
        if (key === 'cubelab:replacement:v1') {
          throw new DOMException('Synthetic cleanup failure', 'QuotaExceededError')
        }
        return originalRemoveItem.call(this, key)
      }
    })
    await page.goto('/')

    const recovery = page.getByTestId('startup-recovery')
    await expect(recovery).toBeVisible({ timeout: 5_000 })
    await expect(recovery).not.toContainText('Cleanup uncommitted candidate')
    expect(
      await page.evaluate(() => {
        const raw = localStorage.getItem('cubelab:sessions:v1')
        return raw ? (JSON.parse(raw) as { activeSessionId: string }).activeSessionId : null
      }),
    ).toBe('v2-cleanup-old')
    expect(
      await page.evaluate(() => localStorage.getItem('cubelab:replacement:v1')),
    ).not.toBeNull()

    await page.evaluate(() => {
      ;(
        window as typeof window & { __restoreV2Cleanup?: () => void }
      ).__restoreV2Cleanup?.()
    })
    await page.getByTestId('startup-recovery-retry').click()
    await waitForApp(page)
    await expect(page.getByTestId('session-select')).toContainText(
      'Cleanup old committed',
    )
    expect(
      await page.evaluate(() =>
        localStorage.getItem('cubelab:replacement:v1'),
      ),
    ).toBeNull()
  })

  test('allows normal use after committed-marker cleanup fails without reverting later work', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('d5-v2-committed-seed')) {
        sessionStorage.setItem('d5-v2-committed-seed', '1')
        const now = Date.now()
        const candidate = {
          version: 6,
          activeSessionId: 'v2-committed',
          sessions: [
            {
              id: 'v2-committed',
              name: 'Committed replacement',
              event: '333',
              createdAt: now,
              updatedAt: now,
              solves: [],
            },
          ],
        }
        localStorage.clear()
        localStorage.setItem('cubelab:sessions:v1', JSON.stringify(candidate))
        localStorage.setItem(
          'cubelab:replacement:v1',
          JSON.stringify({
            version: 1,
            operationId: 'v2-committed-cleanup',
            kind: 'native-import',
            phase: 'committed',
            createdAt: now,
            before: {},
          }),
        )
      }
      if (sessionStorage.getItem('d5-v2-committed-restored') === '1') return
      const originalRemoveItem = Storage.prototype.removeItem
      const target = window as typeof window & {
        __restoreV2CommittedCleanup?: () => void
      }
      target.__restoreV2CommittedCleanup = () => {
        Storage.prototype.removeItem = originalRemoveItem
      }
      Storage.prototype.removeItem = function removeItem(key) {
        if (key === 'cubelab:replacement:v1') {
          throw new DOMException('Synthetic cleanup failure', 'QuotaExceededError')
        }
        return originalRemoveItem.call(this, key)
      }
    })
    await page.goto('/')
    await waitForApp(page)
    await expect(page.getByTestId('session-select')).toContainText(
      'Committed replacement',
    )

    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur()
      }
    })
    const timer = page.locator('[data-testid="timer-surface"]')
    await page.keyboard.down('Space')
    await expect(timer).toHaveAttribute('data-phase', 'ready', {
      timeout: 3_000,
    })
    await page.keyboard.up('Space')
    await expect(timer).toHaveAttribute('data-phase', 'running')
    await page.keyboard.press('Space')
    await expect(timer).toHaveAttribute('data-phase', 'idle')
    await expect(page.getByTestId('solve-count')).toHaveText('1')

    await page.reload()
    await waitForApp(page)
    await expect(page.getByTestId('solve-count')).toHaveText('1')
    expect(
      await page.evaluate(() =>
        localStorage.getItem('cubelab:replacement:v1'),
      ),
    ).not.toBeNull()

    await page.evaluate(() => {
      sessionStorage.setItem('d5-v2-committed-restored', '1')
      ;(
        window as typeof window & {
          __restoreV2CommittedCleanup?: () => void
        }
      ).__restoreV2CommittedCleanup?.()
    })
    await page.reload()
    await waitForApp(page)
    await expect(page.getByTestId('solve-count')).toHaveText('1')
    expect(
      await page.evaluate(() =>
        localStorage.getItem('cubelab:replacement:v1'),
      ),
    ).toBeNull()
  })

  test('does not roll back a prepared transaction while another tab holds the write boundary', async ({
    page,
  }) => {
    // Exercise the protocol against a simulated older concurrent client.
    await simulateLegacyConcurrentTabs(page.context())
    await seed(page)
    await page.goto('/')
    await waitForApp(page)

    await page.evaluate(() => {
      const target = window as typeof window & {
        __releaseWriterLock?: () => void
      }
      void navigator.locks.request(
        'cubelab-drive-write',
        { mode: 'exclusive' },
        async () => {
          const sessionsKey = 'cubelab:sessions:v1'
          const journalKey = 'cubelab:replacement:v1'
          const before = localStorage.getItem(sessionsKey)!
          const candidate = JSON.parse(before) as {
            activeSessionId: string
            sessions: Array<{ id: string; name: string }>
          }
          candidate.sessions[0]!.name = 'Writer candidate'
          localStorage.setItem(
            journalKey,
            JSON.stringify({
              version: 1,
              operationId: 'live-writer-transaction',
              kind: 'native-import',
              phase: 'prepared',
              createdAt: Date.now(),
              before: { sessions: before },
            }),
          )
          localStorage.setItem(sessionsKey, JSON.stringify(candidate))
          await new Promise<void>((resolve) => {
            target.__releaseWriterLock = () => {
              localStorage.setItem(
                journalKey,
                JSON.stringify({
                  version: 1,
                  operationId: 'live-writer-transaction',
                  kind: 'native-import',
                  phase: 'committed',
                  createdAt: Date.now(),
                  before: {},
                }),
              )
              resolve()
            }
          })
        },
      )
    })
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as typeof window & { __releaseWriterLock?: () => void })
            .__releaseWriterLock
            ? 'held'
            : 'waiting',
        ),
      )
      .toBe('held')

    const recoveryPage = await page.context().newPage()
    await recoveryPage.goto('/')
    const gate = recoveryPage.getByTestId('startup-recovery')
    await expect(gate).toBeVisible({ timeout: 5_000 })
    await expect(gate).not.toContainText('Writer candidate')
    expect(
      await page.evaluate(() => {
        const raw = localStorage.getItem('cubelab:replacement:v1')
        return raw ? (JSON.parse(raw) as { phase: string }).phase : null
      }),
    ).toBe('prepared')
    expect(
      await page.evaluate(() =>
        localStorage.getItem('cubelab:sessions:v1'),
      ),
    ).toContain('Writer candidate')

    await page.evaluate(() => {
      ;(
        window as typeof window & { __releaseWriterLock?: () => void }
      ).__releaseWriterLock?.()
    })
    await waitForApp(recoveryPage)
    await expect(recoveryPage.getByTestId('session-select')).toContainText(
      'Writer candidate',
    )
    expect(
      await recoveryPage.evaluate(() =>
        localStorage.getItem('cubelab:replacement:v1'),
      ),
    ).toBeNull()
    await recoveryPage.close()
  })

  test('retains a malformed recovery record instead of opening staged data', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      if (sessionStorage.getItem('d5-v2-invalid-seed')) return
      sessionStorage.setItem('d5-v2-invalid-seed', '1')
      const now = Date.now()
      localStorage.clear()
      localStorage.setItem(
        'cubelab:sessions:v1',
        JSON.stringify({
          version: 6,
          activeSessionId: 'invalid-old',
          sessions: [
            {
              id: 'invalid-old',
              name: 'Invalid-journal committed',
              event: '333',
              createdAt: now,
              updatedAt: now,
              solves: [],
            },
          ],
        }),
      )
      localStorage.setItem('cubelab:replacement:v1', '{broken')
    })
    await page.goto('/')

    const recovery = page.getByTestId('startup-recovery')
    await expect(recovery).toBeVisible({ timeout: 5_000 })
    await expect(page.locator('.scramble-text')).toHaveCount(0)
    await expect(recovery).not.toContainText('Invalid-journal committed')
    await page.getByTestId('startup-recovery-retry').click()
    await expect(recovery).toBeVisible()
    expect(
      await page.evaluate(() =>
        localStorage.getItem('cubelab:replacement:v1'),
      ),
    ).toBe('{broken')
  })

  test('does not announce an additive csTimer import before its sessions are durable', async ({
    page,
  }) => {
    await seed(page)
    await page.goto('/')
    await waitForApp(page)
    const original = await stored(page)
    const originalSettings = await page.evaluate(() =>
      localStorage.getItem('cubelab:settings:v1'),
    )

    await openBackup(page)
    await page.getByTestId('backup-file-input').setInputFiles({
      name: 'additive-failure.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          session1: [[[0, 12345], 'R U', 'additive failure', 1700000000]],
        }),
      ),
    })
    await page.getByTestId('cs-preview-import').click()
    const confirmation = page.getByRole('dialog', {
      name: 'Add imported sessions?',
    })
    await expect(confirmation).toBeVisible()

    await failStorageKeys(page, ['cubelab:sessions:v1'])
    await confirmation
      .getByRole('button', { name: 'Import sessions', exact: true })
      .click()
    await expect(page.locator('.toast')).toContainText(
      'sessions could not be saved',
    )
    expect(await stored(page)).toEqual(original)
    expect(
      await page.evaluate(() => localStorage.getItem('cubelab:settings:v1')),
    ).toBe(originalSettings)
    expect(
      await page.evaluate(() => {
        const raw = localStorage.getItem('cubelab:replacement:v1')
        return raw
          ? (JSON.parse(raw) as { phase: string }).phase
          : null
      }),
    ).toBe('prepared')
    await restoreStorage(page)

    await page.reload()
    await waitForApp(page)
    expect(await stored(page)).toEqual(original)
    expect(
      await page.evaluate(() =>
        localStorage.getItem('cubelab:replacement:v1'),
      ),
    ).toBeNull()
    await expect(page.getByTestId('solve-count')).toHaveText('3')
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

  test('merges multiple same-event sessions into the active destination and preserves every solve field', async ({
    page,
  }) => {
    await seed(page)
    await page.goto('/')
    await waitForApp(page)

    await page.getByTestId('session-settings').click()
    const settingsDialog = page.getByRole('dialog', { name: 'Session settings' })
    await expect(settingsDialog).toBeVisible()
    await settingsDialog.getByTestId('session-merge').click()
    await expect(settingsDialog).toBeHidden()

    const merge = page.getByRole('dialog', { name: 'Merge sessions' })
    await expect(merge).toBeVisible()
    await expect(merge.getByTestId('merge-destination')).toContainText(
      'Morning',
    )
    await merge.getByTestId('merge-source-b').check()
    await merge.getByTestId('merge-source-c').check()
    await expect(merge.getByTestId('merge-preview')).toContainText(
      'After merge4',
    )
    await expect(merge.getByTestId('merge-preview')).toContainText(
      'Sources removed2',
    )
    await merge.getByLabel('Typed confirmation').fill('MERGE SESSIONS')
    await merge.getByRole('button', { name: 'Confirm merge' }).click()
    await expect(merge).toBeHidden()
    await expect(page.getByTestId('session-select')).toBeFocused()

    expect(await sessionNames(page)).toEqual(['Morning'])
    await expect(page.getByTestId('session-select')).toContainText('Morning')
    await expect(page.getByTestId('solve-count')).toHaveText('4')

    const merged = await stored(page)
    expect(merged?.activeSessionId).toBe('a')
    expect(merged?.sessionOrder?.ids).toEqual(['a'])
    expect(merged?.sessions).toHaveLength(1)
    expect(merged?.sessions[0]?.solves.map((entry) => entry.id)).toEqual([
      's1',
      's2',
      's3',
      'b1',
    ])
    expect(merged?.sessions[0]?.solves[0]).toMatchObject({
      id: 's1',
      rawMs: 10_000,
      penalty: 'none',
      comment: 'Preserve this comment',
      createdAt: NOW - 1_000,
      importSource: {
        provider: 'cstimer',
        scrType: '333',
        sessionNumber: 1,
        solveIndex: 1,
      },
    })
    expect(merged?.sessions[0]?.solves[3]).toMatchObject({
      id: 'b1',
      rawMs: 5_000,
      penalty: '+2',
      createdAt: NOW - 4_000,
    })

    await page.reload()
    await waitForApp(page)
    expect(await sessionNames(page)).toEqual(['Morning'])
    await expect(page.getByTestId('solve-count')).toHaveText('4')
  })

  test('splits a selected range into a new custom-event session with copied settings', async ({
    page,
  }) => {
    const custom = (id: string, createdAt: number): SeedSolve => ({
      ...solve(id, 12_000, 'none', createdAt - NOW),
      event: 'custom:fto',
      comment: id === 'c2' ? 'Keep split comment' : '',
      importSource:
        id === 'c2'
          ? {
              provider: 'cstimer',
              scrType: 'fto-unsupported',
              sessionNumber: 3,
              solveIndex: 2,
            }
          : undefined,
    })
    const splitSeed = seedData({
      activeSessionId: 'a',
      sessions: [
        {
          id: 'a',
          name: 'FTO Practice',
          event: 'custom:fto',
          createdAt: NOW - 90_000,
          updatedAt: NOW,
          inspectionEnabled: false,
          preferences: {
            timerUpdateMode: 'tenths',
            holdDurationMs: 500,
          },
          solves: [
            custom('c4', NOW - 4_000),
            custom('c3', NOW - 3_000),
            custom('c2', NOW - 2_000),
            custom('c1', NOW - 1_000),
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
    })
    await seed(page, splitSeed)
    await page.goto('/')
    await waitForApp(page)

    await page.getByTestId('session-settings').click()
    const settingsDialog = page.getByRole('dialog', { name: 'Session settings' })
    await settingsDialog.getByTestId('session-split').click()
    await expect(settingsDialog).toBeHidden()

    const split = page.getByRole('dialog', {
      name: 'Move solves to a new session',
    })
    await expect(split).toBeVisible()
    await expect(split.getByLabel('New session name')).toHaveValue(
      'FTO Practice (split)',
    )
    await expect(split.getByTestId('split-selection-count')).toContainText(
      '0 of 4 selected',
    )
    await split.getByTestId('split-range-start').fill('2')
    await split.getByTestId('split-range-end').fill('3')
    await split.getByTestId('split-select-range').click()
    await expect(split.getByTestId('split-selection-count')).toContainText(
      '2 of 4 selected · 2 remaining',
    )
    await expect(split.getByTestId('split-preview')).toContainText('Moving2')
    await split.getByLabel('Typed confirmation').fill('SPLIT SESSION')
    await split.getByRole('button', { name: 'Confirm split' }).click()
    await expect(split).toBeHidden()
    await expect(page.getByTestId('session-select')).toBeFocused()

    expect(await sessionNames(page)).toEqual([
      'FTO Practice',
      'FTO Practice (split)',
      'Evening',
      'Empty',
    ])
    await expect(page.getByTestId('session-select')).toContainText(
      'FTO Practice (split)',
    )
    await expect(page.getByTestId('solve-count')).toHaveText('2')

    const afterSplit = await stored(page)
    const source = afterSplit?.sessions.find((entry) => entry.id === 'a')
    const created = afterSplit?.sessions.find(
      (entry) => entry.name === 'FTO Practice (split)',
    )
    expect(source?.solves.map((entry) => entry.id)).toEqual(['c4', 'c1'])
    expect(created?.solves.map((entry) => entry.id)).toEqual(['c3', 'c2'])
    expect(created).toMatchObject({
      event: 'custom:fto',
      inspectionEnabled: false,
      preferences: {
        timerUpdateMode: 'tenths',
        holdDurationMs: 500,
      },
    })
    expect(created?.solves[1]).toMatchObject({
      id: 'c2',
      rawMs: 12_000,
      comment: 'Keep split comment',
      importSource: {
        provider: 'cstimer',
        scrType: 'fto-unsupported',
        sessionNumber: 3,
        solveIndex: 2,
      },
    })
    expect(afterSplit?.activeSessionId).toBe(created?.id)
    expect(afterSplit?.sessionOrder?.ids).toEqual([
      'a',
      created?.id,
      'b',
      'c',
    ])
    expect(afterSplit?.sessionTransfers).toEqual([
      expect.objectContaining({
        fromSessionId: 'a',
        toSessionId: created?.id,
        transferredAt: expect.any(Number),
        byDeviceId: expect.any(String),
      }),
    ])
    expect(
      new Set(afterSplit?.sessionTransfers?.[0]?.solveIds),
    ).toEqual(new Set(['c2', 'c3']))

    await page.reload()
    await waitForApp(page)
    expect(await sessionNames(page)).toEqual([
      'FTO Practice',
      'FTO Practice (split)',
      'Evening',
      'Empty',
    ])
    await expect(page.getByTestId('session-select')).toContainText(
      'FTO Practice (split)',
    )

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
    expect(backup.sessions.sessionTransfers).toHaveLength(1)
    expect(
      backup.sessions.sessions.find(
        (entry) => entry.name === 'FTO Practice (split)',
      )?.solves.map((entry) => entry.id),
    ).toEqual(['c3', 'c2'])
  })

  test('keeps sessions unchanged when merge or split storage writes fail', async ({
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

    await page.getByTestId('session-settings').click()
    let dialog = page.getByRole('dialog', { name: 'Session settings' })
    await dialog.getByTestId('session-merge').click()
    const merge = page.getByRole('dialog', { name: 'Merge sessions' })
    await merge.getByTestId('merge-source-b').check()
    await merge.getByLabel('Typed confirmation').fill('MERGE SESSIONS')
    await merge.getByRole('button', { name: 'Confirm merge' }).click()
    await expect(merge.getByTestId('merge-error')).toContainText(
      'Could not merge these sessions',
    )
    expect((await stored(page))?.sessions).toHaveLength(3)
    expect(
      await page.evaluate(() => {
        const raw = localStorage.getItem('cubelab:sync:v1')
        return raw
          ? (JSON.parse(raw) as { runtime: { sessionRedirects: unknown[] } })
              .runtime.sessionRedirects
          : []
      }),
    ).toEqual([])
    await merge.getByRole('button', { name: 'Cancel merge' }).click()

    await page.getByTestId('session-settings').click()
    dialog = page.getByRole('dialog', { name: 'Session settings' })
    await dialog.getByTestId('session-split').click()
    const split = page.getByRole('dialog', {
      name: 'Move solves to a new session',
    })
    await split.getByTestId('split-select-all').click()
    await split.getByLabel('Typed confirmation').fill('SPLIT SESSION')
    await split.getByRole('button', { name: 'Confirm split' }).click()
    await expect(split.getByTestId('split-error')).toContainText(
      'Could not split this session',
    )

    const unchanged = await stored(page)
    expect(unchanged?.sessions).toHaveLength(3)
    expect(unchanged?.sessionTransfers).toBeUndefined()
    expect(unchanged?.activeSessionId).toBe('a')
    await expect(page.getByTestId('solve-count')).toHaveText('3')

    await page.evaluate(() => {
      ;(
        window as typeof window & { __restoreSessionStorage?: () => void }
      ).__restoreSessionStorage?.()
    })
    await split.getByRole('button', { name: 'Cancel split' }).click()
    expect(await sessionNames(page)).toHaveLength(3)
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

test.describe('split synchronization', () => {
  test('keeps moved solves in the split session when a stale device publishes an older source snapshot', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    const original = seedData()
    await seed(page, original)
    await page.goto('/')
    await waitForApp(page)

    let settings = await openSettings(page)
    await settings.getByTestId('settings-drive-button').click()
    let drive = page.getByRole('dialog', { name: 'Google Drive backup' })
    await drive.getByTestId('drive-connect').click()
    await expect(drive.getByTestId('drive-status')).toContainText('Connected')
    await drive.getByTestId('sync-now').click()
    await expect(drive.getByTestId('sync-status')).toContainText('synced', {
      timeout: 15_000,
    })
    await drive.getByTestId('drive-done').click()

    await page.getByTestId('session-settings').click()
    const settingsDialog = page.getByRole('dialog', { name: 'Session settings' })
    await settingsDialog.getByTestId('session-split').click()
    const split = page.getByRole('dialog', {
      name: 'Move solves to a new session',
    })
    await split.getByTestId('split-range-start').fill('1')
    await split.getByTestId('split-range-end').fill('2')
    await split.getByTestId('split-select-range').click()
    await split.getByLabel('Typed confirmation').fill('SPLIT SESSION')
    await split.getByRole('button', { name: 'Confirm split' }).click()
    await expect(split).toBeHidden()

    const afterSplit = await stored(page)
    const created = afterSplit?.sessions.find(
      (entry) => entry.name === 'Morning (split)',
    )
    expect(created?.solves.map((entry) => entry.id)).toEqual(['s1', 's2'])
    expect(
      afterSplit?.sessions.find((entry) => entry.id === 'a')?.solves.map(
        (entry) => entry.id,
      ),
    ).toEqual(['s3'])

    settings = await openSettings(page)
    await settings.getByTestId('settings-drive-button').click()
    drive = page.getByRole('dialog', { name: 'Google Drive backup' })
    await drive.getByTestId('sync-now').click()
    await expect(drive.getByTestId('sync-status')).toContainText('synced', {
      timeout: 15_000,
    })
    await drive.getByTestId('drive-done').click()

    const stale = JSON.parse(JSON.stringify(original)) as SeedData
    stale.activeSessionId = 'a'
    const staleMorning = stale.sessions.find((entry) => entry.id === 'a')
    staleMorning?.solves.unshift({
      id: 'offline-new',
      event: '333',
      rawMs: 7_000,
      penalty: 'none',
      scramble: "F R U' R'",
      comment: 'Added by the offline device',
      createdAt: NOW + 5_000,
    })
    await page.evaluate(async (staleData) => {
      const settingsRaw = localStorage.getItem('cubelab:settings:v1')
      const cloud = {
        app: 'CubeLab',
        format: 'cubelab-backup',
        version: 1,
        exportedAt: new Date().toISOString(),
        sessions: staleData,
        settings: settingsRaw ? JSON.parse(settingsRaw).settings : {},
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
            uploadDeviceBackup: (
              content: string,
              deviceId: string,
            ) => Promise<unknown>
          }
        }
      ).__cubeLabMockDrive
      if (!mock) throw new Error('Mock Drive is unavailable')
      await mock.uploadDeviceBackup(
        JSON.stringify(cloud),
        'offline-device',
      )
    }, stale)

    settings = await openSettings(page)
    await settings.getByTestId('settings-drive-button').click()
    drive = page.getByRole('dialog', { name: 'Google Drive backup' })
    await drive.getByTestId('sync-now').click()
    await expect(drive.getByTestId('sync-status')).toContainText('synced', {
      timeout: 15_000,
    })
    await drive.getByTestId('drive-done').click()

    const merged = await stored(page)
    const source = merged?.sessions.find((entry) => entry.id === 'a')
    const splitSession = merged?.sessions.find(
      (entry) => entry.id === created?.id,
    )
    expect(source?.solves.map((entry) => entry.id)).toEqual([
      'offline-new',
      's3',
    ])
    expect(splitSession?.solves.map((entry) => entry.id)).toEqual([
      's1',
      's2',
    ])
    const allSolveIds = merged?.sessions.flatMap((entry) =>
      entry.solves.map((solve) => solve.id),
    )
    expect(allSolveIds).toHaveLength(new Set(allSolveIds).size)
    expect(allSolveIds).toHaveLength(5)
    expect(merged?.sessionTransfers).toHaveLength(1)
    expect(merged?.sessionTransfers?.[0]?.solveIds.sort()).toEqual([
      's1',
      's2',
    ])

    await page.reload()
    await waitForApp(page)
    const reloaded = await stored(page)
    expect(
      reloaded?.sessions.find((entry) => entry.id === created?.id)?.solves.map(
        (entry) => entry.id,
      ),
    ).toEqual(['s1', 's2'])
    expect(
      reloaded?.sessions.find((entry) => entry.id === 'a')?.solves.map(
        (entry) => entry.id,
      ),
    ).toEqual(['offline-new', 's3'])
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
