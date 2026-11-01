import type { PuzzleEvent } from '../types'

/**
 * Scramble notation families. CubeLab validates each family separately because
 * WCA side events do not use N×N face-turn notation.
 */
export type ScrambleFormat =
  | 'cube'
  | 'pyraminx'
  | 'skewb'
  | 'square1'
  | 'clock'
  | 'megaminx'

export interface CubeLabEvent {
  id: PuzzleEvent
  label: string
  /** The official `cubing.js` WCA event ID used for scramble generation. */
  scrambleEventId: string
  /** The `cubing.js` twisty-player puzzle ID used by the 3D view. */
  puzzleId: string
  /**
   * The N×N size for the scramble-derived 2D net, or `null` when CubeLab has no
   * correct 2D net for the puzzle. The panel shows an honest unavailable state
   * instead of drawing an unrelated cube.
   */
  cubeSize: number | null
  scrambleFormat: ScrambleFormat
}

export const CUBELAB_EVENTS: CubeLabEvent[] = [
  { id: '333', label: '3×3', scrambleEventId: '333', puzzleId: '3x3x3', cubeSize: 3, scrambleFormat: 'cube' },
  { id: '222', label: '2×2', scrambleEventId: '222', puzzleId: '2x2x2', cubeSize: 2, scrambleFormat: 'cube' },
  { id: '444', label: '4×4', scrambleEventId: '444', puzzleId: '4x4x4', cubeSize: 4, scrambleFormat: 'cube' },
  { id: '333oh', label: '3×3 OH', scrambleEventId: '333oh', puzzleId: '3x3x3', cubeSize: 3, scrambleFormat: 'cube' },
  { id: '555', label: '5×5', scrambleEventId: '555', puzzleId: '5x5x5', cubeSize: 5, scrambleFormat: 'cube' },
  { id: '666', label: '6×6', scrambleEventId: '666', puzzleId: '6x6x6', cubeSize: 6, scrambleFormat: 'cube' },
  { id: '777', label: '7×7', scrambleEventId: '777', puzzleId: '7x7x7', cubeSize: 7, scrambleFormat: 'cube' },
  { id: 'pyram', label: 'Pyraminx', scrambleEventId: 'pyram', puzzleId: 'pyraminx', cubeSize: null, scrambleFormat: 'pyraminx' },
  { id: 'skewb', label: 'Skewb', scrambleEventId: 'skewb', puzzleId: 'skewb', cubeSize: null, scrambleFormat: 'skewb' },
  { id: 'sq1', label: 'Square-1', scrambleEventId: 'sq1', puzzleId: 'square1', cubeSize: null, scrambleFormat: 'square1' },
  { id: 'clock', label: 'Clock', scrambleEventId: 'clock', puzzleId: 'clock', cubeSize: null, scrambleFormat: 'clock' },
  { id: 'minx', label: 'Megaminx', scrambleEventId: 'minx', puzzleId: 'megaminx', cubeSize: null, scrambleFormat: 'megaminx' },
]

export function getEventDefinition(id: string): CubeLabEvent | undefined {
  return CUBELAB_EVENTS.find((event) => event.id === id)
}

export function isPuzzleEventValue(value: unknown): value is PuzzleEvent {
  return (
    typeof value === 'string' &&
    CUBELAB_EVENTS.some((event) => event.id === value)
  )
}
