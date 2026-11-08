import { expect, test, type Page } from '@playwright/test'
import { selectSessionByName, sessionNames } from './interactions'

import { simulateLegacyConcurrentTabs } from './legacy-tabs'

// Legacy-client simulations retain lower-level reconciliation coverage.
// Current single-tab behavior is exercised without mocks in single-tab.spec.ts.
const TIMER = '[data-testid="timer-surface"]'

async function waitForApp(page: Page) {
  await expect(page.locator('.scramble-text')).toBeVisible({ timeout: 30_000 })
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

async function selectedSessionName(page: Page): Promise<string> {
  return page
    .getByTestId('session-select')
    .evaluate((element) => element.textContent?.trim() ?? '')
}

async function storedSessions(page: Page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem('cubelab:sessions:v1')
    return raw ? JSON.parse(raw) : null
  })
}

test('cross-tab timing is not redirected and reconciles when idle', async ({
  browser,
  browserName,
}) => {
  test.skip(browserName === 'webkit', 'WebKit keyboard timing is not reliable in this flow.')
  const pageErrors: string[] = []
  const context = await browser.newContext()
  await simulateLegacyConcurrentTabs(context)
  const pageA = await context.newPage()
  const pageB = await context.newPage()
  pageA.on('pageerror', (error) => pageErrors.push(error.message))
  pageB.on('pageerror', (error) => pageErrors.push(error.message))

  const seed = () => {
    const now = Date.now()
    localStorage.setItem(
      'cubelab:sessions:v1',
      JSON.stringify({
        version: 4,
        activeSessionId: 'session-1',
        sessions: [
          {
            id: 'session-1',
            name: 'Morning',
            event: '333',
            createdAt: now,
            updatedAt: now,
            solves: [],
          },
          {
            id: 'session-2',
            name: 'Evening',
            event: '333',
            createdAt: now,
            updatedAt: now,
            solves: [],
          },
        ],
      }),
    )
  }
  await pageA.addInitScript(seed)
  await pageB.addInitScript(seed)

  await pageA.goto('/')
  await pageB.goto('/')
  await waitForApp(pageA)
  await waitForApp(pageB)

  expect(await selectedSessionName(pageA)).toBe('Morning')
  expect(await selectedSessionName(pageB)).toBe('Morning')

  // Page A starts timing.
  await holdSpace(pageA)
  await expect(pageA.locator(TIMER)).toHaveAttribute('data-phase', 'running')

  // Page B switches the active session while Page A is timing.
  await selectSessionByName(pageB, 'Evening')
  expect(await selectedSessionName(pageB)).toBe('Evening')
  await pageB.waitForTimeout(200)

  // Page A must not redirect or replace its collection mid-timing.
  await expect(pageA.locator(TIMER)).toHaveAttribute('data-phase', 'running')
  expect(await selectedSessionName(pageA)).toBe('Morning')
  await expect(pageA.getByTestId('solve-count')).toHaveText('0')

  // Close Page B so its idle storage listener cannot adopt Page A's solve write
  // and race the active selection back to Morning. Page A's deferred external
  // snapshot is now stable: Evening is active and Morning has no solves.
  await pageB.close()

  await pageA.waitForTimeout(120)

  // Finish the solve, then reconciliation runs once idle. The external active
  // selection is authoritative, so Page A adopts Evening; the completed solve
  // must still land in Morning.
  await stopWithSpace(pageA)
  await expect
    .poll(() => selectedSessionName(pageA))
    .toBe('Evening')
  await expect(pageA.getByTestId('solve-count')).toHaveText('0')

  // The solve stays with the original session.
  const stored = await storedSessions(pageA)
  const morning = stored?.sessions.find(
    (session: { id: string }) => session.id === 'session-1',
  )
  expect(morning?.solves).toHaveLength(1)

  expect(pageErrors).toEqual([])
  await context.close()
})

