import { useLayoutEffect, useSyncExternalStore } from 'react'
import type { AppearanceColors, ThemePreference } from '../types'
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

const CUSTOM_COLOR_VARIABLES = [
  '--accent',
  '--accent-strong',
  '--accent-soft',
  '--accent-line',
  '--bg',
  '--timer-bg',
  '--timer-border',
  '--timer-holding-bg',
  '--timer-ready-bg',
  '--timer-display',
] as const

function applyAppearance(root: HTMLElement, appearance: AppearanceColors | undefined): void {
  for (const property of CUSTOM_COLOR_VARIABLES) root.style.removeProperty(property)
  if (!appearance) return

  const set = (property: string, value: string) => root.style.setProperty(property, value)
  if (appearance.accent) {
    const accent = appearance.accent
    set('--accent', accent)
    set('--accent-strong', `color-mix(in srgb, ${accent} 74%, var(--text))`)
    set('--accent-soft', `color-mix(in srgb, ${accent} 12%, var(--surface))`)
    set('--accent-line', `color-mix(in srgb, ${accent} 38%, var(--line))`)
  }
  if (appearance.background) set('--bg', appearance.background)
  if (appearance.timerBackground) {
    const timer = appearance.timerBackground
    set('--timer-bg', timer)
    set('--timer-border', `color-mix(in srgb, ${timer} 82%, var(--text))`)
    set('--timer-holding-bg', `color-mix(in srgb, ${timer} 94%, var(--accent))`)
    set('--timer-ready-bg', `color-mix(in srgb, ${timer} 87%, var(--accent))`)
  }
  if (appearance.timerText) set('--timer-display', appearance.timerText)
}

/**
 * Resolves the stored theme preference, tracks the OS preference when the user
 * chose `system`, and applies the result to the document root before paint.
 * Custom appearance colors layer over the resolved theme's tokens.
 */
export function useTheme(
  preference: ThemePreference,
  appearance?: AppearanceColors,
): ResolvedTheme {
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
    applyAppearance(root, appearance)
    document
      .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
      ?.setAttribute(
        'content',
        appearance?.background ?? (resolved === 'dark' ? '#0d1218' : '#ffffff'),
      )
  }, [appearance, resolved])

  return resolved
}
