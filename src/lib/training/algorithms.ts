/**
 * Algorithm validation and stable-ID helpers.
 *
 * Verification is always performed against the cubie state, not against the
 * algorithm's claimed case. A record may carry verification metadata, but setup
 * generation re-checks the actual state so stale or fabricated metadata cannot
 * produce a usable attempt.
 */

import {
  AUF_ALGS,
  applyAlgorithm,
  applyPreAuf,
  invertState,
  isSolved,
  type Auf,
  type Cube3Model,
  type Cube3State,
} from './cube3'
import { assertCaseState, type CaseIdentity } from './caseState'
import type { TrainingCaseDefinition } from './catalog/types'
import {
  CatalogValidationError,
  validateAlgorithmRevision,
} from './catalog/validation'
import {
  normalizeAlgorithmFrame,
  type FrameNormalizedAlgorithm,
} from './frame'
import { normalizeCatalogAlgorithm } from './notation'
import type {
  AlgorithmProvenance,
  AlgorithmVerificationMetadata,
  TrainingAlgorithmRecord,
} from './catalog/types'

export class AlgorithmVerificationError extends Error {
  readonly failures: readonly string[]

  constructor(message: string, failures: readonly string[] = []) {
    super(message)
    this.name = 'AlgorithmVerificationError'
    this.failures = failures
  }
}

export interface AlgorithmVerificationInput {
  readonly model: Cube3Model
  readonly caseDefinition: TrainingCaseDefinition
  readonly notation: string
  readonly verifiedAt: string
  readonly checkedAufs?: readonly Auf[]
}

export interface VerifiedAlgorithm {
  readonly frame: FrameNormalizedAlgorithm
  readonly generatedState: Cube3State
  readonly caseState: Cube3State
  readonly identity: CaseIdentity
  readonly solvesCaseExactly: boolean
  readonly solvesCaseUpToAuf: boolean
  readonly verification: AlgorithmVerificationMetadata
}

/** Builds a stable algorithm ID from a case ID and a variant key. */
export function trainingAlgorithmId(
  caseId: string,
  variantKey: string,
): string {
  const key = variantKey.trim()
  if (!key) {
    throw new RangeError('Algorithm variant key must not be empty.')
  }
  return `${caseId}:alg:${key}`
}

export interface AlgorithmRevisionInput {
  readonly id: string
  readonly version: number
  readonly notation: string
  readonly normalizedNotation?: string
  readonly label?: string
  readonly provenance: AlgorithmProvenance
  readonly verification: AlgorithmVerificationMetadata
}

/**
 * Creates an explicit replacement record for a changed algorithm.
 *
 * The previous ID is never reused for different notation. The new record keeps
 * the same case/set/source/immutability, gets a new stable ID and version, and
 * links back to the replaced algorithm for historical attribution.
 */
export function createAlgorithmRevision(
  previous: TrainingAlgorithmRecord,
  revision: AlgorithmRevisionInput,
): TrainingAlgorithmRecord {
  const next: TrainingAlgorithmRecord = {
    ...previous,
    id: revision.id,
    version: revision.version,
    label: revision.label ?? previous.label,
    notation: revision.notation,
    normalizedNotation:
      revision.normalizedNotation ??
      normalizeCatalogAlgorithm(revision.notation),
    replacesAlgorithmId: previous.id,
    provenance: revision.provenance,
    verification: revision.verification,
  }
  const issues = validateAlgorithmRevision(previous, next)
  if (issues.length > 0) {
    throw new CatalogValidationError(issues)
  }
  return next
}

/** True when a state becomes solved under some final AUF. */
export function solvesUpToAuf(state: Cube3State): boolean {
  return AUF_ALGS.some((auf) => isSolved(applyPreAuf(state, auf)))
}

/**
 * Verifies that an algorithm solves the supplied case in the standard frame.
 * Throws with all detected failures instead of returning an unverified result.
 */
export function verifyAlgorithmForCase(
  input: AlgorithmVerificationInput,
): VerifiedAlgorithm {
  const checkedAufs = input.checkedAufs ?? AUF_ALGS
  const failures: string[] = []

  let frame: FrameNormalizedAlgorithm
  try {
    frame = normalizeAlgorithmFrame(input.model, input.notation)
  } catch (error) {
    throw new AlgorithmVerificationError(
      `Algorithm could not be normalized: ${
        error instanceof Error ? error.message : String(error)
      }`,
      [error instanceof Error ? error.message : String(error)],
    )
  }

  const caseState = invertState(frame.generatedState)
  let identity: CaseIdentity
  try {
    identity = assertCaseState(caseState, input.caseDefinition)
  } catch (error) {
    throw new AlgorithmVerificationError(
      `Algorithm does not produce a valid ${input.caseDefinition.id} case.`,
      [error instanceof Error ? error.message : String(error)],
    )
  }

  const exactResult = applyAlgorithm(caseState, frame.frameNormalized)
  const solvesCaseExactly = isSolved(exactResult)
  if (!solvesCaseExactly) {
    failures.push(
      'Frame-normalized algorithm does not solve the generated case exactly.',
    )
  }

  for (const auf of checkedAufs) {
    const varied = applyPreAuf(caseState, auf)
    const applied = applyAlgorithm(varied, frame.frameNormalized)
    if (!solvesUpToAuf(applied)) {
      failures.push(
        `Algorithm does not solve the case under pre-AUF "${auf || 'none'}".`,
      )
    }
  }

  if (failures.length > 0) {
    throw new AlgorithmVerificationError(
      `Algorithm failed verification for ${input.caseDefinition.id}.`,
      failures,
    )
  }

  const verification: AlgorithmVerificationMetadata = {
    status: 'verified',
    method: 'cube-state',
    verifiedAt: input.verifiedAt,
    frameNormalized: true,
    frameCorrection: frame.frameCorrection || undefined,
    frameNormalizedNotation: frame.frameNormalized,
    solvesCase: true,
    checkedAufs: [...checkedAufs],
    notes:
      'Verified by exact cube-state identity and solve checks using the Phase 1 model.',
  }

  return {
    frame,
    generatedState: frame.generatedState,
    caseState,
    identity,
    solvesCaseExactly,
    solvesCaseUpToAuf: true,
    verification,
  }
}

/**
 * Re-verifies a catalog record against a case. Used by setup generation so a
 * record's stale metadata cannot be trusted blindly.
 */
export function verifyAlgorithmRecordForCase(
  model: Cube3Model,
  caseDefinition: TrainingCaseDefinition,
  algorithm: TrainingAlgorithmRecord,
  verifiedAt: string,
): VerifiedAlgorithm {
  if (algorithm.caseId !== caseDefinition.id) {
    throw new AlgorithmVerificationError(
      `Algorithm ${algorithm.id} belongs to ${algorithm.caseId}, not ${caseDefinition.id}.`,
    )
  }
  if (algorithm.verification.status !== 'verified') {
    throw new AlgorithmVerificationError(
      `Algorithm ${algorithm.id} is not marked verified.`,
    )
  }
  if (!algorithm.verification.solvesCase) {
    throw new AlgorithmVerificationError(
      `Algorithm ${algorithm.id} is not recorded as solving its case.`,
    )
  }
  return verifyAlgorithmForCase({
    model,
    caseDefinition,
    notation: algorithm.notation,
    verifiedAt,
    checkedAufs: algorithm.verification.checkedAufs,
  })
}
