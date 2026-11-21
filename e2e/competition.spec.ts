import { expect, test, type Page } from '@playwright/test'
import { chooseTestOption } from './interactions'

const TIMER = '[data-testid="timer-surface"]'
const NOW = Date.now()

interface SeedSolve {
  id: string
  event: string
  rawMs: number
  penalty: 'none' | '+2' | 'dnf'
  scramble: string
  comment: string
  createdAt: number
  roundId?: string
  roundIndex?: number
}

interface SeedSession {
  id: string
  name: string
  event: string
  createdAt: number
  updatedAt: number
  solves: SeedSolve[]
  kind?: 'practice' | 'competition'
  competitionFormat?: { type: 'ao' | 'mo' | 'bo'; size: 3 | 5 | 12 | 50 }
}

interface SeedData {
  version: number
  activeSessionId: string
  sessions: SeedSession[]
  sessionOrder?: { ids: string[]; updatedAt: number; editorId: string }
}

function solve(
  id: string,
  rawMs: number,
  createdAt: number,
  options: Partial<SeedSolve> = {},
): SeedSolve {
  return {
    id,
    event: '333',
    rawMs,
    penalty: 'none',
    scramble: `R U R' U' F2 L D B2 ${id}`,
    comment: '',
    createdAt,
    ...options,
  }
}

function competition(
  id: string,
  name: string,
  solves: SeedSolve[],
  format: SeedSession['competitionFormat'] = { type: 'ao', size: 5 },
): SeedSession {
  return {
    id,
    name,
    event: '333',
    kind: 'competition',
    competitionFormat: format,
    createdAt: NOW - 100_000,
    updatedAt: NOW,
    solves,
  }
}

function practice(id: string, name: string, solves: SeedSolve[]): SeedSession {
  return {
    id,
    name,
    event: '333',
    createdAt: NOW - 100_000,
    updatedAt: NOW,
    solves,
  }
}

async function seed(page: Page, data: SeedData, key: string) {
  await page.addInitScript(
    ({ payload, marker }) => {
      if (sessionStorage.getItem(marker)) return
      sessionStorage.setItem(marker, '1')
      localStorage.setItem('cubelab:sessions:v1', JSON.stringify(payload))
      localStorage.setItem('cubelab:settings:v1', JSON.stringify({ version: 12, settings: { inspectionEnabled: false, holdDurationMs: 0 } }))
      localStorage.removeItem('cubelab:sync:v1')
    },
    { payload: data, marker: key },
  )
}

async function waitForApp(page: Page) {
  await expect(page.locator('.scramble-text')).toBeVisible({ timeout: 30_000 })
}

async function stored(page: Page): Promise<SeedData> {
  return page.evaluate(() =>
    JSON.parse(localStorage.getItem('cubelab:sessions:v1')!),
  )
}

async function holdSpace(page: Page) {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
  })
  await page.keyboard.down('Space')
  await expect(page.locator(TIMER)).toHaveAttribute('data-phase', 'ready', {
    timeout: 3_000,
  })
  await page.keyboard.up('Space')
  await expect(page.locator(TIMER)).toHaveAttribute('data-phase', 'running')
}

async function stopWithSpace(page: Page) {
  await page.keyboard.press('Space')
  await expect(page.locator(TIMER)).toHaveAttribute('data-phase', 'idle')
}

async function recordSolve(page: Page, durationMs = 90) {
  await holdSpace(page)
  await page.waitForTimeout(durationMs)
  await stopWithSpace(page)
}

async function recordInspectedSolve(page: Page, durationMs = 90) {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
  })
  await page.keyboard.press('Space')
  await expect(page.locator(TIMER)).toHaveAttribute('data-phase', 'inspection')
  await holdSpace(page)
  await page.waitForTimeout(durationMs)
  await stopWithSpace(page)
}

async function deleteSolve(page: Page, id: string) {
  const row = page.locator(`[data-solve-id="${id}"]`)
  await row.locator('[data-testid="history-main"]').click()
  await page
    .getByRole('menu')
    .getByRole('menuitem', { name: 'Delete solve' })
    .click()
}

async function openSessionSettings(page: Page) {
  await page.getByTestId('session-settings').click()
  const dialog = page.getByRole('dialog', { name: 'Session settings' })
  await expect(dialog).toBeVisible()
  return dialog
}

