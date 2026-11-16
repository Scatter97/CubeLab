// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest'
import {
  PLL_PRECURSOR,
  PLL_PRECURSOR_INVERSE,
  applyAlgorithm,
  invertState,
  loadCube3Model,
  type Cube3Model,
} from '../cube3'
import { canonicalOllSignature } from '../caseSignature'
import {
  createOllCaseDefinition,
  OLL_SET_ID,
  ollCaseId,
} from './ollCases'
import {
  PLL_CASE_BY_ID,
  PLL_CASES,
  PLL_SET_ID,
} from './pllCases'
import type {
  TrainingAlgorithmRecord,
  TrainingCaseDefinition,
  TrainingCatalog,
} from './types'
import {
  CatalogValidationError,
  assertValidCatalog,
  validateAlgorithmRevision,
  validateCatalog,
} from './validation'
import {
  assertValidCatalogStates,
  validateCatalogStates,
} from './stateValidation'
import {
  createAlgorithmRevision,
  trainingAlgorithmId,
} from '../algorithms'
import { normalizeCatalogAlgorithm } from '../notation'

let model: Cube3Model

beforeAll(async () => {
  model = await loadCube3Model()
})

function suneCase(
  overrides: Partial<TrainingCaseDefinition> = {},
): TrainingCaseDefinition {
  const state = applyAlgorithm(model.solved, PLL_PRECURSOR_INVERSE)
  return {
    ...createOllCaseDefinition({
      number: 27,
      canonicalSignature: canonicalOllSignature(state),
      name: 'Sune',
      groupId: 'cross-line',
    }),
    ...overrides,
  }
}

