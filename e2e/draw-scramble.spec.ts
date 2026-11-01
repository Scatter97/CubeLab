import { expect, test } from '@playwright/test'
import { CUBELAB_EVENTS } from '../src/lib/events'

async function waitForReady(page: import('@playwright/test').Page) {
  await page.goto('/')
  await expect(page.locator('.scramble-text')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.queue-label')).toContainText('Queue ready', {
    timeout: 30_000,
  })
}

async function openToolPanel(page: import('@playwright/test').Page) {
  await waitForReady(page)
  const panel = page.getByTestId('tool-panel')
  if (await panel.count() === 0) {
    await page.getByTestId('current-tool-button').click()
  }
  await expect(page.getByTestId('tool-panel')).toBeVisible()
}

async function useMode(
  page: import('@playwright/test').Page,
  mode: 'net' | '3d',
) {
  await page.getByTestId('settings-button').click()
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await expect(settings).toBeVisible()
  await settings.getByTestId('scramble-draw-mode').selectOption(mode)
  await settings.getByRole('button', { name: 'Close settings' }).click()
  await expect(settings).toHaveCount(0)
}

async function useEvent(
  page: import('@playwright/test').Page,
  event: (typeof CUBELAB_EVENTS)[number],
) {
  await page.getByTestId('session-settings').click()
  const dialog = page.getByRole('dialog', { name: 'Session settings' })
  await expect(dialog).toBeVisible()
  await dialog.locator('select').selectOption(event.id)
  await dialog.getByTestId('session-settings-done').click()
  await expect(dialog).toHaveCount(0)
  await expect(page.locator('.scramble-badge')).toContainText(
    `${event.label} · scramble`,
  )
  await expect(page.locator('.queue-label')).toContainText('Queue ready', {
    timeout: 30_000,
  })
}

test('3D Draw Scramble fills its canvas', async ({ page, browserName }) => {
  test.skip(
    browserName !== 'chromium',
    'CDP shadow-DOM inspection is Chromium-only',
  )

  await openToolPanel(page)
  await useMode(page, '3d')
  const player = page.getByTestId('tool-panel').locator('twisty-player')
  await expect(player).toHaveCount(1, { timeout: 30_000 })

  // cubing.js renders into a closed shadow root, so use CDP to confirm the
  // canvas gets the panel's full height (a `display: block` override on the
  // host used to collapse it to 0px).
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('DOM.enable')
  const { root } = await cdp.send('DOM.getDocument', {
    depth: -1,
    pierce: true,
  })
  let canvasId: number | null = null
  const findCanvas = (node: {
    nodeName: string
    nodeId: number
    children?: unknown[]
    shadowRoots?: unknown[]
  }) => {
    if (node.nodeName === 'CANVAS') canvasId = node.nodeId
    for (const child of (node.children ?? []) as typeof node[]) {
      findCanvas(child)
    }
    for (const shadow of (node.shadowRoots ?? []) as typeof node[]) {
      findCanvas(shadow)
    }
  }
  findCanvas(root as Parameters<typeof findCanvas>[0])

  expect(canvasId).not.toBeNull()
  const { model } = await cdp.send('DOM.getBoxModel', { nodeId: canvasId! })
  expect(model.height).toBeGreaterThan(0)
  expect(model.width).toBeGreaterThan(0)
})

