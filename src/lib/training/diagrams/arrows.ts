/**
 * Last-layer permutation arrows for PLL diagrams.
 *
 * The display convention is: an arrow starts at the U-layer position currently
 * occupied by a piece and ends at that piece's home position. Every moving
 * corner and edge is shown exactly once. The underlying mapping is read from
 * the existing validated `cubing.js` pattern data.
 */

import {
  Cube3StateError,
  isPllState,
  type Cube3State,
} from '../cube3'

export type ULayerCornerPosition = 'UFR' | 'UBR' | 'UBL' | 'UFL'
export type ULayerEdgePosition = 'UF' | 'UR' | 'UB' | 'UL'
export type ULayerPosition = ULayerCornerPosition | ULayerEdgePosition

export type PermutationArrowKind = 'corner' | 'edge'

export interface PermutationArrow {
  readonly kind: PermutationArrowKind
  readonly piece: ULayerPosition
  readonly from: ULayerPosition
  readonly to: ULayerPosition
}

export const U_LAYER_CORNER_POSITIONS: readonly ULayerCornerPosition[] = [
  'UFR',
  'UBR',
  'UBL',
  'UFL',
]

export const U_LAYER_EDGE_POSITIONS: readonly ULayerEdgePosition[] = [
  'UF',
  'UR',
  'UB',
  'UL',
]

export const U_LAYER_POSITIONS: readonly ULayerPosition[] = [
  ...U_LAYER_CORNER_POSITIONS,
  ...U_LAYER_EDGE_POSITIONS,
]

/**
 * Returns deterministic arrows ordered by kind (corners first) and source
 * position. Solved positions are omitted.
 */
export function lastLayerPermutationArrows(
  state: Cube3State,
): readonly PermutationArrow[] {
  if (!isPllState(state)) {
    throw new Cube3StateError(
      'PLL arrows require a solved F2L, the last layer in U, and all U stickers oriented.',
    )
  }

  const corners = state.patternData.CORNERS!
  const edges = state.patternData.EDGES!
  const arrows: PermutationArrow[] = []

  for (let positionIndex = 0; positionIndex < 4; positionIndex += 1) {
    const pieceIndex = corners.pieces[positionIndex]!
    if (pieceIndex < 0 || pieceIndex >= 4) {
      throw new Cube3StateError(
        `Corner position ${U_LAYER_CORNER_POSITIONS[positionIndex]} contains a non-U piece.`,
      )
    }
    if (pieceIndex === positionIndex) continue
    const from = U_LAYER_CORNER_POSITIONS[positionIndex]!
    const to = U_LAYER_CORNER_POSITIONS[pieceIndex]!
    arrows.push({ kind: 'corner', piece: to, from, to })
  }

  for (let positionIndex = 0; positionIndex < 4; positionIndex += 1) {
    const pieceIndex = edges.pieces[positionIndex]!
    if (pieceIndex < 0 || pieceIndex >= 4) {
      throw new Cube3StateError(
        `Edge position ${U_LAYER_EDGE_POSITIONS[positionIndex]} contains a non-U piece.`,
      )
    }
    if (pieceIndex === positionIndex) continue
    const from = U_LAYER_EDGE_POSITIONS[positionIndex]!
    const to = U_LAYER_EDGE_POSITIONS[pieceIndex]!
    arrows.push({ kind: 'edge', piece: to, from, to })
  }

  return arrows
}

export interface PermutationCycle {
  readonly kind: PermutationArrowKind
  readonly positions: readonly ULayerPosition[]
}

/**
 * Decomposes the arrows into display cycles. A fixed piece is omitted. This is
 * useful for accessible descriptions and independent test assertions.
 */
export function lastLayerPermutationCycles(
  arrows: readonly PermutationArrow[],
): readonly PermutationCycle[] {
  const cycles: PermutationCycle[] = []
  const visited = new Set<string>()

  for (const kind of ['corner', 'edge'] as const) {
    const kindArrows = arrows.filter((arrow) => arrow.kind === kind)
    const byFrom = new Map(kindArrows.map((arrow) => [arrow.from, arrow]))
    for (const arrow of kindArrows) {
      if (visited.has(`${kind}:${arrow.from}`)) continue
      const positions: ULayerPosition[] = []
      let current: ULayerPosition | undefined = arrow.from
      while (current !== undefined) {
        const key = `${kind}:${current}`
        if (visited.has(key)) break
        visited.add(key)
        positions.push(current)
        current = byFrom.get(current)?.to
      }
      if (positions.length > 1) cycles.push({ kind, positions })
    }
  }

  return cycles
}

export function positionSetForKind(
  kind: PermutationArrowKind,
): readonly ULayerPosition[] {
  return kind === 'corner'
    ? U_LAYER_CORNER_POSITIONS
    : U_LAYER_EDGE_POSITIONS
}

export function isULayerPosition(value: string): value is ULayerPosition {
  return (U_LAYER_POSITIONS as readonly string[]).includes(value)
}
