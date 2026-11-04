import { test, expect, type Page } from '@playwright/test'
import { chooseTestOption } from './interactions'

// Also run against Vite to exercise development Strict Mode, not just production.
if (process.env.CUBELAB_TEST_URL) test.use({ baseURL: process.env.CUBELAB_TEST_URL })

async function enableAllStats(page: Page) {
  await page.getByTestId('settings-button').click()
  const settings = page.getByRole('dialog', { name: 'Settings' })
  const boxes = settings.locator('[data-testid^="stat-visible-"]')
  for (let i = 0; i < await boxes.count(); i++) await boxes.nth(i).check()
  await settings.getByTestId('settings-done').click()
  await page.evaluate(() => document.fonts.ready)
}

async function geometry(page: Page) {
  return page.locator('.stats-panel').evaluate((panel) => {
    const grid = panel.querySelector<HTMLElement>('.stats-grid')!
    const bounds = grid.getBoundingClientRect()
    const rows = [...grid.querySelectorAll<HTMLElement>('.stat-tile')]
    const failures: string[] = []
    const epsilon = 0.75
    const panelRect = panel.getBoundingClientRect()
    const panelStyle = getComputedStyle(panel)
    const scale = panelRect.width / (panel as HTMLElement).offsetWidth
    const contentBottom = panelRect.bottom - (parseFloat(panelStyle.paddingBottom) + parseFloat(panelStyle.borderBottomWidth)) * scale
    if (bounds.bottom > contentBottom + epsilon) failures.push('grid outside panel content')
    rows.forEach((row, index) => {
      const rect = row.getBoundingClientRect()
      if (rect.top < bounds.top - epsilon || rect.bottom > bounds.bottom + epsilon) failures.push(`row ${index} outside grid`)
      for (const child of row.children) {
        const text = child.getBoundingClientRect()
        if (text.top < rect.top - epsilon || text.bottom > rect.bottom + epsilon || text.left < rect.left - epsilon || text.right > rect.right + epsilon) failures.push(`row ${index} text outside row`)
      }
    })
    const sample = grid.querySelector<HTMLElement>('.stats-measure-rows.is-compact')
    const next = sample?.children[rows.length]
    // No more complete compact rows should fit; empty space is distributed.
    if (next && next.getBoundingClientRect().bottom <= bounds.bottom - 1) failures.push('another complete row fits')
    return {
      failures,
      count: rows.length,
      blank: rows.length ? bounds.bottom - rows.at(-1)!.getBoundingClientRect().bottom : bounds.height,
      measuring: panel.classList.contains('is-measuring'),
    }
  })
}

async function expectFitted(page: Page) {
  await expect.poll(async () => {
    const result = await geometry(page)
    return { failures: result.failures, measuring: result.measuring, hasRows: result.count > 0, fillsArea: Math.abs(result.blank) < 2 }
  }).toEqual({ failures: [], measuring: false, hasRows: true, fillsArea: true })
}

async function dragToHeight(page: Page, height: number) {
  const divider = page.getByTestId('stats-solves-divider')
  const handle = (await divider.boundingBox())!
  const panel = (await page.locator('.stats-panel').boundingBox())!
  const x = handle.x + handle.width / 2
  const y = handle.y + handle.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x, y + height - panel.height)
  await page.mouse.up()
  await expectFitted(page)
}

