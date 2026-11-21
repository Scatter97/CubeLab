import { afterEach, describe, expect, it } from 'vitest'
import {
  CUBELAB_EVENTS,
  formatEventOptionLabel,
  getEventDefinition,
  getEventLabel,
  getEventOptions,
  normalizeStoredEvent,
  isPuzzleEventValue,
  resetCustomEventDefinitionsForTests,
} from './events'

afterEach(() => {
  resetCustomEventDefinitionsForTests()
})

describe('event registry', () => {
  it('keeps the seven original cube events and adds the five remaining WCA puzzles', () => {
    expect(CUBELAB_EVENTS.map((event) => event.id)).toEqual([
      '333',
      '222',
      '444',
      '333oh',
      '555',
      '666',
      '777',
      'pyram',
      'skewb',
      'sq1',
      'clock',
      'minx',
    ])
    expect(CUBELAB_EVENTS.map((event) => event.label)).toEqual([
      '3×3',
      '2×2',
      '4×4',
      '3×3 OH',
      '5×5',
      '6×6',
      '7×7',
      'Pyraminx',
      'Skewb',
      'Square-1',
      'Clock',
      'Megaminx',
    ])
  })

  it('uses the official cubing.js WCA scramble IDs', () => {
    const expected: Record<string, string> = {
      '333': '333',
      '222': '222',
      '444': '444',
      '333oh': '333oh',
      '555': '555',
      '666': '666',
      '777': '777',
      pyram: 'pyram',
      skewb: 'skewb',
      sq1: 'sq1',
      clock: 'clock',
      minx: 'minx',
    }

    for (const event of CUBELAB_EVENTS) {
      expect(event.scrambleEventId, event.id).toBe(expected[event.id])
      expect(event.puzzleId.length, event.id).toBeGreaterThan(0)
    }
    expect(new Set(CUBELAB_EVENTS.map((event) => event.id)).size).toBe(
      CUBELAB_EVENTS.length,
    )
  })

  it('only exposes a 2D cube net for N×N cube events', () => {
    const cubeEvents = CUBELAB_EVENTS.filter((event) => event.cubeSize !== null)
    expect(cubeEvents.map((event) => event.id)).toEqual([
      '333',
      '222',
      '444',
      '333oh',
      '555',
      '666',
      '777',
    ])
    for (const event of cubeEvents) {
      expect(event.scrambleFormat).toBe('cube')
      expect(event.cubeSize).toBeGreaterThanOrEqual(2)
    }
    for (const event of CUBELAB_EVENTS.filter((event) => event.cubeSize === null)) {
      expect(event.scrambleFormat, event.id).not.toBe('cube')
    }
  })

  it('validates only registered event values', () => {
    for (const event of CUBELAB_EVENTS) {
      expect(isPuzzleEventValue(event.id)).toBe(true)
      expect(getEventDefinition(event.id)).toBe(event)
    }
    expect(isPuzzleEventValue('333bf')).toBe(false)
    expect(isPuzzleEventValue('333mbf')).toBe(false)
    expect(isPuzzleEventValue('333fm')).toBe(false)
    expect(isPuzzleEventValue(333)).toBe(false)
    expect(getEventDefinition('unknown')).toBeUndefined()
  })

  it('exposes MISC and folds retired custom events into it', () => {
    expect(getEventLabel('misc')).toBe('MISC')
    expect(normalizeStoredEvent('custom:fto')).toBe('misc')
    expect(normalizeStoredEvent('333bf')).toBe('misc')
    expect(normalizeStoredEvent('333')).toBe('333')
    expect(normalizeStoredEvent('')).toBeNull()
    expect(normalizeStoredEvent(undefined)).toBeNull()
    const last = getEventOptions().at(-1)
    expect(last?.id).toBe('misc')
    expect(last ? formatEventOptionLabel(last) : null).toBe('MISC')
    expect(getEventOptions().some((option) => option.id.startsWith('custom:'))).toBe(false)
  })
})
