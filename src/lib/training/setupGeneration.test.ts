// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import {
  AUF_ALGS,
  OLL_INSERTION,
  PLL_PRECURSOR,
  applyAlgorithm,
  f2lSlotStatuses,
  invertState,
  isF2lSolved,
  isFixedOllPreInsertionState,
  isIdentical,
  isOllState,
  isPllState,
  loadCube3Model,
  type Cube3Model,
  type Cube3State,
} from './cube3'
import { identifyCaseState } from './caseState'
import {
  createOllCaseDefinition,
} from './catalog/ollCases'
import { PLL_CASE_BY_ID } from './catalog/pllCases'
import type {
  TrainingAlgorithmRecord,
  TrainingCaseDefinition,
} from './catalog/types'
import { canonicalOllSignature } from './caseSignature'
import { normalizeAlgorithmFrame } from './frame'
import { identifyPllCase } from './pllIdentity'
import {
  generateTrainingSetup,
  SetupGenerationError,
} from './setupGeneration'
import { normalizeCatalogAlgorithm } from './notation'

const OLL_SUNE_ALGORITHM = "R U R' U R U2 R'"
const OLL_45_CORRECTION = "F R U R' U' F'"
const PLL_UA_ALGORITHM = "M2 U M U2 M' U M2"
const PLL_AA_ALGORITHM = "x R' U R' D2 R U' R' D2 R2 x'"

let model: Cube3Model

beforeAll(async () => {
  model = await loadCube3Model()
})

function ollCaseFromAlgorithm(
  number: number,
  algorithm: string,
  name: string,
): TrainingCaseDefinition {
  const caseState = invertState(
    normalizeAlgorithmFrame(model, algorithm).generatedState,
  )
  return createOllCaseDefinition({
    number,
    canonicalSignature: canonicalOllSignature(caseState),
    name,
  })
}

function record(
  definition: TrainingCaseDefinition,
  algorithm: string,
  overrides: Partial<TrainingAlgorithmRecord> = {},
): TrainingAlgorithmRecord {
  const normalizedNotation = normalizeCatalogAlgorithm(algorithm)
  return {
    id: `${definition.id}:alg:fixture`,
    version: 1,
    caseId: definition.id,
    setId: definition.setId,
    source: 'bundled',
    label: 'Fixture',
    notation: algorithm,
    normalizedNotation,
    immutable: true,
    provenance: {
      sourceKind: 'independently-authored',
      originalNotation: algorithm,
      normalizedNotation,
      redistribution: 'not-applicable',
      redistributionNotes: 'Independent test fixture.',
    },
    verification: {
      status: 'verified',
      method: 'cube-state',
      verifiedAt: '2026-11-08',
      frameNormalized: true,
      solvesCase: true,
      checkedAufs: ['', 'U', 'U2', "U'"],
    },
    ...overrides,
  }
}

function withAlgorithm(
  definition: TrainingCaseDefinition,
  algorithm: TrainingAlgorithmRecord,
): TrainingCaseDefinition {
  return {
    ...definition,
    defaultAlgorithmId: algorithm.id,
    generatorAlgorithmId: algorithm.id,
  }
}

function generate(
  definition: TrainingCaseDefinition,
  algorithms: readonly TrainingAlgorithmRecord[],
  mode: 'execution' | 'recognition',
  auf: (typeof AUF_ALGS)[number],
) {
  return generateTrainingSetup({
    model,
    caseDefinition: definition,
    algorithms,
    mode,
    auf,
    verifiedAt: '2026-11-08',
  })
}

