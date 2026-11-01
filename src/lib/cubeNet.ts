/**
 * Pure cube-face model used by the Draw Scramble 2D net.
 *
 * A scramble is applied to stickers on a solved N×N×N cube. Each sticker keeps
 * its colour, outward normal, and integer cube coordinate. A quarter turn
 * rotates the stickers in the selected layer around the cube centre; after all
 * moves the stickers are projected back onto the six faces. No random colours
 * or canned examples are involved.
 */

export type CubeFace = 'U' | 'D' | 'F' | 'B' | 'R' | 'L'

export type CubeFacelets = Record<CubeFace, CubeFace[][]>

export interface CubeNet {
  size: number
  faces: CubeFacelets
}

export const CUBE_FACES: readonly CubeFace[] = ['U', 'L', 'F', 'R', 'B', 'D']

type Axis = 'x' | 'y' | 'z'
type Vec3 = readonly [number, number, number]

interface FaceDefinition {
  normal: Vec3
  right: Vec3
  down: Vec3
  axis: Axis
  /** +1 when the face is on the positive side of its axis. */
  sign: 1 | -1
}

const FACE_DEFINITIONS: Record<CubeFace, FaceDefinition> = {
  U: { normal: [0, 1, 0], right: [1, 0, 0], down: [0, 0, 1], axis: 'y', sign: 1 },
  D: { normal: [0, -1, 0], right: [1, 0, 0], down: [0, 0, -1], axis: 'y', sign: -1 },
  F: { normal: [0, 0, 1], right: [1, 0, 0], down: [0, -1, 0], axis: 'z', sign: 1 },
  B: { normal: [0, 0, -1], right: [-1, 0, 0], down: [0, -1, 0], axis: 'z', sign: -1 },
  R: { normal: [1, 0, 0], right: [0, 0, -1], down: [0, -1, 0], axis: 'x', sign: 1 },
  L: { normal: [-1, 0, 0], right: [0, 0, 1], down: [0, -1, 0], axis: 'x', sign: -1 },
}

interface Sticker {
  color: CubeFace
  normal: Vec3
  position: Vec3
}

interface ParsedMove {
  face: CubeFace
  /** Number of layers turned, measured from the outer face. */
  depth: number
  /** `1` clockwise, `-1` counter-clockwise, `2` half turn. */
  quarterTurns: 1 | -1 | 2
}

