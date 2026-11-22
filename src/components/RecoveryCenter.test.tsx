import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { RecoveryCenter } from './RecoveryCenter'
import {
  DEFAULT_SETTINGS,
  SESSIONS_STORAGE_KEY,
  SETTINGS_STORAGE_KEY,
  saveSessions,
  saveSettings,
} from '../lib/storage'
import {
  createLocalStorageUpgradeArchiveStore,
  createUpgradeArchive,
  markUpgradeArchiveStatus,
} from '../lib/upgradeArchive'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  localStorage.clear()
})

function failure(kind = 'settings') {
  return {
    kind,
    message: 'Saved settings could not be validated. The original data has been kept.',
  }
}

describe('RecoveryCenter', () => {
  it('renders the failure, inspects strict stores and retries without writing', async () => {
    saveSessions({
      activeSessionId: 'session-1',
      sessions: [
        {
          id: 'session-1',
          name: 'Keep',
          createdAt: 1_700_000_000_000,
          updatedAt: 1_700_000_000_000,
          solves: [],
        },
      ],
    })
    saveSettings(DEFAULT_SETTINGS)
    const corrupt = JSON.stringify({ version: 14, settings: { future: true } })
    localStorage.setItem(SETTINGS_STORAGE_KEY, corrupt)
    const onRetry = vi.fn()
    render(<RecoveryCenter failure={failure()} busy={false} onRetry={onRetry} />)

    expect(
      screen.getByRole('heading', { name: 'Recovery required' }),
    ).toBeInTheDocument()
    expect(screen.getByTestId('startup-recovery-retry')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('startup-recovery-retry'))
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(SETTINGS_STORAGE_KEY)).toBe(corrupt)
    expect(localStorage.getItem(SESSIONS_STORAGE_KEY)).not.toBeNull()

    fireEvent.click(
      screen.getByRole('button', { name: 'View recovery information' }),
    )
    await waitFor(() =>
      expect(screen.getByText(/Unsupported version/)).toBeInTheDocument(),
    )
    expect(screen.getAllByText(/Sessions/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Training/).length).toBeGreaterThan(0)
    expect(screen.getByText(/Synchronization provenance/)).toBeInTheDocument()
  })

  it('downloads the exact raw bytes and only enables reset after explicit confirmation', async () => {
    const corruptSessions = '{"version":7,"sessions":"broken"}'
    localStorage.setItem(SESSIONS_STORAGE_KEY, corruptSessions)
    localStorage.setItem(SETTINGS_STORAGE_KEY, '{bad settings')
    const captured: Blob[] = []
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      captured.push(blob as Blob)
      return 'blob:recovery'
    })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)

    render(<RecoveryCenter failure={failure('sessions')} busy={false} onRetry={vi.fn()} />)
    fireEvent.click(screen.getByTestId('recovery-download'))
    await waitFor(() => expect(captured).toHaveLength(1))
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error)
      reader.readAsText(captured[0]!)
    })
    const pkg = JSON.parse(text) as {
      records: Array<{ key: string; raw: string | null; present: boolean }>
    }
    expect(
      pkg.records.find((record) => record.key === SESSIONS_STORAGE_KEY),
    ).toMatchObject({ present: true, raw: corruptSessions })
    expect(localStorage.getItem(SESSIONS_STORAGE_KEY)).toBe(corruptSessions)

    const reset = screen.getByTestId('recovery-reset')
    expect(reset).toBeDisabled()
    fireEvent.click(screen.getByLabelText(/I saved the recovery copy/))
    fireEvent.change(screen.getByLabelText(/Type RESET CUBELAB/), {
      target: { value: 'RESET' },
    })
    expect(reset).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/Type RESET CUBELAB/), {
      target: { value: 'RESET CUBELAB' },
    })
    expect(reset).toBeEnabled()
  })

  it('previews a verified local archive before restoring it', async () => {
    localStorage.setItem(SESSIONS_STORAGE_KEY, '{broken')
    saveSettings(DEFAULT_SETTINGS)
    const store = createLocalStorageUpgradeArchiveStore(localStorage)
    const archive = await createUpgradeArchive(
      {
        reason: 'schema-migration',
        sources: [
          {
            key: SESSIONS_STORAGE_KEY,
            raw: JSON.stringify({ version: 6, sessions: [] }),
            sourceVersion: 6,
          },
        ],
      },
      store,
    )
    await markUpgradeArchiveStatus(archive.id, 'complete', store)

    render(<RecoveryCenter failure={failure('sessions')} busy={false} onRetry={vi.fn()} />)
    fireEvent.click(
      screen.getByRole('button', { name: 'View recovery information' }),
    )
    await waitFor(() =>
      expect(screen.getByText(/schema migration/)).toBeInTheDocument(),
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Preview and restore this archive' }),
    )
    expect(
      screen.getByText(/This replaces the current sessions/),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Confirm archive restore' }),
    ).toBeInTheDocument()
    expect(localStorage.getItem(SESSIONS_STORAGE_KEY)).toBe('{broken')
  })
})
