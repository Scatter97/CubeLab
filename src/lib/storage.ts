import type { Penalty, Settings, Solve } from '../types'

export const SOLVES_STORAGE_KEY = 'cubelab:solves:v1'
export const SETTINGS_STORAGE_KEY = 'cubelab:settings:v1'
export const STORAGE_VERSION = 1

export const DEFAULT_SETTINGS: Settings = {
  inspectionEnabled: false,
}

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

interface StoredSolves {
  version: typeof STORAGE_VERSION
  solves: Solve[]
}

interface StoredSettings {
  version: typeof STORAGE_VERSION
  settings: Settings
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPenalty(value: unknown): value is Penalty {
  return value === 'none' || value === '+2' || value === 'dnf'
}

function parseSolve(value: unknown): Solve | null {
  if (!isRecord(value)) return null
  if (typeof value.id !== 'string' || value.id.length === 0) return null
  if (value.event !== '333') return null
  if (
    typeof value.rawMs !== 'number' ||
    !Number.isFinite(value.rawMs) ||
    value.rawMs < 0
  ) {
    return null
  }
  if (!isPenalty(value.penalty)) return null
  if (typeof value.scramble !== 'string' || value.scramble.length === 0) {
    return null
  }
  if (
    typeof value.createdAt !== 'number' ||
    !Number.isFinite(value.createdAt) ||
    value.createdAt <= 0
  ) {
    return null
  }

  return {
    id: value.id,
    event: '333',
    rawMs: value.rawMs,
    penalty: value.penalty,
    scramble: value.scramble,
    createdAt: value.createdAt,
  }
}

function getDefaultStorage(): StorageLike | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    return window.localStorage
  } catch {
    // Sandboxed iframes and privacy modes can throw on access.
    return null
  }
}

/**
 * Loads valid solves individually. Corrupt records are skipped rather than
 * making the whole session unreadable. Duplicate IDs are ignored to keep
 * React keys and edits deterministic.
 */
export function loadSolves(storage = getDefaultStorage()): Solve[] {
  if (!storage) return []

  try {
    const raw = storage.getItem(SOLVES_STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed) || parsed.version !== STORAGE_VERSION) return []
    if (!Array.isArray(parsed.solves)) return []

    const seen = new Set<string>()
    const solves: Solve[] = []
    for (const candidate of parsed.solves) {
      const solve = parseSolve(candidate)
      if (solve && !seen.has(solve.id)) {
        seen.add(solve.id)
        solves.push(solve)
      }
    }
    return solves
  } catch {
    return []
  }
}

export function saveSolves(
  solves: readonly Solve[],
  storage = getDefaultStorage(),
): boolean {
  if (!storage) return false

  const payload: StoredSolves = {
    version: STORAGE_VERSION,
    solves: [...solves],
  }

  try {
    storage.setItem(SOLVES_STORAGE_KEY, JSON.stringify(payload))
    return true
  } catch {
    return false
  }
}

export function loadSettings(storage = getDefaultStorage()): Settings {
  if (!storage) return { ...DEFAULT_SETTINGS }

  try {
    const raw = storage.getItem(SETTINGS_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed) || parsed.version !== STORAGE_VERSION) {
      return { ...DEFAULT_SETTINGS }
    }
    if (!isRecord(parsed.settings)) return { ...DEFAULT_SETTINGS }
    return {
      inspectionEnabled: parsed.settings.inspectionEnabled === true,
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(
  settings: Settings,
  storage = getDefaultStorage(),
): boolean {
  if (!storage) return false

  const payload: StoredSettings = {
    version: STORAGE_VERSION,
    settings: {
      inspectionEnabled: settings.inspectionEnabled,
    },
  }

  try {
    storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(payload))
    return true
  } catch {
    return false
  }
}
