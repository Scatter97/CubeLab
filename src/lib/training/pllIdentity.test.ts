// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import {
  AUF_ALGS,
  applyAlgorithm,
  applyAuf,
  applyPreAuf,
  invertState,
  loadCube3Model,
  ollOrientationSignature,
  type Cube3Model,
  type Cube3State,
} from './cube3'
import { canonicalPllSignature } from './caseSignature'
import {
  buildCaseRepresentativeState,
  identifyCaseState,
} from './caseState'
import {
  PLL_CASE_BY_ID,
  PLL_CASES,
  PLL_NON_SKIP_CASE_IDS,
  PLL_SKIP_CASE_ID,
  type PllCaseId,
} from './catalog/pllCases'
import { enumeratePllPermutationStates } from './caseSpace'
import { normalizeAlgorithmFrame } from './frame'
import {
  PLL_NAMED_CLASS_COUNT,
  assertPllCase,
  identifyPllCase,
  pllDoubleCosetSignature,
} from './pllIdentity'

const NAMED_PLL_ALGORITHMS = {
  Ua: "M2 U M U2 M' U M2",
  Ub: "M2 U' M U2 M' U' M2",
  H: 'M2 U M2 U2 M2 U M2',
  Z: "M2 U M2 U M' U2 M2 U2 M'",
  T: "R U R' U' R' F R2 U' R' U' R U R' F'",
  Y: "F R U' R' U' R U R' F' R U R' U' R' F R F'",
  Ja: "R' U L' U2 R U' R' U2 R L",
  Jb: "R U R' F' R U R' U' R' F R2 U' R'",
  Ra: "R U' R' U' R U R D R' U' R D' R' U2 R'",
  Rb: "R' U2 R U2 R' F R U R' U' R' F' R2",
  Aa: "x R' U R' D2 R U' R' D2 R2 x'",
  Ab: "x R2 D2 R U R' D2 R U' R x'",
  E: "x' R U' R' D R U R' D' R U R' D R U' R' D' x",
  F: "R' U' F' R U R' U' R' F R2 U' R' U' R U R' U R",
  V: "R' U R' U' y R' F' R2 U' R' U R' F R F y'",
  Na: "R U R' U R U R' F' R U R' U' R' F R2 U' R' U2 R U' R'",
  Nb: "R' U R U' R' F' U' F R U R' F R' F' R U' R",
  Ga: "R2 U R' U R' U' R U' R2 U' D R' U R D'",
  Gb: "R' U' R U D' R2 U R' U R U' R U' R2 D",
  Gc: "R2 U' R U' R U R' U R2 U D' R U' R' D",
  Gd: "R U R' U' D R2 U' R U' R' U R' U R2 D'",
} as const

let model: Cube3Model

beforeAll(async () => {
  model = await loadCube3Model()
})

function caseForAlgorithm(algorithm: string): Cube3State {
  return invertState(
    normalizeAlgorithmFrame(model, algorithm).generatedState,
  )
}

