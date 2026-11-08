import { expect, test, type Page } from '@playwright/test'
import { chooseTestOption } from './interactions'

const NOW = Date.now()

const sessions = {
  version: 6,
  activeSessionId: 'layout-a',
  sessions: [
    {
      id: 'layout-a',
      name: 'Layout history',
      event: '333',
      createdAt: NOW - 90 * 86_400_000,
      updatedAt: NOW,
      solves: Array.from({ length: 60 }, (_, index) => ({
        id: `layout-${index}`,
        event: '333',
        rawMs: 12_000 + (index % 20) * 100,
        penalty: index % 13 === 0 ? 'dnf' : 'none',
        scramble: "R U R' U' F2 L D B2",
        comment: '',
        createdAt: NOW - index * 86_400_000,
      })),
    },
  ],
}

const emptySessions = {
  version: 6,
  activeSessionId: 'layout-empty',
  sessions: [
    {
      id: 'layout-empty',
      name: 'Empty layout',
      event: '333',
      createdAt: NOW - 90 * 86_400_000,
      updatedAt: NOW,
      solves: [],
    },
  ],
}

async function seedWith(page: Page, payload: typeof sessions) {
  await page.addInitScript((data) => {
    localStorage.setItem('cubelab:sessions:v1', JSON.stringify(data))
    localStorage.removeItem('cubelab:settings:v1')
  }, payload)
  await page.goto('/')
  await expect(page.locator('.scramble-text')).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('analytics-nav').click()
  await expect(
    page.getByRole('heading', { name: 'Analytics', exact: true }),
  ).toBeVisible()
}

async function seed(page: Page) {
  await seedWith(page, sessions)
}

async function railGeometry(page: Page) {
  return page.evaluate(() => {
    const heading = document.querySelector<HTMLElement>(
      '.analytics-analysis-nav-heading',
    )
    const tabs = Array.from(
      document.querySelectorAll<HTMLElement>('.analytics-analysis-tab'),
    )
    return {
      headingY: heading?.getBoundingClientRect().y ?? null,
      tabs: tabs.map((tab) => ({
        id: tab.getAttribute('data-testid'),
        y: tab.getBoundingClientRect().y,
      })),
    }
  })
}

async function clickAnalysisTab(page: Page, name: string) {
  const tab = page.getByRole('tab', { name, exact: true })
  const box = await tab.boundingBox()
  const container = await page.locator('.analytics-analysis-tabs').boundingBox()
  expect(box).not.toBeNull()
  expect(container).not.toBeNull()
  const y = Math.min(
    Math.max(box!.y + box!.height / 2, container!.y + 2),
    container!.y + container!.height - 2,
  )
  await page.mouse.click(box!.x + box!.width / 2, y)
  await expect(tab).toHaveAttribute('aria-selected', 'true')
}

const ANALYSIS_NAMES = [
  'Time progression',
  'Average progression',
  'Historical personal bests',
  'Solve time distribution',
  'Consistency',
  'Sub-X analysis',
  'Session comparison',
  'Practice activity',
  'Advanced analytics',
]

