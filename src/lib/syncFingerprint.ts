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
 * A deterministic content fingerprint of synchronization-relevant local state,
 * persisted after a confirmed remote write. It traverses current contents when
 * called; memoized callers still depend on immutable state references. This
 * 32-bit FNV-1a hash is not a collision-free equality proof.
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
        customEvents: sessions.customEvents ?? [],
        sessionOrder: sessions.sessionOrder ?? null,
        settings,
      }),
    ),
  )
}