describe('standard PLL named-case identity', () => {
  it('has 22 canonical table entries that are fixed points', () => {
    expect(PLL_CASES).toHaveLength(PLL_NAMED_CLASS_COUNT)
    expect(PLL_NON_SKIP_CASE_IDS).toHaveLength(21)
    expect(new Set(PLL_CASES.map((definition) => definition.id)).size).toBe(
      22,
    )
    expect(
      new Set(
        PLL_CASES.map((definition) => definition.canonicalSignature),
      ).size,
    ).toBe(22)

    for (const definition of PLL_CASES) {
      const state = buildCaseRepresentativeState(model, definition)
      expect(pllDoubleCosetSignature(state)).toBe(
        definition.canonicalSignature,
      )
      expect(identifyPllCase(state)).toBe(definition.id)
      expect(identifyCaseState(state, 'pll-permutation').namedCaseId).toBe(
        definition.id,
      )
    }
  })

  it('collapses all 288 permutation states into exactly 22 named classes', () => {
    const states = enumeratePllPermutationStates(model)
    expect(states).toHaveLength(288)

    const signatures = new Set<string>()
    const caseIds = new Set<string>()
    const skipStates: Cube3State[] = []
    for (const state of states) {
      const signature = pllDoubleCosetSignature(state)
      signatures.add(signature)
      const caseId = identifyPllCase(state)
      caseIds.add(caseId)
      if (caseId === PLL_SKIP_CASE_ID) skipStates.push(state)
    }

    expect(signatures.size).toBe(22)
    expect(caseIds.size).toBe(22)
    expect([...caseIds].sort()).toEqual(
      [...PLL_CASES.map((definition) => definition.id)].sort(),
    )
    expect(skipStates).toHaveLength(4)
    for (const caseId of PLL_NON_SKIP_CASE_IDS) {
      expect(caseIds.has(caseId), caseId).toBe(true)
    }
  })

  it('is invariant under all pre-AUF and post-AUF variants', () => {
    const states = enumeratePllPermutationStates(model)
    for (const state of states) {
      const expected = pllDoubleCosetSignature(state)
      for (const auf of AUF_ALGS) {
        expect(
          pllDoubleCosetSignature(applyPreAuf(state, auf)),
          `pre ${auf || 'none'}`,
        ).toBe(expected)
        expect(
          pllDoubleCosetSignature(applyAuf(state, auf)),
          `post ${auf || 'none'}`,
        ).toBe(expected)
      }
    }

    // Exhaustive 16-variant check for one representative of every class.
    const representatives = PLL_CASES.map((definition) =>
      buildCaseRepresentativeState(model, definition),
    )
    for (const state of representatives) {
      const expected = pllDoubleCosetSignature(state)
      for (const pre of AUF_ALGS) {
        for (const post of AUF_ALGS) {
          const variant = applyAuf(applyPreAuf(state, pre), post)
          expect(
            pllDoubleCosetSignature(variant),
            `${pre || 'none'}/${post || 'none'}`,
          ).toBe(expected)
        }
      }
    }
  })

  it('preserves the Phase 1 post-AUF-only signature with 72 classes', () => {
    const states = enumeratePllPermutationStates(model)
    const canonical = new Set(
      states.map((state) => canonicalPllSignature(state)),
    )
    expect(canonical.size).toBe(72)
    expect(pllDoubleCosetSignature(model.solved)).toBe(
      PLL_CASE_BY_ID.get(PLL_SKIP_CASE_ID)!.canonicalSignature,
    )
  })

  it('maps all 21 named algorithms through frame normalization', () => {
    const seen = new Set<string>()
    for (const [name, algorithm] of Object.entries(NAMED_PLL_ALGORITHMS)) {
      const caseState = caseForAlgorithm(algorithm)
      const expectedId = `pll:${name.toLowerCase()}` as PllCaseId
      expect(identifyPllCase(caseState), name).toBe(expectedId)
      expect(assertPllCase(caseState, expectedId).id).toBe(expectedId)
      seen.add(expectedId)
    }
    expect(seen.size).toBe(21)
  })

  it('matches an independent KTransformation double-coset oracle', () => {
    const states = enumeratePllPermutationStates(model).filter(
      (_, index) => index % 37 === 0,
    )
    for (const state of states) {
      const transformation = state.experimentalToTransformation()!
      const identity = state.kpuzzle.identityTransformation()
      const aufs = AUF_ALGS.map((auf) =>
        auf === '' ? identity : identity.applyAlg(auf),
      )
      const signatures: string[] = []
      for (const pre of aufs) {
        for (const post of aufs) {
          const variant = pre
            .applyTransformation(transformation)
            .applyTransformation(post)
            .toKPattern()
          const corners = variant.patternData.CORNERS!.pieces
            .slice(0, 4)
            .map(
              (index) =>
                ['UFR', 'UBR', 'UBL', 'UFL'][index]!,
            )
          const edges = variant.patternData.EDGES!.pieces
            .slice(0, 4)
            .map(
              (index) => ['UF', 'UR', 'UB', 'UL'][index]!,
            )
          signatures.push(
            `${corners.join(',')}|${edges.join(',')}`,
          )
        }
      }
      signatures.sort()
      expect(pllDoubleCosetSignature(state)).toBe(signatures[0])
    }
  })

  it('rejects invalid or non-PLL states instead of naming them', () => {
    expect(() =>
      identifyPllCase(applyAlgorithm(model.solved, "R U R'")),
    ).toThrow()
    expect(() =>
      identifyPllCase(applyAlgorithm(model.solved, 'y')),
    ).toThrow()
    expect(() =>
      identifyPllCase(applyAlgorithm(model.solved, "R U R' U'")),
    ).toThrow()

    const sune = applyAlgorithm(
      model.solved,
      "R U2 R' U' R U' R'",
    )
    expect(() => identifyPllCase(sune)).toThrow()
    expect(() =>
      ollOrientationSignature(sune),
    ).not.toThrow()

    const t = applyAlgorithm(model.solved, NAMED_PLL_ALGORITHMS.T)
    expect(() => assertPllCase(t, 'pll:ua')).toThrow()
  })
})
