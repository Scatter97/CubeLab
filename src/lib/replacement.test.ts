import { beforeEach, describe, expect, it } from 'vitest'
import type { StorageLike } from './storage'
import {
  REPLACEMENT_STORAGE_KEY,
  beginReplacement,
  loadReplacementJournal,
  markReplacementCommitted,
  recoverPendingReplacement,
  replacementBlocksSync,
} from './replacement'
import {
  SESSIONS_STORAGE_KEY,
  SETTINGS_STORAGE_KEY,
} from './storage'
import { SYNC_STORAGE_KEY } from './syncStorage'
import { DRIVE_STORAGE_KEY } from './driveStorage'
import { TRAINING_STORAGE_KEY } from './training/storage'

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>()
  failSet = new Set<string>()
  failRemove = new Set<string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    if (this.failSet.has(key)) throw new Error(`set failed: ${key}`)
    this.values.set(key, value)
  }

  removeItem(key: string): void {
    if (this.failRemove.has(key)) throw new Error(`remove failed: ${key}`)
    this.values.delete(key)
  }
}

function seeded(): MemoryStorage {
  const storage = new MemoryStorage()
  storage.setItem(SESSIONS_STORAGE_KEY, 'old-sessions')
  storage.setItem(SETTINGS_STORAGE_KEY, 'old-settings')
  storage.setItem(SYNC_STORAGE_KEY, 'old-sync')
  storage.setItem(DRIVE_STORAGE_KEY, 'old-drive')
  storage.setItem(TRAINING_STORAGE_KEY, 'old-training')
  return storage
}

function journalRaw(storage: MemoryStorage): string | null {
  return storage.getItem(REPLACEMENT_STORAGE_KEY)
}

