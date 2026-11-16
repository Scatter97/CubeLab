/**
 * Pure 3×3 cube-state foundations for CubeLab Training.
 *
 * The state engine is `cubing.js`'s proven 3x3x3 KPuzzle/KPattern. This module
 * adds only the cubie naming, validation, move/AUF helpers and F2L/OLL/PLL
 * selectors that training needs. It deliberately does not maintain a second
 * cube simulator.
 */

import { KPattern } from 'cubing/kpuzzle'
import type { KPuzzle } from 'cubing/kpuzzle'
import {
  invertAlgorithm,
  parseAlgorithm,
  parseMove,
  type ParsedAlgorithm,
} from './notation'

/** `cubing.js` KPattern corner indices, in its stable 3x3x3 order. */
export const CORNER_PIECES = [
  'UFR',
  'UBR',
  'UBL',
  'UFL',
  'DFR',
  'DFL',
  'DBL',
  'DBR',
] as const

/** `cubing.js` KPattern edge indices, in its stable 3x3x3 order. */
export const EDGE_PIECES = [
  'UF',
  'UR',
  'UB',
  'UL',
  'DF',
  'DR',
  'DB',
  'DL',
  'FR',
  'FL',
  'BR',
  'BL',
] as const

export type CornerPiece = (typeof CORNER_PIECES)[number]
export type EdgePiece = (typeof EDGE_PIECES)[number]
export type CornerPosition = CornerPiece
export type EdgePosition = EdgePiece

export const U_CORNER_PIECES = [
  'UFR',
  'UBR',
  'UBL',
  'UFL',
] as const satisfies readonly CornerPiece[]

export const U_EDGE_PIECES = [
  'UF',
  'UR',
  'UB',
  'UL',
] as const satisfies readonly EdgePiece[]

export const F2L_CORNER_PIECES = [
  'DFR',
  'DFL',
  'DBL',
  'DBR',
] as const satisfies readonly CornerPiece[]

export const F2L_EDGE_PIECES = [
  'DF',
  'DR',
  'DB',
  'DL',
  'FR',
  'FL',
  'BR',
  'BL',
] as const satisfies readonly EdgePiece[]

export const F2L_SLOTS = ['FR', 'FL', 'BL', 'BR'] as const
export type F2lSlot = (typeof F2L_SLOTS)[number]

export const F2L_SLOT_PIECES: Record<
  F2lSlot,
  { readonly corner: CornerPiece; readonly edge: EdgePiece }
> = {
  FR: { corner: 'DFR', edge: 'FR' },
  FL: { corner: 'DFL', edge: 'FL' },
  BL: { corner: 'DBL', edge: 'BL' },
  BR: { corner: 'DBR', edge: 'BR' },
}

/** Confirmed V1 OLL recognition insertion. Do not substitute. */
export const OLL_INSERTION = "U R U' R'"
/** Exact group inverse `R U R' U'`. */
export const OLL_INSERTION_INVERSE = "R U R' U'"

/** Confirmed V1 PLL recognition precursor (Sune). Do not substitute. */
export const PLL_PRECURSOR = "R U R' U R U2 R'"
/** Exact group inverse `R U2 R' U' R U' R'`. */
export const PLL_PRECURSOR_INVERSE = "R U2 R' U' R U' R'"

export const AUF_ALGS = ['', 'U', 'U2', "U'"] as const
export type Auf = (typeof AUF_ALGS)[number]

/** Verified orientation signature of the fixed Sune OLL pre-state. */
export const SUNE_OLL_SIGNATURE = '2220|0000'
/** All four U-layer corners and edges oriented (OLL skip in orientation space). */
export const OLL_SKIP_ORIENTATION_SIGNATURE = '0000|0000'

/** A validated 3×3 KPattern in the fixed CubeLab face frame. */
export type Cube3State = KPattern

export interface Cube3CubieData {
  readonly cornerPieces: readonly number[]
  readonly cornerOrientations: readonly number[]
  readonly edgePieces: readonly number[]
  readonly edgeOrientations: readonly number[]
}

