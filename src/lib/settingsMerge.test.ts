import { describe, expect, it } from 'vitest'
import type { Settings } from '../types'
import { DEFAULT_SETTINGS } from './storage'
import type { SettingsFieldUpdates, SyncConflict } from './syncStorage'
import { mergeSettingsData, SETTINGS_FIELD_KEYS } from './settingsMerge'

function settings(overrides: Partial<Settings> = {}): Settings {
  return { ...DEFAULT_SETTINGS, ...overrides }
}

describe('mergeSettingsData first synchronization', () => {
  it('adopts cloud settings when this device still has defaults', () => {
    const remote = settings({ accentColor: 'violet', statPrecision: 'tenths' })
    const remoteUpdates: SettingsFieldUpdates = {
      accentColor: { updatedAt: 100, editorId: 'phone' },
      statPrecision: { updatedAt: 100, editorId: 'phone' },
    }

    const result = mergeSettingsData({
      local: DEFAULT_SETTINGS,
      remote,
      remoteFieldUpdates: remoteUpdates,
      remoteUpdatedAt: 100,
      lastSyncAt: null,
      manualConflictReview: false,
    })

    expect(result.settings.accentColor).toBe('violet')
    expect(result.settings.statPrecision).toBe('tenths')
    expect(result.fieldUpdates).toEqual(remoteUpdates)
    expect(result.conflicts).toHaveLength(0)
  })

  it('keeps customized local settings and establishes a field baseline', () => {
    const local = settings({ accentColor: 'amber', alertVolume: 35 })
    const remote = settings({ accentColor: 'blue', alertVolume: 80 })
    const remoteUpdates: SettingsFieldUpdates = {
      accentColor: { updatedAt: 200, editorId: 'phone' },
      alertVolume: { updatedAt: 200, editorId: 'phone' },
    }

    const result = mergeSettingsData({
      local,
      remote,
      remoteFieldUpdates: remoteUpdates,
      remoteUpdatedAt: 200,
      lastSyncAt: null,
      manualConflictReview: false,
      localEditorId: 'laptop',
    })

    expect(result.settings).toEqual(local)
    expect(result.conflicts).toHaveLength(0)
    expect(Object.keys(result.fieldUpdates).sort()).toEqual(
      [...SETTINGS_FIELD_KEYS].sort(),
    )
    for (const key of SETTINGS_FIELD_KEYS) {
      expect(result.fieldUpdates[key]).toMatchObject({ editorId: 'laptop' })
      expect(result.fieldUpdates[key]!.updatedAt).toBeGreaterThanOrEqual(200)
    }

    // A later merge must not replace the baseline merely because only the
    // remote device has metadata.
    const next = mergeSettingsData({
      local: result.settings,
      remote,
      localFieldUpdates: result.fieldUpdates,
      remoteFieldUpdates: remoteUpdates,
      remoteUpdatedAt: 200,
      lastSyncAt: 1,
      manualConflictReview: false,
    })
    expect(next.settings).toEqual(local)
    expect(
      next.conflicts.map((conflict) => [conflict.field, conflict.resolution]),
    ).toEqual([
      ['alertVolume', 'local'],
      ['accentColor', 'local'],
    ])
  })

  it('creates baseline metadata even before a cloud snapshot exists', () => {
    const local = settings({ accentColor: 'amber' })
    const result = mergeSettingsData({
      local,
      remote: null,
      remoteUpdatedAt: 0,
      lastSyncAt: null,
      manualConflictReview: false,
      localEditorId: 'laptop',
    })

    expect(result.settings).toEqual(local)
    expect(result.fieldUpdates.accentColor).toMatchObject({ editorId: 'laptop' })
    expect(Object.keys(result.fieldUpdates)).toHaveLength(SETTINGS_FIELD_KEYS.length)
  })
})

