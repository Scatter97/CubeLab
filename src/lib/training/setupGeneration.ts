/**
 * Verified setup generation for execution-only and recognition training.
 *
 * Every candidate algorithm is re-verified against the cube state. Generated
 * scrambles are only returned after their resulting state, case identity, F2L
 * status, and (for recognition) fixed precursor return have been checked. There
 * is no random-string fallback and no fallback to a different case.
 */

import {
  AUF_ALGS,
  OLL_INSERTION,
  OLL_INSERTION_INVERSE,
  PLL_PRECURSOR,
  PLL_PRECURSOR_INVERSE,
  analyzeOllInsertion,
  analyzePllPrecursor,
  applyAlgorithm,
  applyPreAuf,
  f2lSlotStatuses,
  isF2lSolved,
  isFixedOllPreInsertionState,
  isIdentical,
  isStandardFrame,
  type Auf,
  type Cube3Model,
  type Cube3State,
} from './cube3'
import {
  AlgorithmVerificationError,
  solvesUpToAuf,
  verifyAlgorithmRecordForCase,
  type VerifiedAlgorithm,
} from './algorithms'
import { assertCaseState, type CaseIdentity } from './caseState'
import type {
  TrainingAlgorithmRecord,
  TrainingCaseDefinition,
} from './catalog/types'
import { invertAlgorithm, normalizeCatalogAlgorithm } from './notation'

export type TrainingSetupMode = 'execution' | 'recognition'

export interface GenerateTrainingSetupInput {
  readonly model: Cube3Model
  readonly caseDefinition: TrainingCaseDefinition
  readonly algorithms: readonly TrainingAlgorithmRecord[]
  readonly mode: TrainingSetupMode
  /** Pre-AUF variation (U^k before the selected case state). */
  readonly auf?: Auf
  /** Bounded number of candidate algorithms to try. */
  readonly maxCandidateAttempts?: number
  readonly verifiedAt?: string
}

export interface RecognitionSetupVerification {
  readonly precursor: string
  readonly preStateF2lSolved: boolean
  readonly preStateThreeSlotsSolved: boolean
  readonly preStateMatchesRequiredConfiguration: boolean
  readonly precursorReturnsTargetExactly: boolean
  readonly preStateIsNotPllOriented: boolean | null
}

export interface SetupVerification {
  readonly identity: string
  readonly canonicalSignature: string
  readonly targetF2lSolved: boolean
  readonly targetIsStandardFrame: boolean
  readonly targetMatchesCase: boolean
  readonly exactTargetReached: boolean
  readonly algorithmSolvesTargetUpToAuf: boolean
  readonly recognition: RecognitionSetupVerification | null
}

export interface GeneratedTrainingSetup {
  readonly mode: TrainingSetupMode
  readonly caseId: string
  readonly setId: string
  readonly auf: Auf
  /** Full scramble, including the inverse precursor in recognition mode. */
  readonly scramble: string
  readonly targetAlgorithmId: string
  /** Frame-normalized notation of the algorithm that solves the target case. */
  readonly targetAlgorithmNotation: string
  readonly precursor: string | null
  /** Recognition mode must hide the target until the attempt ends. */
  readonly targetHidden: boolean
  readonly verification: SetupVerification
}

export class SetupGenerationError extends Error {
  readonly failures: readonly string[]

  constructor(message: string, failures: readonly string[] = []) {
    super(message)
    this.name = 'SetupGenerationError'
    this.failures = failures
  }
}

function joinAlgorithms(...algorithms: readonly string[]): string {
  return algorithms
    .map((algorithm) => algorithm.trim())
    .filter((algorithm) => algorithm.length > 0)
    .map((algorithm) => normalizeCatalogAlgorithm(algorithm))
    .join(' ')
}

function candidateIds(
  definition: TrainingCaseDefinition,
): readonly string[] {
  const ordered = [
    definition.generatorAlgorithmId,
    definition.defaultAlgorithmId,
    ...definition.alternativeAlgorithmIds,
  ]
  return [...new Set(ordered.filter((id): id is string => Boolean(id)))]
}