function seedReplacementPair() {
  if (sessionStorage.getItem('replacement-pair-seeded')) return
  sessionStorage.setItem('replacement-pair-seeded', '1')
  const now = Date.now()
  localStorage.setItem(
    'cubelab:sessions:v1',
    JSON.stringify({
      version: 6,
      activeSessionId: 'replacement-a',
      sessions: [
        {
          id: 'replacement-a',
          name: 'Original A',
          event: '333',
          createdAt: now,
          updatedAt: now,
          solves: [],
        },
        {
          id: 'replacement-b',
          name: 'Other B',
          event: '222',
          createdAt: now,
          updatedAt: now,
          solves: [],
        },
      ],
    }),
  )
}

async function writePreparedReclassifiedReplacement(page: Page) {
  return page.evaluate(() => {
    const sessionsKey = 'cubelab:sessions:v1'
    const journalKey = 'cubelab:replacement:v1'
    const before = localStorage.getItem(sessionsKey)!
    const next = JSON.parse(before) as {
      activeSessionId: string
      sessions: Array<{ id: string; name: string; event: string; solves: unknown[] }>
    }
    next.activeSessionId = 'replacement-b'
    next.sessions = next.sessions.map((session) =>
      session.id === 'replacement-a'
        ? { ...session, name: 'Reclassified A', event: '222', solves: [] }
        : session,
    )
    const journal = {
      version: 1,
      operationId: 'cross-tab-reclassified-replacement',
      kind: 'native-import',
      phase: 'prepared',
      createdAt: Date.now(),
      before: { sessions: before },
    }
    localStorage.setItem(journalKey, JSON.stringify(journal))
    localStorage.setItem(sessionsKey, JSON.stringify(next))
    return next.activeSessionId
  })
}

async function writeCommittedReplacement(page: Page, commit: boolean) {
  return page.evaluate((shouldCommit) => {
    const sessionsKey = 'cubelab:sessions:v1'
    const journalKey = 'cubelab:replacement:v1'
    const before = localStorage.getItem(sessionsKey)!
    const next = JSON.parse(before) as {
      activeSessionId: string
      sessions: Array<{ name: string }>
    }
    next.activeSessionId = 'replacement-b'
    next.sessions[0]!.name = 'Replacement candidate'
    const journal = {
      version: 1,
      operationId: 'cross-tab-running-replacement',
      kind: 'native-import',
      phase: 'prepared',
      createdAt: Date.now(),
      before: { sessions: before },
    }
    localStorage.setItem(journalKey, JSON.stringify(journal))
    localStorage.setItem(sessionsKey, JSON.stringify(next))
    if (shouldCommit) {
      localStorage.setItem(
        journalKey,
        JSON.stringify({ ...journal, phase: 'committed', before: {} }),
      )
    }
    return next.activeSessionId
  }, commit)
}