test.describe('resizable statistics panel', () => {
  for (const height of [680, 900]) {
    test(`complete rows through bidirectional 4px sweep at ${height}px`, async ({ page }) => {
      test.setTimeout(180_000)
      await page.setViewportSize({ width: 1366, height })
      await page.goto('/')
      await enableAllStats(page)
      await expectFitted(page)
      const range = await page.locator('.sidebar-split').evaluate((split) => ({ min: 96, max: split.clientHeight - 120 }))
      const divider = page.getByTestId('stats-solves-divider')
      // Keep one real drag active in each direction; never reuse stale handle
      // positions or silently skip a state that fails to settle.
      for (const direction of [1, -1]) {
        await dragToHeight(page, direction === 1 ? range.min : range.max)
        const handle = (await divider.boundingBox())!
        const panel = (await page.locator('.stats-panel').boundingBox())!
        const x = handle.x + handle.width / 2
        const y = handle.y + handle.height / 2
        await page.mouse.move(x, y)
        await page.mouse.down()
        const start = direction === 1 ? range.min : range.max
        const end = direction === 1 ? range.max : range.min
        for (let target = start; direction === 1 ? target <= end : target >= end; target += direction * 4) {
          await page.mouse.move(x, y + target - panel.height)
          await expectFitted(page)
        }
        await page.mouse.up()
      }
    })
  }

  test('settings, populated results, fonts and scaling refit; reload preserves split', async ({ page }) => {
    await page.goto('/')
    await enableAllStats(page)
    // Seed only this isolated browser context, retaining the application's schema.
    await page.evaluate(() => {
      const key = 'cubelab:sessions:v1'
      const data = JSON.parse(localStorage.getItem(key)!)
      const session = data.sessions.find((item: { id: string }) => item.id === data.activeSessionId)
      session.solves = Array.from({ length: 30 }, (_, index) => ({
        id: `panel-fixture-${index}`, event: '333', rawMs: 654321 + index * 100,
        penalty: 'none', scramble: "R U R'", createdAt: Date.now() - index * 1000,
      }))
      localStorage.setItem(key, JSON.stringify(data))
    })
    await page.reload()
    await expectFitted(page)
    await expect(page.getByTestId('best-single')).toHaveText('10:54.00')
    for (const zoom of ['1', '1.25', '1.5']) {
      await page.evaluate((value) => { document.body.style.zoom = value }, zoom)
      for (const target of [100, 150, 220, 300, 400, 220, 100]) await dragToHeight(page, target)
    }
    await page.evaluate(() => { document.body.style.zoom = ''; document.documentElement.style.fontSize = '20px' })
    await expectFitted(page)
    await page.evaluate(() => { document.documentElement.style.fontSize = '' })
    await dragToHeight(page, 260)
    await page.getByTestId('settings-button').click()
    const settings = page.getByRole('dialog', { name: 'Settings' })
    await settings.getByTestId('stat-visible-single').uncheck()
    await settings.getByTestId('settings-done').click()
    await expect(page.getByTestId('best-single')).toHaveCount(0)
    await expectFitted(page)
    const before = (await page.getByTestId('stats-solves-divider').boundingBox())!.y
    await page.reload()
    await expectFitted(page)
    expect(Math.abs((await page.getByTestId('stats-solves-divider').boundingBox())!.y - before)).toBeLessThan(12)
  })

  test('keyboard divider controls and reset keep complete rows', async ({ page }) => {
    await page.goto('/')
    await enableAllStats(page)
    const divider = page.getByTestId('stats-solves-divider')
    await divider.focus()
    for (const key of ['Home', 'ArrowDown', 'Shift+ArrowDown', 'End', 'ArrowUp', 'Enter']) {
      await divider.press(key)
      await expectFitted(page)
      await expect(divider).toBeFocused()
    }
  })

  test('empty selection can restore a single custom average', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('settings-button').click()
    const settings = page.getByRole('dialog', { name: 'Settings' })
    const boxes = settings.locator('[data-testid^="stat-visible-"]')
    for (let i = 0; i < await boxes.count(); i++) await boxes.nth(i).uncheck()
    await settings.getByTestId('settings-done').click()
    await expect(page.locator('.stats-empty')).toBeVisible()
    await expect(page.locator('.stat-tile')).toHaveCount(0)
    await page.getByTestId('settings-button').click()
    await settings.getByTestId('add-custom-average').click()
    await chooseTestOption(page, 'stat-precision', 'tenths')
    await settings.getByTestId('settings-done').click()
    await expect(page.locator('.stat-tile')).toHaveCount(1)
    await expectFitted(page)
    await dragToHeight(page, 400)
    await dragToHeight(page, 100)
  })

  test('divider tracks the pointer with enlarged UI scaling', async ({ page }) => {
    await page.goto('/')
    await enableAllStats(page)
    await page.getByTestId('settings-button').click()
    const settings = page.getByRole('dialog', { name: 'Settings' })
    await chooseTestOption(page, 'ui-zoom', '125')
    await settings.getByTestId('settings-done').click()
    await expectFitted(page)
    const divider = page.getByTestId('stats-solves-divider')
    const handle = (await divider.boundingBox())!
    const x = handle.x + handle.width / 2
    const y = handle.y + handle.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x, y + 60)
    await expect.poll(async () => (await divider.boundingBox())!.y - handle.y).toBeCloseTo(60, 0)
    await page.mouse.up()
    await expectFitted(page)
    await expect(divider).toHaveAttribute('aria-valuenow', /^(?:[0-9]|[1-9][0-9]|100)$/)
  })

  test('mobile-to-desktop transitions initialize and restore the split', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    await enableAllStats(page)
    for (const width of [1366, 390, 1366]) {
      await page.setViewportSize({ width, height: 900 })
      const divider = page.getByTestId('stats-solves-divider')
      if (width < 901) {
        await expect(divider).toHaveCount(0)
        await expect(page.locator('.stat-tile')).toHaveCount(11)
      } else {
        await expect(divider).toBeVisible()
        await expectFitted(page)
        await dragToHeight(page, 320)
      }
    }
  })

  test('mobile shows every enabled statistic without the desktop divider', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    await enableAllStats(page)
    await expect(page.getByTestId('stats-solves-divider')).toHaveCount(0)
    await expect(page.locator('.stat-tile')).toHaveCount(11)
    await expect(page.locator('.stats-measure-rows')).toHaveCount(0)
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 })
      expect((await geometry(page)).failures).toEqual([])
    }
  })
})
