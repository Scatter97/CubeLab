/**
 * Deterministic OLL/PLL case-space enumeration for Phase 1 coverage tests.
 *
 * OLL states use the identity last-layer permutation and every valid orientation
 * pattern (corner twists sum to 0 mod 3, edge flips sum to 0 mod 2). PLL states
 * use every valid last-layer permutation pair with equal parity. These are
 * mathematical states, not catalog cases.
 */

import {
  CORNER_PIECES,
  EDGE_PIECES,
  type Cube3Model,
  type Cube3State,
} from './cube3'

function permutationsOfFour(): readonly (readonly number[])[] {
  const result: number[][] = []
  for (let a = 0; a < 4; a += 1) {
    for (let b = 0; b < 4; b += 1) {
      if (b === a) continue
      for (let c = 0; c < 4; c += 1) {
        if (c === a || c === b) continue
        for (let d = 0; d < 4; d += 1) {
          if (d === a || d === b || d === c) continue
          result.push([a, b, c, d])
        }
      }
    }
  }
  return result
}

function orientationPatterns(
  orientations: number,
  size: number,
): readonly (readonly number[])[] {
  const result: number[][] = []
  const current = new Array<number>(size).fill(0)

  const visit = (index: number, sum: number): void => {
    if (index === size) {
      if (sum % orientations === 0) result.push([...current])
      return
    }
    for (let value = 0; value < orientations; value += 1) {
      current[index] = value
      visit(index + 1, sum + value)
    }
  }

  visit(0, 0)
  return result
}

function permutationParity(permutation: readonly number[]): number {
  let inversions = 0
  for (let i = 0; i < permutation.length; i += 1) {
    for (let j = i + 1; j < permutation.length; j += 1) {
      if (permutation[i]! > permutation[j]!) inversions += 1
    }
  }
  return inversions % 2
}

function identityCornerPieces(): number[] {
  return CORNER_PIECES.map((_, index) => index)
}

function identityEdgePieces(): number[] {
  return EDGE_PIECES.map((_, index) => index)
}

/**
 * All 216 valid last-layer orientation states with the F2L solved and the
 * last-layer permutation identity. They form 58 AUF orbits: 57 OLL cases plus
 * the solved orientation.
 */
export function enumerateOllOrientationStates(
  model: Cube3Model,
): readonly Cube3State[] {
  const cornerPatterns = orientationPatterns(3, 4)
  const edgePatterns = orientationPatterns(2, 4)
  const cornerPieces = identityCornerPieces()
  const edgePieces = identityEdgePieces()
  const states: Cube3State[] = []

  for (const cornerOrientations of cornerPatterns) {
    for (const edgeOrientations of edgePatterns) {
      states.push(
        model.createState({
          cornerPieces,
          cornerOrientations: [...cornerOrientations, 0, 0, 0, 0],
          edgePieces,
          edgeOrientations: [...edgeOrientations, 0, 0, 0, 0, 0, 0, 0, 0],
        }),
      )
    }
  }
  return states
}

/**
 * All 288 valid last-layer permutation states with the F2L solved and the last
 * layer oriented (4! × 4! / 2, including solved/PLL skip).
 */
export function enumeratePllPermutationStates(
  model: Cube3Model,
): readonly Cube3State[] {
  const permutations = permutationsOfFour()
  const states: Cube3State[] = []

  for (const cornerPermutation of permutations) {
    for (const edgePermutation of permutations) {
      if (
        permutationParity(cornerPermutation) !==
        permutationParity(edgePermutation)
      ) {
        continue
      }
      states.push(
        model.createState({
          cornerPieces: [...cornerPermutation, 4, 5, 6, 7],
          cornerOrientations: new Array<number>(8).fill(0),
          edgePieces: [...edgePermutation, 4, 5, 6, 7, 8, 9, 10, 11],
          edgeOrientations: new Array<number>(12).fill(0),
        }),
      )
    }
  }
  return states
}