test('Current Tool toggles the panel and the footer selects the tool', async ({
  page,
}) => {
  await waitForReady(page)

  const toolButton = page.getByTestId('current-tool-button')
  const panel = page.getByTestId('tool-panel')
  await expect(toolButton).toHaveAccessibleName(
    'Show current tool panel: Draw Scramble',
  )
  await expect(toolButton).toHaveAttribute('aria-expanded', 'false')
  await expect(panel).toHaveCount(0)

  // The header button only toggles visibility; it must not open a menu.
  await toolButton.click()
  await expect(toolButton).toHaveAccessibleName(
    'Hide current tool panel: Draw Scramble',
  )
  await expect(toolButton).toHaveAttribute('aria-expanded', 'true')
  await expect(panel).toBeVisible()
  await expect(panel).toHaveAttribute('data-tool', 'drawScramble')
  await expect(panel).toHaveAttribute('data-mode', 'net')
  await expect(page.getByTestId('tool-select-menu')).toHaveCount(0)

  const net = page.getByTestId('scramble-net')
  await expect(net).toBeVisible()
  await expect(net.locator('[data-sticker]')).toHaveCount(54)

  // The panel is anchored inside the bottom-right corner of the timer stage.
  const stageBox = await page.locator('.timer-stage').boundingBox()
  const panelBox = await panel.boundingBox()
  expect(stageBox).not.toBeNull()
  expect(panelBox).not.toBeNull()
  if (stageBox && panelBox) {
    expect(panelBox.x).toBeGreaterThan(stageBox.x + stageBox.width / 2)
    expect(panelBox.y).toBeGreaterThan(stageBox.y + stageBox.height / 2)
    expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(
      stageBox.x + stageBox.width,
    )
    expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(
      stageBox.y + stageBox.height,
    )
  }

  // The Function dropdown lives in the panel footer and opens upward.
  const functionButton = page.getByTestId('tool-select-button')
  await expect(functionButton).toHaveAccessibleName(
    'Function: Draw Scramble',
  )
  await functionButton.click()
  const menu = page.getByTestId('tool-select-menu')
  await expect(menu).toBeVisible()
  await expect(menu).toHaveClass(/is-up/)
  await expect(menu.getByRole('menuitemradio')).toHaveCount(2)
  await expect(
    menu.getByRole('menuitemradio', { name: 'Draw Scramble' }),
  ).toHaveAttribute('aria-checked', 'true')
  await expect(menu.getByRole('menuitemradio', { name: 'None' })).toHaveCount(0)

  const menuBox = await menu.boundingBox()
  const functionBox = await functionButton.boundingBox()
  expect(menuBox).not.toBeNull()
  expect(functionBox).not.toBeNull()
  if (menuBox && functionBox) {
    expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(functionBox.y)
  }

  // Selecting the active tool keeps the panel open.
  await menu.getByRole('menuitemradio', { name: 'Draw Scramble' }).click()
  await expect(page.getByTestId('tool-select-menu')).toHaveCount(0)
  await expect(panel).toBeVisible()

  const stickerState = () =>
    net
      .locator('[data-sticker]')
      .evaluateAll((stickers) =>
        stickers.map((sticker) => sticker.getAttribute('data-sticker')).join(''),
      )
  const before = await stickerState()
  const scrambleBefore = await page.locator('.scramble-text').innerText()

  await page.getByRole('button', { name: 'Generate a new scramble' }).click()
  await expect
    .poll(() => page.locator('.scramble-text').innerText(), { timeout: 10_000 })
    .not.toBe(scrambleBefore)
  await expect.poll(stickerState, { timeout: 10_000 }).not.toBe(before)

  // 2D/3D remains controlled only by the existing Settings option.
  await useMode(page, '3d')
  await expect(panel).toHaveAttribute('data-mode', '3d')
  await expect(panel.locator('twisty-player')).toHaveCount(1, {
    timeout: 30_000,
  })

  // The header button closes the whole panel, then reopens the same tool.
  await toolButton.click()
  await expect(panel).toHaveCount(0)
  await expect(toolButton).toHaveAttribute('aria-expanded', 'false')
  await expect(toolButton).toHaveAccessibleName(
    'Show current tool panel: Draw Scramble',
  )

  await toolButton.click()
  await expect(panel).toBeVisible()
  await expect(panel).toHaveAttribute('data-tool', 'drawScramble')
  await expect(panel).toHaveAttribute('data-mode', '3d')
})

