import { expect, test, type Locator, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { chooseTestOption } from './interactions'
import { algorithmSnapshotFor } from '../src/lib/training/algorithmSelection'
import { builtInAlgorithmForCase } from '../src/lib/training/catalog/defaultAlgorithms'
import { STANDARD_CASE_BY_ID } from '../src/lib/training/catalog/standardCases'
import { calibration as calibrationFixture, setup as setupFixture } from '../src/lib/training/persistenceFixtures.test-support'
import { appendTrainingAttempt, createTrainingAttempt, finishTrainingVisit } from '../src/lib/training/records'
import { createEmptyTrainingData } from '../src/lib/training/storage'
import { acknowledgeTrainingReport, beginTrainingSession } from '../src/lib/training/visits'
import type { TrainingCaseId, TrainingData, TrainingMode, TrainingSetId, TrainingVisit } from '../src/lib/training/types'

const TIMER = '[data-testid="timer-surface"]'
const DAY = 86_400_000
const OLL_CASES = ['oll:27', 'oll:26', 'oll:21'] as const

function algorithmFor(caseId: TrainingCaseId, revision = 1) {
  return { ...algorithmSnapshotFor(builtInAlgorithmForCase(caseId)!), revision }
}

/** Structural fixtures only: this exercises persistence, reports and charts, not cube verification. */
function setupFor(caseId: TrainingCaseId, mode: TrainingMode, generatedAt: number) {
  const setId = (caseId.startsWith('oll:') ? 'oll' : 'pll') as TrainingSetId
  const fixture = setupFixture(setId, mode)
  const generatorId = `${caseId}:integrated-fixture`
  return {
    ...fixture, generatedAt,
    generatorAlgorithm: { ...fixture.generatorAlgorithm, id: generatorId },
    generated: {
      ...fixture.generated, caseId, targetAlgorithmId: generatorId,
      verification: {
        ...fixture.generated.verification, identity: caseId,
        canonicalSignature: STANDARD_CASE_BY_ID.get(caseId)!.canonicalSignature,
      },
    },
  }
}

type AttemptSpec = {
  id: string
  visitId: string
  caseId: TrainingCaseId
  mode: TrainingMode
  createdAt: number
  rawMs: number
  tracking?: boolean
  revision?: number
  result?: 'none' | 'dnf'
  unsupported?: boolean
}

function makeAttempt(input: AttemptSpec) {
  const setId = (input.caseId.startsWith('oll:') ? 'oll' : 'pll') as TrainingSetId
  const algorithm = algorithmFor(input.caseId, input.revision)
  const createdAt = input.createdAt
  const calibration = input.mode === 'recognition'
    ? { ...calibrationFixture(setId), id: `integrated-calibration-${setId}`, measuredAt: createdAt - 5000 }
    : null
  const setup = setupFor(input.caseId, input.mode, createdAt - 1000)
  const attempt = createTrainingAttempt({
    id: input.id, visitId: input.visitId,
    createdAt, rawMs: input.rawMs,
    setup: {
      ...setup, generatorAlgorithm: algorithm,
      generated: { ...setup.generated, targetAlgorithmId: algorithm.id, targetAlgorithmNotation: algorithm.notation! },
    },
    preferredAlgorithm: input.tracking === false ? null : algorithm,
    algorithmTracking: input.tracking,
    calibration,
    result: { status: 'valid', penalty: input.result ?? 'none' },
  })
  if (!input.unsupported) return attempt
  const { rulesVersion: _rulesVersion, ...legacy } = attempt
  return { ...legacy, result: { status: 'valid' as const, penalty: '+2' as const }, estimatedRecognitionExecutionMs: null }
}

function sessionConfig(name: string, cases: readonly TrainingCaseId[]) {
  return { version: 1 as const, name, cases: cases.map(caseId => ({ caseId, algorithm: algorithmFor(caseId) })) }
}

function addNamedSession(data: TrainingData, input: {
  id: string
  name: string
  categoryId: `${TrainingSetId}:${TrainingMode}`
  cases: readonly TrainingCaseId[]
  startedAt: number
  attempts: readonly Omit<AttemptSpec, 'id' | 'visitId'>[]
}) {
  let next = beginTrainingSession(data, {
    id: input.id, at: input.startedAt, categoryId: input.categoryId,
    session: sessionConfig(input.name, input.cases),
  })
  input.attempts.forEach((attempt, index) => {
    next = appendTrainingAttempt(next, makeAttempt({
      ...attempt, id: `${input.id}-${index}`, visitId: input.id,
    }))
  })
  const last = input.attempts[input.attempts.length - 1]
  next = finishTrainingVisit(next, input.id, last ? last.createdAt + 1000 : input.startedAt + 1000, 'manual')
  return acknowledgeTrainingReport(next, input.id, 'session')
}

function withRecognitionCounts(data: TrainingData): TrainingData {
  const count = (setId: TrainingSetId) => data.attempts.filter(attempt =>
    attempt.setId === setId && attempt.mode === 'recognition' &&
    attempt.result.status === 'valid' && attempt.result.penalty !== '+2').length
  return { ...data, recognitionCounts: { oll: count('oll'), pll: count('pll') } }
}

function buildHistory(now: number): TrainingData {
  const base = createEmptyTrainingData()
  const legacyStart = now - 40 * DAY
  const legacyAttempts = [
    ...Array.from({ length: 6 }, (_, index) => makeAttempt({
      id: `legacy-success-${index}`, visitId: 'legacy-oll', caseId: 'oll:27',
      mode: 'execution', createdAt: legacyStart + index * 60_000, rawMs: 3000 - index * 20,
      tracking: index % 2 === 0,
    })),
    makeAttempt({
      id: 'legacy-unsupported', visitId: 'legacy-oll', caseId: 'oll:27', mode: 'execution',
      createdAt: legacyStart + 7 * 60_000, rawMs: 3333, unsupported: true,
    }),
  ]
  const legacy: TrainingVisit = {
    version: 1, id: 'legacy-oll', startedAt: legacyStart, endedAt: legacyStart + 8 * 60_000,
    startedCategoryId: 'oll:execution', categoryIds: ['oll:execution'],
    attemptIds: legacyAttempts.map(attempt => attempt.id), summaryId: null,
  }
  let data: TrainingData = { ...base, attempts: legacyAttempts, visits: [legacy] }

  data = addNamedSession(data, {
    id: 'execution-baseline', name: 'Execution baseline', categoryId: 'oll:execution',
    cases: ['oll:27', 'oll:26'], startedAt: now - 10 * DAY,
    attempts: ['oll:27', 'oll:26'].flatMap(caseId => [0, 1, 2].map(index => ({
      caseId, mode: 'execution' as const, createdAt: now - 10 * DAY + index * 60_000,
      rawMs: 2000 + index * 100, tracking: true,
    }))),
  })
  data = addNamedSession(data, {
    id: 'recognition-drill', name: 'OLL Recognition drill', categoryId: 'oll:recognition',
    cases: ['oll:27', 'oll:26'], startedAt: now - 5 * DAY,
    attempts: ['oll:27', 'oll:26'].flatMap(caseId => [0, 1, 2].map(index => ({
      caseId, mode: 'recognition' as const, createdAt: now - 5 * DAY + index * 60_000,
      rawMs: 4000 + index * 200, tracking: true,
    }))),
  })
  data = addNamedSession(data, {
    id: 'pll-drill', name: 'PLL check', categoryId: 'pll:execution',
    cases: ['pll:ua'], startedAt: now - 3 * DAY,
    attempts: [0, 1].map(index => ({
      caseId: 'pll:ua' as const, mode: 'execution' as const,
      createdAt: now - 3 * DAY + index * 60_000, rawMs: 3500 + index * 100,
    })),
  })
  return withRecognitionCounts({
    ...data,
    preferences: {
      ...data.preferences, selectedSetId: 'oll',
      sets: {
        ...data.preferences.sets,
        oll: { ...data.preferences.sets.oll, enabledCaseIds: ['oll:27'], includeSetupMoves: false },
      },
    },
  })
}

function buildChartHistory(now: number): TrainingData {
  const base = createEmptyTrainingData()
  const startedAt = now - 75 * DAY
  const attempts = [] as ReturnType<typeof makeAttempt>[]
  for (let day = 0; day < 75; day++) {
    for (let sample = 0; sample < 3; sample++) {
      const index = day * 3 + sample
      const tracking = day >= 30
      const revision = day >= 60 ? 2 : 1
      attempts.push(makeAttempt({
        id: `chart-${index}`, visitId: 'chart-legacy', caseId: OLL_CASES[index % OLL_CASES.length]!,
        mode: 'execution', createdAt: startedAt + day * DAY + sample * 60_000,
        rawMs: 2400 + (index % 11) * 90,
        tracking, revision: tracking ? revision : 1,
      }))
    }
  }
  const legacy: TrainingVisit = {
    version: 1, id: 'chart-legacy', startedAt, endedAt: now - 3 * 60 * 60_000,
    startedCategoryId: 'oll:execution', categoryIds: ['oll:execution'],
    attemptIds: attempts.map(attempt => attempt.id), summaryId: null,
  }
  let data: TrainingData = {
    ...base, attempts, visits: [legacy],
    preferences: {
      ...base.preferences, selectedSetId: 'oll',
      sets: { ...base.preferences.sets, oll: { ...base.preferences.sets.oll, enabledCaseIds: [...OLL_CASES] } },
    },
  }
  const sessionStart = now - 2 * 60 * 60_000
  data = beginTrainingSession(data, {
    id: 'chart-session', at: sessionStart, categoryId: 'oll:execution',
    session: sessionConfig('Chart review', OLL_CASES),
  })
  for (let index = 0; index < 60; index++) {
    data = appendTrainingAttempt(data, makeAttempt({
      id: `chart-session-${index}`, visitId: 'chart-session',
      caseId: OLL_CASES[index % OLL_CASES.length]!, mode: 'execution',
      createdAt: sessionStart + index * 60_000, rawMs: 2300 + (index % 9) * 80,
      tracking: index >= 20,
    }))
  }
  return data
}

async function seed(page: Page, data: TrainingData) {
  const raw = JSON.stringify(data)
  await page.addInitScript(value => {
    if (!sessionStorage.getItem('training-integrated-seeded')) {
      localStorage.setItem('cubelab:training:v1', value)
      sessionStorage.setItem('training-integrated-seeded', 'true')
    }
  }, raw)
  await page.goto('/')
  await page.getByTestId('training-nav').click()
  await expect(page.getByRole('heading', { name: 'Training Hub', exact: true })).toBeVisible()
}

async function read(page: Page): Promise<TrainingData> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('cubelab:training:v1')!))
}

