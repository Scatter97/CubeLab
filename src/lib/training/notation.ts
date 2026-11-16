/**
 * Strict 3×3 algorithm notation parsing and normalization.
 *
 * CubeLab accepts the face-turn notation used by its training catalog and by
 * the prescribed OLL/PLL precursors. The parser deliberately accepts only
 * complete, whitespace-separated moves; it does not pass arbitrary text to
 * `cubing.js`'s permissive multi-puzzle parser.
 */

export type MoveFamily = 'face' | 'wide' | 'slice' | 'rotation'
export type MoveTurns = 1 | 2 | -1

export interface AlgorithmMove {
  /** Canonical token, e.g. `R`, `R'`, `Rw2`, `M'`, `x2`. */
  readonly token: string
  readonly family: MoveFamily
  /** `1` clockwise, `-1` counter-clockwise, `2` half turn. */
  readonly turns: MoveTurns
}

export interface ParsedAlgorithm {
  readonly input: string
  readonly moves: readonly AlgorithmMove[]
  /** Whitespace-separated canonical moves. */
  readonly normalized: string
}

/**
 * A catalog algorithm additionally records the group-expanded source form.
 *
 * The strict `parseAlgorithm` above intentionally rejects grouping and compact
 * source spellings. Catalog ingestion uses `parseCatalogAlgorithm`, which
 * expands `(...)n` groups and tokenizes compact move runs before applying the
 * same strict move parser.
 */
export interface ParsedCatalogAlgorithm extends ParsedAlgorithm {
  /** Whitespace-separated canonical moves after group expansion. */
  readonly expanded: string
}

export class AlgorithmNotationError extends Error {
  readonly token: string | null

  constructor(message: string, token: string | null = null) {
    super(message)
    this.name = 'AlgorithmNotationError'
    this.token = token
  }
}

/**
 * A move is one of:
 * - a face turn: `U D L R F B`
 * - a wide turn: `Uw`/`u`, `Dw`/`d`, `Lw`/`l`, `Rw`/`r`, `Fw`/`f`, `Bw`/`b`
 * - a slice turn: `M E S`
 * - a whole-cube rotation: `x y z`
 * followed by an optional `'`, `2`, `2'`, or `'2`.
 */
