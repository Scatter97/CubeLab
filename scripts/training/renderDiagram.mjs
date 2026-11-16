/**
 * Deterministic static-SVG renderer for CubeLab Training case diagrams.
 *
 * Development-time only. The application never imports this module and never
 * generates diagrams at runtime. Inputs are verified `DiagramSpec` objects; the
 * renderer emits flat, original SVG with no scripts, external references,
 * gradients, filters or shadows.
 *
 * OLL uses the compact 3x3 top-face convention: nine square stickers with a
 * uniformly light outer border and internal dividers, plus thin yellow bars only
 * where a U sticker faces sideways. PLL uses the same 3x3 convention with its
 * original grid proportions, coloured side bars for the actual permuted side
 * stickers, and black permutation arrows.
 */

export const DIAGRAM_SIZE = 128

const PLL_LAYOUT = {
  cell: 26,
  outerGrid: 3,
  innerGrid: 2,
  mainX: 20,
  mainY: 20,
  mainSize: 88,
  cellStep: 28,
  cellOrigin: 23,
  barThickness: 6.5,
  // Half the outline overlaps the main border, keeping the visible join flush.
  barGap: -1,
  barStroke: 2,
}

// OLL-only refinement: a larger face, a uniformly light 2 px grid, and slightly
// closer, slimmer side bars. PLL keeps its established face geometry.
const OLL_LAYOUT = {
  cell: 28,
  outerGrid: 2,
  innerGrid: 2,
  mainX: 18,
  mainY: 18,
  mainSize: 92,
  cellStep: 30,
  cellOrigin: 20,
  barThickness: 5,
  barGap: 3,
  barStroke: 1.25,
}

// Tips use cubie centres as anchors; clearance is measured to the tip, not
// the shaft base. Corner tips extend closer to their anchors; edge geometry stays.
const ARROW_CLEARANCE = {
  directedStart: 8,
  directedEnd: 9,
  openCycleEnd: 2,
  doubleEdge: 1,
  doubleCorner: 2,
  directedCornerEnd: 3,
}

// Fixed dimensions in viewBox units, independent of path length/direction.
const ARROW_STYLE = {
  width: 5.5,
  haloExtra: 3,
  headLength: 8,
  headHalfWidth: 5.5,
}

function arrowStyle(kind, mixed) {
  // An inner edge lane needs a lighter shaft only when corner cycles overlap it.
  return mixed && kind === 'edge' ? { ...ARROW_STYLE, width: 4.2 } : ARROW_STYLE
}
const FACE_COLORS = new Set(['U', 'D', 'F', 'B', 'R', 'L'])

const PALETTE = {
  yellow: '#FFF200',
  ollYellow: '#FFF200',
  neutral: '#C3CBD3',
  grid: '#111418',
  faces: {
    U: '#FFF200',
    D: '#F7F9FB',
    F: '#00C853',
    B: '#2962FF',
    R: '#FF3030',
    L: '#FF8A00',
  },
}

const TOP_POSITIONS = [
  ['UBL', 'UB', 'UBR'],
  ['UL', 'U', 'UR'],
  ['UFL', 'UF', 'UFR'],
]

const SIDE_BAR_LAYOUT = [
  {
    face: 'B',
    key: 'back',
    positions: ['UBL', 'UB', 'UBR'],
    side: 'top',
  },
  {
    face: 'F',
    key: 'front',
    positions: ['UFL', 'UF', 'UFR'],
    side: 'bottom',
  },
  {
    face: 'L',
    key: 'left',
    positions: ['UBL', 'UL', 'UFL'],
    side: 'left',
  },
  {
    face: 'R',
    key: 'right',
    positions: ['UBR', 'UR', 'UFR'],
    side: 'right',
  },
]

const U_GRID = new Map([
  ['UBL', { row: 0, col: 0 }],
  ['UB', { row: 0, col: 1 }],
  ['UBR', { row: 0, col: 2 }],
  ['UL', { row: 1, col: 0 }],
  ['U', { row: 1, col: 1 }],
  ['UR', { row: 1, col: 2 }],
  ['UFL', { row: 2, col: 0 }],
  ['UF', { row: 2, col: 1 }],
  ['UFR', { row: 2, col: 2 }],
])

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function number(value) {
  return Number(value.toFixed(2)).toString()
}

