/**
 * Reusable training-catalog types.
 *
 * Built-in default records live in `defaultAlgorithms.ts`; user preferences and
 * custom algorithms remain in the separate local Training store.
 */

import type { Auf } from '../cube3'

export type AlgorithmSetId = string
export type CaseId = string
export type AlgorithmId = string

/** Identity semantics required to verify a case state. */
export type CaseKind = 'oll-orientation' | 'pll-permutation'

export interface AlgorithmSetDefinition {
  readonly id: AlgorithmSetId
  readonly name: string
  /** Number of standard trainable cases (excluding a skip identity). */
  readonly standardCaseCount: number
  /** True when the set's case space also has a named solved/skip identity. */
  readonly includesSkipIdentity: boolean
}

export interface CaseReferenceMetadata {
  readonly kind:
    | 'mathematical-definition'
    | 'owner-approved-reference'
    | 'generated'
  readonly notes?: string
}

export interface TrainingCaseDefinition {
  readonly id: CaseId
  readonly setId: AlgorithmSetId
  readonly kind: CaseKind
  readonly name: string
  readonly groupId: string
  /** Stable case signature used by the set's identity function. */
  readonly canonicalSignature: string
  /** Solved/skip identities are recognized but are not trainable cases. */
  readonly isSkip: boolean
  readonly selectable: boolean
  /**
   * Optional raw signature used to construct a conventional representative
   * state for display. The case identity remains `canonicalSignature`; PLL
   * diagrams use a post-AUF raw permutation so the illustration matches the
   * conventional named-case shape rather than an arbitrary double-coset member.
   */
  readonly representativeSignature?: string
  readonly diagramAsset?: string
  readonly defaultAlgorithmId?: AlgorithmId
  readonly alternativeAlgorithmIds: readonly AlgorithmId[]
  readonly generatorAlgorithmId?: AlgorithmId
  readonly reference?: CaseReferenceMetadata
}

export interface AlgorithmCorrection {
  /** Original source notation, preserved for traceability. */
  readonly originalNotation: string
  /** Owner-approved replacement notation. */
  readonly approvedNotation: string
  readonly approvedOn: string
  readonly reason: string
}

export interface AlgorithmApproval {
  readonly approvedBy: 'owner'
  readonly approvedOn: string
  readonly notes?: string
}

export interface AlgorithmProvenance {
  readonly sourceKind:
    | 'owner-approved'
    | 'independently-authored'
    | 'user'
    | 'unknown'
  readonly sourceRepository?: string
  readonly sourceCommit?: string
  readonly sourcePath?: string
  readonly originalNotation?: string
  readonly normalizedNotation: string
  readonly correction?: AlgorithmCorrection
  readonly approval?: AlgorithmApproval
  /**
   * Redistribution status is deliberately explicit. Owner approval or a code
   * licence does not by itself establish permission to redistribute algorithm
   * data.
   */
  readonly redistribution: 'unresolved' | 'permitted' | 'not-applicable'
  readonly redistributionNotes?: string
}

export interface AlgorithmVerificationMetadata {
  readonly status: 'verified' | 'unverified'
  readonly method: 'cube-state' | 'case-identity'
  readonly verifiedAt: string
  readonly frameNormalized: boolean
  readonly frameCorrection?: string
  readonly frameNormalizedNotation?: string
  readonly solvesCase: boolean
  readonly checkedAufs: readonly Auf[]
  readonly notes?: string
}

export interface TrainingAlgorithmRecord {
  readonly id: AlgorithmId
  readonly version: number
  readonly caseId: CaseId
  readonly setId: AlgorithmSetId
  readonly source: 'bundled' | 'user'
  readonly label?: string
  readonly notation: string
  readonly normalizedNotation: string
  readonly immutable: boolean
  /**
   * Stable revision link. Changing a bundled algorithm's notation requires a
   * new ID and a replacement reference so historical attribution is not
   * rewritten.
   */
  readonly replacesAlgorithmId?: AlgorithmId
  readonly provenance: AlgorithmProvenance
  readonly verification: AlgorithmVerificationMetadata
}

export interface TrainingCatalog {
  readonly version: string
  /**
   * `identity-only` and `partial` explicitly mean the complete production
   * catalog/content gate has not been satisfied.
   */
  readonly contentStatus: 'identity-only' | 'partial' | 'complete'
  readonly sets: readonly AlgorithmSetDefinition[]
  readonly cases: readonly TrainingCaseDefinition[]
  /**
   * Bundled/catalog algorithm definitions only. User preferences and custom
   * algorithms belong in the future separate training-data store, not here.
   */
  readonly algorithms: readonly TrainingAlgorithmRecord[]
}
