// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import {
  applyAlgorithm,
  loadCube3Model,
  type Cube3Model,
} from '../cube3'
import { buildCaseRepresentativeState } from '../caseState'
import {
  OLL_STANDARD_CASES,
  PLL_NAMED_CASES,
  STANDARD_CASES,
  OLL_STANDARD_CASE_BY_ID,
  PLL_NAMED_CASE_BY_ID,
  parseOllSignature,
} from '../catalog/standardCases'
import {
  BACK_STRIP_POSITIONS,
  FACE_COLORS,
  TOP_FACE_POSITIONS,
  fullFacelets,
  lastLayerFacelets,
  validateLastLayerFacelets,
  type FaceColor,
} from './facelets'
import {
  U_LAYER_CORNER_POSITIONS,
  U_LAYER_EDGE_POSITIONS,
  lastLayerPermutationArrows,
  lastLayerPermutationCycles,
  type PermutationArrow,
} from './arrows'
import {
  assertDiagramSpecMatchesCase,
  buildDiagramSpec,
  validateDiagramSpec,
  type DiagramSpec,
} from './buildDiagramSpec'
import { stickerCubies, type Sticker } from '../audit/stickerCube'

let model: Cube3Model

beforeAll(async () => {
  model = await loadCube3Model()
})

type MutableDiagramSpec = {
  -readonly [K in keyof DiagramSpec]: DiagramSpec[K]
} & {
  facelets: {
    top: FaceColor[][]
    back: FaceColor[]
    front: FaceColor[]
    left: FaceColor[]
    right: FaceColor[]
  }
  arrows: PermutationArrow[]
}

function mutableSpec(spec: DiagramSpec): MutableDiagramSpec {
  return structuredClone(spec) as unknown as MutableDiagramSpec
}

const OLL_TOP_INDEX: Readonly<Record<string, number>> = {
  UFR: 0,
  UBR: 1,
  UBL: 2,
  UFL: 3,
}

const OLL_EDGE_INDEX: Readonly<Record<string, number>> = {
  UF: 0,
  UR: 1,
  UB: 2,
  UL: 3,
}

function expectedOllTopMask(signature: string): readonly boolean[] {
  const { cornerOrientations, edgeOrientations } = parseOllSignature(signature)
  return TOP_FACE_POSITIONS.flat().map((position) => {
    if (position === 'U') return true
    const corner = OLL_TOP_INDEX[position]
    if (corner !== undefined) return cornerOrientations[corner] === 0
    const edge = OLL_EDGE_INDEX[position]
    if (edge !== undefined) return edgeOrientations[edge] === 0
    throw new Error(`Unexpected top position ${position}.`)
  })
}

function allDisplayColors(spec: ReturnType<typeof buildDiagramSpec>): FaceColor[] {
  return [
    ...spec.facelets.top.flat(),
    ...spec.facelets.back,
    ...spec.facelets.front,
    ...spec.facelets.left,
    ...spec.facelets.right,
  ]
}