test('Draw Scramble follows the session event', async ({ page }) => {
  await openToolPanel(page)

  const panel = page.getByTestId('tool-panel')
  const net = page.getByTestId('scramble-net')
  await expect(net).toHaveAttribute('data-size', '3')
  await expect(net.locator('[data-sticker]')).toHaveCount(54)

  await page.getByTestId('session-settings').click()
  const sessionDialog = page.getByRole('dialog', { name: 'Session settings' })
  await expect(sessionDialog).toBeVisible()
  await sessionDialog.locator('select').selectOption('222')
  await sessionDialog.getByTestId('session-settings-done').click()
  await expect(sessionDialog).toHaveCount(0)

  // The old scramble is cleared while the 2×2 queue fills, then the panel
  // redraws with a 2×2 grid and the new scramble text.
  await expect(net).toHaveAttribute('data-size', '2', { timeout: 30_000 })
  await expect(net.locator('[data-sticker]')).toHaveCount(24)
  const scramble = await page.locator('.scramble-text').innerText()
  await expect(panel).toHaveAttribute('data-scramble', scramble)
})

test('the panel swallows pointer input instead of arming the timer', async ({
  page,
  browserName,
}) => {
  await openToolPanel(page)
  const timer = page.locator('[data-testid="timer-surface"]')
  const net = page.getByTestId('scramble-net')
  const netBox = await net.boundingBox()
  expect(netBox).not.toBeNull()
  if (!netBox) return

  const centre = {
    x: netBox.x + netBox.width / 2,
    y: netBox.y + netBox.height / 2,
  }

  // Hold on the diagram well past the 300 ms arm delay; the timer must not arm.
  await page.mouse.move(centre.x, centre.y)
  await page.mouse.down()
  await page.waitForTimeout(700)
  await expect(timer).toHaveAttribute('data-phase', 'idle')
  await page.mouse.up()
  await expect(timer).toHaveAttribute('data-phase', 'idle')

  // Touch input takes the same pointer path.
  if (browserName === 'chromium') {
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: centre.x, y: centre.y }],
    })
    await page.waitForTimeout(500)
    await expect(timer).toHaveAttribute('data-phase', 'idle')
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    })
    await expect(timer).toHaveAttribute('data-phase', 'idle')
  }

  // A press on the timer stage outside the panel still arms and starts it.
  const stageBox = await page.locator('.timer-stage').boundingBox()
  expect(stageBox).not.toBeNull()
  if (!stageBox) return
  const outside = { x: stageBox.x + 24, y: stageBox.y + 24 }

  await page.mouse.move(outside.x, outside.y)
  await page.mouse.down()
  await expect(timer).toHaveAttribute('data-phase', 'ready', {
    timeout: 3_000,
  })
  await page.mouse.up()
  await expect(timer).toHaveAttribute('data-phase', 'running')

  await page.mouse.click(outside.x, outside.y)
  await expect(timer).toHaveAttribute('data-phase', 'idle')
})

