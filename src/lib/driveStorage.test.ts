import { describe, expect, it } from 'vitest'
import type { StorageLike } from './storage'
import {
  DRIVE_STORAGE_KEY,
  DEFAULT_DRIVE_STATE,
  loadDriveBackupState,
  parseDriveBackupState,
  saveDriveBackupState,
} from './driveStorage'

class MemoryStorage implements StorageLike {
  private values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }

  seed(key: string, value: string): void {
    this.values.set(key, value)
  }
}

describe('drive backup state persistence', () => {
  it('uses safe defaults when empty', () => {
    expect(loadDriveBackupState(new MemoryStorage())).toEqual(DEFAULT_DRIVE_STATE)
  })

  it('round-trips a complete state', () => {
    const storage = new MemoryStorage()
    const state = {
      ...DEFAULT_DRIVE_STATE,
      remoteFileId: 'drive-file-1',
      remoteModifiedTime: '2026-10-24T00:00:00.000Z',
      lastBackupAt: 1_000,
      lastRestoreAt: 2_000,
      connectedAccountLabel: 'person@example.com',
    }
    expect(saveDriveBackupState(state, storage)).toBe(true)
    expect(loadDriveBackupState(storage)).toEqual(state)
  })

  it('rejects unsupported or malformed state', () => {
    const storage = new MemoryStorage()
    storage.seed(DRIVE_STORAGE_KEY, JSON.stringify({ version: 2 }))
    expect(loadDriveBackupState(storage)).toEqual(DEFAULT_DRIVE_STATE)

    storage.seed(DRIVE_STORAGE_KEY, JSON.stringify({ version: 1, remoteFileId: 5 }))
    expect(loadDriveBackupState(storage)).toEqual(DEFAULT_DRIVE_STATE)
  })

  it('validates each field independently', () => {
    expect(
      parseDriveBackupState({
        version: 1,
        remoteFileId: 'file',
        remoteModifiedTime: null,
        lastBackupAt: 'bad',
        lastRestoreAt: -1,
        connectedAccountLabel: 42,
      }),
    ).toEqual({
      version: 1,
      remoteFileId: 'file',
      remoteModifiedTime: null,
      lastBackupAt: null,
      lastRestoreAt: null,
      connectedAccountLabel: null,
    })
  })
})