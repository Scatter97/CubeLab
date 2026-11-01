import { describe, expect, it } from 'vitest'
import {
  TOOL_PANEL_GAP,
  TOOL_PANEL_MIN_HEIGHT,
  TOOL_PANEL_MIN_WIDTH,
  clampToolPanelLayout,
  defaultToolPanelLayout,
  parseToolPanelLayout,
} from './toolPanelLayout'

describe('parseToolPanelLayout', () => {
  it('accepts a complete persisted layout', () => {
    expect(
      parseToolPanelLayout('{"x":12,"y":24,"width":220,"height":260}'),
    ).toEqual({ x: 12, y: 24, width: 220, height: 260 })
  })

  it('rejects missing, corrupt, and negative values', () => {
    expect(parseToolPanelLayout(null)).toBeNull()
    expect(parseToolPanelLayout('')).toBeNull()
    expect(parseToolPanelLayout('not json')).toBeNull()
    expect(parseToolPanelLayout('{"x":1,"y":2,"width":3}')).toBeNull()
    expect(
      parseToolPanelLayout('{"x":-1,"y":2,"width":3,"height":4}'),
    ).toBeNull()
    expect(
      parseToolPanelLayout('{"x":1,"y":2,"width":3,"height":null}'),
    ).toBeNull()
  })
})

describe('clampToolPanelLayout', () => {
  const stage = { width: 800, height: 500 }

  it('leaves a layout that already fits untouched', () => {
    expect(clampToolPanelLayout({ x: 40, y: 30, width: 220, height: 240 }, stage))
      .toEqual({ x: 40, y: 30, width: 220, height: 240 })
  })

  it('enforces the minimum size', () => {
    const layout = clampToolPanelLayout(
      { x: 10, y: 10, width: 40, height: 40 },
      stage,
    )
    expect(layout.width).toBe(TOOL_PANEL_MIN_WIDTH)
    expect(layout.height).toBe(TOOL_PANEL_MIN_HEIGHT)
  })

  it('pulls an oversized layout back inside the stage', () => {
    const layout = clampToolPanelLayout(
      { x: 700, y: 450, width: 400, height: 300 },
      stage,
    )
    expect(layout.width).toBe(400)
    expect(layout.height).toBe(300)
    expect(layout.x).toBe(stage.width - 400)
    expect(layout.y).toBe(stage.height - 300)
  })

  it('never grows a layout beyond the stage bounds', () => {
    const layout = clampToolPanelLayout(
      { x: 0, y: 0, width: 900, height: 700 },
      stage,
    )
    expect(layout.width).toBe(stage.width)
    expect(layout.height).toBe(stage.height)
    expect(layout.x).toBe(0)
    expect(layout.y).toBe(0)
  })

  it('keeps the panel inside a shrunken stage', () => {
    const layout = clampToolPanelLayout(
      { x: 400, y: 200, width: 220, height: 240 },
      { width: 320, height: 260 },
    )
    expect(layout.x).toBe(320 - 220)
    expect(layout.y).toBe(260 - 240)
    expect(layout.width).toBe(220)
    expect(layout.height).toBe(240)
  })

  it('rounds fractional values to whole pixels', () => {
    expect(
      clampToolPanelLayout(
        { x: 10.6, y: 20.2, width: 200.4, height: 240.8 },
        stage,
      ),
    ).toEqual({ x: 11, y: 20, width: 200, height: 241 })
  })
})

describe('defaultToolPanelLayout', () => {
  it('anchors a new panel to the bottom-right corner', () => {
    expect(
      defaultToolPanelLayout({ width: 800, height: 500 }, { width: 220, height: 240 }),
    ).toEqual({
      x: 800 - 220 - TOOL_PANEL_GAP,
      y: 500 - 240 - TOOL_PANEL_GAP,
      width: 220,
      height: 240,
    })
  })

  it('clamps the default when the stage is smaller than the panel', () => {
    const layout = defaultToolPanelLayout(
      { width: 200, height: 180 },
      { width: 320, height: 300 },
    )
    expect(layout.x).toBe(0)
    expect(layout.y).toBe(0)
    expect(layout.width).toBe(200)
    expect(layout.height).toBe(180)
  })
})
