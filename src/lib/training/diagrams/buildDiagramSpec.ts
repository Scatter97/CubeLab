/**
 * Deterministic diagram specifications built from verified case definitions.
 *
 * No SVG string is produced here. This module is the shared mathematical layer
 * used by the development-time generator and its tests: it builds the case
 * representative, verifies the case identity, derives facelets/arrows and
 * rejects malformed or ambiguous diagram data.
 */

import type { Cube3Model, Cube3State } from '../cube3'
import {
  assertCaseState,
  buildCaseRepresentativeState,
} from '../caseState'
import {
  ollEdgePattern,
  pllDiagramAsset,
  ollDiagramAsset,
  STANDARD_VIEWING_ORIENTATION,
  type StandardCaseDefinition,
} from '../catalog/standardCases'
import {
  lastLayerFacelets,
  validateLastLayerFacelets,
  type LastLayerFacelets,
} from './facelets'
import {
  isULayerPosition,
  lastLayerPermutationArrows,
  type PermutationArrow,
} from './arrows'

export interface DiagramSpec {
  readonly caseId: string
  readonly caseName: string
  readonly caseLabel: string
  readonly kind: 'oll' | 'pll'
  readonly setId: string
  readonly signature: string
  readonly representativeSignature: string
  readonly family: string
  readonly viewingOrientation: string
  readonly asset: string
  readonly facelets: LastLayerFacelets
  readonly arrows: readonly PermutationArrow[]
  readonly title: string
  readonly description: string
}

export class DiagramSpecError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DiagramSpecError'
  }
}

function expectedAsset(definition: StandardCaseDefinition): string {
  if (definition.kind === 'oll-orientation') {
    const number = Number(definition.id.slice('oll:'.length))
    return ollDiagramAsset(number)
  }
  return pllDiagramAsset(
    definition.id as Parameters<typeof pllDiagramAsset>[0],
  )
}

function titleFor(definition: StandardCaseDefinition): string {
  return definition.kind === 'oll-orientation'
    ? `${definition.name} — orientation diagram`
    : `${definition.name} — permutation diagram`
}

function descriptionFor(definition: StandardCaseDefinition): string {
  if (definition.kind === 'oll-orientation') {
    return [
      'Top-down U-face orientation in the compact 3×3 diagram convention.',
      'Nine square cells show the U face: yellow cells are U stickers facing up and neutral gray cells are other sticker colors.',
      'Thin yellow bars outside the grid mark U stickers facing sideways at their adjacent face positions; positions without a bar have no sideways-facing U sticker.',
      `Canonical orientation signature ${definition.canonicalSignature}.`,
      'Viewing orientation: standard frame, U face on top, F at the bottom.',
    ].join(' ')
  }
  return [
    'Top-down U-face permutation in the compact 3×3 diagram convention.',
    'All nine U-face cells are yellow.',
    'Thin bars outside the grid show the actual side sticker colors: green front, red right, blue back and orange left.',
    'Black arrows show where corner and edge pieces move, from their current position to their home position; a double-headed arrow marks a two-piece swap.',
    `Canonical pre/post-AUF permutation signature ${definition.canonicalSignature}.`,
    'Viewing orientation: standard frame, U face on top, F at the bottom.',
  ].join(' ')
}

export function buildDiagramSpec(
  model: Cube3Model,
  definition: StandardCaseDefinition,
): DiagramSpec {
  if (definition.viewingOrientation !== STANDARD_VIEWING_ORIENTATION) {
    throw new DiagramSpecError(
      `Case ${definition.id} does not use the standard viewing orientation.`,
    )
  }

  const asset = expectedAsset(definition)
  if (definition.diagramAsset !== asset) {
    throw new DiagramSpecError(
      `Case ${definition.id} diagram path ${definition.diagramAsset} does not match ${asset}.`,
    )
  }

  const state = buildStateAndAssert(model, definition)
  const facelets = lastLayerFacelets(state)

  let arrows: readonly PermutationArrow[] = []
  if (definition.kind === 'oll-orientation') {
    const expectedPattern = ollEdgePattern(definition.canonicalSignature)
    if (definition.edgePattern !== expectedPattern) {
      throw new DiagramSpecError(
        `Case ${definition.id} edge-pattern metadata does not match its signature.`,
      )
    }
  } else {
    arrows = lastLayerPermutationArrows(state)
    if (arrows.length === 0) {
      throw new DiagramSpecError(
        `PLL case ${definition.id} produced no permutation arrows.`,
      )
    }
  }

  const spec: DiagramSpec = {
    caseId: definition.id,
    caseName: definition.name,
    caseLabel: definition.caseLabel,
    kind:
      definition.kind === 'oll-orientation' ? 'oll' : 'pll',
    setId: definition.setId,
    signature: definition.canonicalSignature,
    representativeSignature: definition.representativeSignature,
    family: definition.groupId,
    viewingOrientation: definition.viewingOrientation,
    asset: definition.diagramAsset,
    facelets,
    arrows,
    title: titleFor(definition),
    description: descriptionFor(definition),
  }
  validateDiagramSpec(spec)
  return spec
}

function buildStateAndAssert(
  model: Cube3Model,
  definition: StandardCaseDefinition,
): Cube3State {
  const state = buildCaseRepresentativeState(model, definition)
  assertCaseState(state, definition)
  return state
}

