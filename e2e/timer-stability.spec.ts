import { expect, test, type Page } from '@playwright/test'

const TIMER = '[data-testid="timer-surface"]'

async function waitForApp(page: Page) {
  await expect(page.locator('.scramble-text')).toBeVisible({ timeout: 30_000 })
}

async function timerCentre(page: Page) {
  return page.evaluate(() => {
    const box = document.querySelector<HTMLElement>(
      '[data-testid="timer-display"]',
    )!.getBoundingClientRect()
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  })
}

async function openToolPanel(page: Page) {
  await page.getByTestId('current-tool-button').click()
  await expect(page.getByTestId('tool-panel')).toBeVisible()
}

async function seedInspection(page: Page) {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('cubelab-timer-stability-seeded')) return
    sessionStorage.setItem('cubelab-timer-stability-seeded', '1')
    localStorage.setItem(
      'cubelab:settings:v1',
      JSON.stringify({
        version: 10,
        settings: {
          inspectionEnabled: true,
          inspectionCountDirection: 'down',
          alertChannel: 'visual',
          holdDurationMs: 300,
        },
      }),
    )
    localStorage.removeItem('cubelab:sessions:v1')
  })
  await page.goto('/')
  await waitForApp(page)
  await page.clock.install()
}

async function solveCount(page: Page) {
  return page.getByTestId('solve-count').innerText()
}

async function storedPenalties(page: Page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem('cubelab:sessions:v1')
    if (!raw) return []
    const data = JSON.parse(raw) as {
      activeSessionId: string
      sessions: Array<{ id: string; solves: Array<{ penalty: string }> }>
    }
    return (
      data.sessions.find((session) => session.id === data.activeSessionId)
        ?.solves.map((solve) => solve.penalty) ?? []
    )
  })
}

