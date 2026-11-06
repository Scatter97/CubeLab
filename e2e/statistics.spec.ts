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

async function seed(page: Page, settings?: Record<string, unknown>) {
  await page.addInitScript(
    ({ payload, storedSettings }) => {
      if (sessionStorage.getItem('cubelab-statistics-seeded')) return
      sessionStorage.setItem('cubelab-statistics-seeded', '1')
      localStorage.setItem('cubelab:sessions:v1', JSON.stringify(payload))
      if (storedSettings) {
        localStorage.setItem(
          'cubelab:settings:v1',
          JSON.stringify({ version: 11, settings: storedSettings }),
        )
      } else {
        localStorage.removeItem('cubelab:settings:v1')
      }
    },
    { payload: sessions, storedSettings: settings },
  )
  await page.goto('/')
  await expect(page.locator('.scramble-text')).toBeVisible({ timeout: 30_000 })
}

async function openSettings(page: Page) {
  await page.getByTestId('settings-button').click()
  return page.getByRole('dialog', { name: 'Settings' })
}

async function enableMetrics(
  page: Page,
  metrics: ReadonlyArray<'current' | 'best' | 'target' | 'bpa' | 'wpa'>,
) {
  const settings = await openSettings(page)
  for (const key of ['current', 'best', 'target', 'bpa', 'wpa'] as const) {
    const checkbox = settings.getByTestId(`stat-metric-${key}`)
    if (metrics.includes(key)) await checkbox.check()
    else await checkbox.uncheck()
  }
  await settings.getByTestId('settings-done').click()
}

const allMetrics = ['current', 'best', 'target', 'bpa', 'wpa'] as const

