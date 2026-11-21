import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StorageHealthPanel } from './StorageHealthPanel'
import { saveDriveBackupState, DEFAULT_DRIVE_STATE } from '../lib/driveStorage'
import { DEFAULT_SETTINGS, saveSessions, saveSettings } from '../lib/storage'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  localStorage.clear()
  Reflect.deleteProperty(navigator, 'storage')
})

function installStorageManager(manager: Partial<StorageManager>) {
  Object.defineProperty(navigator, 'storage', {
    configurable: true,
    value: manager,
  })
}

describe('StorageHealthPanel', () => {
  it('reports granted persistence, quota usage and reliable timestamps', async () => {
    installStorageManager({
      persisted: async () => true,
      persist: async () => true,
      estimate: async () => ({ usage: 2048, quota: 4096 }),
    })
    saveDriveBackupState({
      ...DEFAULT_DRIVE_STATE,
      lastBackupAt: 1_700_000_000_000,
    })
    render(
      <StorageHealthPanel
        storageOk
        lastSyncAt={1_700_000_100_000}
      />,
    )
    await waitFor(() => expect(screen.getByText('Granted')).toBeInTheDocument())
    expect(screen.getByText(/2.0 KB of 4.0 KB/)).toBeInTheDocument()
    expect(screen.getByText(/Synchronization is not an independent backup/)).toBeInTheDocument()
    expect(
      screen.getByTestId('storage-request-persistence'),
    ).toBeDisabled()
  })

  it('reports denied persistence and does not invent backup timestamps', async () => {
    installStorageManager({
      persisted: async () => false,
      persist: async () => false,
      estimate: async () => ({}),
    })
    render(<StorageHealthPanel storageOk lastSyncAt={null} />)
    await waitFor(() =>
      expect(screen.getByText('Not granted')).toBeInTheDocument(),
    )
    expect(screen.getAllByText('Not recorded').length).toBeGreaterThanOrEqual(2)
  })

  it('downloads a manifest recovery package from Settings', async () => {
    installStorageManager({ persisted: async () => false })
    saveSessions({
      activeSessionId: 'session-1',
      sessions: [
        {
          id: 'session-1',
          name: 'Settings copy',
          createdAt: 1_700_000_000_000,
          updatedAt: 1_700_000_000_000,
          solves: [],
        },
      ],
    })
    saveSettings(DEFAULT_SETTINGS)
    const captured: Blob[] = []
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      captured.push(blob as Blob)
      return 'blob:recovery'
    })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)

    render(<StorageHealthPanel storageOk lastSyncAt={null} />)
    fireEvent.click(screen.getByTestId('storage-recovery-export'))
    await waitFor(() => expect(captured).toHaveLength(1))
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error)
      reader.readAsText(captured[0]!)
    })
    const parsed = JSON.parse(text) as { format: string; records: unknown[] }
    expect(parsed.format).toBe('cubelab-recovery')
    expect(parsed.records.length).toBeGreaterThan(0)
  })
})