test.describe('analytics analysis rail stability', () => {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1440, height: 640 },
    { width: 1280, height: 720 },
  ]) {
    test(`heading and tabs keep their coordinates at ${viewport.width}×${viewport.height}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport)
      await seed(page)
      const initial = await railGeometry(page)
      expect(initial.headingY).not.toBeNull()
      expect(initial.tabs).toHaveLength(ANALYSIS_NAMES.length)

      for (const name of ANALYSIS_NAMES) {
        await clickAnalysisTab(page, name)
        const current = await railGeometry(page)
        expect(current.headingY).toBeCloseTo(initial.headingY!, 1)
        expect(current.tabs).toEqual(initial.tabs)
      }

      for (let round = 0; round < 3; round += 1) {
        await clickAnalysisTab(page, 'Practice activity')
        expect((await railGeometry(page)).headingY).toBeCloseTo(
          initial.headingY!,
          1,
        )
        await clickAnalysisTab(page, 'Advanced analytics')
        expect((await railGeometry(page)).headingY).toBeCloseTo(
          initial.headingY!,
          1,
        )
      }
    })
  }

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1920, height: 900 },
    { width: 2880, height: 1800 },
  ]) {
    test(`empty scopes keep the rail position at ${viewport.width}×${viewport.height}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport)
      await seedWith(page, emptySessions)

      await clickAnalysisTab(page, 'Practice activity')
      const practice = await railGeometry(page)
      const practicePanel = await page
        .getByTestId('analytics-analysis-panel')
        .boundingBox()
      expect(practice.headingY).not.toBeNull()
      expect(practice.tabs).toHaveLength(ANALYSIS_NAMES.length)

      await clickAnalysisTab(page, 'Advanced analytics')
      const advanced = await railGeometry(page)
      const advancedPanel = await page
        .getByTestId('analytics-analysis-panel')
        .boundingBox()
      expect(advanced.headingY).toBeCloseTo(practice.headingY!, 1)
      expect(advanced.tabs).toEqual(practice.tabs)
      expect(advancedPanel?.y).toBeCloseTo(practicePanel!.y, 1)
      await expect(
        page.getByRole('tab', { name: 'Advanced analytics', exact: true }),
      ).toBeFocused()

      for (let round = 0; round < 3; round += 1) {
        await clickAnalysisTab(page, 'Practice activity')
        const currentPractice = await railGeometry(page)
        expect(currentPractice.headingY).toBeCloseTo(practice.headingY!, 1)
        expect(currentPractice.tabs).toEqual(practice.tabs)

        await clickAnalysisTab(page, 'Advanced analytics')
        const currentAdvanced = await railGeometry(page)
        expect(currentAdvanced.headingY).toBeCloseTo(practice.headingY!, 1)
        expect(currentAdvanced.tabs).toEqual(practice.tabs)
      }

      const scroll = await page.evaluate(() => ({
        page: window.scrollY,
        tabs:
          document.querySelector<HTMLElement>('.analytics-analysis-tabs')
            ?.scrollTop ?? 0,
      }))
      expect(scroll).toEqual({ page: 0, tabs: 0 })
    })
  }

  test('an empty filtered result keeps the rail position with populated history', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await seed(page)
    await chooseTestOption(page, 'analytics-event', '222')
    await expect(page.locator('.analytics-page')).toHaveClass(/is-empty/)

    await clickAnalysisTab(page, 'Practice activity')
    const practice = await railGeometry(page)
    const practicePanel = await page
      .getByTestId('analytics-analysis-panel')
      .boundingBox()
    await clickAnalysisTab(page, 'Advanced analytics')
    const advanced = await railGeometry(page)
    const advancedPanel = await page
      .getByTestId('analytics-analysis-panel')
      .boundingBox()

    expect(advanced.headingY).toBeCloseTo(practice.headingY!, 1)
    expect(advanced.tabs).toEqual(practice.tabs)
    expect(advancedPanel?.y).toBeCloseTo(practicePanel!.y, 1)
  })

  test('mobile analysis selector keeps its position between sections', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await seed(page)
    const label = page.locator('.analytics-analysis-mobile-select')
    const before = await label.boundingBox()
    expect(before).not.toBeNull()

    await chooseTestOption(page, 'analytics-analysis-select', 'activity')
    await expect(page.getByTestId('analytics-section-activity')).toBeVisible()
    const activity = await label.boundingBox()
    expect(activity).not.toBeNull()
    expect(activity!.y).toBeCloseTo(before!.y, 1)

    await chooseTestOption(page, 'analytics-analysis-select', 'advanced')
    await expect(page.getByTestId('analytics-section-advanced')).toBeVisible()
    const advanced = await label.boundingBox()
    expect(advanced).not.toBeNull()
    expect(advanced!.y).toBeCloseTo(before!.y, 1)
  })
})
