// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import {
  AUF_ALGS,
  OLL_SKIP_ORIENTATION_SIGNATURE,
  OLL_INSERTION_INVERSE,
  PLL_PRECURSOR,
  PLL_PRECURSOR_INVERSE,
  SUNE_OLL_SIGNATURE,
  analyzeOllInsertion,
  analyzePllPrecursor,
  applyAlgorithm,
  applyAuf,
  applyPreAuf,
  findCorner,
  findEdge,
  isIdentical,
  isPllState,
  loadCube3Model,
  ollOrientationSignature,
  type Cube3Model,
  type Cube3State,
} from './cube3'
import {
  canonicalOllSignature,
  canonicalPllSignature,
  ollOrientationOrbit,
  pllPermutationOrbit,
  pllPermutationSignature,
} from './caseSignature'
import {
  enumerateOllOrientationStates,
  enumeratePllPermutationStates,
} from './caseSpace'

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

function suneOll(): Cube3State {
  return applyAlgorithm(model.solved, PLL_PRECURSOR_INVERSE)
}

describe('training case signatures', () => {
  it('uses the verified Sune OLL orientation signature', () => {
    const state = suneOll()
    expect(ollOrientationSignature(state)).toBe(SUNE_OLL_SIGNATURE)
    const orbit = ollOrientationOrbit(state)
    expect(orbit).toHaveLength(4)
    expect(orbit).toContain(SUNE_OLL_SIGNATURE)
    expect(canonicalOllSignature(state)).toBe(orbit[0])
    for (const auf of AUF_ALGS) {
      const variant = applyAuf(state, auf)
      expect(canonicalOllSignature(variant)).toBe(canonicalOllSignature(state))
    }
  })

  it('rejects OLL signatures for non-OLL states', () => {
    const preState = applyAlgorithm(
      model.solved,
      "R U R' U'",
    )
    expect(() => ollOrientationSignature(preState)).toThrow()
    expect(() =>
      ollOrientationSignature(applyAlgorithm(model.solved, "R U R'")),
    ).toThrow()
    expect(() => canonicalOllSignature(preState)).toThrow()
  })

  it('covers all 216 OLL orientation states and all 58 AUF orbits', () => {
    const states = enumerateOllOrientationStates(model)
    expect(states).toHaveLength(216)

    const orbitKeys = new Set<string>()
    const canonicalSignatures = new Set<string>()
    const preStateSignature = new Set<string>()

    for (const state of states) {
      const analysis = analyzeOllInsertion(state)
      expect(analysis.targetIsOllState).toBe(true)
      expect(analysis.targetF2lSolved).toBe(true)
      expect(analysis.preStateIsFixed).toBe(true)
      expect(analysis.insertionReturnsTarget).toBe(true)
      expect(analysis.ok).toBe(true)

      orbitKeys.add(ollOrientationOrbit(state).join('~'))
      canonicalSignatures.add(canonicalOllSignature(state))
      const preState = applyAlgorithm(state, OLL_INSERTION_INVERSE)
      const corner = findCorner(preState, 'DFR')
      const edge = findEdge(preState, 'FR')
      preStateSignature.add(
        `${corner.position}:${corner.orientation};${edge.position}:${edge.orientation}`,
      )
    }

    expect(orbitKeys.size).toBe(58)
    expect(canonicalSignatures.size).toBe(58)
    expect(canonicalSignatures.has(OLL_SKIP_ORIENTATION_SIGNATURE)).toBe(true)
    expect(canonicalSignatures.size - 1).toBe(57)
    expect(preStateSignature.size).toBe(1)
    expect([...preStateSignature][0]).toBe('UFR:2;UR:0')

    // Pre-Phase 1 also exercised a non-identity U-layer permutation.
    for (const state of states) {
      expect(analyzeOllInsertion(applyAlgorithm(state, 'U')).ok).toBe(true)
    }
  })

  it('supports pre-AUF insertion for all 216 OLL orientation states', () => {
    const states = enumerateOllOrientationStates(model)
    let checked = 0
    for (const state of states) {
      for (const auf of AUF_ALGS) {
        const target = applyPreAuf(state, auf)
        const analysis = analyzeOllInsertion(target)
        expect(analysis.ok, `pre ${auf || 'none'}`).toBe(true)
        expect(analysis.preStateIsFixed).toBe(true)
        expect(analysis.insertionReturnsTarget).toBe(true)
        checked += 1
      }
    }
    expect(checked).toBe(864)
  })

  it('covers all 288 PLL permutation states with the Sune precursor', () => {
    const states = enumeratePllPermutationStates(model)
    expect(states).toHaveLength(288)

    const preStateSignatures = new Set<string>()
    for (const state of states) {
      expect(isPllState(state)).toBe(true)
      const analysis = analyzePllPrecursor(state)
      expect(analysis.ok).toBe(true)
      expect(analysis.preStateF2lSolved).toBe(true)
      expect(analysis.preStateIsSuneOll).toBe(true)
      expect(analysis.preStateIsNotPllOriented).toBe(true)
      expect(analysis.precursorReturnsTarget).toBe(true)
      expect(analysis.preStateOrientationSignature).toBe(SUNE_OLL_SIGNATURE)
      expect(analysis.preStateUFaceNonU).toBe(3)
      preStateSignatures.add(analysis.preStateOrientationSignature!)
    }
    expect([...preStateSignatures]).toEqual([SUNE_OLL_SIGNATURE])
  })

  it('returns exactly for all 1152 post-AUF PLL variants', () => {
    const states = enumeratePllPermutationStates(model)
    let checked = 0
    for (const state of states) {
      for (const auf of AUF_ALGS) {
        const target = applyAuf(state, auf)
        const analysis = analyzePllPrecursor(target)
        expect(analysis.ok, `${auf || 'no AUF'}`).toBe(true)
        expect(analysis.precursorReturnsTarget).toBe(true)
        checked += 1
      }
    }
    expect(checked).toBe(1152)
  })

  it('returns exactly for all 1152 pre-AUF PLL variants', () => {
    const states = enumeratePllPermutationStates(model)
    let checked = 0
    for (const state of states) {
      for (const auf of AUF_ALGS) {
        const target = applyPreAuf(state, auf)
        const analysis = analyzePllPrecursor(target)
        expect(analysis.ok, `pre ${auf || 'none'}`).toBe(true)
        expect(analysis.precursorReturnsTarget).toBe(true)
        expect(analysis.preStateF2lSolved).toBe(true)
        checked += 1
      }
    }
    expect(checked).toBe(1152)
  })

  it('canonicalizes PLL signatures under AUF and distinguishes named algorithms', () => {
    const signatures = new Map<string, string>()
    for (const [name, algorithm] of Object.entries(NAMED_PLL_ALGORITHMS)) {
      const state = applyAlgorithm(model.solved, algorithm)
      expect(isPllState(state), name).toBe(true)
      expect(analyzePllPrecursor(state).ok, name).toBe(true)

      const canonical = canonicalPllSignature(state)
      expect(canonicalPllSignature(applyAuf(state, 'U'))).toBe(canonical)
      expect(canonicalPllSignature(applyAuf(state, 'U2'))).toBe(canonical)
      expect(canonicalPllSignature(applyAuf(state, "U'"))).toBe(canonical)
      expect(pllPermutationOrbit(state)).toContain(
        pllPermutationSignature(state),
      )

      const previous = signatures.get(canonical)
      expect(previous, `${name} collided with ${previous}`).toBeUndefined()
      signatures.set(canonical, name)
    }
    expect(signatures.size).toBe(21)
  })

  it('rejects incorrect PLL precursors and non-PLL states', () => {
    const tPerm = applyAlgorithm(
      model.solved,
      NAMED_PLL_ALGORITHMS.T,
    )
    expect(analyzePllPrecursor(tPerm).ok).toBe(true)

    const truncated = analyzePllPrecursor(
      tPerm,
      "R U R' U R U2 R",
    )
    expect(truncated.prescribed).toBe(false)
    expect(truncated.preStateIsSuneOll).toBe(false)
    expect(truncated.ok).toBe(false)

    const inversePrecursor = analyzePllPrecursor(
      tPerm,
      PLL_PRECURSOR_INVERSE,
    )
    expect(inversePrecursor.preStateIsSuneOll).toBe(false)
    expect(inversePrecursor.ok).toBe(false)

    expect(analyzePllPrecursor(suneOll()).ok).toBe(false)
    expect(() => pllPermutationSignature(suneOll())).toThrow()
    expect(() => pllPermutationOrbit(suneOll())).toThrow()
    expect(PLL_PRECURSOR).toBe("R U R' U R U2 R'")
  })

  it('is deterministic and repeatable across case-space enumeration', () => {
    const first = enumeratePllPermutationStates(model)
      .slice(0, 20)
      .map((state) => canonicalPllSignature(state))
    const second = enumeratePllPermutationStates(model)
      .slice(0, 20)
      .map((state) => canonicalPllSignature(state))
    expect(second).toEqual(first)
    expect(isIdentical(suneOll(), suneOll())).toBe(true)
  })
})

