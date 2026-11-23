import { expect, test, type Page } from '@playwright/test'

async function chooseBattle(page: Page) {
  await page.getByTestId('current-tool-button').click()
  await expect(page.getByTestId('tool-panel')).toBeVisible()
  await page.getByTestId('tool-select-button').click()
  await page.getByRole('menuitemradio', { name: 'Online Battle' }).click()
  await expect(page.getByLabel('Room ID')).toBeVisible()
}

async function openBattle(page: Page) {
  await page.goto('/')
  await expect(page.locator('.scramble-text')).toBeVisible({ timeout: 30_000 })
  await chooseBattle(page)
}

async function connectPeers(host: Page, guest: Page) {
  const roomId = await host.getByLabel('Room ID').inputValue()
  const password = await host.getByLabel('Password').inputValue()
  await guest.getByLabel('Room ID').fill(roomId)
  await guest.getByLabel('Password').fill(password)

  await host.getByRole('button', { name: 'Create room' }).click()
  const invitation = host.getByLabel('Invitation code')
  await expect(invitation).not.toHaveValue('', { timeout: 20_000 })
  await guest.getByLabel('Invitation code').fill(await invitation.inputValue())
  await guest.getByRole('button', { name: 'Join with code' }).click()
  const answer = guest.getByLabel('Answer code')
  await expect(answer).not.toHaveValue('', { timeout: 20_000 })

  await host
    .getByLabel('Answer code from opponent')
    .fill(await answer.inputValue())
  await host.getByRole('button', { name: 'Connect' }).click()

  await expect(host.getByTestId('battle-start')).toBeEnabled({
    timeout: 30_000,
  })
  await expect(guest.getByText('Opponent connected.')).toBeVisible({
    timeout: 30_000,
  })
}

test('two peers race over an open data channel and see the same two results', async ({
  page,
  browser,
}) => {
  const guestContext = await browser.newContext({
    storageState: 'e2e/storage-state.json',
  })
  const guest = await guestContext.newPage()
  try {
    await openBattle(page)
    await openBattle(guest)
    await connectPeers(page, guest)

    await page.getByTestId('battle-start').click()
    await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible({
      timeout: 15_000,
    })
    await expect(guest.getByRole('button', { name: 'Stop' })).toBeVisible({
      timeout: 15_000,
    })

    await page.getByRole('button', { name: 'Stop' }).click()
    await guest.getByRole('button', { name: 'Stop' }).click()

    const results = async (target: typeof page) => {
      const values = await target.locator('.battle-results dd').allTextContents()
      expect(values).toHaveLength(2)
      expect(values.every((value) => value !== '—')).toBe(true)
      return values.sort()
    }
    await expect
      .poll(async () => (await results(page)).every(Boolean))
      .toBe(true)
    await expect
      .poll(async () => (await results(guest)).every(Boolean))
      .toBe(true)
    expect(await results(page)).toEqual(await results(guest))
  } finally {
    await guestContext.close()
  }
})

test.describe('stalled scramble recovery', () => {
  test.use({ serviceWorkers: 'block' })

  test('a stalled battle scramble times out and can retry on the same connection', async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000)
    let workerRequests = 0
    let stallWorkers = true
    await page.route('**/search-worker-entry*', async (route) => {
      workerRequests += 1
      if (workerRequests === 1) {
        // Normal cubing.js loading first imports the worker entry module.
        await route.continue()
        return
      }
      if (stallWorkers) {
        await route.fulfill({
          status: 200,
          contentType: 'application/javascript',
          headers: { 'cache-control': 'no-store' },
          body: '/* intentionally silent worker */',
        })
        return
      }
      await route.continue()
    })

    await page.goto('/')
    const timerError = page.locator('.scramble-error')
    await expect(timerError).toBeVisible({ timeout: 30_000 })
    expect(workerRequests).toBe(2)

    // Recover the timer first. Its timeout switches the shared coordinator to
    // fresh workers, so the Battle preparation below also constructs one.
    stallWorkers = false
    await timerError.getByRole('button', { name: 'Retry', exact: true }).click()
    await expect(page.locator('.scramble-text')).toBeVisible({
      timeout: 30_000,
    })
    await expect(
      page.getByRole('button', { name: 'Generate a new scramble' }),
    ).toBeEnabled({ timeout: 30_000 })
    await chooseBattle(page)

    const guestContext = await browser.newContext({
      storageState: 'e2e/storage-state.json',
      serviceWorkers: 'block',
    })
    const guest = await guestContext.newPage()
    try {
      await openBattle(guest)
      await connectPeers(page, guest)

      const requestsBeforeStall = workerRequests
      stallWorkers = true
      await page.getByTestId('battle-start').click()
      await expect
        .poll(() => workerRequests, { timeout: 10_000 })
        .toBeGreaterThan(requestsBeforeStall)

      const battleError = page.locator('.battle-tool').getByRole('alert')
      await expect(battleError).toContainText(
        'Battle scramble generation timed out. Try again on the same connection.',
        { timeout: 30_000 },
      )
      await expect(page.getByTestId('battle-start')).toBeEnabled()
      await expect(
        page.getByText(/Opponent disconnected/),
      ).toHaveCount(0)
      await expect(guest.getByText('Opponent connected.')).toBeVisible()

      // Retry on the still-open data channel with a healthy worker.
      stallWorkers = false
      await page.getByTestId('battle-start').click()
      await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible({
        timeout: 30_000,
      })
      await expect(guest.getByRole('button', { name: 'Stop' })).toBeVisible({
        timeout: 30_000,
      })
      await expect(page.locator('.battle-scramble p')).not.toHaveText(
        'No scramble yet.',
      )
    } finally {
      await guestContext.close()
    }
  })
})