function layoutFor(spec) {
  return spec.kind === 'oll' ? OLL_LAYOUT : PLL_LAYOUT
}

function barTop(layout) {
  return layout.mainY - layout.barGap - layout.barThickness
}

function barBottom(layout) {
  return layout.mainY + layout.mainSize + layout.barGap
}

function barLeft(layout) {
  return layout.mainX - layout.barGap - layout.barThickness
}

function barRight(layout) {
  return layout.mainX + layout.mainSize + layout.barGap
}

function cellX(layout, col) {
  return layout.cellOrigin + col * layout.cellStep
}

function cellY(layout, row) {
  return layout.cellOrigin + row * layout.cellStep
}

function cellCenter(layout, row, col) {
  return {
    x: cellX(layout, col) + layout.cell / 2,
    y: cellY(layout, row) + layout.cell / 2,
  }
}

function positionCenter(position) {
  const cell = U_GRID.get(position)
  if (!cell) {
    throw new Error(`Unknown U-layer position ${position}.`)
  }
  return cellCenter(PLL_LAYOUT, cell.row, cell.col)
}

function stickerFill(spec, color) {
  if (spec.kind === 'oll') {
    return color === 'U' ? PALETTE.ollYellow : PALETTE.neutral
  }
  return PALETTE.faces[color] ?? PALETTE.neutral
}

function stickerCell(spec, layout, row, col, position, color) {
  return (
    `<rect class="sticker" data-face="U" data-position="${position}" data-sticker-color="${color}" ` +
    `x="${number(cellX(layout, col))}" y="${number(cellY(layout, row))}" width="${layout.cell}" height="${layout.cell}" ` +
    `fill="${stickerFill(spec, color)}"/>`
  )
}

function topCells(spec, layout) {
  const cells = []
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      cells.push(
        stickerCell(
          spec,
          layout,
          row,
          col,
          TOP_POSITIONS[row][col],
          spec.facelets.top[row][col],
        ),
      )
    }
  }
  return cells
}

function sideBarGeometry(layout, side, index) {
  // PLL outlines sit outside the top-cell fill extents. Adjacent bars share
  // their boundary stroke instead of stacking two outlines around a gap.
  const outline = layout === PLL_LAYOUT ? layout.barStroke : 0
  if (side === 'top') {
    return {
      x: cellX(layout, index) - outline / 2,
      y: barTop(layout),
      width: layout.cell + outline,
      height: layout.barThickness,
    }
  }
  if (side === 'bottom') {
    return {
      x: cellX(layout, index) - outline / 2,
      y: barBottom(layout),
      width: layout.cell + outline,
      height: layout.barThickness,
    }
  }
  if (side === 'left') {
    return {
      x: barLeft(layout),
      y: cellY(layout, index) - outline / 2,
      width: layout.barThickness,
      height: layout.cell + outline,
    }
  }
  return {
    x: barRight(layout),
    y: cellY(layout, index) - outline / 2,
    width: layout.barThickness,
    height: layout.cell + outline,
  }
}

export function sideBarEntries(spec) {
  const layout = layoutFor(spec)
  const entries = []
  for (const barLayout of SIDE_BAR_LAYOUT) {
    const colors = spec.facelets[barLayout.key]
    barLayout.positions.forEach((position, index) => {
      const color = colors[index]
      if (!FACE_COLORS.has(color)) {
        throw new Error(
          `Diagram ${spec.caseId} has invalid ${barLayout.face} side colour ${color}.`,
        )
      }
      if (spec.kind === 'oll' && color !== 'U') return
      if (spec.kind === 'pll' && color === 'U') {
        throw new Error(
          `Diagram ${spec.caseId} has a U sticker on the ${barLayout.face} side.`,
        )
      }
      entries.push({
        face: barLayout.face,
        side: barLayout.side,
        position,
        color,
        ...sideBarGeometry(layout, barLayout.side, index),
      })
    })
  }
  return entries
}