export interface Cube3Model {
  readonly kpuzzle: KPuzzle
  readonly solved: Cube3State
  createState(data: Cube3CubieData): Cube3State
}

export class Cube3StateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'Cube3StateError'
  }
}

export interface CubieSlot<Position extends string> {
  /** The position being inspected (or where a requested piece currently is). */
  readonly position: Position
  /** The piece at that position (or the requested piece). */
  readonly piece: Position
  readonly orientation: number
  /** True when the piece is home with orientation 0. */
  readonly solved: boolean
}

export interface F2lSlotStatus {
  readonly slot: F2lSlot
  readonly corner: CubieSlot<CornerPosition>
  readonly edge: CubieSlot<EdgePosition>
  readonly solved: boolean
}

export interface OllInsertionAnalysis {
  readonly insertion: string
  readonly inverse: string
  readonly prescribed: boolean
  readonly targetIsOllState: boolean
  readonly targetF2lSolved: boolean
  readonly preState: Cube3State
  readonly preStateIsFixed: boolean
  readonly preStateF2lSlots: readonly F2lSlotStatus[]
  readonly insertionReturnsTarget: boolean
  readonly ok: boolean
}

export interface PllPrecursorAnalysis {
  readonly precursor: string
  readonly inverse: string
  readonly prescribed: boolean
  readonly targetIsPllState: boolean
  readonly preState: Cube3State
  readonly preStateF2lSolved: boolean
  readonly preStateLastLayerInU: boolean
  readonly preStateOrientationSignature: string | null
  readonly preStateIsSuneOll: boolean
  readonly preStateUFaceNonU: number
  readonly preStateIsNotPllOriented: boolean
  readonly precursorReturnsTarget: boolean
  readonly ok: boolean
}

function assertDefinition(kpuzzle: KPuzzle): void {
  const definition = kpuzzle.definition
  if (definition.name !== '3x3x3') {
    throw new Cube3StateError(
      `Expected the cubing.js 3x3x3 KPuzzle, received "${definition.name}".`,
    )
  }

  const expectedOrbits = [
    { orbitName: 'CORNERS', numPieces: 8, numOrientations: 3 },
    { orbitName: 'EDGES', numPieces: 12, numOrientations: 2 },
    { orbitName: 'CENTERS', numPieces: 6, numOrientations: 4 },
  ]
  for (const expected of expectedOrbits) {
    const actual = definition.orbits.find(
      (orbit) => orbit.orbitName === expected.orbitName,
    )
    if (
      !actual ||
      actual.numPieces !== expected.numPieces ||
      actual.numOrientations !== expected.numOrientations
    ) {
      throw new Cube3StateError(
        `Unsupported cubing.js 3x3x3 orbit definition for ${expected.orbitName}.`,
      )
    }
  }

  for (const move of [
    'U',
    'D',
    'L',
    'R',
    'F',
    'B',
    'u',
    'd',
    'l',
    'r',
    'f',
    'b',
    'M',
    'E',
    'S',
    'x',
    'y',
    'z',
  ]) {
    if (!definition.moves[move]) {
      throw new Cube3StateError(
        `Unsupported cubing.js 3x3x3 move definition: ${move}.`,
      )
    }
  }
}

/**
 * Verifies the piece-index mapping against known `cubing.js` transformations.
 * This protects the module from a dependency-order change that would silently
 * relabel corners or edges.
 */
function assertPieceMapping(kpuzzle: KPuzzle): void {
  const afterR = kpuzzle.defaultPattern().applyMove('R')
  const corners = afterR.patternData.CORNERS
  const edges = afterR.patternData.EDGES
  if (!corners || !edges) {
    throw new Cube3StateError('cubing.js 3x3x3 pattern is missing an orbit.')
  }

  // R sends DFR to UFR with corner orientation 2.
  if (corners.pieces[0] !== 4 || corners.orientation[0] !== 2) {
    throw new Cube3StateError(
      'cubing.js 3x3x3 corner mapping no longer matches the verified DFR/UFR order.',
    )
  }
  // R sends FR to UR with edge orientation 0.
  if (edges.pieces[1] !== 8 || edges.orientation[1] !== 0) {
    throw new Cube3StateError(
      'cubing.js 3x3x3 edge mapping no longer matches the verified FR/UR order.',
    )
  }
}