describe('last-layer facelets', () => {
  it('derives 54 unique facelets that round-trip through the independent audit model', () => {
    for (const definition of STANDARD_CASES) {
      const state = buildCaseRepresentativeState(model, definition)
      const facelets = fullFacelets(state)
      expect(facelets, definition.id).toHaveLength(54)
      expect(
        new Set(
          facelets.map(
            (facelet) => `${facelet.position.join(',')}:${facelet.normal.join(',')}`,
          ),
        ).size,
        definition.id,
      ).toBe(54)

      const auditState: Sticker[] = facelets.map((facelet) => ({
        home: `${facelet.position.join(',')}:${facelet.normal.join(',')}`,
        color: facelet.color,
        p: facelet.position,
        n: facelet.normal,
      }))
      const cubies = stickerCubies(auditState)
      expect(cubies.CORNERS.pieces, `${definition.id} corner pieces`).toEqual([
        ...state.patternData.CORNERS!.pieces,
      ])
      expect(
        cubies.CORNERS.orientation,
        `${definition.id} corner orientation`,
      ).toEqual([...state.patternData.CORNERS!.orientation])
      expect(cubies.EDGES.pieces, `${definition.id} edge pieces`).toEqual([
        ...state.patternData.EDGES!.pieces,
      ])
      expect(
        cubies.EDGES.orientation,
        `${definition.id} edge orientation`,
      ).toEqual([...state.patternData.EDGES!.orientation])
    }
  })

  it('places the back strip left-to-right as UBL, UB, UBR', () => {
    expect(BACK_STRIP_POSITIONS).toEqual(['UBL', 'UB', 'UBR'])
  })

  it('shows exactly nine U stickers for every OLL orientation', () => {
    for (const definition of OLL_STANDARD_CASES) {
      const state = buildCaseRepresentativeState(model, definition)
      const facelets = lastLayerFacelets(state)
      const { cornerOrientations, edgeOrientations } = parseOllSignature(
        definition.canonicalSignature,
      )
      const sideUCount =
        [...facelets.back, ...facelets.front, ...facelets.left, ...facelets.right].filter(
          (color) => color === 'U',
        ).length
      const expectedSideUCount =
        cornerOrientations.filter((value) => value !== 0).length +
        edgeOrientations.filter((value) => value !== 0).length
      expect(sideUCount, definition.id).toBe(expectedSideUCount)

      const topMask = facelets.top.flat().map((color) => color === 'U')
      expect(topMask, definition.id).toEqual(
        expectedOllTopMask(definition.canonicalSignature),
      )
      expect(
        allDisplayColors({
          ...buildDiagramSpec(model, definition),
          facelets,
        }).filter((color) => color === 'U'),
        definition.id,
      ).toHaveLength(9)
    }
  })

  it('shows a fully oriented, correctly coloured last layer for PLL', () => {
    for (const definition of PLL_NAMED_CASES) {
      const state = buildCaseRepresentativeState(model, definition)
      const facelets = lastLayerFacelets(state)
      expect(facelets.top.flat().every((color) => color === 'U')).toBe(true)
      const sides = [
        ...facelets.back,
        ...facelets.front,
        ...facelets.left,
        ...facelets.right,
      ]
      expect(sides.every((color) => color !== 'U')).toBe(true)
      expect(sides.some((color) => color === 'F')).toBe(true)
      expect(sides.some((color) => color === 'R')).toBe(true)
      expect(sides.some((color) => color === 'B')).toBe(true)
      expect(sides.some((color) => color === 'L')).toBe(true)
    }
  })

  it('rejects an invalid facelet colour', () => {
    const facelets = lastLayerFacelets(
      buildCaseRepresentativeState(
        model,
        OLL_STANDARD_CASE_BY_ID.get('oll:1')!,
      ),
    )
    expect(() =>
      validateLastLayerFacelets({
        ...facelets,
        top: [['X' as FaceColor, 'U', 'U'], ...facelets.top.slice(1)],
      }),
    ).toThrow()
  })

  it('rejects a state with a non-U last layer', () => {
    const state = applyAlgorithm(model.solved, 'R')
    expect(() => fullFacelets(state)).toThrow()
  })
})

describe('PLL permutation arrows', () => {
  it('maps every moving piece exactly once and omits fixed pieces', () => {
    for (const definition of PLL_NAMED_CASES) {
      const state = buildCaseRepresentativeState(model, definition)
      const arrows = lastLayerPermutationArrows(state)
      const cornerPieces = state.patternData.CORNERS!.pieces.slice(0, 4)
      const edgePieces = state.patternData.EDGES!.pieces.slice(0, 4)

      const expected = [
        ...cornerPieces
          .map((piece, position) =>
            piece === position
              ? null
              : {
                  kind: 'corner' as const,
                  piece: U_LAYER_CORNER_POSITIONS[piece]!,
                  from: U_LAYER_CORNER_POSITIONS[position]!,
                  to: U_LAYER_CORNER_POSITIONS[piece]!,
                },
          )
          .filter((item) => item !== null),
        ...edgePieces
          .map((piece, position) =>
            piece === position
              ? null
              : {
                  kind: 'edge' as const,
                  piece: U_LAYER_EDGE_POSITIONS[piece]!,
                  from: U_LAYER_EDGE_POSITIONS[position]!,
                  to: U_LAYER_EDGE_POSITIONS[piece]!,
                },
          )
          .filter((item) => item !== null),
      ]
      expect(arrows, definition.id).toEqual(expected)
      expect(
        new Set(arrows.map((arrow) => `${arrow.kind}:${arrow.from}`)).size,
        definition.id,
      ).toBe(arrows.length)
      for (const arrow of arrows) {
        expect(arrow.from).not.toBe(arrow.to)
        expect(arrow.piece).toBe(arrow.to)
      }
    }
  })

  it('decomposes cycles deterministically', () => {
    const state = buildCaseRepresentativeState(
      model,
      PLL_NAMED_CASE_BY_ID.get('pll:t')!,
    )
    const cycles = lastLayerPermutationCycles(
      lastLayerPermutationArrows(state),
    )
    expect(cycles).toEqual([
      { kind: 'corner', positions: ['UFR', 'UBR'] },
      { kind: 'edge', positions: ['UR', 'UL'] },
    ])
  })

  it('rejects a non-PLL state', () => {
    expect(() =>
      lastLayerPermutationArrows(applyAlgorithm(model.solved, 'R')),
    ).toThrow()
  })
})