describe('mergeSettingsData field-level merging', () => {
  it('keeps independent edits from both devices', () => {
    const local = settings({ accentColor: 'amber', alertChannel: 'visual' })
    const remote = settings({ accentColor: 'blue', alertChannel: 'sound' })

    const result = mergeSettingsData({
      local,
      remote,
      localFieldUpdates: {
        accentColor: { updatedAt: 300, editorId: 'laptop' },
        alertChannel: { updatedAt: 100, editorId: 'laptop' },
      },
      remoteFieldUpdates: {
        accentColor: { updatedAt: 200, editorId: 'phone' },
        alertChannel: { updatedAt: 400, editorId: 'phone' },
      },
      remoteUpdatedAt: 400,
      lastSyncAt: 1,
      manualConflictReview: false,
    })

    expect(result.settings.accentColor).toBe('amber')
    expect(result.settings.alertChannel).toBe('sound')
    expect(result.fieldUpdates.accentColor?.updatedAt).toBe(300)
    expect(result.fieldUpdates.alertChannel?.updatedAt).toBe(400)
    expect(
      result.conflicts.map((conflict) => [conflict.field, conflict.resolution]),
    ).toEqual([
      ['alertChannel', 'remote'],
      ['accentColor', 'local'],
    ])
  })

  it('treats object and array settings by value, not reference', () => {
    const local = settings({
      statVisibility: { ...DEFAULT_SETTINGS.statVisibility, ao25: true },
      customAverages: [{ id: 'a', size: 7, visible: true }],
    })
    const remote = settings({
      statVisibility: { ...DEFAULT_SETTINGS.statVisibility, ao25: true },
      customAverages: [{ id: 'a', size: 7, visible: true }],
    })

    const result = mergeSettingsData({
      local,
      remote,
      localFieldUpdates: {
        statVisibility: { updatedAt: 100, editorId: 'laptop' },
        customAverages: { updatedAt: 100, editorId: 'laptop' },
      },
      remoteFieldUpdates: {
        statVisibility: { updatedAt: 200, editorId: 'phone' },
        customAverages: { updatedAt: 200, editorId: 'phone' },
      },
      remoteUpdatedAt: 200,
      lastSyncAt: 1,
      manualConflictReview: true,
    })

    expect(result.settings.statVisibility).toEqual(local.statVisibility)
    expect(result.conflicts).toHaveLength(0)
    expect(result.fieldUpdates.statVisibility?.updatedAt).toBe(200)
  })

  it('pauses same-field edits for manual review and applies the approval once', () => {
    const local = settings({ accentColor: 'amber' })
    const remote = settings({ accentColor: 'blue' })
    const localFieldUpdates: SettingsFieldUpdates = {
      accentColor: { updatedAt: 100, editorId: 'laptop' },
    }
    const remoteFieldUpdates: SettingsFieldUpdates = {
      accentColor: { updatedAt: 200, editorId: 'phone' },
    }

    const pending = mergeSettingsData({
      local,
      remote,
      localFieldUpdates,
      remoteFieldUpdates,
      remoteUpdatedAt: 200,
      lastSyncAt: 1,
      manualConflictReview: true,
    })
    expect(pending.conflicts).toHaveLength(1)
    expect(pending.conflicts[0]).toMatchObject({
      kind: 'settings',
      id: 'settings',
      field: 'accentColor',
      localValue: 'amber',
      remoteValue: 'blue',
      resolution: 'manual-pending',
    })

    const approved: SyncConflict = {
      ...pending.conflicts[0]!,
      resolution: 'local',
      updatedAt: 300,
    }
    const firstApply = mergeSettingsData({
      local,
      remote,
      localFieldUpdates,
      remoteFieldUpdates,
      remoteUpdatedAt: 200,
      lastSyncAt: 1,
      manualConflictReview: true,
      resolvedConflicts: [approved],
    })
    expect(firstApply.settings.accentColor).toBe('amber')
    expect(firstApply.conflicts).toHaveLength(0)
    expect(firstApply.fieldUpdates.accentColor?.updatedAt).toBe(300)

    const secondApply = mergeSettingsData({
      local: firstApply.settings,
      remote,
      localFieldUpdates: firstApply.fieldUpdates,
      remoteFieldUpdates,
      remoteUpdatedAt: 200,
      lastSyncAt: 1,
      manualConflictReview: true,
      resolvedConflicts: [approved],
    })
    expect(secondApply.settings.accentColor).toBe('amber')
    expect(secondApply.conflicts).toHaveLength(0)
  })

  it('applies an approval when the reviewed pair arrives reversed', () => {
    const approved: SyncConflict = {
      kind: 'settings',
      id: 'settings',
      field: 'accentColor',
      localValue: 'amber',
      remoteValue: 'blue',
      localUpdatedAt: 100,
      remoteUpdatedAt: 200,
      resolution: 'local',
      updatedAt: 300,
    }
    // The accumulator already holds the approved value; a second snapshot still
    // presents the losing value, so local and remote are swapped.
    const result = mergeSettingsData({
      local: settings({ accentColor: 'blue' }),
      remote: settings({ accentColor: 'amber' }),
      localFieldUpdates: {
        accentColor: { updatedAt: 300, editorId: 'phone' },
      },
      remoteFieldUpdates: {
        accentColor: { updatedAt: 100, editorId: 'laptop' },
      },
      remoteUpdatedAt: 100,
      lastSyncAt: 1,
      manualConflictReview: true,
      resolvedConflicts: [approved],
    })

    expect(result.settings.accentColor).toBe('amber')
    expect(result.conflicts).toHaveLength(0)
    expect(result.fieldUpdates.accentColor).toEqual({
      updatedAt: 300,
      editorId: 'laptop',
    })
  })

  it('adopts remote-only metadata after the first sync', () => {
    const local = settings({ accentColor: 'amber' })
    const remote = settings({ accentColor: 'blue' })
    const result = mergeSettingsData({
      local,
      remote,
      remoteFieldUpdates: {
        accentColor: { updatedAt: 500, editorId: 'phone' },
      },
      remoteUpdatedAt: 500,
      lastSyncAt: 1,
      manualConflictReview: false,
    })

    expect(result.settings.accentColor).toBe('blue')
    expect(result.fieldUpdates.accentColor?.updatedAt).toBe(500)
  })

  it('keeps local-only metadata after the first sync', () => {
    const local = settings({ accentColor: 'amber' })
    const remote = settings({ accentColor: 'blue' })
    const result = mergeSettingsData({
      local,
      remote,
      localFieldUpdates: {
        accentColor: { updatedAt: 600, editorId: 'laptop' },
      },
      remoteUpdatedAt: 500,
      lastSyncAt: 1,
      manualConflictReview: false,
    })

    expect(result.settings.accentColor).toBe('amber')
    expect(result.fieldUpdates.accentColor?.updatedAt).toBe(600)
  })
})