async function resume(page: Page) {
  await page.getByRole('button', { name: 'Resume session', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Current session' })).toBeVisible()
  await expect(page.locator(TIMER)).toBeEnabled()
}

async function start(page: Page) {
  await expect(page.locator(TIMER)).toBeEnabled()
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur() })
  await page.keyboard.down('Space')
  await expect(page.locator(TIMER)).toHaveAttribute('data-phase', 'ready')
  await page.keyboard.up('Space')
  await expect(page.locator(TIMER)).toHaveAttribute('data-phase', 'running')
}

async function stop(page: Page) {
  await page.keyboard.press('Space')
  await expect(page.locator(TIMER)).toHaveAttribute('data-phase', 'idle')
}

async function attempt(page: Page) {
  await start(page)
  await page.waitForTimeout(80)
  await stop(page)
}

async function confirmEnd(page: Page) {
  await page.getByRole('region', { name: 'Current session' }).getByRole('button', { name: 'End session', exact: true }).click()
  await page.getByRole('group', { name: 'Confirm end session' }).getByRole('button', { name: 'End session', exact: true }).click()
}

async function dismissReport(page: Page, name: string) {
  const report = page.getByRole('dialog', { name })
  await expect(report).toBeVisible()
  await report.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByRole('heading', { name: 'Training Hub' })).toBeVisible()
}

