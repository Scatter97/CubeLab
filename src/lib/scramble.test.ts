// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { CUBELAB_EVENTS } from './events'
import { generateScramble, isPlausibleScramble } from './scramble'

describe('scramble generation', () => {
  it('validates well-formed and malformed notation', () => {
    expect(isPlausibleScramble("R U R' U' F2 D L2 B' R2 U2")).toBe(true)
    expect(
      isPlausibleScramble("3Rw2 Uw' 3Dw Bw F2 R' L 3Fw2 Dw2 U2"),
    ).toBe(true)
    expect(isPlausibleScramble('')).toBe(false)
    expect(isPlausibleScramble("R U R' not-a-move F2")).toBe(false)
    expect(isPlausibleScramble('R U')).toBe(false)
    expect(isPlausibleScramble('2-3Rw U2 R2 F2 D2 L2 B2 U2')).toBe(false)
  })

  it(
    'generates an official random-state 3x3 scramble with cubing.js',
    async () => {
      const scramble = await generateScramble('333')
      expect(scramble.length).toBeGreaterThan(20)
      expect(isPlausibleScramble(scramble)).toBe(true)
      expect(scramble).toMatch(/^[URFDLB]/)
    },
    30_000,
  )

  it(
    'generates a valid random-state scramble for every supported event',
    async () => {
      for (const event of CUBELAB_EVENTS) {
        const scramble = await generateScramble(event.id)
        expect(isPlausibleScramble(scramble), `${event.id}: ${scramble}`).toBe(
          true,
        )
      }
    },
    90_000,
  )

  it(
    'does not repeat the previous scramble',
    async () => {
      const [first, second] = await Promise.all([
        generateScramble('333'),
        generateScramble('333'),
      ])
      expect(first).not.toBe(second)
    },
    30_000,
  )
})
