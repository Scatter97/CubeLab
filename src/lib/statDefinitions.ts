import type { StatKey } from '../types'

export interface BuiltInStatDefinition {
  key: StatKey
  label: string
  /** null for single, 3 for mo3, otherwise the trimmed-average size. */
  size: number | null
}

export const BUILT_IN_STAT_DEFINITIONS: readonly BuiltInStatDefinition[] = [
  { key: 'single', label: 'Best single', size: null },
  { key: 'mo3', label: 'Best mo3', size: 3 },
  { key: 'ao5', label: 'Best ao5', size: 5 },
  { key: 'ao12', label: 'Best ao12', size: 12 },
  { key: 'ao25', label: 'Best ao25', size: 25 },
  { key: 'ao100', label: 'Best ao100', size: 100 },
  { key: 'ao200', label: 'Best ao200', size: 200 },
  { key: 'ao500', label: 'Best ao500', size: 500 },
  { key: 'ao1000', label: 'Best ao1000', size: 1000 },
  { key: 'ao5000', label: 'Best ao5000', size: 5000 },
  { key: 'ao10000', label: 'Best ao10000', size: 10000 },
]

export const BUILT_IN_AVERAGE_SIZES: readonly number[] =
  BUILT_IN_STAT_DEFINITIONS.filter(
    (definition) => definition.key !== 'single' && definition.key !== 'mo3',
  ).map((definition) => definition.size as number)

export const MIN_CUSTOM_AVERAGE_SIZE = 3
export const MAX_CUSTOM_AVERAGE_SIZE = 10_000
export const MAX_CUSTOM_AVERAGES = 5

const builtInAverageSizeSet = new Set(BUILT_IN_AVERAGE_SIZES)

export function isBuiltInAverageSize(size: number): boolean {
  return builtInAverageSizeSet.has(size)
}

export function isValidAverageSize(size: number): boolean {
  return (
    Number.isInteger(size) &&
    size >= MIN_CUSTOM_AVERAGE_SIZE &&
    size <= MAX_CUSTOM_AVERAGE_SIZE
  )
}

export function isValidCustomAverageSize(size: number): boolean {
  return isValidAverageSize(size) && !isBuiltInAverageSize(size)
}

/** Picks the next free custom size, preferring sizes above ao5. */
export function nextCustomAverageSize(usedSizes: readonly number[]): number {
  const used = new Set(usedSizes)
  for (let size = 6; size <= MAX_CUSTOM_AVERAGE_SIZE; size += 1) {
    if (!isBuiltInAverageSize(size) && !used.has(size)) return size
  }
  return MIN_CUSTOM_AVERAGE_SIZE
}
