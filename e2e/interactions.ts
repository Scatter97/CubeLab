import { expect, type Locator, type Page } from '@playwright/test'

/** Choose an option from a CubeLab Select by its data-testid option value. */
export async function chooseTestOption(
  page: Page,
  testId: string,
  value: string,
): Promise<void> {
  const trigger = page.getByTestId(testId)
  await trigger.click()
  await page.getByTestId(`${testId}-option-${value}`).click()
  await expect(trigger).toBeVisible()
}

/** Choose an option from a CubeLab Select by visible option text. */
export async function chooseOption(
  trigger: Locator,
  label: string,
): Promise<void> {
  await trigger.click()
  await trigger.page().getByRole('option', { name: label, exact: true }).click()
}

export async function selectSession(
  page: Page,
  id: string,
): Promise<void> {
  await page.getByTestId('session-select').click()
  await page.getByTestId(`session-option-${id}`).click()
}

export async function selectSessionByName(
  page: Page,
  name: string,
): Promise<void> {
  await page.getByTestId('session-select').click()
  await page.getByRole('button', { name: `Select session ${name}` }).click()
}

export async function sessionNames(page: Page): Promise<string[]> {
  await page.getByTestId('session-select').click()
  const names = await page
    .locator('[data-testid^="session-option-"] .session-picker-name')
    .allTextContents()
  await page.keyboard.press('Escape')
  return names
}
