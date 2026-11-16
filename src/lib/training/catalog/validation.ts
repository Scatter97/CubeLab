/**
 * Structural catalog validation.
 *
 * Validation reports every issue it can find instead of throwing on the first
 * one. It deliberately checks provenance/redistribution metadata and revision
 * links so a catalog cannot silently claim a licence or rewrite an algorithm's
 * historical identity.
 */

import { AUF_ALGS } from '../cube3'
import {
  isValidCatalogAlgorithm,
  normalizeCatalogAlgorithm,
} from '../notation'
import {
  isOllCaseNumber,
  OLL_SET_ID,
  OLL_SKIP_CASE_ID,
} from './ollCases'
import {
  isPllCaseId,
  PLL_CASE_BY_ID,
  PLL_CASE_BY_SIGNATURE,
  PLL_SET_ID,
} from './pllCases'
import type {
  AlgorithmId,
  TrainingAlgorithmRecord,
  TrainingCaseDefinition,
  TrainingCatalog,
} from './types'

export interface CatalogValidationIssue {
  readonly code: string
  readonly message: string
  readonly path?: string
}

export class CatalogValidationError extends Error {
  readonly issues: readonly CatalogValidationIssue[]

  constructor(issues: readonly CatalogValidationIssue[]) {
    super(
      `Training catalog validation failed with ${issues.length} issue(s): ${issues
        .map((issue) => issue.message)
        .join('; ')}`,
    )
    this.name = 'CatalogValidationError'
    this.issues = issues
  }
}

function issue(
  code: string,
  message: string,
  path?: string,
): CatalogValidationIssue {
  return { code, message, path }
}

function validateNotationRecord(
  algorithm: TrainingAlgorithmRecord,
  issues: CatalogValidationIssue[],
): void {
  const path = `algorithms.${algorithm.id}`
  if (!isValidCatalogAlgorithm(algorithm.notation)) {
    issues.push(
      issue(
        'algorithm-notation-invalid',
        `Algorithm ${algorithm.id} has invalid notation "${algorithm.notation}".`,
        path,
      ),
    )
  } else {
    const normalized = normalizeCatalogAlgorithm(algorithm.notation)
    if (normalized !== algorithm.normalizedNotation) {
      issues.push(
        issue(
          'algorithm-normalized-mismatch',
          `Algorithm ${algorithm.id} normalized notation does not match its notation.`,
          path,
        ),
      )
    }
  }

  if (algorithm.provenance.normalizedNotation !== algorithm.normalizedNotation) {
    issues.push(
      issue(
        'algorithm-provenance-normalized-mismatch',
        `Algorithm ${algorithm.id} provenance normalized notation does not match the record.`,
        path,
      ),
    )
  }

  const correction = algorithm.provenance.correction
  if (correction) {
    if (!correction.originalNotation.trim()) {
      issues.push(
        issue(
          'algorithm-correction-empty-original',
          `Algorithm ${algorithm.id} correction is missing the original source notation.`,
          path,
        ),
      )
    }
    if (!correction.approvedOn.trim() || !correction.reason.trim()) {
      issues.push(
        issue(
          'algorithm-correction-metadata',
          `Algorithm ${algorithm.id} correction is missing an approval date or reason.`,
          path,
        ),
      )
    }
    if (
      algorithm.provenance.originalNotation !== undefined &&
      algorithm.provenance.originalNotation !== correction.originalNotation
    ) {
      issues.push(
        issue(
          'algorithm-correction-original-mismatch',
          `Algorithm ${algorithm.id} provenance original notation does not match its correction record.`,
          path,
        ),
      )
    }
    if (isValidCatalogAlgorithm(correction.approvedNotation)) {
      if (
        normalizeCatalogAlgorithm(correction.approvedNotation) !==
        algorithm.normalizedNotation
      ) {
        issues.push(
          issue(
            'algorithm-correction-approved-mismatch',
            `Algorithm ${algorithm.id} approved correction does not normalize to the record notation.`,
            path,
          ),
        )
      }
    } else {
      issues.push(
        issue(
          'algorithm-correction-approved-invalid',
          `Algorithm ${algorithm.id} approved correction has invalid notation.`,
          path,
        ),
      )
    }
    if (correction.originalNotation === correction.approvedNotation) {
      issues.push(
        issue(
          'algorithm-correction-no-change',
          `Algorithm ${algorithm.id} correction does not change the source notation.`,
          path,
        ),
      )
    }
  } else {
    const original = algorithm.provenance.originalNotation
    if (original !== undefined && isValidCatalogAlgorithm(original)) {
      if (
        normalizeCatalogAlgorithm(original) !== algorithm.normalizedNotation
      ) {
        issues.push(
          issue(
            'algorithm-original-normalized-mismatch',
            `Algorithm ${algorithm.id} original notation does not normalize to the record notation.`,
            path,
          ),
        )
      }
    } else if (original !== undefined) {
      issues.push(
        issue(
          'algorithm-original-invalid',
          `Algorithm ${algorithm.id} original notation is invalid and has no correction record.`,
          path,
        ),
      )
    }
  }

  const verification = algorithm.verification
  if (!verification.verifiedAt.trim()) {
    issues.push(
      issue(
        'algorithm-verification-date-missing',
        `Algorithm ${algorithm.id} is missing a verification date.`,
        path,
      ),
    )
  }
  if (verification.checkedAufs.length === 0) {
    issues.push(
      issue(
        'algorithm-verification-aufs-missing',
        `Algorithm ${algorithm.id} does not record any checked AUF variants.`,
        path,
      ),
    )
  }
  for (const auf of verification.checkedAufs) {
    if (!(AUF_ALGS as readonly string[]).includes(auf)) {
      issues.push(
        issue(
          'algorithm-verification-auf-invalid',
          `Algorithm ${algorithm.id} records invalid AUF "${auf}".`,
          path,
        ),
      )
    }
  }
  if (verification.status === 'verified' && !verification.solvesCase) {
    issues.push(
      issue(
        'algorithm-verified-without-case',
        `Algorithm ${algorithm.id} is marked verified but does not claim to solve its case.`,
        path,
      ),
    )
  }
}

