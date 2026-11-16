/**
 * Complete OLL/PLL case identities and static-diagram references.
 *
 * This module deliberately contains **no third-party algorithm strings**.
 * Case identity is mathematical:
 *
 * - OLL is the orientation-only identity of the last layer up to AUF. The
 *   57 numbered signatures below were independently established and cover
 *   exactly the 57 non-skip AUF classes of the 216 legal orientation states.
 * - PLL is the standard named permutation identity under pre-AUF x permutation
 *   x post-AUF. The 21 signatures come from `pllCases.ts` and collapse exactly
 *   the 288 legal permutation states into 21 named classes plus PLL skip.
 *
 * The OLL table is ordered by standard case number, not by any third-party
 * algorithm list. Tests re-derive the complete class space and check the table;
 * the generator re-builds every representative state before rendering.
 */

import type { TrainingCaseDefinition } from './types'
import {
  createOllCaseDefinition,
  isOllCaseNumber,
  OLL_CASE_COUNT,
  OLL_SET_ID,
} from './ollCases'
import {
  PLL_CASES,
  PLL_NON_SKIP_CASE_IDS,
  PLL_SET_ID,
  PLL_SKIP_CASE_ID,
  type PllCaseDefinition,
  type PllCaseId,
} from './pllCases'

export const TRAINING_DIAGRAM_ASSET_ROOT = 'training/diagrams'

export const OLL_STANDARD_CASE_COUNT = OLL_CASE_COUNT
export const PLL_STANDARD_CASE_COUNT = PLL_NON_SKIP_CASE_IDS.length
export const STANDARD_CASE_COUNT =
  OLL_STANDARD_CASE_COUNT + PLL_STANDARD_CASE_COUNT

export const STANDARD_VIEWING_ORIENTATION = 'U-top-down-standard-frame'

export type OllEdgePattern = 'edge-pattern-cross' | 'edge-pattern-line' | 'edge-pattern-l' | 'edge-pattern-dot'

export type CaseAufEquivalence =
  | 'oll-orientation-up-to-auf'
  | 'pll-pre-and-post-auf'

export interface CaseAufMetadata {
  readonly preAuf: boolean
  readonly postAuf: boolean
  readonly equivalence: CaseAufEquivalence
}

export type PllStandardCaseId = Exclude<PllCaseId, 'pll:skip'>

export type PllDiagramShape =
  | 'edge-3-cycle'
  | 'edge-two-swaps'
  | 'corner-3-cycle'
  | 'corner-two-swaps'
  | 'two-plus-two'
  | 'three-plus-three'

export interface PllDiagramRepresentative {
  /** Raw post-AUF permutation used for the conventional diagram. */
  readonly signature: string
  readonly shape: PllDiagramShape
}

/**
 * Conventional PLL diagram representatives. Each signature is an AUF variant of
 * the verified named case whose permutation has the standard cycle structure:
 * edge-only, corner-only, one 2+2 swap, or a 3+3 cycle. The named identity in
 * `pllCases.ts` (pre/post-AUF double coset) is unchanged and remains the
 * classifier. Storing the raw permutation keeps the illustration conventional
 * instead of showing an arbitrary double-coset member.
 *
 * These entries are mathematical permutations chosen from the independently
 * verified named-case fixtures. No third-party algorithm strings are stored.
 */
export const PLL_DIAGRAM_REPRESENTATIVES: Readonly<
  Record<PllStandardCaseId, PllDiagramRepresentative>