describe('diagram specifications', () => {
  it('builds and re-verifies all 78 cases', () => {
    for (const definition of STANDARD_CASES) {
      const spec = buildDiagramSpec(model, definition)
      expect(spec.caseId).toBe(definition.id)
      expect(spec.kind).toBe(
        definition.kind === 'oll-orientation' ? 'oll' : 'pll',
      )
      expect(spec.asset).toBe(definition.diagramAsset)
      expect(spec.signature).toBe(definition.canonicalSignature)
      expect(spec.representativeSignature).toBe(
        definition.representativeSignature,
      )
      expect(spec.title).toContain(definition.name)
      expect(spec.description).toContain(definition.canonicalSignature)
      expect(spec.description).toContain('compact 3×3')
      expect(spec.arrows.length === 0).toBe(spec.kind === 'oll')
      if (spec.kind === 'pll') {
        expect(spec.facelets.top.flat().every((color) => color === 'U')).toBe(
          true,
        )
        expect(spec.arrows.length).toBeGreaterThan(0)
      }
      assertDiagramSpecMatchesCase(spec, model, definition)
    }
  })

  it('covers the requested OLL 45, 56 and 57 previews explicitly', () => {
    for (const [id, signature] of [
      ['oll:45', '0012|1010'],
      ['oll:56', '1212|1010'],
      ['oll:57', '0000|0101'],
    ] as const) {
      const definition = OLL_STANDARD_CASE_BY_ID.get(id)!
      const spec = buildDiagramSpec(model, definition)
      expect(spec.signature).toBe(signature)
      expect(spec.arrows).toEqual([])
      expect(allDisplayColors(spec).filter((color) => color === 'U')).toHaveLength(
        9,
      )
    }
  })

  it('shows conventional T-permutation arrows', () => {
    const spec = buildDiagramSpec(
      model,
      PLL_NAMED_CASE_BY_ID.get('pll:t')!,
    )
    expect(spec.arrows).toEqual([
      { kind: 'corner', piece: 'UBR', from: 'UFR', to: 'UBR' },
      { kind: 'corner', piece: 'UFR', from: 'UBR', to: 'UFR' },
      { kind: 'edge', piece: 'UL', from: 'UR', to: 'UL' },
      { kind: 'edge', piece: 'UR', from: 'UL', to: 'UR' },
    ])
  })

  it('rejects tampered stickers, arrows, signatures and kinds', () => {
    const definition = OLL_STANDARD_CASE_BY_ID.get('oll:56')!
    const spec = buildDiagramSpec(model, definition)
    const wrongSticker = mutableSpec(spec)
    wrongSticker.facelets.top[0]![0] = 'D'
    expect(() =>
      assertDiagramSpecMatchesCase(wrongSticker, model, definition),
    ).toThrow()

    const wrongSignature = mutableSpec(spec)
    wrongSignature.signature = '0000|0000'
    expect(() =>
      assertDiagramSpecMatchesCase(wrongSignature, model, definition),
    ).toThrow()

    const arrowOnOll = mutableSpec(spec)
    arrowOnOll.arrows.push({
      kind: 'corner',
      piece: 'UBR',
      from: 'UFR',
      to: 'UBR',
    })
    expect(() => validateDiagramSpec(arrowOnOll)).toThrow()

    const pllDefinition = PLL_NAMED_CASE_BY_ID.get('pll:t')!
    const pllSpec = buildDiagramSpec(model, pllDefinition)
    const wrongArrow = mutableSpec(pllSpec)
    wrongArrow.arrows[0] = {
      ...wrongArrow.arrows[0]!,
      to: 'UBL',
      piece: 'UBL',
    }
    expect(() =>
      assertDiagramSpecMatchesCase(wrongArrow, model, pllDefinition),
    ).toThrow()

    const duplicateArrow = mutableSpec(pllSpec)
    duplicateArrow.arrows.push({ ...duplicateArrow.arrows[0]! })
    expect(() => validateDiagramSpec(duplicateArrow)).toThrow()

    const noArrows = mutableSpec(pllSpec)
    noArrows.arrows = []
    expect(() => validateDiagramSpec(noArrows)).toThrow()

    const nonOriented = mutableSpec(pllSpec)
    nonOriented.facelets.top[0]![0] = 'F'
    expect(() => validateDiagramSpec(nonOriented)).toThrow()

    const sideU = mutableSpec(pllSpec)
    sideU.facelets.front[0] = 'U'
    expect(() => validateDiagramSpec(sideU)).toThrow()
  })

  it('exposes only the fixed face-colour vocabulary', () => {
    expect(FACE_COLORS).toEqual(['U', 'D', 'F', 'B', 'R', 'L'])
  })
})
