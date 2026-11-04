export interface SessionDropRow {
  top: number
  bottom: number
}

/**
 * Returns where a dragged session should be inserted after it has been removed
 * from the list. Rows must be the non-dragged rows in their current order; the
 * result is therefore also the session's final zero-based position.
 */
export function getSessionDropIndex(
  rows: readonly SessionDropRow[],
  pointerY: number,
): number {
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]
    if (!row) continue
    if (pointerY < (row.top + row.bottom) / 2) return index
  }
  return rows.length
}

/**
 * Pixels per animation frame for edge auto-scroll during a drag. The speed
 * ramps up as the pointer approaches the edge and is zero outside the bands.
 */
export function getDragAutoScrollDelta(
  pointerY: number,
  top: number,
  bottom: number,
  edge = 36,
  maxStep = 14,
): number {
  if (bottom <= top || edge <= 0) return 0
  const band = Math.min(edge, (bottom - top) / 2)
  if (pointerY < top + band) {
    const intensity = Math.min(1, (top + band - pointerY) / band)
    return -Math.max(2, Math.round(maxStep * intensity))
  }
  if (pointerY > bottom - band) {
    const intensity = Math.min(1, (pointerY - (bottom - band)) / band)
    return Math.max(2, Math.round(maxStep * intensity))
  }
  return 0
}
