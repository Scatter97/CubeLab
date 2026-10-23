import { describe, expect, it } from 'vitest'
import type { Solve } from '../types'
import {
  DEFAULT_SETTINGS,
  SETTINGS_STORAGE_KEY,
  SOLVES_STORAGE_KEY,
  loadSettings,
  loadSolves,
  saveSettings,
  saveSolves,
  type StorageLike,
} from './storage'

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

function solve(overrides: Partial<Solve> = {}): Solve {
  return {
    id: 'solve-1',
    event: '333',
    rawMs: 12_340,
    penalty: 'none',
    scramble: "R U R' U'",
    createdAt: 1_700_000_000_000,
    ...overrides,
  }
}

describe('solve persistence', () => {
  it('round-trips solves through storage', () => {
    const storage = new MemoryStorage()
    const original = [
      solve(),
      solve({
        id: 'solve-2',
        rawMs: 9_999,
        penalty: '+2',
        createdAt: 1_700_000_001_000,
      }),
      solve({
        id: 'solve-3',
        rawMs: 11_111,
        penalty: 'dnf',
        createdAt: 1_700_000_002_000,
      }),
    ]

    expect(saveSolves(original, storage)).toBe(true)
    expect(loadSolves(storage)).toEqual(original)
  })

  it('survives a simulated refresh with a new load call', () => {
    const storage = new MemoryStorage()
    saveSolves([solve()], storage)
    expect(loadSolves(storage)).toHaveLength(1)
    expect(loadSolves(storage)[0]?.id).toBe('solve-1')
  })

  it('returns an empty session when no data exists', () => {
    expect(loadSolves(new MemoryStorage())).toEqual([])
  })

  it('recovers safely from corrupt JSON', () => {
    const storage = new MemoryStorage()
    storage.seed(SOLVES_STORAGE_KEY, '{not valid json')
    expect(loadSolves(storage)).toEqual([])
  })

  it('rejects an unknown storage version', () => {
    const storage = new MemoryStorage()
    storage.seed(
      SOLVES_STORAGE_KEY,
      JSON.stringify({ version: 99, solves: [solve()] }),
    )
    expect(loadSolves(storage)).toEqual([])
  })

  it('filters invalid and duplicate records without losing valid solves', () => {
    const storage = new MemoryStorage()
    storage.seed(
      SOLVES_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        solves: [
          solve(),
          { ...solve(), id: '', rawMs: 10 },
          { ...solve(), id: 'bad-penalty', penalty: 'double' },
          { ...solve(), id: 'bad-event', event: '222' },
          solve({ id: 'duplicate-id' }),
          { ...solve(), id: 'duplicate-id', rawMs: 99_999 },
          solve({ id: 'valid-2', rawMs: 10_000 }),
        ],
      }),
    )

    const loaded = loadSolves(storage)
    expect(loaded.map((item) => item.id)).toEqual([
      'solve-1',
      'duplicate-id',
      'valid-2',
    ])
  })

  it('reports failure when storage rejects a write', () => {
    const storage: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    }
    expect(saveSolves([solve()], storage)).toBe(false)
  })

  it('fails closed when storage access throws', () => {
    const storage: StorageLike = {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => undefined,
    }
    expect(loadSolves(storage)).toEqual([])
  })
})

describe('settings persistence', () => {
  it('uses safe defaults when empty', () => {
    expect(loadSettings(new MemoryStorage())).toEqual(DEFAULT_SETTINGS)
  })

  it('round-trips inspection preference', () => {
    const storage = new MemoryStorage()
    saveSettings({ inspectionEnabled: true }, storage)
    expect(loadSettings(storage)).toEqual({ inspectionEnabled: true })
  })

  it('falls back on malformed settings', () => {
    const storage = new MemoryStorage()
    storage.seed(SETTINGS_STORAGE_KEY, '["unexpected"]')
    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS)
  })

  it('falls back when the version is unsupported', () => {
    const storage = new MemoryStorage()
    storage.seed(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ version: 2, settings: { inspectionEnabled: true } }),
    )
    expect(loadSettings(storage)).toEqual(DEFAULT_SETTINGS)
  })
})
