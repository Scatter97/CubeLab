/**
 * Pure geometry helpers for the windowed solve history.
 *
 * The history renders newest-first. `offsets[i]` is the measured top of row
 * `i`; `offsets[i + 1] - offsets[i]` is that row's height. Rows that have not
 * been measured yet use a shared estimate, so a long session can be laid out
 * without rendering every row first.
 */

export interface HistoryWindow {
  /** First rendered row index (inclusive). */
  start: number
  /** Last rendered row index (exclusive). */
  end: number
  /** Height reserved above the rendered rows. */
  topSpacer: number
  /** Height reserved below the rendered rows. */
  bottomSpacer: number
  totalHeight: number
}

export function buildRowOffsets(
  ids: readonly string[],
  heights: ReadonlyMap<string, number>,
  fallbackHeight: number,
): Float64Array {
  const safeFallback =
    Number.isFinite(fallbackHeight) && fallbackHeight > 0
      ? fallbackHeight
      : 1
  const offsets = new Float64Array(ids.length + 1)
  let cursor = 0

  for (let index = 0; index < ids.length; index += 1) {
    offsets[index] = cursor
    const measured = heights.get(ids[index] ?? '')
    cursor +=
      measured !== undefined && Number.isFinite(measured) && measured > 0
        ? measured
        : safeFallback
  }

  offsets[ids.length] = cursor
  return offsets
}

/** Average height of measured rows, used as the estimate for the rest. */
export function averageMeasuredHeight(
  heights: ReadonlyMap<string, number>,
  fallbackHeight: number,
): number {
  let sum = 0
  let count = 0
  for (const height of heights.values()) {
    if (Number.isFinite(height) && height > 0) {
      sum += height
      count += 1
    }
  }
  if (count === 0) {
    return Number.isFinite(fallbackHeight) && fallbackHeight > 0
      ? fallbackHeight
      : 1
  }
  return sum / count
}

/**
 * Returns the row index whose vertical range contains `offset`, clamped to the
 * available rows. When `offset` is past the end, the last row is returned.
 */
export function findRowAtOffset(
  offsets: Float64Array,
  offset: number,
): number {
  const rowCount = offsets.length - 1
  if (rowCount <= 0) return 0

  const target = Number.isFinite(offset) ? offset : 0
  let low = 0
  let high = rowCount - 1

  while (low < high) {
    const middle = Math.floor((low + high + 1) / 2)
    if ((offsets[middle] ?? 0) <= target) low = middle
    else high = middle - 1
  }

  return low
}

/**
 * Selects a contiguous row window around the scroll viewport. Overscan is
 * applied in pixels so short rows and tall comment rows behave consistently.
 */
export function computeHistoryWindow(
  offsets: Float64Array,
  scrollTop: number,
  viewportHeight: number,
  overscanPx: number,
): HistoryWindow {
  const rowCount = offsets.length - 1
  if (rowCount <= 0) {
    return {
      start: 0,
      end: 0,
      topSpacer: 0,
      bottomSpacer: 0,
      totalHeight: 0,
    }
  }

  const totalHeight = offsets[rowCount] ?? 0
  const safeScrollTop = Number.isFinite(scrollTop)
    ? Math.max(0, scrollTop)
    : 0
  const safeViewport = Number.isFinite(viewportHeight)
    ? Math.max(0, viewportHeight)
    : 0
  const safeOverscan = Number.isFinite(overscanPx)
    ? Math.max(0, overscanPx)
    : 0

  const viewTop = Math.max(0, safeScrollTop - safeOverscan)
  const viewBottom = Math.min(
    totalHeight,
    safeScrollTop + safeViewport + safeOverscan,
  )

  const start = Math.min(findRowAtOffset(offsets, viewTop), rowCount - 1)
  let end = start

  while (end < rowCount && (offsets[end] ?? 0) < viewBottom) {
    end += 1
  }

  // A zero-height viewport still needs one row so the list is never blank.
  if (end === start) end = Math.min(rowCount, start + 1)

  return {
    start,
    end,
    topSpacer: offsets[start] ?? 0,
    bottomSpacer: totalHeight - (offsets[end] ?? totalHeight),
    totalHeight,
  }
}
