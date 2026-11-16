// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import {
  AUF_ALGS,
  applyAuf,
  loadCube3Model,
  type Cube3Model,
} from '../cube3'
import {
  canonicalOllSignature,
  OLL_SKIP_ORIENTATION_SIGNATURE,
  pllPermutationSignature,
} from '../caseSignature'
import {
  buildCaseRepresentativeState,
  identifyCaseState,
} from '../caseState'
import { enumerateOllOrientationStates, enumeratePllPermutationStates } from '../caseSpace'
import {
  identifyPllCase,
  pllDoubleCosetSignature,
} from '../pllIdentity'
import {
  PLL_CASE_BY_ID,
  PLL_NON_SKIP_CASE_IDS,
  PLL_SET_ID,
  type PllCaseId,
} from './pllCases'
import {
  OLL_STANDARD_CASES,
  PLL_NAMED_CASES,
  STANDARD_CASES,
  STANDARD_CASE_COUNT,
  STANDARD_VIEWING_ORIENTATION,
  OLL_SIGNATURE_ANCHORS,
  PLL_DIAGRAM_REPRESENTATIVES,
  assertValidStandardCaseTable,
  validateStandardCaseTable,
  type PllDiagramShape,
  type StandardCaseDefinition,
} from './standardCases'
import { buildDiagramSpec } from '../diagrams/buildDiagramSpec'
import { validateCatalog, assertValidCatalog } from './validation'
import { assertValidCatalogStates, validateCatalogStates } from './stateValidation'
import type { TrainingCatalog } from './types'
import { OLL_SET_ID } from './ollCases'

let model: Cube3Model

beforeAll(async () => {
  model = await loadCube3Model()
})

const PLL_NAMES = [
  'Aa',
  'Ab',
  'E',
  'F',
  'Ga',
  'Gb',
  'Gc',
  'Gd',
  'H',
  'Ja',
  'Jb',
  'Na',
  'Nb',
  'Ra',
  'Rb',
  'T',
  'Ua',
  'Ub',
  'V',
  'Y',
  'Z',
]

const SHAPE_EXPECTATIONS: Readonly<
  Record<PllDiagramShape, { corners: string; edges: string }>
> = {
  'edge-3-cycle': { corners: '1,1,1,1', edges: '1,3' },
  'edge-two-swaps': { corners: '1,1,1,1', edges: '2,2' },
  'corner-3-cycle': { corners: '1,3', edges: '1,1,1,1' },
  'corner-two-swaps': { corners: '2,2', edges: '1,1,1,1' },
  'two-plus-two': { corners: '1,1,2', edges: '1,1,2' },
  'three-plus-three': { corners: '1,3', edges: '1,3' },
}

function cycleLengths(permutation: readonly number[]): string {
  const visited = new Set<number>()
  const lengths: number[] = []
  for (let start = 0; start < permutation.length; start += 1) {
    if (visited.has(start)) continue
    let length = 0
    let current = start
    while (!visited.has(current)) {
      visited.add(current)
      current = permutation[current]!
      length += 1
    }
    lengths.push(length)
  }
  return lengths.sort((a, b) => a - b).join(',')
}

function replaceCase(
  id: string,
  patch: Partial<StandardCaseDefinition>,
): readonly StandardCaseDefinition[] {
  return STANDARD_CASES.map((definition) =>
    definition.id === id ? { ...definition, ...patch } : definition,
  )
}

