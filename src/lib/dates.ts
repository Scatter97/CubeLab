/** Inclusive range accepted by JavaScript Date (in milliseconds). */
export const MAX_DATE_MS = 8_640_000_000_000_000

export function isDateTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= MAX_DATE_MS
}

export function dateTimeAttribute(timestamp: number): string | undefined {
  return isDateTimestamp(timestamp) ? new Date(timestamp).toISOString() : undefined
}
