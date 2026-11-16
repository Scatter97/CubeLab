// @vitest-environment node
import { KPattern } from 'cubing/kpuzzle'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  applyAlgorithm,
  isIdentical,
  isSolved,
  isStandardFrame,
  loadCube3Model,
  validateCube3State,
  type Cube3Model,
} from './cube3'
import {
  CubeFrameError,
  normalizeAlgorithmFrame,
  normalizeStateFrame,
  rotationGroup,
  usesCubeRotations,
} from './frame'
import { AlgorithmNotationError } from './notation'

const PLL_FIXTURES = {
  Aa: "x R' U R' D2 R U' R' D2 R2 x'",
  Ab: "x R2 D2 R U R' D2 R U' R x'",
  E: "x' R U' R' D R U R' D' R U R' D R U' R' D' x",
  H: 'M2 U M2 U2 M2 U M2',
  Z: "M2 U M2 U M' U2 M2 U2 M'",
} as const

let model: Cube3Model

beforeAll(async () => {
  model = await loadCube3Model()
})

describe('training cube-frame normalization', () => {
  it('generates exactly 24 unique whole-cube rotations', () => {
    const group = rotationGroup(model)
    expect(group).toHaveLength(24)
    expect(
      new Set(
        group.map((member) =>
          JSON.stringify(member.state.patternData.CENTERS),
        ),
      ).size,
    ).toBe(24)
    expect(group[0]!.algorithm).toBe('')
  })

  it('normalizes rotated states without discarding the rotation', () => {
    const solved = model.solved
    expect(normalizeStateFrame(model, solved).rotation).toBe('')

    for (const rotation of ['x', "y'", 'z2', "x y z'"]) {
      const rotated = applyAlgorithm(solved, rotation)
      expect(isStandardFrame(rotated), rotation).toBe(
        rotation === '',
      )
      const normalized = normalizeStateFrame(model, rotated)
      expect(isStandardFrame(normalized.state), rotation).toBe(true)
      expect(isIdentical(normalized.state, solved), rotation).toBe(true)
      expect(normalized.rotation.length > 0, rotation).toBe(
        !isStandardFrame(rotated),
      )
    }
  })

  it('preserves the physical effect of a frame-corrected algorithm', () => {
    const raw = "R U R' y"
    const normalized = normalizeAlgorithmFrame(model, raw)
    expect(normalized.frameCorrection).not.toBe('')
    expect(isStandardFrame(normalized.rawGeneratedState)).toBe(false)
    expect(isStandardFrame(normalized.generatedState)).toBe(true)
    expect(
      isIdentical(
        normalized.generatedState,
        applyAlgorithm(model.solved, "R U R'"),
      ),
    ).toBe(true)
    expect(
      isIdentical(
        applyAlgorithm(model.solved, normalized.frameNormalized),
        normalized.generatedState,
      ),
    ).toBe(true)
    expect(usesCubeRotations(raw)).toBe(true)
    expect(usesCubeRotations("R U R'")).toBe(false)
  })

  it('normalizes representative PLL algorithms with rotations and slices', () => {
    for (const [name, algorithm] of Object.entries(PLL_FIXTURES)) {
      const normalized = normalizeAlgorithmFrame(model, algorithm)
      expect(isStandardFrame(normalized.generatedState), name).toBe(true)
      expect(
        isIdentical(
          applyAlgorithm(model.solved, normalized.frameNormalized),
          normalized.generatedState,
        ),
        name,
      ).toBe(true)
      expect(isSolved(normalized.generatedState), name).toBe(false)
    }
  })

  it('rejects malformed notation before frame analysis', () => {
    expect(() => normalizeAlgorithmFrame(model, '(R U')).toThrow(
      AlgorithmNotationError,
    )
    expect(() => normalizeAlgorithmFrame(model, 'R U Q')).toThrow(
      AlgorithmNotationError,
    )
  })

  it('throws a frame error when no rotation restores the centers', () => {
    const data = structuredClone(model.solved.patternData)
    const centers = data.CENTERS!
    const pieces = [...centers.pieces]
    ;[pieces[0], pieces[2]] = [pieces[2]!, pieces[0]!]
    ;[pieces[3], pieces[5]] = [pieces[5]!, pieces[3]!]
    data.CENTERS = { ...centers, pieces }
    const state = new KPattern(model.kpuzzle, data)
    validateCube3State(state)
    expect(isStandardFrame(state)).toBe(false)
    expect(() => normalizeStateFrame(model, state)).toThrow(CubeFrameError)
  })
})
