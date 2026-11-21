import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppHeader } from './AppHeader'

afterEach(cleanup)

function renderHeader() {
  return render(
    <AppHeader
      sessionName="Session 1"
      event="333"
      inspectionEnabled={false}
      onOpenSettings={vi.fn()}
      settingsLocked={false}
      storageOk
      view="timer"
      onNavigate={vi.fn()}
    />,
  )
}

describe('AppHeader', () => {
  it('places a non-focusable beta badge at the brand title', () => {
    const { container } = renderHeader()
    const badge = screen.getByText('Beta')

    expect(badge).toBeVisible()
    expect(badge.tagName).toBe('SPAN')
    expect(badge).not.toHaveAttribute('tabindex')
    expect(badge).not.toHaveAttribute('role')
    expect(badge.closest('.brand-name')).not.toBeNull()
    expect(container.querySelector('.brand-name')).toHaveTextContent('CubeLab')
    expect(screen.getByRole('button', { name: 'Timer' })).toBeEnabled()
  })
})
