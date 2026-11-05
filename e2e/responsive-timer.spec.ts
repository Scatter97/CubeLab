import { expect, test, type Page } from '@playwright/test'

const NOW = Date.now()
const DAY = 86_400_000

function solve(index: number) {
  return {
    id: `responsive-${index}`,
    event: '333',
    rawMs: 14_000 + ((index * 7919) % 5_000) - 2_500,
    penalty: (index + 1) % 37 === 0 ? 'dnf' : 'none',
    scramble: "R U R' U' F2 L D B2 R2 U2 L' B D2 F' U R2",
    comment: '',
    createdAt: NOW - index * 3 * 3_600_000,
  }
}

const sessions = {
  version: 6,
  activeSessionId: 'responsive-a',
  sessions: [
    {
      id: 'responsive-a',
      name: '3×3 practice',
      event: '333',
      createdAt: NOW - 10 * DAY,
      updatedAt: NOW,
      solves: Array.from({ length: 80 }, (_, index) => solve(index)),
    },
  ],
}

async function seed(page: Page) {
  await page.addInitScript((payload) => {
    localStorage.setItem('cubelab:sessions:v1', JSON.stringify(payload))
    localStorage.removeItem('cubelab:settings:v1')
  }, sessions)
  await page.goto('/')
  await expect(page.locator('.scramble-text')).toBeVisible({ timeout: 30_000 })
}

test.describe('responsive timer layout', () => {
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 360, height: 640 },
    { width: 568, height: 320 },
    { width: 844, height: 390 },
  ]) {
    test(`keeps the timer clear of panels at ${viewport.width}×${viewport.height}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport)
      await seed(page)

      const metrics = await page.evaluate(() => {
        const rect = (selector: string) => {
          const element = document.querySelector<HTMLElement>(selector)
          if (!element) throw new Error(`Missing ${selector}`)
          const box = element.getBoundingClientRect()
          return { top: box.top, bottom: box.bottom, left: box.left, right: box.right }
        }
        return {
          stage: rect('.timer-stage'),
          display: rect('.timer-display'),
          side: rect('.side-column'),
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          documentWidth: document.documentElement.scrollWidth,
        }
      })

      expect(metrics.stage.bottom).toBeLessThanOrEqual(metrics.side.top + 1)
      expect(metrics.display.top).toBeGreaterThanOrEqual(metrics.stage.top)
      expect(metrics.display.bottom).toBeLessThanOrEqual(metrics.stage.bottom)
      expect(metrics.display.top).toBeGreaterThanOrEqual(0)
      expect(metrics.display.bottom).toBeLessThanOrEqual(
        metrics.viewportHeight + 1,
      )
      expect(metrics.documentWidth).toBeLessThanOrEqual(
        metrics.viewportWidth + 1,
      )
    })
  }

  test('keeps penalty actions reachable from the solve menu on touch layouts', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await seed(page)

    const row = page.locator('[data-testid="history-row"]').first()
    await expect(row.locator('.history-actions')).toBeHidden()
    await row.getByTestId('history-main').focus()
    await page.keyboard.press('Enter')

    const menu = page.getByRole('menu')
    await expect(
      menu.getByRole('menuitem', { name: 'Add +2 penalty' }),
    ).toBeVisible()
    await expect(
      menu.getByRole('menuitem', { name: 'Mark as DNF' }),
    ).toBeVisible()
  })
})