function sideBars(spec) {
  const layout = layoutFor(spec)
  return sideBarEntries(spec).map((entry) => {
    const fill =
      spec.kind === 'oll' ? PALETTE.ollYellow : PALETTE.faces[entry.color]
    return (
      `<rect class="side-bar" data-face="${entry.face}" data-position="${entry.position}" data-sticker-color="${entry.color}" ` +
      `x="${number(entry.x)}" y="${number(entry.y)}" width="${number(entry.width)}" height="${number(entry.height)}" ` +
      `fill="${fill}" stroke="${PALETTE.grid}" stroke-width="${layout.barStroke}"/>`
    )
  })
}

function sideStrips(spec) {
  if (spec.kind !== 'pll') return []
  const layout = PLL_LAYOUT
  const stripOverhang = layout.barStroke / 2
  const stripSize = layout.barThickness + layout.barStroke
  // Match the full face bounds: inset strip ends create notches at its corners.
  const stripLength = layout.mainSize
  return [
    `<rect class="side-strip" data-face="B" x="${layout.mainX}" y="${number(barTop(layout) - stripOverhang)}" width="${stripLength}" height="${number(stripSize)}" fill="${PALETTE.grid}"/>`,
    `<rect class="side-strip" data-face="F" x="${layout.mainX}" y="${number(barBottom(layout) - stripOverhang)}" width="${stripLength}" height="${number(stripSize)}" fill="${PALETTE.grid}"/>`,
    `<rect class="side-strip" data-face="L" x="${number(barLeft(layout) - stripOverhang)}" y="${layout.mainY}" width="${number(stripSize)}" height="${stripLength}" fill="${PALETTE.grid}"/>`,
    `<rect class="side-strip" data-face="R" x="${number(barRight(layout) - stripOverhang)}" y="${layout.mainY}" width="${number(stripSize)}" height="${stripLength}" fill="${PALETTE.grid}"/>`,
  ]
}

export function permutationCycleGroups(arrows) {
  const groups = []
  for (const kind of ['corner', 'edge']) {
    const kindArrows = arrows.filter((arrow) => arrow.kind === kind)
    const byFrom = new Map(kindArrows.map((arrow) => [arrow.from, arrow]))
    const visited = new Set()

    for (const arrow of kindArrows) {
      if (visited.has(arrow.from)) continue
      const positions = []
      let current = arrow.from
      let guard = 0
      while (current !== undefined && !visited.has(current)) {
        visited.add(current)
        const next = byFrom.get(current)
        if (!next) break
        positions.push(current)
        current = next.to
        guard += 1
        if (guard > 8) {
          throw new Error(`Permutation cycle for ${kind} pieces does not close.`)
        }
      }
      if (positions.length <= 1) continue
      if (current !== arrow.from) {
        throw new Error(`Permutation cycle for ${kind} pieces does not close.`)
      }
      const cycleArrows = positions.map((from) => {
        const cycleArrow = byFrom.get(from)
        if (!cycleArrow) {
          throw new Error(`Permutation cycle is missing an arrow from ${from}.`)
        }
        return cycleArrow
      })
      groups.push({ kind, positions, arrows: cycleArrows })
    }
  }
  return groups
}