test('creates an ao5 competition session, completes an inspected round and persists', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await page.goto('/')
  await waitForApp(page)

  await page.getByTestId('new-session').click()
  const create = page.getByRole('dialog', { name: 'Create new session' })
  await create.getByRole('textbox', { name: 'Session name' }).fill('Friday')
  await create.getByTestId('session-setup-kind-competition').click()
  await expect(create.getByTestId('session-setup-format')).toContainText(
    'ao5',
  )
  const inspection = create.getByRole('switch', { name: 'Enable inspection' })
  if ((await inspection.getAttribute('aria-checked')) !== 'true') {
    await inspection.click()
  }
  await create.getByRole('button', { name: 'Create session', exact: true }).click()
  await expect(create).toBeHidden()

  const created = await stored(page)
  const session = created.sessions.find((entry) => entry.id === created.activeSessionId)!
  expect(session).toMatchObject({
    name: 'Friday',
    kind: 'competition',
    competitionFormat: { type: 'ao', size: 5 },
  })

  await page.getByTestId('session-select').click()
  await expect(page.getByTestId(`session-format-${session.id}`)).toHaveText('ao5')
  await page.keyboard.press('Escape')

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await recordInspectedSolve(page)
  }

  const summary = page.getByTestId('competition-round-summary')
  await expect(summary).toBeVisible()
  await expect(summary).toContainText('Round 1')
  await expect(summary).toContainText('ao5 round complete')
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    await expect(
      summary.getByTestId(`competition-summary-attempt-${attempt}`),
    ).toBeVisible()
  }
  await summary.getByRole('button', { name: 'Done' }).click()
  await expect(summary).toBeHidden()

  await expect(page.getByTestId('competition-round-header-1')).toContainText(
    '5/5',
  )
  const completed = await stored(page)
  const completedSession = completed.sessions.find(
    (entry) => entry.id === completed.activeSessionId,
  )!
  const roundSolves = completedSession.solves
  expect(roundSolves).toHaveLength(5)
  expect(new Set(roundSolves.map((entry) => entry.roundId)).size).toBe(1)
  expect(roundSolves.map((entry) => entry.roundIndex).sort()).toEqual([
    0, 1, 2, 3, 4,
  ])

  await page.reload()
  await waitForApp(page)
  await expect(page.getByTestId('competition-round-header-1')).toContainText(
    '5/5',
  )
  await expect(page.getByTestId('competition-round-summary')).toBeHidden()
  const reloaded = await stored(page)
  const reloadedSession = reloaded.sessions.find(
    (entry) => entry.id === reloaded.activeSessionId,
  )!
  expect(reloadedSession).toMatchObject({
    kind: 'competition',
    competitionFormat: { type: 'ao', size: 5 },
  })
  expect(reloadedSession.solves).toEqual(completedSession.solves)
})

test('keeps incomplete rounds, updates penalties and restores or removes rounds', async ({
  page,
}) => {
  test.setTimeout(90_000)
  const first = [0, 1, 2, 3, 4].map((index) =>
    solve(`r1-${index}`, 10_000 + index * 1_000, NOW - 20_000 + index * 1_000, {
      roundId: 'round-1',
      roundIndex: index,
    }),
  )
  const second = [0, 1].map((index) =>
    solve(`r2-${index}`, 9_000, NOW - 5_000 + index * 1_000, {
      roundId: 'round-2',
      roundIndex: index,
    }),
  )
  const data: SeedData = {
    version: 7,
    activeSessionId: 'competition',
    sessions: [
      competition('competition', 'Friday', [...second, ...first].reverse()),
    ],
  }
  await seed(page, data, 'cubelab-competition-structure')
  await page.goto('/')
  await waitForApp(page)

  await expect(page.getByTestId('competition-round-header-1')).toContainText(
    '12.00',
  )
  await expect(page.getByTestId('competition-round-header-2')).toContainText(
    'Incomplete · 2/5',
  )

  const firstRoundRow = page.locator('[data-solve-id="r1-0"]')
  await firstRoundRow.getByTestId('solve-dnf').click()
  await expect(page.getByTestId('competition-round-header-1')).toContainText(
    '13.00',
  )
  await firstRoundRow.getByTestId('solve-dnf').click()
  await expect(page.getByTestId('competition-round-header-1')).toContainText(
    '12.00',
  )

  await deleteSolve(page, 'r1-2')
  await expect(page.getByTestId('competition-round-header-1')).toContainText(
    'Incomplete · 4/5',
  )
  await page.getByRole('button', { name: 'Undo' }).last().click()
  await expect(page.getByTestId('competition-round-header-1')).toContainText(
    '5/5',
  )

  await deleteSolve(page, 'r2-0')
  await deleteSolve(page, 'r2-1')
  await expect(page.getByTestId('competition-round-header-2')).toHaveCount(0)
  const afterDeletion = await stored(page)
  expect(
    afterDeletion.sessions[0]!.solves.every(
      (entry) => entry.roundId !== 'round-2',
    ),
  ).toBe(true)
})

