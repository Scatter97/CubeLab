export const MAX_SESSION_NAME_LENGTH = 40

/** Trims and collapses whitespace so names compare predictably. */
export function normalizeSessionName(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

export function sessionNameKey(value: string): string {
  return normalizeSessionName(value).toLowerCase()
}

/** Finds the first free name in the current collection without reserving it. */
export function suggestSessionName(base: string, existingNames: Iterable<string>): string {
  const used = new Set(Array.from(existingNames, sessionNameKey))
  const label = normalizeSessionName(base) || 'Session'

  function withSuffix(suffix: string) {
    const prefix = label.slice(0, MAX_SESSION_NAME_LENGTH - suffix.length)
      .replace(/[\uD800-\uDBFF]$/, '').trimEnd()
    return `${prefix}${suffix}`
  }

  let candidate = withSuffix('')
  let number = 2
  while (used.has(sessionNameKey(candidate))) {
    candidate = withSuffix(` (${number})`)
    number += 1
  }
  return candidate
}

export function resolveSessionName(draft: string, suggestion: string): string {
  return normalizeSessionName(draft) || suggestion
}