describe('durable replacement journal', () => {
  let storage: MemoryStorage

  beforeEach(() => {
    storage = seeded()
  })

  it('rolls a prepared transaction back to every captured key', () => {
    const begun = beginReplacement(
      'native-import',
      ['sessions', 'settings', 'sync', 'drive', 'training'],
      storage,
    )
    expect(begun.ok).toBe(true)
    if (!begun.ok) return
    expect(replacementBlocksSync(storage)).toBe(true)

    storage.setItem(SESSIONS_STORAGE_KEY, 'new-sessions')
    storage.setItem(SETTINGS_STORAGE_KEY, 'new-settings')
    storage.setItem(SYNC_STORAGE_KEY, 'new-sync')
    storage.setItem(DRIVE_STORAGE_KEY, 'new-drive')
    storage.setItem(TRAINING_STORAGE_KEY, 'new-training')

    expect(recoverPendingReplacement(storage)).toEqual({ status: 'rolled-back' })
    expect(storage.getItem(SESSIONS_STORAGE_KEY)).toBe('old-sessions')
    expect(storage.getItem(SETTINGS_STORAGE_KEY)).toBe('old-settings')
    expect(storage.getItem(SYNC_STORAGE_KEY)).toBe('old-sync')
    expect(storage.getItem(DRIVE_STORAGE_KEY)).toBe('old-drive')
    expect(storage.getItem(TRAINING_STORAGE_KEY)).toBe('old-training')
    expect(journalRaw(storage)).toBeNull()
    expect(replacementBlocksSync(storage)).toBe(false)
  })

  it('rolls a committed transaction forward and keeps the Training key', () => {
    const begun = beginReplacement(
      'drive-restore',
      ['sessions', 'settings', 'sync', 'drive', 'training'],
      storage,
    )
    expect(begun.ok).toBe(true)
    if (!begun.ok) return
    storage.setItem(SESSIONS_STORAGE_KEY, 'new-sessions')
    storage.setItem(SETTINGS_STORAGE_KEY, 'new-settings')
    storage.setItem(SYNC_STORAGE_KEY, 'new-sync')
    storage.setItem(DRIVE_STORAGE_KEY, 'new-drive')
    storage.setItem(TRAINING_STORAGE_KEY, 'new-training')
    expect(markReplacementCommitted(begun.journal, storage)).toBe(true)
    expect(replacementBlocksSync(storage)).toBe(false)

    expect(recoverPendingReplacement(storage)).toEqual({ status: 'committed' })
    expect(storage.getItem(SESSIONS_STORAGE_KEY)).toBe('new-sessions')
    expect(storage.getItem(SETTINGS_STORAGE_KEY)).toBe('new-settings')
    expect(storage.getItem(SYNC_STORAGE_KEY)).toBe('new-sync')
    expect(storage.getItem(DRIVE_STORAGE_KEY)).toBe('new-drive')
    expect(storage.getItem(TRAINING_STORAGE_KEY)).toBe('new-training')
    expect(journalRaw(storage)).toBeNull()
  })

  it('keeps an old journal without a Training key compatible', () => {
    const begun = beginReplacement('native-import', ['sessions', 'sync'], storage)
    expect(begun.ok).toBe(true)
    if (!begun.ok) return
    expect(begun.journal.before).toEqual({
      sessions: 'old-sessions',
      sync: 'old-sync',
    })
    storage.setItem(SESSIONS_STORAGE_KEY, 'new-sessions')
    storage.setItem(SYNC_STORAGE_KEY, 'new-sync')
    storage.setItem(TRAINING_STORAGE_KEY, 'new-training')

    expect(recoverPendingReplacement(storage)).toEqual({ status: 'rolled-back' })
    expect(storage.getItem(SESSIONS_STORAGE_KEY)).toBe('old-sessions')
    expect(storage.getItem(SYNC_STORAGE_KEY)).toBe('old-sync')
    // Training was not captured, so rollback must not touch it.
    expect(storage.getItem(TRAINING_STORAGE_KEY)).toBe('new-training')
  })

  it('restores an absent Training key as absent during rollback', () => {
    storage.removeItem(TRAINING_STORAGE_KEY)
    const begun = beginReplacement('native-import', ['training'], storage)
    expect(begun.ok).toBe(true)
    if (!begun.ok) return
    expect(begun.journal.before.training).toBeNull()
    storage.setItem(TRAINING_STORAGE_KEY, 'imported-training')
    expect(recoverPendingReplacement(storage)).toEqual({ status: 'rolled-back' })
    expect(storage.getItem(TRAINING_STORAGE_KEY)).toBeNull()
  })

  it('keeps the recovery record when a rollback write or cleanup fails', () => {
    const begun = beginReplacement('native-import', ['sessions', 'sync'], storage)
    expect(begun.ok).toBe(true)
    if (!begun.ok) return
    storage.setItem(SESSIONS_STORAGE_KEY, 'new-sessions')
    storage.setItem(SYNC_STORAGE_KEY, 'new-sync')

    storage.failSet.add(SESSIONS_STORAGE_KEY)
    expect(recoverPendingReplacement(storage).status).toBe('cleanup-pending')
    expect(journalRaw(storage)).not.toBeNull()
    expect(storage.getItem(SESSIONS_STORAGE_KEY)).toBe('new-sessions')
    expect(replacementBlocksSync(storage)).toBe(true)

    storage.failSet.clear()
    storage.failRemove.add(REPLACEMENT_STORAGE_KEY)
    const recovered = recoverPendingReplacement(storage)
    expect(recovered.status).toBe('cleanup-pending')
    expect(storage.getItem(SESSIONS_STORAGE_KEY)).toBe('old-sessions')
    expect(storage.getItem(SYNC_STORAGE_KEY)).toBe('old-sync')
    expect(journalRaw(storage)).not.toBeNull()

    storage.failRemove.clear()
    expect(recoverPendingReplacement(storage)).toEqual({ status: 'rolled-back' })
    expect(journalRaw(storage)).toBeNull()
  })

  it('parses and recovers a Training-only replacement without touching solve keys', () => {
    const begun = beginReplacement('training-restore', ['training'], storage)
    expect(begun.ok).toBe(true)
    if (!begun.ok) return
    expect(begun.journal.kind).toBe('training-restore')
    expect(Object.keys(begun.journal.before)).toEqual(['training'])
    storage.setItem(TRAINING_STORAGE_KEY, 'restored-training')
    expect(markReplacementCommitted(begun.journal, storage)).toBe(true)
    expect(recoverPendingReplacement(storage)).toEqual({ status: 'committed' })
    expect(storage.getItem(TRAINING_STORAGE_KEY)).toBe('restored-training')
    expect(storage.getItem(SESSIONS_STORAGE_KEY)).toBe('old-sessions')
    expect(storage.getItem(SETTINGS_STORAGE_KEY)).toBe('old-settings')
    expect(storage.getItem(SYNC_STORAGE_KEY)).toBe('old-sync')
    expect(storage.getItem(DRIVE_STORAGE_KEY)).toBe('old-drive')
    expect(journalRaw(storage)).toBeNull()
  })

  it('rolls a Training-only prepared transaction back without solve writes', () => {
    const begun = beginReplacement('training-restore', ['training'], storage)
    expect(begun.ok).toBe(true)
    if (!begun.ok) return
    storage.setItem(TRAINING_STORAGE_KEY, 'candidate-training')
    expect(recoverPendingReplacement(storage)).toEqual({ status: 'rolled-back' })
    expect(storage.getItem(TRAINING_STORAGE_KEY)).toBe('old-training')
    expect(storage.getItem(SESSIONS_STORAGE_KEY)).toBe('old-sessions')
    expect(storage.getItem(SYNC_STORAGE_KEY)).toBe('old-sync')
  })

  it('does not start a second transaction while a recovery record exists', () => {
    const begun = beginReplacement('additive-import', ['sessions', 'sync'], storage)
    expect(begun.ok).toBe(true)
    const second = beginReplacement('native-import', ['sessions'], storage)
    expect(second.ok).toBe(false)
    if (second.ok) return
    expect(second.error).toContain('still pending')
  })

  it('retains malformed recovery records instead of treating them as absent', () => {
    storage.setItem(REPLACEMENT_STORAGE_KEY, '{broken')
    expect(loadReplacementJournal(storage).status).toBe('invalid')
    expect(replacementBlocksSync(storage)).toBe(true)
    const recovery = recoverPendingReplacement(storage)
    expect(recovery.status).toBe('invalid')
    expect(storage.getItem(REPLACEMENT_STORAGE_KEY)).toBe('{broken')
  })

  it('blocks journal preparation when the recovery key cannot be written', () => {
    storage.failSet.add(REPLACEMENT_STORAGE_KEY)
    const begun = beginReplacement('native-import', ['sessions'], storage)
    expect(begun.ok).toBe(false)
    if (begun.ok) return
    expect(begun.error).toContain('recovery record could not be saved')
    expect(storage.getItem(SESSIONS_STORAGE_KEY)).toBe('old-sessions')
  })

})
