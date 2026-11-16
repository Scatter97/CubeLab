/**
 * Conversion between catalog case definitions and mathematically constructed
 * cube states. These helpers let setup generation resolve a verified case
 * definition without storing a serialized cubie state or third-party algorithm.
 */

import {
  CORNER_PIECES,
  Cube3StateError,
  EDGE_PIECES,
  isOllState,
  isPllState,
  type CornerPiece,
  type Cube3Model,
  type Cube3State,
  type EdgePiece,
} from './cube3'
import {
  OLL_SKIP_CASE_ID,
  type OllCaseId,
} from './catalog/ollCases'
import { PLL_CASE_BY_SIGNATURE, PLL_SKIP_CASE_ID } from './catalog/pllCases'
import type { CaseKind, TrainingCaseDefinition } from './catalog/types'
import {
  canonicalOllSignature,
  OLL_SKIP_ORIENTATION_SIGNATURE,
} from './caseSignature'
import { pllDoubleCosetSignature } from './pllIdentity'

export interface CaseIdentity {
  readonly kind: CaseKind
  readonly canonicalSignature: string
  readonly isSkip: boolean
  /** PLL case ID, OLL skip ID, or null for an unnamed OLL orientation. */
  readonly namedCaseId: OllCaseId | string | null
}

function parseOllSignature(signature: string): {
  readonly cornerOrientations: readonly number[]
  readonly edgeOrientations: readonly number[]
} {
  const match = /^([0-2]{4})\|([0-1]{4})$/.exec(signature)
  if (!match) {
    throw new Cube3StateError(
      `Invalid OLL orientation signature "${signature}"; expected cccc|eeee.`,
    )
  }
  return {
    cornerOrientations: [...match[1]!].map(Number),
    edgeOrientations: [...match[2]!].map(Number),
  }
}

function parsePllSignature(signature: string): {
  readonly cornerPieces: readonly number[]
  readonly edgePieces: readonly number[]
} {
  const match = /^([^|]+)\|([^|]+)$/.exec(signature)
  if (!match) {
    throw new Cube3StateError(
      `Invalid PLL permutation signature "${signature}".`,
    )
  }
  const cornerNames = match[1]!.split(',').map((name) => name.trim())
  const edgeNames = match[2]!.split(',').map((name) => name.trim())
  if (cornerNames.length !== 4 || edgeNames.length !== 4) {
    throw new Cube3StateError(
      `Invalid PLL permutation signature "${signature}"; expected four corners and four edges.`,
    )
  }

  const cornerPieces = cornerNames.map((name) => {
    const index = CORNER_PIECES.indexOf(name as CornerPiece)
    if (index < 0 || index >= 4) {
      throw new Cube3StateError(
        `PLL signature contains invalid U-layer corner "${name}".`,
      )
    }
    return index
  })
  const edgePieces = edgeNames.map((name) => {
    const index = EDGE_PIECES.indexOf(name as EdgePiece)
    if (index < 0 || index >= 4) {
      throw new Cube3StateError(
        `PLL signature contains invalid U-layer edge "${name}".`,
      )
    }
    return index
  })

  if (new Set(cornerPieces).size !== 4 || new Set(edgePieces).size !== 4) {
    throw new Cube3StateError(
      `PLL signature "${signature}" repeats a last-layer piece.`,
    )
  }
  return { cornerPieces, edgePieces }
}

/** Builds a valid representative state for a case definition's signature. */
export function buildCaseRepresentativeState(
  model: Cube3Model,
  definition: TrainingCaseDefinition,
): Cube3State {
  let state: Cube3State

  if (definition.kind === 'oll-orientation') {
    const { cornerOrientations, edgeOrientations } = parseOllSignature(
      definition.representativeSignature ?? definition.canonicalSignature,
    )
    state = model.createState({
      cornerPieces: [0, 1, 2, 3, 4, 5, 6, 7],
      cornerOrientations: [...cornerOrientations, 0, 0, 0, 0],
      edgePieces: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
      edgeOrientations: [...edgeOrientations, 0, 0, 0, 0, 0, 0, 0, 0],
    })
  } else if (definition.kind === 'pll-permutation') {
    const { cornerPieces, edgePieces } = parsePllSignature(
      definition.representativeSignature ?? definition.canonicalSignature,
    )
    state = model.createState({
      cornerPieces: [...cornerPieces, 4, 5, 6, 7],
      cornerOrientations: new Array<number>(8).fill(0),
      edgePieces: [...edgePieces, 4, 5, 6, 7, 8, 9, 10, 11],
      edgeOrientations: new Array<number>(12).fill(0),
    })
  } else {
    throw new Cube3StateError(
      `Unsupported case kind "${definition.kind}".`,
    )
  }

  assertCaseState(state, definition)
  return state
}

/** Identifies a valid case state using the set's standard identity. */
export function identifyCaseState(
  state: Cube3State,
  kind: CaseKind,
): CaseIdentity {
  if (kind === 'oll-orientation') {
    if (!isOllState(state)) {
      throw new Cube3StateError(
        'OLL case identity requires a solved F2L and the last layer in U.',
      )
    }
    const canonicalSignature = canonicalOllSignature(state)
    const isSkip =
      canonicalSignature === OLL_SKIP_ORIENTATION_SIGNATURE
    return {
      kind,
      canonicalSignature,
      isSkip,
      namedCaseId: isSkip ? OLL_SKIP_CASE_ID : null,
    }
  }

  if (kind === 'pll-permutation') {
    if (!isPllState(state)) {
      throw new Cube3StateError(
        'PLL case identity requires a solved F2L, the last layer in U, and all U stickers oriented.',
      )
    }
    const canonicalSignature = pllDoubleCosetSignature(state)
    const definition = PLL_CASE_BY_SIGNATURE.get(canonicalSignature)
    if (!definition) {
      throw new Cube3StateError(
        `PLL signature ${canonicalSignature} does not map to a standard named case.`,
      )
    }
    return {
      kind,
      canonicalSignature,
      isSkip: definition.id === PLL_SKIP_CASE_ID,
      namedCaseId: definition.id,
    }
  }

  throw new Cube3StateError(`Unsupported case kind "${kind}".`)
}

/** Rejects a state unless it belongs to the supplied case definition. */
export function assertCaseState(
  state: Cube3State,
  definition: TrainingCaseDefinition,
): CaseIdentity {
  const identity = identifyCaseState(state, definition.kind)

  if (identity.canonicalSignature !== definition.canonicalSignature) {
    throw new Cube3StateError(
      `State signature ${identity.canonicalSignature} does not match ${definition.id} (${definition.canonicalSignature}).`,
    )
  }
  if (
    definition.kind === 'pll-permutation' &&
    identity.namedCaseId !== definition.id
  ) {
    throw new Cube3StateError(
      `State is ${identity.namedCaseId ?? 'unknown'}, not ${definition.id}.`,
    )
  }
  if (definition.isSkip !== identity.isSkip) {
    throw new Cube3StateError(
      `State skip status ${identity.isSkip} does not match ${definition.id}.`,
    )
  }

  return identity
}
