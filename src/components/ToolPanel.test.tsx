import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TOOL_PANEL_LAYOUT_STORAGE_KEY } from '../hooks/useToolPanelLayout'
import * as cubeNet from '../lib/cubeNet'
import { ToolPanel } from './ToolPanel'

const baseProps = {
  scramble: "R U R' U' F2 D L2 B' R2 U2",
  event: '333' as const,
  mode: 'net' as const,
  activeTool: 'drawScramble' as const,
  onSelectTool: vi.fn(),
}

function fakeStage(element: HTMLElement, width: number, height: number) {
  Object.defineProperty(element, 'clientWidth', {
    configurable: true,
    value: width,
  })
  Object.defineProperty(element, 'clientHeight', {
    configurable: true,
    value: height,
  })
}

function dragPointer(
  handle: HTMLElement,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  fireEvent.pointerDown(handle, {
    pointerId: 1,
    pointerType: 'mouse',
    button: 0,
    clientX: from.x,
    clientY: from.y,
  })
  fireEvent.pointerMove(handle, {
    pointerId: 1,
    clientX: to.x,
    clientY: to.y,
  })
  fireEvent.pointerUp(handle, { pointerId: 1, clientX: to.x, clientY: to.y })
}

beforeEach(() => {
  localStorage.clear()
})