let cachedModel: Promise<Cube3Model> | undefined

/**
 * Loads the cubing.js 3x3x3 KPuzzle once per page/session. The dynamic import
 * keeps the large puzzle definition out of unrelated application chunks.
 */
export function loadCube3Model(): Promise<Cube3Model> {
  cachedModel ??= (async () => {
    const { cube3x3x3 } = await import('cubing/puzzles')
    const kpuzzle = await cube3x3x3.kpuzzle()
    assertDefinition(kpuzzle)
    assertPieceMapping(kpuzzle)
    const solved = kpuzzle.defaultPattern()
    return {
      kpuzzle,
      solved,
      createState(data: Cube3CubieData) {
        return createCube3State(kpuzzle, solved, data)
      },
    }
  })()

  return cachedModel
}

function permutationParity(permutation: readonly number[]): number {
  let inversions = 0
  for (let i = 0; i < permutation.length; i += 1) {
    for (let j = i + 1; j < permutation.length; j += 1) {
      if (permutation[i]! > permutation[j]!) inversions += 1
    }
  }
  return inversions % 2
}

function validatePermutation(
  values: readonly number[],
  size: number,
  label: string,
): void {
  if (values.length !== size) {
    throw new Cube3StateError(
      `${label} permutation must contain exactly ${size} entries.`,
    )
  }
  const seen = new Set<number>()
  for (const value of values) {
    if (!Number.isInteger(value) || value < 0 || value >= size) {
      throw new Cube3StateError(
        `${label} permutation contains invalid index ${String(value)}.`,
      )
    }
    if (seen.has(value)) {
      throw new Cube3StateError(
        `${label} permutation contains duplicate index ${value}.`,
      )
    }
    seen.add(value)
  }
}

function validateOrientations(
  values: readonly number[],
  size: number,
  orientations: number,
  label: string,
): void {
  if (values.length !== size) {
    throw new Cube3StateError(
      `${label} orientation array must contain exactly ${size} entries.`,
    )
  }
  for (const value of values) {
    if (
      !Number.isInteger(value) ||
      value < 0 ||
      value >= orientations
    ) {
      throw new Cube3StateError(
        `${label} orientation contains invalid value ${String(value)}.`,
      )
    }
  }
}

function validateStateData(
  data: Cube3CubieData,
  label = 'Cube state',
  centerPieces?: readonly number[],
): void {
  validatePermutation(data.cornerPieces, 8, `${label} corner`)
  validatePermutation(data.edgePieces, 12, `${label} edge`)
  if (centerPieces) {
    validatePermutation(centerPieces, 6, `${label} center`)
  }
  validateOrientations(data.cornerOrientations, 8, 3, `${label} corner`)
  validateOrientations(data.edgeOrientations, 12, 2, `${label} edge`)

  const cornerTwist =
    data.cornerOrientations.reduce((sum, value) => sum + value, 0) % 3
  if (cornerTwist !== 0) {
    throw new Cube3StateError(
      `${label} has an invalid corner-orientation sum (${cornerTwist} mod 3).`,
    )
  }
  const edgeFlip =
    data.edgeOrientations.reduce((sum, value) => sum + value, 0) % 2
  if (edgeFlip !== 0) {
    throw new Cube3StateError(
      `${label} has an invalid edge-orientation sum (${edgeFlip} mod 2).`,
    )
  }

  const totalParity =
    permutationParity(data.cornerPieces) ^
    permutationParity(data.edgePieces) ^
    (centerPieces ? permutationParity(centerPieces) : 0)
  if (totalParity !== 0) {
    throw new Cube3StateError(
      `${label} has an invalid corner/edge/center permutation parity.`,
    )
  }
}

