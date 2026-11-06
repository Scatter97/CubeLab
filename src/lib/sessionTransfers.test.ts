import { describe, expect, it } from 'vitest'
import {
  mergeSessionTransfers,
  normalizeSessionTransfers,
  resolveSessionTransferOwners,
} from './sessionTransfers'

function transfer(overrides: Record<string, unknown> = {}) {
  return {
    id: 'transfer-1',
    fromSessionId: 'source',
    toSessionId: 'destination',
    solveIds: ['solve-1', 'solve-2'],
    transferredAt: 100,
    byDeviceId: 'laptop',
    ...overrides,
  }
}

describe('session transfers', () => {
  it('normalizes valid records and drops malformed ones without merging unrelated operations', () => {
    const valid = normalizeSessionTransfers([
      transfer(),
      transfer({ id: 'transfer-2', solveIds: ['solve-1', 'solve-1', ''] }),
      transfer({ id: 'self', toSessionId: 'source' }),
      transfer({ id: 'negative', transferredAt: -1 }),
      transfer({ id: 'empty-device', byDeviceId: '' }),
      transfer({ id: 'empty-solves', solveIds: [] }),
      null,
    ])

    expect(valid).toEqual([
      expect.objectContaining({
        id: 'transfer-1',
        solveIds: ['solve-1', 'solve-2'],
      }),
      expect.objectContaining({
        id: 'transfer-2',
        solveIds: ['solve-1'],
      }),
    ])
  })

  it('unions the same operation id and sorts by operation time deterministically', () => {
    const merged = mergeSessionTransfers(
      [
        transfer({ solveIds: ['solve-2'] }),
        transfer({ id: 'later', transferredAt: 200 }),
      ],
      [
        transfer({ solveIds: ['solve-1'] }),
        transfer({ id: 'same-time-b', transferredAt: 200, byDeviceId: 'phone' }),
      ],
    )

    expect(merged.map((entry) => entry.id)).toEqual([
      'transfer-1',
      'later',
      'same-time-b',
    ])
    expect(merged[0]?.solveIds).toEqual(['solve-1', 'solve-2'])
  })

  it('resolves the latest destination per solve and follows redirects', () => {
    const owners = resolveSessionTransferOwners(
      [
        transfer({
          id: 'older',
          transferredAt: 100,
          solveIds: ['solve-1'],
          toSessionId: 'old-destination',
        }),
        transfer({
          id: 'newer',
          transferredAt: 200,
          solveIds: ['solve-1', 'solve-2'],
          toSessionId: 'new-destination',
        }),
      ],
      (id) =>
        id === 'new-destination' ? 'canonical-destination' : id,
    )

    expect(owners.get('solve-1')).toBe('canonical-destination')
    expect(owners.get('solve-2')).toBe('canonical-destination')
  })

  it('uses a deterministic tiebreak for equal operation times', () => {
    const first = resolveSessionTransferOwners(
      [
        transfer({
          id: 'b',
          transferredAt: 100,
          byDeviceId: 'phone',
          solveIds: ['solve-1'],
          toSessionId: 'destination-b',
        }),
        transfer({
          id: 'a',
          transferredAt: 100,
          byDeviceId: 'laptop',
          solveIds: ['solve-1'],
          toSessionId: 'destination-a',
        }),
      ],
      (id) => id,
    )
    const reversed = resolveSessionTransferOwners(
      [
        transfer({
          id: 'a',
          transferredAt: 100,
          byDeviceId: 'laptop',
          solveIds: ['solve-1'],
          toSessionId: 'destination-a',
        }),
        transfer({
          id: 'b',
          transferredAt: 100,
          byDeviceId: 'phone',
          solveIds: ['solve-1'],
          toSessionId: 'destination-b',
        }),
      ],
      (id) => id,
    )

    expect(first.get('solve-1')).toBe('destination-b')
    expect(reversed.get('solve-1')).toBe('destination-b')
  })
})