> = {
  'pll:aa': {
    signature: 'UBL,UFR,UBR,UFL|UF,UR,UB,UL',
    shape: 'corner-3-cycle',
  },
  'pll:ab': {
    signature: 'UBR,UBL,UFR,UFL|UF,UR,UB,UL',
    shape: 'corner-3-cycle',
  },
  'pll:e': {
    signature: 'UBR,UFR,UFL,UBL|UF,UR,UB,UL',
    shape: 'corner-two-swaps',
  },
  'pll:f': {
    signature: 'UBR,UFR,UBL,UFL|UB,UR,UF,UL',
    shape: 'two-plus-two',
  },
  'pll:ga': {
    signature: 'UFL,UBR,UFR,UBL|UB,UR,UL,UF',
    shape: 'three-plus-three',
  },
  'pll:gb': {
    signature: 'UFL,UBR,UFR,UBL|UR,UB,UF,UL',
    shape: 'three-plus-three',
  },
  'pll:gc': {
    signature: 'UFL,UBR,UFR,UBL|UF,UB,UL,UR',
    shape: 'three-plus-three',
  },
  'pll:gd': {
    signature: 'UFL,UBR,UFR,UBL|UR,UL,UB,UF',
    shape: 'three-plus-three',
  },
  'pll:h': {
    signature: 'UFR,UBR,UBL,UFL|UB,UL,UF,UR',
    shape: 'edge-two-swaps',
  },
  'pll:ja': {
    signature: 'UBR,UFR,UBL,UFL|UF,UB,UR,UL',
    shape: 'two-plus-two',
  },
  'pll:jb': {
    signature: 'UFL,UBR,UBL,UFR|UL,UR,UB,UF',
    shape: 'two-plus-two',
  },
  'pll:na': {
    signature: 'UBL,UBR,UFR,UFL|UB,UR,UF,UL',
    shape: 'two-plus-two',
  },
  'pll:nb': {
    signature: 'UBL,UBR,UFR,UFL|UF,UL,UB,UR',
    shape: 'two-plus-two',
  },
  'pll:ra': {
    signature: 'UFL,UBR,UBL,UFR|UF,UB,UR,UL',
    shape: 'two-plus-two',
  },
  'pll:rb': {
    signature: 'UBR,UFR,UBL,UFL|UL,UR,UB,UF',
    shape: 'two-plus-two',
  },
  'pll:t': {
    signature: 'UBR,UFR,UBL,UFL|UF,UL,UB,UR',
    shape: 'two-plus-two',
  },
  'pll:ua': {
    signature: 'UFR,UBR,UBL,UFL|UR,UL,UB,UF',
    shape: 'edge-3-cycle',
  },
  'pll:ub': {
    signature: 'UFR,UBR,UBL,UFL|UL,UF,UB,UR',
    shape: 'edge-3-cycle',
  },
  'pll:v': {
    signature: 'UBL,UBR,UFR,UFL|UF,UB,UR,UL',
    shape: 'two-plus-two',
  },
  'pll:y': {
    signature: 'UBL,UBR,UFR,UFL|UF,UR,UL,UB',
    shape: 'two-plus-two',
  },
  'pll:z': {
    signature: 'UFR,UBR,UBL,UFL|UR,UF,UL,UB',
    shape: 'edge-two-swaps',
  },
}

export interface StandardCaseDefinition extends TrainingCaseDefinition {
  /** Human-facing label already used by the case lists. */
  readonly caseLabel: string
  /** Repository-relative path below `src/assets/`. */
  readonly diagramAsset: string
  readonly viewingOrientation: typeof STANDARD_VIEWING_ORIENTATION
  readonly auf: CaseAufMetadata
  /** Raw state used for the diagram; equals the canonical signature for OLL. */
  readonly representativeSignature: string
  /** PLL-only: conventional permutation shape used for the diagram. */
  readonly diagramShape?: PllDiagramShape
  /** OLL-only: deterministic family derived from the edge-orientation pattern. */
  readonly edgePattern?: OllEdgePattern
}

