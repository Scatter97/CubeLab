import { describe, expect, it } from 'vitest'
import { getDragAutoScrollDelta, getSessionDropIndex } from './sessionDrag'

const rows = [
  { top: 0, bottom: 36 },
  { top: 40, bottom: 76 },
  { top: 80, bottom: 116 },
]

describe('session drag geometry', () => {
  it('finds the insertion index around each row midpoint', () => {
    expect(getSessionDropIndex(rows, 0)).toBe(0)
    expect(getSessionDropIndex(rows, 17)).toBe(0)
    expect(getSessionDropIndex(rows, 18)).toBe(1)
    expect(getSessionDropIndex(rows, 57)).toBe(1)
    expect(getSessionDropIndex(rows, 58)).toBe(2)
    expect(getSessionDropIndex(rows, 97)).toBe(2)
    expect(getSessionDropIndex(rows, 98)).toBe(3)
    expect(getSessionDropIndex(rows, 500)).toBe(3)
  })

  it('handles a list with only the dragged row removed', () => {
    expect(getSessionDropIndex([], 120)).toBe(0)
  })

  it('auto-scrolls only near the top or bottom edge', () => {
    expect(getDragAutoScrollDelta(200, 100, 300)).toBe(0)
    expect(getDragAutoScrollDelta(140, 100, 300)).toBe(0)
    expect(getDragAutoScrollDelta(100, 100, 300)).toBeLessThan(0)
    expect(getDragAutoScrollDelta(300, 100, 300)).toBeGreaterThan(0)
    expect(getDragAutoScrollDelta(120, 100, 300)).toBeGreaterThan(
      getDragAutoScrollDelta(100, 100, 300),
    )
    expect(getDragAutoScrollDelta(280, 100, 300)).toBeGreaterThan(0)
    expect(getDragAutoScrollDelta(290, 100, 300)).toBeGreaterThan(
      getDragAutoScrollDelta(280, 100, 300),
    )
  })

  it('does not auto-scroll a collapsed container', () => {
    expect(getDragAutoScrollDelta(100, 100, 100)).toBe(0)
  })
})