async function measureArchiveReviewOpen(archive: Locator) {
  return archive.getByRole('button', { name: 'Review Chart review' }).evaluate(async button => {
    const started = performance.now()
    const deadline = started + 5000
    ;(button as HTMLElement).click()
    while (!document.querySelector('dialog[open] [aria-label="Practice report"]')) {
      if (performance.now() > deadline) throw new Error('Practice report did not open')
      await new Promise(resolve => requestAnimationFrame(resolve))
    }
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    return performance.now() - started
  })
}

async function measureAlgorithmsOpen(page: Page) {
  return page.getByRole('button', { name: 'Algorithms', exact: true }).evaluate(async button => {
    const started = performance.now()
    const deadline = started + 5000
    ;(button as HTMLElement).click()
    while (!document.querySelector('[data-testid="algorithms-progression"] [data-testid="analytics-chart-svg"]')) {
      if (performance.now() > deadline) throw new Error('Algorithms charts did not open')
      await new Promise(resolve => requestAnimationFrame(resolve))
    }
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    return performance.now() - started
  })
}

test('integrated legacy and named history survives capture, end, reload, review, deletion and Algorithms', async ({ page }) => {
  await seed(page, buildHistory(Date.now()))
  await expect(page.getByText('1 case selected', { exact: true })).toBeVisible()
  const recent = page.getByRole('region', { name: 'Recent sessions' })
  await expect(recent.getByRole('listitem')).toHaveCount(3)
  await expect(recent.getByRole('listitem').first()).toContainText('PLL check')
  await expect(recent.getByText('Legacy visit')).toHaveCount(0)

  await page.getByLabel('Session name').fill('Integrated drill')
  await page.getByRole('button', { name: 'Begin training', exact: true }).click()
  await expect(page.getByTestId('training-scramble')).toBeVisible()
  for (let index = 0; index < 5; index++) await attempt(page)
  const beforeEnd = await read(page)
  const live = beforeEnd.visits.find(visit => visit.id === beforeEnd.activeVisitId)!
  expect(live.session?.name).toBe('Integrated drill')
  expect(live.attemptIds).toHaveLength(5)

  await confirmEnd(page)
  const report = page.getByRole('dialog', { name: 'Integrated drill' })
  await expect(report).toBeVisible()
  const reportRegion = report.getByRole('region', { name: 'Practice report' })
  await expect(reportRegion).toContainText('Duration:')
  await expect(reportRegion).toContainText('Comparison uses the previous 90 days')
  await expect(reportRegion).toContainText('1 of 1 cases matched')
  await expect(reportRegion.getByTestId('training-report-chart').getByTestId('analytics-chart-svg')).toBeVisible()
  await expect(reportRegion.getByText('Mean measured')).toBeVisible()
  const afterEnd = await read(page)
  expect(afterEnd.attempts.filter(attempt => attempt.visitId === live.id).map(attempt => attempt.rawMs))
    .toEqual(beforeEnd.attempts.filter(attempt => attempt.visitId === live.id).map(attempt => attempt.rawMs))

  await page.reload()
  await expect(report).toBeVisible()
  await expect(reportRegion).toContainText('1 of 1 cases matched')
  expect((await read(page)).attempts.filter(attempt => attempt.visitId === live.id).map(attempt => attempt.rawMs))
    .toEqual(beforeEnd.attempts.filter(attempt => attempt.visitId === live.id).map(attempt => attempt.rawMs))
  await dismissReport(page, 'Integrated drill')

  await page.getByRole('button', { name: 'View all practice history', exact: true }).click()
  const archive = page.getByRole('dialog', { name: 'Practice history' })
  const review = archive.getByRole('button', { name: 'Review Integrated drill' })
  await review.click()
  const reviewed = page.getByRole('dialog', { name: 'Integrated drill' })
  await expect(reviewed.getByRole('region', { name: 'Practice report' })).toContainText('1 of 1 cases matched')
  await expect(reviewed.getByRole('button', { name: 'Delete attempt' })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(review).toBeFocused()

  await archive.getByRole('button', { name: 'Review Legacy visit' }).click()
  const legacy = page.getByRole('dialog', { name: 'Session report' })
  await expect(legacy.getByText('Comparison unavailable for this legacy visit.')).toBeVisible()
  await expect(legacy.getByText('Unsupported legacy')).toBeVisible()
  await legacy.getByText('Visit attempts').click()
  await expect(legacy.getByRole('button', { name: /Unavailable/ })).toBeVisible()
  await page.keyboard.press('Escape')

  await archive.getByRole('button', { name: 'Review OLL Recognition drill' }).click()
  const recognition = page.getByRole('dialog', { name: 'OLL Recognition drill' })
  const recognitionRegion = recognition.getByRole('region', { name: 'Practice report' })
  await expect(recognitionRegion).toContainText('Mean combined estimate')
  await expect(recognitionRegion).toContainText('Mean execution estimate')
  await expect(recognitionRegion).toContainText('Mean recognition estimate')
  await expect(recognitionRegion).toContainText('6/6 successes')
  await page.keyboard.press('Escape')

  const beforeDelete = await read(page)
  await archive.getByRole('button', { name: 'Delete Integrated drill' }).click()
  const confirm = page.getByRole('dialog', { name: 'Delete Integrated drill?' })
  await confirm.getByRole('textbox').fill('DELETE')
  await confirm.getByRole('button', { name: 'Delete session' }).click()
  await expect(archive.getByRole('button', { name: 'Review Integrated drill' })).toHaveCount(0)
  const afterDelete = await read(page)
  expect(afterDelete.visits).toEqual(beforeDelete.visits.filter(visit => visit.id !== live.id))
  expect(afterDelete.attempts).toEqual(beforeDelete.attempts.filter(item => item.visitId !== live.id))
  await archive.getByRole('button', { name: 'Close', exact: true }).click()

  await page.getByRole('button', { name: 'Algorithms', exact: true }).click()
  const analytics = page.getByRole('main', { name: 'Algorithms' })
  await analytics.getByLabel('Date range').selectOption('0')
  const summary = analytics.getByRole('region', { name: 'Practice summary' })
  await expect(analytics.getByTestId('algorithms-attempt-count')).toHaveText('13')
  await expect(summary).toContainText('Unsupported legacy')
  await analytics.getByTestId('training-set-select').click()
  await page.getByTestId('training-set-select-option-pll').click()
  await expect(analytics.getByTestId('algorithms-attempt-count')).toHaveText('2')
  await analytics.getByRole('button', { name: 'Recognition (BETA)', exact: true }).click()
  await expect(analytics.getByTestId('algorithms-attempt-count')).toHaveText('0')
  await analytics.getByTestId('training-set-select').click()
  await page.getByTestId('training-set-select-option-oll').click()
  await expect(analytics.getByTestId('algorithms-attempt-count')).toHaveText('6')
  await expect(analytics.getByTestId('algorithms-progression').getByTestId('analytics-chart-svg')).toBeVisible()
  await expect(analytics.getByTestId('algorithms-volume').getByTestId('analytics-chart-svg')).toBeVisible()
  await analytics.getByRole('button', { name: 'Start new session' }).click()
  await expect(page.getByRole('heading', { name: 'Training Hub', exact: true })).toBeVisible()
  expect((await read(page)).activeVisitId).toBeNull()
})

test('chart-heavy legacy and active history renders reports and Algorithms across themes, viewports, keyboard and touch', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const seeded = buildChartHistory(Date.now())
  await seed(page, seeded)
  await resume(page)
  const historyBytes = await page.evaluate(() => new Blob([localStorage.getItem('cubelab:training:v1')!]).size)
  test.info().annotations.push({ type: 'measurement', description: `seeded Training history: ${seeded.attempts.length} attempts, ${historyBytes} bytes` })
  await page.getByTestId('settings-button').click()
  await chooseTestOption(page, 'theme-setting', 'system')
  await page.getByTestId('settings-done').click()
  await attempt(page)
  const saved = (await read(page)).attempts.filter(item => item.visitId === 'chart-session')
  const beforeRender = saved.map(item => ({ id: item.id, rawMs: item.rawMs, createdAt: item.createdAt }))

  await confirmEnd(page)
  const report = page.getByRole('dialog', { name: 'Chart review' })
  const reportRegion = report.getByRole('region', { name: 'Practice report' })
  const chart = reportRegion.getByTestId('training-report-chart')
  const plot = report.getByRole('group', { name: /^Attempt order chart/ })
  await expect(report).toBeVisible()
  await expect(chart.getByTestId('analytics-chart-svg')).toBeVisible()
  await expect(reportRegion).toContainText('61')

  for (const [width, height] of [[1440, 900], [1024, 768], [390, 844], [320, 740]] as const) {
    await page.setViewportSize({ width, height })
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      expect(await report.evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth)).toBe(true)
      const svg = (await chart.getByTestId('analytics-chart-svg').boundingBox())!
      expect(svg.width).toBeGreaterThan(240)
      expect(svg.height).toBeGreaterThan(140)
    }
  }

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' })
  const reportAudit = await new AxeBuilder({ page }).analyze()
  expect(reportAudit.violations.filter(violation => violation.impact === 'serious' || violation.impact === 'critical')).toEqual([])

  await plot.focus()
  await plot.press('ArrowLeft')
  await expect(report.getByTestId('analytics-chart-tooltip')).toContainText('Measured time')
  await plot.press('Enter')
  const detail = page.getByRole('dialog', { name: 'Attempt details' })
  await expect(detail).toBeVisible()
  await expect(detail.getByRole('button', { name: 'Delete attempt' })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(plot).toBeFocused()

  const pointer = { pointerId: 77, pointerType: 'touch', button: 0, isPrimary: true }
  const box = (await plot.boundingBox())!
  await plot.evaluate(element => {
    element.setPointerCapture = () => {}
    element.releasePointerCapture = () => {}
  })
  await plot.dispatchEvent('pointerdown', { ...pointer, clientX: box.x + box.width * 0.5, clientY: box.y + box.height * 0.5 })
  await plot.dispatchEvent('pointerup', { ...pointer, clientX: box.x + box.width * 0.5, clientY: box.y + box.height * 0.5 })
  await expect(detail).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(plot).toBeFocused()

  await dismissReport(page, 'Chart review')
  const afterRender = (await read(page)).attempts.filter(item => item.visitId === 'chart-session')
    .map(item => ({ id: item.id, rawMs: item.rawMs, createdAt: item.createdAt }))
  expect(afterRender).toEqual(beforeRender)

  const reviewed = page.getByRole('dialog', { name: 'Chart review' })
  const reportSamples: number[] = []
  for (let sample = 0; sample < 3; sample++) {
    await page.getByRole('button', { name: 'View all practice history', exact: true }).click()
    const archive = page.getByRole('dialog', { name: 'Practice history' })
    await expect(archive).toBeVisible()
    reportSamples.push(await measureArchiveReviewOpen(archive))
    await expect(reviewed.getByRole('region', { name: 'Practice report' })).toBeVisible()
    await reviewed.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(archive).toBeVisible()
    await archive.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(archive).toBeHidden()
  }
  reportSamples.sort((left, right) => left - right)
  test.info().annotations.push({
    type: 'measurement',
    description: `archive review open (3 samples): ${reportSamples.map(value => value.toFixed(1)).join(', ')} ms`,
  })

  const analyticsOpenMs = await measureAlgorithmsOpen(page)
  const analytics = page.getByRole('main', { name: 'Algorithms' })
  await expect(analytics.getByTestId('algorithms-progression').getByTestId('analytics-chart-svg')).toBeVisible()
  test.info().annotations.push({ type: 'measurement', description: `algorithms open with charts: ${analyticsOpenMs.toFixed(1)} ms` })
  await analytics.getByLabel('Date range').selectOption('0')
  await expect(analytics.getByTestId('algorithms-attempt-count')).toHaveText('286')
  await expect(analytics.getByTestId('algorithms-progression').getByTestId('analytics-chart-svg')).toBeVisible()
  await expect(analytics.getByTestId('algorithms-volume').getByTestId('analytics-chart-svg')).toBeVisible()

  for (const [width, height] of [[1440, 900], [320, 740]] as const) {
    await page.setViewportSize({ width, height })
    for (const theme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      const svg = (await analytics.getByTestId('algorithms-progression').getByTestId('analytics-chart-svg').boundingBox())!
      expect(svg.width).toBeGreaterThan(240)
      expect(svg.height).toBeGreaterThan(140)
    }
  }
  const analyticsAudit = await new AxeBuilder({ page }).analyze()
  expect(analyticsAudit.violations.filter(violation => violation.impact === 'serious' || violation.impact === 'critical')).toEqual([])
})
