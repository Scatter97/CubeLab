import { expect, test, type Page } from '@playwright/test'
import {
  chooseTestOption,
} from './interactions'

const NOW = Date.now()
const DAY = 86_400_000

interface SeedSolve {
  id: string
  event: '333' | '222'
  rawMs: number
  penalty: 'none' | '+2' | 'dnf'
  scramble: string
  comment: string
  createdAt: number
}

function session(
  id: string,
  name: string,
  event: '333' | '222',
  solves: SeedSolve[],
) {
  return {
    id,
    name,
    event,
    createdAt: NOW - 30 * DAY,
    updatedAt: NOW,
    solves,
  }
}

function solve(
  id: string,
  rawMs: number,
  offsetMs: number,
  event: '333' | '222' = '333',
  penalty: SeedSolve['penalty'] = 'none',
): SeedSolve {
  return {
    id,
    event,
    rawMs,
    penalty,
    scramble: "R U R' U' F2 L D B2",
    comment: id.endsWith('3') ? 'Synthetic analytics solve' : '',
    createdAt: NOW + offsetMs,
  }
}

const sessions = {
  version: 4,
  activeSessionId: 'analytics-a',
  sessions: [
    session('analytics-a', 'Morning', '333', [
      solve('a6', 13_000, -1_000),
      solve('a5', 12_000, -2_000, '333', 'dnf'),
      solve('a4', 11_500, -3_000, '333', '+2'),
      solve('a3', 11_000, -12 * DAY),
      solve('a2', 10_500, -20 * DAY),
      solve('a1', 10_000, -40 * DAY),
    ]),
    session('analytics-b', 'Evening', '333', [
      solve('b3', 21_000, -1_500),
      solve('b2', 20_000, -2_500),
      solve('b1', 19_000, -10 * DAY),
    ]),
    session('analytics-c', 'Two by two', '222', [
      solve('c2', 4_000, -2_000, '222', '+2'),
      solve('c1', 3_500, -6_000, '222'),
    ]),
  ],
}

async function seed(page: Page, data: unknown = sessions) {
  await page.addInitScript((payload) => {
    // Seed once per browser context. A plain addInitScript also runs on reload,
    // which would erase settings the test intentionally changed before reload.
    if (sessionStorage.getItem('cubelab-analytics-seeded')) return
    sessionStorage.setItem('cubelab-analytics-seeded', '1')
    localStorage.setItem('cubelab:sessions:v1', JSON.stringify(payload))
    localStorage.removeItem('cubelab:settings:v1')
  }, data)
}

async function openAnalytics(page: Page) {
  await page.goto('/')
  await expect(page.locator('.scramble-text')).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('analytics-nav').click()
  await expect(
    page.getByRole('heading', { name: 'Analytics', exact: true }),
  ).toBeVisible()
}

