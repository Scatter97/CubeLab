/**
 * Cube-state validation for an assembled catalog.
 *
 * Structural validation cannot prove that a canonical signature is genuinely
 * canonical or that an algorithm solves its case. This layer reconstructs each
 * OLL/PLL representative and re-verifies each algorithm with the cube model.
 * Future sets are left to their own identity implementations.
 */

import type { Cube3Model } from '../cube3'
import { verifyAlgorithmRecordForCase } from '../algorithms'
import { buildCaseRepresentativeState } from '../caseState'
import { OLL_SET_ID } from './ollCases'
import { PLL_SET_ID } from './pllCases'
import type { TrainingCatalog } from './types'
import {
  CatalogValidationError,
  type CatalogValidationIssue,
} from './validation'

export interface CatalogStateValidationOptions {
  readonly model: Cube3Model
  readonly verifiedAt?: string
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function validateCatalogStates(
  catalog: TrainingCatalog,
  options: CatalogStateValidationOptions,
): readonly CatalogValidationIssue[] {
  const issues: CatalogValidationIssue[] = []
  const caseById = new Map(
    catalog.cases.map((definition) => [definition.id, definition]),
  )

  for (const definition of catalog.cases) {
    if (
      definition.setId !== OLL_SET_ID &&
      definition.setId !== PLL_SET_ID
    ) {
      continue
    }
    try {
      buildCaseRepresentativeState(options.model, definition)
    } catch (error) {
      issues.push({
        code: 'case-state-invalid',
        message: `Case ${definition.id} cannot be represented by its declared signature: ${errorMessage(error)}`,
        path: `cases.${definition.id}`,
      })
    }
  }

  for (const algorithm of catalog.algorithms) {
    const definition = caseById.get(algorithm.caseId)
    if (
      !definition ||
      (definition.setId !== OLL_SET_ID &&
        definition.setId !== PLL_SET_ID)
    ) {
      continue
    }
    try {
      verifyAlgorithmRecordForCase(
        options.model,
        definition,
        algorithm,
        options.verifiedAt ?? 'runtime',
      )
    } catch (error) {
      issues.push({
        code: 'algorithm-state-invalid',
        message: `Algorithm ${algorithm.id} failed cube-state verification: ${errorMessage(error)}`,
        path: `algorithms.${algorithm.id}`,
      })
    }
  }

  return issues
}

export function assertValidCatalogStates(
  catalog: TrainingCatalog,
  options: CatalogStateValidationOptions,
): void {
  const issues = validateCatalogStates(catalog, options)
  if (issues.length > 0) {
    throw new CatalogValidationError(issues)
  }
}