test('a committed cross-tab replacement waits for a running solve and preserves its original owner', async ({
  browser,
  browserName,
}) => {
  test.skip(browserName === 'webkit', 'WebKit keyboard timing is not reliable in this flow.')
  const context = await browser.newContext()
  await simulateLegacyConcurrentTabs(context)
  const pageA = await context.newPage()
  const pageB = await context.newPage()
  await pageA.addInitScript(seedReplacementPair)
  await pageB.addInitScript(seedReplacementPair)
  await pageA.goto('/')
  await pageB.goto('/')
  await waitForApp(pageA)
  await waitForApp(pageB)

  expect(await selectedSessionName(pageA)).toBe('Original A')
  await holdSpace(pageA)
  const originalScramble = await pageA.locator('.scramble-text').textContent()

  await writeCommittedReplacement(pageB, true)
  await pageA.waitForTimeout(300)

  await expect(pageA.locator(TIMER)).toHaveAttribute('data-phase', 'running')
  expect(await selectedSessionName(pageA)).toBe('Original A')
  await expect(pageA.locator('.scramble-badge')).toContainText('3×3')
  await expect(pageA.getByTestId('solve-count')).toHaveText('0')

  await pageB.close()
  await stopWithSpace(pageA)
  await expect
    .poll(() => selectedSessionName(pageA))
    .toBe('Other B')

  const stored = await storedSessions(pageA)
  expect(stored?.activeSessionId).toBe('replacement-b')
  expect(
    await pageA.evaluate(() =>
      localStorage.getItem('cubelab:replacement:v1'),
    ),
  ).toBeNull()
  expect(
    await pageA.evaluate(() =>
      localStorage.getItem('cubelab:replacement-completion:v1'),
    ),
  ).toBeNull()
  const original = stored?.sessions.find(
    (session: { id: string }) => session.id === 'replacement-a',
  )
  const replacement = stored?.sessions.find(
    (session: { id: string }) => session.id === 'replacement-b',
  )
  expect(original?.solves).toHaveLength(1)
  expect(original?.solves[0]).toMatchObject({
    event: '333',
    penalty: 'none',
    scramble: originalScramble,
  })
  expect(original?.solves[0]?.rawMs).toBeGreaterThan(0)
  expect(replacement?.solves).toEqual([])

  await pageA.reload()
  await waitForApp(pageA)
  expect(await selectedSessionName(pageA)).toBe('Other B')
  const reloaded = await storedSessions(pageA)
  expect(
    reloaded?.sessions.find(
      (session: { id: string }) => session.id === 'replacement-a',
    )?.solves,
  ).toHaveLength(1)
  expect(
    reloaded?.sessions.find(
      (session: { id: string }) => session.id === 'replacement-b',
    )?.solves,
  ).toEqual([])

  await context.close()
})

test('a solve completed during a prepared replacement is not written over its candidate', async ({
  browser,
  browserName,
}) => {
  test.skip(browserName === 'webkit', 'WebKit keyboard timing is not reliable in this flow.')
  const context = await browser.newContext()
  await simulateLegacyConcurrentTabs(context)
  const pageA = await context.newPage()
  const pageB = await context.newPage()
  await pageA.addInitScript(seedReplacementPair)
  await pageB.addInitScript(seedReplacementPair)
  await pageA.goto('/')
  await pageB.goto('/')
  await waitForApp(pageA)
  await waitForApp(pageB)

  await holdSpace(pageA)
  const originalScramble = await pageA.locator('.scramble-text').textContent()
  await writeCommittedReplacement(pageB, false)

  await stopWithSpace(pageA)
  await expect(pageA.getByTestId('solve-count')).toHaveText('1')
  const duringPreparation = await storedSessions(pageA)
  expect(duringPreparation?.activeSessionId).toBe('replacement-b')
  const stagedOriginal = duringPreparation?.sessions.find(
    (session: { id: string }) => session.id === 'replacement-a',
  )
  expect(stagedOriginal?.solves).toEqual([])

  await pageB.evaluate(() => {
    const key = 'cubelab:replacement:v1'
    const journal = JSON.parse(localStorage.getItem(key)!) as Record<
      string,
      unknown
    >
    localStorage.setItem(
      key,
      JSON.stringify({ ...journal, phase: 'committed', before: {} }),
    )
  })
  await expect
    .poll(() => selectedSessionName(pageA))
    .toBe('Other B')
  await pageB.close()

  const stored = await storedSessions(pageA)
  expect(
    stored?.sessions.find(
      (session: { id: string }) => session.id === 'replacement-a',
    )?.solves[0],
  ).toMatchObject({
    event: '333',
    scramble: originalScramble,
  })
  expect(stored?.sessions.find((session: { id: string }) => session.id === 'replacement-b')?.solves).toEqual([])

  await pageA.reload()
  await waitForApp(pageA)
  const reloaded = await storedSessions(pageA)
  expect(
    reloaded?.sessions.find(
      (session: { id: string }) => session.id === 'replacement-a',
    )?.solves,
  ).toHaveLength(1)
  await context.close()
})

