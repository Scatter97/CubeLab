import { expect, test, type Page } from '@playwright/test'

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
    const overview = page.getByTestId('analytics-overview')
    await expect(overview).toContainText('9')
    await expect(overview).toContainText('10.00')
    await page.getByLabel('Analytics event').selectOption('all')
    await expect(page.getByText('11 matching solves')).toBeVisible()
    await expect(page.getByTestId('analytics-section-sessions')).toContainText(
      'Morning',
    )

    await page.getByLabel('Analytics event').selectOption('222')
    await expect(page.getByText('2 matching solves')).toBeVisible()
    await page.getByTestId('analytics-reset-filters').click()
    await expect(page.getByText('9 matching solves')).toBeVisible()

    await page.getByLabel('Penalty').selectOption('dnf')
    await expect(page.getByText('1 matching solves')).toBeVisible()
    await expect(page.getByTestId('analytics-overview')).toContainText('100.0%')
    await page.getByTestId('analytics-reset-filters').click()

    await page.locator('.analytics-multiselect summary').click()
    await page
      .locator('.analytics-multiselect-menu label')
      .filter({ hasText: 'Evening' })
      .click()
    await expect(page.getByText('6 matching solves')).toBeVisible()
    await page
      .locator('.analytics-multiselect-menu label')
      .filter({ hasText: 'All sessions' })
      .click()
    await page.locator('.analytics-multiselect summary').click()
    await expect(page.getByText('9 matching solves')).toBeVisible()

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
      .getByTestId('analytics-histogram')
      .locator('.analytics-histogram-bar')
      .first()
      .click()
    await expect(page.getByTestId('analytics-explorer-count')).toContainText(
      'solves ·',
    )
    await expect(page.getByTestId('analytics-solve-list')).toBeVisible()
    await page
      .getByTestId('analytics-section-explorer')
      .getByRole('button', { name: 'Clear interval filter' })
      .click()
    await expect(page.getByTestId('analytics-explorer-count')).toContainText(
      '9 solves · newest first',
    )

    await page.getByTestId('analytics-customize-toggle').click()
    const consistencyRow = page
      .locator('.analytics-customize-list li')
      .filter({ hasText: 'Consistency' })
    await consistencyRow.locator('input[type="checkbox"]').first().uncheck()
    await expect(page.getByTestId('analytics-section-consistency')).toBeHidden()
    await page.getByTestId('analytics-customize-toggle').click()

    await page.reload()
    await expect(page.locator('.scramble-text')).toBeVisible({ timeout: 30_000 })
    await page.getByTestId('analytics-nav').click()
    await expect(page.getByTestId('analytics-section-consistency')).toBeHidden()
    await page.getByTestId('analytics-customize-toggle').click()
    await page.getByRole('button', { name: 'Reset layout' }).click()
    await expect(page.getByTestId('analytics-section-consistency')).toBeVisible()
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
    const renderedRows = await page.locator('.analytics-solve-row').count()
    expect(renderedRows).toBeLessThan(40)
    await expect(page.getByTestId('analytics-solve-list')).toBeVisible()
    await page
      .getByRole('button', { name: 'Zoom in on Time progression' })
      .click()
    await expect(page.getByTestId('analytics-progression')).toContainText(
      'of 10,000',
    )
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
    await expect(page.getByTestId('analytics-section-explorer')).toBeVisible()
    await page.getByTestId('analytics-customize-toggle').click()
    await expect(page.getByRole('button', { name: 'Reset layout' })).toBeVisible()
  })
})
