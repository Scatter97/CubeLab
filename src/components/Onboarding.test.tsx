import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Backup } from '../lib/backup'
import type { DriveTransport } from '../lib/driveTransport'
import type { UseSyncResult } from '../hooks/useSync'
import { DEFAULT_SETTINGS } from '../lib/storage'
import type { SessionsData, Settings } from '../types'
import { Onboarding } from './Onboarding'

function defaultSessions(): SessionsData {
  return {
    activeSessionId: 'default',
    sessions: [
      {
        id: 'default',
        name: 'Session 1',
        isAutoCreatedDefault: true,
        createdAt: 10,
        updatedAt: 10,
        solves: [],
      },
    ],
  }
}

function createSync(): UseSyncResult {
  return {
    updatePreferences: vi.fn(),
    syncNow: vi.fn(async () => {}),
    isSyncRunning: () => false,
  } as unknown as UseSyncResult
}

function baseProps(overrides: {
  sessionsData?: SessionsData
  settings?: Settings
  sync?: UseSyncResult
  transport?: DriveTransport | null
  onCommitSetup?: (
    sessionsData: SessionsData,
    settingsData: Settings,
  ) => Promise<boolean>
  onImportBackup?: (
    backup: Backup,
  ) => Promise<
    { ok: true; importedSessionIds: string[] } | { ok: false; error: string }
  >
  onMarkComplete?: () => void
  onSkip?: () => void
  onClose?: () => void
  onFinish?: () => void
} = {}) {
  return {
    mode: 'first-run' as const,
    sessionsData: overrides.sessionsData ?? defaultSessions(),
    settings: overrides.settings ?? DEFAULT_SETTINGS,
    sync: overrides.sync ?? createSync(),
    transport: overrides.transport ?? null,
    drawScrambleMode: 'net' as const,
    onDrawScrambleModeChange: vi.fn(),
    onChangeSettings: vi.fn(),
    onCommitSetup: overrides.onCommitSetup ?? vi.fn(async () => true),
    onImportBackup:
      overrides.onImportBackup ??
      vi.fn(async () => ({ ok: true as const, importedSessionIds: ['import-1'] })),
    onMarkComplete: overrides.onMarkComplete ?? vi.fn(),
    onSkip: overrides.onSkip ?? vi.fn(),
    onClose: overrides.onClose ?? vi.fn(),
    onFinish: overrides.onFinish ?? vi.fn(),
  }
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Onboarding welcome and Start Fresh', () => {
  it('presents the three paths and skips without changing data', () => {
    const onSkip = vi.fn()
    render(<Onboarding {...baseProps({ onSkip })} />)
    expect(
      screen.getByRole('heading', { name: 'Welcome to CubeLab' }),
    ).toBeVisible()
    expect(screen.getByTestId('onboarding-start-fresh')).toBeVisible()
    expect(screen.getByTestId('onboarding-import-cstimer')).toBeVisible()
    expect(screen.getByTestId('onboarding-returning')).toBeVisible()
    fireEvent.click(screen.getByTestId('onboarding-skip'))
    expect(onSkip).toHaveBeenCalledOnce()
  })

  it('selects 3×3 by default, prevents an empty selection, and commits one empty session per event', async () => {
    const onCommitSetup = vi.fn<
      (sessionsData: SessionsData, settingsData: Settings) => Promise<boolean>
    >(async () => true)
    const onMarkComplete = vi.fn()
    render(
      <Onboarding
        {...baseProps({ onCommitSetup, onMarkComplete })}
      />,
    )
    fireEvent.click(screen.getByTestId('onboarding-start-fresh'))

    const three = screen.getByTestId('onboarding-event-333') as HTMLInputElement
    expect(three.checked).toBe(true)
    fireEvent.click(three)
    expect(three.checked).toBe(true)
    expect(screen.getByText('Keep at least one event selected.')).toBeVisible()

    fireEvent.click(screen.getByTestId('onboarding-event-222'))
    expect((screen.getByTestId('onboarding-event-222') as HTMLInputElement).checked).toBe(
      true,
    )
    fireEvent.click(screen.getByTestId('onboarding-events-continue'))

    expect(
      screen.getByRole('heading', { name: 'Set up CubeLab' }),
    ).toBeVisible()
    expect(screen.getByTestId('onboarding-main-333')).toBeVisible()
    expect(screen.getByTestId('onboarding-main-222')).toBeVisible()
    fireEvent.click(screen.getByTestId('onboarding-main-222'))
    fireEvent.click(screen.getByTestId('onboarding-settings-continue'))

    expect(
      screen.getByRole('heading', { name: 'Turn on Sync?' }),
    ).toBeVisible()
    await act(async () => {
      fireEvent.click(screen.getByTestId('onboarding-maybe-later'))
    })

    await waitFor(() => {
      expect(onMarkComplete).toHaveBeenCalledOnce()
    })
    expect(onCommitSetup).toHaveBeenCalledOnce()
    const committed = onCommitSetup.mock.calls[0]![0]
    expect(committed.sessions).toHaveLength(2)
    expect(
      committed.sessions.map((session) => [session.name, session.event]),
    ).toEqual([
      ['3×3', '333'],
      ['2×2', '222'],
    ])
    expect(committed.activeSessionId).toBe(
      committed.sessions.find((session) => session.event === '222')!.id,
    )
    expect(
      screen.getByRole('heading', { name: "You're all set!" }),
    ).toBeVisible()
    expect(screen.getByText('Main Event')).toBeVisible()
    expect(screen.getByText('2×2')).toBeVisible()
    expect(screen.queryByRole('button', { name: /start cubing/i })).toBeNull()
  })

  it('reports a save failure instead of showing success', async () => {
    const onCommitSetup = vi.fn(async () => false)
    const onMarkComplete = vi.fn()
    render(
      <Onboarding
        {...baseProps({ onCommitSetup, onMarkComplete })}
      />,
    )
    fireEvent.click(screen.getByTestId('onboarding-start-fresh'))
    fireEvent.click(screen.getByTestId('onboarding-events-continue'))
    fireEvent.click(screen.getByTestId('onboarding-settings-continue'))
    await act(async () => {
      fireEvent.click(screen.getByTestId('onboarding-maybe-later'))
    })
    expect(
      await screen.findByText(
        'CubeLab could not save the setup. Check browser storage and retry.',
      ),
    ).toBeVisible()
    expect(onMarkComplete).not.toHaveBeenCalled()
    expect(
      screen.queryByRole('heading', { name: "You're all set!" }),
    ).toBeNull()
  })
})

