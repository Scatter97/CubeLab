/**
 * Sticker facelets derived from a validated `cubing.js` cube state.
 *
 * This is a presentation mapping, not a second cube simulator: it reads the
 * existing `CORNERS`/`EDGES`/`CENTERS` pattern data and maps each cubie sticker
 * to its physical facelet. No moves are applied here.
 *
 * The corner face order matches the independently verified audit model and the
 * `cubing.js` KPuzzle orientation convention. Focused tests round-trip every
 * generated facelet through that independent model.
 */

import {
  CORNER_PIECES,
  Cube3StateError,
  EDGE_PIECES,
  isF2lSolved,
  isLastLayerInU,
  type Cube3State,
} from '../cube3'

export type FaceColor = 'U' | 'D' | 'F' | 'B' | 'R' | 'L'
export type FaceletVector = readonly [number, number, number]

export interface Facelet {
  readonly position: FaceletVector
  readonly normal: FaceletVector
  readonly color: FaceColor
  readonly piece: string
}

export interface LastLayerFacelets {
  /** U face, top row = back, bottom row = front; columns left-to-right. */
  readonly top: readonly (readonly FaceColor[])[]
  /** Layout order above the U face, left-to-right: UBL, UB, UBR. */
  readonly back: readonly FaceColor[]
  /** Layout order below the U face, left-to-right: UFL, UF, UFR. */
  readonly front: readonly FaceColor[]
  /** Layout order left of the U face, top-to-bottom: UBL, UL, UFL. */
  readonly left: readonly FaceColor[]
  /** Layout order right of the U face, top-to-bottom: UBR, UR, UFR. */
  readonly right: readonly FaceColor[]
}

export const TOP_FACE_POSITIONS = [
  ['UBL', 'UB', 'UBR'],
  ['UL', 'U', 'UR'],
  ['UFL', 'UF', 'UFR'],
] as const

export const BACK_STRIP_POSITIONS = ['UBL', 'UB', 'UBR'] as const
export const FRONT_STRIP_POSITIONS = ['UFL', 'UF', 'UFR'] as const
export const LEFT_STRIP_POSITIONS = ['UBL', 'UL', 'UFL'] as const
export const RIGHT_STRIP_POSITIONS = ['UBR', 'UR', 'UFR'] as const

export const FACE_COLORS: readonly FaceColor[] = ['U', 'D', 'F', 'B', 'R', 'L']

export const FACE_NORMALS: Readonly<Record<FaceColor, FaceletVector>> = {
  U: [0, 1, 0],
  D: [0, -1, 0],
  F: [0, 0, 1],
  B: [0, 0, -1],
  R: [1, 0, 0],
  L: [-1, 0, 0],
}

/**
 * Corner face order for the eight `CORNER_PIECES` positions. This is the
 * orientation convention shared by `cubing.js` and the independent audit model.
 */
const CORNER_FACE_ORDER = [
  'URF',
  'UBR',
  'ULB',
  'UFL',
  'DFR',
  'DLF',
  'DBL',
  'DRB',
] as const

function vectorKey(vector: FaceletVector): string {
  return vector.join(',')
}

function faceletKey(position: FaceletVector, normal: FaceletVector): string {
  return `${vectorKey(position)}:${vectorKey(normal)}`
}

function positionFor(pieceName: string): FaceletVector {
  let x = 0
  let y = 0
  let z = 0
  for (const face of pieceName) {
    const normal = FACE_NORMALS[face as FaceColor]
    if (!normal) {
      throw new Cube3StateError(`Invalid piece name "${pieceName}".`)
    }
    x += normal[0]
    y += normal[1]
    z += normal[2]
  }
  return [x, y, z]
}

function assertDisplayableState(state: Cube3State): void {
  if (!isF2lSolved(state)) {
    throw new Cube3StateError(
      'Last-layer facelets require a solved F2L.',
    )
  }
  if (!isLastLayerInU(state)) {
    throw new Cube3StateError(
      'Last-layer facelets require the last layer in U.',
    )
  }
}

/**
 * Derives all 54 facelets. The result is keyed by physical position and normal,
 * so tests can compare it directly with the independent geometric model.
 */