test.describe('statistics panel', () => {
  test('stays between Sessions and Solves and shows Current and Best without expansion', async ({
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
      await expect(page.getByTestId(`current-${key}`)).toBeVisible()
      await expect(page.getByTestId(`best-${key}`)).toBeVisible()
    }
    await expect(page.getByTestId('current-ao5')).toHaveText('14.00')
    await expect(page.getByTestId('best-ao5')).toHaveText('14.00')

    // Defaults keep the optional metrics out of the panel.
    await expect(page.getByTestId('target-ao5')).toHaveCount(0)
    await expect(page.getByTestId('bpa-ao5')).toHaveCount(0)
    await expect(page.getByTestId('wpa-ao5')).toHaveCount(0)
    await expect(page.locator('.stat-chevron')).toHaveCount(0)
    await expect(page.getByTestId('stat-row-ao5')).not.toHaveAttribute(
      'aria-expanded',
      /.*/,
    )
    await expect(page.getByTestId('stat-target-ao5')).toHaveCount(0)
    await expect(page.locator('.stats-panel [role="menu"]')).toHaveCount(0)
  })

  test('enables all metrics inline, calculates the PB target and persists visibility', async ({
    page,
  }) => {
    await seed(page)
    await enableMetrics(page, allMetrics)

    await expect(page.getByTestId('current-ao5')).toHaveText('14.00')
    await expect(page.getByTestId('best-ao5')).toHaveText('14.00')
    await expect(page.getByTestId('bpa-ao5')).toHaveText('13.00')
    await expect(page.getByTestId('wpa-ao5')).toHaveText('15.67')
    // Strictly faster than the 14.00 ao5 PB; 14.99 would tie it.
    await expect(page.getByTestId('target-ao5')).toHaveText('14.98')
    await expect(page.getByTestId('target-ao5')).toHaveAttribute(
      'aria-label',
      /Maximum next result for a new ao5 best/,
    )
    await expect(page.getByTestId('target-single')).toHaveText('11.99')
    await expect(page.getByTestId('bpa-single')).toHaveCount(0)
    await expect(page.getByTestId('wpa-single')).toHaveCount(0)

    await expect
      .poll(() =>
        page.evaluate(() => {
          const raw = localStorage.getItem('cubelab:settings:v1')
          if (!raw) return null
          const parsed = JSON.parse(raw) as {
            version: number
            settings: { statMetricVisibility: Record<string, boolean> }
          }
          return {
            version: parsed.version,
            metrics: parsed.settings.statMetricVisibility,
          }
        }),
      )
      .toEqual({
        version: 11,
        metrics: {
          current: true,
          best: true,
          target: true,
          bpa: true,
          wpa: true,
        },
      })

    await page.reload()
    await expect(page.locator('.scramble-text')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('target-ao5')).toHaveText('14.98')
    await expect(page.getByTestId('bpa-ao5')).toHaveText('13.00')
    await expect(page.getByTestId('wpa-ao5')).toHaveText('15.67')
  })

  test('updates Current, Best and Target after penalties and deletions', async ({
    page,
  }) => {
    await seed(page)
    await enableMetrics(page, ['current', 'best', 'target'])
    await expect(page.getByTestId('current-ao5')).toHaveText('14.00')
    await expect(page.getByTestId('best-ao5')).toHaveText('14.00')
    const initialTarget = await page.getByTestId('target-ao5').textContent()

    const first = page.locator('[data-testid="history-row"]').first()
    await first.getByTestId('solve-plus-two').click()
    await expect(page.getByTestId('current-ao5')).toHaveText('14.33')
    await expect(page.getByTestId('best-ao5')).toHaveText('14.33')
    await expect(page.getByTestId('target-ao5')).not.toHaveText(initialTarget!)

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

  test('keeps metric and average-row visibility independent per event', async ({
    page,
  }) => {
    await seed(page)
    await enableMetrics(page, ['best', 'target'])
    await expect(page.getByTestId('current-ao5')).toHaveCount(0)
    await expect(page.getByTestId('best-ao5')).toHaveText('14.00')
    await expect(page.getByTestId('target-ao5')).toHaveText('14.98')

    await selectSession(page, 'stats-b')
    await expect(page.getByTestId('best-ao5')).toHaveText('4.20')
    await expect(page.getByTestId('target-ao5')).toHaveText('4.28')

    const settings = await openSettings(page)
    await settings.getByTestId('stat-visible-ao5').uncheck()
    await settings.getByTestId('settings-done').click()
    await expect(page.getByTestId('stat-row-ao5')).toHaveCount(0)
    await expect(page.getByTestId('best-ao12')).toBeVisible()
    await expect(page.getByTestId('target-ao12')).toBeVisible()
  })

  test('shows dash and N/A target states honestly', async ({ page }) => {
    await seed(page, {
      inspectionEnabled: false,
      statMetricVisibility: {
        current: true,
        best: true,
        target: true,
        bpa: false,
        wpa: false,
      },
    })
    await page.evaluate(() => {
      const key = 'cubelab:sessions:v1'
      const data = JSON.parse(localStorage.getItem(key)!)
      const session = data.sessions.find(
        (item: { id: string }) => item.id === data.activeSessionId,
      )
      session.solves = session.solves.slice(0, 4)
      localStorage.setItem(key, JSON.stringify(data))
    })
    await page.reload()
    await expect(page.locator('.scramble-text')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('target-ao5')).toHaveText('—')

    await page.evaluate(() => {
      const key = 'cubelab:sessions:v1'
      const data = JSON.parse(localStorage.getItem(key)!)
      const session = data.sessions.find(
        (item: { id: string }) => item.id === data.activeSessionId,
      )
      session.solves = Array.from({ length: 5 }, (_, index) => ({
        id: `tie-${index}`,
        event: '333',
        rawMs: 10_000,
        penalty: 'none',
        scramble: "R U R'",
        comment: '',
        createdAt: Date.now() - index * 1000,
      }))
      localStorage.setItem(key, JSON.stringify(data))
    })
    await page.reload()
    await expect(page.locator('.scramble-text')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('target-ao5')).toHaveText('N/A')
  })

  test('ignores legacy editable targets without losing stored data', async ({
    page,
  }) => {
    await seed(page, {
      inspectionEnabled: false,
      statMetricVisibility: {
        current: true,
        best: true,
        target: true,
        bpa: false,
        wpa: false,
      },
      statTargetsMs: { '333': { ao5: 9_000 } },
    })
    await expect(page.getByTestId('target-ao5')).toHaveText('14.98')
    await expect(page.getByTestId('stat-target-ao5')).toHaveCount(0)
    await expect
      .poll(() =>
        page.evaluate(() => {
          const raw = localStorage.getItem('cubelab:settings:v1')
          return raw
            ? (JSON.parse(raw) as { settings: { statTargetsMs: unknown } })
                .settings.statTargetsMs
            : null
        }),
      )
      .toEqual({ '333': { ao5: 9_000 } })
  })

  test('keeps the divider and Solves usable with every metric enabled', async ({
    page,
  }) => {
    await seed(page)
    await enableMetrics(page, allMetrics)
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
    await expect(page.getByTestId('target-ao5')).toBeVisible()
    await expect(page.getByTestId('bpa-ao5')).toBeVisible()
    await expect(page.getByTestId('wpa-ao5')).toBeVisible()
    await expect(page.getByTestId('history-row').first()).toBeVisible()
    await expect(page.locator('.history-panel')).toBeVisible()
  })
})

test.describe('statistics responsive layout', () => {
  test('remains usable at 390 px and 320 px without horizontal overflow', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await seed(page)
    await enableMetrics(page, allMetrics)
    const width390 = await page.evaluate(() => ({
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
      panel: document.querySelector('.stats-panel')!.scrollWidth,
      panelClient: document.querySelector('.stats-panel')!.clientWidth,
    }))
    expect(width390.document).toBeLessThanOrEqual(width390.viewport + 1)
    expect(width390.panel).toBeLessThanOrEqual(width390.panelClient + 1)
    await expect(page.getByTestId('stat-row-ao5')).toBeVisible()
    await expect(page.getByTestId('target-ao5')).toBeVisible()

    await page.setViewportSize({ width: 320, height: 844 })
    await expect(page.getByTestId('stat-row-ao5')).toBeVisible()
    await expect(page.getByTestId('target-ao5')).toBeVisible()
    const width320 = await page.evaluate(() => ({
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
      panel: document.querySelector('.stats-panel')!.scrollWidth,
      panelClient: document.querySelector('.stats-panel')!.clientWidth,
    }))
    expect(width320.document).toBeLessThanOrEqual(width320.viewport + 1)
    expect(width320.panel).toBeLessThanOrEqual(width320.panelClient + 1)
  })

  test('uses readable target colors in light and dark themes', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await seed(page)
    await enableMetrics(page, ['current', 'best', 'target'])
    const target = page.getByTestId('target-ao5')
    const light = await target.evaluate((node) => getComputedStyle(node).color)
    await page.getByTestId('settings-button').click()
    const settings = page.getByRole('dialog', { name: 'Settings' })
    await settings.getByTestId('theme-setting').click()
    await page.getByRole('option', { name: 'Dark' }).click()
    await settings.getByTestId('settings-done').click()
    const dark = await target.evaluate((node) => getComputedStyle(node).color)
    expect(light).not.toBe(dark)
    await expect(target).toBeVisible()
  })
})