/** Independently verified OLL number -> canonical orientation signature. */
export const OLL_SIGNATURES: readonly (readonly [number, string])[] = [
  [1, '1212|1111'],
  [2, '1122|1111'],
  [3, '0222|1111'],
  [4, '0111|1111'],
  [5, '0222|0011'],
  [6, '0111|0011'],
  [7, '0222|0110'],
  [8, '0111|1001'],
  [9, '0111|1100'],
  [10, '0222|1100'],
  [11, '0222|1001'],
  [12, '0111|0110'],
  [13, '0222|0101'],
  [14, '0111|1010'],
  [15, '0222|1010'],
  [16, '0111|0101'],
  [17, '0102|1111'],
  [18, '0012|1111'],
  [19, '0021|1111'],
  [20, '0000|1111'],
  [21, '1212|0000'],
  [22, '1122|0000'],
  [23, '0012|0000'],
  [24, '0021|0000'],
  [25, '0102|0000'],
  [26, '0111|0000'],
  [27, '0222|0000'],
  [28, '0000|0011'],
  [29, '0021|1100'],
  [30, '0021|0110'],
  [31, '0021|1001'],
  [32, '0021|0011'],
  [33, '0021|1010'],
  [34, '0021|0101'],
  [35, '0102|1100'],
  [36, '0102|1001'],
  [37, '0102|0011'],
  [38, '0102|0110'],
  [39, '0102|0101'],
  [40, '0102|1010'],
  [41, '0012|0110'],
  [42, '0012|1100'],
  [43, '0012|1001'],
  [44, '0012|0011'],
  [45, '0012|1010'],
  [46, '0012|0101'],
  [47, '1122|1100'],
  [48, '1122|1001'],
  [49, '1122|0011'],
  [50, '1122|0110'],
  [51, '1122|0101'],
  [52, '1122|1010'],
  [53, '1212|0011'],
  [54, '1212|0110'],
  [55, '1212|0101'],
  [56, '1212|1010'],
  [57, '0000|0101'],
] as const

/**
 * A few independently verified anchors. They catch accidental edits to the
 * highest-risk rows; the complete table is additionally checked against the
 * enumerated 57-class space in the focused tests.
 */
export const OLL_SIGNATURE_ANCHORS: Readonly<Record<number, string>> = {
  1: '1212|1111',
  27: '0222|0000',
  45: '0012|1010',
  56: '1212|1010',
  57: '0000|0101',
}


export function ollDiagramAsset(number: number): string {
  if (!isOllCaseNumber(number)) {
    throw new RangeError(
      `OLL case number must be an integer from 1 to ${OLL_CASE_COUNT}; received ${number}.`,
    )
  }
  return `${TRAINING_DIAGRAM_ASSET_ROOT}/oll/oll-${String(number).padStart(2, '0')}.svg`
}

export function pllDiagramAsset(id: PllCaseId): string {
  if (id === PLL_SKIP_CASE_ID) {
    throw new RangeError('PLL skip does not have a standard case diagram.')
  }
  return `${TRAINING_DIAGRAM_ASSET_ROOT}/pll/${id.replace('pll:', 'pll-')}.svg`
}

/** Splits an OLL signature into its corner and edge orientation digits. */
export function parseOllSignature(signature: string): {
  readonly cornerOrientations: readonly number[]
  readonly edgeOrientations: readonly number[]
} {
  const match = /^([0-2]{4})\|([0-1]{4})$/.exec(signature)
  if (!match) {
    throw new RangeError(
      `Invalid OLL orientation signature "${signature}"; expected cccc|eeee.`,
    )
  }
  return {
    cornerOrientations: [...match[1]!].map(Number),
    edgeOrientations: [...match[2]!].map(Number),
  }
}

/**
 * Families are derived only from the four edge-orientation digits. Two flipped
 * edges form a line when they are opposite and an L when adjacent. This is a
 * mathematical grouping, not a copied presentation taxonomy.
 */
export function ollEdgePattern(signature: string): OllEdgePattern {
  const { edgeOrientations } = parseOllSignature(signature)
  const flipped = edgeOrientations
    .map((value, index) => (value === 1 ? index : -1))
    .filter((index) => index >= 0)

  if (flipped.length === 0) return 'edge-pattern-cross'
  if (flipped.length === 4) return 'edge-pattern-dot'
  if (flipped.length !== 2) {
    throw new RangeError(
      `OLL signature "${signature}" has an impossible edge-flip count.`,
    )
  }
  const [first, second] = flipped as [number, number]
  const opposite =
    (first === 0 && second === 2) || (first === 1 && second === 3)
  return opposite ? 'edge-pattern-line' : 'edge-pattern-l'
}

const OLL_AUF: CaseAufMetadata = {
  preAuf: true,
  postAuf: true,
  equivalence: 'oll-orientation-up-to-auf',
}

const PLL_AUF: CaseAufMetadata = {
  preAuf: true,
  postAuf: true,
  equivalence: 'pll-pre-and-post-auf',
}

