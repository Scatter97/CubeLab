import { expect, test } from '@playwright/test'
import { algorithmSnapshotFor } from '../src/lib/training/algorithmSelection'
import { builtInAlgorithmForCase } from '../src/lib/training/catalog/defaultAlgorithms'
import { finishTrainingVisit } from '../src/lib/training/records'
import { createEmptyTrainingData } from '../src/lib/training/storage'
import { beginTrainingSession } from '../src/lib/training/visits'

test('Training Hub opens without writing Training storage on a fresh visit', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('training-nav').click()
  await expect(page.getByRole('heading', { name: 'Training Hub' })).toBeVisible()
  await page.keyboard.press('Space')
  await expect(page.getByTestId('timer-surface')).toHaveCount(0)
  await expect(page.getByTestId('training-scramble')).toHaveCount(0)
  expect(await page.evaluate(() => localStorage.getItem('cubelab:training:v1'))).toBeNull()
})

for (const width of [1440, 320]) {
  test(`Training Hub restores and edits a local draft at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const at = 1_700_000_000_000
    const session = beginTrainingSession(createEmptyTrainingData(), {
      id: 'prior-training-session', at, categoryId: 'pll:recognition',
      session: {
        version: 1, name: 'pll recognition',
        cases: (['pll:ua', 'pll:ub'] as const).map(caseId => ({
          caseId, algorithm: algorithmSnapshotFor(builtInAlgorithmForCase(caseId)!),
        })),
      },
    })
    const data = finishTrainingVisit(session, 'prior-training-session', at, 'manual')
    const raw = JSON.stringify({
      ...data,
      preferences: {
        ...data.preferences,
        selectedSetId: 'pll',
        sets: {
          ...data.preferences.sets,
          pll: {
            ...data.preferences.sets.pll,
            includeSetupMoves: true,
            enabledCaseIds: ['pll:ua', 'pll:ub'],
          },
        },
      },
    })
    await page.addInitScript(value => localStorage.setItem('cubelab:training:v1', value), raw)
    await page.goto('/')
    await page.getByTestId('training-nav').click()

    const hub = page.getByRole('main', { name: 'Training Hub' })
    await expect(hub).toBeVisible()
    const set = hub.getByRole('group', { name: 'Algorithm set' })
    const mode = hub.getByRole('group', { name: 'Practice type' })
    const name = hub.getByRole('textbox', { name: 'Session name' })
    await expect(set.getByRole('button', { name: 'PLL' })).toHaveAttribute('aria-pressed', 'true')
    await expect(mode.getByRole('button', { name: 'Recognition (BETA)' })).toHaveAttribute('aria-pressed', 'true')
    await expect(name).toHaveValue('')
    await expect(name).toHaveAttribute('placeholder', 'PLL Recognition (2)')
    await expect(hub.getByText('2 cases selected')).toBeVisible()

    await name.fill('PLL Recognition')
    await set.getByRole('button', { name: 'OLL' }).click()
    await expect(name).toHaveValue('PLL Recognition')
    await mode.getByRole('button', { name: 'Recognition (BETA)' }).click()
    await expect(name).toHaveAttribute('placeholder', 'OLL Recognition')
    await name.fill('   ')
    await expect(name).toHaveValue('')
    await set.getByRole('button', { name: 'PLL' }).click()
    await expect(mode.getByRole('button', { name: 'Recognition (BETA)' })).toHaveAttribute('aria-pressed', 'true')

    const edit = hub.getByRole('button', { name: 'Edit cases' })
    await edit.click()
    const cases = page.getByRole('dialog', { name: 'Edit PLL cases' })
    await expect(cases.getByRole('checkbox', { name: 'Ua', exact: true })).toBeChecked()
    await cases.getByRole('button', { name: 'Clear selection' }).click()
    await cases.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(cases).toBeHidden()
    await expect(edit).toBeFocused()
    await expect(hub.getByText('2 cases selected')).toBeVisible()

    await edit.click()
    await cases.getByRole('checkbox', { name: 'Ub', exact: true }).uncheck()
    await cases.getByRole('button', { name: 'Apply selection' }).click()
    await expect(hub.getByText('1 case selected')).toBeVisible()
    await expect(hub.getByText('Select at least two cases for recognition.')).toBeVisible()
    await set.getByRole('button', { name: 'OLL' }).click()
    await set.getByRole('button', { name: 'PLL' }).click()
    await expect(hub.getByText('1 case selected')).toBeVisible()
    await edit.click()
    await expect(cases.getByRole('checkbox', { name: 'Ub', exact: true })).not.toBeChecked()
    expect(await cases.evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth)).toBe(true)
    await page.keyboard.press('Escape')

    await expect(page.getByTestId('timer-surface')).toHaveCount(0)
    await expect(page.getByTestId('training-scramble')).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Last Result' })).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
    expect(await page.evaluate(() => localStorage.getItem('cubelab:training:v1'))).toBe(raw)

    await page.reload()
    await expect(hub.getByText('2 cases selected')).toBeVisible()
    await expect(page.getByTestId('training-scramble')).toHaveCount(0)
  })
}
