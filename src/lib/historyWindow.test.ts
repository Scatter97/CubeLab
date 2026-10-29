import { describe, expect, it } from 'vitest'
import {
  averageMeasuredHeight,
  buildRowOffsets,
  computeHistoryWindow,
  findRowAtOffset,
} from './historyWindow'

describe('history window geometry', () => {
  it('builds offsets from measured heights and a fallback estimate', () => {
    const ids = ['a', 'b', 'c', 'd']
    const heights = new Map([
      ['a', 40],
      ['c', 60],
    ])

    const offsets = buildRowOffsets(ids, heights, 50)

    expect([...offsets]).toEqual([0, 40, 90, 150, 200])
  })

  it('ignores invalid measured heights and falls back safely', () => {
    const ids = ['a', 'b']
    const heights = new Map([
      ['a', Number.NaN],
      ['b', -5],
    ])

    expect([...buildRowOffsets(ids, heights, 0)]).toEqual([0, 1, 2])
    expect([...buildRowOffsets(ids, new Map(), 44)]).toEqual([0, 44, 88])
  })

  it('averages only usable measured heights', () => {
    const heights = new Map([
      ['a', 40],
      ['b', 60],
      ['c', Number.NaN],
      ['d', 0],
    ])

    expect(averageMeasuredHeight(heights, 44)).toBe(50)
    expect(averageMeasuredHeight(new Map(), 44)).toBe(44)
    expect(averageMeasuredHeight(new Map(), 0)).toBe(1)
  })

  it('finds the row containing an offset, clamping past the end', () => {
    const offsets = buildRowOffsets(
      ['a', 'b', 'c'],
      new Map([
        ['a', 40],
        ['b', 40],
        ['c', 40],
      ]),
      40,
    )

    expect(findRowAtOffset(offsets, 0)).toBe(0)
    expect(findRowAtOffset(offsets, 39)).toBe(0)
    expect(findRowAtOffset(offsets, 40)).toBe(1)
    expect(findRowAtOffset(offsets, 119)).toBe(2)
    expect(findRowAtOffset(offsets, 10_000)).toBe(2)
    expect(findRowAtOffset(new Float64Array([0]), 0)).toBe(0)
  })

  it('renders a bounded window with spacers that preserve total height', () => {
    const ids = Array.from({ length: 2_000 }, (_, index) => `solve-${index}`)
    const offsets = buildRowOffsets(ids, new Map(), 40)

    const window = computeHistoryWindow(offsets, 20_000, 500, 200)

    expect(window.start).toBeGreaterThan(0)
    expect(window.end).toBeGreaterThan(window.start)
    expect(window.end - window.start).toBeLessThan(30)
    expect(window.topSpacer + (offsets[window.end] ?? 0) - (offsets[window.start] ?? 0) + window.bottomSpacer).toBe(
      window.totalHeight,
    )
  })

  it('covers the viewport with overscan and always includes a row', () => {
    const offsets = buildRowOffsets(
      ['a', 'b', 'c', 'd', 'e'],
      new Map([
        ['a', 40],
        ['b', 40],
        ['c', 40],
        ['d', 40],
        ['e', 40],
      ]),
      40,
    )

    expect(computeHistoryWindow(offsets, 0, 100, 0)).toEqual({
      start: 0,
      end: 3,
      topSpacer: 0,
      bottomSpacer: 80,
      totalHeight: 200,
    })
    expect(computeHistoryWindow(offsets, 80, 100, 40)).toEqual({
      start: 1,
      end: 5,
      topSpacer: 40,
      bottomSpacer: 0,
      totalHeight: 200,
    })
    expect(computeHistoryWindow(offsets, 0, 0, 0)).toEqual({
      start: 0,
      end: 1,
      topSpacer: 0,
      bottomSpacer: 160,
      totalHeight: 200,
    })
    expect(computeHistoryWindow(new Float64Array([0]), 0, 500, 0)).toEqual({
      start: 0,
      end: 0,
      topSpacer: 0,
      bottomSpacer: 0,
      totalHeight: 0,
    })
  })

  it('handles non-finite scroll inputs without producing invalid spacers', () => {
    const offsets = buildRowOffsets(['a', 'b'], new Map(), 40)
    const window = computeHistoryWindow(offsets, Number.NaN, Number.NaN, Number.NaN)

    expect(window).toEqual({
      start: 0,
      end: 1,
      topSpacer: 0,
      bottomSpacer: 40,
      totalHeight: 80,
    })
  })
})