test('the panel drags by its header and keeps the layout across reloads', async ({
  page,
}) => {
  await openToolPanel(page)
  const panel = page.getByTestId('tool-panel')
  const handle = page.getByTestId('tool-panel-drag-handle')
  const timer = page.locator('[data-testid="timer-surface"]')

  const before = await panel.boundingBox()
  const grip = await handle.boundingBox()
  expect(before).not.toBeNull()
  expect(grip).not.toBeNull()
  if (!before || !grip) return

  const start = { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await expect(panel).toHaveAttribute('data-interaction', 'drag')
  await page.mouse.move(start.x - 140, start.y - 90, { steps: 8 })
  // Dragging a panel never arms the timer.
  await expect(timer).toHaveAttribute('data-phase', 'idle')
  await page.mouse.up()
  await expect(panel).not.toHaveAttribute('data-interaction')

  const moved = await panel.boundingBox()
  expect(moved).not.toBeNull()
  if (!moved) return
  expect(Math.abs(moved.x - (before.x - 140))).toBeLessThanOrEqual(2)
  expect(Math.abs(moved.y - (before.y - 90))).toBeLessThanOrEqual(2)
  expect(Math.abs(moved.width - before.width)).toBeLessThanOrEqual(1)
  expect(Math.abs(moved.height - before.height)).toBeLessThanOrEqual(1)

  await page.reload()
  await openToolPanel(page)
  const restored = await page.getByTestId('tool-panel').boundingBox()
  expect(restored).not.toBeNull()
  if (!restored) return
  expect(Math.abs(restored.x - moved.x)).toBeLessThanOrEqual(2)
  expect(Math.abs(restored.y - moved.y)).toBeLessThanOrEqual(2)
})

test('renderer dimensions stay frozen during 3D resize', async ({ page }) => {
  await waitForReady(page)
  await page.getByTestId('current-tool-button').click()
  await expect(page.getByTestId('tool-panel')).toBeVisible()

  await page.getByTestId('settings-button').click()
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await settings.getByTestId('scramble-draw-mode').selectOption('3d')
  await settings.getByRole('button', { name: 'Close settings' }).click()
  await expect(settings).toHaveCount(0)

  const readDims = () =>
    page.evaluate(() => {
      const player = document.querySelector('twisty-player') as HTMLElement | null
      return { player: player ? { w: player.clientWidth, h: player.clientHeight } : null }
    })

  await page.waitForTimeout(1500)
  const before = await readDims()
  expect(before.player).not.toBeNull()

  const resize = page.getByTestId('tool-panel-resize-handle')
  const rb = (await resize.boundingBox())!
  await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2)
  await page.mouse.down()

  const observed: { pw: number; ph: number }[] = []
  let scaleSeen = false
  for (let i = 0; i < 6; i++) {
    await page.mouse.move(rb.x + rb.width / 2 - (i + 1) * 12, rb.y + rb.height / 2 - (i + 1) * 8, { steps: 1 })
    await page.waitForTimeout(60)
    const d = await readDims()
    if (d.player) observed.push({ pw: d.player.w, ph: d.player.h })
    // Ghost outline follows the proposed size.
    const ghostW = await page.getByTestId('tool-panel-ghost').evaluate((el) => el.getBoundingClientRect().width).catch(() => 0)
    if (ghostW && ghostW !== (before.player?.w ?? 0)) scaleSeen = true
  }
  await page.mouse.up()
  await page.waitForTimeout(500)

  for (const o of observed) {
    expect(o.pw).toBe(before.player!.w)
    expect(o.ph).toBe(before.player!.h)
  }
  expect(scaleSeen).toBe(true)
  const viz = await page.getByTestId('tool-panel').locator('twisty-player').getAttribute('visualization')
  expect(viz).toBe('PG3D')
})

test('the panel resizes from its corner handle and keeps the size', async ({
  page,
}) => {
  await openToolPanel(page)
  const panel = page.getByTestId('tool-panel')
  const handle = page.getByTestId('tool-panel-drag-handle')
  const resize = page.getByTestId('tool-panel-resize-handle')

  // Move the panel away from the stage edge so it has room to grow.
  const grip = await handle.boundingBox()
  expect(grip).not.toBeNull()
  if (!grip) return
  const gripCentre = { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 }
  await page.mouse.move(gripCentre.x, gripCentre.y)
  await page.mouse.down()
  await page.mouse.move(gripCentre.x - 150, gripCentre.y - 100, { steps: 8 })
  await page.mouse.up()

  const before = await panel.boundingBox()
  const corner = await resize.boundingBox()
  expect(before).not.toBeNull()
  expect(corner).not.toBeNull()
  if (!before || !corner) return
  // The resize handle lives in the top-left corner of the panel.
  expect(corner.x).toBeLessThanOrEqual(before.x + 4)
  expect(corner.y).toBeLessThanOrEqual(before.y + 4)

  const cornerCentre = {
    x: corner.x + corner.width / 2,
    y: corner.y + corner.height / 2,
  }
  await page.mouse.move(cornerCentre.x, cornerCentre.y)
  await page.mouse.down()
  await expect(panel).toHaveAttribute('data-interaction', 'resize')
  await page.mouse.move(cornerCentre.x - 70, cornerCentre.y - 50, { steps: 8 })
  await page.mouse.up()
  await expect(panel).not.toHaveAttribute('data-interaction')

  const resized = await panel.boundingBox()
  expect(resized).not.toBeNull()
  if (!resized) return
  expect(resized.width).toBeGreaterThan(before.width + 40)
  expect(resized.height).toBeGreaterThan(before.height + 30)
  // The bottom-right corner stays anchored: top-left moves, size grows.
  expect(Math.abs((resized.x + resized.width) - (before.x + before.width))).toBeLessThanOrEqual(2)
  expect(Math.abs((resized.y + resized.height) - (before.y + before.height))).toBeLessThanOrEqual(2)

  await page.reload()
  await openToolPanel(page)
  const restored = await page.getByTestId('tool-panel').boundingBox()
  expect(restored).not.toBeNull()
  if (!restored) return
  expect(Math.abs(restored.width - resized.width)).toBeLessThanOrEqual(2)
  expect(Math.abs(restored.height - resized.height)).toBeLessThanOrEqual(2)
})

