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

export interface MetricLayout {
  hasSecondary: boolean
  parent: { left: number; right: number; top: number; bottom: number; width: number }
  metrics: Array<{
    label: string
    value: string
    gap: number
    sameLine: boolean
    contained: boolean
    group: { left: number; right: number; top: number; bottom: number; width: number }
    labelRect: { left: number; right: number; top: number; bottom: number }
    valueRect: { left: number; right: number; top: number; bottom: number }
  }>
  lineCount: number
  overflow: boolean
  rowLabel: {
    text: string
    fontSize: number
    fontWeight: number
    left: number
    right: number
    top: number
    bottom: number
  }
}

/** Measure actual metric-group and row-label geometry for layout assertions. */
export async function metricLayout(
  page: Page,
  rowTestId: string,
): Promise<MetricLayout> {
  return page.getByTestId(rowTestId).evaluate((row) => {
    const rowLabelElement = row.querySelector<HTMLElement>('.stat-label')!
    const rowLabelRect = rowLabelElement.getBoundingClientRect()
    const rowLabelStyle = getComputedStyle(rowLabelElement)
    const rowLabel = {
      text: rowLabelElement.textContent?.trim() ?? '',
      fontSize: Number.parseFloat(rowLabelStyle.fontSize),
      fontWeight: Number(rowLabelStyle.fontWeight),
      left: rowLabelRect.left,
      right: rowLabelRect.right,
      top: rowLabelRect.top,
      bottom: rowLabelRect.bottom,
    }
    const secondary = row.querySelector<HTMLElement>('.stat-secondary')
    if (!secondary) {
      return {
        hasSecondary: false,
        parent: { left: 0, right: 0, top: 0, bottom: 0, width: 0 },
        metrics: [],
        lineCount: 0,
        overflow: false,
        rowLabel,
      }
    }

    const parentRect = secondary.getBoundingClientRect()
    const metrics = [
      ...secondary.querySelectorAll<HTMLElement>('.stat-metric'),
    ].map((group) => {
      const label = group.querySelector<HTMLElement>('.stat-metric-label')!
      const value = group.querySelector<HTMLElement>('strong')!
      const groupRect = group.getBoundingClientRect()
      const labelRect = label.getBoundingClientRect()
      const valueRect = value.getBoundingClientRect()
      return {
        label: label.textContent?.trim() ?? '',
        value: value.textContent?.trim() ?? '',
        gap: valueRect.left - labelRect.right,
        sameLine:
          Math.abs(
            (labelRect.top + labelRect.bottom) / 2 -
              (valueRect.top + valueRect.bottom) / 2,
          ) < 6,
        contained:
          labelRect.left >= groupRect.left - 1 &&
          valueRect.right <= groupRect.right + 1,
        group: {
          left: groupRect.left,
          right: groupRect.right,
          top: groupRect.top,
          bottom: groupRect.bottom,
          width: groupRect.width,
        },
        labelRect: {
          left: labelRect.left,
          right: labelRect.right,
          top: labelRect.top,
          bottom: labelRect.bottom,
        },
        valueRect: {
          left: valueRect.left,
          right: valueRect.right,
          top: valueRect.top,
          bottom: valueRect.bottom,
        },
      }
    })
    const lineTops: number[] = []
    for (const metric of metrics) {
      if (!lineTops.some((top) => Math.abs(top - metric.group.top) < 3)) {
        lineTops.push(metric.group.top)
      }
    }
    return {
      hasSecondary: true,
      parent: {
        left: parentRect.left,
        right: parentRect.right,
        top: parentRect.top,
        bottom: parentRect.bottom,
        width: parentRect.width,
      },
      metrics,
      lineCount: lineTops.length,
      overflow:
        secondary.scrollWidth > secondary.clientWidth + 1 ||
        metrics.some(
          (metric) =>
            metric.group.left < parentRect.left - 1 ||
            metric.group.right > parentRect.right + 1,
        ),
      rowLabel,
    }
  })
}