function arrowGeometry(kind, from, to, both, mixed) {
  const style = arrowStyle(kind, mixed)
  // Every movement follows the line between the actual cubie centres.
  const startCenter = positionCenter(from)
  const endCenter = positionCenter(to)
  const dx = endCenter.x - startCenter.x
  const dy = endCenter.y - startCenter.y
  const length = Math.hypot(dx, dy)
  if (length === 0) {
    throw new Error(`Arrow ${from}->${to} has zero length.`)
  }
  const ux = dx / length
  const uy = dy / length
  const px = -uy
  const py = ux
  const doubleTrim =
    kind === 'corner'
      ? ARROW_CLEARANCE.doubleCorner
      : ARROW_CLEARANCE.doubleEdge
  const startTrim = both ? doubleTrim : ARROW_CLEARANCE.directedStart
  const endTrim = both
    ? doubleTrim
    : kind === 'corner'
      ? ARROW_CLEARANCE.directedCornerEnd
      : !mixed
        ? ARROW_CLEARANCE.openCycleEnd
        : ARROW_CLEARANCE.directedEnd
  if (length <= startTrim + endTrim + style.headLength * 2) {
    throw new Error(`Arrow ${from}->${to} is too short for its arrowheads.`)
  }
  const startTip = {
    x: startCenter.x + ux * startTrim,
    y: startCenter.y + uy * startTrim,
  }
  const endTip = {
    x: endCenter.x - ux * endTrim,
    y: endCenter.y - uy * endTrim,
  }
  const startBase = {
    x: startTip.x + ux * style.headLength,
    y: startTip.y + uy * style.headLength,
  }
  const endBase = {
    x: endTip.x - ux * style.headLength,
    y: endTip.y - uy * style.headLength,
  }
  const shaftStart = both ? startBase : startTip
  const shaftEnd = endBase
  const heads = []
  if (both) {
    heads.push({ tip: startTip, base: startBase, px, py })
  }
  heads.push({ tip: endTip, base: endBase, px, py })
  return {
    shaft: `M ${number(shaftStart.x)} ${number(shaftStart.y)} L ${number(shaftEnd.x)} ${number(shaftEnd.y)}`,
    heads,
    startTip,
    endTip,
  }
}

function arrowHeadPoints(head, style) {
  const first = {
    x: head.base.x + head.px * style.headHalfWidth,
    y: head.base.y + head.py * style.headHalfWidth,
  }
  const second = {
    x: head.base.x - head.px * style.headHalfWidth,
    y: head.base.y - head.py * style.headHalfWidth,
  }
  return (
    `${number(head.tip.x)},${number(head.tip.y)} ` +
    `${number(first.x)},${number(first.y)} ${number(second.x)},${number(second.y)}`
  )
}

function arrowHeadMarkup(head, style) {
  return (
    `<polygon class="arrowhead" points="${arrowHeadPoints(head, style)}" ` +
    `fill="${PALETTE.grid}"/>`
  )
}

function arrowHeadHaloMarkup(head, style) {
  return (
    `<polygon class="arrow-halo" points="${arrowHeadPoints(head, style)}" fill="none" ` +
    `stroke="${PALETTE.yellow}" stroke-width="${style.haloExtra}" stroke-linejoin="round"/>`
  )
}

function arrowShaftMarkup(kind, from, to, geometry, both, style) {
  const bidirectional = both ? ' data-bidirectional="true"' : ''
  return (
    `<path class="permutation-arrow" data-kind="${kind}" data-from="${from}" data-to="${to}"${bidirectional} ` +
    `d="${geometry.shaft}" fill="none" stroke="${PALETTE.grid}" stroke-width="${style.width}" ` +
    `stroke-linecap="butt"/>`
  )
}

function arrowShaftHaloMarkup(geometry, style) {
  return (
    `<path class="arrow-halo" d="${geometry.shaft}" fill="none" ` +
    `stroke="${PALETTE.yellow}" stroke-width="${style.width + style.haloExtra}" stroke-linecap="butt"/>`
  )
}

function arrowMarkup(kind, from, to, geometry, both, mixed) {
  const style = arrowStyle(kind, mixed)
  return (
    arrowShaftHaloMarkup(geometry, style) +
    geometry.heads.map((head) => arrowHeadHaloMarkup(head, style)).join('') +
    arrowShaftMarkup(kind, from, to, geometry, both, style) +
    geometry.heads.map((head) => arrowHeadMarkup(head, style)).join('')
  )
}

function cycleMarkup(group, mixed) {
  const both = group.positions.length === 2
  const arrows = []
  if (both) {
    const [from, to] = group.positions
    arrows.push(
      arrowMarkup(
        group.kind,
        from,
        to,
        arrowGeometry(group.kind, from, to, true, mixed),
        true,
        mixed,
      ),
    )
  } else {
    for (let index = 0; index < group.positions.length; index += 1) {
      const from = group.positions[index]
      const to = group.positions[(index + 1) % group.positions.length]
      arrows.push(
        arrowMarkup(
          group.kind,
          from,
          to,
          arrowGeometry(group.kind, from, to, false, mixed),
          false,
          mixed,
        ),
      )
    }
  }

  const cycle = group.positions.join('>')
  const arrowList = group.arrows
    .map((arrow) => `${arrow.kind}:${arrow.from}>${arrow.to}`)
    .join(' ')
  return (
    `<g class="permutation-cycle" data-kind="${group.kind}" data-cycle="${escapeXml(cycle)}" data-arrows="${escapeXml(arrowList)}">` +
    arrows.join('') +
    '</g>'
  )
}

