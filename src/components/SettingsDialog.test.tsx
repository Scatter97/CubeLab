import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsDialog } from './SettingsDialog'
import { DEFAULT_SETTINGS } from '../lib/storage'
import type { Settings } from '../types'
import { createEmptyTrainingData } from '../lib/training/storage'
import type { TrainingDomainSettings, TrainingSetId } from '../lib/training/types'

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
  settings?: Settings
  solveCount?: number
  resetAllDisabledReason?: string | null
  deleteAllSessionsDisabledReason?: string | null
  onRequestResetAllSolveData?: () => void
  onRequestDeleteAllSessions?: () => void
  onRequestResetAllSiteData?: () => void
  onOpenOnboarding?: () => void
  onChange?: (next: Partial<Settings>) => void
  trainingData?: ReturnType<typeof createEmptyTrainingData> | null
  onUpdateTrainingSettings?: (
    domain: TrainingDomainSettings,
    renewals: Record<
      TrainingSetId,
      { renewalDays: number; renewalAttempts: number }
    >,
  ) => boolean
} = {}) {
  return render(
    <SettingsDialog
      open
      settings={overrides.settings ?? DEFAULT_SETTINGS}
      storageOk
      sessionCount={2}
      solveCount={overrides.solveCount ?? 4}
      drawScrambleMode="net"
      onDrawScrambleModeChange={vi.fn()}
      onChange={overrides.onChange ?? vi.fn()}
      onOpenBackup={vi.fn()}
      onOpenDriveBackup={vi.fn()}
      onOpenOnboarding={overrides.onOpenOnboarding ?? vi.fn()}
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
      onRequestResetAllSiteData={
        overrides.onRequestResetAllSiteData ?? vi.fn()
      }
      developerSyncStatus="Synchronization is off; deletion records are stored locally."
      trainingData={overrides.trainingData ?? null}
      onUpdateTrainingSettings={overrides.onUpdateTrainingSettings}
      onClose={vi.fn()}
    />,
  )
}

function openDeveloper() {
  fireEvent.click(screen.getByText('Developer options'))
}


describe('Training settings', () => {
  it('saves training changes automatically without a Save button', () => {
    const onUpdateTrainingSettings = vi.fn(
      (
        _domain: TrainingDomainSettings,
        _renewals: Record<
          TrainingSetId,
          { renewalDays: number; renewalAttempts: number }
        >,
      ) => true,
    )
    renderSettings({
      trainingData: createEmptyTrainingData(),
      onUpdateTrainingSettings,
    })
    expect(
      screen.queryByRole('button', { name: 'Save Training settings' }),
    ).toBeNull()
    fireEvent.change(
      screen.getByLabelText('Inactivity timeout (minutes)'),
      { target: { value: '22' } },
    )
    expect(onUpdateTrainingSettings).toHaveBeenCalled()
    const [domain] = onUpdateTrainingSettings.mock.calls.at(-1)!
    expect(domain.inactivityMinutes).toBe(22)
  })
})

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
        onOpenOnboarding={vi.fn()}
        onRequestResetAllSolveData={vi.fn()}
        resetAllDisabledReason="Reset is blocked because browser storage is unavailable."
        onRequestDeleteAllSessions={vi.fn()}
        onRequestResetAllSiteData={vi.fn()}
        developerSyncStatus="Synchronization is off; deletion records are stored locally."
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByTestId('settings-reset-all-solves')).toBeDisabled()
    expect(screen.getByTestId('settings-reset-all-site-data')).toBeDisabled()
    expect(
      within(screen.getByTestId('settings-danger-zone')).getByRole('alert'),
    ).toHaveTextContent(
      'Reset is blocked because browser storage is unavailable.',
    )
  })

  it('offers the full site reset separately from solve-data deletion', () => {
    const onResetSite = vi.fn()
    renderSettings({ onRequestResetAllSiteData: onResetSite })
    openDeveloper()
    const button = screen.getByTestId('settings-reset-all-site-data')
    expect(button).toHaveTextContent('Reset All Site Data')
    expect(screen.getByTestId('settings-reset-site-zone')).toHaveTextContent(
      'Permanently delete all local CubeLab data, caches, settings, and authentication state. Restart as a new user.',
    )
    fireEvent.click(button)
    expect(onResetSite).toHaveBeenCalledOnce()
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

describe('Data settings', () => {
  it('opens the setup assistant from the Data section', () => {
    const onOpenOnboarding = vi.fn()
    renderSettings({ onOpenOnboarding })
    fireEvent.click(screen.getByTestId('settings-onboarding-button'))
    expect(onOpenOnboarding).toHaveBeenCalledOnce()
  })

  it('marks Google Drive backup as beta inside the existing button', () => {
    renderSettings()
    const button = screen.getByTestId('settings-drive-button')
    const badge = within(button).getByText('Beta')
    const title = button.querySelector('.settings-data-title-with-badge')

    expect(badge.tagName).toBe('SPAN')
    expect(badge).not.toHaveAttribute('tabindex')
    expect(badge).not.toHaveAttribute('role')
    expect(title).toContainElement(badge)
    expect(title).toHaveTextContent(/^Google Drive backup/)
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
  it('exposes Time Trend Y scale and cutoff controls under Statistics', () => {
    const onChange = vi.fn()
    renderSettings({ onChange })
    expect(screen.getByTestId('time-trend-scale')).toHaveTextContent('Auto')
    expect(screen.getByTestId('time-trend-cutoff')).toHaveTextContent('Standard')
    fireEvent.click(screen.getByTestId('time-trend-scale'))
    fireEvent.click(screen.getByRole('option', { name: 'Full range' }))
    expect(onChange).toHaveBeenLastCalledWith({ timeTrendScale: 'full' })
    fireEvent.click(screen.getByTestId('time-trend-cutoff'))
    fireEvent.click(screen.getByRole('option', { name: 'Gentle' }))
    expect(onChange).toHaveBeenLastCalledWith({ timeTrendCutoff: 'gentle' })
  })

  it('disables the Auto cutoff when Full range is selected', () => {
    renderSettings({ settings: { ...DEFAULT_SETTINGS, timeTrendScale: 'full' } })
    expect(screen.getByTestId('time-trend-cutoff')).toBeDisabled()
    cleanup()
    renderSettings({ settings: { ...DEFAULT_SETTINGS, timeTrendScale: 'auto' } })
    expect(screen.getByTestId('time-trend-cutoff')).toBeEnabled()
  })

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
