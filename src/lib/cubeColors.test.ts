import { describe, expect, it } from 'vitest'
import { CUBE_FACE_COLORS, applyCubeFaceColors, type PuzzleGeometryColors } from './cubeColors'
import { CUBE_FACES } from './cubeNet'

describe('cube face colours', () => {
  it('uses the standard U/D/F/B/R/L scheme', () => {
    expect(CUBE_FACE_COLORS).toEqual({
      U: '#FFFFFF',
      D: '#FFFF00',
      F: '#00FF00',
      B: '#0000FF',
      R: '#FF0000',
      L: '#FF8000',
    })
  })

  it('applies the standard scheme to a puzzle geometry in place', () => {
    const geometry = {
      colors: {
        U: '#ffffff',
        D: '#f4f400',
        F: '#44ee00',
        B: '#2266ff',
        R: '#ff0000',
        L: '#ff8000',
        other: '#123456',
      },
    }

    applyCubeFaceColors(geometry)

    for (const face of CUBE_FACES) {
      expect(geometry.colors[face]).toBe(CUBE_FACE_COLORS[face])
    }
    // Non-cube keys (e.g. megaminx faces) must be left alone.
    expect(geometry.colors.other).toBe('#123456')
  })

  it('ignores geometries without a colour map', () => {
    expect(() => applyCubeFaceColors({})).not.toThrow()
  })

  it('rewrites the cached cubing.js puzzle-geometry palette', async () => {
    const { puzzles } = await import('cubing/puzzles')
    const loader = puzzles['3x3x3']
    if (!loader) throw new Error('missing puzzle loader')
    const geometry = await loader.pg!()

    applyCubeFaceColors(geometry as unknown as PuzzleGeometryColors)

    const colors = (geometry as unknown as PuzzleGeometryColors).colors
    expect(colors).toBeTruthy()
    for (const face of CUBE_FACES) {
      // PG3D copies these values into its vertex colours.
      expect(colors?.[face]).toBe(CUBE_FACE_COLORS[face])
    }
  })
})