function permutationArrows(spec) {
  if (spec.kind !== 'pll') return ''
  const cycles = permutationCycleGroups(spec.arrows)
  if (cycles.length === 0) {
    throw new Error(`PLL diagram ${spec.caseId} has no permutation cycles.`)
  }
  const ordered = [...cycles].sort((first, second) => {
    const rank = (cycle) => (cycle.kind === 'edge' ? 0 : 1)
    return rank(first) - rank(second)
  })
  const mixed =
    cycles.some((cycle) => cycle.kind === 'corner') &&
    cycles.some((cycle) => cycle.positions.length > 2)
  return (
    '<g class="permutation-arrows" aria-hidden="true">' +
    ordered.map((group) => cycleMarkup(group, mixed)).join('') +
    '</g>'
  )
}

function assertColor(value, label) {
  if (!FACE_COLORS.has(value)) {
    throw new Error(`${label} contains invalid colour "${value}".`)
  }
}

function assertSpecShape(spec) {
  if (!spec || typeof spec !== 'object') {
    throw new Error('Diagram spec must be an object.')
  }
  if (spec.kind !== 'oll' && spec.kind !== 'pll') {
    throw new Error(`Diagram ${spec.caseId ?? '(unknown)'} has invalid kind.`)
  }
  if (!spec.facelets || spec.facelets.top?.length !== 3) {
    throw new Error(`Diagram ${spec.caseId ?? '(unknown)'} has no U face.`)
  }
  for (const row of spec.facelets.top) {
    if (!Array.isArray(row) || row.length !== 3) {
      throw new Error(
        `Diagram ${spec.caseId ?? '(unknown)'} has an invalid U-face row.`,
      )
    }
    for (const color of row) {
      assertColor(color, `Diagram ${spec.caseId} U face`)
    }
  }
  for (const key of ['back', 'front', 'left', 'right']) {
    if (!Array.isArray(spec.facelets[key]) || spec.facelets[key].length !== 3) {
      throw new Error(
        `Diagram ${spec.caseId ?? '(unknown)'} has an invalid ${key} strip.`,
      )
    }
    for (const color of spec.facelets[key]) {
      assertColor(color, `Diagram ${spec.caseId} ${key} strip`)
    }
  }
  if (!Array.isArray(spec.arrows)) {
    throw new Error(`Diagram ${spec.caseId ?? '(unknown)'} has no arrow list.`)
  }
  if (spec.kind === 'oll') {
    if (spec.arrows.length !== 0) {
      throw new Error(`OLL diagram ${spec.caseId} must not contain arrows.`)
    }
    if (spec.facelets.top.flat().includes('D')) {
      throw new Error(`OLL diagram ${spec.caseId} has a D sticker in U.`)
    }
  } else {
    if (spec.arrows.length === 0) {
      throw new Error(`PLL diagram ${spec.caseId} has no arrows.`)
    }
    if (spec.facelets.top.flat().some((color) => color !== 'U')) {
      throw new Error(`PLL diagram ${spec.caseId} is not fully oriented in U.`)
    }
    const sides = [
      ...spec.facelets.back,
      ...spec.facelets.front,
      ...spec.facelets.left,
      ...spec.facelets.right,
    ]
    if (sides.some((color) => color === 'U')) {
      throw new Error(`PLL diagram ${spec.caseId} has a U sticker on a side.`)
    }
  }
}