function createCube3State(
  kpuzzle: KPuzzle,
  solved: Cube3State,
  data: Cube3CubieData,
): Cube3State {
  validateStateData(data)

  const patternData = structuredClone(solved.patternData)
  patternData.CORNERS = {
    pieces: [...data.cornerPieces],
    orientation: [...data.cornerOrientations],
  }
  patternData.EDGES = {
    pieces: [...data.edgePieces],
    orientation: [...data.edgeOrientations],
  }
  const state = new KPattern(kpuzzle, patternData)
  validateCube3State(state)
  return state
}

/**
 * Validates structural cube invariants without requiring a solved F2L or a
 * standard whole-cube orientation. Rotated frames remain valid states.
 */
export function validateCube3State(state: Cube3State): void {
  if (
    !state ||
    typeof state !== 'object' ||
    !('patternData' in state) ||
    !state.kpuzzle
  ) {
    throw new Cube3StateError('Expected a cubing.js KPattern state.')
  }
  if (state.kpuzzle.definition.name !== '3x3x3') {
    throw new Cube3StateError('Expected a cubing.js 3x3x3 state.')
  }

  const corners = state.patternData.CORNERS
  const edges = state.patternData.EDGES
  const centers = state.patternData.CENTERS
  if (!corners || !edges || !centers) {
    throw new Cube3StateError('Cube state is missing a cubie orbit.')
  }

  validateStateData(
    {
      cornerPieces: corners.pieces,
      cornerOrientations: corners.orientation,
      edgePieces: edges.pieces,
      edgeOrientations: edges.orientation,
    },
    'Cube state',
    centers.pieces,
  )

  validateOrientations(centers.orientation, 6, 4, 'Cube state center')
}

function assertCube3State(state: Cube3State): void {
  validateCube3State(state)
}

function cornerOrbit(state: Cube3State) {
  const orbit = state.patternData.CORNERS
  if (!orbit) throw new Cube3StateError('Cube state is missing corners.')
  return orbit
}

function edgeOrbit(state: Cube3State) {
  const orbit = state.patternData.EDGES
  if (!orbit) throw new Cube3StateError('Cube state is missing edges.')
  return orbit
}

function centerOrbit(state: Cube3State) {
  const orbit = state.patternData.CENTERS
  if (!orbit) throw new Cube3StateError('Cube state is missing centers.')
  return orbit
}

export function applyParsedAlgorithm(
  state: Cube3State,
  parsed: ParsedAlgorithm,
): Cube3State {
  assertCube3State(state)
  return state.applyAlg(parsed.normalized)
}

/** Applies a strictly parsed algorithm. Invalid tokens are rejected first. */
export function applyAlgorithm(
  state: Cube3State,
  algorithm: string,
): Cube3State {
  return applyParsedAlgorithm(state, parseAlgorithm(algorithm))
}

/** Applies an already validated sequence of move tokens. */
export function applyMoves(
  state: Cube3State,
  moves: readonly string[],
): Cube3State {
  assertCube3State(state)
  let next = state
  for (const move of moves) {
    next = next.applyAlg(parseMove(move).token)
  }
  return next
}

export function applyAuf(state: Cube3State, auf: Auf): Cube3State {
  return auf === '' ? state : applyAlgorithm(state, auf)
}

/**
 * Applies an AUF before the state transformation (pre-AUF).
 *
 * `applyAuf` post-multiplies by U, which is the normal "turn the top layer after
 * the algorithm" view. Recognition setup variation uses the pre-AUF form so the
 * selected algorithm still solves the generated case up to a final U turn.
 */
export function applyPreAuf(state: Cube3State, auf: Auf): Cube3State {
  assertCube3State(state)
  if (auf === '') return state
  const transformation = state.experimentalToTransformation()
  if (!transformation) {
    throw new Cube3StateError('Cube state cannot be converted to a transformation.')
  }
  const aufTransformation = state.kpuzzle.identityTransformation().applyAlg(auf)
  return aufTransformation.applyTransformation(transformation).toKPattern()
}

export function aufVariants(
  state: Cube3State,
): readonly { readonly auf: Auf; readonly state: Cube3State }[] {
  return AUF_ALGS.map((auf) => ({ auf, state: applyAuf(state, auf) }))
}