/**
 * Validates an algorithm revision before it is added to a future catalog.
 * A changed notation must use a new stable ID and a replacement reference.
 */
export function validateAlgorithmRevision(
  previous: TrainingAlgorithmRecord,
  next: TrainingAlgorithmRecord,
): readonly CatalogValidationIssue[] {
  const issues: CatalogValidationIssue[] = []

  if (previous.caseId !== next.caseId) {
    issues.push(
      issue(
        'algorithm-revision-case-changed',
        `Algorithm revision ${next.id} changed its case from ${previous.caseId} to ${next.caseId}.`,
      ),
    )
  }

  if (previous.id === next.id) {
    if (previous.normalizedNotation !== next.normalizedNotation) {
      issues.push(
        issue(
          'algorithm-id-reused',
          `Algorithm ID ${next.id} was reused for changed notation; create a new ID and replacement link.`,
        ),
      )
    }
    if (previous.version !== next.version) {
      issues.push(
        issue(
          'algorithm-version-mutated',
          `Algorithm ID ${next.id} kept its ID but changed version from ${previous.version} to ${next.version}.`,
        ),
      )
    }
  } else {
    if (next.replacesAlgorithmId !== previous.id) {
      issues.push(
        issue(
          'algorithm-revision-link-missing',
          `New algorithm ${next.id} must reference the replaced algorithm ${previous.id}.`,
        ),
      )
    }
    if (next.version <= previous.version) {
      issues.push(
        issue(
          'algorithm-revision-version-not-incremented',
          `Algorithm ${next.id} version ${next.version} must be greater than replaced version ${previous.version}.`,
        ),
      )
    }
  }

  return issues
}

