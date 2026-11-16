/**
 * OLL case identity helpers.
 *
 * The complete 57-case mathematical identity table lives in `standardCases.ts`.
 * The owner-approved built-in algorithm records live in `defaultAlgorithms.ts`;
 * user preferences remain in the separate local Training store.
 */

import type { TrainingCaseDefinition } from './types'

export const OLL_SET_ID = 'oll'
export const OLL_CASE_COUNT = 57
export const OLL_SKIP_CASE_ID = 'oll:skip'

export type OllCaseNumber = number
export type OllCaseId = `oll:${number}` | typeof OLL_SKIP_CASE_ID

export function isOllCaseNumber(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= OLL_CASE_COUNT
}

export function ollCaseId(number: OllCaseNumber): `oll:${number}` {
  if (!isOllCaseNumber(number)) {
    throw new RangeError(
      `OLL case number must be an integer from 1 to ${OLL_CASE_COUNT}; received ${number}.`,
    )
  }
  return `oll:${number}`
}

export interface CreateOllCaseInput {
  readonly number: OllCaseNumber
  readonly canonicalSignature: string
  readonly name?: string
  readonly groupId?: string
  readonly isSkip?: boolean
  readonly selectable?: boolean
  readonly diagramAsset?: string
  readonly referenceNotes?: string
}

export function createOllCaseDefinition(
  input: CreateOllCaseInput,
): TrainingCaseDefinition {
  const id = ollCaseId(input.number)
  return {
    id,
    setId: OLL_SET_ID,
    kind: 'oll-orientation',
    name: input.name ?? `OLL ${input.number}`,
    groupId: input.groupId ?? 'standard',
    canonicalSignature: input.canonicalSignature,
    isSkip: input.isSkip ?? false,
    selectable: input.selectable ?? true,
    diagramAsset: input.diagramAsset,
    alternativeAlgorithmIds: [],
    reference: {
      kind: 'mathematical-definition',
      notes:
        input.referenceNotes ??
        'OLL orientation identity; algorithm content is not bundled.',
    },
  }
}
