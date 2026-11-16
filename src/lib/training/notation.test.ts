// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  AlgorithmNotationError,
  algorithmMoveCount,
  composeAlgorithms,
  expandAlgorithmGroups,
  invertAlgorithm,
  invertMove,
  isValidAlgorithm,
  isValidCatalogAlgorithm,
  normalizeAlgorithm,
  normalizeCatalogAlgorithm,
  parseAlgorithm,
  parseCatalogAlgorithm,
  parseMove,
} from './notation'

describe('training algorithm notation', () => {
  it('parses and normalizes face, wide, slice and rotation moves', () => {
    const parsed = parseAlgorithm(
      "R U R' U' R2 Rw' M E2 S x y' z2",
    )
    expect(parsed.normalized).toBe(
      "R U R' U' R2 Rw' M E2 S x y' z2",
    )
    expect(parsed.moves).toHaveLength(12)
    expect(parsed.moves[0]).toMatchObject({
      token: 'R',
      family: 'face',
      turns: 1,
    })
    expect(parsed.moves[3]).toMatchObject({
      token: "U'",
      family: 'face',
      turns: -1,
    })
    expect(parsed.moves[5]).toMatchObject({
      token: "Rw'",
      family: 'wide',
      turns: -1,
    })
    expect(parsed.moves[6]).toMatchObject({
      token: 'M',
      family: 'slice',
      turns: 1,
    })
    expect(parsed.moves[9]).toMatchObject({
      token: 'x',
      family: 'rotation',
      turns: 1,
    })
  })

  it('canonicalizes lowercase wide moves and equivalent half-turn spellings', () => {
    expect(normalizeAlgorithm("r u' f2 d l b")).toBe(
      "Rw Uw' Fw2 Dw Lw Bw",
    )
    expect(normalizeAlgorithm("R2' U'2 Rw2' M2' x2'")).toBe(
      'R2 U2 Rw2 M2 x2',
    )
  })

  it('rejects empty input and unsupported tokens', () => {
    for (const value of [
      '',
      '   ',
      'Q',
      'U3',
      'Rw3',
      '2R',
      'R U not-a-move',
      "R2''",
      'R,U',
      '(R U)',
      '[R, U]',
      'Rw2w',
    ]) {
      expect(() => parseAlgorithm(value), value).toThrow(
        AlgorithmNotationError,
      )
      expect(isValidAlgorithm(value), value).toBe(false)
    }
  })

  it('reports the offending token', () => {
    expect(() => parseAlgorithm('R U Q')).toThrow(/"Q"/)
    expect(() => parseMove('Rw3')).toThrow(/Rw3/)
  })

  it('inverts individual moves including half turns', () => {
    expect(invertMove('R')).toBe("R'")
    expect(invertMove("R'")).toBe('R')
    expect(invertMove('R2')).toBe('R2')
    expect(invertMove("Rw'")).toBe('Rw')
    expect(invertMove('M')).toBe("M'")
    expect(invertMove('x2')).toBe('x2')
  })

  it('inverts algorithms in reverse order', () => {
    expect(invertAlgorithm("U R U' R'")).toBe("R U R' U'")
    expect(invertAlgorithm("R U R' U R U2 R'")).toBe(
      "R U2 R' U' R U' R'",
    )
    expect(
      invertAlgorithm("Rw U' M2 x' S"),
    ).toBe("S' x M2 U Rw'")
  })

  it('double inversion returns the normalized algorithm', () => {
    for (const algorithm of [
      "R U R' U'",
      "R U R' U R U2 R'",
      "Rw U' M2 x' S",
      'R2 U2 F2',
    ]) {
      const normalized = normalizeAlgorithm(algorithm)
      expect(invertAlgorithm(invertAlgorithm(algorithm))).toBe(normalized)
    }
  })

  it('composes algorithms in execution order', () => {
    expect(composeAlgorithms('R U', "R' U'")).toBe("R U R' U'")
    expect(composeAlgorithms()).toBe('')
    expect(algorithmMoveCount("R U R' U'")).toBe(4)
  })

  it('is deterministic for repeated parses', () => {
    const input = "R U R' U R U2 R'"
    expect(parseAlgorithm(input)).toEqual(parseAlgorithm(input))
    expect(normalizeAlgorithm(input)).toBe(parseAlgorithm(input).normalized)
  })
})

describe('training catalog notation', () => {
  it('expands group repetition in execution order', () => {
    expect(expandAlgorithmGroups("(R U R' U')2")).toBe(
      "R U R' U' R U R' U'",
    )
    expect(
      expandAlgorithmGroups("(rUr')(URU'R')2(rU'r')"),
    ).toBe("r U r' U R U' R' U R U' R' r U' r'")
    expect(
      expandAlgorithmGroups("r U r' (R U R' U')2 r U' r'"),
    ).toBe("r U r' R U R' U' R U R' U' r U' r'")
  })

  it('supports nested groups and compact move runs', () => {
    expect(expandAlgorithmGroups("(R (U R')2)2")).toBe(
      "R U R' U R' R U R' U R'",
    )
    expect(normalizeCatalogAlgorithm("RUR'U'")).toBe("R U R' U'")
  })

  it('normalizes catalog source spellings without changing semantics', () => {
    expect(
      normalizeCatalogAlgorithm("(rUr')(URU'R')2(r'U'r')"),
    ).toBe("Rw U Rw' U R U' R' U R U' R' Rw' U' Rw'")
    expect(normalizeCatalogAlgorithm("R'2 M'2 r'2")).toBe(
      'R2 M2 Rw2',
    )
    expect(
      normalizeCatalogAlgorithm("x R' U R' D2 R U' R' D2 R2 x'"),
    ).toBe("x R' U R' D2 R U' R' D2 R2 x'")
  })

  it('keeps the strict Phase 1 parser strict', () => {
    expect(() => parseAlgorithm("(R U R' U')2")).toThrow(
      AlgorithmNotationError,
    )
    expect(isValidAlgorithm("(R U R' U')2")).toBe(false)
    expect(isValidCatalogAlgorithm("(R U R' U')2")).toBe(true)
  })

  it('rejects malformed, unsupported, and excessive catalog notation', () => {
    for (const value of [
      '',
      '   ',
      '(R U',
      'R U)',
      '(R U)0',
      '(R U)10',
      "(R U)'",
      '()',
      '[R, U]',
      'R3',
      'Q',
      '(R U)2 Q',
    ]) {
      expect(() => parseCatalogAlgorithm(value), value).toThrow(
        AlgorithmNotationError,
      )
      expect(isValidCatalogAlgorithm(value), value).toBe(false)
    }

    expect(() =>
      expandAlgorithmGroups(`(${Array(600).fill('R').join(' ')})`),
    ).toThrow(/exceeds/i)

    const deeplyNested = `${'('.repeat(20)}R${')'.repeat(20)}`
    expect(() => parseCatalogAlgorithm(deeplyNested)).toThrow(
      /nesting/i,
    )
  })

  it('returns parsed catalog metadata deterministically', () => {
    const input = "(R U R' U')2"
    const first = parseCatalogAlgorithm(input)
    expect(first.normalized).toBe("R U R' U' R U R' U'")
    expect(first.expanded).toBe(first.normalized)
    expect(first.moves).toHaveLength(8)
    expect(parseCatalogAlgorithm(input)).toEqual(first)
  })
})
