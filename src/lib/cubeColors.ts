import { CUBE_FACES, type CubeFace } from './cubeNet'

/**
 * Standard six-face colour scheme.
 *
 * The Draw Scramble 2D net reads the matching `--cube-face-*` tokens from
 * `src/index.css` (theme tests keep the two definitions identical), while the
 * 3D twisty-player can only accept concrete values. Keeping one canonical
 * table here means a sticker never changes colour between the two views.
 */
export const CUBE_FACE_COLORS: Readonly<Record<CubeFace, string>> = {
  U: '#FFFFFF',
  D: '#FFFF00',
  F: '#00FF00',
  B: '#0000FF',
  R: '#FF0000',
  L: '#FF8000',
}

/**
 * cubing.js' puzzle-geometry owns a mutable `colors` map keyed by face name.
 * `get3d()` copies those values into the puzzle's vertex colours, so the map
 * must be updated before the twisty player builds a PG3D scene. The property is
 * private in cubing.js' typings, hence this structural type.
 */
export interface PuzzleGeometryColors {
  colors?: Record<string, string>
}

/**
 * Apply the standard scheme to a puzzle-geometry instance in place. Loaders
 * cache one geometry per puzzle, so every later PG3D build reuses the corrected
 * palette.
 */
export function applyCubeFaceColors(geometry: PuzzleGeometryColors): void {
  if (!geometry.colors) return
  for (const face of CUBE_FACES) {
    geometry.colors[face] = CUBE_FACE_COLORS[face]
  }
}
