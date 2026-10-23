// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { generateScramble, isPlausibleScramble } from './scramble'

describe('scramble generation', () => {
  it('validates well-formed and malformed notation', () => {
    expect(isPlausibleScramble("R U R' U' F2 D L2 B' R2 U2")).toBe(true)
    expect(isPlausibleScramble('')).toBe(false)
    expect(isPlausibleScramble("R U R' not-a-move F2")).toBe(false)
    expect(isPlausibleScramble('R U')).toBe(false)
  })

  it(
    'generates an official random-state 3x3 scramble with cubing.js',
    async () => {
      const scramble = await generateScramble()
      expect(scramble.length).toBeGreaterThan(20)
      expect(isPlausibleScramble(scramble)).toBe(true)
      expect(scramble).toMatch(/^[URFDLB]/)
    },
    30_000,
  )

  it(
    'does not repeat the previous scramble',
    async () => {
      const [first, second] = await Promise.all([
        generateScramble(),
        generateScramble(),
      ])
      expect(first).not.toBe(second)
    },
    30_000,
  )
})
