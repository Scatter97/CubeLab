import { test, expect, type Page } from '@playwright/test'
import { chooseTestOption } from './interactions'

// Also run against Vite to exercise development Strict Mode, not just production.
if (process.env.CUBELAB_TEST_URL) test.use({ baseURL: process.env.CUBELAB_TEST_URL })

async function openSettings(page: Page) {
  await page.getByTestId('settings-button').click()
  return page.getByRole('dialog', { name: 'Settings' })
}

async function enableAllStats(page: Page) {
  const settings = await openSettings(page)
  const boxes = settings.locator('[data-testid^="stat-visible-"]')
  for (let i = 0; i < (await boxes.count()); i++) await boxes.nth(i).check()
  await settings.getByTestId('settings-done').click()
  await page.evaluate(() => document.fonts.ready)
}

async function setMetrics(
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

async function statsGeometry(page: Page) {
  return page.locator('.stats-panel').evaluate((panel) => {
    const scroll = panel.querySelector<HTMLElement>('.stats-scroll')!
    const measure = panel.querySelector<HTMLElement>('.stats-panel-measure')!
    const rows = [
      ...scroll.querySelectorAll<HTMLElement>('[data-testid^="stat-row-"]'),
    ]
    const panelRect = panel.getBoundingClientRect()
    const scrollRect = scroll.getBoundingClientRect()
    const measureRect = measure.getBoundingClientRect()
    const failures: string[] = []
    const epsilon = 1.5
    if (panelRect.height < measureRect.height - epsilon) {
      // Only valid when the viewport cannot fit both panel minimums.
    }
    if (scroll.scrollWidth > scroll.clientWidth + epsilon) {
      failures.push('statistics overflow horizontally')
    }
    const canFit = panelRect.height + epsilon >= measureRect.height
    if (canFit) {
      if (scroll.scrollHeight > scroll.clientHeight + epsilon) {
        failures.push('statistics scroll despite enough panel height')
      }
      for (const [index, row] of rows.entries()) {
        const rect = row.getBoundingClientRect()
        if (rect.top < scrollRect.top - epsilon) {
          failures.push(`row ${index} above visible area`)
        }
        if (rect.bottom > scrollRect.bottom + epsilon) {
          failures.push(`row ${index} below visible area`)
        }
      }
    } else if (scroll.scrollHeight <= scroll.clientHeight + epsilon) {
      failures.push('expected internal scroll fallback')
    }
    return {
      failures,
      count: rows.length,
      panelHeight: panelRect.height,
      measureHeight: measureRect.height,
      scrollHeight: scroll.scrollHeight,
      clientHeight: scroll.clientHeight,
      scrollWidth: scroll.scrollWidth,
      clientWidth: scroll.clientWidth,
      canFit,
    }
  })
}

async function dragPanelToHeight(page: Page, height: number) {
  const divider = page.getByTestId('stats-solves-divider')
  const handle = (await divider.boundingBox())!
  const panel = (await page.locator('.stats-panel').boundingBox())!
  const x = handle.x + handle.width / 2
  const y = handle.y + handle.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x, y + height - panel.height, { steps: 8 })
  await page.mouse.up()
}

async function expectEveryRowMounted(page: Page, count: number) {
  await expect(page.locator('.stats-scroll [data-testid^="stat-row-"]')).toHaveCount(
    count,
  )
}

async function expectMinimumFit(page: Page) {
  await expect
    .poll(async () => {
      const geometry = await statsGeometry(page)
      return {
        failures: geometry.failures,
        atOrAboveMinimum:
          geometry.panelHeight + 2 >= geometry.measureHeight ||
          !geometry.canFit,
      }
    })
    .toEqual({ failures: [], atOrAboveMinimum: true })
}