test('the 2D net uses the standard six-face colours in both themes', async ({
  page,
}) => {
  await openToolPanel(page)
  const net = page.getByTestId('scramble-net')

  const stickerFills = () =>
    net.locator('[data-sticker]').evaluateAll((stickers) => {
      const fills: Record<string, string> = {}
      const counts: Record<string, number> = {}
      for (const sticker of stickers) {
        const face = sticker.getAttribute('data-sticker') ?? ''
        counts[face] = (counts[face] ?? 0) + 1
        fills[face] ??= getComputedStyle(sticker).fill
      }
      return { fills, counts }
    })

  const expected = {
    U: 'rgb(255, 255, 255)',
    D: 'rgb(255, 255, 0)',
    F: 'rgb(0, 255, 0)',
    B: 'rgb(0, 0, 255)',
    R: 'rgb(255, 0, 0)',
    L: 'rgb(255, 128, 0)',
  } as const

  const light = await stickerFills()
  for (const [face, fill] of Object.entries(expected)) {
    expect(light.fills[face]).toBe(fill)
    expect(light.counts[face]).toBe(9)
  }

  // The palette is identical in the dark theme.
  await page.getByTestId('settings-button').click()
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await settings.getByTestId('theme-setting').selectOption('dark')
  await settings.getByRole('button', { name: 'Close settings' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

  const dark = await stickerFills()
  for (const [face, fill] of Object.entries(expected)) {
    expect(dark.fills[face]).toBe(fill)
  }
})

test('the 3D view uses the colour-corrected PG3D renderer', async ({
  page,
  browserName,
}) => {
  test.skip(
    browserName !== 'chromium',
    'CDP shadow-DOM inspection is Chromium-only',
  )

  await openToolPanel(page)
  await useMode(page, '3d')
  const player = page.getByTestId('tool-panel').locator('twisty-player')
  await expect(player).toHaveCount(1, { timeout: 30_000 })
  // PG3D reads the palette we rewrite before the player builds; Cube3D (the
  // 3×3×3 default) hardcodes its own colours inside cubing.js.
  await expect(player).toHaveAttribute('visualization', 'PG3D')

  const cdp = await page.context().newCDPSession(page)
  await cdp.send('DOM.enable')
  const { root } = await cdp.send('DOM.getDocument', {
    depth: -1,
    pierce: true,
  })
  let canvasId: number | null = null
  const findCanvas = (node: {
    nodeName: string
    nodeId: number
    children?: unknown[]
    shadowRoots?: unknown[]
  }) => {
    if (node.nodeName === 'CANVAS') canvasId = node.nodeId
    for (const child of (node.children ?? []) as typeof node[]) {
      findCanvas(child)
    }
    for (const shadow of (node.shadowRoots ?? []) as typeof node[]) {
      findCanvas(shadow)
    }
  }
  findCanvas(root as Parameters<typeof findCanvas>[0])
  expect(canvasId).not.toBeNull()
  const { model } = await cdp.send('DOM.getBoxModel', { nodeId: canvasId! })
  expect(model.width).toBeGreaterThan(0)
  expect(model.height).toBeGreaterThan(0)
})

test('2D Draw Scramble shows an honest unavailable state for non-cube puzzles', async ({
  page,
}) => {
  await openToolPanel(page)
  const panel = page.getByTestId('tool-panel')

  for (const event of CUBELAB_EVENTS.filter((item) => item.cubeSize === null)) {
    await useEvent(page, event)
    await expect(panel).toHaveAttribute('data-mode', 'net')
    await expect(
      page.getByTestId('draw-scramble-unavailable'),
    ).toContainText(`2D net is not available for ${event.label}`)
    await expect(page.getByTestId('scramble-net')).toHaveCount(0)
    await expect(panel).toBeVisible()
  }
})

test('3D Draw Scramble renders every supported non-cube puzzle', async ({
  page,
}) => {
  await openToolPanel(page)
  await useMode(page, '3d')
  const panel = page.getByTestId('tool-panel')

  for (const event of CUBELAB_EVENTS.filter((item) => item.cubeSize === null)) {
    await useEvent(page, event)
    const player = panel.locator('twisty-player')
    await expect(player).toHaveCount(1, { timeout: 30_000 })
    await expect(player).toHaveAttribute('puzzle', event.puzzleId)
    await expect(panel.locator('.scramble-draw-status')).toHaveCount(0)
  }
})

test('panel visibility persists across reload', async ({ page }) => {
  await waitForReady(page)
  const toolButton = page.getByTestId('current-tool-button')
  const panel = page.getByTestId('tool-panel')

  // First visit defaults to closed.
  await expect(panel).toHaveCount(0)
  await expect(toolButton).toHaveAttribute('aria-expanded', 'false')

  // Open, then reload -> still open.
  await toolButton.click()
  await expect(panel).toBeVisible()
  await expect(toolButton).toHaveAttribute('aria-expanded', 'true')

  await page.reload()
  await waitForReady(page)
  await expect(page.getByTestId('tool-panel')).toBeVisible()
  await expect(page.getByTestId('current-tool-button')).toHaveAttribute(
    'aria-expanded',
    'true',
  )

  // Close, then reload -> stays closed.
  await page.getByTestId('current-tool-button').click()
  await expect(page.getByTestId('tool-panel')).toHaveCount(0)
  await page.reload()
  await waitForReady(page)
  await expect(page.getByTestId('tool-panel')).toHaveCount(0)
  await expect(page.getByTestId('current-tool-button')).toHaveAttribute(
    'aria-expanded',
    'false',
  )
})

test('invalid stored visibility defaults to closed', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('cubelab:toolPanelOpen:v1', 'garbage')
  })
  await waitForReady(page)
  await expect(page.getByTestId('tool-panel')).toHaveCount(0)
  await expect(page.getByTestId('current-tool-button')).toHaveAttribute(
    'aria-expanded',
    'false',
  )
})

test('open panel with moved layout persists visibility and position', async ({ page }) => {
  await waitForReady(page)
  await page.getByTestId('current-tool-button').click()
  await expect(page.getByTestId('tool-panel')).toBeVisible()

  // move panel
  const handle = page.getByTestId('tool-panel-drag-handle')
  const hb = (await handle.boundingBox())!
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2)
  await page.mouse.down()
  await page.mouse.move(hb.x + hb.width / 2 - 80, hb.y + hb.height / 2 - 50, { steps: 4 })
  await page.mouse.up()

  const moved = await page.getByTestId('tool-panel').boundingBox()
  expect(moved).not.toBeNull()

  await page.reload()
  await waitForReady(page)
  const restored = page.getByTestId('tool-panel')
  await expect(restored).toBeVisible()
  const rb = await restored.boundingBox()
  expect(rb).not.toBeNull()
  if (moved && rb) {
    expect(Math.abs(rb.x - moved.x)).toBeLessThanOrEqual(2)
    expect(Math.abs(rb.y - moved.y)).toBeLessThanOrEqual(2)
  }
})
