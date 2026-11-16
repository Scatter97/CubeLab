// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import {
  AUF_ALGS,
  applyAlgorithm,
  isF2lSolved,
  loadCube3Model,
  type Cube3Model,
} from '../cube3'
import { assertCaseState } from '../caseState'
import { assertValidCatalog, validateCatalog } from './validation'
import {
  assertValidCatalogStates,
  validateCatalogStates,
} from './stateValidation'
import {
  BUILT_IN_ALGORITHM_BY_ID,
  BUILT_IN_ALGORITHMS,
  BUILT_IN_CASE_BY_ID,
  BUILT_IN_CASES,
  BUILT_IN_OLL_CASES,
  BUILT_IN_PLL_CASES,
  BUILT_IN_TRAINING_CATALOG,
  builtInAlgorithmForCase,
} from './defaultAlgorithms'
import { OLL_SET_ID } from './ollCases'
import { PLL_SET_ID } from './pllCases'
import { generateTrainingSetup } from '../setupGeneration'
import { normalizeCatalogAlgorithm } from '../notation'

let model: Cube3Model

beforeAll(async () => {
  model = await loadCube3Model()
})

describe('built-in default algorithm catalog', () => {
  it('contains one verified default for every standard OLL and PLL case', () => {
    expect(BUILT_IN_OLL_CASES).toHaveLength(57)
    expect(BUILT_IN_PLL_CASES).toHaveLength(21)
    expect(BUILT_IN_CASES).toHaveLength(78)
    expect(BUILT_IN_ALGORITHMS).toHaveLength(78)

    const oll = BUILT_IN_ALGORITHMS.filter(
      (algorithm) => algorithm.setId === OLL_SET_ID,
    )
    const pll = BUILT_IN_ALGORITHMS.filter(
      (algorithm) => algorithm.setId === PLL_SET_ID,
    )
    expect(oll).toHaveLength(57)
    expect(pll).toHaveLength(21)
    expect(new Set(BUILT_IN_ALGORITHMS.map((a) => a.id)).size).toBe(78)
    expect(new Set(BUILT_IN_CASES.map((c) => c.id)).size).toBe(78)

    for (const definition of BUILT_IN_CASES) {
      const algorithm = builtInAlgorithmForCase(definition.id)
      expect(algorithm, definition.id).toBeDefined()
      expect(definition.defaultAlgorithmId).toBe(algorithm!.id)
      expect(definition.generatorAlgorithmId).toBe(algorithm!.id)
      expect(definition.alternativeAlgorithmIds).toEqual([])
      expect(algorithm!.id).toBe(`${definition.id}:alg:default-v1`)
      expect(algorithm!.version).toBe(1)
      expect(algorithm!.source).toBe('bundled')
      expect(algorithm!.immutable).toBe(true)
      expect(algorithm!.verification.status).toBe('verified')
      expect(algorithm!.verification.solvesCase).toBe(true)
      expect(algorithm!.verification.frameNormalized).toBe(true)
      expect(algorithm!.verification.checkedAufs).toEqual([
        '',
        'U',
        'U2',
        "U'",
      ])
      expect(algorithm!.provenance.sourceKind).toBe('owner-approved')
      expect(algorithm!.provenance.redistribution).toBe('not-applicable')
      expect(algorithm!.provenance.redistributionNotes).toMatch(
        /no third-party redistribution licence is asserted/i,
      )
    }
  })

  it('passes structural and independent cube-state catalog validation', () => {
    expect(validateCatalog(BUILT_IN_TRAINING_CATALOG)).toEqual([])
    expect(() =>
      assertValidCatalog(BUILT_IN_TRAINING_CATALOG),
    ).not.toThrow()
    expect(
      validateCatalogStates(BUILT_IN_TRAINING_CATALOG, { model }),
    ).toEqual([])
    expect(() =>
      assertValidCatalogStates(BUILT_IN_TRAINING_CATALOG, { model }),
    ).not.toThrow()
  })

  it('uses the exact owner-approved OLL 45 and OLL 56 corrections', () => {
    const oll45 = builtInAlgorithmForCase('oll:45')!
    expect(oll45.notation).toBe("F R U R' U' F'")
    expect(oll45.provenance.correction?.originalNotation).toBe(
      "F(RUR'U')f'",
    )
    expect(oll45.provenance.correction?.approvedNotation).toBe(
      "F R U R' U' F'",
    )

    const oll56 = builtInAlgorithmForCase('oll:56')!
    expect(oll56.notation).toBe("r U r' (U R U' R')2 r U' r'")
    expect(oll56.normalizedNotation).toBe(
      "Rw U Rw' U R U' R' U R U' R' Rw U' Rw'",
    )
    expect(oll56.notation).not.toContain("r U r' (R U R' U')2")
    expect(oll56.provenance.correction?.originalNotation).toContain(
      "(r'U'r')",
    )
    expect(oll56.provenance.correction?.approvedNotation).toBe(
      "r U r' (U R U' R')2 r U' r'",
    )
  })

  it('does not include the 37 additional PLL variants', () => {
    for (const caseDefinition of BUILT_IN_PLL_CASES) {
      const algorithms = BUILT_IN_ALGORITHMS.filter(
        (algorithm) => algorithm.caseId === caseDefinition.id,
      )
      expect(algorithms).toHaveLength(1)
      expect(caseDefinition.alternativeAlgorithmIds).toEqual([])
    }
  })

  it('normalizes every default and preserves the source provenance', () => {
    for (const algorithm of BUILT_IN_ALGORITHMS) {
      expect(algorithm.normalizedNotation).toBe(
        normalizeCatalogAlgorithm(algorithm.notation),
      )
      expect(algorithm.provenance.normalizedNotation).toBe(
        algorithm.normalizedNotation,
      )
      expect(algorithm.provenance.sourceRepository).toMatch(
        /^https:\/\/github\.com\//,
      )
      expect(algorithm.provenance.sourceCommit).toMatch(/^[a-f0-9]{40}$/)
      expect(algorithm.provenance.sourcePath).toBeTruthy()
      expect(algorithm.provenance.approval?.approvedBy).toBe('owner')
    }
  })

  it(
    'generates a mathematically verified setup for all 78 defaults in both modes and every AUF',
    () => {
      let generated = 0
      for (const definition of BUILT_IN_CASES) {
        const algorithm = builtInAlgorithmForCase(definition.id)!
        for (const mode of ['execution', 'recognition'] as const) {
          for (const auf of AUF_ALGS) {
            const result = generateTrainingSetup({
              model,
              caseDefinition: definition,
              algorithms: [algorithm],
              mode,
              auf,
              verifiedAt: '2026-11-10',
            })
            expect(result.caseId).toBe(definition.id)
            expect(result.targetAlgorithmId).toBe(algorithm.id)
            expect(result.targetHidden).toBe(mode === 'recognition')
            expect(result.verification.canonicalSignature).toBe(
              definition.canonicalSignature,
            )
            expect(result.verification.targetF2lSolved).toBe(true)
            expect(result.verification.algorithmSolvesTargetUpToAuf).toBe(
              true,
            )
            if (mode === 'recognition') {
              expect(result.precursor).not.toBeNull()
              expect(result.verification.recognition).not.toBeNull()
            } else {
              expect(result.precursor).toBeNull()
            }
            const target = applyAlgorithm(model.solved, result.scramble)
            if (mode === 'execution') {
              expect(isF2lSolved(target)).toBe(true)
              assertCaseState(target, definition)
            }
            generated += 1
          }
        }
      }
      expect(generated).toBe(624)
    },
    180_000,
  )

  it('resolves the same stable record by ID and by case', () => {
    for (const algorithm of BUILT_IN_ALGORITHMS) {
      expect(BUILT_IN_ALGORITHM_BY_ID.get(algorithm.id)).toBe(algorithm)
      expect(BUILT_IN_CASE_BY_ID.get(algorithm.caseId)).toBeDefined()
    }
  })
})
