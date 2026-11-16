import type { TrainingAttemptResult } from './types'

/** Unsupported legacy values stay in storage, explicitly excluded from performance. */
export function trainingOutcome(result: TrainingAttemptResult): 'success' | 'dnf' | 'unsupported' {
  if (result.status !== 'valid') return 'unsupported'
  if (result.penalty === 'none') return 'success'
  if (result.penalty === 'dnf') return 'dnf'
  return 'unsupported'
}
