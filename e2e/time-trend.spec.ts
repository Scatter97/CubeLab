import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { chooseTestOption } from './interactions'

const TIMER = '[data-testid="timer-surface"]'

async function seedTrend(page: Page, total = 7061, theme: 'light' | 'dark' = 'dark') {
  await page.addInitScript(({ count, seededTheme }) => {
    if (localStorage.getItem('cubelab:sessions:v1')) return
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
    localStorage.setItem('cubelab:settings:v1', JSON.stringify({ version: 12, settings: { inspectionEnabled: false, theme: seededTheme } }))
  }, { count: total, seededTheme: theme })
}

async function openTrend(page: Page, total = 7061, theme: 'light' | 'dark' = 'dark') {
  await seedTrend(page, total, theme)
  await page.goto('/')
  await page.getByTestId('current-tool-button').click()
  await page.getByTestId('tool-select-button').click()
  await page.getByRole('menuitemradio', { name: 'Time Trend' }).click()
  await expect(page.getByTestId('time-trend-svg')).toBeVisible()
  await expect(page.getByTestId('time-trend-zoom-in')).toBeEnabled()
}

async function assertChartFits(page: Page) {
  const host = await page.getByTestId('time-trend-chart').boundingBox()
  const chart = await page.getByTestId('time-trend-svg').boundingBox()
  expect(host).not.toBeNull()
  expect(chart).not.toBeNull()
  expect(Math.abs(chart!.width - host!.width)).toBeLessThanOrEqual(3)
  expect(Math.abs(chart!.height - host!.height)).toBeLessThanOrEqual(3)
  const ticks = await page.getByTestId('time-trend-y-tick').allTextContents()
  expect(ticks.every((tick) => !tick.startsWith('-'))).toBe(true)
}

async function chartBounds(page: Page) {
  return page.getByTestId('time-trend-svg').evaluate((svg) => ({
    min: Number(svg.getAttribute('data-y-min')),
    max: Number(svg.getAttribute('data-y-max')),
    xStart: Number(svg.getAttribute('data-x-start')),
    xCount: Number(svg.getAttribute('data-x-count')),
    xZoom: Number(svg.getAttribute('data-x-zoom')),
    yZoom: Number(svg.getAttribute('data-y-zoom')),
  }))
}

async function seedPB(page: Page) {
  await page.addInitScript(() => {
    if (localStorage.getItem('cubelab:sessions:v1')) return
    const now = Date.UTC(2026, 9, 31)
    const times = [20000, 22000, 21000, 23000, 18000, 16000, 15000, 17000, 19000]
    const penalties = ['none', 'none', 'none', 'none', '+2', 'none', 'none', 'none', 'none']
    localStorage.setItem('cubelab:sessions:v1', JSON.stringify({
      version: 4, activeSessionId: 'pb-session', sessions: [{ id: 'pb-session', name: 'PB practice', event: '333', createdAt: now, updatedAt: now,
        solves: times.map((rawMs, index) => ({
          id: `pb-${index + 1}`, event: '333', rawMs: index === 4 ? 16000 : rawMs,
          penalty: penalties[index], scramble: index === 4 ? 'R U F2' : 'R U',
          comment: index === 4 ? 'Clean last layer' : '', createdAt: now + index * 60000,
        })).reverse(),
      }],
    }))
    localStorage.setItem('cubelab:settings:v1', JSON.stringify({ version: 12, settings: { inspectionEnabled: false, theme: 'dark', stopWithAnyKey: true } }))
  })
  await page.goto('/')
  await page.getByTestId('current-tool-button').click()
  await page.getByTestId('tool-select-button').click()
  await page.getByRole('menuitemradio', { name: 'Time Trend' }).click()
  await expect(page.getByTestId('time-trend-svg')).toBeVisible()
  await expect(page.getByTestId('time-trend-zoom-in')).toBeEnabled()
}