test.describe('resizable statistics panel', () => {
  test('clamps at the content-aware minimum and maximum without hiding rows', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 900 })
    await page.goto('/')
    await expectEveryRowMounted(page, 4)
    const initial = await statsGeometry(page)

    // Dragging upward stops when all four rows reach their compact content
    // height, not at a fixed pixel value.
    await dragPanelToHeight(page, 20)
    await expectMinimumFit(page)
    const atMinimum = await statsGeometry(page)
    expect(atMinimum.panelHeight).toBeGreaterThanOrEqual(
      atMinimum.measureHeight - 2,
    )
    expect(atMinimum.panelHeight).toBeLessThanOrEqual(
      atMinimum.measureHeight + 2,
    )
    expect(atMinimum.count).toBe(4)
    expect(atMinimum.canFit).toBe(true)
    await expectEveryRowMounted(page, 4)

    // Dragging downward enlarges Statistics until Solves reaches its floor.
    const container = (await page.locator('.sidebar-split').boundingBox())!
    await dragPanelToHeight(page, container.height + 200)
    await expectMinimumFit(page)
    const atMaximum = await statsGeometry(page)
    expect(atMaximum.panelHeight).toBeGreaterThan(initial.panelHeight)
    expect(atMaximum.panelHeight).toBeLessThanOrEqual(container.height - 119)
    expect(atMaximum.failures).toEqual([])
    await expect(page.locator('.history-panel')).toBeVisible()
    await expectEveryRowMounted(page, 4)
  })

  test('adapts to metric and average-row changes without removing averages', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 900 })
    await page.goto('/')
    await expectEveryRowMounted(page, 4)
    await dragPanelToHeight(page, 20)
    const base = await statsGeometry(page)

    await setMetrics(page, ['current', 'best', 'target', 'bpa', 'wpa'])
    await expect
      .poll(async () => (await statsGeometry(page)).measureHeight)
      .toBeGreaterThan(base.measureHeight)
    await expectEveryRowMounted(page, 4)
    const withMetrics = await statsGeometry(page)
    expect(withMetrics.panelHeight + 2).toBeGreaterThanOrEqual(
      withMetrics.measureHeight,
    )
    expect(withMetrics.failures).toEqual([])
    await expect(page.getByTestId('target-ao5')).toBeVisible()
    await expect(page.getByTestId('bpa-ao5')).toBeVisible()
    await expect(page.getByTestId('wpa-ao5')).toBeVisible()

    await setMetrics(page, ['current', 'best'])
    await expect
      .poll(async () => (await statsGeometry(page)).measureHeight)
      .toBeLessThan(withMetrics.measureHeight)
    await expectEveryRowMounted(page, 4)

    await enableAllStats(page)
    await expectEveryRowMounted(page, 11)
    const allRows = await statsGeometry(page)
    expect(allRows.failures).toEqual([])
    await expect(page.getByTestId('best-ao10000')).toBeAttached()

    const settings = await openSettings(page)
    await settings.getByTestId('stat-visible-ao1000').uncheck()
    await settings.getByTestId('stat-visible-ao5000').uncheck()
    await settings.getByTestId('stat-visible-ao10000').uncheck()
    await settings.getByTestId('settings-done').click()
    await expectEveryRowMounted(page, 8)
    await expectMinimumFit(page)
  })

  test('keyboard resizing, reset, shift acceleration and ARIA bounds', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 900 })
    await page.goto('/')
    const divider = page.getByTestId('stats-solves-divider')
    await divider.focus()
    const bounds = await statsGeometry(page)
    const minPercent = Number(await divider.getAttribute('aria-valuemin'))
    const maxPercent = Number(await divider.getAttribute('aria-valuemax'))
    expect(minPercent).toBeLessThan(maxPercent)

    await divider.press('Home')
    await expectMinimumFit(page)
    const home = await statsGeometry(page)
    expect(home.panelHeight).toBeLessThanOrEqual(home.measureHeight + 2)
    await expect(divider).toBeFocused()
    expect(Number(await divider.getAttribute('aria-valuenow'))).toBeGreaterThanOrEqual(
      minPercent,
    )

    await divider.press('Enter')
    await expect
      .poll(async () => (await statsGeometry(page)).panelHeight)
      .toBeGreaterThan(home.panelHeight)
    const reset = await statsGeometry(page)

    await divider.press('End')
    await expect
      .poll(async () => (await statsGeometry(page)).panelHeight)
      .toBeGreaterThan(reset.panelHeight)
    expect(Number(await divider.getAttribute('aria-valuenow'))).toBeLessThanOrEqual(
      maxPercent,
    )
    await expect(divider).toBeFocused()

    await divider.press('ArrowUp')
    const normalStep = await statsGeometry(page)
    await divider.press('Shift+ArrowUp')
    const acceleratedStep = await statsGeometry(page)
    expect(normalStep.panelHeight - acceleratedStep.panelHeight).toBeGreaterThan(
      30,
    )

    await divider.dblclick()
    await expect
      .poll(async () => (await statsGeometry(page)).panelHeight)
      .toBeLessThan(acceleratedStep.panelHeight)
    await expectMinimumFit(page)
    await expect(divider).toBeFocused()
    expect(bounds.failures).toEqual([])
  })

  test('clamps a saved percentage below the content minimum without rewriting it', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 1200 })
    await page.goto('/')
    await enableAllStats(page)
    await setMetrics(page, ['current', 'best', 'target', 'bpa', 'wpa'])
    await page.evaluate(() => {
      const key = 'cubelab:settings:v1'
      const data = JSON.parse(localStorage.getItem(key)!)
      data.settings.statsPanelHeightPercent = 5
      localStorage.setItem(key, JSON.stringify(data))
    })
    await page.reload()
    await expect(page.locator('.scramble-text')).toBeVisible({ timeout: 30_000 })
    await expectEveryRowMounted(page, 11)
    await expect
      .poll(async () => {
        const geometry = await statsGeometry(page)
        return {
          canFit: geometry.canFit,
          atMinimum: geometry.panelHeight + 2 >= geometry.measureHeight,
        }
      })
      .toEqual({ canFit: true, atMinimum: true })
    expect(
      await page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('cubelab:settings:v1')!).settings
            .statsPanelHeightPercent,
      ),
    ).toBe(5)
    expect((await statsGeometry(page)).failures).toEqual([])
  })

  test('keeps persistence, window resizing and narrow widths stable', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 900 })
    await page.goto('/')
    await dragPanelToHeight(page, 280)
    const beforeReload = (await page
      .getByTestId('stats-solves-divider')
      .boundingBox())!.y
    await page.reload()
    await expect(page.locator('.scramble-text')).toBeVisible({ timeout: 30_000 })
    await expectMinimumFit(page)
    expect(
      Math.abs(
        (await page.getByTestId('stats-solves-divider').boundingBox())!.y -
          beforeReload,
      ),
    ).toBeLessThan(12)

    for (const viewport of [
      { width: 1366, height: 650 },
      { width: 1024, height: 900 },
      { width: 1366, height: 900 },
    ]) {
      await page.setViewportSize(viewport)
      await expectMinimumFit(page)
      await expectEveryRowMounted(page, 4)
      const geometry = await statsGeometry(page)
      expect(geometry.failures).toEqual([])
    }

    await page.getByTestId('settings-button').click()
    const settings = page.getByRole('dialog', { name: 'Settings' })
    await chooseTestOption(page, 'ui-zoom', '150')
    await settings.getByTestId('settings-done').click()
    await expectMinimumFit(page)
    await dragPanelToHeight(page, 100)
    await expectMinimumFit(page)
    await dragPanelToHeight(page, 450)
    await expectMinimumFit(page)
    const zoomed = await statsGeometry(page)
    expect(zoomed.failures).toEqual([])
    expect(zoomed.scrollWidth).toBeLessThanOrEqual(zoomed.clientWidth + 1)
  })

  test('uses internal scrolling when the viewport cannot fit every enabled row', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 500 })
    await page.goto('/')
    await enableAllStats(page)
    await setMetrics(page, ['current', 'best', 'target', 'bpa', 'wpa'])
    await expectEveryRowMounted(page, 11)
    await expect
      .poll(async () => (await statsGeometry(page)).canFit)
      .toBe(false)
    const constrained = await statsGeometry(page)
    expect(constrained.failures).toEqual([])
    expect(constrained.scrollHeight).toBeGreaterThan(constrained.clientHeight)

    const scroll = page.locator('.stats-scroll')
    await scroll.evaluate((node) => {
      node.scrollTop = node.scrollHeight
    })
    await expect(page.getByTestId('stat-row-ao10000')).toBeVisible()
    await expect(page.locator('.history-panel')).toBeVisible()
    const statsBox = (await page.locator('.stats-panel').boundingBox())!
    const dividerBox = (await page
      .getByTestId('stats-solves-divider')
      .boundingBox())!
    const historyBox = (await page.locator('.history-panel').boundingBox())!
    expect(statsBox.y + statsBox.height).toBeLessThanOrEqual(dividerBox.y + 1)
    expect(historyBox.y).toBeGreaterThanOrEqual(
      dividerBox.y + dividerBox.height,
    )
    expect(historyBox.height).toBeGreaterThan(100)

    await page.setViewportSize({ width: 1366, height: 360 })
    await expectEveryRowMounted(page, 11)
    await expect(page.locator('.history-panel')).toBeVisible()
    expect((await statsGeometry(page)).failures).toEqual([])
  })

  test('initializes through mobile-to-desktop transitions with every row', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    await enableAllStats(page)
    await setMetrics(page, ['current', 'best', 'target', 'bpa', 'wpa'])
    const divider = page.getByTestId('stats-solves-divider')
    await expect(divider).toHaveCount(0)
    await expectEveryRowMounted(page, 11)

    await page.setViewportSize({ width: 1366, height: 1200 })
    await expect(divider).toBeVisible()
    await expectEveryRowMounted(page, 11)
    await dragPanelToHeight(page, 20)
    await expectMinimumFit(page)
    const desktop = await statsGeometry(page)
    expect(desktop.canFit).toBe(true)
    expect(desktop.failures).toEqual([])

    await page.setViewportSize({ width: 390, height: 844 })
    await expect(divider).toHaveCount(0)
    await expectEveryRowMounted(page, 11)
    const mobile = await statsGeometry(page)
    expect(mobile.failures).toEqual([])
  })

  test('empty selection restores one custom average and refits', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 900 })
    await page.goto('/')
    const settings = await openSettings(page)
    const boxes = settings.locator('[data-testid^="stat-visible-"]')
    for (let i = 0; i < (await boxes.count()); i++) await boxes.nth(i).uncheck()
    await settings.getByTestId('settings-done').click()
    await expect(page.locator('.stats-empty')).toBeVisible()
    await expectEveryRowMounted(page, 0)
    await expectMinimumFit(page)

    await page.getByTestId('settings-button').click()
    await settings.getByTestId('add-custom-average').click()
    await chooseTestOption(page, 'stat-precision', 'tenths')
    await settings.getByTestId('settings-done').click()
    await expectEveryRowMounted(page, 1)
    await expectMinimumFit(page)
    await dragPanelToHeight(page, 400)
    await dragPanelToHeight(page, 20)
    await expectMinimumFit(page)
    expect((await statsGeometry(page)).count).toBe(1)
  })
})
