import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ScramblePanel } from './ScramblePanel'

const baseProps = {
  event: '333' as const,
  scramble: "R U R' U' F2 D L2 B' R2 U2",
  nextScramble: "F R U' R' U' R U R' F'",
  isLoading: false,
  error: null,
  canRegenerate: true,
  onRegenerate: vi.fn(),
  onRetry: vi.fn(),
  onNotify: vi.fn(),
  activeTool: 'drawScramble' as const,
  toolPanelOpen: false,
  onToggleToolPanel: vi.fn(),
}

describe('ScramblePanel current tool', () => {
  afterEach(cleanup)

  it('uses the standard scramble-toolbar icon button', () => {
    render(<ScramblePanel {...baseProps} />)
    const button = screen.getByTestId('current-tool-button')
    expect(button).toHaveAccessibleName(
      'Show current tool panel: Draw Scramble',
    )
    expect(button).toHaveClass('icon-button')
    expect(button).toHaveAttribute('aria-expanded', 'false')
    // The toolbar button is an icon only: no "Current tool" text, no caret.
    expect(button).toHaveTextContent('')
    expect(button.querySelector('svg')).not.toBeNull()
    expect(button.querySelector('.scramble-tool-caret')).toBeNull()
    expect(screen.queryByTestId('tool-select-menu')).not.toBeInTheDocument()
  })

  it('toggles the panel without opening a tool dropdown', () => {
    const onToggleToolPanel = vi.fn()
    render(
      <ScramblePanel
        {...baseProps}
        onToggleToolPanel={onToggleToolPanel}
      />,
    )

    fireEvent.click(screen.getByTestId('current-tool-button'))
    expect(onToggleToolPanel).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('shows the open state when the panel is visible', () => {
    render(<ScramblePanel {...baseProps} toolPanelOpen />)
    const button = screen.getByTestId('current-tool-button')
    expect(button).toHaveAccessibleName(
      'Hide current tool panel: Draw Scramble',
    )
    expect(button).toHaveAttribute('aria-expanded', 'true')
  })
})
