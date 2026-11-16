/**
 * Cube-frame normalization for training algorithms.
 *
 * Whole-cube rotations and some slice-heavy algorithms leave the cube in a
 * different physical frame. Case identity is always evaluated in the fixed
 * CubeLab standard frame. Normalization therefore finds the unique whole-cube
 * rotation that restores the centers and appends its inverse to the notation.
 * Rotations are never silently discarded: the returned correction makes the
 * resulting state explicit and the implementation verifies exact state equality.
 */

import {
  type Cube3Model,
  type Cube3State,
  applyAlgorithm,
  isIdentical,
  isStandardFrame,
} from './cube3'
import {
  parseCatalogAlgorithm,
  type ParsedCatalogAlgorithm,
} from './notation'

const ROTATION_TOKENS = [
  'x',
  "x'",
  'x2',
  'y',
  "y'",
  'y2',
  'z',
  "z'",
  'z2',
] as const

export class CubeFrameError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CubeFrameError'
  }
}

export interface RotationMember {
  /** Canonical whole-cube rotation notation, e.g. `y'` or `x z2`. */
  readonly algorithm: string
  readonly state: Cube3State
}

export interface FrameNormalizedState {
  readonly state: Cube3State
  /** Rotation applied after the original state to reach the standard frame. */
  readonly rotation: string
}

export interface FrameNormalizedAlgorithm {
  readonly parsed: ParsedCatalogAlgorithm
  /** Strictly parsed catalog notation, without a frame correction. */
  readonly normalized: string
  /** Whole-cube rotation appended to restore the standard frame. */
  readonly frameCorrection: string
  /** Normalized algorithm plus the frame correction. */
  readonly frameNormalized: string
  /** State produced by the raw normalized algorithm. */
  readonly rawGeneratedState: Cube3State
  /** State produced by the frame-normalized algorithm (centers home). */
  readonly generatedState: Cube3State
}

function centerKey(state: Cube3State): string {
  const centers = state.patternData.CENTERS
  if (!centers) throw new CubeFrameError('Cube state is missing its centers.')
  return `${centers.pieces.join(',')}|${centers.orientation.join(',')}`
}

const rotationCache = new WeakMap<Cube3Model, readonly RotationMember[]>()

/**
 * The 24 whole-cube orientation states, generated deterministically from x/y/z.
 * The list is cached per loaded cube model.
 */
export function rotationGroup(
  model: Cube3Model,
): readonly RotationMember[] {
  const cached = rotationCache.get(model)
  if (cached) return cached

  const members = new Map<string, RotationMember>()
  const queue: string[] = ['']
  members.set(centerKey(model.solved), {
    algorithm: '',
    state: model.solved,
  })

  while (queue.length > 0) {
    const algorithm = queue.shift()!
    const moveCount = algorithm === '' ? 0 : algorithm.split(' ').length
    if (moveCount >= 4) continue

    for (const token of ROTATION_TOKENS) {
      const next = algorithm === '' ? token : `${algorithm} ${token}`
      const state = applyAlgorithm(model.solved, next)
      const key = centerKey(state)
      if (members.has(key)) continue
      members.set(key, { algorithm: next, state })
      queue.push(next)
    }
  }

  if (members.size !== 24) {
    throw new CubeFrameError(
      `Expected 24 whole-cube rotations, generated ${members.size}.`,
    )
  }

  const result = [...members.values()]
  rotationCache.set(model, result)
  return result
}

/**
 * Finds the unique whole-cube rotation that brings a state's centers home.
 * Throws for a state that cannot be frame-normalized or has an ambiguous frame.
 */
export function normalizeStateFrame(
  model: Cube3Model,
  state: Cube3State,
): FrameNormalizedState {
  const candidates: FrameNormalizedState[] = []

  for (const member of rotationGroup(model)) {
    if (member.algorithm === '') {
      if (isStandardFrame(state)) {
        candidates.push({ state, rotation: '' })
      }
      continue
    }
    const candidate = applyAlgorithm(state, member.algorithm)
    if (isStandardFrame(candidate)) {
      candidates.push({ state: candidate, rotation: member.algorithm })
    }
  }

  const unique = candidates.filter(
    (candidate, index) =>
      candidates.findIndex((other) =>
        isIdentical(candidate.state, other.state),
      ) === index,
  )

  if (unique.length === 0) {
    throw new CubeFrameError(
      'State has no whole-cube rotation that restores the standard frame.',
    )
  }
  if (unique.length !== 1) {
    throw new CubeFrameError(
      `State frame normalization is ambiguous (${unique.length} distinct states).`,
    )
  }
  return unique[0]!
}

/**
 * Parses and frame-normalizes an algorithm without changing its physical effect.
 * The raw algorithm may include rotations, wide turns and slices; the returned
 * `frameNormalized` notation is the same algorithm followed by the unique
 * whole-cube regrip needed to restore the standard frame.
 */
export function normalizeAlgorithmFrame(
  model: Cube3Model,
  algorithm: string,
): FrameNormalizedAlgorithm {
  const parsed = parseCatalogAlgorithm(algorithm)
  const rawGeneratedState = applyAlgorithm(model.solved, parsed.normalized)
  const normalized = normalizeStateFrame(model, rawGeneratedState)
  const frameCorrection = normalized.rotation
  const frameNormalized =
    frameCorrection === ''
      ? parsed.normalized
      : `${parsed.normalized} ${frameCorrection}`

  if (
    !isIdentical(
      applyAlgorithm(model.solved, frameNormalized),
      normalized.state,
    )
  ) {
    throw new CubeFrameError(
      'Frame-normalized notation does not reproduce the normalized state.',
    )
  }

  return {
    parsed,
    normalized: parsed.normalized,
    frameCorrection,
    frameNormalized,
    rawGeneratedState,
    generatedState: normalized.state,
  }
}

/** True when the parsed algorithm contains an explicit whole-cube rotation. */
export function usesCubeRotations(algorithm: string): boolean {
  return parseCatalogAlgorithm(algorithm).moves.some(
    (move) => move.family === 'rotation',
  )
}