test('compact Time Trend fits a dense session, inspects by keyboard and keeps Space for the timer', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await openTrend(page)
  await assertChartFits(page)
  await expect(page.getByTestId('time-trend-expand')).toHaveCount(0)
  await expect(page.getByTestId('time-trend-modal')).toHaveCount(0)
  await expect(page.getByTestId('time-trend-legend')).toContainText('time')
  await expect(page.getByTestId('time-trend-legend')).toContainText('ao5')
  await expect(page.getByTestId('time-trend-legend')).toContainText('ao12')
  await expect(page.getByTestId('time-trend-legend')).toContainText('PB')
  await expect(page.getByTestId('time-trend-controls').getByRole('button')).toHaveCount(5)
  await expect(page.locator('[data-series="ao1000"]')).toHaveCount(0)

  const autoMax = Number(await page.getByTestId('time-trend-svg').getAttribute('data-y-max'))
  const autoMin = Number(await page.getByTestId('time-trend-svg').getAttribute('data-y-min'))
  expect(autoMax).toBeLessThan(70000)
  expect(autoMin).toBeGreaterThan(0)
  expect((await page.getByTestId('time-trend-y-tick').allTextContents()).some((label) => label.includes('1:'))).toBe(false)

  const svg = page.getByTestId('time-trend-svg')
  await svg.focus()
  await page.keyboard.press('End')
  const card = page.getByTestId('time-trend-hover-card')
  await expect(card).toContainText('Solve #7061 of 7061')
  await expect(page.getByTestId('time-trend-announcement')).toContainText('Solve 7061 of 7061')
  await page.keyboard.press('Home')
  await expect(card).toContainText('Solve #1 of 7061')
  await expect(card).toContainText('DNF')
  await page.keyboard.press('ArrowRight')
  await expect(card).toContainText('PB · #2 of 7061')
  await page.keyboard.press('Escape')
  await expect(card).toHaveCount(0)

  const pbMarker = await page.locator('[data-testid="time-trend-pb-hit"]').first().boundingBox()
  await page.mouse.move(pbMarker!.x + pbMarker!.width / 2, pbMarker!.y + pbMarker!.height / 2)
  await expect(card).toHaveAttribute('data-kind', 'pb')
  await expect(card).toBeVisible()

  const scan = await new AxeBuilder({ page }).include('.time-trend').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  expect(scan.violations).toEqual([])

  await page.keyboard.down('Space')
  await expect(page.locator(TIMER)).toHaveAttribute('data-phase', 'ready')
  await page.keyboard.up('Space')
  await expect(page.locator(TIMER)).toHaveAttribute('data-phase', 'running')
  await page.keyboard.down('Space')
  await expect(page.locator(TIMER)).toHaveAttribute('data-phase', 'idle')
  await expect(page.getByTestId('solve-count')).toHaveText('7062')
  await expect(page.getByTestId('time-trend-svg')).toBeVisible()
  await expect(page.getByTestId('time-trend-zoom-in')).toBeEnabled()
  expect(errors).toEqual([])
})

