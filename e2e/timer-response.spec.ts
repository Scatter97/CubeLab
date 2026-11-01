import { expect, test, type Page } from '@playwright/test'
import { formatTime } from '../src/lib/format'

const TIMER = '[data-testid="timer-surface"]'
async function stored(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('cubelab:sessions:v1')!))
}
async function start(page: Page) {
  await page.keyboard.down('Space')
  await expect(page.locator(TIMER)).toHaveAttribute('data-phase', 'ready')
  await page.keyboard.up('Space')
  await expect(page.locator(TIMER)).toHaveAttribute('data-phase', 'running')
}

test('large-session stops persist once, display the exact result, and refresh insights without mixing sessions', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript(() => {
    if (localStorage.getItem('cubelab:sessions:v1')) return
    const now = Date.now()
    const stamp = { updatedAt: now, editorId: 'large-session-test' }
    const solves = Array.from({ length: 7000 }, (_, i) => ({ id: `original-${i}`, event: '333',
      rawMs: 15000 + i % 5000, penalty: 'none', scramble: "R U R' U' F2 D L2 B' R2 U2", comment: '',
      createdAt: now - i * 60000, updatedAt: now, fieldUpdates: { rawMs: stamp, penalty: stamp, scramble: stamp, comment: stamp } }))
    localStorage.setItem('cubelab:sessions:v1', JSON.stringify({ version: 4, activeSessionId: 'dense', sessions: [
      { id: 'dense', name: 'Dense practice', event: '333', createdAt: now, updatedAt: now, solves },
      { id: 'other', name: 'Other session', event: '333', createdAt: now, updatedAt: now,
        solves: [{ ...solves[0], id: 'other-result', rawMs: 98765 }] },
    ] }))
    localStorage.setItem('cubelab:settings:v1', JSON.stringify({ version: 8, settings: {
      inspectionEnabled: false, holdDurationMs: 0, theme: 'dark', statVisibility: { ao1000: true },
    } }))
  })
  await page.goto('/')
  await expect(page.locator('.queue-label')).toContainText('Queue ready', { timeout: 30000 })
  await page.getByTestId('current-tool-button').click()
  await page.getByTestId('tool-select-button').click()
  await page.getByRole('menuitemradio', { name: 'Time Trend' }).click()
  await expect(page.getByTestId('time-trend-svg')).toBeVisible()
  const original = (await stored(page)).sessions[0].solves

  await start(page)
  await page.keyboard.down('Space')
  await expect(page.locator(TIMER)).toHaveAttribute('data-phase', 'idle')
  await expect.poll(async () => (await stored(page)).sessions[0].solves.length).toBe(7001)
  const first = (await stored(page)).sessions[0].solves[0]
  await expect(page.getByTestId('timer-display')).toHaveText(formatTime(first.rawMs))
  // Repeated keydown and release must not create another solve or start a run.
  await page.keyboard.down('Space')
  await page.keyboard.up('Space')
  await expect(page.locator(TIMER)).toHaveAttribute('data-phase', 'idle')
  await expect(page.getByTestId('solve-count')).toHaveText('7001')
  await expect(page.getByTestId('time-trend-expand')).toBeEnabled()
  await expect(page.getByTestId('history-time').first()).toHaveText(formatTime(first.rawMs))

  await start(page)
  const surface = await page.locator(TIMER).boundingBox()
  if (!surface) throw new Error('Timer surface is missing')
  await page.mouse.move(surface.x + surface.width * .25, surface.y + surface.height * .5)
  await page.mouse.down()
  await expect(page.locator(TIMER)).toHaveAttribute('data-phase', 'idle')
  await expect.poll(async () => (await stored(page)).sessions[0].solves.length).toBe(7002)
  const second = (await stored(page)).sessions[0].solves[0]
  await expect(page.getByTestId('timer-display')).toHaveText(formatTime(second.rawMs))
  await page.mouse.up()
  await page.getByTestId('session-select').selectOption('other')
  await expect(page.getByTestId('timer-display')).toHaveText(formatTime(98765))
  await expect(page.getByTestId('solve-count')).toHaveText('1')
  await expect(page.getByTestId('history-row')).toHaveCount(1)
  await page.getByTestId('session-select').selectOption('dense')
  await expect(page.getByTestId('solve-count')).toHaveText('7002')
  const completed = (await stored(page)).sessions[0].solves
  expect(completed.slice(2)).toEqual(original)
  expect(new Set(completed.map((solve: { id: string }) => solve.id)).size).toBe(7002)
  await page.reload()
  await expect(page.getByTestId('timer-display')).toHaveText(formatTime(second.rawMs))
  await expect(page.getByTestId('solve-count')).toHaveText('7002')
  expect((await stored(page)).sessions[0].solves).toEqual(completed)
  expect(errors).toEqual([])
})