export function validateDiagramSpec(spec: DiagramSpec): void {
  if (!spec.caseId.trim()) {
    throw new DiagramSpecError('Diagram case id is empty.')
  }
  if (!spec.caseName.trim() || !spec.caseLabel.trim()) {
    throw new DiagramSpecError(`Case ${spec.caseId} has no display name.`)
  }
  if (spec.kind !== 'oll' && spec.kind !== 'pll') {
    throw new DiagramSpecError(`Case ${spec.caseId} has invalid kind.`)
  }
  if (!spec.signature.trim()) {
    throw new DiagramSpecError(`Case ${spec.caseId} has no signature.`)
  }
  if (!spec.representativeSignature.trim()) {
    throw new DiagramSpecError(
      `Case ${spec.caseId} has no representative signature.`,
    )
  }
  if (!spec.family.trim()) {
    throw new DiagramSpecError(`Case ${spec.caseId} has no family.`)
  }
  if (spec.viewingOrientation !== STANDARD_VIEWING_ORIENTATION) {
    throw new DiagramSpecError(
      `Case ${spec.caseId} has an inconsistent viewing orientation.`,
    )
  }
  if (!spec.asset.startsWith('training/diagrams/') || !spec.asset.endsWith('.svg')) {
    throw new DiagramSpecError(
      `Case ${spec.caseId} has an invalid diagram asset path.`,
    )
  }
  if (!spec.title.trim() || !spec.description.trim()) {
    throw new DiagramSpecError(
      `Case ${spec.caseId} is missing accessible SVG metadata.`,
    )
  }

  validateLastLayerFacelets(spec.facelets)

  if (spec.kind === 'oll') {
    if (spec.arrows.length !== 0) {
      throw new DiagramSpecError(
        `OLL case ${spec.caseId} must not contain permutation arrows.`,
      )
    }
    if (spec.facelets.top.flat().some((color) => color === 'D')) {
      throw new DiagramSpecError(
        `OLL case ${spec.caseId} contains a D sticker in the U face.`,
      )
    }
  } else {
    if (spec.facelets.top.flat().some((color) => color !== 'U')) {
      throw new DiagramSpecError(
        `PLL case ${spec.caseId} is not fully oriented in U.`,
      )
    }
    const sideColors = [
      ...spec.facelets.back,
      ...spec.facelets.front,
      ...spec.facelets.left,
      ...spec.facelets.right,
    ]
    if (sideColors.some((color) => color === 'U')) {
      throw new DiagramSpecError(
        `PLL case ${spec.caseId} has a U sticker on a side face.`,
      )
    }
    if (spec.arrows.length === 0) {
      throw new DiagramSpecError(
        `PLL case ${spec.caseId} has no permutation arrows.`,
      )
    }
    const seen = new Set<string>()
    for (const arrow of spec.arrows) {
      if (!isULayerPosition(arrow.from) || !isULayerPosition(arrow.to)) {
        throw new DiagramSpecError(
          `PLL case ${spec.caseId} has an arrow with an invalid position.`,
        )
      }
      if (!isULayerPosition(arrow.piece)) {
        throw new DiagramSpecError(
          `PLL case ${spec.caseId} has an arrow with an invalid piece.`,
        )
      }
      if (arrow.piece !== arrow.to) {
        throw new DiagramSpecError(
          `PLL case ${spec.caseId} arrow piece ${arrow.piece} does not match its destination ${arrow.to}.`,
        )
      }
      if (arrow.from === arrow.to) {
        throw new DiagramSpecError(
          `PLL case ${spec.caseId} has a fixed-piece arrow.`,
        )
      }
      const corner = arrow.kind === 'corner'
      const validFrom =
        (corner && arrow.from.startsWith('U') && ['UFR', 'UBR', 'UBL', 'UFL'].includes(arrow.from)) ||
        (!corner && ['UF', 'UR', 'UB', 'UL'].includes(arrow.from))
      const validTo =
        (corner && ['UFR', 'UBR', 'UBL', 'UFL'].includes(arrow.to)) ||
        (!corner && ['UF', 'UR', 'UB', 'UL'].includes(arrow.to))
      if (!validFrom || !validTo) {
        throw new DiagramSpecError(
          `PLL case ${spec.caseId} has an arrow whose kind does not match its positions.`,
        )
      }
      const key = `${arrow.kind}:${arrow.from}`
      if (seen.has(key)) {
        throw new DiagramSpecError(
          `PLL case ${spec.caseId} has a duplicate source arrow ${key}.`,
        )
      }
      seen.add(key)
    }
  }
}

/**
 * Rebuilds the canonical spec and compares the display-bearing fields. Tests use
 * this to prove that a deliberately changed sticker or arrow is rejected.
 */
export function assertDiagramSpecMatchesCase(
  spec: DiagramSpec,
  model: Cube3Model,
  definition: StandardCaseDefinition,
): void {
  const expected = buildDiagramSpec(model, definition)
  const fields: readonly (keyof DiagramSpec)[] = [
    'caseId',
    'caseName',
    'caseLabel',
    'kind',
    'setId',
    'signature',
    'representativeSignature',
    'family',
    'viewingOrientation',
    'asset',
    'facelets',
    'arrows',
    'title',
    'description',
  ]
  for (const field of fields) {
    if (JSON.stringify(spec[field]) !== JSON.stringify(expected[field])) {
      throw new DiagramSpecError(
        `Case ${spec.caseId} differs from its verified state at "${field}".`,
      )
    }
  }
}