function createStandardOllCase(
  number: number,
  signature: string,
): StandardCaseDefinition {
  const edgePattern = ollEdgePattern(signature)
  const definition = createOllCaseDefinition({
    number,
    canonicalSignature: signature,
    name: `OLL ${number}`,
    groupId: edgePattern,
    diagramAsset: ollDiagramAsset(number),
    referenceNotes:
      'Standard OLL orientation identity; independently verified signature. No algorithm content is bundled.',
  })
  return {
    ...definition,
    caseLabel: `OLL ${number}`,
    diagramAsset: ollDiagramAsset(number),
    viewingOrientation: STANDARD_VIEWING_ORIENTATION,
    auf: OLL_AUF,
    representativeSignature: signature,
    edgePattern,
  }
}

function standardisePllCase(
  definition: PllCaseDefinition,
): StandardCaseDefinition {
  const id = definition.id as PllStandardCaseId
  const representative = PLL_DIAGRAM_REPRESENTATIVES[id]
  if (!representative) {
    throw new RangeError(
      `PLL case ${definition.id} has no conventional diagram representative.`,
    )
  }
  return {
    ...definition,
    caseLabel: definition.name,
    diagramAsset: pllDiagramAsset(definition.id),
    viewingOrientation: STANDARD_VIEWING_ORIENTATION,
    auf: PLL_AUF,
    representativeSignature: representative.signature,
    diagramShape: representative.shape,
  }
}

export const OLL_STANDARD_CASES: readonly StandardCaseDefinition[] =
  OLL_SIGNATURES.map(([number, signature]) =>
    createStandardOllCase(number, signature),
  )

export const PLL_NAMED_CASES: readonly StandardCaseDefinition[] =
  PLL_CASES.filter(
    (definition): definition is PllCaseDefinition =>
      definition.id !== PLL_SKIP_CASE_ID,
  ).map(standardisePllCase)

export const STANDARD_CASES: readonly StandardCaseDefinition[] = [
  ...OLL_STANDARD_CASES,
  ...PLL_NAMED_CASES,
]

export const OLL_STANDARD_CASE_BY_ID: ReadonlyMap<
  string,
  StandardCaseDefinition
> = new Map(OLL_STANDARD_CASES.map((definition) => [definition.id, definition]))

export const PLL_NAMED_CASE_BY_ID: ReadonlyMap<
  string,
  StandardCaseDefinition
> = new Map(PLL_NAMED_CASES.map((definition) => [definition.id, definition]))

export const STANDARD_CASE_BY_ID: ReadonlyMap<string, StandardCaseDefinition> =
  new Map(STANDARD_CASES.map((definition) => [definition.id, definition]))

export function standardCaseById(id: string): StandardCaseDefinition {
  const definition = STANDARD_CASE_BY_ID.get(id)
  if (!definition) {
    throw new RangeError(`Unknown standard training case "${id}".`)
  }
  return definition
}

export interface StandardCaseTableIssue {
  readonly code: string
  readonly message: string
}

/**
 * Structural validation of the complete table. Mathematical class coverage is
 * checked separately with the cube model so this function stays pure and can
 * reject malformed data before the generator loads a cube state.
 */
