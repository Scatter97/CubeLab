import type { FieldUpdate, Settings } from '../types'
import { DEFAULT_SETTINGS } from './storage'
import type {
  SettingsFieldKey,
  SettingsFieldUpdates,
  SyncConflict,
} from './syncStorage'

export const SETTINGS_FIELD_KEYS: readonly SettingsFieldKey[] = [
  'inspectionEnabled',
  'inspectionCountDirection',
  'timerUpdateMode',
  'holdDurationMs',
  'stopWithAnyKey',
  'showTimerDecimalSmall',
  'uiZoomPercent',
  'statsPanelHeightPercent',
  'scrambleAlignment',
  'scrambleLimitHeight',
  'scrambleAction',
  'alertChannel',
  'alertVolume',
  'inspectionWarning8s',
  'inspectionWarning12s',
  'inspectionWarningVisualScope',
  'theme',
  'accentColor',
  'statVisibility',
  'customAverages',
  'statTargetsMs',
  'statPrecision',
  'averageTrimBetter',
  'averageTrimWorse',
  'showSessionSolveProgress',
  'showSessionTotalTime',
  'analytics',
]

function valueEquals(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (
    (Array.isArray(left) || (left !== null && typeof left === 'object')) &&
    (Array.isArray(right) || (right !== null && typeof right === 'object'))
  ) {
    return JSON.stringify(left) === JSON.stringify(right)
  }
  return false
}

function pickWinner(
  localUpdate: FieldUpdate,
  remoteUpdate: FieldUpdate,
  localValue: unknown,
  remoteValue: unknown,
): 'local' | 'remote' {
  if (localUpdate.updatedAt !== remoteUpdate.updatedAt) {
    return localUpdate.updatedAt > remoteUpdate.updatedAt ? 'local' : 'remote'
  }
  if (localUpdate.editorId !== remoteUpdate.editorId) {
    return localUpdate.editorId < remoteUpdate.editorId ? 'local' : 'remote'
  }
  return String(localValue) <= String(remoteValue) ? 'local' : 'remote'
}

function newestUpdate(left: FieldUpdate, right: FieldUpdate): FieldUpdate {
  if (left.updatedAt !== right.updatedAt) {
    return left.updatedAt > right.updatedAt ? left : right
  }
  return left.editorId <= right.editorId ? left : right
}

function findResolvedConflict(
  key: SettingsFieldKey,
  localValue: unknown,
  remoteValue: unknown,
  localUpdatedAt: number,
  remoteUpdatedAt: number,
  resolvedConflicts: readonly SyncConflict[],
): SyncConflict | undefined {
  return resolvedConflicts
    .filter(
      (conflict) =>
        conflict.kind === 'settings' &&
        conflict.id === 'settings' &&
        conflict.field === key &&
        conflict.resolution !== 'manual-pending' &&
        // The winning field is stamped at the approval time when the resolution
        // is applied, so accept that timestamp while still rejecting a genuine
        // later edit (which changes the value below).
        localUpdatedAt <= conflict.updatedAt &&
        remoteUpdatedAt <= conflict.updatedAt &&
        // Remote snapshots merge one at a time, so the reviewed pair may arrive
        // in either orientation. Match unordered and translate the stored side
        // when choosing the winner.
        ((valueEquals(conflict.localValue, localValue) &&
          valueEquals(conflict.remoteValue, remoteValue)) ||
          (valueEquals(conflict.localValue, remoteValue) &&
            valueEquals(conflict.remoteValue, localValue))) &&
        // Approval applies only to the exact reviewed value/timestamp pair, or
        // to a side already stamped at the approval time.
        (((localUpdatedAt === conflict.localUpdatedAt &&
           remoteUpdatedAt === conflict.remoteUpdatedAt) ||
          (localUpdatedAt === conflict.remoteUpdatedAt &&
           remoteUpdatedAt === conflict.localUpdatedAt)) ||
         localUpdatedAt === conflict.updatedAt ||
         remoteUpdatedAt === conflict.updatedAt ||
         localUpdatedAt === conflict.priorUpdatedAt ||
         remoteUpdatedAt === conflict.priorUpdatedAt),
    )
    .sort((left, right) => right.updatedAt - left.updatedAt)[0]
}

/** Translate a stored approval side into the current merge orientation. */
function resolvedWinner(
  conflict: SyncConflict,
  localValue: unknown,
  remoteValue: unknown,
): 'local' | 'remote' {
  const sameOrientation =
    valueEquals(localValue, conflict.localValue) &&
    valueEquals(remoteValue, conflict.remoteValue)
  if (sameOrientation) return conflict.resolution as 'local' | 'remote'
  return conflict.resolution === 'local' ? 'remote' : 'local'
}

export interface SettingsMergeResult {
  settings: Settings
  fieldUpdates: SettingsFieldUpdates
  conflicts: SyncConflict[]
}

/**
 * Merges global settings field by field when local metadata is available.
 * Metadata-free records keep the older whole-record first-sync behavior so a
 * configured device is never silently replaced by cloud defaults.
 */