function recognitionVerification(
  mode: TrainingSetupMode,
  caseKind: TrainingCaseDefinition['kind'],
  target: Cube3State,
  setup: string,
  model: Cube3Model,
): {
  readonly scramble: string
  readonly precursor: string
  readonly verification: RecognitionSetupVerification
} {
  if (mode === 'execution') {
    throw new SetupGenerationError(
      'Recognition verification requested for execution-only mode.',
    )
  }

  // The case kind decides which prescribed precursor is mandatory.
  if (caseKind === 'oll-orientation') {
    const analysis = analyzeOllInsertion(target)
    if (!analysis.ok) {
      throw new SetupGenerationError(
        'OLL recognition setup does not satisfy the fixed insertion analysis.',
      )
    }
    const scramble = joinAlgorithms(setup, OLL_INSERTION_INVERSE)
    const preState = applyAlgorithm(model.solved, scramble)
    if (!isIdentical(preState, analysis.preState)) {
      throw new SetupGenerationError(
        'OLL recognition setup does not reach the analyzed pre-insertion state.',
      )
    }
    const slots = f2lSlotStatuses(preState)
    if (
      !isFixedOllPreInsertionState(preState) ||
      slots.filter((slot) => slot.solved).length !== 3
    ) {
      throw new SetupGenerationError(
        'OLL recognition setup does not have three solved F2L slots and the fixed FR pair.',
      )
    }
    return {
      scramble,
      precursor: OLL_INSERTION,
      verification: {
        precursor: OLL_INSERTION,
        preStateF2lSolved: isF2lSolved(preState),
        preStateThreeSlotsSolved:
          slots.filter((slot) => slot.solved).length === 3,
        preStateMatchesRequiredConfiguration:
          isFixedOllPreInsertionState(preState),
        precursorReturnsTargetExactly: isIdentical(
          applyAlgorithm(preState, OLL_INSERTION),
          target,
        ),
        preStateIsNotPllOriented: null,
      },
    }
  }

  if (caseKind !== 'pll-permutation') {
    throw new SetupGenerationError(
      `Unsupported recognition case kind "${caseKind}".`,
    )
  }

  const analysis = analyzePllPrecursor(target)
  if (!analysis.ok) {
    throw new SetupGenerationError(
      'PLL recognition setup does not satisfy the fixed Sune precursor analysis.',
    )
  }
  const scramble = joinAlgorithms(setup, PLL_PRECURSOR_INVERSE)
  const preState = applyAlgorithm(model.solved, scramble)
  if (!isIdentical(preState, analysis.preState)) {
    throw new SetupGenerationError(
      'PLL recognition setup does not reach the analyzed Sune pre-state.',
    )
  }
  if (!analysis.preStateF2lSolved || analysis.preStateUFaceNonU === 0) {
    throw new SetupGenerationError(
      'PLL recognition pre-state is not a non-oriented F2L-preserving state.',
    )
  }
  return {
    scramble,
    precursor: PLL_PRECURSOR,
    verification: {
      precursor: PLL_PRECURSOR,
      preStateF2lSolved: analysis.preStateF2lSolved,
      preStateThreeSlotsSolved: f2lSlotStatuses(preState).filter(
        (slot) => slot.solved,
      ).length === 4,
      preStateMatchesRequiredConfiguration: analysis.preStateIsSuneOll,
      precursorReturnsTargetExactly: isIdentical(
        applyAlgorithm(preState, PLL_PRECURSOR),
        target,
      ),
      preStateIsNotPllOriented: analysis.preStateIsNotPllOriented,
    },
  }
}

