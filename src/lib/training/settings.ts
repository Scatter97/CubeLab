/** Training-only settings. Reading legacy defaults never writes or migrates data. */
import { isDateTimestamp } from '../dates'
import type { TrainingBaselinePolicy, TrainingDomainSettings, TrainingPreferences } from './types'

export const TRAINING_DAY_MS = 86_400_000
export const DEFAULT_TRAINING_DOMAIN_SETTINGS: TrainingDomainSettings = Object.freeze({
  version: 1, requireRecalibrationWhenDue: false,
  baseline: Object.freeze({ kind: 'days', count: 90 }), trimPercent: 5, inactivityMinutes: 15,
})

export function assertPositiveInteger(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('Expected a positive safe integer')
}
export function assertTrainingTimestamp(value: number): void {
  if (!isDateTimestamp(value) || value < 0) throw new Error('Invalid Training timestamp')
}
export function assertBaselinePolicy(policy: TrainingBaselinePolicy): void {
  if (!policy || (policy.kind !== 'days' && policy.kind !== 'attempts')) throw new Error('Invalid Training baseline kind')
  assertPositiveInteger(policy.count)
}
export function assertTrimPercent(percent: number): void {
  if (!Number.isFinite(percent) || percent < 0 || percent >= 50) throw new Error('Training trimming must be from 0 up to, but excluding, 50 percent')
}
export function assertTrainingDomainSettings(settings: TrainingDomainSettings): void {
  if (!settings || settings.version !== 1 || typeof settings.requireRecalibrationWhenDue !== 'boolean') throw new Error('Invalid Training settings')
  assertBaselinePolicy(settings.baseline)
  assertTrimPercent(settings.trimPercent)
  assertPositiveInteger(settings.inactivityMinutes)
}
export function getTrainingDomainSettings(preferences: TrainingPreferences): TrainingDomainSettings {
  const settings = preferences.domain ?? DEFAULT_TRAINING_DOMAIN_SETTINGS
  assertTrainingDomainSettings(settings)
  return { ...settings, baseline: { ...settings.baseline } }
}