test.describe('analytics dashboard', () => {
  test('filters, compares, drills down, customizes and persists layout', async ({
    page,
  }) => {
    await seed(page)
    await openAnalytics(page)

    await expect(page.getByText('9 matching solves')).toBeVisible()
    await expect(page.getByTestId('app-version')).toHaveText(
      /^\d+\.\d{2}\.\d{6}:\d+$/,
    )
    const overview = page.getByTestId('analytics-overview')
    await expect(overview).toContainText('9')
    await expect(overview).toContainText('10.00')
    await chooseTestOption(page, 'analytics-event', 'all')
    await expect(page.getByText('11 matching solves')).toBeVisible()

    await chooseTestOption(page, 'analytics-event', '222')
    await expect(page.getByText('2 matching solves')).toBeVisible()
    await page.getByTestId('analytics-reset-filters').click()
    await expect(page.getByText('9 matching solves')).toBeVisible()

    await chooseTestOption(page, 'analytics-penalty', 'dnf')
    await expect(page.getByText('1 matching solves')).toBeVisible()
    await expect(page.getByTestId('analytics-overview')).toContainText('100.0%')
    await page.getByTestId('analytics-reset-filters').click()

    await page.getByTestId('analytics-sessions-trigger').click()
    await page
      .locator('.analytics-multiselect-row')
      .filter({ hasText: 'Evening' })
      .click()
    await expect(page.getByText('6 matching solves')).toBeVisible()
    await page
      .locator('.analytics-multiselect-row')
      .filter({ hasText: 'All sessions' })
      .click()
    await expect(page.getByText('9 matching solves')).toBeVisible()
    await expect(
      page.locator('.analytics-multiselect-row').first(),
    ).toContainText('2 sessions')
    await expect(
      page.locator('.analytics-multiselect-row').filter({ hasText: 'Morning' }),
    ).toContainText('6 solves')
    await page.getByTestId('analytics-sessions-trigger').click()
    await expect(
      page.getByTestId('analytics-sessions-trigger'),
    ).toHaveAttribute('aria-expanded', 'false')

    const progression = page.getByTestId('analytics-progression')
    const plot = progression.locator('.analytics-chart-plot')
    await plot.scrollIntoViewIfNeeded()
    const box = await plot.boundingBox()
    expect(box).not.toBeNull()
    await page.mouse.move(box!.x + box!.width * 0.6, box!.y + box!.height * 0.5)
    await expect(
      progression.getByTestId('analytics-chart-tooltip'),
    ).toBeVisible()
    await page.mouse.click(box!.x + box!.width * 0.6, box!.y + box!.height * 0.5)
    const solveDialog = page.getByTestId('analytics-solve-dialog')
    await expect(solveDialog).toBeVisible()
    await expect(solveDialog).toContainText('Scramble')
    await solveDialog.getByRole('button', { name: 'Close solve details' }).click()
    await expect(solveDialog).toBeHidden()

    await page
      .getByRole('tab', { name: 'Solve time distribution' })
      .click()
    await page
      .getByTestId('analytics-histogram')
      .locator('.analytics-histogram-bar')
      .first()
      .click()
    const solveList = page.getByTestId('analytics-solve-list-dialog')
    await expect(solveList).toBeVisible()
    await expect(page.getByTestId('analytics-solve-list')).toBeVisible()
    await solveList.getByRole('button', { name: 'Close solve list' }).click()
    await page
      .getByTestId('analytics-section-distribution')
      .getByRole('button', { name: 'Clear interval filter' })
      .click()
    await page.getByTestId('analytics-view-solves').click()
    await expect(page.getByTestId('analytics-solve-list-dialog')).toContainText(
      '9 solves',
    )
    await page.getByRole('button', { name: 'Close solve list' }).click()

    await page.getByTestId('analytics-customize-toggle').click()
    const consistencyRow = page
      .locator('.analytics-customize-list li')
      .filter({ hasText: 'Consistency' })
    await consistencyRow.locator('input[type="checkbox"]').first().uncheck()
    await expect(
      page.getByRole('tab', { name: 'Consistency' }),
    ).toBeHidden()
    await page.getByTestId('analytics-customize-toggle').click()

    await page.reload()
    await expect(page.locator('.scramble-text')).toBeVisible({ timeout: 30_000 })
    await page.getByTestId('analytics-nav').click()
    await expect(
      page.getByRole('tab', { name: 'Consistency' }),
    ).toBeHidden()
    await page.getByTestId('analytics-customize-toggle').click()
    await page.getByRole('button', { name: 'Reset layout' }).click()
    await expect(
      page.getByRole('tab', { name: 'Consistency' }),
    ).toBeVisible()
  })

  test('does not route timer keys while analytics is open', async ({ page }) => {
    await seed(page)
    await openAnalytics(page)
    await page.keyboard.press('Space')
    await expect(page.getByTestId('analytics-nav')).toBeEnabled()
    await page.getByRole('button', { name: 'Timer' }).click()
    await expect(page.locator('[data-testid="timer-surface"]')).toHaveAttribute(
      'data-phase',
      'idle',
    )
  })

  test('remains usable with a large synthetic history', async ({ page }) => {
    const solves: SeedSolve[] = []
    const start = NOW - 10_000 * 60_000
    for (let index = 0; index < 10_000; index += 1) {
      solves.push(
        solve(
          `large-${index}`,
          9_000 + (index % 8_000),
          start + index * 60_000,
          '333',
          index % 1_000 === 0 ? 'dnf' : 'none',
        ),
      )
    }
    await seed(page, {
      version: 4,
      activeSessionId: 'large',
      sessions: [session('large', 'Large history', '333', solves.reverse())],
    })
    await openAnalytics(page)
    await expect(page.getByText('10,000 matching solves')).toBeVisible()
    await expect(page.getByTestId('analytics-overview')).toContainText('10,000')
    await page.getByTestId('analytics-view-solves').click()
    const renderedRows = await page.locator('.analytics-solve-row').count()
    expect(renderedRows).toBeLessThan(40)
    await expect(page.getByTestId('analytics-solve-list')).toBeVisible()
    await page.getByRole('button', { name: 'Close solve list' }).click()
    await page.getByRole('tab', { name: 'Time progression' }).click()
    const controls = page.getByRole('group', {
      name: 'Time progression view controls',
    })
    await expect(controls).toBeVisible()
    await controls
      .getByRole('button', { name: 'Zoom in on Time progression' })
      .click()
    await expect(page.getByTestId('analytics-progression')).toContainText(
      'of 10,000',
    )
    await expect(
      controls.getByRole('button', { name: 'Reset Time progression view' }),
    ).toBeEnabled()
    await controls
      .getByRole('button', { name: 'Reset Time progression view' })
      .click()
    await expect(
      controls.getByRole('button', { name: 'Zoom out of Time progression' }),
    ).toBeDisabled()
  })
})