describe('ToolPanel', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('draws the current scramble and shows the selected tool in the footer', () => {
    render(<ToolPanel {...baseProps} />)

    expect(screen.getByTestId('tool-panel')).toHaveAttribute(
      'data-tool',
      'drawScramble',
    )
    expect(screen.getByTestId('scramble-net')).toBeInTheDocument()
    expect(screen.getByTestId('tool-select-button')).toHaveAccessibleName(
      'Function: Draw Scramble',
    )
  })

  it('opens the Function menu upward with only functional tools', () => {
    render(<ToolPanel {...baseProps} />)

    fireEvent.click(screen.getByTestId('tool-select-button'))
    const menu = screen.getByTestId('tool-select-menu')
    expect(menu).toHaveClass('is-up')
    expect(menu).toHaveAttribute('aria-label', 'Function')

    const options = screen.getAllByRole('menuitemradio')
    expect(options).toHaveLength(2)
    expect(options.map((o) => o.textContent?.trim())).toContain('Draw Scramble✓')
    expect(options.map((o) => o.textContent?.trim())).toContain('Time Trend')
    expect(
      screen.getByRole('menuitemradio', { name: 'Draw Scramble' }),
    ).toHaveAttribute('aria-checked', 'true')
    expect(screen.queryByRole('menuitemradio', { name: 'None' })).toBeNull()
  })

  it('selects a tool without closing the panel', () => {
    const onSelectTool = vi.fn()
    render(<ToolPanel {...baseProps} onSelectTool={onSelectTool} />)

    fireEvent.click(screen.getByTestId('tool-select-button'))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Draw Scramble' }))

    expect(onSelectTool).toHaveBeenCalledWith('drawScramble')
    expect(screen.queryByTestId('tool-select-menu')).not.toBeInTheDocument()
    expect(screen.getByTestId('tool-panel')).toBeInTheDocument()
  })

  it('closes the Function menu with Escape and restores focus', () => {
    render(<ToolPanel {...baseProps} />)
    const button = screen.getByTestId('tool-select-button')
    fireEvent.click(button)
    expect(screen.getByTestId('tool-select-menu')).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('tool-select-menu')).not.toBeInTheDocument()
    expect(button).toHaveFocus()
  })

  it('reports an unparseable scramble without crashing', () => {
    render(<ToolPanel {...baseProps} scramble="not a scramble" />)

    expect(screen.getByRole('alert')).toHaveTextContent(
      'This scramble cannot be drawn.',
    )
  })

  it('redraws when the session event changes', () => {
    const { rerender } = render(<ToolPanel {...baseProps} />)
    expect(screen.getByTestId('scramble-net')).toHaveAttribute('data-size', '3')

    rerender(<ToolPanel {...baseProps} event="222" />)
    expect(screen.getByTestId('scramble-net')).toHaveAttribute('data-size', '2')
    expect(screen.getByTestId('scramble-net').querySelectorAll('[data-sticker]')).toHaveLength(24)
  })

  it('builds the 2D net only for the visible net view and reuses it', () => {
    const rebuild = vi.spyOn(cubeNet, 'cubeNetForScramble')
    const { rerender } = render(<ToolPanel {...baseProps} mode="3d" />)
    expect(rebuild).not.toHaveBeenCalled()

    rerender(<ToolPanel {...baseProps} activeTool="timeTrend" />)
    expect(rebuild).not.toHaveBeenCalled()

    rerender(<ToolPanel {...baseProps} mode="net" />)
    expect(rebuild).toHaveBeenCalledTimes(1)
    expect(rebuild).toHaveBeenLastCalledWith(baseProps.scramble, 3)

    rerender(<ToolPanel {...baseProps} mode="net" />)
    expect(rebuild).toHaveBeenCalledTimes(1)

    rerender(<ToolPanel {...baseProps} mode="net" scramble="R U" />)
    expect(rebuild).toHaveBeenCalledTimes(2)
    expect(rebuild).toHaveBeenLastCalledWith('R U', 3)
  })

  it('shows an honest 2D unavailable state for non-cube puzzles', () => {
    const cases = [
      ['pyram', 'Pyraminx'],
      ['skewb', 'Skewb'],
      ['sq1', 'Square-1'],
      ['clock', 'Clock'],
      ['minx', 'Megaminx'],
    ] as const

    for (const [event, label] of cases) {
      const { unmount } = render(
        <ToolPanel {...baseProps} event={event} scramble="U R L B" />,
      )
      expect(screen.queryByTestId('scramble-net')).toBeNull()
      expect(screen.getByTestId('draw-scramble-unavailable')).toHaveTextContent(
        `2D net is not available for ${label}`,
      )
      expect(screen.getByTestId('tool-panel')).toHaveAttribute(
        'data-tool',
        'drawScramble',
      )
      unmount()
    }
  })

  it('drags from the header handle and persists the layout when released', () => {
    const { container } = render(<ToolPanel {...baseProps} />)
    const stage = container
    fakeStage(stage, 420, 520)
    const panel = screen.getByTestId('tool-panel')
    const handle = screen.getByTestId('tool-panel-drag-handle')

    fireEvent.pointerDown(handle, {
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      clientX: 100,
      clientY: 100,
    })
    expect(panel).toHaveAttribute('data-interaction', 'drag')

    fireEvent.pointerMove(handle, {
      pointerId: 1,
      clientX: 140,
      clientY: 160,
    })
    expect(panel.style.left).toBe('40px')
    expect(panel.style.top).toBe('60px')
    // Nothing is written mid-drag.
    expect(localStorage.getItem(TOOL_PANEL_LAYOUT_STORAGE_KEY)).toBeNull()

    fireEvent.pointerUp(handle, {
      pointerId: 1,
      clientX: 140,
      clientY: 160,
    })

    // Releasing ends the gesture without moving the panel again.
    expect(panel).not.toHaveAttribute('data-interaction')
    expect(panel.style.left).toBe('40px')
    expect(panel.style.top).toBe('60px')
    expect(
      JSON.parse(localStorage.getItem(TOOL_PANEL_LAYOUT_STORAGE_KEY) ?? '{}'),
    ).toMatchObject({ x: 40, y: 60 })
  })

  it('clamps a dragged panel inside the timer stage', () => {
    const { container } = render(<ToolPanel {...baseProps} />)
    fakeStage(container, 400, 400)
    const panel = screen.getByTestId('tool-panel')
    const handle = screen.getByTestId('tool-panel-drag-handle')

    dragPointer(handle, { x: 10, y: 10 }, { x: 900, y: 900 })

    const left = Number.parseInt(panel.style.left, 10)
    const top = Number.parseInt(panel.style.top, 10)
    const width = Number.parseInt(panel.style.width, 10)
    const height = Number.parseInt(panel.style.height, 10)
    expect(left).toBeGreaterThanOrEqual(0)
    expect(top).toBeGreaterThanOrEqual(0)
    expect(left + width).toBeLessThanOrEqual(400)
    expect(top + height).toBeLessThanOrEqual(400)
  })

  it('resizes from the bottom-right handle and persists the size', () => {
    const { container } = render(<ToolPanel {...baseProps} />)
    fakeStage(container, 600, 600)
    const panel = screen.getByTestId('tool-panel')
    const dragHandle = screen.getByTestId('tool-panel-drag-handle')
    const resizeHandle = screen.getByTestId('tool-panel-resize-handle')

    dragPointer(dragHandle, { x: 100, y: 100 }, { x: 300, y: 300 })
    dragPointer(resizeHandle, { x: 300, y: 300 }, { x: 240, y: 250 })

    expect(panel.style.width).toBe('210px')
    expect(panel.style.height).toBe('220px')
    expect(panel).not.toHaveAttribute('data-interaction')
    expect(
      JSON.parse(localStorage.getItem(TOOL_PANEL_LAYOUT_STORAGE_KEY) ?? '{}'),
    ).toMatchObject({ width: 210, height: 220 })
  })

  it('restores a persisted layout on mount', () => {
    localStorage.setItem(
      TOOL_PANEL_LAYOUT_STORAGE_KEY,
      JSON.stringify({ x: 24, y: 32, width: 210, height: 240 }),
    )
    const { container } = render(<ToolPanel {...baseProps} />)
    fakeStage(container, 420, 520)

    const panel = screen.getByTestId('tool-panel')
    expect(panel.style.left).toBe('24px')
    expect(panel.style.top).toBe('32px')
    expect(panel.style.width).toBe('210px')
    expect(panel.style.height).toBe('240px')
  })

  it('does not drag when a non-primary mouse button is pressed', () => {
    const { container } = render(<ToolPanel {...baseProps} />)
    fakeStage(container, 420, 520)
    const panel = screen.getByTestId('tool-panel')
    const handle = screen.getByTestId('tool-panel-drag-handle')

    fireEvent.pointerDown(handle, {
      pointerId: 1,
      pointerType: 'mouse',
      button: 2,
      clientX: 10,
      clientY: 10,
    })

    expect(panel).not.toHaveAttribute('data-interaction')
    expect(localStorage.getItem(TOOL_PANEL_LAYOUT_STORAGE_KEY)).toBeNull()
  })
})