const CS_TIMER_FILE = JSON.stringify({
  session1: [[12_345, 'R U', '', 1_700_000_000]],
  session2: [[9_000, 'F R', '', 1_700_000_001]],
  properties: {
    sessionData: JSON.stringify({
      1: { name: 'Main', opt: { scrType: '333' }, rank: 1, date: [1_700_000_000] },
      2: { name: 'Two', opt: { scrType: '222' }, rank: 2, date: [1_700_000_001] },
    }),
  },
})

describe('Onboarding csTimer import', () => {
  it('previews session and solve counts, event mapping, and imports without creating event sessions', async () => {
    const onImportBackup = vi.fn<
      (backup: Backup) => Promise<
        { ok: true; importedSessionIds: string[] } | { ok: false; error: string }
      >
    >(async () => ({ ok: true, importedSessionIds: ['import-1', 'import-2'] }))
    const onCommitSetup = vi.fn(async () => true)
    render(
      <Onboarding
        {...baseProps({ onImportBackup, onCommitSetup })}
      />,
    )
    fireEvent.click(screen.getByTestId('onboarding-import-cstimer'))
    const input = screen.getByTestId('onboarding-import-file')
    const file = new File([CS_TIMER_FILE], 'timer.txt', { type: 'text/plain' })
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } })
    })
    expect(await screen.findByText('Main')).toBeVisible()
    expect(screen.getByText('Two')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Import 2 sessions' })).toBeVisible()
    expect(screen.getAllByText('2', { selector: '.onboarding-import-summary strong' })).toHaveLength(2)

    await act(async () => {
      fireEvent.click(screen.getByTestId('onboarding-import-confirm'))
    })
    await waitFor(() => {
      expect(onImportBackup).toHaveBeenCalledOnce()
    })
    expect(onCommitSetup).not.toHaveBeenCalled()
    expect(
      screen.getByRole('heading', { name: 'Set up CubeLab' }),
    ).toBeVisible()
    expect(screen.getByTestId('onboarding-main-333')).toBeVisible()
    expect(screen.getByTestId('onboarding-main-222')).toBeVisible()
  })
})

