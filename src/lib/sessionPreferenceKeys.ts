import type { SessionPreferenceKey } from '../types'

/**
 * Every per-session preference that participates in field-level sync.
 * Kept in a dependency-free module so storage, session mutations, and merge
 * logic cannot form an import cycle.
 */
export const SESSION_PREFERENCE_KEYS: readonly SessionPreferenceKey[] = [
  'inspectionEnabled',
  'inspectionCountDirection',
  'inspectionWarning8s',
  'inspectionWarning12s',
  'inspectionWarningVisualScope',
  'scrambleAlignment',
  'scrambleLimitHeight',
  'scrambleAction',
  'timerUpdateMode',
  'holdDurationMs',
  'stopWithAnyKey',
  'showTimerDecimalSmall',
]
