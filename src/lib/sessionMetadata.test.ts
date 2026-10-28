import { describe, expect, it } from 'vitest'
import type { Session } from '../types'
import type { SyncConflict } from './syncStorage'
import {
  mergeSessionMetadata,
  getSessionFieldUpdate,
  getSessionPreferenceUpdate,
  maxSessionFieldUpdateTime,
} from './sessionMetadata'

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    name: 'Session 1',
    event: '333',
    createdAt: 1_000,
    updatedAt: 1_000,
    solves: [],
    ...overrides,
  }
}

function merge(
  local: Session,
  remote: Session,
  manualConflictReview = false,
  resolvedConflicts: SyncConflict[] = [],
): {
  metadata: ReturnType<typeof mergeSessionMetadata>
  conflicts: SyncConflict[]
} {
  const conflicts: SyncConflict[] = []
  const metadata = mergeSessionMetadata({
    local,
    remote,
    manualConflictReview,
    conflicts,
    resolvedConflicts,
  })
  return { metadata, conflicts }
}

describe('mergeSessionMetadata', () => {
  it('merges independent name and preference edits field by field', () => {
    const { metadata, conflicts } = merge(
      session({
        name: 'Practice',
        preferences: { inspectionWarning8s: false },
        fieldUpdates: {
          name: { updatedAt: 40, editorId: 'laptop' },
          preferences: {
            inspectionWarning8s: { updatedAt: 200, editorId: 'laptop' },
          },
        },
      }),
      session({
        name: 'Remote practice',
        preferences: { inspectionWarning8s: true },
        fieldUpdates: {
          name: { updatedAt: 50, editorId: 'phone' },
          preferences: {
            inspectionWarning8s: { updatedAt: 100, editorId: 'phone' },
          },
        },
      }),
    )

    expect(metadata.name).toBe('Remote practice')
    expect(metadata.preferences?.inspectionWarning8s).toBe(false)
    expect(metadata.fieldUpdates?.name).toEqual({
      updatedAt: 50,
      editorId: 'phone',
    })
    expect(metadata.fieldUpdates?.preferences?.inspectionWarning8s).toEqual({
      updatedAt: 200,
      editorId: 'laptop',
    })
    // Automatic review records both deterministic choices, but only manual
    // review leaves them pending.
    expect(
      conflicts.map((conflict) => [conflict.field, conflict.resolution]),
    ).toEqual([
      ['name', 'remote'],
      ['preferences.inspectionWarning8s', 'local'],
    ])
  })

  it('falls back to session updatedAt for legacy fields without metadata', () => {
    const local = session({ updatedAt: 100, name: 'Local name' })
    const remote = session({ updatedAt: 200, name: 'Remote name' })

    expect(getSessionFieldUpdate(local, 'name')).toEqual({
      updatedAt: 100,
      editorId: 'legacy',
    })
    expect(getSessionPreferenceUpdate(local, 'timerUpdateMode')).toEqual({
      updatedAt: 100,
      editorId: 'legacy',
    })

    const { metadata, conflicts } = merge(local, remote)
    expect(metadata.name).toBe('Remote name')
    expect(metadata.fieldUpdates?.name?.updatedAt).toBe(200)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatchObject({ field: 'name', resolution: 'remote' })
  })

  it('does not persist fallback metadata for equal legacy fields', () => {
    const { metadata, conflicts } = merge(
      session({ name: 'Practice', updatedAt: 100 }),
      session({ name: 'Practice', updatedAt: 200 }),
    )

    expect(conflicts).toHaveLength(0)
    expect(metadata.name).toBe('Practice')
    expect(metadata.fieldUpdates).toBeUndefined()
  })

  it('keeps explicit metadata when equal legacy and modern values meet', () => {
    const explicit = { updatedAt: 200, editorId: 'phone' }
    const { metadata } = merge(
      session({ name: 'Practice', updatedAt: 100 }),
      session({
        name: 'Practice',
        updatedAt: 200,
        fieldUpdates: { name: explicit },
      }),
    )

    expect(metadata.name).toBe('Practice')
    expect(metadata.fieldUpdates?.name).toEqual(explicit)
  })

  it('merges event changes using their field metadata', () => {
    const { metadata, conflicts } = merge(
      session({
        event: '333',
        fieldUpdates: { event: { updatedAt: 100, editorId: 'laptop' } },
      }),
      session({
        event: '444',
        fieldUpdates: { event: { updatedAt: 200, editorId: 'phone' } },
      }),
    )

    expect(metadata.event).toBe('444')
    expect(metadata.fieldUpdates?.event?.updatedAt).toBe(200)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatchObject({ field: 'event', resolution: 'remote' })
  })

  it('applies an approved conflict and keeps it stable on later merges', () => {
    const local = session({
      name: 'Local',
      updatedAt: 100,
      fieldUpdates: { name: { updatedAt: 100, editorId: 'laptop' } },
    })
    const remote = session({
      name: 'Remote',
      updatedAt: 200,
      fieldUpdates: { name: { updatedAt: 200, editorId: 'phone' } },
    })
    const pending = merge(local, remote, true)
    expect(pending.conflicts).toHaveLength(1)
    expect(pending.conflicts[0]).toMatchObject({
      kind: 'session',
      field: 'name',
      localValue: 'Local',
      remoteValue: 'Remote',
      resolution: 'manual-pending',
    })

    const resolved: SyncConflict = {
      ...pending.conflicts[0]!,
      resolution: 'local',
      updatedAt: 300,
    }
    const firstApply = merge(local, remote, true, [resolved])
    expect(firstApply.conflicts).toHaveLength(0)
    expect(firstApply.metadata.name).toBe('Local')
    expect(firstApply.metadata.fieldUpdates?.name?.updatedAt).toBe(300)

    // The applied value carries the approval timestamp. A repeated merge must
    // not interpret that stamp as a new conflicting edit.
    const mergedSession = session({
      ...local,
      name: firstApply.metadata.name,
      fieldUpdates: firstApply.metadata.fieldUpdates,
    })
    const secondApply = merge(mergedSession, remote, true, [resolved])
    expect(secondApply.conflicts).toHaveLength(0)
    expect(secondApply.metadata.name).toBe('Local')
  })

  it('applies an approval when the reviewed pair arrives reversed', () => {
    const resolved: SyncConflict = {
      kind: 'session',
      id: 'session-1',
      sessionId: 'session-1',
      field: 'name',
      localValue: 'Local',
      remoteValue: 'Remote',
      localUpdatedAt: 100,
      remoteUpdatedAt: 200,
      resolution: 'local',
      updatedAt: 300,
    }
    // The accumulator already holds the approved value; a second snapshot still
    // presents the losing value, so local and remote are swapped.
    const local = session({
      name: 'Remote',
      fieldUpdates: { name: { updatedAt: 300, editorId: 'phone' } },
    })
    const remote = session({
      name: 'Local',
      fieldUpdates: { name: { updatedAt: 100, editorId: 'laptop' } },
    })

    const { metadata, conflicts } = merge(local, remote, true, [resolved])

    expect(conflicts).toHaveLength(0)
    expect(metadata.name).toBe('Local')
    expect(metadata.fieldUpdates?.name).toEqual({
      updatedAt: 300,
      editorId: 'laptop',
    })
  })

  it('raises a fresh conflict when the losing side changes after approval', () => {    const local = session({
      name: 'Local',
      updatedAt: 100,
      fieldUpdates: { name: { updatedAt: 100, editorId: 'laptop' } },
    })
    const remote = session({
      name: 'Remote',
      updatedAt: 200,
      fieldUpdates: { name: { updatedAt: 200, editorId: 'phone' } },
    })
    const resolved = merge(local, remote, true).conflicts[0]!
    const approved: SyncConflict = { ...resolved, resolution: 'local', updatedAt: 300 }
    const editedRemote = session({
      name: 'Remote edited',
      updatedAt: 400,
      fieldUpdates: { name: { updatedAt: 400, editorId: 'phone' } },
    })

    const { conflicts } = merge(local, editedRemote, true, [approved])
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatchObject({
      localValue: 'Local',
      remoteValue: 'Remote edited',
      resolution: 'manual-pending',
    })
  })

  it('honors an explicit inspection override removal with field metadata', () => {
    const local = session({
      inspectionEnabled: undefined,
      fieldUpdates: {
        inspectionEnabled: { updatedAt: 300, editorId: 'laptop' },
        preferences: {
          inspectionEnabled: { updatedAt: 300, editorId: 'laptop' },
        },
      },
    })
    const remote = session({
      inspectionEnabled: true,
      preferences: { inspectionEnabled: true },
      fieldUpdates: {
        inspectionEnabled: { updatedAt: 100, editorId: 'phone' },
        preferences: {
          inspectionEnabled: { updatedAt: 100, editorId: 'phone' },
        },
      },
    })

    const { metadata, conflicts } = merge(local, remote)
    expect(metadata.inspectionEnabled).toBeUndefined()
    expect(metadata.preferences?.inspectionEnabled).toBeUndefined()
    expect(metadata.fieldUpdates?.inspectionEnabled).toEqual({
      updatedAt: 300,
      editorId: 'laptop',
    })
    expect(metadata.fieldUpdates?.preferences?.inspectionEnabled).toEqual({
      updatedAt: 300,
      editorId: 'laptop',
    })
    expect(conflicts.map((conflict) => conflict.field)).toEqual([
      'inspectionEnabled',
      'preferences.inspectionEnabled',
    ])
    expect(conflicts.every((conflict) => conflict.resolution === 'local')).toBe(
      true,
    )
  })

  it('keeps an explicit removal when both sides have no override', () => {
    const { metadata } = merge(
      session({
        inspectionEnabled: undefined,
        fieldUpdates: {
          inspectionEnabled: { updatedAt: 300, editorId: 'laptop' },
        },
      }),
      session({ inspectionEnabled: undefined, updatedAt: 500 }),
    )

    expect(metadata.inspectionEnabled).toBeUndefined()
    expect(metadata.fieldUpdates?.inspectionEnabled).toEqual({
      updatedAt: 300,
      editorId: 'laptop',
    })
  })

  it('honors an explicit preference removal with field metadata', () => {
    const local = session({
      preferences: {},
      fieldUpdates: {
        preferences: {
          inspectionWarning8s: { updatedAt: 300, editorId: 'laptop' },
        },
      },
    })
    const remote = session({
      preferences: { inspectionWarning8s: true },
      fieldUpdates: {
        preferences: {
          inspectionWarning8s: { updatedAt: 100, editorId: 'phone' },
        },
      },
    })

    const { metadata, conflicts } = merge(local, remote)
    expect(metadata.preferences?.inspectionWarning8s).toBeUndefined()
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatchObject({
      field: 'preferences.inspectionWarning8s',
      resolution: 'local',
    })
  })

  it('reports the newest metadata timestamp carried by a session', () => {
    expect(
      maxSessionFieldUpdateTime({
        fieldUpdates: {
          name: { updatedAt: 10, editorId: 'a' },
          preferences: {
            timerUpdateMode: { updatedAt: 40, editorId: 'a' },
          },
        },
      }),
    ).toBe(40)
  })
})
