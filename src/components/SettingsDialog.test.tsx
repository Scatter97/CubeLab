import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsDialog } from './SettingsDialog'
import { DEFAULT_SETTINGS } from '../lib/storage'
import type { Settings } from '../types'

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: vi.fn(function (this: HTMLDialogElement) {
      this.open = true
    }),
  })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: vi.fn(function (this: HTMLDialogElement) {
      this.open = false
    }),
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function renderSettings(overrides: {
  solveCount?: number
  resetAllDisabledReason?: string | null
  deleteAllSessionsDisabledReason?: string | null
  onRequestResetAllSolveData?: () => void
  onRequestDeleteAllSessions?: () => void
  onChange?: (next: Partial<Settings>) => void
} = {}) {
  return render(
    <SettingsDialog
      open
      settings={DEFAULT_SETTINGS}
      storageOk
      sessionCount={2}
      solveCount={overrides.solveCount ?? 4}
      drawScrambleMode="net"
      onDrawScrambleModeChange={vi.fn()}
      onChange={overrides.onChange ?? vi.fn()}
      onOpenBackup={vi.fn()}
      onOpenDriveBackup={vi.fn()}
      onRequestResetAllSolveData={
        overrides.onRequestResetAllSolveData ?? vi.fn()
      }
      resetAllDisabledReason={overrides.resetAllDisabledReason ?? null}
      onRequestDeleteAllSessions={
        overrides.onRequestDeleteAllSessions ?? vi.fn()
      }
      deleteAllSessionsDisabledReason={
        overrides.deleteAllSessionsDisabledReason ?? null
      }
      developerSyncStatus="Synchronization is off; deletion records are stored locally."
      onClose={vi.fn()}
    />,
  )
}

function openDeveloper() {
  fireEvent.click(screen.getByText('Developer options'))
}

describe('Developer settings', () => {
  it('collapses developer options by default and reveals the danger zone', () => {
    renderSettings()
    const developer = screen.getByTestId('settings-developer')
    expect(developer.tagName).toBe('DETAILS')
    expect(developer).not.toHaveAttribute('open')

    openDeveloper()
    expect(developer).toHaveAttribute('open')
    expect(screen.getByText('Danger Zone')).toBeVisible()
    expect(screen.getByTestId('settings-danger-zone')).toHaveTextContent(
      'Danger Zone',
    )
    expect(screen.getByTestId('settings-reset-sync-status')).toHaveTextContent(
      'deletion records are stored locally',
    )
  })

  it('keeps the existing reset action and typed-confirmation handoff intact', () => {
    const onReset = vi.fn()
    renderSettings({ onRequestResetAllSolveData: onReset })
    openDeveloper()
    fireEvent.click(screen.getByTestId('settings-reset-all-solves'))
    expect(onReset).toHaveBeenCalledOnce()
  })

  it('disables the reset action when there are no solves or reset is unsafe', () => {
    const { rerender } = renderSettings({ solveCount: 0 })
    openDeveloper()
    expect(screen.getByTestId('settings-reset-all-solves')).toBeDisabled()

    rerender(
      <SettingsDialog
        open
        settings={DEFAULT_SETTINGS}
        storageOk={false}
        sessionCount={2}
        solveCount={4}
        drawScrambleMode="net"
        onDrawScrambleModeChange={vi.fn()}
        onChange={vi.fn()}
        onOpenBackup={vi.fn()}
        onOpenDriveBackup={vi.fn()}
        onRequestResetAllSolveData={vi.fn()}
        resetAllDisabledReason="Reset is blocked because browser storage is unavailable."
        onRequestDeleteAllSessions={vi.fn()}
        developerSyncStatus="Synchronization is off; deletion records are stored locally."
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByTestId('settings-reset-all-solves')).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Reset is blocked because browser storage is unavailable.',
    )
  })

  it('offers delete-all-sessions and explains its guards', () => {
    const onDeleteAll = vi.fn()
    renderSettings({
      onRequestDeleteAllSessions: onDeleteAll,
      deleteAllSessionsDisabledReason:
        'Deleting all sessions is blocked while the timer is active.',
    })
    openDeveloper()
    const button = screen.getByTestId('settings-delete-all-sessions')
    expect(button).toBeDisabled()
    expect(screen.getByText('Delete all sessions')).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Deleting all sessions is blocked while the timer is active.',
    )

    cleanup()
    renderSettings({ onRequestDeleteAllSessions: onDeleteAll })
    openDeveloper()
    fireEvent.click(screen.getByTestId('settings-delete-all-sessions'))
    expect(onDeleteAll).toHaveBeenCalledOnce()
  })
})

describe('About settings', () => {
  it('shows the release version', () => {
    renderSettings()
    expect(screen.getByRole('heading', { name: 'About' })).toBeInTheDocument()
    expect(screen.getByText(/^\d+\.\d{2}\.\d{6}:\d+$/)).toBeInTheDocument()
  })
})

describe('session summary settings', () => {
  it('allows independent progress and total-time choices', () => {
    const onChange = vi.fn()
    renderSettings({ onChange })
    fireEvent.click(screen.getByTestId('session-solve-progress-setting'))
    expect(onChange).toHaveBeenCalledWith({ showSessionSolveProgress: true })
    fireEvent.click(screen.getByTestId('session-total-time-setting'))
    expect(onChange).toHaveBeenCalledWith({ showSessionTotalTime: true })
  })
})

describe('statistics settings', () => {
  it('exposes independent row metric visibility switches', () => {
    const onChange = vi.fn()
    renderSettings({ onChange })
    const defaults = DEFAULT_SETTINGS.statMetricVisibility
    for (const key of ['current', 'best', 'target', 'bpa', 'wpa'] as const) {
      const checkbox = screen.getByTestId(`stat-metric-${key}`)
      expect(checkbox).toHaveProperty('checked', defaults[key])
      fireEvent.click(checkbox)
      expect(onChange).toHaveBeenLastCalledWith({
        statMetricVisibility: {
          ...defaults,
          [key]: !defaults[key],
        },
      })
    }
  })
})