export function validateStandardCaseTable(
  cases: readonly StandardCaseDefinition[] = STANDARD_CASES,
): readonly StandardCaseTableIssue[] {
  const issues: StandardCaseTableIssue[] = []
  const ids = new Set<string>()
  const signatures = new Set<string>()
  const representativeSignatures = new Set<string>()
  const assets = new Set<string>()
  const ollNumbers = new Set<number>()
  const pllNames = new Set<string>()

  for (const definition of cases) {
    if (ids.has(definition.id)) {
      issues.push({
        code: 'case-id-duplicate',
        message: `Duplicate case id ${definition.id}.`,
      })
    }
    ids.add(definition.id)

    if (signatures.has(definition.canonicalSignature)) {
      issues.push({
        code: 'case-signature-duplicate',
        message: `Duplicate case signature ${definition.canonicalSignature} on ${definition.id}.`,
      })
    }
    signatures.add(definition.canonicalSignature)

    if (!definition.representativeSignature) {
      issues.push({
        code: 'case-representative-missing',
        message: `Case ${definition.id} has no representative signature.`,
      })
    } else if (representativeSignatures.has(definition.representativeSignature)) {
      issues.push({
        code: 'case-representative-duplicate',
        message: `Duplicate representative signature ${definition.representativeSignature} on ${definition.id}.`,
      })
    } else {
      representativeSignatures.add(definition.representativeSignature)
    }

    if (assets.has(definition.diagramAsset)) {
      issues.push({
        code: 'case-diagram-duplicate',
        message: `Duplicate diagram asset ${definition.diagramAsset}.`,
      })
    }
    assets.add(definition.diagramAsset)

    if (
      !definition.diagramAsset.startsWith(`${TRAINING_DIAGRAM_ASSET_ROOT}/`) ||
      !definition.diagramAsset.endsWith('.svg')
    ) {
      issues.push({
        code: 'case-diagram-path',
        message: `Case ${definition.id} has an invalid diagram path ${definition.diagramAsset}.`,
      })
    }
    if (definition.viewingOrientation !== STANDARD_VIEWING_ORIENTATION) {
      issues.push({
        code: 'case-viewing-orientation',
        message: `Case ${definition.id} does not use the standard viewing orientation.`,
      })
    }
    if (definition.isSkip || !definition.selectable) {
      issues.push({
        code: 'case-not-trainable',
        message: `Standard case ${definition.id} must be selectable and must not be a skip identity.`,
      })
    }
    if (
      definition.defaultAlgorithmId !== undefined ||
      definition.generatorAlgorithmId !== undefined ||
      definition.alternativeAlgorithmIds.length > 0
    ) {
      issues.push({
        code: 'case-algorithm-content',
        message: `Case ${definition.id} bundles algorithm content; Phase 2C is identity/diagram-only.`,
      })
    }

    if (definition.setId === OLL_SET_ID) {
      const match = /^oll:(\d+)$/.exec(definition.id)
      const number = match ? Number(match[1]) : NaN
      if (!isOllCaseNumber(number)) {
        issues.push({
          code: 'case-oll-id',
          message: `Invalid OLL case id ${definition.id}.`,
        })
        continue
      }
      if (ollNumbers.has(number)) {
        issues.push({
          code: 'case-oll-number-duplicate',
          message: `Duplicate OLL case number ${number}.`,
        })
      }
      ollNumbers.add(number)
      if (definition.auf.equivalence !== 'oll-orientation-up-to-auf') {
        issues.push({
          code: 'case-oll-auf',
          message: `OLL ${number} has the wrong AUF classification.`,
        })
      }
      if (definition.representativeSignature !== definition.canonicalSignature) {
        issues.push({
          code: 'case-oll-representative',
          message: `OLL ${number} must use its canonical orientation signature as the representative.`,
        })
      }
      if (definition.diagramShape !== undefined) {
        issues.push({
          code: 'case-oll-shape',
          message: `OLL ${number} must not declare a PLL diagram shape.`,
        })
      }
      try {
        const parsed = parseOllSignature(definition.canonicalSignature)
        if (parsed.cornerOrientations.reduce((a, b) => a + b, 0) % 3 !== 0) {
          issues.push({
            code: 'case-oll-corner-parity',
            message: `OLL ${number} has an impossible corner-orientation sum.`,
          })
        }
        if (parsed.edgeOrientations.reduce((a, b) => a + b, 0) % 2 !== 0) {
          issues.push({
            code: 'case-oll-edge-parity',
            message: `OLL ${number} has an impossible edge-orientation sum.`,
          })
        }
        const expectedPattern = ollEdgePattern(definition.canonicalSignature)
        if (definition.edgePattern !== expectedPattern) {
          issues.push({
            code: 'case-oll-family',
            message: `OLL ${number} has a mismatch between signature and edge pattern.`,
          })
        }
      } catch (error) {
        issues.push({
          code: 'case-oll-signature',
          message: `OLL ${number} has an invalid signature: ${
            error instanceof Error ? error.message : String(error)
          }`,
        })
      }
      const anchor = OLL_SIGNATURE_ANCHORS[number]
      if (anchor !== undefined && anchor !== definition.canonicalSignature) {
        issues.push({
          code: 'case-oll-anchor',
          message: `OLL ${number} signature ${definition.canonicalSignature} does not match the independently verified anchor ${anchor}.`,
        })
      }
    } else if (definition.setId === PLL_SET_ID) {
      const standard = PLL_CASES.find((item) => item.id === definition.id)
      if (!standard || standard.id === PLL_SKIP_CASE_ID) {
        issues.push({
          code: 'case-pll-id',
          message: `Invalid PLL case id ${definition.id}.`,
        })
        continue
      }
      if (definition.canonicalSignature !== standard.canonicalSignature) {
        issues.push({
          code: 'case-pll-signature-mismatch',
          message: `PLL case ${definition.id} does not use its standard named signature.`,
        })
      }
      if (definition.auf.equivalence !== 'pll-pre-and-post-auf') {
        issues.push({
          code: 'case-pll-auf',
          message: `PLL case ${definition.id} has the wrong AUF classification.`,
        })
      }
      const representative =
        PLL_DIAGRAM_REPRESENTATIVES[definition.id as PllStandardCaseId]
      if (
        !representative ||
        definition.representativeSignature !== representative.signature
      ) {
        issues.push({
          code: 'case-pll-representative',
          message: `PLL case ${definition.id} does not use its conventional diagram representative.`,
        })
      }
      if (
        !representative ||
        definition.diagramShape !== representative.shape
      ) {
        issues.push({
          code: 'case-pll-shape',
          message: `PLL case ${definition.id} does not use its conventional diagram shape.`,
        })
      }
      if (pllNames.has(definition.name)) {
        issues.push({
          code: 'case-pll-name-duplicate',
          message: `Duplicate PLL case name ${definition.name}.`,
        })
      }
      pllNames.add(definition.name)
    } else {
      issues.push({
        code: 'case-set-unknown',
        message: `Case ${definition.id} has unknown set ${definition.setId}.`,
      })
    }
  }

  if (ollNumbers.size !== OLL_STANDARD_CASE_COUNT) {
    issues.push({
      code: 'case-oll-count',
      message: `Expected ${OLL_STANDARD_CASE_COUNT} OLL cases, found ${ollNumbers.size}.`,
    })
  }
  for (let number = 1; number <= OLL_STANDARD_CASE_COUNT; number += 1) {
    if (!ollNumbers.has(number)) {
      issues.push({
        code: 'case-oll-missing',
        message: `Missing OLL case ${number}.`,
      })
    }
  }

  const pllCaseCount = cases.filter(
    (definition) => definition.setId === PLL_SET_ID,
  ).length
  if (pllCaseCount !== PLL_STANDARD_CASE_COUNT) {
    issues.push({
      code: 'case-pll-count',
      message: `Expected ${PLL_STANDARD_CASE_COUNT} PLL cases, found ${pllCaseCount}.`,
    })
  }
  for (const expectedId of PLL_NON_SKIP_CASE_IDS) {
    if (!ids.has(expectedId)) {
      issues.push({
        code: 'case-pll-missing',
        message: `Missing PLL case ${expectedId}.`,
      })
    }
  }

  if (cases.length !== STANDARD_CASE_COUNT) {
    issues.push({
      code: 'case-total-count',
      message: `Expected ${STANDARD_CASE_COUNT} standard cases, found ${cases.length}.`,
    })
  }

  return issues
}

export class StandardCaseTableError extends Error {
  readonly issues: readonly StandardCaseTableIssue[]

  constructor(issues: readonly StandardCaseTableIssue[]) {
    super(
      `Standard case table validation failed with ${issues.length} issue(s): ${issues
        .map((issue) => issue.message)
        .join('; ')}`,
    )
    this.name = 'StandardCaseTableError'
    this.issues = issues
  }
}

export function assertValidStandardCaseTable(
  cases: readonly StandardCaseDefinition[] = STANDARD_CASES,
): void {
  const issues = validateStandardCaseTable(cases)
  if (issues.length > 0) throw new StandardCaseTableError(issues)
}

export const OLL_CASE_NUMBER_BY_SIGNATURE: ReadonlyMap<string, number> = new Map(
  OLL_SIGNATURES.map(([number, signature]) => [signature, number]),
)

export function ollCaseNumberForSignature(signature: string): number {
  const number = OLL_CASE_NUMBER_BY_SIGNATURE.get(signature)
  if (number === undefined) {
    throw new RangeError(`Unknown OLL signature "${signature}".`)
  }
  return number
}
