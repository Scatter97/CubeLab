import { expect, test, type Page } from '@playwright/test'
import { selectSession } from './interactions'

const NOW = Date.now()

interface SeedSolve {
  id: string
  event: '333' | '222'
  rawMs: number
  penalty: 'none' | '+2' | 'dnf'
  scramble: string
  comment: string
  createdAt: number
}

function solve(
  id: string,
  event: '333' | '222',
  rawMs: number,
  offset: number,
  penalty: SeedSolve['penalty'] = 'none',
): SeedSolve {
  return {
    id,
    event,
    rawMs,
    penalty,
    scramble: "R U R' U' F2 L D B2",
    comment: '',
    createdAt: NOW + offset,
  }
}

const sessions = {
  version: 6,
  activeSessionId: 'stats-a',
  sessions: [
    {
      id: 'stats-a',
      name: 'Three by three',
      event: '333',
      createdAt: NOW - 90_000,
      updatedAt: NOW,
      solves: [
        solve('a1', '333', 12_000, -1_000),
        solve('a2', '333', 13_000, -2_000),
        solve('a3', '333', 14_000, -3_000),
        solve('a4', '333', 20_000, -4_000),
        solve('a5', '333', 15_000, -5_000),
        solve('a6', '333', 16_000, -6_000),
        solve('a7', '333', 17_000, -7_000),
        solve('a8', '333', 18_000, -8_000),
        solve('a9', '333', 19_000, -9_000),
        solve('a10', '333', 21_000, -10_000),
        solve('a11', '333', 22_000, -11_000),
        solve('a12', '333', 23_000, -12_000),
      ],
    },
    {
      id: 'stats-b',
      name: 'Two by two',
      event: '222',
      createdAt: NOW - 80_000,
      updatedAt: NOW,
      solves: [
        solve('b1', '222', 4_000, -1_000),
        solve('b2', '222', 4_100, -2_000),
        solve('b3', '222', 4_200, -3_000),
        solve('b4', '222', 4_300, -4_000),
        solve('b5', '222', 4_400, -5_000),
        solve('b6', '222', 4_500, -6_000),
      ],
    },
  ],
}

async function seed(page: Page) {
  await page.addInitScript((payload) => {
    if (sessionStorage.getItem('cubelab-statistics-seeded')) return
    sessionStorage.setItem('cubelab-statistics-seeded', '1')
    localStorage.setItem('cubelab:sessions:v1', JSON.stringify(payload))
    localStorage.removeItem('cubelab:settings:v1')
    localStorage.removeItem('cubelab:expandedStats:v1')
  }, sessions)
  await page.goto('/')
  await expect(page.locator('.scramble-text')).toBeVisible({ timeout: 30_000 })
}

async function expandRow(page: Page, key: string) {
  const row = page.getByTestId(`stat-row-${key}`)
  if ((await row.getAttribute('aria-expanded')) === 'false') {
    await row.click()
  }
  await expect(page.getByTestId(`stat-details-${key}`)).toBeVisible()
}