describe('complete standard case table', () => {
  it('has 57 OLL + 21 PLL unique, identity-only cases with diagram assets', () => {
    expect(OLL_STANDARD_CASES).toHaveLength(57)
    expect(PLL_NAMED_CASES).toHaveLength(21)
    expect(STANDARD_CASES).toHaveLength(STANDARD_CASE_COUNT)
    expect(STANDARD_CASE_COUNT).toBe(78)
    expect(validateStandardCaseTable()).toEqual([])
    expect(() => assertValidStandardCaseTable()).not.toThrow()

    expect(
      OLL_STANDARD_CASES.map((definition) => Number(definition.id.slice(4))),
    ).toEqual(Array.from({ length: 57 }, (_, index) => index + 1))
    expect(PLL_NAMED_CASES.map((definition) => definition.name)).toEqual(
      PLL_NAMES,
    )
    expect(PLL_NAMED_CASES.map((definition) => definition.id)).toEqual(
      PLL_NON_SKIP_CASE_IDS,
    )

    expect(new Set(STANDARD_CASES.map((definition) => definition.id)).size).toBe(
      78,
    )
    expect(
      new Set(STANDARD_CASES.map((definition) => definition.canonicalSignature))
        .size,
    ).toBe(78)
    expect(
      new Set(
        STANDARD_CASES.map((definition) => definition.representativeSignature),
      ).size,
    ).toBe(78)
    expect(
      new Set(STANDARD_CASES.map((definition) => definition.diagramAsset)).size,
    ).toBe(78)

    for (const definition of STANDARD_CASES) {
      expect(definition.viewingOrientation).toBe(STANDARD_VIEWING_ORIENTATION)
      expect(definition.isSkip).toBe(false)
      expect(definition.selectable).toBe(true)
      expect(definition.defaultAlgorithmId).toBeUndefined()
      expect(definition.generatorAlgorithmId).toBeUndefined()
      expect(definition.alternativeAlgorithmIds).toEqual([])
      expect(definition.diagramAsset).toMatch(
        /^training\/diagrams\/(oll|pll)\/[a-z0-9-]+\.svg$/,
      )
    }

    for (const definition of OLL_STANDARD_CASES) {
      expect(definition.auf.equivalence).toBe('oll-orientation-up-to-auf')
      expect(definition.representativeSignature).toBe(
        definition.canonicalSignature,
      )
      expect(definition.diagramShape).toBeUndefined()
    }
    for (const definition of PLL_NAMED_CASES) {
      expect(definition.auf).toEqual({
        preAuf: true,
        postAuf: true,
        equivalence: 'pll-pre-and-post-auf',
      })
      expect(definition.representativeSignature).toBe(
        PLL_DIAGRAM_REPRESENTATIVES[
          definition.id as keyof typeof PLL_DIAGRAM_REPRESENTATIVES
        ].signature,
      )
      expect(definition.diagramShape).toBe(
        PLL_DIAGRAM_REPRESENTATIVES[
          definition.id as keyof typeof PLL_DIAGRAM_REPRESENTATIVES
        ].shape,
      )
    }
  })

  it('pins the corrected OLL anchors, including OLL 56', () => {
    expect(OLL_SIGNATURE_ANCHORS[45]).toBe('0012|1010')
    expect(OLL_SIGNATURE_ANCHORS[56]).toBe('1212|1010')
    expect(OLL_SIGNATURE_ANCHORS[57]).toBe('0000|0101')
    expect(
      OLL_STANDARD_CASES.find((definition) => definition.id === 'oll:45')!
        .canonicalSignature,
    ).toBe('0012|1010')
    expect(
      OLL_STANDARD_CASES.find((definition) => definition.id === 'oll:56')!
        .canonicalSignature,
    ).toBe('1212|1010')
    expect(
      OLL_STANDARD_CASES.find((definition) => definition.id === 'oll:57')!
        .canonicalSignature,
    ).toBe('0000|0101')
  })

  it('covers exactly the 57 non-skip OLL orientation classes', () => {
    const classes = new Set(
      enumerateOllOrientationStates(model).map((state) =>
        canonicalOllSignature(state),
      ),
    )
    expect(classes.size).toBe(58)
    expect(classes.has(OLL_SKIP_ORIENTATION_SIGNATURE)).toBe(true)

    const table = new Set(
      OLL_STANDARD_CASES.map((definition) => definition.canonicalSignature),
    )
    expect(table.size).toBe(57)
    expect(
      [...classes]
        .filter((signature) => signature !== OLL_SKIP_ORIENTATION_SIGNATURE)
        .sort(),
    ).toEqual([...table].sort())
  })

  it('builds and re-identifies every OLL representative under all AUFs', () => {
    for (const definition of OLL_STANDARD_CASES) {
      const state = buildCaseRepresentativeState(model, definition)
      expect(identifyCaseState(state, 'oll-orientation').canonicalSignature).toBe(
        definition.canonicalSignature,
      )
      for (const auf of AUF_ALGS) {
        expect(canonicalOllSignature(applyAuf(state, auf))).toBe(
          definition.canonicalSignature,
        )
      }
    }
  })

  it('builds every conventional PLL representative and preserves its named identity', () => {
    for (const definition of PLL_NAMED_CASES) {
      const state = buildCaseRepresentativeState(model, definition)
      expect(identifyPllCase(state)).toBe(definition.id)
      expect(identifyCaseState(state, 'pll-permutation').namedCaseId).toBe(
        definition.id,
      )
      expect(pllDoubleCosetSignature(state)).toBe(
        definition.canonicalSignature,
      )
      expect(pllPermutationSignature(state)).toBe(
        definition.representativeSignature,
      )
      expect(PLL_CASE_BY_ID.get(definition.id as PllCaseId)?.canonicalSignature).toBe(
        definition.canonicalSignature,
      )
      for (const pre of AUF_ALGS) {
        for (const post of AUF_ALGS) {
          const variant = applyAuf(applyAuf(state, pre), post)
          expect(identifyPllCase(variant)).toBe(definition.id)
        }
      }
    }
  })

  it('uses conventional PLL cycle structure for every diagram representative', () => {
    const shapeCounts = new Map<PllDiagramShape, number>()
    for (const definition of PLL_NAMED_CASES) {
      const shape = definition.diagramShape!
      shapeCounts.set(shape, (shapeCounts.get(shape) ?? 0) + 1)
      const state = buildCaseRepresentativeState(model, definition)
      const corners = state.patternData.CORNERS!.pieces.slice(0, 4)
      const edges = state.patternData.EDGES!.pieces.slice(0, 4)
      const expected = SHAPE_EXPECTATIONS[shape]
      expect(cycleLengths(corners), `${definition.name} corners`).toBe(
        expected.corners,
      )
      expect(cycleLengths(edges), `${definition.name} edges`).toBe(
        expected.edges,
      )
    }
    expect(Object.fromEntries(shapeCounts)).toEqual({
      'corner-3-cycle': 2,
      'corner-two-swaps': 1,
      'edge-3-cycle': 2,
      'edge-two-swaps': 2,
      'three-plus-three': 4,
      'two-plus-two': 10,
    })
  })

  it('keeps the PLL case space at 22 named classes including skip', () => {
    const classes = new Set(
      enumeratePllPermutationStates(model).map((state) =>
        identifyPllCase(state),
      ),
    )
    expect(classes.size).toBe(22)
    for (const id of PLL_NON_SKIP_CASE_IDS) {
      expect(classes.has(id)).toBe(true)
    }
  })

  it('passes the Phase 2B catalog and state validators as identity-only content', () => {
    const catalog: TrainingCatalog = {
      version: '2c-identity-preview',
      contentStatus: 'identity-only',
      sets: [
        {
          id: OLL_SET_ID,
          name: 'OLL',
          standardCaseCount: 57,
          includesSkipIdentity: true,
        },
        {
          id: PLL_SET_ID,
          name: 'PLL',
          standardCaseCount: 21,
          includesSkipIdentity: true,
        },
      ],
      cases: STANDARD_CASES,
      algorithms: [],
    }
    expect(validateCatalog(catalog)).toEqual([])
    expect(validateCatalogStates(catalog, { model })).toEqual([])
    expect(() => assertValidCatalog(catalog)).not.toThrow()
    expect(() => assertValidCatalogStates(catalog, { model })).not.toThrow()
  })
})