test('a committed reclassification keeps a prepared-phase solve event-compatible', async ({
  browser,
  browserName,
}) => {
  test.skip(browserName === 'webkit', 'WebKit keyboard timing is not reliable in this flow.')
  const context = await browser.newContext()
  await simulateLegacyConcurrentTabs(context)
  const pageA = await context.newPage()
  const pageB = await context.newPage()
  await pageA.addInitScript(seedReplacementPair)
  await pageB.addInitScript(seedReplacementPair)
  await pageA.goto('/')
  await pageB.goto('/')
  await waitForApp(pageA)
  await waitForApp(pageB)

  await holdSpace(pageA)
  const originalScramble = await pageA.locator('.scramble-text').textContent()
  await writePreparedReclassifiedReplacement(pageB)
  await pageB.waitForTimeout(200)

  await stopWithSpace(pageA)
  await expect(pageA.getByTestId('solve-count')).toHaveText('1')
  const duringPreparation = await storedSessions(pageA)
  expect(
    duringPreparation?.sessions.find(
      (session: { id: string }) => session.id === 'replacement-a',
    )?.solves,
  ).toEqual([])

  await pageB.evaluate(() => {
    const key = 'cubelab:replacement:v1'
    const journal = JSON.parse(localStorage.getItem(key)!) as Record<
      string,
      unknown
    >
    localStorage.setItem(
      key,
      JSON.stringify({ ...journal, phase: 'committed', before: {} }),
    )
  })
  await expect
    .poll(() => selectedSessionName(pageA))
    .toBe('Other B')
  await pageB.close()

  const stored = await storedSessions(pageA)
  const reclassified = stored?.sessions.find(
    (session: { id: string }) => session.id === 'replacement-a',
  )
  expect(reclassified).toMatchObject({ event: '222', solves: [] })
  const recovered = stored?.sessions.find(
    (session: { id: string }) => session.id === 'recovered:replacement-a',
  )
  expect(recovered?.event).toBe('333')
  expect(recovered?.solves).toHaveLength(1)
  expect(recovered?.solves[0]).toMatchObject({
    event: '333',
    scramble: originalScramble,
    penalty: 'none',
  })
  expect(recovered?.solves[0]?.rawMs).toBeGreaterThan(0)
  expect(
    await pageA.evaluate(() => {
      const prefix = 'cubelab:replacement-completion:v1'
      return Object.keys(localStorage).filter((key) => key.startsWith(prefix))
    }),
  ).toEqual([])
  expect(
    await pageA.evaluate(() =>
      localStorage.getItem('cubelab:replacement:v1'),
    ),
  ).toBeNull()

  await pageA.reload()
  await waitForApp(pageA)
  const reloaded = await storedSessions(pageA)
  expect(
    reloaded?.sessions.find(
      (session: { id: string }) => session.id === 'replacement-a',
    ),
  ).toMatchObject({ event: '222', solves: [] })
  expect(
    reloaded?.sessions.find(
      (session: { id: string }) => session.id === 'recovered:replacement-a',
    )?.solves,
  ).toHaveLength(1)

  await context.close()
})