function suneAlgorithm(
  overrides: Partial<TrainingAlgorithmRecord> = {},
): TrainingAlgorithmRecord {
  const normalized = normalizeCatalogAlgorithm(PLL_PRECURSOR)
  return {
    id: trainingAlgorithmId('oll:27', 'sune-fixture'),
    version: 1,
    caseId: 'oll:27',
    setId: OLL_SET_ID,
    source: 'bundled',
    label: 'Sune',
    notation: PLL_PRECURSOR,
    normalizedNotation: normalized,
    immutable: true,
    provenance: {
      sourceKind: 'independently-authored',
      originalNotation: PLL_PRECURSOR,
      normalizedNotation: normalized,
      redistribution: 'not-applicable',
      redistributionNotes:
        'Test fixture authored for this repository; no third-party algorithm catalog content.',
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

function withFirstCase(
  value: TrainingCatalog,
  patch: Partial<TrainingCaseDefinition>,
): TrainingCatalog {
  return {
    ...value,
    cases: [
      { ...value.cases[0]!, ...patch },
      ...value.cases.slice(1),
    ],
  }
}

function catalog(
  overrides: Partial<TrainingCatalog> = {},
): TrainingCatalog {
  const definition = suneCase()
  return {
    version: '2b-test',
    contentStatus: 'partial',
    sets: [
      {
        id: OLL_SET_ID,
        name: 'OLL',
        standardCaseCount: 57,
        includesSkipIdentity: true,
      },
    ],
    cases: [
      {
        ...definition,
        defaultAlgorithmId: trainingAlgorithmId('oll:27', 'sune-fixture'),
        generatorAlgorithmId: trainingAlgorithmId(
          'oll:27',
          'sune-fixture',
        ),
      },
    ],
    algorithms: [suneAlgorithm()],
    ...overrides,
  }
}

describe('training catalog validation', () => {
  it('accepts a verified, redistribution-safe catalog', () => {
    const value = catalog()
    expect(validateCatalog(value)).toEqual([])
    expect(() => assertValidCatalog(value)).not.toThrow()
  })

  it('accepts the standard PLL identity-only catalog without algorithms', () => {
    const value: TrainingCatalog = {
      version: '2b-identity',
      contentStatus: 'identity-only',
      sets: [
        {
          id: PLL_SET_ID,
          name: 'PLL',
          standardCaseCount: 21,
          includesSkipIdentity: true,
        },
      ],
      cases: PLL_CASES,
      algorithms: [],
    }
    expect(validateCatalog(value)).toEqual([])
  })

  it('reports duplicate IDs and signatures', () => {
    const duplicateId = catalog({
      cases: [
        ...catalog().cases,
        { ...suneCase(), canonicalSignature: '0000|0000' },
      ],
    })
    expect(validateCatalog(duplicateId).map((issue) => issue.code)).toContain(
      'case-id-duplicate',
    )

    const duplicateSignature = catalog({
      cases: [
        ...catalog().cases,
        suneCase({ id: ollCaseId(28) }),
      ],
    })
    expect(
      validateCatalog(duplicateSignature).map((issue) => issue.code),
    ).toContain('case-signature-duplicate')
  })

  it('rejects a PLL case with another case signature', () => {
    const t = PLL_CASE_BY_ID.get('pll:t')!
    const ua = PLL_CASE_BY_ID.get('pll:ua')!
    const value: TrainingCatalog = {
      version: '2b-bad-pll',
      contentStatus: 'identity-only',
      sets: [
        {
          id: PLL_SET_ID,
          name: 'PLL',
          standardCaseCount: 21,
          includesSkipIdentity: true,
        },
      ],
      cases: [{ ...t, canonicalSignature: ua.canonicalSignature }],
      algorithms: [],
    }
    expect(validateCatalog(value).map((issue) => issue.code)).toContain(
      'case-pll-signature-mismatch',
    )
  })

  it('reports missing, mismatched, and unverified references', () => {
    const missing = withFirstCase(catalog(), {
      defaultAlgorithmId: 'missing',
    })
    expect(validateCatalog(missing).map((issue) => issue.code)).toContain(
      'case-algorithm-missing',
    )

    const secondCase = createOllCaseDefinition({
      number: 28,
      canonicalSignature: '0000|0000',
      name: 'OLL 28 fixture',
    })
    const secondAlgorithm = suneAlgorithm({
      id: trainingAlgorithmId('oll:28', 'fixture'),
      caseId: 'oll:28',
    })
    const mismatched = {
      ...catalog(),
      cases: [
        {
          ...catalog().cases[0]!,
          defaultAlgorithmId: secondAlgorithm.id,
        },
        secondCase,
      ],
      algorithms: [suneAlgorithm(), secondAlgorithm],
    }
    expect(
      validateCatalog(mismatched).map((issue) => issue.code),
    ).toContain('case-algorithm-case-mismatch')

    const unverified = catalog({
      algorithms: [
        suneAlgorithm({
          verification: {
            ...suneAlgorithm().verification,
            status: 'unverified',
          },
        }),
      ],
    })
    const codes = validateCatalog(unverified).map((issue) => issue.code)
    expect(codes).toContain('algorithm-bundled-unverified')
    expect(codes).toContain('case-default-unverified')
  })

  it('keeps user algorithms out of the bundled catalog', () => {
    const value = catalog({
      algorithms: [
        suneAlgorithm({
          source: 'user',
          immutable: false,
        }),
      ],
    })
    expect(validateCatalog(value).map((issue) => issue.code)).toContain(
      'algorithm-user-in-bundled-catalog',
    )
  })

  it('enforces the unresolved-redistribution gate', () => {
    const value = catalog({
      algorithms: [
        suneAlgorithm({
          provenance: {
            ...suneAlgorithm().provenance,
            redistribution: 'unresolved',
          },
        }),
      ],
    })
    expect(validateCatalog(value).map((issue) => issue.code)).toContain(
      'algorithm-redistribution-unresolved',
    )
  })

  it('reports alternative and generator integrity failures', () => {
    const value = withFirstCase(catalog(), {
      alternativeAlgorithmIds: ['missing'],
      generatorAlgorithmId: undefined,
    })
    const codes = validateCatalog(value).map((issue) => issue.code)
    expect(codes).toContain('case-algorithm-missing')
    expect(codes).not.toContain('case-generator-unverified')
  })

  it('validates correction provenance and original notation', () => {
    const approved = "F R U R' U' F'"
    const normalized = normalizeCatalogAlgorithm(approved)
    const correctedCase = createOllCaseDefinition({
      number: 45,
      canonicalSignature: canonicalOllSignature(
        invertState(applyAlgorithm(model.solved, approved)),
      ),
      name: 'OLL 45 fixture',
    })
    const correctedId = trainingAlgorithmId('oll:45', 'corrected')
    const value = catalog({
      algorithms: [
        suneAlgorithm({
          id: correctedId,
          caseId: 'oll:45',
          notation: approved,
          normalizedNotation: normalized,
          provenance: {
            sourceKind: 'owner-approved',
            sourceRepository: 'local-reference',
            originalNotation: "F(RUR'U')f'",
            normalizedNotation: normalized,
            correction: {
              originalNotation: "F(RUR'U')f'",
              approvedNotation: approved,
              approvedOn: '2026-11-08',
              reason: 'Trailing wide f was intended as F.',
            },
            approval: {
              approvedBy: 'owner',
              approvedOn: '2026-11-08',
            },
            redistribution: 'unresolved',
          },
        }),
      ],
      cases: [
        {
          ...correctedCase,
          defaultAlgorithmId: correctedId,
          generatorAlgorithmId: correctedId,
        },
      ],
    })
    const codes = validateCatalog(value).map((issue) => issue.code)
    expect(codes).not.toContain('algorithm-correction-metadata')
    expect(codes).toContain('algorithm-redistribution-unresolved')

    const missingReason = catalog({
      algorithms: [
        suneAlgorithm({
          provenance: {
            ...suneAlgorithm().provenance,
            correction: {
              originalNotation: 'old',
              approvedNotation: PLL_PRECURSOR,
              approvedOn: '2026-11-08',
              reason: '',
            },
          },
        }),
      ],
    })
    expect(
      validateCatalog(missingReason).map((issue) => issue.code),
    ).toContain('algorithm-correction-metadata')
  })

  it('reports missing complete-catalog content', () => {
    const value = withFirstCase(catalog({ contentStatus: 'complete' }), {
      defaultAlgorithmId: undefined,
      generatorAlgorithmId: undefined,
    })
    expect(validateCatalog(value).map((issue) => issue.code)).toContain(
      'case-complete-content-missing',
    )
  })

  it('allows future sets without changing standard IDs', () => {
    const t = PLL_CASE_BY_ID.get('pll:t')!
    const value: TrainingCatalog = {
      version: '2b-future',
      contentStatus: 'partial',
      sets: [
        {
          id: PLL_SET_ID,
          name: 'PLL',
          standardCaseCount: 21,
          includesSkipIdentity: true,
        },
        {
          id: 'future-set',
          name: 'Future Set',
          standardCaseCount: 1,
          includesSkipIdentity: false,
        },
      ],
      cases: [
        ...PLL_CASES,
        {
          ...t,
          id: 'future-set:one',
          setId: 'future-set',
          name: 'Future Case',
          groupId: 'future',
        },
      ],
      algorithms: [],
    }
    expect(validateCatalog(value)).toEqual([])
    expect(PLL_CASE_BY_ID.get('pll:t')!.id).toBe('pll:t')
    expect(PLL_CASE_BY_ID.get('pll:ua')!.id).toBe('pll:ua')
  })

  it('throws all reported issues through the assertion helper', () => {
    const value = catalog({
      cases: [suneCase(), suneCase()],
    })
    expect(() => assertValidCatalog(value)).toThrow(CatalogValidationError)
    try {
      assertValidCatalog(value)
    } catch (error) {
      expect(error).toBeInstanceOf(CatalogValidationError)
      expect(
        (error as CatalogValidationError).issues.length,
      ).toBeGreaterThan(0)
    }
  })
})

describe('catalog cube-state validation', () => {
  it('accepts the verified fixture catalog', () => {
    expect(validateCatalogStates(catalog(), { model })).toEqual([])
    expect(() =>
      assertValidCatalogStates(catalog(), { model }),
    ).not.toThrow()
  })

  it('reports non-canonical OLL signatures', () => {
    const nonCanonical = {
      ...suneCase(),
      canonicalSignature: '2220|0000',
    }
    const value: TrainingCatalog = {
      version: '2b-noncanonical',
      contentStatus: 'partial',
      sets: [
        {
          id: OLL_SET_ID,
          name: 'OLL',
          standardCaseCount: 57,
          includesSkipIdentity: true,
        },
      ],
      cases: [nonCanonical],
      algorithms: [],
    }
    expect(validateCatalog(value)).toEqual([])
    expect(
      validateCatalogStates(value, { model }).map((issue) => issue.code),
    ).toContain('case-state-invalid')
  })

  it('reports algorithms that fail cube-state verification despite metadata', () => {
    const value = catalog()
    const notation = "R U R'"
    const wrong = suneAlgorithm({
      notation,
      normalizedNotation: normalizeCatalogAlgorithm(notation),
      provenance: {
        ...suneAlgorithm().provenance,
        originalNotation: notation,
        normalizedNotation: normalizeCatalogAlgorithm(notation),
      },
    })
    const withWrong = {
      ...value,
      cases: [
        {
          ...value.cases[0]!,
          defaultAlgorithmId: wrong.id,
          generatorAlgorithmId: wrong.id,
        },
      ],
      algorithms: [wrong],
    }
    expect(
      validateCatalogStates(withWrong, { model }).map(
        (issue) => issue.code,
      ),
    ).toContain('algorithm-state-invalid')
    expect(() =>
      assertValidCatalogStates(withWrong, { model }),
    ).toThrow(CatalogValidationError)
  })
})

describe('algorithm revision invariants', () => {
  const previous = suneAlgorithm()

  it('rejects ID reuse for changed notation and version mutation', () => {
    const changed = {
      ...previous,
      version: 2,
      notation: "R U R' U'",
      normalizedNotation: normalizeCatalogAlgorithm("R U R' U'"),
    }
    const codes = validateAlgorithmRevision(previous, changed).map(
      (issue) => issue.code,
    )
    expect(codes).toContain('algorithm-id-reused')
    expect(codes).toContain('algorithm-version-mutated')
  })

  it('requires a replacement link and increasing version', () => {
    const newId = suneAlgorithm({
      id: trainingAlgorithmId('oll:27', 'sune-v2'),
      version: 1,
    })
    expect(
      validateAlgorithmRevision(previous, newId).map((issue) => issue.code),
    ).toContain('algorithm-revision-link-missing')

    const linked = suneAlgorithm({
      id: trainingAlgorithmId('oll:27', 'sune-v2'),
      version: 1,
      replacesAlgorithmId: previous.id,
    })
    expect(
      validateAlgorithmRevision(previous, linked).map((issue) => issue.code),
    ).toContain('algorithm-revision-version-not-incremented')

    const valid = suneAlgorithm({
      id: trainingAlgorithmId('oll:27', 'sune-v2'),
      version: 2,
      replacesAlgorithmId: previous.id,
    })
    expect(validateAlgorithmRevision(previous, valid)).toEqual([])
  })

  it('creates stable algorithm IDs and rejects empty keys', () => {
    expect(trainingAlgorithmId('pll:t', 'fixture')).toBe(
      'pll:t:alg:fixture',
    )
    expect(() => trainingAlgorithmId('pll:t', '  ')).toThrow()
  })

  it('creates an explicit replacement record with a new ID and version', () => {
    const notation = "R U R' U'"
    const normalizedNotation = normalizeCatalogAlgorithm(notation)
    const revision = createAlgorithmRevision(previous, {
      id: trainingAlgorithmId('oll:27', 'sune-v2'),
      version: 2,
      notation,
      normalizedNotation,
      provenance: {
        ...previous.provenance,
        originalNotation: notation,
        normalizedNotation,
      },
      verification: previous.verification,
    })
    expect(revision.id).toBe(trainingAlgorithmId('oll:27', 'sune-v2'))
    expect(revision.version).toBe(2)
    expect(revision.replacesAlgorithmId).toBe(previous.id)
    expect(revision.caseId).toBe(previous.caseId)

    expect(() =>
      createAlgorithmRevision(previous, {
        id: previous.id,
        version: 2,
        notation,
        normalizedNotation,
        provenance: {
          ...previous.provenance,
          originalNotation: notation,
          normalizedNotation,
        },
        verification: previous.verification,
      }),
    ).toThrow(CatalogValidationError)
  })
})
