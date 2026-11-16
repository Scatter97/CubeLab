/**
 * Built-in default OLL/PLL algorithms.
 *
 * The owner selected these 78 functional move sequences from the Phase 2A
 * sources. This module is an independently assembled catalog: it contains only
 * the one approved sequence per standard case, normalized into CubeLab notation,
 * plus provenance for traceability. It does not copy either source repository's
 * data structure, diagrams, comments, presentation tables or additional PLL
 * variants.
 *
 * Third-party redistribution permission is not claimed. Heroor/cfop has a
 * README-only MIT statement without a LICENSE file; Tao Yu's repository has an
 * MIT LICENSE but credits AlgDb for algorithms not otherwise attributed. The
 * supportable implementation choice is therefore to treat these short,
 * functional algorithms as the owner-approved facts they are, not as a copied
 * algorithm compilation. See PROJECT_MEMORY.md E13 for the full limitation.
 */

import { normalizeCatalogAlgorithm } from '../notation'
import type {
  AlgorithmProvenance,
  TrainingAlgorithmRecord,
  TrainingCaseDefinition,
} from './types'
import {
  OLL_STANDARD_CASES,
  PLL_NAMED_CASES,
  STANDARD_CASE_BY_ID,
} from './standardCases'

export const BUILT_IN_CATALOG_VERSION = 'builtin-algorithms:1.0.0'
export const BUILT_IN_VERIFIED_AT = '2026-11-10'
export const BUILT_IN_DEFAULT_VARIANT = 'default-v1'

const OLL_SOURCE = {
  repository: 'https://github.com/Heroor/cfop',
  commit: 'e1cba6995f3ff27732ac18c767e7e9ca1343f13a',
  path: 'src/data/cube.json',
} as const

const PLL_SOURCE = {
  repository: 'https://github.com/tao-yu/Alg-Trainer',
  commit: 'cb95945c3e4839ee1e4b058d4a79bc022615b220',
  path: 'js/alg_list.js',
} as const

/**
 * Normalized owner-approved OLL defaults. OLL 45 and 56 use the corrected
 * strings; their source strings and correction records are below.
 */
