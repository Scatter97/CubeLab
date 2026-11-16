/**
 * Standard PLL case identities.
 *
 * These records define the 21 standard named cases plus the PLL-skip identity.
 * They contain canonical permutation signatures only. The owner-approved built-in
 * algorithm records live in `defaultAlgorithms.ts`; user preferences remain in
 * the separate local Training store.
 */

import type { TrainingCaseDefinition } from './types'

export const PLL_SET_ID = 'pll'

export const PLL_CASE_IDS = [
  'pll:aa',
  'pll:ab',
  'pll:e',
  'pll:f',
  'pll:ga',
  'pll:gb',
  'pll:gc',
  'pll:gd',
  'pll:h',
  'pll:ja',
  'pll:jb',
  'pll:na',
  'pll:nb',
  'pll:ra',
  'pll:rb',
  'pll:t',
  'pll:ua',
  'pll:ub',
  'pll:v',
  'pll:y',
  'pll:z',
  'pll:skip',
] as const

export type PllCaseId = (typeof PLL_CASE_IDS)[number]

export const PLL_SKIP_CASE_ID: PllCaseId = 'pll:skip'

export interface PllCaseDefinition extends TrainingCaseDefinition {
  readonly id: PllCaseId
  readonly setId: typeof PLL_SET_ID
  readonly kind: 'pll-permutation'
}

function pllCase(
  id: PllCaseId,
  name: string,
  groupId: string,
  canonicalSignature: string,
  isSkip = false,
): PllCaseDefinition {
  return {
    id,
    setId: PLL_SET_ID,
    kind: 'pll-permutation',
    name,
    groupId,
    canonicalSignature,
    isSkip,
    selectable: !isSkip,
    alternativeAlgorithmIds: [],
    reference: {
      kind: 'mathematical-definition',
      notes:
        'Canonical U-layer permutation signature; no third-party algorithm content is bundled.',
    },
  }
}

/**
 * Canonical double-coset signatures (pre-AUF × permutation × post-AUF) for the
 * standard PLL cases. The signature format is
 * `corner@@UFR,corner@@UBR,corner@@UBL,corner@@UFL|edge@@UF,edge@@UR,edge@@UB,edge@@UL`.
 */
export const PLL_CASES: readonly PllCaseDefinition[] = [
  pllCase(
    'pll:aa',
    'Aa',
    'corners-only',
    'UBL,UBR,UFL,UFR|UB,UL,UF,UR',
  ),
  pllCase(
    'pll:ab',
    'Ab',
    'corners-only',
    'UBL,UBR,UFL,UFR|UF,UR,UB,UL',
  ),
  pllCase(
    'pll:e',
    'E',
    'corners-only',
    'UBL,UBR,UFR,UFL|UL,UF,UR,UB',
  ),
  pllCase(
    'pll:f',
    'F',
    'adjacent-swap',
    'UBL,UBR,UFL,UFR|UL,UB,UR,UF',
  ),
  pllCase(
    'pll:ga',
    'Ga',
    'g-permutations',
    'UBL,UBR,UFL,UFR|UB,UF,UR,UL',
  ),
  pllCase(
    'pll:gb',
    'Gb',
    'g-permutations',
    'UBL,UBR,UFL,UFR|UL,UR,UF,UB',
  ),
  pllCase(
    'pll:gc',
    'Gc',
    'g-permutations',
    'UBL,UBR,UFL,UFR|UL,UF,UB,UR',
  ),
  pllCase(
    'pll:gd',
    'Gd',
    'g-permutations',
    'UBL,UBR,UFL,UFR|UF,UL,UR,UB',
  ),
  pllCase(
    'pll:h',
    'H',
    'edges-only',
    'UBL,UFL,UFR,UBR|UF,UR,UB,UL',
  ),
  pllCase(
    'pll:ja',
    'Ja',
    'adjacent-swap',
    'UBL,UBR,UFL,UFR|UR,UL,UB,UF',
  ),
  pllCase(
    'pll:jb',
    'Jb',
    'adjacent-swap',
    'UBL,UBR,UFL,UFR|UB,UR,UL,UF',
  ),
  pllCase(
    'pll:na',
    'Na',
    'diagonal-swap',
    'UBL,UBR,UFR,UFL|UB,UR,UF,UL',
  ),
  pllCase(
    'pll:nb',
    'Nb',
    'diagonal-swap',
    'UBL,UBR,UFR,UFL|UF,UL,UB,UR',
  ),
  pllCase(
    'pll:ra',
    'Ra',
    'adjacent-swap',
    'UBL,UBR,UFL,UFR|UR,UB,UF,UL',
  ),
  pllCase(
    'pll:rb',
    'Rb',
    'adjacent-swap',
    'UBL,UBR,UFL,UFR|UF,UB,UL,UR',
  ),
  pllCase(
    'pll:t',
    'T',
    'adjacent-swap',
    'UBL,UBR,UFL,UFR|UR,UF,UL,UB',
  ),
  pllCase(
    'pll:ua',
    'Ua',
    'edges-only',
    'UBL,UFL,UFR,UBR|UB,UF,UR,UL',
  ),
  pllCase(
    'pll:ub',
    'Ub',
    'edges-only',
    'UBL,UFL,UFR,UBR|UB,UR,UL,UF',
  ),
  pllCase(
    'pll:v',
    'V',
    'diagonal-swap',
    'UBL,UBR,UFR,UFL|UB,UL,UR,UF',
  ),
  pllCase(
    'pll:y',
    'Y',
    'diagonal-swap',
    'UBL,UBR,UFR,UFL|UB,UF,UL,UR',
  ),
  pllCase(
    'pll:z',
    'Z',
    'edges-only',
    'UBL,UFL,UFR,UBR|UL,UB,UR,UF',
  ),
  pllCase(
    'pll:skip',
    'PLL Skip',
    'skip',
    'UBL,UFL,UFR,UBR|UB,UL,UF,UR',
    true,
  ),
]

export const PLL_CASE_BY_ID: ReadonlyMap<PllCaseId, PllCaseDefinition> =
  new Map(PLL_CASES.map((definition) => [definition.id, definition]))

export function isPllCaseId(id: string): id is PllCaseId {
  return PLL_CASE_BY_ID.has(id as PllCaseId)
}

export const PLL_CASE_BY_SIGNATURE: ReadonlyMap<string, PllCaseDefinition> =
  new Map(
    PLL_CASES.map((definition) => [
      definition.canonicalSignature,
      definition,
    ]),
  )

export const PLL_STANDARD_CASES = PLL_CASES.filter(
  (definition) => !definition.isSkip,
)

export const PLL_NON_SKIP_CASE_IDS = PLL_STANDARD_CASES.map(
  (definition) => definition.id,
)