export function renderDiagramSvg(spec) {
  assertSpecShape(spec)
  const layout = layoutFor(spec)
  const cells = topCells(spec, layout)
  const strips = sideStrips(spec)
  const bars = sideBars(spec)
  const arrows = permutationArrows(spec)
  const svg = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${DIAGRAM_SIZE}" height="${DIAGRAM_SIZE}" viewBox="0 0 ${DIAGRAM_SIZE} ${DIAGRAM_SIZE}" role="img" aria-labelledby="case-title case-desc" data-case-id="${escapeXml(spec.caseId)}" data-case-name="${escapeXml(spec.caseName)}" data-case-kind="${spec.kind}" data-signature="${escapeXml(spec.signature)}" data-representative-signature="${escapeXml(spec.representativeSignature)}" data-view="${escapeXml(spec.viewingOrientation)}" data-diagram-style="compact-3x3">`,
    `<title id="case-title">${escapeXml(spec.title)}</title>`,
    `<desc id="case-desc">${escapeXml(spec.description)}</desc>`,
    `<rect class="grid-background" x="${layout.mainX}" y="${layout.mainY}" width="${layout.mainSize}" height="${layout.mainSize}" fill="${PALETTE.grid}"/>`,
    `<g class="top-face">${cells.join('')}</g>`,
    strips.length ? `<g class="side-strips">${strips.join('')}</g>` : '',
    bars.length ? `<g class="side-bars">${bars.join('')}</g>` : '',
    arrows,
    '</svg>',
  ]
    .filter(Boolean)
    .join('\n')
  assertDiagramSvgSafe(svg)
  return svg
}