test.describe('statistics panel', () => {
  test('stays between Sessions and Solves, expands independently and persists', async ({
    page,
  }) => {
    await seed(page)
    const sessionBox = await page.locator('.session-panel').boundingBox()
    const statsBox = await page.locator('.stats-panel').boundingBox()
    const historyBox = await page.locator('.history-panel').boundingBox()
    expect(sessionBox).not.toBeNull()
    expect(statsBox).not.toBeNull()
    expect(historyBox).not.toBeNull()
    expect(statsBox!.y).toBeGreaterThan(sessionBox!.y)
    expect(historyBox!.y).toBeGreaterThan(statsBox!.y)
    await expect(page.getByTestId('stats-solves-divider')).toBeVisible()

    for (const key of ['single', 'mo3', 'ao5', 'ao12']) {
      await expect(page.getByTestId(`stat-row-${key}`)).toBeVisible()
    }
    await expect(page.getByTestId('current-ao5')).toHaveText('14.00')
    await expect(page.getByTestId('best-ao5')).toHaveText('14.00')

    // The row is a normal button: Enter expands it without arming the timer.
    await page.getByTestId('stat-row-ao5').focus()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('stat-details-ao5')).toBeVisible()
    await expect(page.getByTestId('timer-surface')).toHaveAttribute(
      'data-phase',
      'idle',
    )

    await expandRow(page, 'ao12')
    await expect(page.getByTestId('stat-details-ao5')).toBeVisible()
    await expect(page.getByTestId('stat-details-ao12')).toBeVisible()
    await page.getByTestId('stat-row-ao12').click()
    await expect(page.getByTestId('stat-details-ao12')).toBeHidden()
    await expect(page.getByTestId('stat-details-ao5')).toBeVisible()

    // Both open rows survive a reload through the local display preference.
    await expandRow(page, 'ao12')
    await page.reload()
    await expect(page.locator('.scramble-text')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('stat-details-ao5')).toBeVisible()
    await expect(page.getByTestId('stat-details-ao12')).toBeVisible()
    expect(await page.locator('.stats-panel [role="menu"]').count()).toBe(0)
  })

  test('edits targets in place, persists them per event and updates the next solve', async ({
    page,
  }) => {
    await seed(page)
    await expandRow(page, 'ao5')
    const input = page.getByTestId('stat-target-ao5')
    await input.fill('14.00')
    await input.press('Enter')
    await expect(page.getByTestId('stat-next-ao5')).toHaveText('≤ 15.01')
    await expect
      .poll(() =>
        page.evaluate(() => {
          const raw = localStorage.getItem('cubelab:settings:v1')
          return raw
            ? (
                JSON.parse(raw) as {
                  settings: { statTargetsMs: Record<string, Record<string, number>> }
                }
              ).settings.statTargetsMs['333']?.ao5
            : null
        }),
      )
      .toBe(14_000)

    await expect(page.getByTestId('stat-next-ao5')).toHaveClass(/is-reachable/)

    await selectSession(page, 'stats-b')
    await expect(page.getByTestId('current-ao5')).toHaveText('4.20')
    await expandRow(page, 'ao5')
    await expect(page.getByTestId('stat-target-ao5')).toHaveValue('')
    await page.getByTestId('stat-target-ao5').fill('5.00')
    await page.getByTestId('stat-target-ao5').press('Enter')

    await selectSession(page, 'stats-a')
    await expect(page.getByTestId('current-ao5')).toHaveText('14.00')
    await expect(page.getByTestId('stat-target-ao5')).toHaveValue('14.00')

    await page.reload()
    await expect(page.locator('.scramble-text')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('stat-target-ao5')).toHaveValue('14.00')
    await expect(page.getByTestId('stat-next-ao5')).toHaveText('≤ 15.01')

    const inputAfterReload = page.getByTestId('stat-target-ao5')
    await inputAfterReload.fill('not-a-time')
    await inputAfterReload.blur()
    await expect(page.getByTestId('stat-details-ao5').getByRole('alert')).toContainText(
      'Enter seconds',
    )
    await inputAfterReload.fill('0.01')
    await inputAfterReload.press('Enter')
    await expect(inputAfterReload).toHaveValue('0.01')
    await expect(page.getByTestId('stat-next-ao5')).toHaveText('Not reachable')
  })

  test('updates after penalty changes and deletions without moving Solves', async ({
    page,
  }) => {
    await seed(page)
    await expect(page.getByTestId('current-ao5')).toHaveText('14.00')
    await expect(page.getByTestId('best-ao5')).toHaveText('14.00')

    const first = page.locator('[data-testid="history-row"]').first()
    await first.getByTestId('solve-plus-two').click()
    await expect(page.getByTestId('current-ao5')).toHaveText('14.33')
    await expect(page.getByTestId('best-ao5')).toHaveText('14.33')

    await first.getByTestId('solve-dnf').click()
    await expect(page.getByTestId('current-ao5')).toHaveText('16.33')

    await first.getByTestId('history-main').click()
    const menu = page.getByRole('menu')
    await expect(menu).toBeVisible()
    await menu.getByRole('menuitem', { name: 'Delete solve' }).click()
    await expect(page.getByTestId('current-ao5')).toHaveText('15.00')
    await expect(page.getByTestId('best-ao5')).toHaveText('15.00')
    await expect(page.getByTestId('solve-count')).toHaveText('11')
    await expect(page.getByTestId('history-row').first()).toBeVisible()
  })

  test('keeps the divider and Solves usable with multiple expanded rows', async ({
    page,
  }) => {
    await seed(page)
    await expandRow(page, 'ao5')
    await expandRow(page, 'ao12')
    const divider = page.getByTestId('stats-solves-divider')
    const before = await divider.boundingBox()
    expect(before).not.toBeNull()
    const handle = before!
    await page.mouse.move(
      handle.x + handle.width / 2,
      handle.y + handle.height / 2,
    )
    await page.mouse.down()
    await page.mouse.move(
      handle.x + handle.width / 2,
      handle.y + handle.height / 2 + 60,
      { steps: 6 },
    )
    await page.mouse.up()
    const after = await divider.boundingBox()
    expect(after).not.toBeNull()
    expect(after!.y).toBeGreaterThan(handle.y + 30)
    await expect(page.getByTestId('stat-details-ao5')).toBeVisible()
    await expect(page.getByTestId('stat-details-ao12')).toBeVisible()
    await expect(page.getByTestId('history-row').first()).toBeVisible()
    await expect(page.locator('.history-panel')).toBeVisible()
  })
})

test.describe('statistics responsive layout', () => {
  test('remains usable at 380 px and 320 px without horizontal overflow', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 380, height: 844 })
    await seed(page)
    await expect(page.getByTestId('stat-row-ao5')).toBeVisible()
    await expandRow(page, 'ao5')
    await expect(page.getByTestId('stat-target-ao5')).toBeVisible()
    const width380 = await page.evaluate(() => ({
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
    }))
    expect(width380.document).toBeLessThanOrEqual(width380.viewport + 1)

    await page.setViewportSize({ width: 320, height: 844 })
    await expect(page.getByTestId('stat-row-ao5')).toBeVisible()
    await expect(page.getByTestId('stat-details-ao5')).toBeVisible()
    const width320 = await page.evaluate(() => ({
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
    }))
    expect(width320.document).toBeLessThanOrEqual(width320.viewport + 1)
  })
})