const MOVE_PATTERN = /^(?:(\d+))?([URFDLB])(w?)(2'|'2|2|')?$/

/** Parses WCA / cubing.js N×N scramble notation. */
export function parseScrambleMoves(scramble: string, size: number): ParsedMove[] | null {
  const tokens = scramble.trim().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return null

  const moves: ParsedMove[] = []
  for (const token of tokens) {
    const match = MOVE_PATTERN.exec(token)
    if (!match) return null

    const [, prefixText, faceText, wideText, modifier = ''] = match
    const face = faceText as CubeFace
    const prefix = prefixText === undefined ? null : Number(prefixText)
    const wide = wideText === 'w'

    let depth: number
    if (wide) {
      depth = prefix ?? 2
    } else {
      // A numeric prefix without `w` is slice notation. CubeLab's generated
      // scrambles never use it, and guessing would show the wrong state.
      if (prefix !== null) return null
      depth = 1
    }

    if (!Number.isInteger(depth) || depth < 1 || depth > size) return null

    moves.push({
      face,
      depth,
      quarterTurns:
        modifier === '2' || modifier === "2'" || modifier === "'2"
          ? 2
          : modifier === "'"
            ? -1
            : 1,
    })
  }

  return moves
}

function facePosition(face: CubeFace, row: number, col: number, size: number): Vec3 {
  const last = size - 1
  switch (face) {
    case 'U':
      return [col, last, row]
    case 'D':
      return [col, 0, last - row]
    case 'F':
      return [col, last - row, last]
    case 'B':
      return [last - col, last - row, 0]
    case 'R':
      return [last, last - row, last - col]
    case 'L':
      return [0, last - row, col]
  }
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function roundCoordinate(value: number): number {
  return Math.round(value)
}

function rotateVector(vector: Vec3, axis: Axis, quarterTurns: number): Vec3 {
  const turns = ((quarterTurns % 4) + 4) % 4
  let [x, y, z] = vector

  for (let turn = 0; turn < turns; turn += 1) {
    if (axis === 'x') {
      ;[y, z] = [-z, y]
    } else if (axis === 'y') {
      ;[x, z] = [z, -x]
    } else {
      ;[x, y] = [-y, x]
    }
  }

  return [x, y, z]
}

function rotateSticker(sticker: Sticker, axis: Axis, center: number, quarterTurns: number): Sticker {
  const relative: Vec3 = [
    sticker.position[0] - center,
    sticker.position[1] - center,
    sticker.position[2] - center,
  ]
  const rotated = rotateVector(relative, axis, quarterTurns)

  return {
    color: sticker.color,
    normal: rotateVector(sticker.normal, axis, quarterTurns),
    position: [
      roundCoordinate(rotated[0] + center),
      roundCoordinate(rotated[1] + center),
      roundCoordinate(rotated[2] + center),
    ],
  }
}

function createSolvedStickers(size: number): Sticker[] {
  const stickers: Sticker[] = []
  for (const face of CUBE_FACES) {
    for (let row = 0; row < size; row += 1) {
      for (let col = 0; col < size; col += 1) {
        stickers.push({
          color: face,
          normal: FACE_DEFINITIONS[face].normal,
          position: facePosition(face, row, col, size),
        })
      }
    }
  }
  return stickers
}

function faceForNormal(normal: Vec3): CubeFace | null {
  for (const face of CUBE_FACES) {
    if (dot(FACE_DEFINITIONS[face].normal, normal) === 1) return face
  }
  return null
}

function emptyFaces(size: number): CubeFacelets {
  const makeFace = () =>
    Array.from({ length: size }, () => Array.from({ length: size }, () => 'U' as CubeFace))

  return {
    U: makeFace(),
    D: makeFace(),
    F: makeFace(),
    B: makeFace(),
    R: makeFace(),
    L: makeFace(),
  }
}

function projectStickers(stickers: Sticker[], size: number): CubeFacelets | null {
  const faces = emptyFaces(size)
  const center = (size - 1) / 2
  const filled = new Set<string>()

  for (const sticker of stickers) {
    const face = faceForNormal(sticker.normal)
    if (!face) return null

    const definition = FACE_DEFINITIONS[face]
    const relative: Vec3 = [
      sticker.position[0] - center,
      sticker.position[1] - center,
      sticker.position[2] - center,
    ]
    const col = roundCoordinate(dot(relative, definition.right) + center)
    const row = roundCoordinate(dot(relative, definition.down) + center)
    if (row < 0 || row >= size || col < 0 || col >= size) return null

    const key = `${face}:${row}:${col}`
    if (filled.has(key)) return null
    filled.add(key)
    const faceRow = faces[face][row]
    if (!faceRow) return null
    faceRow[col] = sticker.color
  }

  return filled.size === size * size * 6 ? faces : null
}

/**
 * Builds the six scrambled facelet grids for a scramble.
 * Returns `null` for an empty, unsupported, or malformed scramble.
 */
export function cubeNetForScramble(scramble: string, size: number): CubeNet | null {
  if (!Number.isInteger(size) || size < 2 || size > 7) return null

  const moves = parseScrambleMoves(scramble, size)
  if (!moves) return null

  const center = (size - 1) / 2
  let stickers = createSolvedStickers(size)

  for (const move of moves) {
    const definition = FACE_DEFINITIONS[move.face]
    const layerStart = definition.sign === 1 ? size - move.depth : 0
    const layerEnd = definition.sign === 1 ? size : move.depth
    const axisIndex = definition.axis === 'x' ? 0 : definition.axis === 'y' ? 1 : 2
    // Clockwise is a negative right-hand rotation around the outward normal.
    const direction =
      move.quarterTurns === 2 ? 2 : move.quarterTurns * -definition.sign

    stickers = stickers.map((sticker) => {
      const coordinate = sticker.position[axisIndex]
      if (coordinate < layerStart || coordinate >= layerEnd) return sticker
      return rotateSticker(sticker, definition.axis, center, direction)
    })
  }

  const faces = projectStickers(stickers, size)
  return faces ? { size, faces } : null
}