test('a replacement rollback/removal during a running solve keeps its original owner', async ({
  browser,
  browserName,
}) => {
  test.skip(browserName === 'webkit', 'WebKit keyboard timing is not reliable in this flow.')
  const context = await browser.newContext()
  await simulateLegacyConcurrentTabs(context)
  const pageA = await context.newPage()
  const pageB = await context.newPage()
  await pageA.addInitScript(seedReplacementPair)
  await pageB.addInitScript(seedReplacementPair)
  await pageA.goto('/')
  await pageB.goto('/')
  await waitForApp(pageA)
  await waitForApp(pageB)

  await holdSpace(pageA)
  const originalScramble = await pageA.locator('.scramble-text').textContent()
  await writeCommittedReplacement(pageB, false)
  await pageB.evaluate(() => {
    const sessionsKey = 'cubelab:sessions:v1'
    const journalKey = 'cubelab:replacement:v1'
    const journal = JSON.parse(localStorage.getItem(journalKey)!) as {
      before: { sessions: string }
    }
    localStorage.setItem(sessionsKey, journal.before.sessions)
    localStorage.removeItem(journalKey)
  })
  await pageB.close()
  await expect(pageA.locator(TIMER)).toHaveAttribute('data-phase', 'running')
  expect(await selectedSessionName(pageA)).toBe('Original A')

  await stopWithSpace(pageA)
  await expect(pageA.getByTestId('solve-count')).toHaveText('1')
  expect(await selectedSessionName(pageA)).toBe('Original A')
  const stored = await storedSessions(pageA)
  expect(stored?.activeSessionId).toBe('replacement-a')
  expect(
    stored?.sessions.find(
      (session: { id: string }) => session.id === 'replacement-a',
    )?.solves[0],
  ).toMatchObject({
    event: '333',
    scramble: originalScramble,
  })
  expect(
    stored?.sessions.find(
      (session: { id: string }) => session.id === 'replacement-b',
    )?.solves,
  ).toEqual([])

  await pageA.reload()
  await waitForApp(pageA)
  expect(await selectedSessionName(pageA)).toBe('Original A')
  await expect(pageA.getByTestId('solve-count')).toHaveText('1')
  await context.close()
})

test('an idle tab adopts split ownership metadata from another tab', async ({
  browser,
}) => {
  const context = await browser.newContext()
  await simulateLegacyConcurrentTabs(context)
  const pageA = await context.newPage()
  const pageB = await context.newPage()
  const seed = () => {
    const now = Date.now()
    localStorage.setItem(
      'cubelab:sessions:v1',
      JSON.stringify({
        version: 6,
        activeSessionId: 'session-1',
        sessions: [
          {
            id: 'session-1',
            name: 'Morning',
            event: '333',
            createdAt: now,
            updatedAt: now,
            solves: [
              {
                id: 'solve-1',
                event: '333',
                rawMs: 10_000,
                penalty: 'none',
                scramble: 'R U',
                comment: 'Keep me',
                createdAt: now - 1_000,
              },
              {
                id: 'solve-2',
                event: '333',
                rawMs: 11_000,
                penalty: '+2',
                scramble: "F R U'",
                comment: '',
                createdAt: now - 2_000,
              },
            ],
          },
          {
            id: 'session-2',
            name: 'Evening',
            event: '333',
            createdAt: now,
            updatedAt: now,
            solves: [],
          },
        ],
      }),
    )
  }
  await pageA.addInitScript(seed)
  await pageB.addInitScript(seed)
  await pageA.goto('/')
  await pageB.goto('/')
  await waitForApp(pageA)
  await waitForApp(pageB)

  await pageA.getByTestId('session-settings').click()
  const settings = pageA.getByRole('dialog', { name: 'Session settings' })
  await settings.getByTestId('session-split').click()
  const split = pageA.getByRole('dialog', {
    name: 'Move solves to a new session',
  })
  await split.getByTestId('split-select-all').click()
  await split.getByLabel('Typed confirmation').fill('SPLIT SESSION')
  await split.getByRole('button', { name: 'Confirm split' }).click()
  await expect(split).toBeHidden()

  await expect
    .poll(() => sessionNames(pageB))
    .toEqual(['Morning', 'Morning (split)', 'Evening'])
  const storedB = await pageB.evaluate(() => {
    const raw = localStorage.getItem('cubelab:sessions:v1')
    return raw ? JSON.parse(raw) : null
  })
  expect(storedB.sessionTransfers).toEqual([
    expect.objectContaining({
      fromSessionId: 'session-1',
      toSessionId: expect.any(String),
      solveIds: ['solve-1', 'solve-2'],
    }),
  ])
  expect(
    storedB.sessions
      .flatMap((session: { solves: Array<{ id: string }> }) =>
        session.solves.map((solve) => solve.id),
      )
      .sort(),
  ).toEqual(['solve-1', 'solve-2'])

  await context.close()
})