test('viewport buttons zoom, pan, toggle axes, stop at bounds and ignore wheel/drag gestures', async ({ page }) => {
  await openTrend(page, 200)
  const svg = page.getByTestId('time-trend-svg')
  const zoomIn = page.getByTestId('time-trend-zoom-in')
  const zoomOut = page.getByTestId('time-trend-zoom-out')
  const panEarlier = page.getByTestId('time-trend-pan-earlier')
  const panLater = page.getByTestId('time-trend-pan-later')
  const axisToggle = page.getByTestId('time-trend-axis-toggle')
  const original = await chartBounds(page)

  await expect(zoomOut).toBeDisabled()
  await expect(panEarlier).toBeDisabled()
  await expect(panLater).toBeDisabled()
  await zoomIn.click()
  expect((await chartBounds(page)).xCount).toBeLessThan(original.xCount)
  await expect(zoomOut).toBeEnabled()
  const beforePan = await chartBounds(page)
  await panEarlier.click()
  expect((await chartBounds(page)).xStart).toBeLessThan(beforePan.xStart)

  const xZoom = (await chartBounds(page)).xZoom
  const ySpan = async () => {
    const bounds = await chartBounds(page)
    return bounds.max - bounds.min
  }
  const originalYSpan = await ySpan()
  await axisToggle.click()
  await expect(page.getByTestId('time-trend-controls')).toHaveAttribute('data-axis', 'y')
  await zoomIn.click()
  expect((await chartBounds(page)).xZoom).toBe(xZoom)
  expect(await ySpan()).toBeLessThan(originalYSpan)
  await zoomOut.click()
  expect(await ySpan()).toBeCloseTo(originalYSpan)
  await axisToggle.click()

  for (let index = 0; index < 20; index += 1) {
    if (await zoomIn.isDisabled()) break
    await zoomIn.click()
  }
  await expect(zoomIn).toBeDisabled()
  for (let index = 0; index < 20; index += 1) {
    if (await zoomOut.isDisabled()) break
    await zoomOut.click()
  }
  await expect(zoomOut).toBeDisabled()
  await expect(panEarlier).toBeDisabled()
  await expect(panLater).toBeDisabled()
  expect(await chartBounds(page)).toEqual(original)

  const beforeGestures = await chartBounds(page)
  const chart = await svg.boundingBox()
  await page.mouse.move(chart!.x + chart!.width * 0.5, chart!.y + chart!.height * 0.5)
  await page.mouse.wheel(0, -260)
  expect(await chartBounds(page)).toEqual(beforeGestures)
  const canceledWheel = await svg.evaluate((node) => !node.dispatchEvent(new WheelEvent('wheel', {
    bubbles: true, cancelable: true, deltaX: -240, deltaY: -240,
    clientX: 100, clientY: 80,
  })))
  expect(canceledWheel).toBe(false)
  expect(await chartBounds(page)).toEqual(beforeGestures)

  await page.mouse.move(chart!.x + chart!.width * 0.25, chart!.y + chart!.height * 0.4)
  await page.mouse.down()
  await page.mouse.move(chart!.x + chart!.width * 0.85, chart!.y + chart!.height * 0.8, { steps: 6 })
  await page.mouse.up()
  expect(await chartBounds(page)).toEqual(beforeGestures)
  await expect(page.locator(TIMER)).toHaveAttribute('data-phase', 'idle')
})

