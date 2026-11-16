/** Local Training domain. Never put these records in PuzzleEvent/Solve/Session. */
import type { AlgorithmVerificationMetadata, TrainingAlgorithmRecord } from './catalog/types'
import type { PllStandardCaseId } from './catalog/standardCases'
import { OLL_INSERTION, PLL_PRECURSOR } from './cube3'
import type { GeneratedTrainingSetup, TrainingSetupMode } from './setupGeneration'

export type TrainingSetId = 'oll' | 'pll'
export type TrainingCaseId = `oll:${number}` | PllStandardCaseId
export type TrainingMode = TrainingSetupMode
export type TrainingCategoryId = `${TrainingSetId}:${TrainingMode}`

export const TRAINING_CATEGORIES = [
  'oll:execution', 'oll:recognition', 'pll:execution', 'pll:recognition',
] as const satisfies readonly TrainingCategoryId[]

export const TRAINING_PRECURSORS = {
  oll: { id: 'oll:fr-insertion:v1', notation: OLL_INSERTION },
  pll: { id: 'pll:sune:v1', notation: PLL_PRECURSOR },
} as const
export type TrainingPrecursorId = typeof TRAINING_PRECURSORS[TrainingSetId]['id']

/** A detached historical reference; absence of notation does not mean unknown ID. */
export interface TrainingAlgorithmSnapshot {
  readonly id: string
  readonly revision: number
  readonly notation: string | null
}

/** No smart-cube observation is inferred from the setup generator. */
export type TrainingAlgorithmAttribution =
  | { readonly kind: 'assumed-preferred'; readonly algorithm: TrainingAlgorithmSnapshot }
  | { readonly kind: 'user-corrected'; readonly algorithm: TrainingAlgorithmSnapshot; readonly correctedAt: number }
  | { readonly kind: 'unknown'; readonly markedAt: number | null }

export type TrainingBaselinePolicy = { readonly kind: 'days' | 'attempts'; readonly count: number }

export interface TrainingDomainSettings {
  readonly version: 1
  readonly requireRecalibrationWhenDue: boolean
  readonly baseline: TrainingBaselinePolicy
  readonly trimPercent: number
  readonly inactivityMinutes: number
}

export interface TrainingCalibrationSnapshot {
  /** Absent on Phase 3A history. Never infer reference-state fidelity for it. */
  readonly protocol?: 'fixed-inverse-precursor:v1'
  readonly version: 1
  readonly id: string
  readonly setId: TrainingSetId
  readonly precursorId: TrainingPrecursorId
  readonly precursorNotation: string
  readonly samplesMs: readonly [number, number, number, number, number, number, number]
  /** Historical median; new fixed-protocol records validate the complete calculation. */
  readonly medianMs: number
  readonly measuredAt: number
  readonly recognitionAttemptsAtMeasurement: number
  readonly renewal: { readonly days: number; readonly recognitionAttempts: number }
}

export interface TrainingCalibration extends TrainingCalibrationSnapshot {
  readonly source: 'initial' | 'manual' | 'due'
  readonly invalidSampleCount: number
}

export interface TrainingSetupSnapshot {
  readonly version: 1
  readonly generatedAt: number
  readonly generatorVersion: string
  /** Generator identity is distinct from the algorithm the user may execute. */
  readonly generatorAlgorithm: TrainingAlgorithmSnapshot
  readonly generated: GeneratedTrainingSetup
}

export type TrainingCompletedResult = { readonly status: 'valid'; readonly penalty: 'none' | 'dnf' }

/** Legacy alternatives exist only so v1 history stays readable. */
export type TrainingAttemptResult =
  | TrainingCompletedResult
  | { readonly status: 'valid'; readonly penalty: '+2' }
  | { readonly status: 'invalid'; readonly reason: string }

export interface TrainingAttempt {
  readonly rulesVersion?: 1
  /** Absent on historical attempts. False attempts are permanently case-only. */
  readonly algorithmTracking?: boolean
  readonly estimateUnavailableReason?: 'below-calibration' | 'dnf' | 'not-recorded'
  readonly resultCorrectedAt?: number
  readonly version: 1
  readonly id: string
  readonly setId: TrainingSetId
  readonly mode: TrainingMode
  /** Permanent, validated against setId/mode. Never derived from current preferences. */
  readonly categoryId: TrainingCategoryId
  readonly caseId: TrainingCaseId
  readonly createdAt: number
  readonly visitId: string
  readonly rawMs: number
  /** Legacy +2/invalid values remain readable, but new Training is success or DNF only. */
  readonly result: TrainingAttemptResult
  readonly preferredAlgorithmAtStart: TrainingAlgorithmSnapshot | null
  readonly attribution: TrainingAlgorithmAttribution
  readonly setup: TrainingSetupSnapshot
  readonly precursorId: TrainingPrecursorId | null
  readonly calibration: TrainingCalibrationSnapshot | null
  /** Estimated recognition + execution; never replaces rawMs or gets backfilled. */
  readonly estimatedRecognitionExecutionMs: number | null
}

