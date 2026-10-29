import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test.describe('accessibility audit', () => {
  test('main view has no serious axe violations', async ({ page }) => {
    await page.goto('/')
    await page.locator('.scramble-text').waitFor({ state: 'visible', timeout: 30_000 })
    await page.locator('.queue-label').filter({ hasText: 'Queue ready' }).waitFor({ timeout: 30_000 })
    const results = await new AxeBuilder({ page })
      .disableRules(['label-content-name-mismatch'])
      .analyze()
    expect(
      results.violations.filter(
        (violation) =>
          violation.impact === 'critical' || violation.impact === 'serious',
      ),
    ).toEqual([])
  })

  test('settings dialog has no serious axe violations', async ({ page }) => {
    await page.goto('/')
    await page.locator('.scramble-text').waitFor({ state: 'visible', timeout: 30_000 })
    await page.locator('.queue-label').filter({ hasText: 'Queue ready' }).waitFor({ timeout: 30_000 })
    await page.getByTestId('settings-button').click()
    await page.getByRole('dialog', { name: 'Settings' }).waitFor()
    const results = await new AxeBuilder({ page }).analyze()
    expect(
      results.violations.filter(
        (violation) =>
          violation.impact === 'critical' || violation.impact === 'serious',
      ),
    ).toEqual([])
  })
})