const MOVE_PATTERN =
  /^(?:([URFDLB])(w)?|([urfdlb])|([MES])|([xyz]))(2'|'2|2|')?$/

function parseTurns(modifier: string, token: string): MoveTurns {
  if (modifier === '') return 1
  if (modifier === "'") return -1
  if (modifier === '2' || modifier === "2'" || modifier === "'2") return 2
  throw new AlgorithmNotationError(
    `Unsupported turn modifier "${modifier}" in algorithm token "${token}".`,
    token,
  )
}

function tokenFor(base: string, turns: MoveTurns): string {
  if (turns === 2) return `${base}2`
  if (turns === -1) return `${base}'`
  return base
}

/** Parses exactly one move token. Whitespace is not allowed inside the token. */
export function parseMove(token: string): AlgorithmMove {
  if (typeof token !== 'string') {
    throw new AlgorithmNotationError('Algorithm move must be a string.')
  }

  const raw = token.trim()
  const match = MOVE_PATTERN.exec(raw)
  if (!match) {
    throw new AlgorithmNotationError(
      `Unsupported algorithm token "${raw}".`,
      raw || null,
    )
  }

  const [, face, wide, lowercaseWide, slice, rotation] = match
  let family: MoveFamily
  let base: string

  if (face !== undefined) {
    family = wide === 'w' ? 'wide' : 'face'
    base = family === 'wide' ? `${face}w` : face
  } else if (lowercaseWide !== undefined) {
    family = 'wide'
    base = `${lowercaseWide.toUpperCase()}w`
  } else if (slice !== undefined) {
    family = 'slice'
    base = slice
  } else if (rotation !== undefined) {
    family = 'rotation'
    base = rotation
  } else {
    throw new AlgorithmNotationError(
      `Unsupported algorithm token "${raw}".`,
      raw || null,
    )
  }

  const turns = parseTurns(match[6] ?? '', raw)
  return { token: tokenFor(base, turns), family, turns }
}

/**
 * Parses a whitespace-separated 3×3 algorithm.
 *
 * Empty input is invalid. Grouping, commutators, repetitions, wide-move
 * prefixes such as `3Rw`, and non-3×3 puzzle notation are intentionally
 * rejected rather than silently interpreted by another puzzle parser.
 */
export function parseAlgorithm(input: string): ParsedAlgorithm {
  if (typeof input !== 'string') {
    throw new AlgorithmNotationError('Algorithm must be a string.')
  }

  const trimmed = input.trim()
  if (trimmed === '') {
    throw new AlgorithmNotationError('Algorithm is empty.')
  }

  const rawTokens = trimmed.split(/\s+/)
  const moves = rawTokens.map((token) => parseMove(token))
  return {
    input,
    moves,
    normalized: moves.map((move) => move.token).join(' '),
  }
}

const MAX_EXPANDED_CATALOG_MOVES = 512

/**
 * Reads one compact move token. Catalog sources omit spaces between moves and
 * use prime-before-2 spellings; both are accepted here.
 */
function readCatalogMove(
  input: string,
  index: number,
): { readonly token: string; readonly nextIndex: number } {
  const rest = input.slice(index)
  const base = /^(?:[URFDLB](?:w)?|[urfdlb]|[MES]|[xyz])/.exec(rest)?.[0]
  if (!base) {
    throw new AlgorithmNotationError(
      `Unsupported algorithm token near "${rest.slice(0, 8)}".`,
      rest.slice(0, 8) || null,
    )
  }

  const modifierIndex = index + base.length
  const modifier =
    /^(?:2'|'2|2|')/.exec(input.slice(modifierIndex))?.[0] ?? ''
  return {
    token: `${base}${modifier}`,
    nextIndex: modifierIndex + modifier.length,
  }
}

interface ExpandedGroup {
  readonly tokens: readonly string[]
  readonly nextIndex: number
}

/**
 * Recursively expands parenthesized move groups.
 *
 * Supported forms: `(R U R' U')2`, nested groups, compact move runs such as
 * `(rUr')`, and repetitions `1`–`9`. Commutators, slice brackets, prime group
 * modifiers and larger repetitions are rejected explicitly.
 */
function expandCatalogSequence(
  input: string,
  startIndex: number,
  insideGroup: boolean,
  depth = 0,
): ExpandedGroup {
  if (depth > 16) {
    throw new AlgorithmNotationError(
      'Algorithm group nesting exceeds 16 levels.',
    )
  }
  const tokens: string[] = []
  let index = startIndex

  while (index < input.length) {
    const character = input[index]!

    if (/\s/.test(character)) {
      index += 1
      continue
    }

    if (character === ')') {
      if (!insideGroup) {
        throw new AlgorithmNotationError(
          'Unmatched closing parenthesis in algorithm.',
          ')',
        )
      }
      return { tokens, nextIndex: index + 1 }
    }

    if (character === '(') {
      const group = expandCatalogSequence(
        input,
        index + 1,
        true,
        depth + 1,
      )
      index = group.nextIndex
      if (group.tokens.length === 0) {
        throw new AlgorithmNotationError('Algorithm contains an empty group.')
      }

      let digits = ''
      while (index < input.length && /\d/.test(input[index]!)) {
        digits += input[index]!
        index += 1
      }
      if (input[index] === "'") {
        throw new AlgorithmNotationError(
          'Prime group modifiers are not supported in catalog algorithms.',
          ") '",
        )
      }

      const repeat = digits === '' ? 1 : Number(digits)
      if (!Number.isInteger(repeat) || repeat < 1 || repeat > 9) {
        throw new AlgorithmNotationError(
          `Unsupported group repetition "${digits}"; expected 1–9.`,
          digits || null,
        )
      }
      for (let repetition = 0; repetition < repeat; repetition += 1) {
        tokens.push(...group.tokens)
      }
      if (tokens.length > MAX_EXPANDED_CATALOG_MOVES) {
        throw new AlgorithmNotationError(
          `Expanded algorithm exceeds ${MAX_EXPANDED_CATALOG_MOVES} moves.`,
        )
      }
      continue
    }

    const move = readCatalogMove(input, index)
    tokens.push(move.token)
    index = move.nextIndex
  }

  if (insideGroup) {
    throw new AlgorithmNotationError(
      'Unclosed parenthesis in algorithm.',
      '(',
    )
  }
  if (tokens.length > MAX_EXPANDED_CATALOG_MOVES) {
    throw new AlgorithmNotationError(
      `Expanded algorithm exceeds ${MAX_EXPANDED_CATALOG_MOVES} moves.`,
    )
  }
  return { tokens, nextIndex: index }
}

/**
 * Expands catalog grouping without applying cube moves.
 *
 * The returned string contains whitespace-separated move tokens in execution
 * order; it is not yet canonicalized (use `parseCatalogAlgorithm` for that).
 */
export function expandAlgorithmGroups(input: string): string {
  if (typeof input !== 'string') {
    throw new AlgorithmNotationError('Algorithm must be a string.')
  }
  if (input.trim() === '') {
    throw new AlgorithmNotationError('Algorithm is empty.')
  }
  return expandCatalogSequence(input, 0, false).tokens.join(' ')
}

/**
 * Parses a catalog algorithm. Groups are expanded and compact source tokens are
 * separated, then the strict Phase 1 parser validates every move.
 */
export function parseCatalogAlgorithm(
  input: string,
): ParsedCatalogAlgorithm {
  const expanded = expandAlgorithmGroups(input)
  const parsed = parseAlgorithm(expanded)
  return {
    input,
    expanded,
    moves: parsed.moves,
    normalized: parsed.normalized,
  }
}

export function isValidCatalogAlgorithm(input: string): boolean {
  try {
    parseCatalogAlgorithm(input)
    return true
  } catch {
    return false
  }
}

/** Canonicalizes catalog notation after expanding group repetition. */
export function normalizeCatalogAlgorithm(input: string): string {
  return parseCatalogAlgorithm(input).normalized
}

export function isValidAlgorithm(input: string): boolean {
  try {
    parseAlgorithm(input)
    return true
  } catch {
    return false
  }
}

export function normalizeAlgorithm(input: string): string {
  return parseAlgorithm(input).normalized
}

function invertParsedMove(move: AlgorithmMove): string {
  if (move.turns === 2) return move.token
  const base = move.token.endsWith("'")
    ? move.token.slice(0, -1)
    : move.token
  return tokenFor(base, move.turns === 1 ? -1 : 1)
}

/** Inverts one canonical or non-canonical move token. */
export function invertMove(token: string): string {
  return invertParsedMove(parseMove(token))
}

/** Returns the exact group inverse in reverse move order. */
export function invertAlgorithm(input: string): string {
  const parsed = parseAlgorithm(input)
  return parsed.moves
    .slice()
    .reverse()
    .map(invertParsedMove)
    .join(' ')
}

/** Concatenates algorithms in execution order and returns canonical notation. */
export function composeAlgorithms(
  ...algorithms: readonly string[]
): string {
  return algorithms.map((algorithm) => normalizeAlgorithm(algorithm)).join(' ')
}

export function algorithmMoveCount(input: string): number {
  return parseAlgorithm(input).moves.length
}