describe('verified training setup generation', () => {
  it('generates execution and recognition setups for OLL Sune', () => {
    const definition = ollCaseFromAlgorithm(
      27,
      OLL_SUNE_ALGORITHM,
      'Sune',
    )
    const algorithm = record(definition, OLL_SUNE_ALGORITHM)
    const withAlg = withAlgorithm(definition, algorithm)

    for (const auf of AUF_ALGS) {
      const execution = generate(
        withAlg,
        [algorithm],
        'execution',
        auf,
      )
      const target = applyAlgorithm(model.solved, execution.scramble)
      expect(isOllState(target), auf || 'none').toBe(true)
      expect(isF2lSolved(target)).toBe(true)
      expect(
        identifyCaseState(target, 'oll-orientation').canonicalSignature,
      ).toBe(definition.canonicalSignature)
      expect(execution.verification.targetMatchesCase).toBe(true)
      expect(execution.precursor).toBeNull()
      expect(execution.targetHidden).toBe(false)

      const recognition = generate(
        withAlg,
        [algorithm],
        'recognition',
        auf,
      )
      expect(recognition.precursor).toBe(OLL_INSERTION)
      expect(recognition.targetHidden).toBe(true)
      const preState = applyAlgorithm(
        model.solved,
        recognition.scramble,
      )
      expect(isFixedOllPreInsertionState(preState)).toBe(true)
      expect(
        f2lSlotStatuses(preState).filter((slot) => slot.solved),
      ).toHaveLength(3)
      expect(identifyPllCaseWithoutThrow(preState)).toBeNull()
      const returned = applyAlgorithm(preState, OLL_INSERTION)
      expect(isIdentical(returned, target)).toBe(true)
      expect(
        identifyCaseState(returned, 'oll-orientation')
          .canonicalSignature,
      ).toBe(definition.canonicalSignature)
      expect(
        recognition.verification.recognition
          ?.precursorReturnsTargetExactly,
      ).toBe(true)
    }
  })

  it('generates setups for the approved OLL 45 correction fixture', () => {
    const definition = ollCaseFromAlgorithm(
      45,
      OLL_45_CORRECTION,
      'OLL 45 correction fixture',
    )
    const algorithm = record(definition, OLL_45_CORRECTION)
    const withAlg = withAlgorithm(definition, algorithm)

    const execution = generate(withAlg, [algorithm], 'execution', '')
    const target = applyAlgorithm(model.solved, execution.scramble)
    expect(isOllState(target)).toBe(true)
    expect(isF2lSolved(target)).toBe(true)
    expect(
      identifyCaseState(target, 'oll-orientation').canonicalSignature,
    ).toBe(definition.canonicalSignature)

    const recognition = generate(
      withAlg,
      [algorithm],
      'recognition',
      'U',
    )
    const preState = applyAlgorithm(
      model.solved,
      recognition.scramble,
    )
    expect(isFixedOllPreInsertionState(preState)).toBe(true)
    const returned = applyAlgorithm(preState, OLL_INSERTION)
    expect(
      identifyCaseState(returned, 'oll-orientation').canonicalSignature,
    ).toBe(definition.canonicalSignature)
  })

  it('generates execution and recognition setups for PLL Ua', () => {
    const definition = PLL_CASE_BY_ID.get('pll:ua')!
    const algorithm = record(definition, PLL_UA_ALGORITHM)
    const withAlg = withAlgorithm(definition, algorithm)

    for (const auf of AUF_ALGS) {
      const execution = generate(
        withAlg,
        [algorithm],
        'execution',
        auf,
      )
      const target = applyAlgorithm(model.solved, execution.scramble)
      expect(isPllState(target), auf || 'none').toBe(true)
      expect(isF2lSolved(target)).toBe(true)
      expect(identifyPllCase(target)).toBe('pll:ua')
      expect(execution.verification.identity).toBe('pll:ua')

      const recognition = generate(
        withAlg,
        [algorithm],
        'recognition',
        auf,
      )
      expect(recognition.precursor).toBe(PLL_PRECURSOR)
      expect(recognition.targetHidden).toBe(true)
      const preState = applyAlgorithm(
        model.solved,
        recognition.scramble,
      )
      expect(isF2lSolved(preState)).toBe(true)
      expect(isPllState(preState)).toBe(false)
      const returned = applyAlgorithm(preState, PLL_PRECURSOR)
      expect(identifyPllCase(returned)).toBe('pll:ua')
      expect(
        recognition.verification.recognition
          ?.precursorReturnsTargetExactly,
      ).toBe(true)
      expect(
        recognition.verification.recognition?.preStateF2lSolved,
      ).toBe(true)
    }
  })

  it('handles a frame-sensitive PLL generator', () => {
    const definition = PLL_CASE_BY_ID.get('pll:aa')!
    const algorithm = record(definition, PLL_AA_ALGORITHM)
    const withAlg = withAlgorithm(definition, algorithm)

    const execution = generate(withAlg, [algorithm], 'execution', '')
    const target = applyAlgorithm(model.solved, execution.scramble)
    expect(identifyPllCase(target)).toBe('pll:aa')
    expect(isF2lSolved(target)).toBe(true)
    expect(execution.targetAlgorithmNotation).toContain('x')
  })

  it('regrips a generator with a net whole-cube rotation', () => {
    const definition = PLL_CASE_BY_ID.get('pll:ua')!
    const algorithm = record(definition, `${PLL_UA_ALGORITHM} y`)
    const withAlg = withAlgorithm(definition, algorithm)

    const execution = generate(withAlg, [algorithm], 'execution', '')
    const target = applyAlgorithm(model.solved, execution.scramble)
    expect(identifyPllCase(target)).toBe('pll:ua')
    expect(execution.targetAlgorithmNotation).toContain("y'")

    const recognition = generate(
      withAlg,
      [algorithm],
      'recognition',
      '',
    )
    const preState = applyAlgorithm(
      model.solved,
      recognition.scramble,
    )
    expect(
      identifyPllCase(
        applyAlgorithm(preState, PLL_PRECURSOR),
      ),
    ).toBe('pll:ua')
  })

  it('rejects missing, unverified, malformed, and wrong-case algorithms', () => {
    const definition = ollCaseFromAlgorithm(
      27,
      OLL_SUNE_ALGORITHM,
      'Sune',
    )
    const algorithm = record(definition, OLL_SUNE_ALGORITHM)
    const withAlg = withAlgorithm(definition, algorithm)

    expect(() =>
      generate(
        withAlg,
        [],
        'execution',
        '',
      ),
    ).toThrow(SetupGenerationError)

    const unverified = {
      ...algorithm,
      verification: {
        ...algorithm.verification,
        status: 'unverified' as const,
      },
    }
    expect(() =>
      generate(withAlg, [unverified], 'execution', ''),
    ).toThrow(SetupGenerationError)

    const malformed = {
      ...algorithm,
      notation: '(R U',
      normalizedNotation: '(R U',
    }
    expect(() =>
      generate(withAlg, [malformed], 'execution', ''),
    ).toThrow(SetupGenerationError)

    const wrongCaseDefinition = {
      ...definition,
      id: 'oll:28',
      canonicalSignature: '0000|0000',
    }
    const wrongCaseAlgorithm = {
      ...algorithm,
      caseId: wrongCaseDefinition.id,
    }
    const wrongCaseWithAlg = withAlgorithm(
      wrongCaseDefinition,
      wrongCaseAlgorithm,
    )
    expect(() =>
      generate(
        wrongCaseWithAlg,
        [wrongCaseAlgorithm],
        'execution',
        '',
      ),
    ).toThrow(SetupGenerationError)

    const wrongAlgorithm = record(definition, "R U R'")
    expect(() =>
      generate(
        withAlgorithm(definition, wrongAlgorithm),
        [wrongAlgorithm],
        'execution',
        '',
      ),
    ).toThrow(SetupGenerationError)
  })

  it('rejects corrupted case definitions without returning a fallback', () => {
    const definition = ollCaseFromAlgorithm(
      27,
      OLL_SUNE_ALGORITHM,
      'Sune',
    )
    const algorithm = record(definition, OLL_SUNE_ALGORITHM)
    const corrupted: TrainingCaseDefinition = {
      ...definition,
      id: 'oll:26',
      canonicalSignature: '0000|0000',
    }
    const corruptedAlgorithm = {
      ...algorithm,
      caseId: corrupted.id,
    }
    try {
      generate(
        withAlgorithm(corrupted, corruptedAlgorithm),
        [corruptedAlgorithm],
        'recognition',
        '',
      )
      throw new Error('Expected setup generation to fail.')
    } catch (error) {
      expect(error).toBeInstanceOf(SetupGenerationError)
      expect((error as SetupGenerationError).failures.length).toBeGreaterThan(
        0,
      )
    }
  })

  it('enforces the bounded candidate limit', () => {
    const definition = ollCaseFromAlgorithm(
      27,
      OLL_SUNE_ALGORITHM,
      'Sune',
    )
    const algorithm = record(definition, OLL_SUNE_ALGORITHM)
    const withAlg = withAlgorithm(definition, algorithm)
    expect(() =>
      generateTrainingSetup({
        model,
        caseDefinition: withAlg,
        algorithms: [algorithm],
        mode: 'execution',
        maxCandidateAttempts: 0,
      }),
    ).toThrow(SetupGenerationError)
  })

  it('never returns a setup whose exact target is not reached', () => {
    const definition = PLL_CASE_BY_ID.get('pll:t')!
    const algorithm = record(definition, PLL_UA_ALGORITHM)
    expect(() =>
      generate(
        withAlgorithm(definition, algorithm),
        [algorithm],
        'execution',
        '',
      ),
    ).toThrow(SetupGenerationError)
  })
})

function identifyPllCaseWithoutThrow(
  state: Cube3State,
): string | null {
  try {
    return identifyPllCase(state)
  } catch {
    return null
  }
}
