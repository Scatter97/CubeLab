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

  it('shows one alert and one retry action when the initial scramble fails', () => {
    const onRetry = vi.fn()
    render(
      <ScramblePanel
        {...baseProps}
        scramble={null}
        error="Could not generate a scramble."
        onRetry={onRetry}
      />,
    )

    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(
      screen.getAllByRole('button', { name: 'Retry' }),
    ).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('keeps recovery available when the queued scramble fails but the current one is visible', () => {
    render(
      <ScramblePanel
        {...baseProps}
        error="Could not generate the next scramble."
      />,
    )

    expect(screen.getByText(baseProps.scramble)).toBeInTheDocument()
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(
      screen.getByRole('button', { name: 'Retry' }),
    ).toBeInTheDocument()
  })

  it('offers an explicit reload only after retries cannot recover', () => {
    const onReload = vi.fn()
    const { rerender } = render(
      <ScramblePanel
        {...baseProps}
        scramble={null}
        error="Could not generate a scramble."
        onReload={onReload}
      />,
    )
    expect(
      screen.queryByRole('button', { name: 'Reload to recover' }),
    ).not.toBeInTheDocument()

    rerender(
      <ScramblePanel
        {...baseProps}
        scramble={null}
        error="Could not generate a scramble."
        showReload
        onReload={onReload}
      />,
    )
    const reload = screen.getByRole('button', { name: 'Reload to recover' })
    expect(reload).toBeEnabled()
    fireEvent.click(reload)
    expect(onReload).toHaveBeenCalledTimes(1)

    rerender(
      <ScramblePanel
        {...baseProps}
        scramble={null}
        error="Could not generate a scramble."
        showReload
        canReload={false}
        onReload={onReload}
      />,
    )
    expect(
      screen.getByRole('button', { name: 'Reload to recover' }),
    ).toBeDisabled()
  })
})