test.describe('analytics responsive layout', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('stacks sections without horizontal overflow on mobile', async ({
    page,
  }) => {
    await seed(page)
    await openAnalytics(page)
    const metrics = await page.evaluate(() => {
      const pageElement = document.querySelector<HTMLElement>('.analytics-page')
      const sections = Array.from(
        document.querySelectorAll<HTMLElement>('.analytics-section'),
      )
      return {
        viewport: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        pageWidth: pageElement?.clientWidth ?? 0,
        widestSection: Math.max(...sections.map((section) => section.scrollWidth)),
      }
    })
    expect(metrics.viewport).toBe(390)
    expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewport + 1)
    expect(metrics.widestSection).toBeLessThanOrEqual(metrics.pageWidth + 1)
    await expect(page.getByTestId('analytics-section-overview')).toBeVisible()
    await expect(page.getByTestId('analytics-analysis-select')).toContainText(
      'Time progression',
    )

    const filtersToggle = page.getByTestId('analytics-filters-toggle')
    await expect(filtersToggle).toBeVisible()
    await expect(filtersToggle).toContainText('1 active')
    await expect(page.locator('.analytics-filters')).toBeHidden()
    await filtersToggle.click()
    await expect(page.locator('.analytics-filters')).toBeVisible()
    await expect(filtersToggle).toHaveAttribute('aria-expanded', 'true')
    await chooseTestOption(page, 'analytics-analysis-select', 'subX')
    await expect(page.getByTestId('analytics-section-subX')).toBeVisible()
    await expect(page.getByTestId('analytics-subx-table-scroll')).toBeVisible()

    const eventTrigger = page.getByTestId('analytics-event')
    await eventTrigger.click()
    const menuBox = await page.getByRole('listbox', {
      name: 'Analytics event',
    }).boundingBox()
    expect(menuBox).not.toBeNull()
    expect(menuBox!.x).toBeGreaterThanOrEqual(0)
    expect(menuBox!.y).toBeGreaterThanOrEqual(0)
    expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(391)
    expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(845)
    await page.keyboard.press('Escape')
    await expect(eventTrigger).toHaveAttribute('aria-expanded', 'false')
    await expect(eventTrigger).toBeFocused()
    await page.getByTestId('analytics-customize-toggle').click()
    await expect(page.getByRole('button', { name: 'Reset layout' })).toBeVisible()
  })
})

