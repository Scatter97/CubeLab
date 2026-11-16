import { describe, expect, it } from 'vitest'
import { MAX_SESSION_NAME_LENGTH, resolveSessionName, suggestSessionName } from './sessionNames'

describe('session name suggestions', () => {
  it('uses the category label or the first available spaced suffix', () => {
    expect(suggestSessionName('OLL Recognition', ['PLL Execution'])).toBe('OLL Recognition')
    expect(suggestSessionName('OLL Recognition', [
      ' oll  recognition ', 'OLL Recognition (2)', 'OLL Recognition (4)',
    ])).toBe('OLL Recognition (3)')
  })

  it('reuses available slots and respects literal imported and synced names', () => {
    expect(suggestSessionName('3×3', ['3×3 (2)'])).toBe('3×3')
    expect(suggestSessionName('3×3', ['3×3', '3×3(2)', '3×3 (3)'])).toBe('3×3 (2)')
    expect(suggestSessionName('3×3', ['3×3', '3×3', '3×3 (2)'])).toBe('3×3 (3)')
  })

  it('fits a suffix after a maximum-length custom event name', () => {
    const label = 'a'.repeat(MAX_SESSION_NAME_LENGTH)
    const suggestion = suggestSessionName(label, [label])
    expect(suggestion).toBe(`${label.slice(0, -4)} (2)`)
    expect(suggestion).toHaveLength(MAX_SESSION_NAME_LENGTH)
    expect(suggestSessionName(`${'a'.repeat(35)}🧩bbb`, [`${'a'.repeat(35)}🧩bbb`]))
      .toBe(`${'a'.repeat(35)} (2)`)
  })

  it('uses the suggestion for empty or whitespace-only drafts', () => {
    expect(resolveSessionName('', 'PLL Execution')).toBe('PLL Execution')
    expect(resolveSessionName(' \t ', 'PLL Execution')).toBe('PLL Execution')
    expect(resolveSessionName(' My   practice ', 'PLL Execution')).toBe('My practice')
  })
})