test('merges practice and competition sources, splits with a format and converts to practice', async ({
  page,
}) => {
  test.setTimeout(120_000)
  const target = competition('target', 'Target competition', [
    solve('c1', 12_000, NOW - 2_000, {
      roundId: 'target-round',
      roundIndex: 1,
    }),
    solve('c0', 13_000, NOW - 3_000, {
      roundId: 'target-round',
      roundIndex: 0,
    }),
  ])
  const practiceSource = practice('practice-source', 'Practice source', [
    solve('p1', 11_000, NOW - 1_000),
    solve('p0', 10_000, NOW - 4_000),
  ])
  const competitionSource = competition('competition-source', 'Other competition', [
    solve('q0', 9_000, NOW - 500, {
      roundId: 'other-round',
      roundIndex: 3,
    }),
  ])
  await seed(
    page,
    {
      version: 7,
      activeSessionId: 'target',
      sessions: [target, practiceSource, competitionSource],
      sessionOrder: {
        ids: ['target', 'practice-source', 'competition-source'],
        updatedAt: NOW,
        editorId: 'seed',
      },
    },
    'cubelab-competition-merge',
  )
  await page.goto('/')
  await waitForApp(page)

  let settings = await openSessionSettings(page)
  await settings.getByTestId('session-merge').click()
  let merge = page.getByRole('dialog', { name: 'Merge sessions' })
  await merge.getByTestId('merge-source-practice-source').check()
  await merge.locator('#merge-phrase').fill('MERGE SESSIONS')
  await merge.getByRole('button', { name: 'Confirm merge' }).click()
  await expect(merge).toBeHidden()

  let afterPracticeMerge = await stored(page)
  expect(afterPracticeMerge.sessions.map((entry) => entry.id)).not.toContain(
    'practice-source',
  )
  let mergedTarget = afterPracticeMerge.sessions.find(
    (entry) => entry.id === 'target',
  )!
  expect(
    mergedTarget.solves.find((entry) => entry.id === 'p0'),
  ).toMatchObject({
    roundId: 'target-round',
    roundIndex: 2,
  })
  expect(
    mergedTarget.solves.find((entry) => entry.id === 'p1'),
  ).toMatchObject({
    roundId: 'target-round',
    roundIndex: 3,
  })

  settings = await openSessionSettings(page)
  await settings.getByTestId('session-merge').click()
  merge = page.getByRole('dialog', { name: 'Merge sessions' })
  await merge.getByTestId('merge-source-competition-source').check()
  await merge.locator('#merge-phrase').fill('MERGE SESSIONS')
  await merge.getByRole('button', { name: 'Confirm merge' }).click()
  await expect(merge).toBeHidden()
  const completedRound = page.getByTestId('competition-round-summary')
  await expect(completedRound).toBeVisible()
  await completedRound.getByRole('button', { name: 'Done' }).click()
  await expect(completedRound).toBeHidden()

  const afterCompetitionMerge = await stored(page)
  expect(afterCompetitionMerge.sessions.map((entry) => entry.id)).not.toContain(
    'competition-source',
  )
  mergedTarget = afterCompetitionMerge.sessions.find(
    (entry) => entry.id === 'target',
  )!
  expect(
    mergedTarget.solves.find((entry) => entry.id === 'q0'),
  ).toMatchObject({
    roundId: 'target-round',
    roundIndex: 4,
  })

  settings = await openSessionSettings(page)
  await settings.getByTestId('session-split').click()
  const split = page.getByRole('dialog', {
    name: 'Move solves to a new session',
  })
  await split.getByTestId('split-solve-0').check()
  await split.getByTestId('split-solve-1').check()
  await split.getByTestId('split-session-kind-competition').click()
  await chooseTestOption(page, 'split-session-format', 'bo3')
  await split.locator('#split-phrase').fill('SPLIT SESSION')
  await split.getByRole('button', { name: 'Confirm split' }).click()
  await expect(split).toBeHidden()

  const afterSplit = await stored(page)
  const splitSession = afterSplit.sessions.find(
    (entry) => entry.id === afterSplit.activeSessionId,
  )!
  expect(splitSession).toMatchObject({
    kind: 'competition',
    competitionFormat: { type: 'bo', size: 3 },
  })
  expect(splitSession.solves).toHaveLength(2)
  expect(splitSession.solves.every((entry) => entry.roundId)).toBe(true)

  settings = await openSessionSettings(page)
  await settings.getByTestId('session-convert-practice').click()
  const confirm = page.getByRole('dialog', {
    name: /Convert .* to practice\?/,
  })
  await confirm.getByTestId('confirm-text').fill('CONVERT TO PRACTICE')
  await confirm.getByRole('button', { name: 'Convert to practice' }).click()

  const afterConversion = await stored(page)
  const converted = afterConversion.sessions.find(
    (entry) => entry.id === splitSession.id,
  )!
  expect(converted.kind).toBeUndefined()
  expect(converted.competitionFormat).toBeUndefined()
  expect(
    converted.solves.every(
      (entry) => entry.roundId === undefined && entry.roundIndex === undefined,
    ),
  ).toBe(true)
})

