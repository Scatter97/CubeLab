import type { TrainingMetric } from './stats'
import { TRAINING_CATEGORIES, type TrainingCategoryId } from './types'
import { isSiteResetInProgress } from '../siteReset'

export const TRAINING_STAT_ROWS = [
  { id: 'single', label: 'Single', size: 1 },
  { id: 'mo3', label: 'mo3', size: 3 },
  { id: 'ao5', label: 'ao5', size: 5 },
  { id: 'ao12', label: 'ao12', size: 12 },
  { id: 'ao25', label: 'ao25', size: 25 },
  { id: 'ao100', label: 'ao100', size: 100 },
  { id: 'attempts', label: 'Total attempts' },
  { id: 'successful', label: 'Successful attempts' },
  { id: 'dnfs', label: 'DNF count' },
  { id: 'dnfRate', label: 'DNF percentage' },
  { id: 'successRate', label: 'Success percentage' },
  { id: 'mean', label: 'Mean successful time' },
  { id: 'best', label: 'Best successful time' },
  { id: 'distinct', label: 'Distinct cases practiced' },
  { id: 'difficult', label: 'Difficult cases mean' },
  { id: 'improvement', label: 'Visit improvement' },
  { id: 'estimate', label: 'Mean estimated time', recognitionOnly: true },
] as const

export type TrainingStatRow = typeof TRAINING_STAT_ROWS[number]
export type TrainingStatId = TrainingStatRow['id']
export const TRAINING_STAT_BY_ID = new Map<TrainingStatId, TrainingStatRow>(TRAINING_STAT_ROWS.map(row => [row.id, row]))

export interface TrainingStatisticsPreferences {
  rows: readonly TrainingStatId[]
  visible: readonly TrainingStatId[]
  metric: TrainingMetric
  current: boolean
  best: boolean
}

export const DEFAULT_TRAINING_STATISTICS: TrainingStatisticsPreferences = {
  rows: TRAINING_STAT_ROWS.map(row => row.id),
  visible: ['single', 'mo3', 'ao5', 'ao12'],
  metric: 'raw',
  current: true,
  best: true,
}

export const TRAINING_STATISTICS_KEY = 'cubelab:training-statistics:v1'
export const TRAINING_SPLIT_KEY = 'cubelab:training-sidebar-split:v1'
export type TrainingStatisticsByCategory = Partial<Record<TrainingCategoryId, TrainingStatisticsPreferences>>

function knownRows(value: unknown): TrainingStatId[] | null {
  if (!Array.isArray(value)) return null
  return [...new Set(value.filter((id): id is TrainingStatId => TRAINING_STAT_BY_ID.has(id)))]
}

export function parseTrainingStatisticsPreferences(raw: string | null): TrainingStatisticsByCategory {
  try {
    const parsed: unknown = JSON.parse(raw ?? 'null')
    if (!parsed || typeof parsed !== 'object') return {}
    const result: TrainingStatisticsByCategory = {}
    for (const category of TRAINING_CATEGORIES) {
      const value = (parsed as Record<string, unknown>)[category]
      if (!value || typeof value !== 'object') continue
      const candidate = value as Record<string, unknown>
      result[category] = {
        rows: [...new Set([...(knownRows(candidate.rows) ?? []), ...DEFAULT_TRAINING_STATISTICS.rows])],
        visible: knownRows(candidate.visible) ?? DEFAULT_TRAINING_STATISTICS.visible,
        metric: category.endsWith(':recognition') && candidate.metric === 'estimated' ? 'estimated' : 'raw',
        current: candidate.current !== false || candidate.best === false,
        best: candidate.best !== false,
      }
    }
    return result
  } catch {
    return {}
  }
}

export function readTrainingPresentation(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}

export const TRAINING_UPCOMING_CASE_KEY = 'cubelab:training-show-upcoming-case:v1'

export function readShowUpcomingCase() {
  try {
    return JSON.parse(readTrainingPresentation(TRAINING_UPCOMING_CASE_KEY) ?? 'null') !== false
  } catch {
    return true
  }
}

export function saveTrainingPresentation(key: string, value: unknown): boolean {
  if (isSiteResetInProgress()) return false
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}
