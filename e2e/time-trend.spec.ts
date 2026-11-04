import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { chooseOption } from './interactions'

async function openTrend(page: Page, total = 7061) {
  await page.addInitScript((count) => {
    const now = Date.UTC(2026, 9, 31)
    localStorage.setItem('cubelab:sessions:v1', JSON.stringify({
      version: 4, activeSessionId: 'trend-session', sessions: [{
        id: 'trend-session', name: 'Trend session', event: '333', createdAt: now - count * 60000, updatedAt: now,
        solves: Array.from({ length: count }, (_, i) => ({
          id: `trend-${i}`, event: '333', rawMs: i === 10 ? 80000 : 15000 + i * 0.8 + ((i * 17) % 91) * 50,
          penalty: i % 353 === 0 ? 'dnf' : i % 127 === 0 ? '+2' : 'none',
          scramble: 'R U F2', comment: i === 8 ? 'Practice note' : '', createdAt: now - i * 60000,
        })),
      }],
    }))
    localStorage.setItem('cubelab:settings:v1', JSON.stringify({ version: 7, settings: { inspectionEnabled: false, theme: 'dark' } }))
  }, total)
  await page.goto('/')
  await page.getByTestId('current-tool-button').click()
  await page.getByTestId('tool-select-button').click()
  await page.getByRole('menuitemradio', { name: 'Time Trend' }).click()
  await expect(page.getByTestId('time-trend-svg')).toBeVisible()
}

async function assertChartFits(page: Page) {
  const host = await page.getByTestId('time-trend-chart').boundingBox()
  const chart = await page.getByTestId('time-trend-svg').boundingBox()
  expect(host).not.toBeNull()
  expect(chart).not.toBeNull()
  expect(Math.abs(chart!.width - host!.width)).toBeLessThan(2)
  expect(Math.abs(chart!.height - host!.height)).toBeLessThan(2)
  const ticks = await page.getByTestId('time-trend-y-tick').allTextContents()
  expect(ticks.every((tick) => !tick.startsWith('-'))).toBe(true)
}

test('Time Trend fits a dense session, expands, pans, zooms and contains keyboard input', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await openTrend(page)
  await assertChartFits(page)
  const compact = await page.getByTestId('time-trend-svg').boundingBox()
  await expect(page.getByTestId('time-trend-pb').first()).toHaveAttribute('r', '1.6')
  // Full-range scaling includes a real 80-second outlier, not only percentiles.
  expect((await page.getByTestId('time-trend-y-tick').allTextContents()).some((label) => label.includes('1:'))).toBe(true)
  const expand = page.getByRole('button', { name: 'Expand Time Trend' })
  await expand.click()
  const dialog = page.getByRole('dialog', { name: 'Time Trend' })
  await expect(dialog).toBeVisible()
  await assertChartFits(page)
  const expanded = await page.getByTestId('time-trend-svg').boundingBox()
  expect(expanded!.width).toBeGreaterThan(compact!.width * 2)
  expect(expanded!.height).toBeGreaterThan(compact!.height)
  await dialog.getByRole('button', { name: 'Single', exact: true }).focus()
  await page.keyboard.press('Space')
  await expect(page.getByTestId('timer-surface')).toHaveAttribute('data-phase', 'idle')
  await dialog.getByRole('button', { name: 'Single', exact: true }).click()
  await dialog.getByRole('button', { name: 'Zoom in' }).click()
  await expect(page.getByTestId('time-trend-visible-range')).not.toContainText('#1–7061')
  const range = await page.getByTestId('time-trend-visible-range').textContent()
  await dialog.getByRole('button', { name: 'Earlier solves' }).click()
  await expect(page.getByTestId('time-trend-visible-range')).not.toHaveText(range!)
  await dialog.getByRole('button', { name: 'Fit all' }).click()
  await expect(page.getByTestId('time-trend-visible-range')).toHaveText('Solves #1–7061 of 7,061')
  await chooseOption(dialog.getByRole('combobox', { name: 'X axis' }), 'Date')
  expect((await page.getByTestId('time-trend-svg').locator('text').allTextContents()).some((value) => value.includes('Oct'))).toBe(true)
  const svg = await page.getByTestId('time-trend-svg').boundingBox()
  await page.mouse.move(svg!.x + svg!.width * 0.6, svg!.y + svg!.height * 0.5)
  await expect(page.getByTestId('time-trend-tooltip')).toContainText('R U F2')
  await dialog.getByRole('button', { name: 'PB markers' }).click()
  await expect(page.getByTestId('time-trend-pb')).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Close Time Trend' }).focus()
  await page.keyboard.press('Shift+Tab')
  await expect(dialog.locator(':focus')).toHaveCount(1)
  const scan = await new AxeBuilder({ page }).include('.time-trend-dialog').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  expect(scan.violations).toEqual([])
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await expect(expand).toBeFocused()
  await assertChartFits(page)
  await page.keyboard.down('Space')
  await expect(page.getByTestId('timer-surface')).toHaveAttribute('data-phase', 'ready')
  await expect(expand).toBeDisabled()
  await page.keyboard.press('Escape')
  await page.keyboard.up('Space')
  await expect(page.getByTestId('timer-surface')).toHaveAttribute('data-phase', 'idle')
  expect(errors).toEqual([])
})