test('filters Analytics by competition and practice session type', async ({
  page,
}) => {
  const competitionSession = competition('competition', 'Friday', [
    solve('comp-2', 9_000, NOW - 1_000),
    solve('comp-1', 10_000, NOW - 2_000, {
      roundId: 'round-1',
      roundIndex: 0,
    }),
  ])
  const practiceSession = practice('practice', 'Practice', [
    solve('practice-2', 14_000, NOW - 3_000),
    solve('practice-1', 15_000, NOW - 4_000),
  ])
  await seed(
    page,
    {
      version: 7,
      activeSessionId: 'practice',
      sessions: [practiceSession, competitionSession],
    },
    'cubelab-competition-analytics',
  )
  await page.goto('/')
  await waitForApp(page)
  await page.getByTestId('analytics-nav').click()
  await expect(
    page.getByRole('heading', { name: 'Analytics', exact: true }),
  ).toBeVisible()
  await expect(page.getByText('4 matching solves')).toBeVisible()

  await chooseTestOption(page, 'analytics-session-kind', 'competition')
  await expect(page.getByText('2 matching solves')).toBeVisible()
  await page.getByTestId('analytics-reset-filters').click()
  await expect(page.getByText('4 matching solves')).toBeVisible()

  await chooseTestOption(page, 'analytics-session-kind', 'practice')
  await expect(page.getByText('2 matching solves')).toBeVisible()
})

test('completes a competition round while the installed app is offline', async ({
  page,
  context,
  browserName,
}) => {
  test.skip(
    browserName !== 'chromium',
    'Service-worker offline coverage remains Chromium-only in this environment.',
  )
  test.setTimeout(90_000)
  const solves = [0, 1, 2, 3].map((index) =>
    solve(`offline-${index}`, 11_000 + index * 100, NOW - 10_000 + index * 1_000, {
      roundId: 'offline-round',
      roundIndex: index,
    }),
  )
  await seed(
    page,
    {
      version: 7,
      activeSessionId: 'offline',
      sessions: [competition('offline', 'Offline Friday', solves.reverse())],
    },
    'cubelab-competition-offline',
  )
  await page.goto('/')
  await waitForApp(page)
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), {
      timeout: 15_000,
    })
    .toBe(true)

  await context.setOffline(true)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await waitForApp(page)
  await recordSolve(page, 90)

  const summary = page.getByTestId('competition-round-summary')
  await expect(summary).toBeVisible()
  await expect(summary).toContainText('Round 1')
  await summary.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByTestId('competition-round-header-1')).toContainText(
    '5/5',
  )
  const offline = await stored(page)
  const completed = offline.sessions[0]!.solves[0]!
  expect(completed).toMatchObject({
    roundId: 'offline-round',
    roundIndex: 4,
  })
  await context.setOffline(false)
})