test.describe('timer workspace stability', () => {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
    { width: 390, height: 844 },
  ]) {
    test(`floating tool operations never move the timer at ${viewport.width}×${viewport.height}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport)
      await page.goto('/')
      await waitForApp(page)

      const initial = await timerCentre(page)
      await openToolPanel(page)
      expect(await timerCentre(page)).toEqual(initial)

      const panel = page.getByTestId('tool-panel')
      const drag = await page.getByTestId('tool-panel-drag-handle').boundingBox()
      expect(drag).not.toBeNull()
      if (drag) {
        await page.mouse.move(drag.x + drag.width / 2, drag.y + drag.height / 2)
        await page.mouse.down()
        await page.mouse.move(
          drag.x + drag.width / 2 - 24,
          drag.y + drag.height / 2 - 18,
          { steps: 5 },
        )
        await page.mouse.up()
        await expect(panel).not.toHaveAttribute('data-interaction')
        expect(await timerCentre(page)).toEqual(initial)
      }

      const resize = await page
        .getByTestId('tool-panel-resize-handle')
        .boundingBox()
      expect(resize).not.toBeNull()
      if (resize) {
        await page.mouse.move(
          resize.x + resize.width / 2,
          resize.y + resize.height / 2,
        )
        await page.mouse.down()
        await page.mouse.move(
          resize.x + resize.width / 2 - 18,
          resize.y + resize.height / 2 - 12,
          { steps: 5 },
        )
        await page.mouse.up()
        expect(await timerCentre(page)).toEqual(initial)
      }

      await page.getByTestId('tool-select-button').click()
      await page.getByRole('menuitemradio', { name: 'Time Trend' }).click()
      expect(await timerCentre(page)).toEqual(initial)
      await page.getByTestId('tool-select-button').click()
      await page.getByRole('menuitemradio', { name: 'Draw Scramble' }).click()
      expect(await timerCentre(page)).toEqual(initial)

      await page.getByTestId('current-tool-button').click()
      await expect(panel).toHaveCount(0)
      expect(await timerCentre(page)).toEqual(initial)
    })
  }

  test('removes instructional captions and workspace indicators without losing readiness feedback', async ({
    page,
  }) => {
    await page.goto('/')
    await waitForApp(page)
    const stage = page.locator('.timer-stage')
    const readout = page.locator('.readout-zone')

    await expect(page.locator('.timer-caption')).toHaveCount(0)
    await expect(page.locator('.phase-pill')).toHaveCount(0)
    await expect(page.locator('.phase-dot')).toHaveCount(0)
    await expect(page.locator('#timer-phase')).toHaveCount(0)
    await expect(page.locator('.stage-top')).toHaveCount(0)
    await expect(page.locator('.stage-mode')).toHaveCount(0)
    await expect(page.locator('.timer-stage')).not.toContainText('3×3')
    await expect(readout).not.toContainText('Ready')
    await expect(readout).not.toContainText('Keep holding')
    await expect(readout).not.toContainText('Release to start')
    const centering = await page.evaluate(() => {
      const stageRect = document.querySelector('.timer-stage')!.getBoundingClientRect()
      const displayRect = document
        .querySelector('.timer-display')!
        .getBoundingClientRect()
      return {
        stageCenter: (stageRect.left + stageRect.right) / 2,
        displayCenter: (displayRect.left + displayRect.right) / 2,
      }
    })
    expect(Math.abs(centering.displayCenter - centering.stageCenter)).toBeLessThan(1.5)
    const idleBackground = await stage.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    )

    await page.keyboard.down('Space')
    await expect(page.locator(TIMER)).toHaveAttribute('data-phase', 'holding')
    await expect(readout).not.toContainText('Keep holding')
    await expect(page.locator(TIMER)).toHaveAttribute('data-phase', 'ready', {
      timeout: 3_000,
    })
    await expect(page.locator('.phase-pill')).toHaveCount(0)
    await expect(page.locator('.stage-top')).toHaveCount(0)
    await expect(readout).not.toContainText('Release to start')
    await expect(page.locator('.timer-stage')).not.toContainText('3×3')
    const readyBackground = await stage.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    )
    expect(readyBackground).not.toBe(idleBackground)
    await expect(page.locator(TIMER)).toHaveAccessibleName(/armed/i)

    await page.keyboard.up('Space')
    await expect(page.locator(TIMER)).toHaveAttribute('data-phase', 'running')
    await page.keyboard.press('Space')
    await expect(page.locator(TIMER)).toHaveAttribute('data-phase', 'idle')
    expect(await solveCount(page)).toBe('1')
  })
})

test.describe('inspection while holding', () => {
  test('keeps the countdown live through holding and armed states', async ({
    page,
  }) => {
    await seedInspection(page)
    const centres: Array<{ x: number; y: number }> = []
    centres.push(await timerCentre(page))

    await page.keyboard.press('Space')
    await expect(page.locator(TIMER)).toHaveAttribute('data-phase', 'inspection')
    await expect(page.getByTestId('timer-display')).toHaveText('15')
    centres.push(await timerCentre(page))

    await page.clock.fastForward(8_100)
    await expect(page.getByTestId('timer-display')).toHaveText('7')
    await page.keyboard.down('Space')
    await expect(page.locator(TIMER)).toHaveAttribute('data-phase', 'holding')
    await expect(page.getByTestId('timer-display')).toHaveText('7')
    centres.push(await timerCentre(page))

    await page.clock.fastForward(1_000)
    await expect(page.locator(TIMER)).toHaveAttribute('data-phase', 'ready')
    await expect(page.getByTestId('timer-display')).toHaveText('6')
    centersEqual(centres, await timerCentre(page))

    await page.clock.fastForward(3_000)
    await expect(page.getByTestId('timer-display')).toHaveText('3')
    expect(await solveCount(page)).toBe('0')
    centersEqual(centres, await timerCentre(page))

    await page.keyboard.up('Space')
    await expect(page.locator(TIMER)).toHaveAttribute('data-phase', 'running')
    // The solve clock has replaced the inspection count regardless of how much
    // wall time the browser used to paint the first running frame.
    await expect(page.getByTestId('timer-display')).toHaveText(/^\d+\.\d{2}$/)
    expect(await solveCount(page)).toBe('0')
    await page.clock.fastForward(1_000)
    await page.keyboard.press('Space')
    await expect(page.locator(TIMER)).toHaveAttribute('data-phase', 'idle')
    await expect(page.getByTestId('solve-count')).toHaveText('1')
    expect(await storedPenalties(page)).toEqual(['none'])
  })

  test('releasing before arming returns to inspection and records nothing', async ({
    page,
  }) => {
    await seedInspection(page)
    await page.keyboard.press('Space')
    await page.clock.fastForward(2_000)
    await page.keyboard.down('Space')
    await expect(page.locator(TIMER)).toHaveAttribute('data-phase', 'holding')
    await page.clock.fastForward(100)
    await page.keyboard.up('Space')
    await expect(page.locator(TIMER)).toHaveAttribute('data-phase', 'inspection')
    await expect(page.getByTestId('timer-display')).toHaveText('13')
    expect(await solveCount(page)).toBe('0')

    await page.keyboard.press('Escape')
    await expect(page.locator(TIMER)).toHaveAttribute('data-phase', 'idle')
    expect(await solveCount(page)).toBe('0')
  })

  test('applies +2 and DNF when the thresholds are crossed while holding', async ({
    page,
  }) => {
    await seedInspection(page)

    await page.keyboard.press('Space')
    await page.clock.fastForward(14_000)
    await page.keyboard.down('Space')
    await page.clock.fastForward(1_100)
    await expect(page.locator(TIMER)).toHaveAttribute('data-phase', 'ready')
    await expect(page.getByTestId('timer-display')).toHaveText('+2')
    await page.clock.fastForward(1_400)
    await expect(page.getByTestId('timer-display')).toHaveText('+2')
    expect(await solveCount(page)).toBe('0')
    await page.keyboard.up('Space')
    await expect(page.locator(TIMER)).toHaveAttribute('data-phase', 'running')
    await page.clock.fastForward(1_000)
    await page.keyboard.press('Space')
    await expect(page.locator(TIMER)).toHaveAttribute('data-phase', 'idle')
    expect(await storedPenalties(page)).toEqual(['+2'])

    await page.keyboard.press('Space')
    await page.clock.fastForward(16_000)
    await page.keyboard.down('Space')
    await page.clock.fastForward(1_100)
    await expect(page.locator(TIMER)).toHaveAttribute('data-phase', 'ready')
    await expect(page.getByTestId('timer-display')).toHaveText('DNF')
    expect(await solveCount(page)).toBe('1')
    await page.keyboard.up('Space')
    await expect(page.locator(TIMER)).toHaveAttribute('data-phase', 'running')
    await page.clock.fastForward(1_000)
    await page.keyboard.press('Space')
    await expect(page.locator(TIMER)).toHaveAttribute('data-phase', 'idle')
    expect(await storedPenalties(page)).toEqual(['dnf', '+2'])
  })

  test('ignores keyboard auto-repeat while arming', async ({ page }) => {
    await seedInspection(page)
    await page.keyboard.press('Space')
    await page.keyboard.down('Space')
    await page.evaluate(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: ' ',
          code: 'Space',
          bubbles: true,
          repeat: true,
        }),
      )
    })
    await page.clock.fastForward(300)
    await expect(page.locator(TIMER)).toHaveAttribute('data-phase', 'ready')
    await page.clock.fastForward(1_000)
    await expect(page.locator(TIMER)).toHaveAttribute('data-phase', 'ready')
    expect(await solveCount(page)).toBe('0')
    await page.keyboard.up('Space')
    await expect(page.locator(TIMER)).toHaveAttribute('data-phase', 'running')
    expect(await solveCount(page)).toBe('0')
  })
})

function centersEqual(
  centres: Array<{ x: number; y: number }>,
  current: { x: number; y: number },
) {
  for (const centre of centres) {
    expect(Math.abs(current.x - centre.x)).toBeLessThanOrEqual(0.5)
    expect(Math.abs(current.y - centre.y)).toBeLessThanOrEqual(0.5)
  }
}
