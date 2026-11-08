import type { Session, SessionsData, Solve } from '../types'
import { createId } from './id'
import { createSession, restoreSolve } from './sessions'
import { isActiveTombstone, type Tombstone } from './syncStorage'
import { parseSolve, type StorageLike } from './storage'

export const SOLVE_RECOVERY_STORAGE_KEY = 'cubelab:recovery:v1'
export const SOLVE_RECOVERY_VERSION = 1

export interface OriginalSolveDeletion {
  deletedAt: number
  deletedByDeviceId: string
}

export interface PendingSolveRestore {
  operationId: string
  sessionId: string
  sessionName?: string
  index: number
  solve: Solve
  createdAt: number
  /** The deletion that this Undo prepared to reverse, when known. */
  originalDeletion?: OriginalSolveDeletion
}

export interface SolveRecoveryData {
  version: typeof SOLVE_RECOVERY_VERSION
  operations: PendingSolveRestore[]
}

export interface PendingRecoveryApplication {
  data: SessionsData
  remaining: PendingSolveRestore[]
  recovered: PendingSolveRestore[]
  discarded: PendingSolveRestore[]
  /** Interrupted before its revocation committed, so the Undo safely aborted. */
  aborted: PendingSolveRestore[]
}

function getDefaultStorage(): StorageLike | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    return window.localStorage
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parsePendingSolveRestore(value: unknown): PendingSolveRestore | null {
  if (!isRecord(value)) return null
  if (
    typeof value.operationId !== 'string' ||
    value.operationId.length === 0 ||
    typeof value.sessionId !== 'string' ||
    value.sessionId.length === 0 ||
    typeof value.index !== 'number' ||
    !Number.isInteger(value.index) ||
    value.index < 0 ||
    typeof value.createdAt !== 'number' ||
    !Number.isFinite(value.createdAt) ||
    value.createdAt < 0
  ) {
    return null
  }
  const solve = parseSolve(value.solve)
  if (!solve) return null
  const originalDeletion =
    isRecord(value.originalDeletion) &&
    typeof value.originalDeletion.deletedAt === 'number' &&
    Number.isFinite(value.originalDeletion.deletedAt) &&
    value.originalDeletion.deletedAt >= 0 &&
    typeof value.originalDeletion.deletedByDeviceId === 'string' &&
    value.originalDeletion.deletedByDeviceId.length > 0
      ? {
          deletedAt: value.originalDeletion.deletedAt,
          deletedByDeviceId: value.originalDeletion.deletedByDeviceId,
        }
      : undefined
  return {
    operationId: value.operationId,
    sessionId: value.sessionId,
    ...(typeof value.sessionName === 'string' && value.sessionName.length > 0
      ? { sessionName: value.sessionName }
      : {}),
    index: value.index,
    solve,
    createdAt: value.createdAt,
    ...(originalDeletion ? { originalDeletion } : {}),
  }
}

export function createEmptySolveRecoveryData(): SolveRecoveryData {
  return { version: SOLVE_RECOVERY_VERSION, operations: [] }
}

export function loadSolveRecovery(
  storage: StorageLike | null = getDefaultStorage(),
): SolveRecoveryData {
  if (!storage) return createEmptySolveRecoveryData()
  try {
    const raw = storage.getItem(SOLVE_RECOVERY_STORAGE_KEY)
    if (!raw) return createEmptySolveRecoveryData()
    const parsed: unknown = JSON.parse(raw)
    if (
      !isRecord(parsed) ||
      parsed.version !== SOLVE_RECOVERY_VERSION ||
      !Array.isArray(parsed.operations)
    ) {
      return createEmptySolveRecoveryData()
    }
    const operations: PendingSolveRestore[] = []
    const solveIds = new Set<string>()
    for (const candidate of parsed.operations) {
      const operation = parsePendingSolveRestore(candidate)
      if (!operation || solveIds.has(operation.solve.id)) continue
      solveIds.add(operation.solve.id)
      operations.push(operation)
    }
    return { version: SOLVE_RECOVERY_VERSION, operations }
  } catch {
    return createEmptySolveRecoveryData()
  }
}

export function saveSolveRecovery(
  data: SolveRecoveryData,
  storage: StorageLike | null = getDefaultStorage(),
): boolean {
  if (!storage) return false
  try {
    storage.setItem(
      SOLVE_RECOVERY_STORAGE_KEY,
      JSON.stringify({
        version: SOLVE_RECOVERY_VERSION,
        operations: data.operations,
      }),
    )
    return true
  } catch {
    return false
  }
}

export function createPendingSolveRestore(
  solve: Solve,
  index: number,
  sessionId: string,
  sessionName?: string,
  originalDeletion?: OriginalSolveDeletion,
): PendingSolveRestore {
  return {
    operationId: createId(),
    sessionId,
    ...(sessionName ? { sessionName } : {}),
    index,
    solve,
    createdAt: Date.now(),
    ...(originalDeletion ? { originalDeletion } : {}),
  }
}