describe('Onboarding returning user', () => {
  it('reflects an already connected Google account without requesting auth again', () => {
    const connect = vi.fn(async () => {})
    const transport = {
      configured: true,
      accountLabel: 'Google Drive connected',
      connect,
      disconnect: vi.fn(),
      isConnected: () => true,
      findBackup: async () => null,
      listBackups: async () => [],
      uploadBackup: vi.fn(),
      uploadDeviceBackup: vi.fn(),
      downloadBackup: vi.fn(),
      deleteBackup: vi.fn(),
    } as unknown as DriveTransport
    render(<Onboarding {...baseProps({ transport })} />)
    fireEvent.click(screen.getByTestId('onboarding-start-fresh'))
    fireEvent.click(screen.getByTestId('onboarding-events-continue'))
    fireEvent.click(screen.getByTestId('onboarding-settings-continue'))
    expect(screen.getByText('Google Drive is connected.')).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Sync this device' }),
    ).toBeVisible()
    expect(connect).not.toHaveBeenCalled()
  })

  it('shows an OAuth failure on the restore screen and does not create sessions', async () => {
    const transport = {
      configured: true,
      accountLabel: null,
      connect: vi.fn(async () => {
        throw new Error(
          'The Google sign-in window was closed before access was granted.',
        )
      }),
      disconnect: vi.fn(),
      isConnected: () => false,
      findBackup: async () => null,
      listBackups: async () => [],
      uploadBackup: vi.fn(),
      uploadDeviceBackup: vi.fn(),
      downloadBackup: vi.fn(),
      deleteBackup: vi.fn(),
    } as unknown as DriveTransport
    const onCommitSetup = vi.fn(async () => true)
    render(<Onboarding {...baseProps({ transport, onCommitSetup })} />)
    fireEvent.click(screen.getByTestId('onboarding-returning'))
    await act(async () => {
      fireEvent.click(screen.getByTestId('onboarding-returning-connect'))
    })
    expect(
      await screen.findByRole('heading', { name: 'Restore did not complete' }),
    ).toBeVisible()
    expect(
      screen.getByText(
        'The Google sign-in window was closed before access was granted.',
      ),
    ).toBeVisible()
    expect(onCommitSetup).not.toHaveBeenCalled()
  })

  it('reports no cloud data without creating sessions', async () => {
    let connected = false
    const connect = vi.fn(async () => {
      connected = true
    })
    const transport = {
      configured: true,
      accountLabel: null,
      connect,
      disconnect: vi.fn(() => {
        connected = false
      }),
      isConnected: () => connected,
      findBackup: async () => null,
      listBackups: async () => [],
      uploadBackup: vi.fn(),
      uploadDeviceBackup: vi.fn(),
      downloadBackup: vi.fn(),
      deleteBackup: vi.fn(),
    } as unknown as DriveTransport
    const onCommitSetup = vi.fn(async () => true)
    render(
      <Onboarding {...baseProps({ transport, onCommitSetup })} />,
    )
    fireEvent.click(screen.getByTestId('onboarding-returning'))
    expect(
      screen.getByRole('heading', { name: 'Welcome Back' }),
    ).toBeVisible()
    fireEvent.click(screen.getByTestId('onboarding-returning-connect'))
    expect(
      await screen.findByRole('heading', { name: 'No CubeLab data found' }),
    ).toBeVisible()
    expect(connect).toHaveBeenCalledOnce()
    expect(onCommitSetup).not.toHaveBeenCalled()
  })
})