test('Time Trend remains usable at 320px and after a compact-panel resize', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 })
  await openTrend(page, 100)
  await assertChartFits(page)
  await page.getByTestId('time-trend-expand').click()
  const dialog = page.getByRole('dialog', { name: 'Time Trend' })
  await assertChartFits(page)
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  const box = await dialog.boundingBox()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(320)
  await dialog.getByRole('button', { name: 'Close Time Trend' }).click()
  await page.setViewportSize({ width: 1440, height: 900 })
  const panel = page.getByTestId('tool-panel')
  const handle = page.getByTestId('tool-panel-resize-handle')
  const handleBox = await handle.boundingBox()
  await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2)
  await page.mouse.down()
  await page.mouse.move(handleBox!.x - 40, handleBox!.y - 40)
  await page.mouse.up()
  await expect(panel).not.toHaveAttribute('data-interaction')
  await assertChartFits(page)
})

async function chartBounds(page: Page) {
  return page.getByTestId('time-trend-svg').evaluate((svg) => ({
    min: Number(svg.getAttribute('data-y-min')),
    max: Number(svg.getAttribute('data-y-max')),
    xLabels: Array.from(svg.querySelectorAll('text')).map((node) => node.textContent).filter((text) => text?.startsWith('#')),
  }))
}

test('trackpad zooms each axis, pinches both, drags to pan and resets', async ({ page }) => {
  await openTrend(page, 200)
  await page.getByTestId('time-trend-expand').click()
  const dialog = page.getByRole('dialog', { name: 'Time Trend' })
  const svg = page.getByTestId('time-trend-svg')
  const box = await svg.boundingBox()
  const pointer = { x: box!.x + box!.width * 0.55, y: box!.y + box!.height * 0.5 }
  await page.mouse.move(pointer.x, pointer.y)
  const original = await chartBounds(page)
  const originalRange = await page.getByTestId('time-trend-visible-range').textContent()
  const scrollTop = await dialog.evaluate((node) => node.scrollTop)
  const width = await page.evaluate(() => window.innerWidth)

  await page.mouse.wheel(0, -220)
  await expect.poll(async () => { const b = await chartBounds(page); return b.max - b.min }).toBeLessThan(original.max - original.min)
  expect((await chartBounds(page)).xLabels).toEqual(original.xLabels)
  await expect(page.getByTestId('time-trend-visible-range')).toHaveText(originalRange!)
  const afterVertical = await chartBounds(page)

  await page.mouse.wheel(-220, 0)
  await expect(page.getByTestId('time-trend-visible-range')).not.toHaveText(originalRange!)
  const afterHorizontal = await chartBounds(page)
  expect(afterHorizontal.min).toBeCloseTo(afterVertical.min)
  expect(afterHorizontal.max).toBeCloseTo(afterVertical.max)
  expect(await dialog.evaluate((node) => node.scrollTop)).toBe(scrollTop)
  expect(await page.evaluate(() => window.innerWidth)).toBe(width)

  // Browser pinch gestures are ctrl+wheel; verify cancellation as well as axes.
  expect(await svg.evaluate((node) => {
    const rect = node.getBoundingClientRect()
    return node.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -40, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 }))
  })).toBe(false)
  await expect.poll(async () => { const b = await chartBounds(page); return b.max - b.min }).toBeLessThan(afterHorizontal.max - afterHorizontal.min)
  const beforePan = await chartBounds(page)
  const beforePanRange = await page.getByTestId('time-trend-visible-range').textContent()
  await page.mouse.move(pointer.x, pointer.y)
  await page.mouse.down()
  await page.mouse.move(pointer.x + 60, pointer.y + 35, { steps: 5 })
  // Capture keeps the drag active even if the pointer leaves the plot.
  await page.mouse.up()
  const afterPan = await chartBounds(page)
  expect(afterPan.min).toBeGreaterThan(beforePan.min)
  expect(afterPan.min).toBeGreaterThanOrEqual(0)
  expect(afterPan.max - afterPan.min).toBeCloseTo(beforePan.max - beforePan.min)
  await expect(page.getByTestId('time-trend-visible-range')).not.toHaveText(beforePanRange!)
  await expect(page.getByTestId('timer-surface')).toHaveAttribute('data-phase', 'idle')

  await dialog.getByRole('button', { name: 'Fit all' }).click()
  expect(await chartBounds(page)).toEqual(original)
  await expect(page.getByTestId('time-trend-visible-range')).toHaveText(originalRange!)

  // Safari's gesture event path uses incremental scale, with the same reset.
  await svg.evaluate((node) => {
    const rect = node.getBoundingClientRect()
    for (const [type, scale] of [['gesturestart', 1], ['gesturechange', 2], ['gestureend', 2]] as const) {
      const event = new Event(type, { bubbles: true, cancelable: true })
      Object.assign(event, { scale, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 })
      node.dispatchEvent(event)
    }
  })
  await expect.poll(async () => { const b = await chartBounds(page); return b.max - b.min }).toBeCloseTo((original.max - original.min) / 2)
  await dialog.getByRole('button', { name: 'Fit all' }).click()
  await chooseOption(dialog.getByRole('combobox', { name: 'Zoom axes' }), 'Vertical')
  await dialog.getByRole('button', { name: 'Zoom in' }).click()
  await expect(page.getByTestId('time-trend-visible-range')).toHaveText(originalRange!)
  await dialog.getByRole('button', { name: 'Fit all' }).click()
  await chooseOption(dialog.getByRole('combobox', { name: 'Zoom axes' }), 'Horizontal')
  await dialog.getByRole('button', { name: 'Zoom in' }).click()
  expect((await chartBounds(page)).min).toBe(original.min)
  expect((await chartBounds(page)).max).toBe(original.max)
})

