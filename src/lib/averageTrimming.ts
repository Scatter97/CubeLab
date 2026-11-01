import type { AverageTrimRule, AverageTrimming } from '../types'

export const AVERAGE_TRIM_OPTIONS: readonly { value: AverageTrimRule; label: string }[] = [
  { value: '0', label: '0 solves' },
  { value: '1', label: '1 solve' },
  { value: 'p1', label: '1%' },
  { value: 'p5', label: '5%' },
  { value: 'p10', label: '10%' },
  { value: 'p20', label: '20%' },
  { value: 'median', label: '50% / median' },
]

export const DEFAULT_AVERAGE_TRIMMING: AverageTrimming = Object.freeze({ better: 'p5', worse: 'auto' })

export function isAverageTrimRule(value: unknown): value is AverageTrimRule {
  return AVERAGE_TRIM_OPTIONS.some((option) => option.value === value)
}

function trimCount(size: number, rule: AverageTrimRule): number {
  if (rule === 'median') return Math.floor(size / 2)
  if (rule === '0' || rule === '1') return Number(rule)
  return Math.ceil(size * Number(rule.slice(1)) / 100)
}

/** csTimer-style rounding; an even median retains the two middle results. */
export function getAverageTrimCounts(size: number, trimming: AverageTrimming = DEFAULT_AVERAGE_TRIMMING) {
  if (!Number.isInteger(size) || size < 3) throw new Error('Average size must be an integer of at least 3')
  let better = trimCount(size, trimming.better)
  let worse = trimCount(size, trimming.worse === 'auto' ? trimming.better : trimming.worse)
  if (better + worse === size) { better = Math.max(0, better - 1); worse = Math.max(0, worse - 1) }
  return { better, worse, counted: size - better - worse }
}

export function averageTrimmingLabel(trimming: AverageTrimming): string {
  const label = (rule: AverageTrimRule) => AVERAGE_TRIM_OPTIONS.find((option) => option.value === rule)!.label
  return `${label(trimming.better)} best / ${label(trimming.worse === 'auto' ? trimming.better : trimming.worse)} worst`
}