export function isIdentical(a: Cube3State, b: Cube3State): boolean {
  return a.isIdentical(b)
}

export function isSolved(state: Cube3State): boolean {
  assertCube3State(state)
  return state.experimentalIsSolved({
    ignorePuzzleOrientation: false,
    ignoreCenterOrientation: false,
  })
}

export function isStandardFrame(state: Cube3State): boolean {
  assertCube3State(state)
  const centers = centerOrbit(state)
  return (
    centers.pieces.every((piece, index) => piece === index) &&
    centers.orientation.every((orientation) => orientation === 0)
  )
}

/** Inverts a full cube state (the inverse permutation/orientation pattern). */
export function invertState(state: Cube3State): Cube3State {
  assertCube3State(state)
  const transformation = state.experimentalToTransformation()
  if (!transformation) {
    throw new Cube3StateError('Cube state cannot be converted to a transformation.')
  }
  return transformation.invert().toKPattern()
}

export function cornerAt(
  state: Cube3State,
  position: CornerPosition,
): CubieSlot<CornerPosition> {
  assertCube3State(state)
  const index = CORNER_PIECES.indexOf(position)
  const orbit = cornerOrbit(state)
  const pieceIndex = orbit.pieces[index]!
  const piece = CORNER_PIECES[pieceIndex]!
  const orientation = orbit.orientation[index]!
  return {
    position,
    piece,
    orientation,
    solved: piece === position && orientation === 0,
  }
}

export function edgeAt(
  state: Cube3State,
  position: EdgePosition,
): CubieSlot<EdgePosition> {
  assertCube3State(state)
  const index = EDGE_PIECES.indexOf(position)
  const orbit = edgeOrbit(state)
  const pieceIndex = orbit.pieces[index]!
  const piece = EDGE_PIECES[pieceIndex]!
  const orientation = orbit.orientation[index]!
  return {
    position,
    piece,
    orientation,
    solved: piece === position && orientation === 0,
  }
}

export function findCorner(
  state: Cube3State,
  piece: CornerPiece,
): CubieSlot<CornerPosition> {
  assertCube3State(state)
  const pieceIndex = CORNER_PIECES.indexOf(piece)
  const orbit = cornerOrbit(state)
  const index = orbit.pieces.indexOf(pieceIndex)
  if (index < 0) {
    throw new Cube3StateError(`Corner piece ${piece} is missing from the state.`)
  }
  const position = CORNER_PIECES[index]!
  const orientation = orbit.orientation[index]!
  return {
    position,
    piece,
    orientation,
    solved: position === piece && orientation === 0,
  }
}

export function findEdge(
  state: Cube3State,
  piece: EdgePiece,
): CubieSlot<EdgePosition> {
  assertCube3State(state)
  const pieceIndex = EDGE_PIECES.indexOf(piece)
  const orbit = edgeOrbit(state)
  const index = orbit.pieces.indexOf(pieceIndex)
  if (index < 0) {
    throw new Cube3StateError(`Edge piece ${piece} is missing from the state.`)
  }
  const position = EDGE_PIECES[index]!
  const orientation = orbit.orientation[index]!
  return {
    position,
    piece,
    orientation,
    solved: position === piece && orientation === 0,
  }
}

export function f2lSlotStatuses(
  state: Cube3State,
): readonly F2lSlotStatus[] {
  assertCube3State(state)
  return F2L_SLOTS.map((slot) => {
    const pieces = F2L_SLOT_PIECES[slot]
    const corner = cornerAt(state, pieces.corner)
    const edge = edgeAt(state, pieces.edge)
    return {
      slot,
      corner,
      edge,
      solved: corner.solved && edge.solved,
    }
  })
}

export function isF2lSlotSolved(
  state: Cube3State,
  slot: F2lSlot,
): boolean {
  return f2lSlotStatuses(state).find((status) => status.slot === slot)!.solved
}

export function isF2lSolved(state: Cube3State): boolean {
  assertCube3State(state)
  return (
    F2L_CORNER_PIECES.every((piece) => cornerAt(state, piece).solved) &&
    F2L_EDGE_PIECES.every((piece) => edgeAt(state, piece).solved)
  )
}