test('compact gestures preserve the view when expanded and Fit resets both axes', async ({ page }) => {
  await openTrend(page, 200)
  const original = await chartBounds(page)
  await page.getByTestId('time-trend-svg').evaluate((node) => {
    const rect = node.getBoundingClientRect()
    node.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaX: -250, deltaY: -250, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 }))
  })
  await expect(page.getByRole('button', { name: 'Reset Time Trend view' })).toBeVisible()
  const compact = await chartBounds(page)
  await page.getByTestId('time-trend-expand').click()
  const expanded = await chartBounds(page)
  expect(expanded.min).toBeCloseTo(compact.min)
  expect(expanded.max).toBeCloseTo(compact.max)
  await page.getByRole('button', { name: 'Close Time Trend' }).click()
  await page.getByRole('button', { name: 'Reset Time Trend view' }).click()
  const reset = await chartBounds(page)
  expect(reset.min).toBe(original.min)
  expect(reset.max).toBe(original.max)
  expect(reset.xLabels).toEqual(original.xLabels)
})

async function pbFixture(page: Page) {
  await page.addInitScript(() => {
    const now = Date.UTC(2026, 9, 31)
    const times = [20000, 22000, 21000, 23000, 18000, 16000, 15000]
    localStorage.setItem('cubelab:sessions:v1', JSON.stringify({
      version: 4, activeSessionId: 'pb-session', sessions: [{ id: 'pb-session', name: 'PB practice', event: '333', createdAt: now, updatedAt: now,
        solves: times.map((rawMs, index) => ({ id: `pb-${index + 1}`, event: '333', rawMs: index === 4 ? 16000 : rawMs,
          penalty: index === 4 ? '+2' : 'none', scramble: 'R U F2', comment: index === 4 ? 'Clean last layer' : '', createdAt: now + index * 60000,
        })).reverse(),
      }],
    }))
    localStorage.setItem('cubelab:settings:v1', JSON.stringify({ version: 7, settings: { inspectionEnabled: false, theme: 'dark', stopWithAnyKey: true } }))
  })
  await page.goto('/')
  await page.getByTestId('current-tool-button').click()
  await page.getByTestId('tool-select-button').click()
  await page.getByRole('menuitemradio', { name: 'Time Trend' }).click()
}

