import type {
  AnalyticsSectionId,
  AnalyticsSectionSetting,
  AnalyticsSettings,
  PuzzleEvent,
} from '../types'

export const ANALYTICS_SECTION_IDS: readonly AnalyticsSectionId[] = [
  'overview',
  'progression',
  'averages',
  'personalBests',
  'distribution',
  'consistency',
  'subX',
  'sessions',
  'activity',
  'advanced',
]

export const ANALYTICS_SECTION_LABELS: Record<AnalyticsSectionId, string> = {
  overview: 'Statistics overview',
  progression: 'Time progression',
  averages: 'Average progression',
  personalBests: 'Historical personal bests',
  distribution: 'Solve time distribution',
  consistency: 'Consistency',
  subX: 'Sub-X analysis',
  sessions: 'Session comparison',
  activity: 'Practice activity',
  advanced: 'Advanced analytics',
}

/**
 * Sections removed from the dashboard but still present in older synchronized
 * settings. They are ignored during normalization rather than invalidating the
 * whole saved layout.
 */
export const RETIRED_ANALYTICS_SECTION_IDS: readonly string[] = ['explorer']

/** Sub-X targets use whole seconds and are intentionally generous defaults. */
export const DEFAULT_SUB_X_TARGETS_MS: Partial<Record<PuzzleEvent, number>> = {
  '333': 20_000,
  '222': 5_000,
  '444': 60_000,
  '333oh': 30_000,
  '555': 90_000,
  '666': 150_000,
  '777': 210_000,
  pyram: 8_000,
  skewb: 8_000,
  sq1: 30_000,
  clock: 15_000,
  minx: 90_000,
}

/**
 * Quick Sub-X targets in milliseconds. Only built-in events with meaningful
 * community targets are listed; custom and unusual puzzles keep free entry.
 */
const SUB_X_PRESETS_MS: Partial<Record<PuzzleEvent, readonly number[]>> = {
  '333': [10_000, 15_000, 20_000, 30_000],
  '222': [2_000, 3_000, 5_000, 10_000],
  '444': [30_000, 45_000, 60_000, 90_000],
  '333oh': [15_000, 20_000, 30_000, 45_000],
  '555': [60_000, 90_000, 120_000, 180_000],
  '666': [120_000, 150_000, 180_000, 240_000],
  '777': [150_000, 210_000, 300_000, 420_000],
  pyram: [3_000, 5_000, 8_000, 12_000],
  skewb: [3_000, 5_000, 8_000, 12_000],
  sq1: [15_000, 20_000, 30_000, 45_000],
  clock: [8_000, 10_000, 15_000, 20_000],
  minx: [60_000, 90_000, 120_000, 180_000],
}

export function getSubXPresetsMs(event: PuzzleEvent): readonly number[] {
  return SUB_X_PRESETS_MS[event] ?? []
}

export const DEFAULT_ANALYTICS_SECTIONS: readonly AnalyticsSectionSetting[] =
  ANALYTICS_SECTION_IDS.map((id) => ({
    id,
    visible: true,
    wide: id === 'overview' || id === 'progression',
  }))

export function createDefaultAnalyticsSettings(): AnalyticsSettings {
  return {
    sections: DEFAULT_ANALYTICS_SECTIONS.map((section) => ({ ...section })),
    subXTargetsMs: { ...DEFAULT_SUB_X_TARGETS_MS },
  }
}

export const DEFAULT_ANALYTICS_SETTINGS: AnalyticsSettings =
  createDefaultAnalyticsSettings()

export function isAnalyticsSectionId(
  value: unknown,
): value is AnalyticsSectionId {
  return (
    typeof value === 'string' &&
    ANALYTICS_SECTION_IDS.includes(value as AnalyticsSectionId)
  )
}

export function getSubXTargetMs(
  analytics: AnalyticsSettings,
  event: PuzzleEvent,
): number {
  const target = analytics.subXTargetsMs[event]
  return target !== undefined && Number.isFinite(target) && target > 0
    ? target
    : DEFAULT_SUB_X_TARGETS_MS[event] ?? 20_000
}

/**
 * Fill missing sections and drop unknown/duplicate entries so a dashboard can
 * gain new sections in a later release without losing a saved layout.
 */
export function normalizeAnalyticsSections(
  value: unknown,
): AnalyticsSectionSetting[] {
  const sections: AnalyticsSectionSetting[] = []
  const seen = new Set<AnalyticsSectionId>()
  if (Array.isArray(value)) {
    for (const candidate of value) {
      if (!candidate || typeof candidate !== 'object') continue
      const record = candidate as Record<string, unknown>
      if (!isAnalyticsSectionId(record.id) || seen.has(record.id)) continue
      sections.push({
        id: record.id,
        visible: typeof record.visible === 'boolean' ? record.visible : true,
        wide: typeof record.wide === 'boolean' ? record.wide : false,
      })
      seen.add(record.id)
    }
  }

  for (const id of ANALYTICS_SECTION_IDS) {
    if (seen.has(id)) continue
    sections.push({
      id,
      visible: true,
      wide: id === 'overview' || id === 'progression',
    })
  }
  return sections
}

export function parseAnalyticsSettings(value: unknown): AnalyticsSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return createDefaultAnalyticsSettings()
  }
  const record = value as Record<string, unknown>
  const targets: Partial<Record<PuzzleEvent, number>> = {}
  const rawTargets = record.subXTargetsMs
  if (rawTargets && typeof rawTargets === 'object' && !Array.isArray(rawTargets)) {
    for (const [event, target] of Object.entries(
      rawTargets as Record<string, unknown>,
    )) {
      if (
        typeof target === 'number' &&
        Number.isFinite(target) &&
        target >= 1_000 &&
        target <= 3_600_000
      ) {
        targets[event as PuzzleEvent] = Math.round(target)
      }
    }
  }

  return {
    sections: normalizeAnalyticsSections(record.sections),
    subXTargetsMs: { ...DEFAULT_SUB_X_TARGETS_MS, ...targets },
  }
}

export function cloneAnalyticsSettings(
  analytics: AnalyticsSettings,
): AnalyticsSettings {
  return {
    sections: analytics.sections.map((section) => ({ ...section })),
    subXTargetsMs: { ...analytics.subXTargetsMs },
  }
}