export function mergeSettingsData(input: {
  local: Settings
  remote: Settings | null
  localFieldUpdates?: SettingsFieldUpdates
  remoteFieldUpdates?: SettingsFieldUpdates
  remoteUpdatedAt: number
  lastSyncAt: number | null
  manualConflictReview: boolean
  resolvedConflicts?: readonly SyncConflict[]
  /** Device ID used to stamp the first-sync local baseline. */
  localEditorId?: string
}): SettingsMergeResult {
  const {
    local,
    remote,
    remoteUpdatedAt,
    lastSyncAt,
    manualConflictReview,
    resolvedConflicts = [],
  } = input
  const localUpdates = input.localFieldUpdates ?? {}
  const remoteUpdates = input.remoteFieldUpdates ?? {}
  const hasLocalMetadata = Object.keys(localUpdates).length > 0
  const localIsDefaults = JSON.stringify(local) === JSON.stringify(DEFAULT_SETTINGS)

  if (!remote) {
    if (lastSyncAt === null && !hasLocalMetadata && !localIsDefaults) {
      // Even without a cloud snapshot, establish provenance for customized
      // settings so a later first merge from another device cannot take over
      // fields merely because that device stamped metadata first.
      const baselineAt = Date.now()
      const fieldUpdates: SettingsFieldUpdates = {}
      for (const key of SETTINGS_FIELD_KEYS) {
        fieldUpdates[key] = {
          updatedAt: baselineAt,
          editorId: input.localEditorId ?? 'local-baseline',
        }
      }
      return { settings: { ...local }, fieldUpdates, conflicts: [] }
    }
    return { settings: { ...local }, fieldUpdates: { ...localUpdates }, conflicts: [] }
  }
  if (lastSyncAt === null && !hasLocalMetadata && localIsDefaults) {
    return {
      settings: { ...remote },
      fieldUpdates: { ...remoteUpdates },
      conflicts: [],
    }
  }
  if (lastSyncAt === null && !hasLocalMetadata && !localIsDefaults) {
    // This device has customized settings but has never synchronized. Preserve
    // them on the first merge and create provenance for every field. Without
    // this baseline, the next merge would see remote-only metadata and replace
    // the local preferences. The baseline is newer than the remote snapshot and
    // its field metadata, so later remote edits still win normally.
    const baselineAt = Math.max(
      Date.now(),
      Number.isFinite(remoteUpdatedAt) ? remoteUpdatedAt : 0,
      ...Object.values(remoteUpdates).map((update) => update?.updatedAt ?? 0),
    )
    const fieldUpdates: SettingsFieldUpdates = {}
    for (const key of SETTINGS_FIELD_KEYS) {
      fieldUpdates[key] = {
        updatedAt: baselineAt,
        editorId: input.localEditorId ?? 'local-baseline',
      }
    }
    return { settings: { ...local }, fieldUpdates, conflicts: [] }
  }

  const settings = { ...local }
  const fieldUpdates: SettingsFieldUpdates = { ...localUpdates }
  const conflicts: SyncConflict[] = []

  for (const key of SETTINGS_FIELD_KEYS) {
    const localValue = local[key]
    const remoteValue = remote[key]
    if (valueEquals(localValue, remoteValue)) {
      const localUpdate = localUpdates[key]
      const remoteUpdate = remoteUpdates[key]
      if (localUpdate && remoteUpdate) fieldUpdates[key] = newestUpdate(localUpdate, remoteUpdate)
      else if (!localUpdate && remoteUpdate) fieldUpdates[key] = remoteUpdate
      continue
    }

    const localUpdate = localUpdates[key]
    const remoteUpdate = remoteUpdates[key]

    if (localUpdate && remoteUpdate) {
      const resolved = findResolvedConflict(
        key,
        localValue,
        remoteValue,
        localUpdate.updatedAt,
        remoteUpdate.updatedAt,
        resolvedConflicts,
      )
      const winner = resolved
        ? resolvedWinner(resolved, localValue, remoteValue)
        : pickWinner(localUpdate, remoteUpdate, localValue, remoteValue)
      if (!resolved) {
        conflicts.push({
          id: 'settings',
          kind: 'settings',
          field: key,
          localValue,
          remoteValue,
          localUpdatedAt: localUpdate.updatedAt,
          remoteUpdatedAt: remoteUpdate.updatedAt,
          resolution: manualConflictReview ? 'manual-pending' : winner,
          updatedAt: Math.max(localUpdate.updatedAt, remoteUpdate.updatedAt, Date.now()),
        })
      }
      if (winner === 'remote') {
        settings[key] = remoteValue as never
      }
      fieldUpdates[key] = resolved
        ? {
            updatedAt: Math.max(
              resolved.updatedAt,
              localUpdate.updatedAt,
              remoteUpdate.updatedAt,
            ),
            editorId: winner === 'local' ? localUpdate.editorId : remoteUpdate.editorId,
          }
        : winner === 'local'
          ? localUpdate
          : remoteUpdate
      continue
    }

    if (localUpdate) {
      // Local field was edited on this device; keep it and publish it.
      continue
    }
    if (remoteUpdate) {
      settings[key] = remoteValue as never
      fieldUpdates[key] = remoteUpdate
      continue
    }

    // Legacy records without field metadata: retain the whole-record policy.
    if (remoteUpdatedAt > (lastSyncAt ?? 0)) {
      settings[key] = remoteValue as never
    }
  }

  return { settings, fieldUpdates, conflicts }
}