test('current PB is the latest lifetime PB and keeps a static ring', async ({ page }) => {
  await seedPB(page)
  const current = page.locator('[data-current-pb="true"]')
  await expect(current).toHaveCount(1)
  await expect(current).toHaveAttribute('aria-label', /Current personal best · Solve #7 · 15\.00/)
  await expect(page.locator('[data-pb-id="pb-1"] [data-testid="time-trend-pb"]')).toHaveAttribute('r', '3.4')
  await expect(current.locator('[data-testid="time-trend-pb"]')).toHaveAttribute('r', '4.2')
  await expect(page.getByTestId('time-trend-pb-ring')).toHaveCount(1)
  await expect(page.locator('[data-testid="time-trend-pb-hit"]')).toHaveCount(4)

  const marker = await current.boundingBox()
  await page.mouse.move(marker!.x + marker!.width / 2, marker!.y + marker!.height / 2)
  const card = page.getByTestId('time-trend-hover-card')
  await expect(card).toHaveAttribute('data-kind', 'pb')
  await expect(card.getByTestId('time-trend-card-title')).toHaveText('Current PB · #7 of 9')
  await expect(card.getByTestId('time-trend-card-time')).toHaveText('15.00')
  await expect(card.getByTestId('time-trend-pb-improvement')).toHaveText('1.00 faster (6.3%)')
  await expect(card.getByTestId('time-trend-pb-previous')).toHaveText('16.00 · #6')
  await expect(card.getByTestId('time-trend-pb-mo3')).toHaveText('16.33')
  await expect(card.getByTestId('time-trend-pb-ao5')).toHaveText('18.33')
  await expect(card.getByTestId('time-trend-pb-ao12')).toHaveText('—')
  await expect(card).toContainText('R U')
  const cardBox = await card.boundingBox()
  const dotBox = await current.locator('[data-testid="time-trend-pb"]').boundingBox()
  expect(
    cardBox!.y + cardBox!.height <= dotBox!.y ||
      cardBox!.y >= dotBox!.y + dotBox!.height ||
      cardBox!.x + cardBox!.width <= dotBox!.x ||
      cardBox!.x >= dotBox!.x + dotBox!.width,
  ).toBe(true)
  await page.mouse.move(cardBox!.x + cardBox!.width / 2, cardBox!.y + cardBox!.height / 2)
  await expect(card).toBeVisible()
  await page.mouse.move(0, 0)
  await expect(card).toHaveCount(0)

  const older = page.locator('[data-pb-id="pb-5"]')
  const olderBox = await older.boundingBox()
  await page.mouse.move(olderBox!.x + olderBox!.width / 2, olderBox!.y + olderBox!.height / 2)
  await expect(card.getByTestId('time-trend-card-title')).toHaveText('PB · #5 of 9')
  await expect(card.getByTestId('time-trend-pb-improvement')).toHaveText('2.00 faster (10.0%)')
  await expect(card.getByTestId('time-trend-pb-previous')).toHaveText('20.00 · #1')
  await expect(card).toContainText('R U F2')
  await page.mouse.move(0, 0)
  await expect(card).toHaveCount(0)

  const ringAnimation = await page.getByTestId('time-trend-pb-ring').evaluate((node) => getComputedStyle(node).animationName)
  expect(ringAnimation).toBe('none')
  const chartCursor = await page.getByTestId('time-trend-svg').evaluate((node) => getComputedStyle(node).cursor)
  expect(chartCursor).toBe('default')
  const pbCursor = await page.getByTestId('time-trend-pb-hit').first().evaluate((node) => getComputedStyle(node).cursor)
  expect(pbCursor).toBe('pointer')

  const chart = await page.getByTestId('time-trend-svg').boundingBox()
  await page.mouse.click(chart!.x + chart!.width * 0.98, chart!.y + chart!.height * 0.98)
  await expect(card).toHaveCount(0)
  await expect(page.getByTestId('time-trend-svg')).not.toBeFocused()
})

test('Time Trend settings persist across reload and apply to the compact chart', async ({ page }) => {
  await openTrend(page, 200)
  const svg = page.getByTestId('time-trend-svg')
  const autoMax = Number(await svg.getAttribute('data-y-max'))
  expect(autoMax).toBeLessThan(70000)

  let settings = page.getByRole('dialog', { name: 'Settings' })
  await page.getByTestId('settings-button').click()
  await expect(settings).toBeVisible()
  await expect(settings.getByTestId('time-trend-scale')).toContainText('Auto')
  await expect(settings.getByTestId('time-trend-cutoff')).toContainText('Standard')
  await chooseTestOption(page, 'time-trend-scale', 'full')
  await expect(settings.getByTestId('time-trend-cutoff')).toBeDisabled()
  await settings.getByTestId('settings-done').click()
  await expect(page.getByTestId('time-trend')).toHaveAttribute('data-y-scale', 'full')
  expect(Number(await svg.getAttribute('data-y-max'))).toBeGreaterThan(80000)
  await expect.poll(async () => page.evaluate(() =>
    JSON.parse(localStorage.getItem('cubelab:settings:v1')!).settings.timeTrendScale,
  )).toBe('full')

  await page.reload()
  await expect(page.getByTestId('time-trend-svg')).toBeVisible()
  await expect(page.getByTestId('time-trend')).toHaveAttribute('data-y-scale', 'full')

  await page.getByTestId('settings-button').click()
  settings = page.getByRole('dialog', { name: 'Settings' })
  await chooseTestOption(page, 'time-trend-scale', 'auto')
  await chooseTestOption(page, 'time-trend-cutoff', 'gentle')
  await settings.getByTestId('settings-done').click()
  await expect(page.getByTestId('time-trend')).toHaveAttribute('data-y-scale', 'auto')
  const gentleMax = Number(await svg.getAttribute('data-y-max'))
  expect(gentleMax).toBeLessThan(70000)
  await expect.poll(async () => page.evaluate(() => ({
    scale: JSON.parse(localStorage.getItem('cubelab:settings:v1')!).settings.timeTrendScale,
    cutoff: JSON.parse(localStorage.getItem('cubelab:settings:v1')!).settings.timeTrendCutoff,
  }))).toEqual({ scale: 'auto', cutoff: 'gentle' })

  await page.reload()
  await expect(page.getByTestId('time-trend-svg')).toBeVisible()
  await page.getByTestId('settings-button').click()
  settings = page.getByRole('dialog', { name: 'Settings' })
  await expect(settings.getByTestId('time-trend-scale')).toContainText('Auto')
  await expect(settings.getByTestId('time-trend-cutoff')).toContainText('Gentle')
})

test('Time Trend uses the 220px default, 150x170 minimum and fits a 320px light viewport', async ({ page }) => {
  await openTrend(page, 100)
  const panel = page.getByTestId('tool-panel')
  const defaultBox = await panel.boundingBox()
  expect(Math.round(defaultBox!.width)).toBe(220)
  await assertChartFits(page)

  const handle = await page.getByTestId('tool-panel-resize-handle').boundingBox()
  await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2)
  await page.mouse.down()
  await page.mouse.move(handle!.x + handle!.width / 2 + 160, handle!.y + handle!.height / 2 + 160, { steps: 8 })
  await page.mouse.up()
  await expect(panel).not.toHaveAttribute('data-interaction')
  const minimumBox = await panel.boundingBox()
  expect(Math.round(minimumBox!.width)).toBe(150)
  expect(Math.round(minimumBox!.height)).toBe(170)
  await assertChartFits(page)
  await expect(page.getByTestId('time-trend-controls').getByRole('button')).toHaveCount(5)

  await page.setViewportSize({ width: 320, height: 740 })
  await page.reload()
  await expect(page.getByTestId('time-trend-svg')).toBeVisible()
  await assertChartFits(page)
  const viewport = page.viewportSize()!
  const panelBox = await panel.boundingBox()
  expect(panelBox!.x).toBeGreaterThanOrEqual(0)
  expect(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(viewport.width)
  await expect(page.getByTestId('time-trend-controls').getByRole('button')).toHaveCount(5)
  const scan = await new AxeBuilder({ page }).include('.time-trend').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  expect(scan.violations).toEqual([])
})

test('touch pins a PB card and tapping outside dismisses it', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  })
  const page = await context.newPage()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await seedPB(page)
  const current = page.locator('[data-current-pb="true"]')
  const dot = current.locator('[data-testid="time-trend-pb"]')
  const card = page.getByTestId('time-trend-hover-card')
  await expect.poll(async () => {
    const box = await dot.boundingBox()
    if (!box) return 0
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
    return card.count()
  }, { timeout: 5000 }).toBe(1)
  await expect(card).toHaveAttribute('data-kind', 'pb')
  await expect(card.getByTestId('time-trend-card-title')).toHaveText('Current PB · #7 of 9')
  await page.touchscreen.tap(4, 4)
  await expect(card).toHaveCount(0)

  const chart = await page.getByTestId('time-trend-svg').boundingBox()
  await page.touchscreen.tap(chart!.x + chart!.width * 0.98, chart!.y + chart!.height * 0.98)
  await expect(card).toHaveCount(0)
  await expect.poll(async () => {
    const box = await dot.boundingBox()
    if (!box) return 0
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
    return card.count()
  }, { timeout: 5000 }).toBe(1)
  await page.keyboard.press('Escape')
  await expect(card).toHaveCount(0)
  await context.close()
})
