/**
 * Geometry for the Draw Scramble tool panel.
 *
 * Layouts are stored in stage-relative pixels so a panel restored on another
 * viewport can be clamped inside the timer stage instead of disappearing
 * off-screen. All values are kept as whole pixels.
 */

export interface ToolPanelLayout {
  x: number
  y: number
  width: number
  height: number
}

export interface StageSize {
  width: number
  height: number
}

export const TOOL_PANEL_MIN_WIDTH = 150
export const TOOL_PANEL_MIN_HEIGHT = 170
export const TOOL_PANEL_GAP = 12

const LAYOUT_KEYS = ['x', 'y', 'width', 'height'] as const

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

export function isToolPanelLayout(value: unknown): value is ToolPanelLayout {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return LAYOUT_KEYS.every((key) => isFiniteNonNegative(record[key]))
}

/** Parse a persisted layout, rejecting corrupt or partial records. */
export function parseToolPanelLayout(raw: string | null): ToolPanelLayout | null {
  if (!raw) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (!isToolPanelLayout(value)) return null
    return { x: value.x, y: value.y, width: value.width, height: value.height }
  } catch {
    return null
  }
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

/**
 * Keep a layout inside the timer stage. Sizes never drop below the usable
 * minimum, and the top-left corner is pulled back whenever the stage shrinks.
 */
export function clampToolPanelLayout(
  layout: ToolPanelLayout,
  stage: StageSize,
): ToolPanelLayout {
  const width = clampNumber(
    Math.round(layout.width),
    TOOL_PANEL_MIN_WIDTH,
    Math.max(TOOL_PANEL_MIN_WIDTH, Math.round(stage.width)),
  )
  const height = clampNumber(
    Math.round(layout.height),
    TOOL_PANEL_MIN_HEIGHT,
    Math.max(TOOL_PANEL_MIN_HEIGHT, Math.round(stage.height)),
  )
  return {
    x: clampNumber(
      Math.round(layout.x),
      0,
      Math.max(0, Math.round(stage.width) - width),
    ),
    y: clampNumber(
      Math.round(layout.y),
      0,
      Math.max(0, Math.round(stage.height) - height),
    ),
    width,
    height,
  }
}

/** Bottom-right placement used when the panel has no saved layout yet. */
export function defaultToolPanelLayout(
  stage: StageSize,
  size: { width: number; height: number },
): ToolPanelLayout {
  return clampToolPanelLayout(
    {
      x: Math.round(stage.width) - Math.round(size.width) - TOOL_PANEL_GAP,
      y: Math.round(stage.height) - Math.round(size.height) - TOOL_PANEL_GAP,
      width: Math.round(size.width),
      height: Math.round(size.height),
    },
    stage,
  )
}