export function addPendingSolveRestore(
  operation: PendingSolveRestore,
  storage: StorageLike | null = getDefaultStorage(),
): boolean {
  const recovery = loadSolveRecovery(storage)
  return saveSolveRecovery(
    {
      ...recovery,
      operations: [
        ...recovery.operations.filter(
          (candidate) => candidate.solve.id !== operation.solve.id,
        ),
        operation,
      ],
    },
    storage,
  )
}

export function removePendingSolveRestore(
  operationId: string,
  storage: StorageLike | null = getDefaultStorage(),
): boolean {
  const recovery = loadSolveRecovery(storage)
  const operations = recovery.operations.filter(
    (operation) => operation.operationId !== operationId,
  )
  if (operations.length === recovery.operations.length) return true
  return saveSolveRecovery({ ...recovery, operations }, storage)
}

function recoverySessionName(data: SessionsData, base: string): string {
  const root = `${base.trim() || 'Session'} (recovered)`
  let candidate = root
  let counter = 2
  const used = new Set(data.sessions.map((session) => session.name.toLowerCase()))
  while (used.has(candidate.toLowerCase())) {
    candidate = `${root} ${counter}`
    counter += 1
  }
  return candidate
}

function sessionEvent(session: Session): string {
  return session.event ?? '333'
}

function isOriginalDeletion(
  tombstone: Tombstone,
  operation: PendingSolveRestore,
): boolean {
  const original = operation.originalDeletion
  if (!original) {
    // Older journals do not identify the deletion they prepared to reverse.
    // Treat an active tombstone conservatively as an aborted Undo rather than
    // overriding what may be a deliberate deletion.
    return true
  }
  return (
    tombstone.deletedAt === original.deletedAt &&
    tombstone.deletedByDeviceId === original.deletedByDeviceId
  )
}

/**
 * Applies durable Undo operations without touching storage.
 *
 * A journal is written before the revocation. If the original deletion is still
 * active, the Undo never committed and is safely aborted. Once the tombstone is
 * revoked, an incomplete collection restore is finished. A different, newer
 * active deletion supersedes the prepared restoration.
 */
export function applyPendingSolveRestores(input: {
  data: SessionsData
  tombstones: readonly Tombstone[]
  operations: readonly PendingSolveRestore[]
}): PendingRecoveryApplication {
  let data = input.data
  const remaining: PendingSolveRestore[] = []
  const recovered: PendingSolveRestore[] = []
  const discarded: PendingSolveRestore[] = []
  const aborted: PendingSolveRestore[] = []

  for (const operation of input.operations) {
    const alreadyPresent = data.sessions.some((session) =>
      session.solves.some((solve) => solve.id === operation.solve.id),
    )
    if (alreadyPresent) {
      recovered.push(operation)
      continue
    }
    const tombstone = input.tombstones.find(
      (entry) => entry.kind === 'solve' && entry.id === operation.solve.id,
    )
    if (tombstone && isActiveTombstone(tombstone)) {
      if (isOriginalDeletion(tombstone, operation)) {
        aborted.push(operation)
      } else {
        discarded.push(operation)
      }
      continue
    }

    const session = data.sessions.find(
      (candidate) => candidate.id === operation.sessionId,
    )
    if (session && sessionEvent(session) === operation.solve.event) {
      const restored = restoreSolve(
        data,
        operation.sessionId,
        operation.solve,
        operation.index,
      )
      if (!restored) {
        remaining.push(operation)
        continue
      }
      data = restored
      recovered.push(operation)
      continue
    }

    const recoveryId = `recovered:undo:${operation.operationId}`
    const existingRecoverySession = data.sessions.find(
      (candidate) => candidate.id === recoveryId,
    )
    if (
      existingRecoverySession &&
      sessionEvent(existingRecoverySession) !== operation.solve.event
    ) {
      remaining.push(operation)
      continue
    }

    let targetData = data
    let targetSessionId = existingRecoverySession?.id
    if (!targetSessionId) {
      const created = createSession(
        data,
        recoverySessionName(data, operation.sessionName ?? 'Session'),
        {
          id: recoveryId,
          now: operation.createdAt,
          event: operation.solve.event,
          editorId: 'recovery',
        },
      )
      if (!created) {
        remaining.push(operation)
        continue
      }
      targetData = { ...created.data, activeSessionId: data.activeSessionId }
      targetSessionId = created.sessionId
    }

    const restored = restoreSolve(
      targetData,
      targetSessionId,
      operation.solve,
      existingRecoverySession ? operation.index : 0,
    )
    if (!restored) {
      remaining.push(operation)
      continue
    }
    data = restored
    recovered.push(operation)
  }

  return { data, remaining, recovered, discarded, aborted }
}
