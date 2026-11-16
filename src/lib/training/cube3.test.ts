// @vitest-environment node
import { KPattern } from 'cubing/kpuzzle'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  OLL_INSERTION,
  OLL_INSERTION_INVERSE,
  PLL_PRECURSOR,
  PLL_PRECURSOR_INVERSE,
  analyzeOllInsertion,
  applyAlgorithm,
  applyMoves,
  cornerAt,
  edgeAt,
  f2lSlotStatuses,
  findCorner,
  findEdge,
  invertState,
  isF2lSlotSolved,
  isF2lSolved,
  isFixedOllPreInsertionState,
  isIdentical,
  isLastLayerInU,
  isOllState,
  isPllState,
  isSolved,
  isStandardFrame,
  loadCube3Model,
  uFaceNonUCount,
  validateCube3State,
  type Cube3Model,
  type Cube3State,
} from './cube3'
import { composeAlgorithms, invertAlgorithm } from './notation'

let model: Cube3Model

beforeAll(async () => {
  model = await loadCube3Model()
})

function solved(): Cube3State {
  return model.solved
}

describe('training cube3 model', () => {
  it('loads the verified cubing.js 3x3x3 state and solved invariants', () => {
    expect(model.kpuzzle.definition.name).toBe('3x3x3')
    expect(isSolved(solved())).toBe(true)
    expect(isStandardFrame(solved())).toBe(true)
    expect(isF2lSolved(solved())).toBe(true)
    expect(isLastLayerInU(solved())).toBe(true)
    expect(isOllState(solved())).toBe(true)
    expect(isPllState(solved())).toBe(true)
    expect(uFaceNonUCount(solved())).toBe(0)
    expect(f2lSlotStatuses(solved()).map((slot) => slot.solved)).toEqual([
      true,
      true,
      true,
      true,
    ])
  })

  it('reproduces the verified fixed FR pre-insertion state for I⁻¹', () => {
    const preState = applyAlgorithm(solved(), OLL_INSERTION_INVERSE)

    expect(findCorner(preState, 'DFR')).toMatchObject({
      position: 'UFR',
      orientation: 2,
      solved: false,
    })
    expect(findEdge(preState, 'FR')).toMatchObject({
      position: 'UR',
      orientation: 0,
      solved: false,
    })
    expect(f2lSlotStatuses(preState).map((slot) => slot.solved)).toEqual([
      false,
      true,
      true,
      true,
    ])
    expect(isFixedOllPreInsertionState(preState)).toBe(true)
    expect(isF2lSolved(preState)).toBe(false)
    expect(isF2lSlotSolved(preState, 'FR')).toBe(false)
    expect(isF2lSlotSolved(preState, 'FL')).toBe(true)
    expect(isF2lSlotSolved(preState, 'BL')).toBe(true)
    expect(isF2lSlotSolved(preState, 'BR')).toBe(true)
    expect(isLastLayerInU(preState)).toBe(false)
    expect(isIdentical(applyAlgorithm(preState, OLL_INSERTION), solved())).toBe(
      true,
    )
  })

  it('inverts moves, algorithms and full states consistently', () => {
    for (const algorithm of [
      'R',
      "U R U' R'",
      "R U R' U R U2 R'",
      "Rw U' M2 x' S",
      "R2 U2 F2 D' L",
    ]) {
      const state = applyAlgorithm(solved(), algorithm)
      expect(
        isIdentical(
          applyAlgorithm(state, invertAlgorithm(algorithm)),
          solved(),
        ),
        algorithm,
      ).toBe(true)
      expect(
        isIdentical(
          invertState(state),
          applyAlgorithm(solved(), invertAlgorithm(algorithm)),
        ),
        algorithm,
      ).toBe(true)
    }
  })

  it('applies move sequences and composed algorithms in execution order', () => {
    const moves = applyMoves(solved(), ['R', 'U', "R'", "U'"])
    expect(isIdentical(moves, applyAlgorithm(solved(), "R U R' U'"))).toBe(
      true,
    )

    const composed = composeAlgorithms('R U', "R' U'")
    expect(
      isIdentical(
        applyAlgorithm(solved(), composed),
        applyAlgorithm(applyAlgorithm(solved(), 'R U'), "R' U'"),
      ),
    ).toBe(true)
  })

  it('reports the verified Sune OLL insertion return and concise pre-state', () => {
    const suneOll = applyAlgorithm(solved(), PLL_PRECURSOR_INVERSE)
    const analysis = analyzeOllInsertion(suneOll)

    expect(analysis.targetIsOllState).toBe(true)
    expect(analysis.targetF2lSolved).toBe(true)
    expect(analysis.preStateIsFixed).toBe(true)
    expect(analysis.insertionReturnsTarget).toBe(true)
    expect(analysis.ok).toBe(true)
    expect(
      isIdentical(
        analysis.preState,
        applyAlgorithm(solved(), "R U2 R' U2"),
      ),
    ).toBe(true)
  })

  it('rejects incorrect OLL insertions and setups', () => {
    const suneOll = applyAlgorithm(solved(), PLL_PRECURSOR_INVERSE)

    const missingMove = analyzeOllInsertion(suneOll, "U R U' R")
    expect(missingMove.prescribed).toBe(false)
    expect(missingMove.preStateIsFixed).toBe(false)
    expect(missingMove.ok).toBe(false)

    const inverseInsertion = analyzeOllInsertion(
      suneOll,
      OLL_INSERTION_INVERSE,
    )
    expect(inverseInsertion.preStateIsFixed).toBe(false)
    expect(inverseInsertion.ok).toBe(false)

    expect(isFixedOllPreInsertionState(solved())).toBe(false)
    expect(
      isFixedOllPreInsertionState(applyAlgorithm(solved(), 'R')),
    ).toBe(false)
    expect(analyzeOllInsertion(applyAlgorithm(solved(), "R U R'")).ok).toBe(
      false,
    )
  })

  it('validates the fixed piece mapping and standard frame', () => {
    expect(cornerAt(solved(), 'UFR')).toMatchObject({
      piece: 'UFR',
      orientation: 0,
      solved: true,
    })
    expect(edgeAt(solved(), 'FR')).toMatchObject({
      piece: 'FR',
      orientation: 0,
      solved: true,
    })
    expect(isStandardFrame(applyAlgorithm(solved(), 'y'))).toBe(false)
  })

  it('contains the confirmed precursor constants', () => {
    expect(OLL_INSERTION).toBe("U R U' R'")
    expect(invertAlgorithm(OLL_INSERTION)).toBe(OLL_INSERTION_INVERSE)
    expect(PLL_PRECURSOR).toBe("R U R' U R U2 R'")
    expect(invertAlgorithm(PLL_PRECURSOR)).toBe(PLL_PRECURSOR_INVERSE)
  })

  it('rejects malformed cubie data and malformed patterns', () => {
    expect(() =>
      model.createState({
        cornerPieces: [0, 0, 2, 3, 4, 5, 6, 7],
        cornerOrientations: new Array(8).fill(0),
        edgePieces: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
        edgeOrientations: new Array(12).fill(0),
      }),
    ).toThrow(/duplicate/i)

    expect(() =>
      model.createState({
        cornerPieces: [0, 1, 2, 3, 4, 5, 6, 7],
        cornerOrientations: [1, 0, 0, 0, 0, 0, 0, 0],
        edgePieces: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
        edgeOrientations: new Array(12).fill(0),
      }),
    ).toThrow(/corner-orientation sum/i)

    expect(() =>
      model.createState({
        cornerPieces: [1, 0, 2, 3, 4, 5, 6, 7],
        cornerOrientations: new Array(8).fill(0),
        edgePieces: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
        edgeOrientations: new Array(12).fill(0),
      }),
    ).toThrow(/parity/i)

    const malformed = structuredClone(solved().patternData)
    malformed.CORNERS = {
      pieces: [0, 0, 2, 3, 4, 5, 6, 7],
      orientation: new Array(8).fill(0),
    }
    expect(() =>
      validateCube3State(new KPattern(model.kpuzzle, malformed)),
    ).toThrow(/duplicate/i)
  })

  it('matches cubing.js for deterministic randomized move sequences', () => {
    let seed = 0x5eed1234
    const next = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return seed / 0x100000000
    }
    const tokens = [
      'U',
      "U'",
      'U2',
      'D',
      "D'",
      'L',
      'L2',
      'R',
      "R'",
      'R2',
      'F',
      "F'",
      'B',
      'B2',
      'u',
      "r'",
      'M',
      'M2',
      "E'",
      'S',
      'x',
      "x'",
      'y2',
      "z'",
    ]

    for (let sample = 0; sample < 50; sample += 1) {
      const length = 1 + Math.floor(next() * 20)
      const moves: string[] = []
      for (let index = 0; index < length; index += 1) {
        moves.push(tokens[Math.floor(next() * tokens.length)]!)
      }
      const algorithm = moves.join(' ')
      const direct = solved().applyAlg(algorithm)
      const parsed = applyAlgorithm(solved(), algorithm)
      expect(isIdentical(parsed, direct), algorithm).toBe(true)
      expect(
        isIdentical(
          applyAlgorithm(parsed, invertAlgorithm(algorithm)),
          solved(),
        ),
        algorithm,
      ).toBe(true)
    }
  })

  it('is deterministic across repeated applications', () => {
    const algorithm = "R U R' U R U2 R' M2 x'"
    const first = applyAlgorithm(solved(), algorithm)
    const second = applyAlgorithm(solved(), algorithm)
    expect(isIdentical(first, second)).toBe(true)
    expect(isIdentical(invertState(first), invertState(second))).toBe(true)
  })
})
