/**
 * Standard PLL named-case identity.
 *
 * Three different signatures exist and must not be conflated:
 *
 * 1. `pllPermutationSignature` — the raw position→piece signature at the
 *    current AUF. It is exact but frame/AUF dependent.
 * 2. `canonicalPllSignature` — the lexicographically smallest post-AUF-only
 *    variant. The Phase 1 signature has 72 classes and remains unchanged.
 * 3. `pllDoubleCosetSignature` / `identifyPllCase` — the standard named-case
 *    identity: pre-AUF × permutation × post-AUF. All 288 valid last-layer
 *    permutation states collapse to exactly 22 classes: 21 standard PLL cases
 *    plus PLL skip.
 *
 * Rotation/frame normalization is deliberately *not* performed here. Callers
 * must normalize a rotated algorithm's frame first; a state that cannot satisfy
 * `isPllState` is rejected rather than assigned a misleading name.
 */

import {
  AUF_ALGS,
  Cube3StateError,
  isPllState,
  type Cube3State,
} from './cube3'
import { pllPermutationSignature } from './caseSignature'
import {
  PLL_CASE_BY_SIGNATURE,
  PLL_SKIP_CASE_ID,
  type PllCaseDefinition,
  type PllCaseId,
} from './catalog/pllCases'

export const PLL_NAMED_CLASS_COUNT = 22

function assertNamedPllState(state: Cube3State): void {
  if (!isPllState(state)) {
    throw new Cube3StateError(
      'Standard PLL identity requires a solved F2L, the last layer in U, and all U stickers oriented.',
    )
  }
}

/**
 * Canonical representative of the pre-AUF × permutation × post-AUF orbit.
 * The lexicographically smallest of all 16 raw signatures is used as the key.
 */
export function pllDoubleCosetSignature(state: Cube3State): string {
  assertNamedPllState(state)
  const transformation = state.experimentalToTransformation()
  if (!transformation) {
    throw new Cube3StateError(
      'PLL identity could not convert the cube state to a transformation.',
    )
  }

  const identity = state.kpuzzle.identityTransformation()
  const aufTransformations = AUF_ALGS.map((auf) =>
    auf === '' ? identity : identity.applyAlg(auf),
  )

  const signatures = new Set<string>()
  for (const preAuf of aufTransformations) {
    for (const postAuf of aufTransformations) {
      const variant = preAuf
        .applyTransformation(transformation)
        .applyTransformation(postAuf)
        .toKPattern()
      signatures.add(pllPermutationSignature(variant))
    }
  }

  return [...signatures].sort()[0]!
}

/** Returns the standard named PLL case, including `pll:skip`. */
export function identifyPllCase(state: Cube3State): PllCaseId {
  const signature = pllDoubleCosetSignature(state)
  const definition = PLL_CASE_BY_SIGNATURE.get(signature)
  if (!definition) {
    throw new Cube3StateError(
      `PLL permutation signature ${signature} does not map to a standard named case.`,
    )
  }
  return definition.id
}

export function pllCaseForState(
  state: Cube3State,
): PllCaseDefinition {
  const definition = PLL_CASE_BY_SIGNATURE.get(
    pllDoubleCosetSignature(state),
  )
  if (!definition) {
    throw new Cube3StateError(
      'PLL state does not map to a standard named case.',
    )
  }
  return definition
}

export function isPllSkipState(state: Cube3State): boolean {
  return identifyPllCase(state) === PLL_SKIP_CASE_ID
}

/** Rejects a state unless it belongs to the requested named PLL case. */
export function assertPllCase(
  state: Cube3State,
  caseId: PllCaseId,
): PllCaseDefinition {
  const definition = PLL_CASE_BY_SIGNATURE.get(
    pllDoubleCosetSignature(state),
  )
  if (!definition || definition.id !== caseId) {
    throw new Cube3StateError(
      `State is ${definition?.id ?? 'an unknown PLL case'}, not ${caseId}.`,
    )
  }
  return definition
}