test('PB markers open historical stats from compact and expanded charts with focus restoration', async ({ page }) => {
  await pbFixture(page)
  const marker = page.getByRole('button', { name: 'PB solve #5, 18.00. Show stats' })
  await marker.click()
  const stats = page.getByRole('dialog', { name: 'Personal best' })
  await expect(stats).toBeVisible()
  await expect(stats.getByTestId('pb-stats-time')).toHaveText('18.00')
  await expect(stats.getByTestId('pb-stats-improvement')).toHaveText('2.00 faster than the previous PB (10.0%)')
  await expect(stats.getByTestId('pb-stats-mo3')).toHaveText('20.67')
  await expect(stats.getByTestId('pb-stats-ao5')).toHaveText('21.00')
  await expect(stats.getByTestId('pb-stats-ao12')).toHaveText('—')
  await expect(stats).toContainText('Clean last layer')
  await expect(stats).toContainText('R U F2')
  await expect(stats).toContainText('16.00')
  await expect(stats).toContainText('+2')
  await page.mouse.move(0, 0)
  await expect(stats).toBeVisible()
  await expect(page.getByTestId('timer-surface')).toHaveAttribute('data-phase', 'idle')
  await page.keyboard.press('Escape')
  await expect(stats).not.toBeVisible()
  await expect(marker).toBeFocused()
  await page.getByTestId('time-trend-expand').click()
  const expanded = page.getByRole('dialog', { name: 'Time Trend' })
  await expect(expanded).toBeVisible()
  await marker.focus()
  await page.keyboard.press('Enter')
  await expect(stats).toBeVisible()
  const scan = await new AxeBuilder({ page }).include('.time-trend-pb-dialog').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  expect(scan.violations).toEqual([])
  await stats.getByRole('button', { name: 'Close PB stats' }).click()
  await expect(expanded).toBeVisible()
  await expect(marker).toBeFocused()
  // In the expanded modal Space activates PBs without reaching the timer.
  await page.keyboard.press('Space')
  await expect(stats).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(stats).not.toBeVisible()
  await expect(expanded).toBeVisible()
  await expect(page.getByTestId('timer-surface')).toHaveAttribute('data-phase', 'idle')
  await expanded.getByRole('button', { name: 'Close Time Trend' }).click()
  await marker.focus()
  await page.keyboard.down('Space')
  await expect(page.getByTestId('timer-surface')).toHaveAttribute('data-phase', 'ready')
  await page.keyboard.up('Space')
  await expect(page.getByTestId('timer-surface')).toHaveAttribute('data-phase', 'running')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('timer-surface')).toHaveAttribute('data-phase', 'idle')
  await expect(stats).not.toBeVisible()
})

test('dragging from a PB pans without opening stats; zoomed and date-axis PBs remain clickable', async ({ page }) => {
  await pbFixture(page)
  await page.getByTestId('time-trend-expand').click()
  const dialog = page.getByRole('dialog', { name: 'Time Trend' })
  const marker = page.getByRole('button', { name: 'PB solve #5, 18.00. Show stats' })
  await chooseOption(dialog.getByRole('combobox', { name: 'Zoom axes' }), 'Horizontal')
  await dialog.getByRole('button', { name: 'Zoom in' }).click()
  const box = await marker.boundingBox()
  const before = await page.getByTestId('time-trend-visible-range').textContent()
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
  await page.mouse.down()
  await page.mouse.move(box!.x + box!.width / 2 + 180, box!.y + box!.height / 2, { steps: 8 })
  await page.mouse.up()
  await expect(page.getByRole('dialog', { name: 'Personal best' })).not.toBeVisible()
  await expect(page.getByTestId('time-trend-visible-range')).not.toHaveText(before!)
  await dialog.getByRole('button', { name: 'Fit all' }).click()
  await chooseOption(dialog.getByRole('combobox', { name: 'X axis' }), 'Date')
  await marker.click()
  await expect(page.getByTestId('pb-stats-time')).toHaveText('18.00')
  await page.keyboard.press('Escape')
  await dialog.getByRole('button', { name: 'PB markers' }).click()
  await expect(dialog.getByRole('button', { name: /PB solve/ })).toHaveCount(0)
})

test('PB stats fit 320px and the first PB explains missing rolling results', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 })
  await pbFixture(page)
  const marker = page.getByRole('button', { name: 'PB solve #1, 20.00. Show stats' })
  await marker.click()
  const stats = page.getByRole('dialog', { name: 'Personal best' })
  await expect(stats).toContainText('First valid solve')
  await expect(stats.getByTestId('pb-stats-mo3')).toHaveText('—')
  await expect(stats.getByTestId('pb-stats-ao5')).toHaveText('—')
  expect(await stats.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)
  const box = await stats.boundingBox()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(320)
  await stats.getByRole('button', { name: 'Close PB stats' }).click()
  await expect(marker).toBeFocused()
})