/** User-only catalog-compatible record; built-in defaults never live here. */
export interface TrainingCustomAlgorithm extends Pick<TrainingAlgorithmRecord,
  'id' | 'version' | 'setId' | 'caseId' | 'notation' | 'normalizedNotation' | 'replacesAlgorithmId'> {
  readonly source: 'user'
  readonly createdAt: number
  readonly label: string
  readonly verification: AlgorithmVerificationMetadata | null
}

export interface TrainingSetPreferences {
  readonly enabledCaseIds: readonly TrainingCaseId[]
  readonly difficultCaseIds: readonly TrainingCaseId[]
  readonly includeSetupMoves: boolean
  readonly selectedPresetId: string | null
  readonly recognition: {
    readonly renewalDays: number
    readonly renewalAttempts: number
  }
}

export interface TrainingPreset {
  readonly version: 1
  readonly id: string
  readonly name: string
  readonly setId: TrainingSetId
  readonly caseIds: readonly TrainingCaseId[]
  readonly includeSetupMoves: boolean
  readonly kind: 'built-in' | 'user' | 'difficult'
  readonly createdAt: number
  readonly updatedAt: number
}

export interface TrainingPreferences {
  /** Absent on earlier v1 data and treated as off. */
  readonly algorithmTracking?: boolean
  /** Optional additive v1 extension; read-time defaults never rewrite stored records. */
  readonly domain?: TrainingDomainSettings
  readonly version: 1
  readonly selectedSetId: TrainingSetId
  readonly sets: Readonly<Record<TrainingSetId, TrainingSetPreferences>>
  readonly preferredAlgorithms: readonly {
    readonly caseId: TrainingCaseId
    readonly algorithm: TrainingAlgorithmSnapshot
  }[]
  readonly categories: Readonly<Record<TrainingCategoryId, {
    readonly recognitionMetric: 'raw' | 'estimated'
  }>>
  /** Legacy reserved JSON settings. Typed report policy now lives in domain.baseline. */
  readonly reportSettings: Readonly<Record<string, TrainingJsonValue>>
}

export type TrainingAlgorithmOverrides = Partial<Record<TrainingCaseId, TrainingAlgorithmSnapshot>>

export type TrainingJsonValue = null | boolean | number | string |
  readonly TrainingJsonValue[] | { readonly [key: string]: TrainingJsonValue }

export type TrainingVisitEndReason = 'navigation' | 'category-switch' | 'tab-closed' | 'inactivity' | 'manual'
export type TrainingReportDestination = 'training' | 'timer' | 'analytics'

export interface TrainingVisitLifecycle {
  readonly version: 1
  readonly lastActivityAt: number
  readonly baseline: TrainingBaselinePolicy
  readonly inactivityMinutes: number
  readonly endReason: TrainingVisitEndReason | null
  readonly reportPending: boolean
  readonly reportDestination?: TrainingReportDestination
  readonly pausedMs?: number
}

export interface TrainingSessionConfiguration {
  readonly version: 1
  readonly name: string
  readonly cases: readonly {
    readonly caseId: TrainingCaseId
    readonly algorithm: TrainingAlgorithmSnapshot
  }[]
}

export interface TrainingVisit {
  /** Present only on explicitly begun sessions; historical visits are left as stored. */
  readonly session?: TrainingSessionConfiguration
  readonly lifecycle?: TrainingVisitLifecycle
  readonly version: 1
  readonly id: string
  readonly startedAt: number
  readonly endedAt: number | null
  readonly startedCategoryId: TrainingCategoryId
  /** Legacy visits may span categories; new lifecycle visits have exactly one. */
  readonly categoryIds: readonly TrainingCategoryId[]
  readonly attemptIds: readonly string[]
  /** Legacy reserved reference. Reports are recalculated by stable visit ID. */
  readonly summaryId: string | null
}

export interface TrainingData {
  /** Durable high-water totals; independent from retained/deleted attempts. */
  readonly recognitionCounts?: Readonly<Record<TrainingSetId, number>>
  readonly version: 1
  readonly preferences: TrainingPreferences
  readonly presets: readonly TrainingPreset[]
  readonly customAlgorithms: readonly TrainingCustomAlgorithm[]
  readonly attempts: readonly TrainingAttempt[]
  readonly calibrations: readonly TrainingCalibration[]
  readonly visits: readonly TrainingVisit[]
  readonly activeVisitId: string | null
}
