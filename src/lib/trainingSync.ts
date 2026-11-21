/**
 * Pure Training merge rules. This module never writes storage or the network.
 *
 * Training records are not solve records: attempts/visits/calibrations/presets
 * and custom algorithms keep their own identities, and deletions use the
 * separate `cubelab:training-sync:v1` tombstone ledger.
 */
import { recognitionCount } from './training/calibration'
import { assertTrainingData } from './training/schema'
import { stripRetiredAlgorithmTracking } from './training/retiredAlgorithmTracking'
import { trainingOutcome } from './training/results'
import type {
  TrainingAttempt,
  TrainingCalibration,
  TrainingCustomAlgorithm,
  TrainingData,
  TrainingPreset,
  TrainingVisit,
} from './training/types'
import {
  isActiveTrainingTombstone,
  isTrainingSyncConflict,
  isTrainingTombstone,
  parseTrainingFieldUpdates,
  type TrainingFieldUpdates,
  type TrainingSyncConflict,
  type TrainingTombstone,
} from './trainingSyncStorage'

export const TRAINING_SYNC_PROTOCOL_VERSION = 1

export interface TrainingSyncEnvelope {
  version: typeof TRAINING_SYNC_PROTOCOL_VERSION
  deviceId: string
  revision: number
  updatedAt: number
  tombstones: TrainingTombstone[]
  fieldUpdates: TrainingFieldUpdates
  conflicts: TrainingSyncConflict[]
}

export interface TrainingMergeInput {
  local: TrainingData
  remote: TrainingData
  localTombstones: readonly TrainingTombstone[]
  remoteTombstones: readonly TrainingTombstone[]
  localFieldUpdates: TrainingFieldUpdates
  remoteFieldUpdates: TrainingFieldUpdates
  /** Prior approvals/history; exact values are required to reuse a decision. */
  resolvedConflicts: readonly TrainingSyncConflict[]
  deviceId: string
  now: number
  manualConflictReview: boolean
  /** True when this device has no stored Training key at all. */
  localStoreAbsent?: boolean
}

