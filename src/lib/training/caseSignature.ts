/**
 * OLL orientation and PLL permutation signatures with AUF canonicalization.
 *
 * These signatures are pure derivations from the cubing.js-backed cube state.
 * They establish the mathematical case space. The standard named PLL identity
 * (pre-AUF × permutation × post-AUF) is implemented separately in
 * `pllIdentity.ts`; `canonicalPllSignature` here remains post-AUF-only.
 */

import {
  AUF_ALGS,
  CORNER_PIECES,
  Cube3StateError,
  EDGE_PIECES,
  applyAuf,
  isOllState,
  isPllState,
  ollOrientationSignature,
  type Cube3State,
} from './cube3'

export {
  OLL_SKIP_ORIENTATION_SIGNATURE,
  SUNE_OLL_SIGNATURE,
  ollOrientationSignature,
} from './cube3'

function assertOllState(state: Cube3State): void {
  if (!isOllState(state)) {
    throw new Cube3StateError(
      'OLL signature requires a solved F2L and the last layer in U.',
    )
  }
}

function assertPllState(state: Cube3State): void {
  if (!isPllState(state)) {
    throw new Cube3StateError(
      'PLL signature requires a solved F2L, the last layer in U, and all U stickers oriented.',
    )
  }
}

/**
 * Raw corner/edge permutation signature over U-layer positions, using the
 * stable cubie names. Example: `UFR,UBR,UBL,UFL|UF,UR,UB,UL` for solved.
 */
export function pllPermutationSignature(state: Cube3State): string {
  assertPllState(state)
  const corners = state.patternData.CORNERS!
  const edges = state.patternData.EDGES!
  const cornerNames = corners.pieces
    .slice(0, 4)
    .map((index) => CORNER_PIECES[index]!)
  const edgeNames = edges.pieces
    .slice(0, 4)
    .map((index) => EDGE_PIECES[index]!)
  return `${cornerNames.join(',')}|${edgeNames.join(',')}`
}

/** Sorted unique raw OLL orientation signatures across the four AUF variants. */
export function ollOrientationOrbit(
  state: Cube3State,
): readonly string[] {
  assertOllState(state)
  const signatures = new Set<string>()
  for (const auf of AUF_ALGS) {
    signatures.add(ollOrientationSignature(applyAuf(state, auf)))
  }
  return [...signatures].sort()
}

/** Lexicographically smallest AUF variant; stable under U turns. */
export function canonicalOllSignature(state: Cube3State): string {
  return ollOrientationOrbit(state)[0]!
}

/** Sorted unique raw PLL permutation signatures across the four AUF variants. */
export function pllPermutationOrbit(
  state: Cube3State,
): readonly string[] {
  assertPllState(state)
  const signatures = new Set<string>()
  for (const auf of AUF_ALGS) {
    signatures.add(pllPermutationSignature(applyAuf(state, auf)))
  }
  return [...signatures].sort()
}

/**
 * Lexicographically smallest post-AUF variant. This is AUF-canonical only and
 * intentionally yields 72 classes; use `identifyPllCase` from `pllIdentity.ts`
 * for the 22-class standard named identity.
 */
export function canonicalPllSignature(state: Cube3State): string {
  return pllPermutationOrbit(state)[0]!
}
