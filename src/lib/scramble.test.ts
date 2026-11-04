// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import {
  CUBELAB_EVENTS,
  resetCustomEventDefinitionsForTests,
  setCustomEventDefinitions,
} from './events'
import {
  DEFAULT_CUSTOM_EVENT_PLACEHOLDER,
} from './events'
import { generateScramble, isPlausibleScramble } from './scramble'

afterEach(() => {
  resetCustomEventDefinitionsForTests()
})

describe('scramble generation', () => {
  it('validates well-formed and malformed N×N notation', () => {
    expect(isPlausibleScramble("R U R' U' F2 D L2 B' R2 U2")).toBe(true)
    expect(
      isPlausibleScramble("3Rw2 Uw' 3Dw Bw F2 R' L 3Fw2 Dw2 U2"),
    ).toBe(true)
    expect(isPlausibleScramble('')).toBe(false)
    expect(isPlausibleScramble("R U R' not-a-move F2")).toBe(false)
    expect(isPlausibleScramble('R U')).toBe(false)
    expect(isPlausibleScramble('2-3Rw U2 R2 F2 D2 L2 B2 U2')).toBe(false)
  })

  it('validates Pyraminx face and tip notation', () => {
    expect(isPlausibleScramble("B' U' R U' R U' B L' U' r l'", 'pyram')).toBe(
      true,
    )
    expect(isPlausibleScramble("B' U' R U' R U' B L' U'", 'pyram')).toBe(true)
    expect(isPlausibleScramble('R U R', 'pyram')).toBe(false)
    expect(isPlausibleScramble("R U R' F2 D L2 B' R2 U2", 'pyram')).toBe(false)
  })

  it('validates Skewb notation', () => {
    expect(isPlausibleScramble("U L B R B U L' B' U' L' B", 'skewb')).toBe(true)
    expect(isPlausibleScramble('R U R', 'skewb')).toBe(false)
    expect(isPlausibleScramble("U L B R B U L' B' U' L' B2", 'skewb')).toBe(
      true,
    )
  })

  it('validates Square-1 tuple and slash notation', () => {
    expect(
      isPlausibleScramble(
        '(0, -4) / (3, 0) / (1, 4) / (-1, -4) / (-5, 1) / (-4, 3) / (6, 0) / (-3, 3) / (-1, -2) / (0, 2) / (-4, -1) /',
        'sq1',
      ),
    ).toBe(true)
    // cubing.js can emit nine tuples with no trailing slash.
    expect(
      isPlausibleScramble(
        '(-2, 3) / (5, 5) / (0, 3) / (-3, 0) / (0, 1) / (3, 0) / (-5, 2) / (-4, 0) / (4, 0)',
        'sq1',
      ),
    ).toBe(true)
    expect(isPlausibleScramble('(0, -4) (3, 0)', 'sq1')).toBe(false)
    expect(isPlausibleScramble('/ / / / / / / / / /', 'sq1')).toBe(false)
    expect(isPlausibleScramble('R U R', 'sq1')).toBe(false)
  })

  it('validates Clock pin and dial notation', () => {
    expect(
      isPlausibleScramble(
        'U4- R6+ D1+ L3+ ALL2- UR0+ DR1+ DL1- UL2- y2 U5+ R5+ D3- L1+ ALL1-',
        'clock',
      ),
    ).toBe(true)
    expect(isPlausibleScramble('U4- R6+ D1+', 'clock')).toBe(false)
    expect(isPlausibleScramble("R U R' U' F2 D L2 B' R2 U2", 'clock')).toBe(false)
  })

  it('validates Megaminx line-wrapped and normalized notation', () => {
    const lineWrapped = [
      'R++ D-- R-- D++ R++ D++ R++ D-- R++ D++ U',
      'R-- D-- R-- D++ R-- D-- R-- D++ R++ D++ U',
      'R-- D++ R-- D-- R++ D++ R-- D++ R++ D-- U\'',
      'R-- D-- R-- D++ R-- D-- R-- D++ R-- D++ U',
      'R-- D-- R++ D++ R++ D++ R++ D++ R-- D++ U',
      'R-- D++ R-- D-- R++ D-- R++ D-- R++ D-- U\'',
      'R++ D++ R-- D-- R-- D++ R-- D-- R-- D-- U\'',
    ].join('\n')
    expect(isPlausibleScramble(lineWrapped, 'minx')).toBe(true)
    expect(isPlausibleScramble(lineWrapped.replace(/\s+/g, ' '), 'minx')).toBe(
      true,
    )
    expect(isPlausibleScramble('R++ D-- U', 'minx')).toBe(false)
    expect(isPlausibleScramble("R U R' U' F2 D L2 B' R2 U2", 'minx')).toBe(false)
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
    'generates a valid scramble for every supported event',
    async () => {
      for (const event of CUBELAB_EVENTS) {
        const scramble = await generateScramble(event.id)
        expect(
          isPlausibleScramble(scramble, event.id),
          `${event.id}: ${scramble}`,
        ).toBe(true)
        expect(scramble, event.id).not.toContain('\n')
      }
    },
    120_000,
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

  it('returns the custom placeholder without generating a scramble', async () => {
    setCustomEventDefinitions([
      {
        id: 'custom:fto',
        name: 'FTO',
        placeholder: 'No FTO scramble',
        createdAt: 1,
        updatedAt: 1,
      },
    ])
    await expect(generateScramble('custom:fto')).resolves.toBe('No FTO scramble')
    await expect(generateScramble('custom:missing')).resolves.toBe(
      DEFAULT_CUSTOM_EVENT_PLACEHOLDER,
    )
  })
})