const OLL_DEFAULT_NOTATION: Readonly<Record<string, string>> = {
  'oll:1': "R U' U' R2 F R F' U2 R' F R F'",
  'oll:2': "F R U R' U' F' Fw R U R' U' Fw'",
  'oll:3': "Fw R U R' U' Fw' U' F R U R' U' F'",
  'oll:4': "Fw R U R' U' Fw' U F R U R' U' F'",
  'oll:5': "Rw' U2 R U R' U Rw",
  'oll:6': "Rw U' U' R' U' R U' Rw'",
  'oll:7': "Rw U R' U R U' U' Rw'",
  'oll:8': "Rw' U' R U' R' U2 Rw",
  'oll:9': "R U R' U' R' F R2 U R' U' F'",
  'oll:10': "R U R' U R' F R F' R U' U' R'",
  'oll:11': "Rw' R2 U R' U R U' U' R' U M'",
  'oll:12': "M' R' U' R U' R' U2 R U' M",
  'oll:13': "Fw R U R2 U' R' U R U' Fw'",
  'oll:14': "R' F R U R' F' R F U' F'",
  'oll:15': "Rw' U' Rw R' U' R U Rw' U Rw",
  'oll:16': "Rw U Rw' R U R' U' Rw U' Rw'",
  'oll:17': "Lw U' Lw' Fw R2 B R' U R' U' Fw'",
  'oll:18': "Rw U R' U R U' U' Rw' Rw' U' R U' R' U2 Rw",
  'oll:19': "Rw' R U R U R' U' Rw R2 F R F'",
  'oll:20': "Rw U R' U' M2 U R U' R' U' M'",
  'oll:21': "R U' U' R' U' R U R' U' R U' R'",
  'oll:22': "R U' U' R2 U' R2 U' R2 U' U' R",
  'oll:23': "R2 D' R U' U' R' D R U' U' R",
  'oll:24': "Rw U R' U' Rw' F R F'",
  'oll:25': "F' Rw U R' U' Rw' F R",
  'oll:26': "R U' U' R' U' R U' R'",
  'oll:27': "R U R' U R U' U' R'",
  'oll:28': "Rw U R' U' Rw' R U R U' R'",
  'oll:29': "R U R' U' R U' R' F' U' F R U R'",
  'oll:30': "Fw R U R2 U' R' U R2 U' R' Fw'",
  'oll:31': "Rw' F' U F Rw U' Rw' U' Rw",
  'oll:32': "R U B' U' R' U R B R'",
  'oll:33': "R U R' U' R' F R F'",
  'oll:34': "R U R2 U' R' F R U R U' F'",
  'oll:35': "R U' U' R2 F R F' R U' U' R'",
  'oll:36': "R' U' R U' R' U R U Lw U' R' U",
  'oll:37': "F R U' R' U' R U R' F'",
  'oll:38': "R U R' U R U' R' U' R' F R F'",
  'oll:39': "R U R' F' U' F U R U2 R'",
  'oll:40': "R' F R U R' U' F' U R",
  'oll:41': "R U R' U R U' U' R' F R U R' U' F'",
  'oll:42': "R' U' R U' R' U2 R F R U R' U' F'",
  'oll:43': "B' U' R' U R B",
  'oll:44': "Fw R U R' U' Fw'",
  'oll:45': "F R U R' U' F'",
  'oll:46': "R' U' R' F R F' U R",
  'oll:47': "Bw' U' R' U R U' R' U R Bw",
  'oll:48': "F R U R' U' R U R' U' F'",
  'oll:49': "R B' R2 F R2 B R2 F' R",
  'oll:50': "Rw' U Rw2 U' Rw2 U' Rw2 U Rw'",
  'oll:51': "Fw R U R' U' R U R' U' Fw'",
  'oll:52': "R' F' U' F U' R U R' U R",
  'oll:53': "Rw' U2 R U R' U' R U R' U Rw",
  'oll:54': "Rw U' U' R' U' R U R' U' R U' Rw'",
  'oll:55': "Rw U' U' R' U' Rw' R2 U R' U' Rw U' Rw'",
  'oll:56': "r U r' (U R U' R')2 r U' r'",
  'oll:57': "R U R' U' M' U R U' Rw'",
}

/** The first-listed PLL algorithm for each case, normalized; no extra variants. */
const PLL_DEFAULT_NOTATION: Readonly<Record<string, string>> = {
  'pll:ua': "U2 R2 U' R' U' R U R U R U' R",
  'pll:ub': "R' U R' U' R' U' R' U R U R2",
  'pll:h': "M2 U' M2 U2 M2 U' M2",
  'pll:z': "M' U' M2 U' M2 U' M' U2 M2",
  'pll:aa': "Lw' U R' D2 R U' R' D2 R2 x'",
  'pll:ab': "x R2 D2 R U R' D2 R U' R x'",
  'pll:e': "x' R U' R' D R U R' D' R U R' D R U' R' D' x",
  'pll:ga': "R2 Uw R' U R' U' R Uw' R2 y' R' U R",
  'pll:gb': "U F' U' F R2 Uw R' U R U' R Uw' R2",
  'pll:gc': "R2 Uw' R U' R U R' Uw R2 y R U' R'",
  'pll:gd': "R U R' y' R2 Uw' R U' R' U R' Uw R2",
  'pll:ra': "R U R' F' R U2 R' U2 R' F R U R U2 R'",
  'pll:rb': "R' U2 R U2 R' F R U R' U' R' F' R2",
  'pll:ja': "R' U L' U2 R U' R' U2 R L",
  'pll:jb': "R U R' F' R U R' U' R' F R2 U' R' U'",
  'pll:na': "R U R' U R U R' F' R U R' U' R' F R2 U' R' U2 R U' R'",
  'pll:nb': "z D' R U' R2 D R' U D' R U' R2 D R' U z'",
  'pll:y': "F R U' R' U' R U R' F' R U R' U' R' F R F'",
  'pll:f': "R' U' F' R U R' U' R' F R2 U' R' U' R U R' U R",
  'pll:t': "R U R' U' R' F R2 U' R' U' R U R' F'",
  'pll:v': "R' U R' Dw' R' F' R2 U' R' U R' F R F",
}

