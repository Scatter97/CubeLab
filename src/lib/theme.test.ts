import { describe, expect, it } from 'vitest'
import css from '../index.css?raw'
import { resolveTheme } from './theme'

type Palette = Record<string, string>

function declarations(selector: string): Palette {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const block = new RegExp(
    `(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`,
  ).exec(css)
  if (!block?.[1]) {
    throw new Error(`Missing palette block: ${selector}`)
  }

  const palette: Palette = {}
  for (const line of block[1].split('\n')) {
    const match = /^\s*(--[\w-]+):\s*([^;]+);/.exec(line)
    const name = match?.[1]
    const value = match?.[2]
    if (name && value) palette[name] = value.trim()
  }
  return palette
}

function hexToRgb(hex: string): [number, number, number] {
  let value = hex.replace('#', '')
  if (value.length === 3) {
    value = value
      .split('')
      .map((character) => `${character}${character}`)
      .join('')
  }
  if (!/^[0-9a-f]{6}$/i.test(value)) {
    throw new Error(`Not a six-digit hex color: ${hex}`)
  }
  return [
    Number.parseInt(value.slice(0, 2), 16),
    Number.parseInt(value.slice(2, 4), 16),
    Number.parseInt(value.slice(4, 6), 16),
  ]
}

function relativeLuminance(hex: string): number {
  const channels = hexToRgb(hex).map((channel) => {
    const normalized = channel / 255
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4
  })
  return (
    0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!
  )
}

function contrastRatio(foreground: string, background: string): number {
  const first = relativeLuminance(foreground)
  const second = relativeLuminance(background)
  return (
    (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
  )
}

const lightRoot = declarations(':root')
const darkRoot = declarations(":root[data-theme='dark']")

const accents = ['green', 'blue', 'violet', 'amber'] as const
type Accent = (typeof accents)[number]

function lightPalette(accent: Accent): Palette {
  return accent === 'green'
    ? lightRoot
    : { ...lightRoot, ...declarations(`.app-shell[data-accent='${accent}']`) }
}

function darkPalette(accent: Accent): Palette {
  return accent === 'green'
    ? darkRoot
    : {
        ...darkRoot,
        ...declarations(
          `:root[data-theme='dark'] .app-shell[data-accent='${accent}']`,
        ),
      }
}

function token(palette: Palette, name: string): string {
  const value = palette[name]
  if (!value) throw new Error(`Missing palette token: ${name}`)
  return value
}

function expectContrast(
  palette: Palette,
  foreground: string,
  background: string,
  minimum: number,
): void {
  const ratio = contrastRatio(
    token(palette, foreground),
    token(palette, background),
  )
  expect(
    Number(ratio.toFixed(2)),
    `${foreground} on ${background} (${ratio.toFixed(2)}:1)`,
  ).toBeGreaterThanOrEqual(minimum)
}

const TEXT_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['--text', '--surface'],
  ['--text', '--surface-soft'],
  ['--text', '--bg'],
  ['--text-soft', '--surface'],
  ['--text-soft', '--surface-soft'],
  ['--text-soft', '--surface-muted'],
  ['--text-muted', '--surface'],
  ['--text-muted', '--surface-soft'],
  ['--text-muted', '--surface-muted'],
  ['--text-muted', '--timer-bg'],
  ['--text-faint', '--surface'],
  ['--text-faint', '--surface-soft'],
  ['--text-faint', '--surface-muted'],
  ['--text-faint', '--bg'],
  ['--text-faint', '--timer-bg'],
  ['--danger', '--surface'],
  ['--danger', '--surface-soft'],
  ['--danger', '--danger-soft'],
  ['--warning', '--surface'],
  ['--warning', '--surface-soft'],
  ['--warning', '--warning-soft'],
  ['--on-danger', '--danger'],
  ['--on-danger', '--danger-strong'],
  ['--timer-display', '--timer-bg'],
  ['--text', '--timer-bg'],
  ['--warning', '--timer-bg'],
  ['--danger', '--timer-bg'],
]

const ACCENT_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['--accent', '--surface'],
  ['--accent', '--surface-soft'],
  ['--accent', '--bg'],
  ['--accent', '--accent-soft'],
  ['--accent', '--timer-bg'],
  ['--accent-strong', '--surface'],
  ['--accent-strong', '--accent-soft'],
  ['--on-accent', '--accent'],
  ['--on-accent', '--accent-strong'],
]

describe('resolveTheme', () => {
  it('uses explicit light and dark preferences unchanged', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('light', false)).toBe('light')
    expect(resolveTheme('dark', true)).toBe('dark')
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it('follows the system preference when asked', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })
})

describe('theme palette contrast', () => {
  it('defines the complete light and dark token sets', () => {
    const fontTokens = new Set(['--font-ui', '--font-mono'])
    for (const name of Object.keys(lightRoot)) {
      if (fontTokens.has(name)) continue
      expect(
        darkRoot[name],
        `dark theme is missing ${name}`,
      ).toBeDefined()
    }
  })

  it.each(accents)('meets WCAG AA for %s in the light theme', (accent) => {
    const palette = lightPalette(accent)
    for (const [foreground, background] of TEXT_PAIRS) {
      expectContrast(palette, foreground, background, 4.5)
    }
    for (const [foreground, background] of ACCENT_PAIRS) {
      expectContrast(palette, foreground, background, 4.5)
    }
  })

  it.each(accents)('meets WCAG AA for %s in the dark theme', (accent) => {
    const palette = darkPalette(accent)
    for (const [foreground, background] of TEXT_PAIRS) {
      expectContrast(palette, foreground, background, 4.5)
    }
    for (const [foreground, background] of ACCENT_PAIRS) {
      expectContrast(palette, foreground, background, 4.5)
    }
  })

  it('keeps focus outlines visible against every surface', () => {
    for (const accent of accents) {
      for (const palette of [
        lightPalette(accent),
        darkPalette(accent),
      ]) {
        expectContrast(palette, '--accent', '--surface', 3)
        expectContrast(palette, '--accent', '--bg', 3)
        expectContrast(palette, '--accent', '--timer-bg', 3)
      }
    }
  })
})