export type TrainingMergeResult =
  | {
      ok: true
      merged: TrainingData
      tombstones: TrainingTombstone[]
      fieldUpdates: TrainingFieldUpdates
      conflicts: TrainingSyncConflict[]
      pendingConflicts: TrainingSyncConflict[]
    }
  | { ok: false; error: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function sameTrainingJson(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null)
    return false
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((value, index) => sameTrainingJson(value, b[index]))
    )
  }
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = Object.keys(left)
  return (
    keys.length === Object.keys(right).length &&
    keys.every(
      (key) =>
        Object.hasOwn(right, key) && sameTrainingJson(left[key], right[key]),
    )
  )
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(',')}}`
}

function tombstoneKey(tombstone: Pick<TrainingTombstone, 'kind' | 'id'>): string {
  return `${tombstone.kind}:${tombstone.id}`
}

export function mergeTrainingTombstones(
  ...groups: ReadonlyArray<ReadonlyArray<TrainingTombstone>>
): TrainingTombstone[] {
  const merged = new Map<string, TrainingTombstone>()
  for (const tombstone of groups.flat()) {
    const key = tombstoneKey(tombstone)
    const existing = merged.get(key)
    if (!existing) {
      merged.set(key, {
        ...tombstone,
        ...(tombstone.attemptIds
          ? { attemptIds: [...new Set(tombstone.attemptIds)] }
          : {}),
      })
      continue
    }
    const existingEvent = Math.max(
      existing.deletedAt,
      existing.restoredAt ?? 0,
    )
    const candidateEvent = Math.max(
      tombstone.deletedAt,
      tombstone.restoredAt ?? 0,
    )
    let winner: TrainingTombstone
    if (candidateEvent > existingEvent) winner = tombstone
    else if (candidateEvent < existingEvent) winner = existing
    else if (
      isActiveTrainingTombstone(tombstone) !==
      isActiveTrainingTombstone(existing)
    ) {
      winner = isActiveTrainingTombstone(tombstone) ? tombstone : existing
    } else if (tombstone.deletedByDeviceId !== existing.deletedByDeviceId) {
      winner =
        tombstone.deletedByDeviceId < existing.deletedByDeviceId
          ? tombstone
          : existing
    } else {
      winner = tombstone.id <= existing.id ? tombstone : existing
    }
    const attemptIds = [
      ...new Set([...(existing.attemptIds ?? []), ...(tombstone.attemptIds ?? [])]),
    ]
    merged.set(key, {
      ...winner,
      ...(attemptIds.length > 0 ? { attemptIds } : {}),
      ...(existing.visitId ?? tombstone.visitId
        ? { visitId: existing.visitId ?? tombstone.visitId }
        : {}),
    })
  }
  return [...merged.values()].sort(
    (left, right) =>
      left.kind.localeCompare(right.kind) ||
      left.id.localeCompare(right.id) ||
      left.deletedAt - right.deletedAt,
  )
}

function attemptCorrectionTime(attempt: TrainingAttempt): number {
  return Math.max(
    attempt.resultCorrectedAt ?? 0,
    attempt.attribution.kind === 'user-corrected'
      ? attempt.attribution.correctedAt
      : 0,
    attempt.attribution.kind === 'unknown'
      ? attempt.attribution.markedAt ?? 0
      : 0,
    attempt.createdAt,
  )
}

function visitCore(visit: TrainingVisit): unknown {
  return {
    version: visit.version,
    id: visit.id,
    startedAt: visit.startedAt,
    endedAt: visit.endedAt,
    startedCategoryId: visit.startedCategoryId,
    session: visit.session ?? null,
    lifecycle: visit.lifecycle
      ? {
          ...visit.lifecycle,
          reportPending: false,
          reportDestination: visit.lifecycle.reportDestination,
        }
      : null,
    summaryId: visit.summaryId,
  }
}

function maxFieldUpdate(
  local: TrainingFieldUpdates['preferences'],
  remote: TrainingFieldUpdates['preferences'],
): TrainingFieldUpdates['preferences'] {
  if (!local) return remote
  if (!remote) return local
  return remote.updatedAt > local.updatedAt ? remote : local
}

interface ConflictChoice {
  use: 'local' | 'remote'
  conflict: TrainingSyncConflict
  pending: boolean
}

function resolveCandidate(input: {
  kind: TrainingSyncConflict['kind']
  id: string
  field: string
  localValue: unknown
  remoteValue: unknown
  localUpdatedAt: number
  remoteUpdatedAt: number
  preferred: 'local' | 'remote'
  existing: readonly TrainingSyncConflict[]
  manualConflictReview: boolean
  now: number
  deviceId: string
}): ConflictChoice {
  const key = `${input.kind}:${input.id}:${input.field}`
  const approval = input.existing.find(
    (conflict) =>
      `${conflict.kind}:${conflict.id}:${conflict.field}` === key &&
      conflict.resolution !== 'manual-pending' &&
      sameTrainingJson(conflict.localValue, input.localValue) &&
      sameTrainingJson(conflict.remoteValue, input.remoteValue),
  )
  const base = {
    id: input.id,
    kind: input.kind,
    field: input.field,
    localValue: input.localValue,
    remoteValue: input.remoteValue,
    localUpdatedAt: input.localUpdatedAt,
    remoteUpdatedAt: input.remoteUpdatedAt,
  }
  if (approval) {
    const use = approval.resolution === 'remote' ? 'remote' : 'local'
    return {
      use,
      conflict: {
        ...base,
        resolution: use,
        updatedAt: approval.updatedAt,
      },
      pending: false,
    }
  }
  if (input.manualConflictReview) {
    return {
      use: 'local',
      conflict: {
        ...base,
        resolution: 'manual-pending',
        updatedAt: input.now,
      },
      pending: true,
    }
  }
  return {
    use: input.preferred,
    conflict: {
      ...base,
      resolution: input.preferred,
      updatedAt: input.now,
    },
    pending: false,
  }
}

function conflictKey(conflict: TrainingSyncConflict): string {
  return `${conflict.kind}:${conflict.id}:${conflict.field}`
}

export function trainingSyncFingerprint(
  data: TrainingData,
  tombstones: readonly TrainingTombstone[],
  fieldUpdates: TrainingFieldUpdates,
): string {
  const normalized = {
    ...data,
    attempts: [...data.attempts].sort((a, b) => a.id.localeCompare(b.id)),
    visits: [...data.visits].sort((a, b) => a.id.localeCompare(b.id)),
    calibrations: [...data.calibrations].sort(
      (a, b) => a.measuredAt - b.measuredAt || a.id.localeCompare(b.id),
    ),
    presets: [...data.presets].sort((a, b) => a.id.localeCompare(b.id)),
    customAlgorithms: [...data.customAlgorithms].sort((a, b) =>
      a.id.localeCompare(b.id),
    ),
  }
  return stableJson({
    data: normalized,
    tombstones: mergeTrainingTombstones(tombstones),
    fieldUpdates,
  })
}

export function mergeTrainingData(input: TrainingMergeInput): TrainingMergeResult {
  try {
    assertTrainingData(input.local)
    assertTrainingData(input.remote)
  } catch (error) {
    return {
      ok: false,
      error: `Training merge rejected an invalid source store: ${
        error instanceof Error ? error.message : 'unknown validation error'
      }`,
    }
  }
  if (
    input.remote.activeVisitId !== null ||
    input.remote.visits.some((visit) => visit.endedAt === null)
  ) {
    return {
      ok: false,
      error:
        'The cloud Training snapshot contains an open or unfinished visit and was rejected.',
    }
  }
  if (
    input.local.activeVisitId !== null ||
    input.local.visits.some((visit) => visit.endedAt === null)
  ) {
    return {
      ok: false,
      error:
        'Local Training still has an open visit. Finish or end it before synchronizing.',
    }
  }

  const tombstones = mergeTrainingTombstones(
    input.localTombstones,
    input.remoteTombstones,
  )
  const activeAttemptDeletes = new Set(
    tombstones
      .filter((t) => t.kind === 'attempt' && isActiveTrainingTombstone(t))
      .map((t) => t.id),
  )
  const activeVisitDeletes = new Set(
    tombstones
      .filter((t) => t.kind === 'visit' && isActiveTrainingTombstone(t))
      .map((t) => t.id),
  )
  const activePresetDeletes = new Set(
    tombstones
      .filter((t) => t.kind === 'preset' && isActiveTrainingTombstone(t))
      .map((t) => t.id),
  )

  const conflicts = new Map<string, TrainingSyncConflict>()
  const pending = new Set<string>()
  const remember = (choice: ConflictChoice) => {
    conflicts.set(conflictKey(choice.conflict), choice.conflict)
    if (choice.pending) pending.add(conflictKey(choice.conflict))
  }

  // Attempts are immutable except explicit corrections. The later correction
  // wins; an equal-time disagreement needs review or a deterministic tie.
  const localAttempts = new Map(input.local.attempts.map((a) => [a.id, a]))
  const remoteAttempts = new Map(input.remote.attempts.map((a) => [a.id, a]))
  const attemptIds = new Set([...localAttempts.keys(), ...remoteAttempts.keys()])
  const mergedAttempts: TrainingAttempt[] = []
  for (const id of attemptIds) {
    if (activeAttemptDeletes.has(id)) continue
    const local = localAttempts.get(id)
    const remote = remoteAttempts.get(id)
    if (local && activeVisitDeletes.has(local.visitId)) continue
    if (remote && activeVisitDeletes.has(remote.visitId)) continue
    if (!local) {
      mergedAttempts.push(remote!)
      continue
    }
    if (!remote) {
      mergedAttempts.push(local)
      continue
    }
    if (sameTrainingJson(local, remote)) {
      mergedAttempts.push(local)
      continue
    }
    const localTime = attemptCorrectionTime(local)
    const remoteTime = attemptCorrectionTime(remote)
    const preferred = remoteTime > localTime ? 'remote' : 'local'
    const choice = resolveCandidate({
      kind: 'attempt',
      id,
      field: 'correction',
      localValue: local,
      remoteValue: remote,
      localUpdatedAt: localTime,
      remoteUpdatedAt: remoteTime,
      preferred,
      existing: input.resolvedConflicts,
      manualConflictReview: input.manualConflictReview,
      now: input.now,
      deviceId: input.deviceId,
    })
    remember(choice)
    mergedAttempts.push(choice.use === 'remote' ? remote : local)
  }
  mergedAttempts.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
  const attemptById = new Map(mergedAttempts.map((attempt) => [attempt.id, attempt]))

  // Visits only merge when ended. reportPending is monotonic true→false.
  const localVisits = new Map(input.local.visits.map((v) => [v.id, v]))
  const remoteVisits = new Map(input.remote.visits.map((v) => [v.id, v]))
  const visitIds = new Set([...localVisits.keys(), ...remoteVisits.keys()])
  const mergedVisits: TrainingVisit[] = []
  for (const id of visitIds) {
    if (activeVisitDeletes.has(id)) continue
    const local = localVisits.get(id)
    const remote = remoteVisits.get(id)
    if (!local) {
      mergedVisits.push(remote!)
      continue
    }
    if (!remote) {
      mergedVisits.push(local)
      continue
    }
    const acknowledged = (visit: TrainingVisit) =>
      visit.lifecycle
        ? {
            ...visit,
            lifecycle: { ...visit.lifecycle, reportPending: false },
          }
        : visit
    if (sameTrainingJson(visitCore(local), visitCore(remote))) {
      // Preserve unknown additive fields from both sides. Known core fields are
      // equal here; the lifecycle source still follows the previous rule.
      const base = { ...remote, ...local }
      const lifecycleSource = local.endedAt !== null ? local : remote
      const pending =
        (local.lifecycle?.reportPending ?? false) &&
        (remote.lifecycle?.reportPending ?? false)
      mergedVisits.push({
        ...base,
        categoryIds: [
          ...new Set([
            ...local.categoryIds,
            ...remote.categoryIds,
          ]),
        ],
        ...(lifecycleSource.lifecycle
          ? {
              lifecycle: {
                ...lifecycleSource.lifecycle,
                reportPending: pending,
              },
            }
          : {}),
      })
      continue
    }
    const localTime = local.endedAt ?? local.startedAt
    const remoteTime = remote.endedAt ?? remote.startedAt
    const choice = resolveCandidate({
      kind: 'visit',
      id,
      field: 'record',
      localValue: local,
      remoteValue: remote,
      localUpdatedAt: localTime,
      remoteUpdatedAt: remoteTime,
      preferred: remoteTime > localTime ? 'remote' : 'local',
      existing: input.resolvedConflicts,
      manualConflictReview: input.manualConflictReview,
      now: input.now,
      deviceId: input.deviceId,
    })
    remember(choice)
    const chosen = choice.use === 'remote' ? remote : local
    mergedVisits.push(
      (local.lifecycle?.reportPending ?? false) &&
        (remote.lifecycle?.reportPending ?? false)
        ? chosen
        : acknowledged(chosen),
    )
  }
  mergedVisits.sort(
    (a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id),
  )

  // Rebuild the visit→attempt relationship from the merged rows. This removes
  // tombstoned attempts and includes attempts discovered on another device.
  const attemptsByVisit = new Map<string, TrainingAttempt[]>()
  for (const attempt of mergedAttempts) {
    const list = attemptsByVisit.get(attempt.visitId) ?? []
    list.push(attempt)
    attemptsByVisit.set(attempt.visitId, list)
  }
  for (const visit of mergedVisits) {
    if (!attemptsByVisit.has(visit.id)) attemptsByVisit.set(visit.id, [])
  }
  const finalVisits = mergedVisits.map((visit) => {
    const visitAttempts = attemptsByVisit.get(visit.id) ?? []
    const existing = new Set(visit.attemptIds)
    const extra = visitAttempts
      .map((attempt) => attempt.id)
      .filter((id) => !existing.has(id))
    return {
      ...visit,
      categoryIds: [
        ...new Set([
          ...visit.categoryIds,
          ...visitAttempts.map((attempt) => attempt.categoryId),
        ]),
      ],
      attemptIds: [
        ...visit.attemptIds.filter(
          (id) => attemptById.get(id)?.visitId === visit.id,
        ),
        ...extra,
      ],
    }
  })
  for (const attempt of mergedAttempts) {
    if (!finalVisits.some((visit) => visit.id === attempt.visitId)) {
      return {
        ok: false,
        error:
          'The merged Training store contains an attempt whose visit was deleted or is missing.',
      }
    }
  }

  // Calibrations are append-only immutable records.
  const localCalibrations = new Map(input.local.calibrations.map((c) => [c.id, c]))
  const remoteCalibrations = new Map(
    input.remote.calibrations.map((c) => [c.id, c]),
  )
  const calibrationIds = new Set([
    ...localCalibrations.keys(),
    ...remoteCalibrations.keys(),
  ])
  const mergedCalibrations: TrainingCalibration[] = []
  for (const id of calibrationIds) {
    const local = localCalibrations.get(id)
    const remote = remoteCalibrations.get(id)
    if (!local) {
      mergedCalibrations.push(remote!)
      continue
    }
    if (!remote || sameTrainingJson(local, remote)) {
      mergedCalibrations.push(local)
      continue
    }
    const choice = resolveCandidate({
      kind: 'calibration',
      id,
      field: 'record',
      localValue: local,
      remoteValue: remote,
      localUpdatedAt: local.measuredAt,
      remoteUpdatedAt: remote.measuredAt,
      preferred: remote.measuredAt > local.measuredAt ? 'remote' : 'local',
      existing: input.resolvedConflicts,
      manualConflictReview: input.manualConflictReview,
      now: input.now,
      deviceId: input.deviceId,
    })
    remember(choice)
    mergedCalibrations.push(choice.use === 'remote' ? remote : local)
  }
  mergedCalibrations.sort(
    (a, b) => a.measuredAt - b.measuredAt || a.id.localeCompare(b.id),
  )

  // Presets merge per ID by updatedAt; equal-time differences need review.
  const localPresets = new Map(input.local.presets.map((p) => [p.id, p]))
  const remotePresets = new Map(input.remote.presets.map((p) => [p.id, p]))
  const presetIds = new Set([...localPresets.keys(), ...remotePresets.keys()])
  const mergedPresets: TrainingPreset[] = []
  for (const id of presetIds) {
    if (activePresetDeletes.has(id)) continue
    const local = localPresets.get(id)
    const remote = remotePresets.get(id)
    if (!local) {
      mergedPresets.push(remote!)
      continue
    }
    if (!remote || sameTrainingJson(local, remote)) {
      mergedPresets.push(local)
      continue
    }
    const preferred = remote.updatedAt > local.updatedAt ? 'remote' : 'local'
    if (preferred === 'local' && local.updatedAt > remote.updatedAt) {
      mergedPresets.push(local)
      continue
    }
    if (preferred === 'remote' && remote.updatedAt > local.updatedAt) {
      mergedPresets.push(remote)
      continue
    }
    const choice = resolveCandidate({
      kind: 'preset',
      id,
      field: 'record',
      localValue: local,
      remoteValue: remote,
      localUpdatedAt: local.updatedAt,
      remoteUpdatedAt: remote.updatedAt,
      preferred,
      existing: input.resolvedConflicts,
      manualConflictReview: input.manualConflictReview,
      now: input.now,
      deviceId: input.deviceId,
    })
    remember(choice)
    mergedPresets.push(choice.use === 'remote' ? remote : local)
  }
  mergedPresets.sort((a, b) => a.id.localeCompare(b.id))

  // Custom algorithms are immutable by ID. A conflicting revision is never
  // silently replaced with different notation.
  const localAlgorithms = new Map(
    input.local.customAlgorithms.map((a) => [a.id, a]),
  )
  const remoteAlgorithms = new Map(
    input.remote.customAlgorithms.map((a) => [a.id, a]),
  )
  const algorithmIds = new Set([
    ...localAlgorithms.keys(),
    ...remoteAlgorithms.keys(),
  ])
  const mergedAlgorithms: TrainingCustomAlgorithm[] = []
  for (const id of algorithmIds) {
    const local = localAlgorithms.get(id)
    const remote = remoteAlgorithms.get(id)
    if (!local) {
      mergedAlgorithms.push(remote!)
      continue
    }
    if (!remote || sameTrainingJson(local, remote)) {
      mergedAlgorithms.push(local)
      continue
    }
    const choice = resolveCandidate({
      kind: 'algorithm',
      id,
      field: 'notation',
      localValue: local,
      remoteValue: remote,
      localUpdatedAt: local.createdAt,
      remoteUpdatedAt: remote.createdAt,
      preferred: 'local',
      existing: input.resolvedConflicts,
      manualConflictReview: input.manualConflictReview,
      now: input.now,
      deviceId: input.deviceId,
    })
    remember(choice)
    mergedAlgorithms.push(choice.use === 'remote' ? remote : local)
  }
  mergedAlgorithms.sort((a, b) => a.id.localeCompare(b.id))

  // Preferences are one coarse field. The newest stamped edit wins; equal-time
  // disagreements require approval when manual review is on.
  let preferences = input.local.preferences
  let preferencesUpdate = maxFieldUpdate(
    input.localFieldUpdates.preferences,
    input.remoteFieldUpdates.preferences,
  )
  if (!sameTrainingJson(input.local.preferences, input.remote.preferences)) {
    const localStamp = input.localFieldUpdates.preferences?.updatedAt ?? 0
    const remoteStamp = input.remoteFieldUpdates.preferences?.updatedAt ?? 0
    if (input.localStoreAbsent) {
      // A genuinely fresh device has no preference history to defend. Adopt the
      // remote setup even when an older Phase 1 snapshot carries no field stamp.
      preferences = input.remote.preferences
      preferencesUpdate = input.remoteFieldUpdates.preferences ?? {
        updatedAt: input.now,
        editorId: input.deviceId,
      }
    } else {
      const preferred =
        remoteStamp > localStamp
          ? 'remote'
          : localStamp > remoteStamp
            ? 'local'
            : 'local'
      const choice = resolveCandidate({
        kind: 'preferences',
        id: 'preferences',
        field: 'preferences',
        localValue: input.local.preferences,
        remoteValue: input.remote.preferences,
        localUpdatedAt: localStamp,
        remoteUpdatedAt: remoteStamp,
        preferred,
        existing: input.resolvedConflicts,
        manualConflictReview: input.manualConflictReview,
        now: input.now,
        deviceId: input.deviceId,
      })
      remember(choice)
      preferences =
        choice.use === 'remote'
          ? input.remote.preferences
          : input.local.preferences
      if (choice.use === 'remote') {
        preferencesUpdate = input.remoteFieldUpdates.preferences
      }
    }
  }

  // selectedPresetId must reference a surviving preset after deletion.
  const presetIdsAfterMerge = new Set(mergedPresets.map((preset) => preset.id))
  const repairedSets = { ...preferences.sets }
  let preferencesRepaired = false
  for (const setId of ['oll', 'pll'] as const) {
    const selected = repairedSets[setId].selectedPresetId
    if (selected !== null && !presetIdsAfterMerge.has(selected)) {
      repairedSets[setId] = { ...repairedSets[setId], selectedPresetId: null }
      preferencesRepaired = true
    }
  }
  if (preferencesRepaired) {
    preferences = { ...preferences, sets: repairedSets }
    preferencesUpdate = {
      updatedAt: Math.max(input.now, preferencesUpdate?.updatedAt ?? 0),
      editorId: input.deviceId,
    }
  }

  const mergedBase = {
    ...input.remote,
    ...input.local,
    version: 1 as const,
    preferences,
    presets: mergedPresets,
    customAlgorithms: mergedAlgorithms,
    attempts: mergedAttempts,
    calibrations: mergedCalibrations,
    visits: finalVisits,
    activeVisitId: null,
  }
  const mergedCounts = {
    // Preserve unknown additive keys for forward compatibility.
    ...(input.remote.recognitionCounts ?? {}),
    ...(input.local.recognitionCounts ?? {}),
    oll: Math.max(
      input.local.recognitionCounts?.oll ?? 0,
      input.remote.recognitionCounts?.oll ?? 0,
      recognitionCount(mergedBase, 'oll'),
    ),
    pll: Math.max(
      input.local.recognitionCounts?.pll ?? 0,
      input.remote.recognitionCounts?.pll ?? 0,
      recognitionCount(mergedBase, 'pll'),
    ),
  }
  const merged: TrainingData = stripRetiredAlgorithmTracking({
    ...mergedBase,
    recognitionCounts: mergedCounts,
  })
  let recognitionCountsUpdate = maxFieldUpdate(
    input.localFieldUpdates.recognitionCounts,
    input.remoteFieldUpdates.recognitionCounts,
  )
  if (
    mergedCounts.oll !== (input.local.recognitionCounts?.oll ?? 0) ||
    mergedCounts.pll !== (input.local.recognitionCounts?.pll ?? 0)
  ) {
    recognitionCountsUpdate = {
      updatedAt: Math.max(input.now, recognitionCountsUpdate?.updatedAt ?? 0),
      editorId: input.deviceId,
    }
  }

  try {
    assertTrainingData(merged)
  } catch (error) {
    return {
      ok: false,
      error: `The merged Training store is invalid and was not published: ${
        error instanceof Error ? error.message : 'unknown validation error'
      }`,
    }
  }

  // Keep prior resolved history for fields that are no longer current, but
  // never keep a stale pending conflict that no longer matches either side.
  for (const conflict of input.resolvedConflicts) {
    const key = conflictKey(conflict)
    if (!conflicts.has(key) && conflict.resolution !== 'manual-pending') {
      conflicts.set(key, conflict)
    }
  }
  const allConflicts = [...conflicts.values()].sort(
    (left, right) =>
      left.kind.localeCompare(right.kind) ||
      left.id.localeCompare(right.id) ||
      left.field.localeCompare(right.field),
  )
  const mergedFieldUpdates: TrainingFieldUpdates = {
    ...input.localFieldUpdates,
    ...input.remoteFieldUpdates,
  }
  if (preferencesUpdate) mergedFieldUpdates.preferences = preferencesUpdate
  if (recognitionCountsUpdate)
    mergedFieldUpdates.recognitionCounts = recognitionCountsUpdate
  return {
    ok: true,
    merged,
    tombstones,
    fieldUpdates: mergedFieldUpdates,
    conflicts: allConflicts,
    pendingConflicts: allConflicts.filter(
      (conflict) => pending.has(conflictKey(conflict)) || conflict.resolution === 'manual-pending',
    ),
  }
}

export function createTrainingSyncEnvelope(input: {
  deviceId: string
  revision: number
  tombstones: readonly TrainingTombstone[]
  fieldUpdates: TrainingFieldUpdates
  conflicts: readonly TrainingSyncConflict[]
  updatedAt?: number
}): TrainingSyncEnvelope {
  return {
    version: TRAINING_SYNC_PROTOCOL_VERSION,
    deviceId: input.deviceId,
    revision: input.revision,
    updatedAt: input.updatedAt ?? Date.now(),
    tombstones: mergeTrainingTombstones(input.tombstones),
    fieldUpdates: { ...input.fieldUpdates },
    conflicts: input.conflicts.filter(
      (conflict) => conflict.resolution !== 'manual-pending',
    ),
  }
}

export function parseTrainingSyncEnvelope(
  value: unknown,
): TrainingSyncEnvelope | null {
  if (!isRecord(value)) return null
  if (value.version !== TRAINING_SYNC_PROTOCOL_VERSION) return null
  if (
    typeof value.deviceId !== 'string' ||
    value.deviceId.length === 0
  )
    return null
  if (
    typeof value.revision !== 'number' ||
    !Number.isFinite(value.revision) ||
    value.revision < 0
  )
    return null
  if (
    typeof value.updatedAt !== 'number' ||
    !Number.isFinite(value.updatedAt) ||
    value.updatedAt < 0
  )
    return null
  const tombstones = value.tombstones ?? []
  if (!Array.isArray(tombstones) || !tombstones.every(isTrainingTombstone))
    return null
  const conflicts = value.conflicts ?? []
  if (!Array.isArray(conflicts) || !conflicts.every(isTrainingSyncConflict))
    return null
  return {
    version: TRAINING_SYNC_PROTOCOL_VERSION,
    deviceId: value.deviceId,
    revision: value.revision,
    updatedAt: value.updatedAt,
    tombstones: mergeTrainingTombstones(tombstones),
    fieldUpdates: parseTrainingFieldUpdates(value.fieldUpdates),
    conflicts,
  }
}

/** Counts deletions that still remove data; restored records remain as provenance. */
export function activeTrainingDeletionCount(
  tombstones: readonly TrainingTombstone[],
): number {
  return tombstones.filter(isActiveTrainingTombstone).length
}

export function trainingAttemptDeletionIds(
  data: TrainingData,
  tombstones: readonly TrainingTombstone[],
): Set<string> {
  const ids = new Set(
    tombstones
      .filter((t) => t.kind === 'attempt' && isActiveTrainingTombstone(t))
      .map((t) => t.id),
  )
  for (const tombstone of tombstones) {
    if (tombstone.kind !== 'visit' || !isActiveTrainingTombstone(tombstone))
      continue
    for (const attempt of data.attempts) {
      if (attempt.visitId === tombstone.id) ids.add(attempt.id)
    }
  }
  return ids
}

/** Exposed for tests and reporting; not used to mutate records. */
export function trainingAttemptOutcome(
  attempt: TrainingAttempt,
): 'success' | 'dnf' | 'unsupported' {
  return trainingOutcome(attempt.result)
}