describe('settings approval timestamp exactness', () => {
  const reviewedLocalUpdates: SettingsFieldUpdates = {
    accentColor: { updatedAt: 100, editorId: 'laptop' },
  }
  const reviewedRemoteUpdates: SettingsFieldUpdates = {
    accentColor: { updatedAt: 200, editorId: 'phone' },
  }
  const approvalOfRemote: SyncConflict = {
    kind: 'settings',
    id: 'settings',
    field: 'accentColor',
    localValue: 'amber',
    remoteValue: 'blue',
    localUpdatedAt: 100,
    remoteUpdatedAt: 200,
    resolution: 'remote',
    updatedAt: 400,
  }

  function mergeAccent(
    local: Settings,
    remote: Settings,
    localFieldUpdates: SettingsFieldUpdates,
    remoteFieldUpdates: SettingsFieldUpdates,
    remoteUpdatedAt: number,
  ) {
    return mergeSettingsData({
      local,
      remote,
      localFieldUpdates,
      remoteFieldUpdates,
      remoteUpdatedAt,
      lastSyncAt: 1,
      manualConflictReview: true,
      resolvedConflicts: [approvalOfRemote],
    })
  }

  it('does not apply an approval after the reviewed local value returns with a newer timestamp', () => {
    const result = mergeAccent(
      settings({ accentColor: 'amber' }),
      settings({ accentColor: 'blue' }),
      { accentColor: { updatedAt: 300, editorId: 'laptop' } },
      reviewedRemoteUpdates,
      200,
    )

    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0]).toMatchObject({
      resolution: 'manual-pending',
      localValue: 'amber',
      remoteValue: 'blue',
      localUpdatedAt: 300,
    })
    expect(result.settings.accentColor).toBe('amber')
  })

  it('does not apply an approval after a value changed away and back', () => {
    const result = mergeAccent(
      settings({ accentColor: 'amber' }),
      settings({ accentColor: 'blue' }),
      { accentColor: { updatedAt: 500, editorId: 'laptop' } },
      reviewedRemoteUpdates,
      200,
    )

    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0]?.resolution).toBe('manual-pending')
    expect(result.settings.accentColor).toBe('amber')
  })

  it('still applies to the winning version stamped at the approval time', () => {
    const result = mergeAccent(
      settings({ accentColor: 'blue' }),
      settings({ accentColor: 'amber' }),
      { accentColor: { updatedAt: 400, editorId: 'phone' } },
      reviewedLocalUpdates,
      100,
    )

    expect(result.conflicts).toHaveLength(0)
    expect(result.settings.accentColor).toBe('blue')
    expect(result.fieldUpdates.accentColor).toEqual({
      updatedAt: 400,
      editorId: 'phone',
    })
  })
})

it('merges independent trimming side edits and retains field metadata', () => {
  const result = mergeSettingsData({
    local: settings({ averageTrimBetter: '1' }),
    remote: settings({ averageTrimWorse: 'p10' }),
    localFieldUpdates: { averageTrimBetter: { updatedAt: 300, editorId: 'laptop' }, averageTrimWorse: { updatedAt: 100, editorId: 'laptop' } },
    remoteFieldUpdates: { averageTrimBetter: { updatedAt: 100, editorId: 'phone' }, averageTrimWorse: { updatedAt: 400, editorId: 'phone' } },
    remoteUpdatedAt: 400, lastSyncAt: 1, manualConflictReview: false,
  })
  expect(result.settings).toMatchObject({ averageTrimBetter: '1', averageTrimWorse: 'p10' })
  expect(result.fieldUpdates).toMatchObject({ averageTrimBetter: { updatedAt: 300, editorId: 'laptop' }, averageTrimWorse: { updatedAt: 400, editorId: 'phone' } })
  expect(SETTINGS_FIELD_KEYS).toContain('averageTrimBetter')
  expect(SETTINGS_FIELD_KEYS).toContain('averageTrimWorse')
})

it('requires conflict review for differing edits to the same trimming side', () => {
  const result = mergeSettingsData({
    local: settings({ averageTrimBetter: '1' }), remote: settings({ averageTrimBetter: 'p10' }),
    localFieldUpdates: { averageTrimBetter: { updatedAt: 300, editorId: 'laptop' } },
    remoteFieldUpdates: { averageTrimBetter: { updatedAt: 400, editorId: 'phone' } },
    remoteUpdatedAt: 400, lastSyncAt: 1, manualConflictReview: true,
  })
  expect(result.conflicts).toContainEqual(expect.objectContaining({ field: 'averageTrimBetter', resolution: 'manual-pending', localValue: '1', remoteValue: 'p10' }))
})