export function fullFacelets(state: Cube3State): readonly Facelet[] {
  assertDisplayableState(state)
  const corners = state.patternData.CORNERS!
  const edges = state.patternData.EDGES!
  const facelets: Facelet[] = []

  for (let positionIndex = 0; positionIndex < CORNER_PIECES.length; positionIndex += 1) {
    const position = CORNER_PIECES[positionIndex]!
    const pieceIndex = corners.pieces[positionIndex]!
    const orientation = corners.orientation[positionIndex]!
    const positionFaceOrder = CORNER_FACE_ORDER[positionIndex]!
    const pieceFaceOrder = CORNER_FACE_ORDER[pieceIndex]!
    const positionVector = positionFor(position)

    for (let faceIndex = 0; faceIndex < 3; faceIndex += 1) {
      const face = positionFaceOrder[faceIndex] as FaceColor
      const homeFace = pieceFaceOrder[
        (faceIndex - orientation + 3) % 3
      ] as FaceColor
      facelets.push({
        position: positionVector,
        normal: FACE_NORMALS[face],
        color: homeFace,
        piece: CORNER_PIECES[pieceIndex]!,
      })
    }
  }

  for (let positionIndex = 0; positionIndex < EDGE_PIECES.length; positionIndex += 1) {
    const position = EDGE_PIECES[positionIndex]!
    const pieceIndex = edges.pieces[positionIndex]!
    const orientation = edges.orientation[positionIndex]!
    const positionFaceOrder = EDGE_PIECES[positionIndex]!
    const pieceFaceOrder = EDGE_PIECES[pieceIndex]!
    const positionVector = positionFor(position)

    for (let faceIndex = 0; faceIndex < 2; faceIndex += 1) {
      const face = positionFaceOrder[faceIndex] as FaceColor
      const homeFace = pieceFaceOrder[
        (faceIndex - orientation + 2) % 2
      ] as FaceColor
      facelets.push({
        position: positionVector,
        normal: FACE_NORMALS[face],
        color: homeFace,
        piece: EDGE_PIECES[pieceIndex]!,
      })
    }
  }

  for (const face of FACE_COLORS) {
    facelets.push({
      position: FACE_NORMALS[face],
      normal: FACE_NORMALS[face],
      color: face,
      piece: `${face} center`,
    })
  }

  const keys = new Set(
    facelets.map((facelet) =>
      faceletKey(facelet.position, facelet.normal),
    ),
  )
  if (facelets.length !== 54 || keys.size !== 54) {
    throw new Cube3StateError(
      `Facelet derivation produced ${facelets.length} stickers with ${keys.size} unique cells; expected 54/54.`,
    )
  }

  return facelets
}

function faceletLookup(
  facelets: readonly Facelet[],
): ReadonlyMap<string, Facelet> {
  return new Map(
    facelets.map((facelet) => [
      faceletKey(facelet.position, facelet.normal),
      facelet,
    ]),
  )
}

function colorAt(
  lookup: ReadonlyMap<string, Facelet>,
  positionName: string,
  face: FaceColor,
): FaceColor {
  const key = faceletKey(positionFor(positionName), FACE_NORMALS[face])
  const facelet = lookup.get(key)
  if (!facelet) {
    throw new Cube3StateError(
      `No facelet found for ${positionName} on ${face}.`,
    )
  }
  return facelet.color
}

/** Derives the nine U-face stickers and twelve adjacent side stickers. */
export function lastLayerFacelets(state: Cube3State): LastLayerFacelets {
  const lookup = faceletLookup(fullFacelets(state))

  const top = TOP_FACE_POSITIONS.map((row) =>
    row.map((positionName) => colorAt(lookup, positionName, 'U')),
  )
  const back = BACK_STRIP_POSITIONS.map((positionName) =>
    colorAt(lookup, positionName, 'B'),
  )
  const front = FRONT_STRIP_POSITIONS.map((positionName) =>
    colorAt(lookup, positionName, 'F'),
  )
  const left = LEFT_STRIP_POSITIONS.map((positionName) =>
    colorAt(lookup, positionName, 'L'),
  )
  const right = RIGHT_STRIP_POSITIONS.map((positionName) =>
    colorAt(lookup, positionName, 'R'),
  )

  const result: LastLayerFacelets = { top, back, front, left, right }
  validateLastLayerFacelets(result)
  return result
}

function assertColorArray(value: readonly FaceColor[], label: string): void {
  if (value.length !== 3) {
    throw new Cube3StateError(`${label} must contain exactly three colors.`)
  }
  for (const color of value) {
    if (!FACE_COLORS.includes(color)) {
      throw new Cube3StateError(`${label} contains invalid color "${color}".`)
    }
  }
}

export function validateLastLayerFacelets(value: LastLayerFacelets): void {
  if (value.top.length !== 3) {
    throw new Cube3StateError('U face must contain exactly three rows.')
  }
  for (const row of value.top) {
    assertColorArray(row, 'U face row')
  }
  assertColorArray(value.back, 'Back strip')
  assertColorArray(value.front, 'Front strip')
  assertColorArray(value.left, 'Left strip')
  assertColorArray(value.right, 'Right strip')
}