export function validateCatalog(
  catalog: TrainingCatalog,
): readonly CatalogValidationIssue[] {
  const issues: CatalogValidationIssue[] = []

  if (!catalog.version.trim()) {
    issues.push(
      issue('catalog-version-missing', 'Catalog version is empty.', 'version'),
    )
  }

  const setIds = new Set<string>()
  for (const set of catalog.sets) {
    if (!set.id.trim()) {
      issues.push(issue('set-id-missing', 'Algorithm set ID is empty.', 'sets'))
    }
    if (setIds.has(set.id)) {
      issues.push(
        issue(
          'set-id-duplicate',
          `Duplicate algorithm set ID "${set.id}".`,
          'sets',
        ),
      )
    }
    setIds.add(set.id)
    if (!Number.isInteger(set.standardCaseCount) || set.standardCaseCount < 0) {
      issues.push(
        issue(
          'set-case-count-invalid',
          `Algorithm set ${set.id} has an invalid standard case count.`,
          'sets',
        ),
      )
    }
  }

  const caseById = new Map<string, TrainingCaseDefinition>()
  const signatureBySet = new Map<string, string>()
  const skipBySet = new Map<string, string>()

  for (const definition of catalog.cases) {
    const path = `cases.${definition.id}`
    if (!definition.id.trim()) {
      issues.push(issue('case-id-missing', 'Case ID is empty.', 'cases'))
    }
    if (caseById.has(definition.id)) {
      issues.push(
        issue(
          'case-id-duplicate',
          `Duplicate case ID "${definition.id}".`,
          path,
        ),
      )
    }
    caseById.set(definition.id, definition)

    if (!setIds.has(definition.setId)) {
      issues.push(
        issue(
          'case-set-missing',
          `Case ${definition.id} references unknown set "${definition.setId}".`,
          path,
        ),
      )
    }
    if (!definition.name.trim() || !definition.groupId.trim()) {
      issues.push(
        issue(
          'case-metadata-missing',
          `Case ${definition.id} is missing a display name or group.`,
          path,
        ),
      )
    }

    if (
      definition.setId === OLL_SET_ID &&
      definition.kind !== 'oll-orientation'
    ) {
      issues.push(
        issue(
          'case-kind-set-mismatch',
          `Set ${OLL_SET_ID} cases must use OLL orientation identity.`,
          path,
        ),
      )
    }
    if (
      definition.setId === PLL_SET_ID &&
      definition.kind !== 'pll-permutation'
    ) {
      issues.push(
        issue(
          'case-kind-set-mismatch',
          `Set ${PLL_SET_ID} cases must use PLL permutation identity.`,
          path,
        ),
      )
    }

    if (definition.kind === 'oll-orientation') {
      if (
        definition.setId === OLL_SET_ID &&
        definition.id !== OLL_SKIP_CASE_ID &&
        !isOllCaseNumber(Number(definition.id.split(':')[1]))
      ) {
        issues.push(
          issue(
            'case-oll-id-invalid',
            `OLL case ID "${definition.id}" must be oll:1–oll:57 or ${OLL_SKIP_CASE_ID}.`,
            path,
          )
        )
      }
      if (!/^[0-2]{4}\|[0-1]{4}$/.test(definition.canonicalSignature)) {
        issues.push(
          issue(
            'case-oll-signature-invalid',
            `OLL case ${definition.id} has an invalid orientation signature.`,
            path,
          ),
        )
      }
    } else if (definition.kind === 'pll-permutation') {
      // Future sets may reuse PLL permutation semantics without adopting the
      // standard PLL case names. Only the PLL set itself is mapped to the
      // standard 22 named identities.
      if (definition.setId === PLL_SET_ID) {
        const standard = isPllCaseId(definition.id)
          ? PLL_CASE_BY_ID.get(definition.id)
          : undefined
        const signatureCase = PLL_CASE_BY_SIGNATURE.get(
          definition.canonicalSignature,
        )
        if (!standard || !signatureCase) {
          issues.push(
            issue(
              'case-pll-identity-invalid',
              `PLL case ${definition.id} is not a standard named PLL identity.`,
              path,
            ),
          )
        } else if (signatureCase.id !== standard.id) {
          issues.push(
            issue(
              'case-pll-signature-mismatch',
              `PLL case ${definition.id} has the signature of ${signatureCase.id}.`,
              path,
            ),
          )
        }
      }
    }

    const signatureKey = `${definition.setId}\u0000${definition.canonicalSignature}`
    const duplicateCase = signatureBySet.get(signatureKey)
    if (duplicateCase) {
      issues.push(
        issue(
          'case-signature-duplicate',
          `Cases ${duplicateCase} and ${definition.id} share a canonical signature.`,
          path,
        ),
      )
    } else {
      signatureBySet.set(signatureKey, definition.id)
    }

    if (definition.isSkip) {
      const existingSkip = skipBySet.get(definition.setId)
      if (existingSkip) {
        issues.push(
          issue(
            'case-skip-duplicate',
            `Set ${definition.setId} has multiple skip cases (${existingSkip}, ${definition.id}).`,
            path,
          ),
        )
      }
      skipBySet.set(definition.setId, definition.id)
      if (definition.selectable) {
        issues.push(
          issue(
            'case-skip-selectable',
            `Skip case ${definition.id} must not be selectable.`,
            path,
          ),
        )
      }
    }
  }

  const algorithmById = new Map<string, TrainingAlgorithmRecord>()
  for (const algorithm of catalog.algorithms) {
    const path = `algorithms.${algorithm.id}`
    if (!algorithm.id.trim()) {
      issues.push(
        issue('algorithm-id-missing', 'Algorithm ID is empty.', 'algorithms'),
      )
    }
    if (algorithmById.has(algorithm.id)) {
      issues.push(
        issue(
          'algorithm-id-duplicate',
          `Duplicate algorithm ID "${algorithm.id}".`,
          path,
        ),
      )
    } else {
      algorithmById.set(algorithm.id, algorithm)
    }
  }

  for (const algorithm of catalog.algorithms) {
    const path = `algorithms.${algorithm.id}`

    if (!Number.isInteger(algorithm.version) || algorithm.version < 1) {
      issues.push(
        issue(
          'algorithm-version-invalid',
          `Algorithm ${algorithm.id} has an invalid version.`,
          path,
        ),
      )
    }

    const definition = caseById.get(algorithm.caseId)
    if (!definition) {
      issues.push(
        issue(
          'algorithm-case-missing',
          `Algorithm ${algorithm.id} references unknown case "${algorithm.caseId}".`,
          path,
        ),
      )
    } else if (algorithm.setId !== definition.setId) {
      issues.push(
        issue(
          'algorithm-set-mismatch',
          `Algorithm ${algorithm.id} set does not match case ${definition.id}.`,
          path,
        ),
      )
    }

    if (algorithm.source === 'user') {
      issues.push(
        issue(
          'algorithm-user-in-bundled-catalog',
          `User algorithm ${algorithm.id} must be stored separately from the bundled catalog.`,
          path,
        ),
      )
    }
    if (algorithm.source === 'bundled' && !algorithm.immutable) {
      issues.push(
        issue(
          'algorithm-bundled-mutable',
          `Bundled algorithm ${algorithm.id} must be immutable.`,
          path,
        ),
      )
    }
    if (algorithm.source === 'bundled') {
      if (algorithm.provenance.redistribution === 'unresolved') {
        issues.push(
          issue(
            'algorithm-redistribution-unresolved',
            `Bundled algorithm ${algorithm.id} has unresolved redistribution rights and must not be included in a distributable catalog.`,
            path,
          ),
        )
      }
      if (algorithm.verification.status !== 'verified') {
        issues.push(
          issue(
            'algorithm-bundled-unverified',
            `Bundled algorithm ${algorithm.id} must be verified.`,
            path,
          ),
        )
      }
    }

    validateNotationRecord(algorithm, issues)

    if (algorithm.replacesAlgorithmId) {
      const replaced = algorithmById.get(algorithm.replacesAlgorithmId)
      if (!replaced) {
        issues.push(
          issue(
            'algorithm-replacement-missing',
            `Algorithm ${algorithm.id} references unknown replacement ${algorithm.replacesAlgorithmId}.`,
            path,
          ),
        )
      } else {
        if (replaced.caseId !== algorithm.caseId) {
          issues.push(
            issue(
              'algorithm-replacement-case-mismatch',
              `Algorithm ${algorithm.id} replaces an algorithm for a different case.`,
              path,
            ),
          )
        }
        if (algorithm.version <= replaced.version) {
          issues.push(
            issue(
              'algorithm-replacement-version',
              `Algorithm ${algorithm.id} version must exceed replaced version ${replaced.version}.`,
              path,
            ),
          )
        }
      }
    }
  }

  function requireAlgorithm(
    id: AlgorithmId,
    caseId: string,
    description: string,
    path: string,
  ): TrainingAlgorithmRecord | undefined {
    const algorithm = algorithmById.get(id)
    if (!algorithm) {
      issues.push(
        issue(
          'case-algorithm-missing',
          `${description} ${id} for case ${caseId} does not exist.`,
          path,
        ),
      )
      return undefined
    }
    if (algorithm.caseId !== caseId) {
      issues.push(
        issue(
          'case-algorithm-case-mismatch',
          `${description} ${id} belongs to ${algorithm.caseId}, not ${caseId}.`,
          path,
        ),
      )
    }
    return algorithm
  }

  for (const definition of catalog.cases) {
    const path = `cases.${definition.id}`
    if (
      definition.defaultAlgorithmId &&
      definition.alternativeAlgorithmIds.includes(
        definition.defaultAlgorithmId,
      )
    ) {
      issues.push(
        issue(
          'case-default-is-alternative',
          `Case ${definition.id} lists its default algorithm as an alternative.`,
          path,
        ),
      )
    }

    if (definition.defaultAlgorithmId) {
      const algorithm = requireAlgorithm(
        definition.defaultAlgorithmId,
        definition.id,
        'Default algorithm',
        path,
      )
      if (
        algorithm &&
        (algorithm.verification.status !== 'verified' ||
          !algorithm.verification.solvesCase)
      ) {
        issues.push(
          issue(
            'case-default-unverified',
            `Case ${definition.id} default algorithm is not verified.`,
            path,
          ),
        )
      }
    }

    const seenAlternatives = new Set<string>()
    for (const alternativeId of definition.alternativeAlgorithmIds) {
      if (seenAlternatives.has(alternativeId)) {
        issues.push(
          issue(
            'case-alternative-duplicate',
            `Case ${definition.id} repeats alternative ${alternativeId}.`,
            path,
          ),
        )
      }
      seenAlternatives.add(alternativeId)
      const algorithm = requireAlgorithm(
        alternativeId,
        definition.id,
        'Alternative algorithm',
        path,
      )
      if (
        algorithm &&
        (algorithm.verification.status !== 'verified' ||
          !algorithm.verification.solvesCase)
      ) {
        issues.push(
          issue(
            'case-alternative-unverified',
            `Case ${definition.id} alternative ${alternativeId} is not verified.`,
            path,
          ),
        )
      }
    }

    if (definition.generatorAlgorithmId) {
      const algorithm = requireAlgorithm(
        definition.generatorAlgorithmId,
        definition.id,
        'Generator algorithm',
        path,
      )
      if (
        algorithm &&
        (algorithm.verification.status !== 'verified' ||
          !algorithm.verification.solvesCase ||
          !algorithm.verification.frameNormalized)
      ) {
        issues.push(
          issue(
            'case-generator-unverified',
            `Case ${definition.id} generator must be verified, solve the case, and be frame-normalized.`,
            path,
          ),
        )
      }
    }

    if (definition.isSkip && definition.defaultAlgorithmId) {
      issues.push(
        issue(
          'case-skip-has-algorithm',
          `Skip case ${definition.id} must not own a default training algorithm.`,
          path,
        ),
      )
    }

    if (
      catalog.contentStatus === 'complete' &&
      !definition.isSkip &&
      (!definition.defaultAlgorithmId || !definition.generatorAlgorithmId)
    ) {
      issues.push(
        issue(
          'case-complete-content-missing',
          `Complete catalog case ${definition.id} is missing a default or generator algorithm.`,
          path,
        ),
      )
    }
  }

  return issues
}

export function assertValidCatalog(catalog: TrainingCatalog): void {
  const issues = validateCatalog(catalog)
  if (issues.length > 0) {
    throw new CatalogValidationError(issues)
  }
}