/**
 * True when all last-layer pieces are in the U layer and all D-layer pieces
 * are out of it. This allows either a solved F2L or the fixed split-FR
 * pre-insertion configuration.
 */
export function isLastLayerInU(state: Cube3State): boolean {
  assertCube3State(state)
  const corners = cornerOrbit(state)
  for (let index = 0; index < CORNER_PIECES.length; index += 1) {
    const piece = CORNER_PIECES[corners.pieces[index]!]!
    const isUPosition = index < 4
    const isUPiece = (U_CORNER_PIECES as readonly CornerPiece[]).includes(piece)
    if (isUPosition !== isUPiece) return false
  }

  const edges = edgeOrbit(state)
  for (let index = 0; index < EDGE_PIECES.length; index += 1) {
    const piece = EDGE_PIECES[edges.pieces[index]!]!
    const isUPosition = index < 4
    const isUPiece = (U_EDGE_PIECES as readonly EdgePiece[]).includes(piece)
    if (isUPosition !== isUPiece) return false
  }
  return true
}

/** True for a last-layer orientation state with a fully solved F2L. */
export function isOllState(state: Cube3State): boolean {
  return isStandardFrame(state) && isF2lSolved(state) && isLastLayerInU(state)
}

/**
 * Counts stickers on the U face that do not belong to a U-layer piece. With
 * the last layer in U, this is also the number of twisted/flipped U pieces.
 */
export function uFaceNonUCount(state: Cube3State): number {
  assertCube3State(state)
  let count = 0
  const corners = cornerOrbit(state)
  for (let index = 0; index < 4; index += 1) {
    const piece = corners.pieces[index]!
    const orientation = corners.orientation[index]!
    if (piece >= 4 || orientation !== 0) count += 1
  }
  const edges = edgeOrbit(state)
  for (let index = 0; index < 4; index += 1) {
    const piece = edges.pieces[index]!
    const orientation = edges.orientation[index]!
    if (piece >= 4 || orientation !== 0) count += 1
  }
  return count
}

/** True for a fully oriented last layer with a solved F2L (PLL state). */
export function isPllState(state: Cube3State): boolean {
  return (
    isStandardFrame(state) &&
    isF2lSolved(state) &&
    isLastLayerInU(state) &&
    uFaceNonUCount(state) === 0
  )
}

/**
 * The verified fixed F2L configuration produced by `I⁻¹ = R U R' U'`:
 * DFR at UFR orientation 2, FR at UR orientation 0, and every other F2L
 * piece home. Last-layer permutation is intentionally not fixed.
 */
export function isFixedOllPreInsertionState(state: Cube3State): boolean {
  assertCube3State(state)
  const frCorner = findCorner(state, 'DFR')
  const frEdge = findEdge(state, 'FR')
  if (
    frCorner.position !== 'UFR' ||
    frCorner.orientation !== 2 ||
    frEdge.position !== 'UR' ||
    frEdge.orientation !== 0
  ) {
    return false
  }

  for (const piece of F2L_CORNER_PIECES) {
    if (piece === 'DFR') continue
    const location = findCorner(state, piece)
    if (location.position !== piece || location.orientation !== 0) return false
  }
  for (const piece of F2L_EDGE_PIECES) {
    if (piece === 'FR') continue
    const location = findEdge(state, piece)
    if (location.position !== piece || location.orientation !== 0) return false
  }
  return true
}