const FORBIDDEN_MARKUP = [
  /<\s*script\b/i,
  /<\s*foreignObject\b/i,
  /<\s*iframe\b/i,
  /<\s*object\b/i,
  /<\s*embed\b/i,
  /<\s*image\b/i,
  /<\s*use\b/i,
  /<\s*style\b/i,
  /\son[a-z]+\s*=/i,
  /\b(?:xlink:)?href\s*=/i,
  /\b(?:data|javascript):/i,
  /@import/i,
  /url\(\s*['"]?(?!#)/i,
]

export function assertDiagramSvgSafe(svg) {
  if (typeof svg !== 'string' || !svg.trimStart().startsWith('<?xml')) {
    throw new Error('Diagram SVG must be a complete XML document.')
  }
  for (const pattern of FORBIDDEN_MARKUP) {
    if (pattern.test(svg)) {
      throw new Error(`Diagram SVG contains forbidden markup: ${pattern}.`)
    }
  }
  for (const required of [
    '<svg ',
    'xmlns="http://www.w3.org/2000/svg"',
    `width="${DIAGRAM_SIZE}"`,
    `height="${DIAGRAM_SIZE}"`,
    `viewBox="0 0 ${DIAGRAM_SIZE} ${DIAGRAM_SIZE}"`,
    'role="img"',
    'aria-labelledby="case-title case-desc"',
    '<title id="case-title">',
    '<desc id="case-desc">',
    'data-case-id="',
    'data-signature="',
    'data-representative-signature="',
    'data-diagram-style="compact-3x3"',
    'class="grid-background"',
    'class="sticker"',
  ]) {
    if (!svg.includes(required)) {
      throw new Error(`Diagram SVG is missing required content: ${required}`)
    }
  }
  if (!svg.trimEnd().endsWith('</svg>')) {
    throw new Error('Diagram SVG does not close its root element.')
  }
}

function escapeHtml(value) {
  return escapeXml(value)
}

export function renderContactSheet(specs, options = {}) {
  if (!Array.isArray(specs) || specs.length === 0) {
    throw new Error('Contact sheet requires at least one diagram.')
  }
  const fullCollection = options.fullCollection === true
  const oll = specs.filter((spec) => spec.kind === 'oll')
  const pll = specs.filter((spec) => spec.kind === 'pll')

  const card = (spec, surface) => {
    const source = `../../../src/assets/${spec.asset}`
    const alt = `${spec.title}. Signature ${escapeHtml(spec.signature)}.`
    return (
      `<figure class="card${surface ? ` ${surface}` : ''}">` +
      '<div class="sizes">' +
      `<div class="diagram-size"><img src="${escapeHtml(source)}" width="${DIAGRAM_SIZE}" height="${DIAGRAM_SIZE}" alt="${alt}"><span class="size-label">128 px</span></div>` +
      `<div class="diagram-size small"><img src="${escapeHtml(source)}" width="64" height="64" alt="" aria-hidden="true"><span class="size-label">64 px</span></div>` +
      '</div>' +
      `<figcaption><strong>${escapeHtml(spec.caseLabel)}</strong><code>${escapeHtml(spec.signature)}</code></figcaption>` +
      '</figure>'
    )
  }

  const section = (title, entries) => {
    if (entries.length === 0) return ''
    const cards = entries.map((spec) => card(spec, '')).join('')
    return `<section><h2>${escapeHtml(title)}</h2><div class="grid">${cards}</div></section>`
  }

  const darkCards = specs.map((spec) => card(spec, 'on-dark')).join('')
  const documentTitle = fullCollection
    ? 'CubeLab Training — Phase 2C complete diagram set'
    : 'CubeLab Training — Phase 2C diagram previews'
  const heading = fullCollection
    ? 'Complete 3×3 last-layer diagram set'
    : 'Compact 3×3 last-layer diagram previews'
  const introduction = fullCollection
    ? `All ${specs.length} standard last-layer diagrams (${oll.length} OLL, ${pll.length} PLL) generated deterministically from verified cube states in the traditional compact 3×3 speedcubing convention. Both visual styles are owner-approved. OLL uses a brighter yellow, a uniformly light 2 px outer border and internal grid, and closer, slightly thinner side bars. PLL uses a lighter 2 px inner grid and matching side outlines, a slightly bolder 3 px face border, side stickers joined directly to the face border, the approved OLL yellow, fixed-size arrowheads and the established arrow routing.`
    : 'Ten representative diagrams generated from verified cube states in the traditional compact 3×3 speedcubing convention. OLL now uses a brighter yellow, a uniformly light 2 px outer border and internal grid, and closer, slightly thinner side bars. PLL uses a lighter 2 px inner grid and matching side outlines, with a slightly bolder 3 px face border and side stickers joined directly to the face border and vibrant side colours, the approved OLL yellow, fixed-size arrowheads and longer edge arrows. T’s vertical corner swap is centred on its corner column; Gc retains its outer and inner lanes with a corrected UFL junction. The remaining 68 diagrams are intentionally not generated until these visual styles are approved.'
  const note = fullCollection
    ? 'Complete Phase 2C collection. All 57 OLL and 21 PLL static SVGs are committed, generated from verified states, and contain no scripts or external references. Algorithms remain unbundled because F12 is unresolved. The reference images are internal design references and are not distributed with the application.'
    : 'Preview checkpoint only. OLL uses a uniformly lighter 3×3 face, closer and slightly thinner side bars, and a brighter yellow. OLL is visually approved and unchanged. PLL awaits owner visual approval: thinner matching inner lines and side outlines, a slightly bolder main border, flush side stickers, matching OLL yellow, fixed-size heads, stronger edge shafts, tighter tip clearance and a shared Gc corner junction. The remaining 68 assets and Phase 3 remain out of scope; F12 is unresolved. Static SVG files are stored in <code>src/assets/training/diagrams/</code>; no runtime SVG generation is part of the application. The reference images are internal design references and are not distributed with the application.'
  const footerCommand = fullCollection ? '--all' : '--preview'

  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${documentTitle}</title>`,
    '<style>',
    ':root { color-scheme: light; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }',
    'body { margin: 0; background: #eef2f5; color: #1b232c; }',
    'main { max-width: 1120px; margin: 0 auto; padding: 40px 24px 56px; }',
    'header { max-width: 740px; }',
    'h1 { margin: 0 0 10px; font-size: 30px; line-height: 1.15; letter-spacing: -0.02em; }',
    'h2 { margin: 0 0 16px; font-size: 18px; }',
    'p { margin: 0 0 10px; line-height: 1.55; color: #3e4a56; }',
    '.eyebrow { margin: 0 0 8px; font-size: 12px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: #5a6570; }',
    'section { margin-top: 34px; }',
    '.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 16px; }',
    '.card { margin: 0; padding: 16px; border: 1px solid #c6ced6; border-radius: 6px; background: #f8fafb; }',
    '.card.on-dark { border-color: #3a444f; background: #151a20; }',
    '.sizes { display: flex; align-items: flex-end; justify-content: center; gap: 16px; min-height: 128px; }',
    '.diagram-size { display: flex; flex-direction: column; align-items: center; gap: 6px; }',
    '.diagram-size img { display: block; }',
    '.diagram-size.small img { width: 64px; height: 64px; }',
    '.size-label { font-size: 11px; color: #65717d; font-variant-numeric: tabular-nums; }',
    '.card.on-dark .size-label { color: #9aa7b4; }',
    'figcaption { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-top: 12px; font-size: 13px; }',
    '.card.on-dark figcaption { color: #e8edf2; }',
    'code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; color: #5a6570; overflow-wrap: anywhere; }',
    '.card.on-dark code { color: #9aa7b4; }',
    '.legend { display: flex; flex-wrap: wrap; gap: 10px 20px; padding: 0; margin: 0; list-style: none; font-size: 13px; }',
    '.legend li { display: flex; align-items: center; gap: 7px; }',
    '.swatch { width: 14px; height: 14px; border: 1px solid #111418; }',
    '.swatch.arrow { width: 24px; height: 4px; border: 0; background: #111418; }',
    '.note { max-width: 760px; padding: 14px 16px; border-left: 3px solid #59636e; background: #f8fafb; }',
    '.dark-band { margin-top: 34px; padding: 24px; border-radius: 6px; background: #151a20; color: #e8edf2; }',
    '.dark-band p, .dark-band .eyebrow { color: #9aa7b4; }',
    'footer { margin-top: 34px; font-size: 12px; color: #5a6570; }',
    '@media (max-width: 520px) { main { padding: 28px 16px 44px; } h1 { font-size: 24px; } .grid { grid-template-columns: repeat(auto-fill, minmax(224px, 1fr)); } .sizes { gap: 10px; } }',
    '</style>',
    '</head>',
    '<body>',
    '<main>',
    '<header>',
    '<p class="eyebrow">CubeLab Training · Phase 2C</p>',
    `<h1>${escapeHtml(heading)}</h1>`,
    `<p>${escapeHtml(introduction)}</p>`,
    '</header>',
    '<section>',
    '<h2>Legend</h2>',
    '<ul class="legend">',
    `<li><span class="swatch" style="background:${PALETTE.ollYellow}"></span>U sticker on top (OLL)</li>`,
    `<li><span class="swatch" style="background:${PALETTE.neutral}"></span>Other top-face sticker (OLL)</li>`,
    `<li><span class="swatch" style="background:${PALETTE.ollYellow}"></span>Sideways-facing U sticker bar (OLL)</li>`,
    `<li><span class="swatch" style="background:${PALETTE.yellow}"></span>U face (PLL)</li>`,
    `<li><span class="swatch" style="background:${PALETTE.faces.F}"></span>Front</li>`,
    `<li><span class="swatch" style="background:${PALETTE.faces.R}"></span>Right</li>`,
    `<li><span class="swatch" style="background:${PALETTE.faces.B}"></span>Back</li>`,
    `<li><span class="swatch" style="background:${PALETTE.faces.L}"></span>Left</li>`,
    '<li><span class="swatch arrow"></span>Permutation arrow (PLL)</li>',
    '</ul>',
    '</section>',
    section(
      fullCollection
        ? `OLL (${oll.length} ${oll.length === 1 ? 'case' : 'cases'})`
        : 'OLL',
      oll,
    ),
    section(
      fullCollection
        ? `PLL (${pll.length} ${pll.length === 1 ? 'case' : 'cases'})`
        : 'PLL',
      pll,
    ),
    '<section class="dark-band">',
    '<h2>Dark surface</h2>',
    '<p>The same static SVGs on a dark panel. Each case is shown at 128 px full size and 64 px for the typical Training UI size. The diagram palette does not depend on the application theme.</p>',
    `<div class="grid">${darkCards}</div>`,
    '</section>',
    `<p class="note">${note}</p>`,
    fullCollection
      ? ''
      : '<p><a href="pll-refinement-comparison.html">PLL before/after comparison, including 2× geometry diagnostics</a></p>',
    `<footer>Generated deterministically by <code>scripts/training/generate-diagrams.mjs ${footerCommand}</code>.</footer>`,
    '</main>',
    '</body>',
    '</html>',
  ].join('\n')
}