interface ApprovedCorrection {
  readonly originalNotation: string
  readonly reason: string
}

const CORRECTIONS: Readonly<Record<string, ApprovedCorrection>> = {
  'oll:45': {
    originalNotation: "F(RUR'U')f'",
    reason:
      'The source trailing wide f was intended as a face F; the approved correction verifies as OLL 45.',
  },
  'oll:56': {
    originalNotation: "(rUr')(URU'R')2\n(r'U'r')",
    reason:
      'Final owner-approved Candidate B; the corrected final r/r\u2032 sequence reproduces OLL 56 without breaking F2L.',
  },
}

/** Frame-normalization corrections discovered by the existing verification path. */
const FRAME_CORRECTIONS: Readonly<Record<string, string>> = {
  'oll:36': 'x',
  'pll:ga': 'y',
  'pll:gc': "y'",
  'pll:gd': 'y',
  'pll:v': "y'",
}

const REDISTRIBUTION_NOTES =
  'Owner-selected short functional move sequence. The catalog is independently assembled and normalized; no third-party compilation structure or additional variants are copied, and no third-party redistribution licence is asserted.'

function builtInAlgorithmId(caseId: string): string {
  return `${caseId}:alg:${BUILT_IN_DEFAULT_VARIANT}`
}

function sourcePath(caseId: string): string {
  const definition = STANDARD_CASE_BY_ID.get(caseId)
  if (!definition) throw new RangeError(`Unknown Training case "${caseId}".`)
  if (definition.setId === 'oll') {
    const number = Number(caseId.slice('oll:'.length))
    return `${OLL_SOURCE.path}#oll[${number - 1}].f`
  }
  return `${PLL_SOURCE.path}#PLL.${definition.name}[0]`
}

function provenanceFor(
  caseId: string,
  normalizedNotation: string,
): AlgorithmProvenance {
  const definition = STANDARD_CASE_BY_ID.get(caseId)
  if (!definition) throw new RangeError(`Unknown Training case "${caseId}".`)
  const correction = CORRECTIONS[caseId]
  const isOll = definition.setId === 'oll'
  return {
    sourceKind: 'owner-approved',
    sourceRepository: isOll ? OLL_SOURCE.repository : PLL_SOURCE.repository,
    sourceCommit: isOll ? OLL_SOURCE.commit : PLL_SOURCE.commit,
    sourcePath: sourcePath(caseId),
    ...(correction
      ? {
          originalNotation: correction.originalNotation,
          correction: {
            originalNotation: correction.originalNotation,
            approvedNotation: OLL_DEFAULT_NOTATION[caseId]!,
            approvedOn: '2026-11-08',
            reason: correction.reason,
          },
        }
      : {}),
    normalizedNotation,
    approval: {
      approvedBy: 'owner',
      approvedOn: '2026-11-08',
      notes:
        'Owner-approved default selection. Approval selects content; it does not grant third-party redistribution rights.',
    },
    redistribution: 'not-applicable',
    redistributionNotes: REDISTRIBUTION_NOTES,
  }
}

