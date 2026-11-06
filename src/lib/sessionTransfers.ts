import type { SessionTransfer } from '../types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizedSolveIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const ids = new Set<string>()
  for (const candidate of value) {
    if (typeof candidate !== 'string' || candidate.length === 0) continue
    ids.add(candidate)
  }
  return [...ids].sort()
}

/** Validates one persisted transfer record. Unknown fields are ignored. */
export function isSessionTransfer(value: unknown): value is SessionTransfer {
  if (!isRecord(value)) return false
  if (typeof value.id !== 'string' || value.id.length === 0) return false
  if (
    typeof value.fromSessionId !== 'string' ||
    value.fromSessionId.length === 0
  ) {
    return false
  }
  if (
    typeof value.toSessionId !== 'string' ||
    value.toSessionId.length === 0 ||
    value.toSessionId === value.fromSessionId
  ) {
    return false
  }
  const solveIds = normalizedSolveIds(value.solveIds)
  if (solveIds.length === 0) return false
  if (
    typeof value.transferredAt !== 'number' ||
    !Number.isFinite(value.transferredAt) ||
    value.transferredAt < 0
  ) {
    return false
  }
  return typeof value.byDeviceId === 'string' && value.byDeviceId.length > 0
}

function cloneTransfer(transfer: SessionTransfer): SessionTransfer {
  return {
    ...transfer,
    solveIds: normalizedSolveIds(transfer.solveIds),
  }
}

function preferTransfer(
  existing: SessionTransfer,
  candidate: SessionTransfer,
): SessionTransfer {
  if (candidate.transferredAt !== existing.transferredAt) {
    return candidate.transferredAt > existing.transferredAt
      ? candidate
      : existing
  }
  if (candidate.byDeviceId !== existing.byDeviceId) {
    return candidate.byDeviceId < existing.byDeviceId ? candidate : existing
  }
  const candidateKey = `${candidate.fromSessionId}\u0000${candidate.toSessionId}`
  const existingKey = `${existing.fromSessionId}\u0000${existing.toSessionId}`
  return candidateKey < existingKey ? candidate : existing
}

/**
 * Filters malformed records and removes duplicate solve IDs. Callers persist
 * this normalized form so later merges never need to repair a record silently.
 */
export function normalizeSessionTransfers(
  input: readonly unknown[],
): SessionTransfer[] {
  const byId = new Map<string, SessionTransfer>()
  for (const candidate of input) {
    if (!isSessionTransfer(candidate)) continue
    const next = cloneTransfer(candidate)
    const existing = byId.get(next.id)
    if (!existing) {
      byId.set(next.id, next)
      continue
    }
    const winner = preferTransfer(existing, next)
    byId.set(winner.id, {
      ...winner,
      solveIds: normalizedSolveIds([
        ...existing.solveIds,
        ...next.solveIds,
      ]),
    })
  }
  return sortTransfers([...byId.values()])
}

function sortTransfers(
  transfers: readonly SessionTransfer[],
): SessionTransfer[] {
  return [...transfers].sort(
    (left, right) =>
      left.transferredAt - right.transferredAt ||
      left.byDeviceId.localeCompare(right.byDeviceId) ||
      left.id.localeCompare(right.id),
  )
}

/**
 * Unions operations from multiple snapshots. Records with the same operation
 * ID are folded deterministically; distinct operations are retained so a stale
 * device cannot erase the ownership intent.
 */
export function mergeSessionTransfers(
  ...groups: ReadonlyArray<ReadonlyArray<SessionTransfer>>
): SessionTransfer[] {
  return normalizeSessionTransfers(groups.flat())
}

/**
 * Returns the final owning session for every transferred solve. Later
 * operations win; equal timestamps use the same device/ID tiebreak as other
 * sync metadata. Redirecting either session preserves the ownership decision.
 */
export function resolveSessionTransferOwners(
  transfers: readonly SessionTransfer[],
  canonicalSessionId: (id: string) => string,
): Map<string, string> {
  const owners = new Map<string, string>()
  for (const transfer of sortTransfers(mergeSessionTransfers(transfers))) {
    const destination = canonicalSessionId(transfer.toSessionId)
    for (const solveId of transfer.solveIds) {
      owners.set(solveId, destination)
    }
  }
  return owners
}