test.describe('analytics controls', () => {
  test('orders filters event, sessions, date, last solves and penalty', async ({
    page,
  }) => {
    await seed(page)
    await openAnalytics(page)

    const order = await page.evaluate(() =>
      Array.from(
        document.querySelectorAll(
          '#analytics-filters [data-testid="analytics-event"], #analytics-filters [data-testid="analytics-sessions-trigger"], #analytics-filters [data-testid="analytics-date-range"], #analytics-filters [data-testid="analytics-solve-limit"], #analytics-filters [data-testid="analytics-penalty"]',
        ),
      ).map((element) => element.getAttribute('data-testid')),
    )
    expect(order).toEqual([
      'analytics-event',
      'analytics-sessions-trigger',
      'analytics-date-range',
      'analytics-solve-limit',
      'analytics-penalty',
    ])
  })

  test('aligns session filter rows and keeps keyboard focus behavior', async ({
    page,
  }) => {
    await seed(page)
    await openAnalytics(page)

    const trigger = page.getByTestId('analytics-sessions-trigger')
    await trigger.click()
    const metrics = await page.evaluate(() => {
      const row = document.querySelector<HTMLElement>(
        '.analytics-multiselect-row',
      )!
      const input = row.querySelector('input')!.getBoundingClientRect()
      const name = row
        .querySelector<HTMLElement>('.analytics-multiselect-name')!
        .getBoundingClientRect()
      const meta = row
        .querySelector<HTMLElement>('.analytics-multiselect-meta')!
        .getBoundingClientRect()
      const bounds = row.getBoundingClientRect()
      return {
        height: bounds.height,
        centerDelta: Math.abs(
          input.top + input.height / 2 - (name.top + name.height / 2),
        ),
        metaDelta: Math.abs(
          input.top + input.height / 2 - (meta.top + meta.height / 2),
        ),
        inputLeft: input.left - bounds.left,
        metaRight: bounds.right - meta.right,
      }
    })
    expect(metrics.height).toBeLessThan(42)
    expect(metrics.centerDelta).toBeLessThan(3)
    expect(metrics.metaDelta).toBeLessThan(3)
    expect(metrics.inputLeft).toBeLessThan(12)
    expect(metrics.metaRight).toBeLessThan(14)

    await trigger.click()
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await trigger.focus()
    await page.keyboard.press('Enter')
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Space')
    await expect(page.getByText('3 matching solves')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await expect(trigger).toBeFocused()

    await trigger.click()
    await page.locator('.analytics-heading h1').click()
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await expect(page.getByText('3 matching solves')).toBeVisible()
  })

  test('accepts precise Sub-X values and presets and persists them', async ({
    page,
  }) => {
    await seed(page)
    await openAnalytics(page)
    await page.getByRole('tab', { name: 'Sub-X analysis' }).click()
    const input = page.getByTestId('sub-x-target')
    await expect(page.getByRole('button', { name: 'Sub-20' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await input.fill('12.345')
    await input.press('Enter')
    await expect(input).toHaveValue('12.345')
    const storedTarget = await page.evaluate(() => {
      const raw = localStorage.getItem('cubelab:settings:v1')
      return raw
        ? (
            JSON.parse(raw) as {
              settings: { analytics: { subXTargetsMs: Record<string, number> } }
            }
          ).settings.analytics.subXTargetsMs['333']
        : null
    })
    expect(storedTarget).toBe(12_345)

    await page.reload()
    await expect(page.locator('.scramble-text')).toBeVisible({ timeout: 30_000 })
    await page.getByTestId('analytics-nav').click()
    await page.getByRole('tab', { name: 'Sub-X analysis' }).click()
    await expect(page.getByTestId('sub-x-target')).toHaveValue('12.345')

    const reloaded = page.getByTestId('sub-x-target')
    await reloaded.fill('not-a-time')
    await reloaded.blur()
    await expect(page.getByRole('alert')).toContainText(
      'Enter seconds with up to three decimal places',
    )
    await expect(reloaded).toHaveAttribute('aria-invalid', 'true')
    await page.getByRole('button', { name: 'Sub-15' }).click()
    await expect(page.getByTestId('sub-x-target')).toHaveValue('15')
  })

  test('keeps extreme solves visible without compressing the main histogram', async ({
    page,
  }) => {
    const normal = Array.from({ length: 120 }, (_, index) =>
      solve(`normal-${index}`, 10_000 + index * 40, -index * 1_000),
    )
    await seed(page, {
      version: 4,
      activeSessionId: 'long',
      sessions: [session('long', 'Long outlier set', '333', [
        solve('extreme', 600_000, -50_000),
        ...normal,
      ])],
    })
    await openAnalytics(page)
    await page.getByRole('tab', { name: 'Solve time distribution' }).click()
    const bars = page
      .getByTestId('analytics-histogram')
      .locator('.analytics-histogram-bar')
    expect(await bars.count()).toBeLessThanOrEqual(20)
    await expect(page.getByTestId('analytics-section-distribution')).toContainText(
      'central 98%',
    )
    await bars.last().click()
    const listDialog = page.getByTestId('analytics-solve-list-dialog')
    await expect(listDialog).toContainText('1 solve')
    await expect(page.getByTestId('analytics-solve-list')).toContainText(
      '10:00.00',
    )
  })

  test('shows the full multi-year heatmap range and year-aware date axis', async ({
    page,
  }) => {
    await seed(page, {
      version: 4,
      activeSessionId: 'years',
      sessions: [
        session('years', 'Multi-year history', '333', [
          solve('old', 12_000, new Date(2025, 8, 18, 12).getTime() - NOW),
          solve('middle', 11_000, new Date(2026, 0, 5, 12).getTime() - NOW),
          solve('new', 10_000, new Date(2026, 10, 3, 12).getTime() - NOW),
        ]),
      ],
    })
    await openAnalytics(page)
    await page.getByRole('tab', { name: 'Practice activity' }).click()

    const range = page.getByTestId('activity-heatmap-range')
    await expect(range).toContainText('2025')
    await expect(range).toContainText('2026')
    await expect(
      page.locator('.analytics-heatmap tbody tr'),
    ).toHaveCount(7)
    await expect(
      page.getByRole('img', { name: /2025.*1 solve/ }).first(),
    ).toBeVisible()
    await expect(page.getByTestId('analytics-activity-chart')).toContainText(
      '2025',
    )
    await expect(page.getByTestId('analytics-activity-chart')).toContainText(
      '2026',
    )
  })

  test('keeps every Sub-X session reachable with sticky headings and a resizable split', async ({
    page,
  }) => {
    const subXSessions = Array.from({ length: 24 }, (_, index) =>
      session(
        `subx-${index}`,
        `Long practice session ${index} with an extended descriptive name`,
        '333',
        [
          solve(`subx-${index}-a`, 12_000 + index, -index * 1_000),
          solve(`subx-${index}-b`, 13_000 + index, -index * 1_000 - 500),
        ],
      ),
    )
    await seed(page, {
      version: 4,
      activeSessionId: 'subx-0',
      sessions: subXSessions,
    })
    await page.setViewportSize({ width: 1440, height: 900 })
    await openAnalytics(page)
    await page.getByRole('tab', { name: 'Sub-X analysis' }).click()

    const scroll = page.getByTestId('analytics-subx-table-scroll')
    await expect(scroll).toBeVisible()
    await expect(scroll.locator('tbody tr')).toHaveCount(24)
    await expect(scroll).toContainText('Long practice session 0')
    const scrollMetrics = await scroll.evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      headerPosition: getComputedStyle(
        element.querySelector('thead th')!,
      ).position,
    }))
    expect(scrollMetrics.scrollHeight).toBeGreaterThan(scrollMetrics.clientHeight)
    expect(scrollMetrics.headerPosition).toBe('sticky')

    const divider = page.getByTestId('analytics-subx-divider')
    await divider.focus()
    const before = Number(await divider.getAttribute('aria-valuenow'))
    await page.keyboard.press('ArrowDown')
    await expect(divider).toHaveAttribute(
      'aria-valuenow',
      String(before + 3),
    )
    await page.keyboard.press('Home')
    await expect(divider).toHaveAttribute('aria-valuenow', '38')
    const chartHeight = await page
      .getByTestId('analytics-subx')
      .boundingBox()
      .then((box) => box?.height ?? 0)
    expect(chartHeight).toBeGreaterThan(130)
    await expect(page.getByTestId('analytics-subx-table-pane')).toBeVisible()
  })
})

test.describe('analytics session selection states', () => {
  test('handles all, none, partial and individual selections with an empty state', async ({
    page,
  }) => {
    await seed(page)
    await openAnalytics(page)
    await page.getByTestId('analytics-sessions-trigger').click()

    const all = page.getByTestId('analytics-sessions-all')
    const morning = page.getByTestId('analytics-session-option-analytics-a')
    const evening = page.getByTestId('analytics-session-option-analytics-b')
    await expect(all).toBeChecked()
    await expect(page.getByText('9 matching solves')).toBeVisible()

    await evening.click()
    await expect(page.getByText('6 matching solves')).toBeVisible()
    await expect(all).not.toBeChecked()
    expect(await all.evaluate((input) => (input as HTMLInputElement).indeterminate)).toBe(true)
    await expect(all).toHaveAttribute('aria-checked', 'mixed')

    await all.click()
    await expect(page.getByText('9 matching solves')).toBeVisible()
    await expect(all).toBeChecked()
    expect(await all.evaluate((input) => (input as HTMLInputElement).indeterminate)).toBe(false)

    await all.click()
    await expect(page.getByText('0 matching solves')).toBeVisible()
    await expect(page.getByTestId('analytics-no-sessions')).toBeVisible()
    await expect(all).not.toBeChecked()
    await expect(morning).not.toBeChecked()
    await expect(evening).not.toBeChecked()

    await morning.click()
    await expect(page.getByText('6 matching solves')).toBeVisible()
    await expect(morning).toBeChecked()
    await expect(all).not.toBeChecked()
    expect(await all.evaluate((input) => (input as HTMLInputElement).indeterminate)).toBe(true)

    await evening.click()
    await expect(page.getByText('9 matching solves')).toBeVisible()
    await expect(all).toBeChecked()

    await morning.click()
    await evening.click()
    await expect(page.getByText('0 matching solves')).toBeVisible()
    await expect(page.getByTestId('analytics-no-sessions')).toBeVisible()
    await page.getByTestId('analytics-select-all-sessions').click()
    await expect(page.getByText('9 matching solves')).toBeVisible()
    await page.getByTestId('analytics-sessions-trigger').click()
    await expect(all).toBeChecked()
  })
})

test.describe('analytics desktop fit', () => {
  test('fits the page to the viewport and keeps long tables internally scrollable', async ({
    page,
  }) => {
    for (const [width, height] of [
      [1280, 720],
      [1440, 900],
    ] as const) {
      await page.setViewportSize({ width, height })
      await seed(page)
      await openAnalytics(page)

      const metrics = await page.evaluate(() => {
        const pageElement = document.querySelector<HTMLElement>('.analytics-page')!
        const layout = document.querySelector<HTMLElement>('.analytics-analysis-layout')!
        const plot = document.querySelector<HTMLElement>('.analytics-chart-plot')!
        return {
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          documentWidth: document.documentElement.scrollWidth,
          documentHeight: document.documentElement.scrollHeight,
          pageClientHeight: pageElement.clientHeight,
          pageScrollHeight: pageElement.scrollHeight,
          pageBottom: pageElement.getBoundingClientRect().bottom,
          layoutBottom: layout.getBoundingClientRect().bottom,
          plotHeight: plot.getBoundingClientRect().height,
        }
      })
      expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1)
      expect(metrics.documentHeight).toBeLessThanOrEqual(metrics.viewportHeight + 1)
      expect(metrics.pageScrollHeight).toBeLessThanOrEqual(metrics.pageClientHeight + 1)
      expect(metrics.layoutBottom).toBeLessThanOrEqual(metrics.pageBottom + 1)
      expect(metrics.plotHeight).toBeGreaterThan(120)
      await expect(page.getByTestId('analytics-section-overview')).toBeVisible()
      await expect(page.locator('.analytics-filters')).toBeVisible()
      await expect(page.getByRole('tab', { name: 'Time progression' })).toBeVisible()
    }

    await page.setViewportSize({ width: 1280, height: 720 })
    await page.getByRole('tab', { name: 'Historical personal bests' }).click()
    await expect(
      page.getByRole('heading', { name: 'Historical personal bests' }),
    ).toBeVisible()
    await expect(page.getByTestId('analytics-section-personalBests')).toBeVisible()
    const scrollInfo = await page
      .locator('.analytics-analysis-content .analytics-chart-stack')
      .evaluate((element) => ({
        overflowY: getComputedStyle(element).overflowY,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
      }))
    expect(scrollInfo.overflowY).toBe('auto')
    expect(scrollInfo.scrollHeight).toBeGreaterThanOrEqual(scrollInfo.clientHeight)

    const stack = page.locator('.analytics-analysis-content .analytics-chart-stack')
    await stack.evaluate((element) => {
      element.scrollTop = element.scrollHeight
    })
    const lastRow = page
      .getByTestId('analytics-section-personalBests')
      .locator('table')
      .last()
      .locator('tbody tr')
      .last()
    await expect(lastRow).toBeVisible()
    const lastRowBox = await lastRow.boundingBox()
    const panelBox = await page
      .getByTestId('analytics-analysis-panel')
      .boundingBox()
    expect(lastRowBox).not.toBeNull()
    expect(panelBox).not.toBeNull()
    expect(lastRowBox!.y + lastRowBox!.height).toBeLessThanOrEqual(
      panelBox!.y + panelBox!.height + 1,
    )
  })

  test('remains navigable at increased interface zoom without horizontal overflow', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await seed(page)
    await page.goto('/')
    await expect(page.locator('.scramble-text')).toBeVisible({ timeout: 30_000 })
    const settings = await page.getByTestId('settings-button').click().then(async () => {
      const dialog = page.getByRole('dialog', { name: 'Settings' })
      await expect(dialog).toBeVisible()
      return dialog
    })
    await chooseTestOption(page, 'ui-zoom', '150')
    await settings.getByTestId('settings-done').click()
    await page.getByTestId('analytics-nav').click()
    await expect(page.getByRole('heading', { name: 'Analytics', exact: true })).toBeVisible()

    const metrics = await page.evaluate(() => {
      const pageElement = document.querySelector<HTMLElement>('.analytics-page')!
      const nav = document.querySelector<HTMLElement>('.analytics-analysis-nav')!
      const chart = document.querySelector<HTMLElement>('.analytics-chart-plot')!
      return {
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        pageWidth: pageElement.getBoundingClientRect().width,
        pageOverflow: getComputedStyle(pageElement).overflowY,
        navVisible: nav.getBoundingClientRect().height > 0,
        chartHeight: chart.getBoundingClientRect().height,
      }
    })
    expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1)
    expect(metrics.pageWidth).toBeLessThanOrEqual(metrics.viewportWidth + 1)
    expect(metrics.pageOverflow).toBe('auto')
    expect(metrics.navVisible).toBe(true)
    expect(metrics.chartHeight).toBeGreaterThan(90)
    await expect(page.getByRole('tab', { name: 'Sub-X analysis' })).toBeVisible()
    await page.getByRole('tab', { name: 'Sub-X analysis' }).click()
    await expect(page.getByTestId('analytics-subx-table-scroll')).toBeVisible()
    await expect(page.getByTestId('analytics-subx-split')).toBeVisible()
  })
})
