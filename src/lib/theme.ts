import type { ThemePreference } from '../types'

export type ResolvedTheme = 'light' | 'dark'

export const SYSTEM_THEME_QUERY = '(prefers-color-scheme: dark)'

/** Resolves the stored preference without touching the DOM. */
export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (preference === 'system') return systemPrefersDark ? 'dark' : 'light'
  return preference
}
