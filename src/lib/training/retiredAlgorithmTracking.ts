import type { TrainingData } from './types'

/**
 * Algorithm-tracking retirement (2026-11-21).
 *
 * Tracking is temporarily removed from the product. Stored historical
 * attribution, preferred algorithms and custom algorithms are erased while the
 * validated case-only attempt structure, timing data, setups and visits remain
 * intact. The sanitizer is idempotent and is applied at every Training ingress:
 * local load, native backup, Drive backup and merge synchronization.
 */
export function stripRetiredAlgorithmTracking(data: TrainingData): TrainingData {
  const alreadyClear =
    data.customAlgorithms.length === 0 &&
    data.preferences.algorithmTracking !== true &&
    data.preferences.preferredAlgorithms.length === 0 &&
    data.attempts.every(
      (attempt) =>
        attempt.algorithmTracking !== true &&
        attempt.preferredAlgorithmAtStart === null &&
        attempt.attribution.kind === 'unknown' &&
        attempt.attribution.markedAt === null,
    )
  if (alreadyClear) return data

  return {
    ...data,
    customAlgorithms: [],
    preferences: {
      ...data.preferences,
      algorithmTracking: false,
      preferredAlgorithms: [],
    },
    attempts: data.attempts.map((attempt) => ({
      ...attempt,
      algorithmTracking: false,
      preferredAlgorithmAtStart: null,
      attribution: { kind: 'unknown' as const, markedAt: null },
    })),
  }
}