function tryCandidate(
  input: GenerateTrainingSetupInput,
  algorithm: TrainingAlgorithmRecord,
  auf: Auf,
): GeneratedTrainingSetup {
  if (algorithm.setId !== input.caseDefinition.setId) {
    throw new SetupGenerationError(
      `Algorithm ${algorithm.id} belongs to set ${algorithm.setId}, not ${input.caseDefinition.setId}.`,
    )
  }

  const verified: VerifiedAlgorithm = verifyAlgorithmRecordForCase(
    input.model,
    input.caseDefinition,
    algorithm,
    input.verifiedAt ?? 'runtime',
  )

  const target = applyPreAuf(verified.caseState, auf)
  const setupBase = invertAlgorithm(verified.frame.frameNormalized)
  const setup = joinAlgorithms(auf, setupBase)
  const actualTarget = applyAlgorithm(input.model.solved, setup)

  if (!isIdentical(actualTarget, target)) {
    throw new SetupGenerationError(
      `Algorithm ${algorithm.id} setup does not reproduce its verified target state.`,
    )
  }
  if (!isStandardFrame(actualTarget)) {
    throw new SetupGenerationError(
      `Algorithm ${algorithm.id} setup target is not in the standard frame.`,
    )
  }

  let identity: CaseIdentity
  try {
    identity = assertCaseState(actualTarget, input.caseDefinition)
  } catch (error) {
    throw new SetupGenerationError(
      `Algorithm ${algorithm.id} setup reached the wrong case identity.`,
      [error instanceof Error ? error.message : String(error)],
    )
  }

  if (!isF2lSolved(actualTarget)) {
    throw new SetupGenerationError(
      `Algorithm ${algorithm.id} setup target does not have a solved F2L.`,
    )
  }

  const applied = applyAlgorithm(actualTarget, verified.frame.frameNormalized)
  const algorithmSolvesTargetUpToAuf = solvesUpToAuf(applied)
  if (!algorithmSolvesTargetUpToAuf) {
    throw new SetupGenerationError(
      `Algorithm ${algorithm.id} does not solve its generated target up to AUF.`,
    )
  }

  let scramble = setup
  let precursor: string | null = null
  let recognition: RecognitionSetupVerification | null = null

  if (input.mode === 'recognition') {
    const result = recognitionVerification(
      input.mode,
      input.caseDefinition.kind,
      actualTarget,
      setup,
      input.model,
    )
    scramble = result.scramble
    precursor = result.precursor
    recognition = result.verification
  }

  return {
    mode: input.mode,
    caseId: input.caseDefinition.id,
    setId: input.caseDefinition.setId,
    auf,
    scramble,
    targetAlgorithmId: algorithm.id,
    targetAlgorithmNotation: verified.frame.frameNormalized,
    precursor,
    targetHidden: input.mode === 'recognition',
    verification: {
      identity: input.caseDefinition.id,
      canonicalSignature: identity.canonicalSignature,
      targetF2lSolved: true,
      targetIsStandardFrame: true,
      targetMatchesCase: true,
      exactTargetReached: true,
      algorithmSolvesTargetUpToAuf,
      recognition,
    },
  }
}

/**
 * Generates one verified setup. Candidate algorithms are tried in catalog
 * order (generator, default, alternatives) up to the bounded limit. If none
 * verifies, the function throws rather than returning a fallback scramble.
 */
export function generateTrainingSetup(
  input: GenerateTrainingSetupInput,
): GeneratedTrainingSetup {
  const auf = input.auf ?? ''
  if (!(AUF_ALGS as readonly string[]).includes(auf)) {
    throw new SetupGenerationError(`Unsupported AUF "${auf}".`)
  }

  const ids = candidateIds(input.caseDefinition)
  if (ids.length === 0) {
    throw new SetupGenerationError(
      `Case ${input.caseDefinition.id} has no generator, default, or alternative algorithm.`,
    )
  }

  const algorithmById = new Map(
    input.algorithms.map((algorithm) => [algorithm.id, algorithm]),
  )
  const candidates = ids
    .map((id) => algorithmById.get(id))
    .filter(
      (algorithm): algorithm is TrainingAlgorithmRecord =>
        algorithm !== undefined,
    )

  const missing = ids.filter((id) => !algorithmById.has(id))
  const failures: string[] = missing.map(
    (id) => `Referenced algorithm ${id} is missing from the supplied catalog.`,
  )

  const limit = input.maxCandidateAttempts ?? candidates.length
  if (!Number.isInteger(limit) || limit < 1) {
    throw new SetupGenerationError(
      'maxCandidateAttempts must be a positive integer.',
    )
  }
  if (candidates.length === 0) {
    throw new SetupGenerationError(
      `Case ${input.caseDefinition.id} has no usable algorithm records.`,
      failures,
    )
  }

  for (const algorithm of candidates.slice(0, limit)) {
    try {
      return tryCandidate(input, algorithm, auf)
    } catch (error) {
      const message =
        error instanceof AlgorithmVerificationError
          ? `${algorithm.id}: ${error.failures.join('; ')}`
          : `${algorithm.id}: ${
              error instanceof Error ? error.message : String(error)
            }`
      failures.push(message)
    }
  }

  throw new SetupGenerationError(
    `No verified setup could be generated for ${input.caseDefinition.id}.`,
    failures,
  )
}