function createBuiltInAlgorithm(caseId: string): TrainingAlgorithmRecord {
  const definition = STANDARD_CASE_BY_ID.get(caseId)
  const notation =
    OLL_DEFAULT_NOTATION[caseId] ?? PLL_DEFAULT_NOTATION[caseId]
  if (!definition || !notation) {
    throw new RangeError(`Missing built-in default for Training case "${caseId}".`)
  }
  const normalizedNotation = normalizeCatalogAlgorithm(notation)
  const frameCorrection = FRAME_CORRECTIONS[caseId]
  return {
    id: builtInAlgorithmId(caseId),
    version: 1,
    caseId,
    setId: definition.setId,
    source: 'bundled',
    label: definition.name,
    notation,
    normalizedNotation,
    immutable: true,
    provenance: provenanceFor(caseId, normalizedNotation),
    verification: {
      status: 'verified',
      method: 'cube-state',
      verifiedAt: BUILT_IN_VERIFIED_AT,
      frameNormalized: true,
      ...(frameCorrection
        ? {
            frameCorrection,
            frameNormalizedNotation: `${normalizedNotation} ${frameCorrection}`,
          }
        : {}),
      solvesCase: true,
      checkedAufs: ['', 'U', 'U2', "U'"],
      notes:
        'Re-verified against the standard case identity, F2L and exact setup generation for all 78 defaults.',
    },
  }
}

export const BUILT_IN_ALGORITHMS: readonly TrainingAlgorithmRecord[] = [
  ...OLL_STANDARD_CASES.map((definition) =>
    createBuiltInAlgorithm(definition.id),
  ),
  ...PLL_NAMED_CASES.map((definition) =>
    createBuiltInAlgorithm(definition.id),
  ),
]

export const BUILT_IN_ALGORITHM_BY_ID: ReadonlyMap<
  string,
  TrainingAlgorithmRecord
> = new Map(BUILT_IN_ALGORITHMS.map((algorithm) => [algorithm.id, algorithm]))

const BUILT_IN_ALGORITHM_BY_CASE: ReadonlyMap<
  string,
  TrainingAlgorithmRecord
> = new Map(BUILT_IN_ALGORITHMS.map((algorithm) => [algorithm.caseId, algorithm]))

function withBuiltInAlgorithm(
  definition: TrainingCaseDefinition,
): TrainingCaseDefinition {
  const algorithm = BUILT_IN_ALGORITHM_BY_CASE.get(definition.id)
  if (!algorithm) return definition
  return {
    ...definition,
    defaultAlgorithmId: algorithm.id,
    generatorAlgorithmId: algorithm.id,
  }
}

export const BUILT_IN_OLL_CASES: readonly TrainingCaseDefinition[] =
  OLL_STANDARD_CASES.map(withBuiltInAlgorithm)

export const BUILT_IN_PLL_CASES: readonly TrainingCaseDefinition[] =
  PLL_NAMED_CASES.map(withBuiltInAlgorithm)

export const BUILT_IN_CASES: readonly TrainingCaseDefinition[] = [
  ...BUILT_IN_OLL_CASES,
  ...BUILT_IN_PLL_CASES,
]

export const BUILT_IN_CASE_BY_ID: ReadonlyMap<
  string,
  TrainingCaseDefinition
> = new Map(BUILT_IN_CASES.map((definition) => [definition.id, definition]))

export function builtInAlgorithmForCase(
  caseId: string,
): TrainingAlgorithmRecord | undefined {
  const definition = BUILT_IN_CASE_BY_ID.get(caseId)
  if (!definition?.defaultAlgorithmId) return undefined
  return BUILT_IN_ALGORITHM_BY_ID.get(definition.defaultAlgorithmId)
}

export const BUILT_IN_TRAINING_CATALOG = {
  version: BUILT_IN_CATALOG_VERSION,
  contentStatus: 'complete',
  sets: [
    {
      id: 'oll',
      name: 'OLL',
      standardCaseCount: 57,
      includesSkipIdentity: true,
    },
    {
      id: 'pll',
      name: 'PLL',
      standardCaseCount: 21,
      includesSkipIdentity: true,
    },
  ],
  cases: BUILT_IN_CASES,
  algorithms: BUILT_IN_ALGORITHMS,
} as const
