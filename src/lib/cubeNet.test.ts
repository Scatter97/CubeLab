// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { cubeNetForScramble, parseScrambleMoves } from './cubeNet'

function expectSolved(net: NonNullable<ReturnType<typeof cubeNetForScramble>>) {
  for (const [face, rows] of Object.entries(net.faces)) {
    for (const row of rows) {
      expect(row.every((sticker) => sticker === face)).toBe(true)
    }
  }
}

describe('cubeNet', () => {
  it('parses WCA wide moves', () => {
    const moves = parseScrambleMoves("3Rw2 Uw' F", 7)
    expect(moves).toHaveLength(3)
    expect(moves?.[0]).toMatchObject({ face: 'R', depth: 3, quarterTurns: 2 })
    expect(moves?.[1]).toMatchObject({ face: 'U', depth: 2, quarterTurns: -1 })
    expect(moves?.[2]).toMatchObject({ face: 'F', depth: 1, quarterTurns: 1 })
  })

  it('rejects malformed or unsupported notation', () => {
    expect(parseScrambleMoves('', 3)).toBeNull()
    expect(parseScrambleMoves('R U not-a-move', 3)).toBeNull()
    expect(parseScrambleMoves('4Rw', 3)).toBeNull()
    expect(cubeNetForScramble('R U', 8)).toBeNull()
    expect(cubeNetForScramble('', 3)).toBeNull()
  })

  it('applies U clockwise as F -> L, L -> B, B -> R, R -> F', () => {
    const net = cubeNetForScramble('U', 3)
    expect(net).not.toBeNull()
    // F top row comes from R top row.
    expect(net!.faces.F[0]).toEqual(['R', 'R', 'R'])
    expect(net!.faces.L[0]).toEqual(['F', 'F', 'F'])
    expect(net!.faces.B[0]).toEqual(['L', 'L', 'L'])
    expect(net!.faces.R[0]).toEqual(['B', 'B', 'B'])
    // Middle and bottom rows are untouched.
    expect(net!.faces.F[1]).toEqual(['F', 'F', 'F'])
    expect(net!.faces.F[2]).toEqual(['F', 'F', 'F'])
    // U's own face is rotated.
    expect(net!.faces.U[0]).toEqual(['U', 'U', 'U'])
  })

  it('applies R clockwise so the U right column moves to B', () => {
    const net = cubeNetForScramble('R', 3)
    expect(net).not.toBeNull()
    expect(net!.faces.B[0]![0]).toBe('U')
    expect(net!.faces.F[0]![2]).toBe('D')
    expect(net!.faces.U[0]![2]).toBe('F')
    expect(net!.faces.D[0]![2]).toBe('B')
  })

  it('returns the solved cube for an inverse pair', () => {
    const net = cubeNetForScramble("R R'", 3)
    expect(net).not.toBeNull()
    expectSolved(net!)
  })

  it('supports every NxN size used by CubeLab', () => {
    for (const size of [2, 3, 4, 5, 6, 7]) {
      const net = cubeNetForScramble(size % 2 === 0 ? 'Rw' : 'R', size)
      expect(net, `size ${size}`).not.toBeNull()
      expect(net!.faces.U).toHaveLength(size)
      expect(net!.faces.U[0]).toHaveLength(size)
    }
  })
})