export function analyzeOllInsertion(
  state: Cube3State,
  insertion = OLL_INSERTION,
): OllInsertionAnalysis {
  assertCube3State(state)
  const parsedInsertion = parseAlgorithm(insertion)
  const normalizedInsertion = parsedInsertion.normalized
  const prescribed = normalizedInsertion === OLL_INSERTION
  const inverse = invertAlgorithm(normalizedInsertion)
  const preState = applyAlgorithm(state, inverse)
  const targetIsOllState = isOllState(state)
  const targetF2lSolved = isF2lSolved(state)
  const preStateIsFixed = isFixedOllPreInsertionState(preState)
  const insertionReturnsTarget = isIdentical(
    applyAlgorithm(preState, normalizedInsertion),
    state,
  )

  return {
    insertion: normalizedInsertion,
    inverse,
    prescribed,
    targetIsOllState,
    targetF2lSolved,
    preState,
    preStateIsFixed,
    preStateF2lSlots: f2lSlotStatuses(preState),
    insertionReturnsTarget,
    ok:
      prescribed &&
      targetIsOllState &&
      targetF2lSolved &&
      preStateIsFixed &&
      insertionReturnsTarget,
  }
}

export function assertOllInsertion(
  state: Cube3State,
  insertion = OLL_INSERTION,
): OllInsertionAnalysis {
  const analysis = analyzeOllInsertion(state, insertion)
  if (!analysis.ok) {
    throw new Cube3StateError(
      `OLL insertion ${analysis.insertion} does not produce the target OLL state with the fixed FR pre-state.`,
    )
  }
  return analysis
}

/**
 * Verifies the confirmed Sune precursor for a PLL target:
 * `P = L · Q⁻¹`, `Q(P) = L`, F2L solved, and P is the Sune OLL orientation
 * state rather than an exposed PLL.
 */
export function analyzePllPrecursor(
  state: Cube3State,
  precursor = PLL_PRECURSOR,
): PllPrecursorAnalysis {
  assertCube3State(state)
  const parsedPrecursor = parseAlgorithm(precursor)
  const normalizedPrecursor = parsedPrecursor.normalized
  const prescribed = normalizedPrecursor === PLL_PRECURSOR
  const inverse = invertAlgorithm(normalizedPrecursor)
  const preState = applyAlgorithm(state, inverse)
  const targetIsPllState = isPllState(state)
  const preStateF2lSolved = isF2lSolved(preState)
  const preStateLastLayerInU = isLastLayerInU(preState)
  const preStateStandardFrame = isStandardFrame(preState)
  const preStateUFaceNonU = uFaceNonUCount(preState)
  const preStateIsSuneOll =
    preStateF2lSolved &&
    preStateLastLayerInU &&
    preStateStandardFrame &&
    ollOrientationSignature(preState) === SUNE_OLL_SIGNATURE
  const precursorReturnsTarget = isIdentical(
    applyAlgorithm(preState, normalizedPrecursor),
    state,
  )

  return {
    precursor: normalizedPrecursor,
    inverse,
    prescribed,
    targetIsPllState,
    preState,
    preStateF2lSolved,
    preStateLastLayerInU,
    preStateOrientationSignature:
      preStateF2lSolved && preStateLastLayerInU && preStateStandardFrame
        ? ollOrientationSignature(preState)
        : null,
    preStateIsSuneOll,
    preStateUFaceNonU,
    preStateIsNotPllOriented: preStateUFaceNonU > 0,
    precursorReturnsTarget,
    ok:
      prescribed &&
      targetIsPllState &&
      preStateF2lSolved &&
      preStateLastLayerInU &&
      preStateIsSuneOll &&
      preStateUFaceNonU > 0 &&
      precursorReturnsTarget,
  }
}

export function assertPllPrecursor(
  state: Cube3State,
  precursor = PLL_PRECURSOR,
): PllPrecursorAnalysis {
  const analysis = analyzePllPrecursor(state, precursor)
  if (!analysis.ok) {
    throw new Cube3StateError(
      `PLL precursor ${analysis.precursor} does not produce the target PLL state from the Sune OLL pre-state.`,
    )
  }
  return analysis
}

/** Raw OLL orientation signature `cccc|eeee` over U-layer positions. */
export function ollOrientationSignature(state: Cube3State): string {
  if (!isOllState(state)) {
    throw new Cube3StateError(
      'OLL orientation signature requires a solved F2L and the last layer in U.',
    )
  }
  const corners = cornerOrbit(state)
  const edges = edgeOrbit(state)
  return `${corners.orientation.slice(0, 4).join('')}|${edges.orientation
    .slice(0, 4)
    .join('')}`
}
