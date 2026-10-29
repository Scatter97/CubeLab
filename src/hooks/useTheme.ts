import { useLayoutEffect, useSyncExternalStore } from 'react'
import type { ThemePreference } from '../types'
import {
  resolveTheme,
  SYSTEM_THEME_QUERY,
  type ResolvedTheme,
} from '../lib/theme'

function systemPrefersDark(): boolean {
  if (
    typeof window === 'undefined' ||
    typeof window.matchMedia !== 'function'
  ) {
    return false
  }
  return window.matchMedia(SYSTEM_THEME_QUERY).matches
}

function subscribeToSystemTheme(onChange: () => void): () => void {
  if (
    typeof window === 'undefined' ||
    typeof window.matchMedia !== 'function'
  ) {
    return () => {}
  }

  const query = window.matchMedia(SYSTEM_THEME_QUERY)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

/**
 * Resolves the stored theme preference, tracks the OS preference when the user
 * chose `system`, and applies the result to the document root before paint.
 */
export function useTheme(preference: ThemePreference): ResolvedTheme {
  const prefersDark = useSyncExternalStore(
    subscribeToSystemTheme,
    systemPrefersDark,
    () => false,
  )
  const resolved = resolveTheme(preference, prefersDark)

  useLayoutEffect(() => {
    const root = document.documentElement
    root.dataset.theme = resolved
    root.style.colorScheme = resolved
    document
      .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
      ?.setAttribute('content', resolved === 'dark' ? '#0d1218' : '#ffffff')
  }, [resolved])

  return resolved
}