describe('standard case table rejects malformed content', () => {
  it('rejects a wrong OLL 56 signature', () => {
    const bad = replaceCase('oll:56', {
      canonicalSignature: '1212|0110',
      representativeSignature: '1212|0110',
    })
    const codes = validateStandardCaseTable(bad).map((issue) => issue.code)
    expect(codes).toContain('case-oll-anchor')
    expect(() => assertValidStandardCaseTable(bad)).toThrow()
  })

  it('rejects malformed OLL signatures', () => {
    const bad = replaceCase('oll:1', {
      canonicalSignature: '9999|1111',
      representativeSignature: '9999|1111',
    })
    expect(
      validateStandardCaseTable(bad).map((issue) => issue.code),
    ).toContain('case-oll-signature')
  })

  it('rejects duplicate signatures, assets, and representatives', () => {
    const duplicateSignature = replaceCase('oll:2', {
      canonicalSignature:
        OLL_STANDARD_CASES.find((definition) => definition.id === 'oll:1')!
          .canonicalSignature,
      representativeSignature:
        OLL_STANDARD_CASES.find((definition) => definition.id === 'oll:1')!
          .canonicalSignature,
    })
    expect(
      validateStandardCaseTable(duplicateSignature).map((issue) => issue.code),
    ).toContain('case-signature-duplicate')

    const duplicateAsset = replaceCase('oll:2', {
      diagramAsset:
        OLL_STANDARD_CASES.find((definition) => definition.id === 'oll:1')!
          .diagramAsset,
    })
    expect(
      validateStandardCaseTable(duplicateAsset).map((issue) => issue.code),
    ).toContain('case-diagram-duplicate')

    const duplicateRepresentative = replaceCase('pll:t', {
      representativeSignature:
        PLL_DIAGRAM_REPRESENTATIVES['pll:f'].signature,
    })
    expect(
      validateStandardCaseTable(duplicateRepresentative).map(
        (issue) => issue.code,
      ),
    ).toContain('case-representative-duplicate')
  })

  it('rejects missing representatives and bundled algorithm IDs', () => {
    const missingRepresentative = replaceCase('oll:3', {
      representativeSignature: '',
    })
    expect(
      validateStandardCaseTable(missingRepresentative).map(
        (issue) => issue.code,
      ),
    ).toContain('case-representative-missing')

    const bundled = replaceCase('oll:3', {
      defaultAlgorithmId: 'third-party:algorithm',
    })
    expect(
      validateStandardCaseTable(bundled).map((issue) => issue.code),
    ).toContain('case-algorithm-content')
  })

  it('rejects a PLL diagram representative from the wrong named case', () => {
    const bad = replaceCase('pll:t', {
      representativeSignature:
        PLL_DIAGRAM_REPRESENTATIVES['pll:f'].signature,
    })
    expect(
      validateStandardCaseTable(bad).map((issue) => issue.code),
    ).toContain('case-pll-representative')
  })

  it('rejects a state that does not identify as the declared named PLL case', () => {
    const t = PLL_NAMED_CASES.find((definition) => definition.id === 'pll:t')!
    const bad: StandardCaseDefinition = {
      ...t,
      canonicalSignature: PLL_CASE_BY_ID.get('pll:f')!.canonicalSignature,
    }
    expect(() => buildDiagramSpec(model, bad)).toThrow()
  })

  it('rejects an OLL table whose number-to-signature anchor is wrong', () => {
    const bad = replaceCase('oll:56', {
      canonicalSignature: '1212|0110',
      representativeSignature: '1212|0110',
    })
    // The state itself is a valid OLL 54 state, so the pure structural table
    // validation is the layer that rejects the wrong numbered mapping.
    expect(validateStandardCaseTable(bad)).not.toEqual([])
  })
})
