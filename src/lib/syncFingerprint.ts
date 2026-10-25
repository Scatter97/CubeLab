import type { SessionsData, Settings } from '../types'

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const result: Record<string, unknown> = {}
    for (const key of Object.keys(record).sort()) {
      if (record[key] === undefined) continue
      result[key] = stableValue(record[key])
    }
    return result
  }
  return value
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * A deterministic, cheap fingerprint of the synchronization-relevant local
 * state. It detects both new object references and accidental in-place
 * mutation, and is persisted after a confirmed remote write so the UI can tell
 * whether any local change is still waiting to sync.
 */
export function syncStateFingerprint(
  sessions: SessionsData,
  settings: Settings,
): string {
  return fnv1a(
    JSON.stringify(
      stableValue({
        activeSessionId: sessions.activeSessionId,
        sessions: sessions.sessions,
        settings,
      }),
    ),
  )
}
