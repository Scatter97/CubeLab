/// <reference types="node" />
// @vitest-environment jsdom
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { loadCube3Model, type Cube3Model } from '../cube3'
import {
  OLL_STANDARD_CASES,
  PLL_NAMED_CASES,
  STANDARD_CASES,
  STANDARD_CASE_BY_ID,
  type StandardCaseDefinition,
} from '../catalog/standardCases'
import {
  TOP_FACE_POSITIONS,
  BACK_STRIP_POSITIONS,
  FRONT_STRIP_POSITIONS,
  LEFT_STRIP_POSITIONS,
  RIGHT_STRIP_POSITIONS,
  type FaceColor,
} from './facelets'
import { lastLayerPermutationCycles } from './arrows'
import { buildDiagramSpec, type DiagramSpec } from './buildDiagramSpec'

const ROOT = process.cwd()
const CONTACT_SHEET = path.join(
  ROOT,
  'docs/training/previews/phase-2c-diagrams.html',
)
const ALL_CONTACT_SHEET = path.join(
  ROOT,
  'docs/training/previews/phase-2c-all-diagrams.html',
)

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

const PREVIEW_IDS = [
  'oll:1',
  'oll:27',
  'oll:45',
  'oll:56',
  'oll:57',
  'pll:ua',
  'pll:t',
  'pll:gc',
  'pll:h',
  'pll:z',
] as const

const LAYOUTS = {
  oll: {
    origin: 20,
    step: 30,
    cell: 28,
    barThickness: 5,
    barTop: 10,
    barBottom: 113,
    barLeft: 10,
    barRight: 113,
    barStroke: 1.25,
    mainX: 18,
    mainY: 18,
    mainSize: 92,
  },
  pll: {
    origin: 23,
    step: 28,
    cell: 26,
    barThickness: 6.5,
    barTop: 14.5,
    barBottom: 107,
    barLeft: 14.5,
    barRight: 107,
    barStroke: 2,
    mainX: 20,
    mainY: 20,
    mainSize: 88,
  },
} as const

const CENTERS: Readonly<Record<string, readonly [number, number]>> = {
  UBL: [36, 36],
  UB: [64, 36],
  UBR: [92, 36],
  UL: [36, 64],
  U: [64, 64],
  UR: [92, 64],
  UFL: [36, 92],
  UF: [64, 92],
  UFR: [92, 92],
}

// Visible tips are trimmed inside the logical cubie centres. Edge swaps use a
// tight 1 px clearance; directed edge trims stay 8/2 or 8/9 px. Corner
// swaps use 2 px trim and corner cycles use 8/3 px, keeping their lanes.
const ARROW_GEOMETRY = {
  directedStart: 8,
  directedEnd: 9,
  doubleEdge: 1,
  doubleCorner: 2,
  directedCornerEnd: 3,
  headLength: { edge: 8, corner: 8 },
} as const

function assertNear(
  actual: number,
  expected: number,
  label: string,
  tolerance = 0.011,
): void {
  assert(
    Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected}, got ${actual}`,
  )
}

function headTip(head: Element): { x: number; y: number } {
  const points = attribute(head, 'points').trim().split(/\s+/)
  assert(points.length === 3, 'arrowhead is not a triangle')
  const coordinates = points[0]!.split(',').map(Number)
  return { x: coordinates[0]!, y: coordinates[1]! }
}

interface ArrowPathGeometry {
  readonly from: string
  readonly to: string
  readonly lane: number
  readonly clearance: number
  readonly ux: number
  readonly uy: number
  readonly startCenter: { x: number; y: number }
  readonly endCenter: { x: number; y: number }
}

function assertArrowPathGeometry(
  path: Element,
  kind: 'corner' | 'edge',
  both: boolean,
  mixed: boolean,
): ArrowPathGeometry {
  const from = attribute(path, 'data-from')
  const to = attribute(path, 'data-to')
  const line = parseLine(attribute(path, 'd'))
  const fromCenter = CENTERS[from]
  const toCenter = CENTERS[to]
  assert(fromCenter, `Unknown U-layer position ${from}`)
  assert(toCenter, `Unknown U-layer position ${to}`)
  const startCenter = { x: fromCenter[0], y: fromCenter[1] }
  const endCenter = { x: toCenter[0], y: toCenter[1] }

  const dx = endCenter.x - startCenter.x
  const dy = endCenter.y - startCenter.y
  const length = Math.hypot(dx, dy)
  assert(length > 0, `Arrow ${from}->${to} has zero length`)
  const ux = dx / length
  const uy = dy / length
  const px = -uy
  const py = ux

  // Every shaft and head must follow its actual cubie-centre line.
  const laneStart =
    (line.start.x - startCenter.x) * px +
    (line.start.y - startCenter.y) * py
  const laneEnd =
    (line.end.x - endCenter.x) * px + (line.end.y - endCenter.y) * py
  assertNear(laneStart, 0, `${from}->${to} shaft start is off its lane`)
  assertNear(laneEnd, 0, `${from}->${to} shaft end is off its lane`)

  const cubieLaneStart =
    (line.start.x - fromCenter[0]) * px +
    (line.start.y - fromCenter[1]) * py
  const cubieLaneEnd =
    (line.end.x - toCenter[0]) * px + (line.end.y - toCenter[1]) * py
  assertNear(cubieLaneStart, 0, `${from}->${to} ${kind} lane must be centred`)
  assertNear(cubieLaneEnd, 0, `${from}->${to} ${kind} lane must be centred`)

  const startAlong =
    (line.start.x - startCenter.x) * ux +
    (line.start.y - startCenter.y) * uy
  const endAlong =
    (line.end.x - endCenter.x) * ux +
    (line.end.y - endCenter.y) * uy
  const directedEnd = kind === 'corner'
    ? ARROW_GEOMETRY.directedCornerEnd
    : !mixed ? 2 : ARROW_GEOMETRY.directedEnd
  const clearance = both
    ? kind === 'corner'
      ? ARROW_GEOMETRY.doubleCorner
      : ARROW_GEOMETRY.doubleEdge
    : directedEnd
  const headLength = ARROW_GEOMETRY.headLength[kind]
  assertNear(
    startAlong,
    both ? clearance + headLength : ARROW_GEOMETRY.directedStart,
    `${from}->${to} start clearance`,
  )
  assertNear(
    endAlong,
    -(clearance + headLength),
    `${from}->${to} end clearance`,
  )
  assertNear(
    (line.end.x - line.start.x) * uy - (line.end.y - line.start.y) * ux,
    0,
    `${from}->${to} is not parallel to its cubie-centre line`,
  )

  return {
    from,
    to,
    lane: cubieLaneStart,
    clearance,
    ux,
    uy,
    startCenter,
    endCenter,
  }
}

function assertArrowHeadGeometry(
  head: Element,
  geometry: ArrowPathGeometry,
  end: 'start' | 'end',
): void {
  const tip = headTip(head)
  const center = end === 'start' ? geometry.startCenter : geometry.endCenter
  const dx = tip.x - center.x
  const dy = tip.y - center.y
  const along = dx * geometry.ux + dy * geometry.uy
  const lane = dx * -geometry.uy + dy * geometry.ux
  assertNear(
    along,
    end === 'start' ? geometry.clearance : -geometry.clearance,
    `${geometry.from}->${geometry.to} ${end} tip clearance`,
  )
  assertNear(
    lane,
    0,
    `${geometry.from}->${geometry.to} ${end} tip lane`,
  )
}

let model: Cube3Model

beforeAll(async () => {
  model = await loadCube3Model()
})

function previewDefinitions(): StandardCaseDefinition[] {
  return PREVIEW_IDS.map((id) => {
    const definition = STANDARD_CASE_BY_ID.get(id)
    if (!definition) throw new Error(`Missing preview case ${id}.`)
    return definition
  })
}

function standardDefinitions(): StandardCaseDefinition[] {
  return [...STANDARD_CASES]
}

function pllDefinitions(): StandardCaseDefinition[] {
  return STANDARD_CASES.filter(
    (definition) => definition.kind === 'pll-permutation',
  )
}

function readAsset(spec: DiagramSpec): string {
  return fs.readFileSync(path.join(ROOT, 'src/assets', spec.asset), 'utf8')
}

function parseSvg(svg: string): Document {
  const document = new DOMParser().parseFromString(svg, 'image/svg+xml')
  expect(document.getElementsByTagName('parsererror')).toHaveLength(0)
  return document
}

function fail(message: string): never {
  throw new Error(message)
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message)
}

function attribute(element: Element, name: string): string {
  const value = element.getAttribute(name)
  assert(value !== null, `${element.tagName} is missing ${name}`)
  return value
}

function assertAttributes(
  element: Element,
  expected: Readonly<Record<string, string>>,
  label: string,
): void {
  for (const [name, value] of Object.entries(expected)) {
    assert(
      attribute(element, name) === value,
      `${label} ${name}: expected ${value}, got ${element.getAttribute(name)}`,
    )
  }
}

function displayColor(spec: DiagramSpec, color: FaceColor): string {
  if (spec.kind === 'oll') {
    return color === 'U' ? PALETTE.ollYellow : PALETTE.neutral
  }
  return PALETTE.faces[color]
}

interface ExpectedBar {
  readonly face: string
  readonly position: string
  readonly color: FaceColor
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

function cellCoordinate(
  layout: (typeof LAYOUTS)[keyof typeof LAYOUTS],
  index: number,
): number {
  return layout.origin + index * layout.step
}

function expectedSideBars(spec: DiagramSpec): ExpectedBar[] {
  const geometry = LAYOUTS[spec.kind]
  const layouts = [
    { face: 'B', positions: BACK_STRIP_POSITIONS, colors: spec.facelets.back, side: 'top' },
    { face: 'F', positions: FRONT_STRIP_POSITIONS, colors: spec.facelets.front, side: 'bottom' },
    { face: 'L', positions: LEFT_STRIP_POSITIONS, colors: spec.facelets.left, side: 'left' },
    { face: 'R', positions: RIGHT_STRIP_POSITIONS, colors: spec.facelets.right, side: 'right' },
  ] as const

  const bars: ExpectedBar[] = []
  for (const layout of layouts) {
    layout.positions.forEach((position, index) => {
      const color = layout.colors[index]!
      if (spec.kind === 'oll' && color !== 'U') return
      if (spec.kind === 'pll' && color === 'U') {
        fail(`${spec.caseId} has a U sticker on the ${layout.face} side`)
      }
      if (layout.side === 'top' || layout.side === 'bottom') {
        bars.push({
          face: layout.face,
          position,
          color,
          x: cellCoordinate(geometry, index) - (spec.kind === 'pll' ? 1 : 0),
          y: layout.side === 'top' ? geometry.barTop : geometry.barBottom,
          width: geometry.cell + (spec.kind === 'pll' ? 2 : 0),
          height: geometry.barThickness,
        })
      } else {
        bars.push({
          face: layout.face,
          position,
          color,
          x: layout.side === 'left' ? geometry.barLeft : geometry.barRight,
          y: cellCoordinate(geometry, index) - (spec.kind === 'pll' ? 1 : 0),
          width: geometry.barThickness,
          height: geometry.cell + (spec.kind === 'pll' ? 2 : 0),
        })
      }
    })
  }
  return bars
}

interface ExpectedCycle {
  readonly kind: 'corner' | 'edge'
  readonly positions: readonly string[]
  readonly arrows: readonly string[]
}

function expectedCycles(spec: DiagramSpec): ExpectedCycle[] {
  return lastLayerPermutationCycles(spec.arrows).map((cycle) => {
    const byFrom = new Map(
      spec.arrows
        .filter((arrow) => arrow.kind === cycle.kind)
        .map((arrow) => [arrow.from, arrow]),
    )
    const arrows = cycle.positions.map((from) => {
      const arrow = byFrom.get(from)
      assert(arrow, `${spec.caseId} is missing a ${cycle.kind} arrow from ${from}`)
      return `${arrow.kind}:${arrow.from}>${arrow.to}`
    })
    return { kind: cycle.kind, positions: cycle.positions, arrows }
  })
}

function parseLine(d: string): {
  start: { x: number; y: number }
  end: { x: number; y: number }
} {
  const match = /^M ([\d.-]+) ([\d.-]+) L ([\d.-]+) ([\d.-]+)$/.exec(d)
  assert(match, `Unexpected arrow path ${d}`)
  return {
    start: { x: Number(match[1]), y: Number(match[2]) },
    end: { x: Number(match[3]), y: Number(match[4]) },
  }
}

function distanceToCenter(point: { x: number; y: number }, position: string): number {
  const center = CENTERS[position]
  assert(center, `Unknown U-layer position ${position}`)
  return Math.hypot(point.x - center[0], point.y - center[1])
}

function nearestPosition(point: { x: number; y: number }): string {
  return Object.keys(CENTERS).reduce((best, position) =>
    distanceToCenter(point, position) < distanceToCenter(point, best)
      ? position
      : best,
  )
}

function assertSvgContent(document: Document, spec: DiagramSpec): void {
  const root = document.documentElement
  assert(root.tagName.toLowerCase() === 'svg', `${spec.caseId} is not an SVG`)
  assertAttributes(
    root,
    {
      width: '128',
      height: '128',
      viewBox: '0 0 128 128',
      role: 'img',
      'aria-labelledby': 'case-title case-desc',
      'data-case-id': spec.caseId,
      'data-case-kind': spec.kind,
      'data-signature': spec.signature,
      'data-representative-signature': spec.representativeSignature,
      'data-view': spec.viewingOrientation,
      'data-diagram-style': 'compact-3x3',
    },
    spec.caseId,
  )
  assert(
    document.querySelector('title')?.textContent === spec.title,
    `${spec.caseId} title mismatch`,
  )
  assert(
    document.querySelector('desc')?.textContent === spec.description,
    `${spec.caseId} description mismatch`,
  )

  for (const forbidden of [
    'script',
    'foreignObject',
    'iframe',
    'object',
    'embed',
    'image',
    'use',
    'style',
    'marker',
  ]) {
    assert(
      document.getElementsByTagName(forbidden).length === 0,
      `${spec.caseId} contains ${forbidden}`,
    )
  }
  for (const element of document.getElementsByTagName('*')) {
    for (const item of element.attributes) {
      assert(!/^on/i.test(item.name), `${spec.caseId} has an event attribute`)
      assert(
        item.name.toLowerCase() !== 'href' &&
          item.name.toLowerCase() !== 'xlink:href',
        `${spec.caseId} has an href attribute`,
      )
      if (item.value.includes('http')) {
        assert(
          element.tagName.toLowerCase() === 'svg' &&
            item.name === 'xmlns' &&
            item.value === 'http://www.w3.org/2000/svg',
          `${spec.caseId} has an external reference`,
        )
      }
    }
  }
  const serialized = root.outerHTML
  assert(
    !/url\(\s*(?:https?:|data:|javascript:)/i.test(serialized),
    `${spec.caseId} has an unsafe url`,
  )
  assert(!serialized.includes('rx='), `${spec.caseId} has rounded geometry`)
  assert(
    !serialized.includes('#4A2F86') && !serialized.includes('#0D5F66'),
    `${spec.caseId} uses the rejected arrow palette`,
  )

  const geometry = LAYOUTS[spec.kind]
  const grid = document.querySelector('rect.grid-background')
  assert(grid, `${spec.caseId} is missing the grid background`)
  assertAttributes(
    grid,
    {
      x: String(geometry.mainX),
      y: String(geometry.mainY),
      width: String(geometry.mainSize),
      height: String(geometry.mainSize),
      fill: PALETTE.grid,
    },
    `${spec.caseId} grid`,
  )

  const stickers = [...document.querySelectorAll('rect.sticker')]
  assert(stickers.length === 9, `${spec.caseId} must have nine top stickers`)
  const seenTop = new Set<string>()
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      const position = TOP_FACE_POSITIONS[row]![col]!
      const sticker = stickers.find(
        (candidate) => candidate.getAttribute('data-position') === position,
      )
      assert(sticker, `${spec.caseId} is missing top sticker ${position}`)
      const color = spec.facelets.top[row]![col]!
      assertAttributes(
        sticker,
        {
          'data-face': 'U',
          'data-position': position,
          'data-sticker-color': color,
          x: String(cellCoordinate(geometry, col)),
          y: String(cellCoordinate(geometry, row)),
          width: String(geometry.cell),
          height: String(geometry.cell),
          fill: displayColor(spec, color),
        },
        `${spec.caseId} top ${position}`,
      )
      assert(
        !sticker.hasAttribute('rx') && !sticker.hasAttribute('stroke'),
        `${spec.caseId} top ${position} has tile styling`,
      )
      seenTop.add(position)
    }
  }
  assert(seenTop.size === 9, `${spec.caseId} has duplicate top positions`)

  const bars = [...document.querySelectorAll('rect.side-bar')]
  const expectedBars = expectedSideBars(spec)
  assert(
    bars.length === expectedBars.length,
    `${spec.caseId} has ${bars.length} side bars, expected ${expectedBars.length}`,
  )
  const seenBars = new Set<string>()
  for (const bar of bars) {
    const key = `${attribute(bar, 'data-face')}:${attribute(bar, 'data-position')}`
    const expected = expectedBars.find(
      (candidate) => `${candidate.face}:${candidate.position}` === key,
    )
    assert(expected, `${spec.caseId} has an unexpected side bar ${key}`)
    assert(!seenBars.has(key), `${spec.caseId} has a duplicate side bar ${key}`)
    seenBars.add(key)
    assertAttributes(
      bar,
      {
        'data-face': expected.face,
        'data-position': expected.position,
        'data-sticker-color': expected.color,
        x: String(expected.x),
        y: String(expected.y),
        width: String(expected.width),
        height: String(expected.height),
        fill:
          spec.kind === 'oll'
            ? PALETTE.ollYellow
            : PALETTE.faces[expected.color],
        stroke: PALETTE.grid,
        'stroke-width': String(geometry.barStroke),
      },
      `${spec.caseId} side bar ${key}`,
    )
    assert(!bar.hasAttribute('rx'), `${spec.caseId} side bar ${key} is rounded`)
  }
  assert(seenBars.size === expectedBars.length, `${spec.caseId} bar mismatch`)
  if (spec.kind === 'oll') {
    assert(
      bars.every((bar) => bar.getAttribute('data-sticker-color') === 'U'),
      `${spec.caseId} draws a non-U OLL side bar`,
    )
    assert(
      bars.every((bar) => bar.getAttribute('fill') === PALETTE.ollYellow),
      `${spec.caseId} draws a neutral OLL side bar`,
    )
  } else {
    assert(
      bars.every((bar) => bar.getAttribute('data-sticker-color') !== 'U'),
      `${spec.caseId} draws a U PLL side bar`,
    )
    assert(
      bars.every(
        (bar) =>
          bar.getAttribute('fill') ===
          PALETTE.faces[bar.getAttribute('data-sticker-color') as FaceColor],
      ),
      `${spec.caseId} draws a solved-colour PLL side bar`,
    )
  }

  const strips = [...document.querySelectorAll('rect.side-strip')]
  if (spec.kind === 'pll') {
    assert(strips.length === 4, `${spec.caseId} must have four side strips`)
    const expectedStrips: Readonly<Record<string, Readonly<Record<string, string>>>> = {
      B: {
        x: '20',
        y: '13.5',
        width: '88',
        height: '8.5',
      },
      F: {
        x: '20',
        y: '106',
        width: '88',
        height: '8.5',
      },
      L: {
        x: '13.5',
        y: '20',
        width: '8.5',
        height: '88',
      },
      R: {
        x: '106',
        y: '20',
        width: '8.5',
        height: '88',
      },
    }
    for (const strip of strips) {
      const face = attribute(strip, 'data-face')
      const expected = expectedStrips[face]
      assert(expected, `${spec.caseId} has an unexpected side strip ${face}`)
      assertAttributes(
        strip,
        { ...expected, fill: PALETTE.grid },
        `${spec.caseId} side strip ${face}`,
      )
    }
  } else {
    assert(strips.length === 0, `${spec.caseId} must not have side strips`)
  }

  const groups = [...document.querySelectorAll('g.permutation-cycle')]
  const cycles = expectedCycles(spec)
  const mixed =
    cycles.some((cycle) => cycle.kind === 'corner') &&
    cycles.some((cycle) => cycle.positions.length > 2)
  assert(
    groups.length === cycles.length,
    `${spec.caseId} has ${groups.length} cycles, expected ${cycles.length}`,
  )
  const seenArrows = new Set<string>()
  for (const cycle of cycles) {
    const cycleKey = cycle.positions.join('>')
    const group = groups.find(
      (candidate) =>
        candidate.getAttribute('data-kind') === cycle.kind &&
        candidate.getAttribute('data-cycle') === cycleKey,
    )
    assert(group, `${spec.caseId} is missing cycle ${cycle.kind}:${cycleKey}`)
    assert(
      attribute(group, 'data-arrows') === cycle.arrows.join(' '),
      `${spec.caseId} cycle ${cycleKey} arrow list mismatch`,
    )
    for (const arrow of cycle.arrows) {
      assert(!seenArrows.has(arrow), `${spec.caseId} repeats arrow ${arrow}`)
      seenArrows.add(arrow)
    }

    const paths = [...group.querySelectorAll('path.permutation-arrow')]
    const heads = [...group.querySelectorAll('polygon.arrowhead')]
    const both = cycle.positions.length === 2
    assert(
      paths.length === (both ? 1 : cycle.positions.length),
      `${spec.caseId} cycle ${cycleKey} path count mismatch`,
    )
    assert(
      heads.length === cycle.positions.length,
      `${spec.caseId} cycle ${cycleKey} head count mismatch`,
    )
    if (both) {
      assert(
        attribute(paths[0]!, 'data-bidirectional') === 'true',
        `${spec.caseId} cycle ${cycleKey} is not bidirectional`,
      )
      assert(
        attribute(paths[0]!, 'data-from') === cycle.positions[0] &&
          attribute(paths[0]!, 'data-to') === cycle.positions[1],
        `${spec.caseId} cycle ${cycleKey} direction mismatch`,
      )
    } else {
      for (let index = 0; index < cycle.positions.length; index += 1) {
        const path = paths.find(
          (candidate) =>
            candidate.getAttribute('data-from') === cycle.positions[index],
        )
        assert(path, `${spec.caseId} cycle ${cycleKey} is missing a path`)
        assert(
          attribute(path, 'data-to') ===
            cycle.positions[(index + 1) % cycle.positions.length],
          `${spec.caseId} cycle ${cycleKey} has a wrong destination`,
        )
        assert(
          !path.hasAttribute('data-bidirectional'),
          `${spec.caseId} cycle ${cycleKey} has a stray double head`,
        )
      }
    }
    const pathGeometry = new Map<Element, ArrowPathGeometry>()
    for (const path of paths) {
      const from = attribute(path, 'data-from')
      const to = attribute(path, 'data-to')
      const line = parseLine(attribute(path, 'd'))
      assert(
        distanceToCenter(line.start, from) <= 20,
        `${spec.caseId} arrow ${from}->${to} starts at the wrong position`,
      )
      assert(
        distanceToCenter(line.end, to) <= 20,
        `${spec.caseId} arrow ${from}->${to} ends at the wrong position`,
      )
      assert(
        distanceToCenter(line.start, from) < distanceToCenter(line.start, to),
        `${spec.caseId} arrow ${from}->${to} points the wrong way`,
      )
      assert(
        distanceToCenter(line.end, to) < distanceToCenter(line.end, from),
        `${spec.caseId} arrow ${from}->${to} points the wrong way`,
      )
      pathGeometry.set(
        path,
        assertArrowPathGeometry(path, cycle.kind, both, mixed),
      )
    }
    if (both) {
      const geometry = pathGeometry.get(paths[0]!)
      assert(geometry, `${spec.caseId} cycle ${cycleKey} has no path geometry`)
      assert(
        heads.length === 2,
        `${spec.caseId} cycle ${cycleKey} must have two tips`,
      )
      assertArrowHeadGeometry(heads[0]!, geometry, 'start')
      assertArrowHeadGeometry(heads[1]!, geometry, 'end')
    } else {
      assert(
        heads.length === paths.length,
        `${spec.caseId} cycle ${cycleKey} head/path mismatch`,
      )
      paths.forEach((path, index) => {
        const geometry = pathGeometry.get(path)
        assert(
          geometry,
          `${spec.caseId} cycle ${cycleKey} has no path geometry`,
        )
        assertArrowHeadGeometry(heads[index]!, geometry, 'end')
      })
    }
    const tips = heads.map((head) => nearestPosition(headTip(head)))
    assert(
      tips.length === new Set(tips).size &&
        cycle.positions.every((position) => tips.includes(position)),
      `${spec.caseId} cycle ${cycleKey} arrowheads do not mark every destination`,
    )
  }
  assert(
    seenArrows.size === spec.arrows.length,
    `${spec.caseId} does not represent every permutation arrow`,
  )
}

describe('committed standard SVG assets', () => {
  it('contain the expected compact 3x3 content and no executable or external content', () => {
    for (const definition of standardDefinitions()) {
      const spec = buildDiagramSpec(model, definition)
      assertSvgContent(parseSvg(readAsset(spec)), spec)
    }
  })

  it('centres the T corner arrow and preserves the edge swap', () => {
    const spec = buildDiagramSpec(
      model,
      STANDARD_CASE_BY_ID.get('pll:t')!,
    )
    const document = parseSvg(readAsset(spec))

    const edgeGroup = document.querySelector(
      'g.permutation-cycle[data-kind="edge"]',
    )
    assert(edgeGroup, 'T perm is missing its edge cycle')
    const edgePath = edgeGroup.querySelector('path.permutation-arrow')
    assert(edgePath, 'T perm is missing its edge path')
    expect(attribute(edgePath, 'd')).toBe('M 83 64 L 45 64')
    expect(
      [...edgeGroup.querySelectorAll('polygon.arrowhead')].map(headTip),
    ).toEqual([
      { x: 91, y: 64 },
      { x: 37, y: 64 },
    ])

    const cornerGroup = document.querySelector(
      'g.permutation-cycle[data-kind="corner"]',
    )
    assert(cornerGroup, 'T perm is missing its corner cycle')
    const cornerPath = cornerGroup.querySelector('path.permutation-arrow')
    assert(cornerPath, 'T perm is missing its corner path')
    expect(attribute(cornerPath, 'd')).toBe('M 92 82 L 92 46')
    expect(
      [...cornerGroup.querySelectorAll('polygon.arrowhead')].map(headTip),
    ).toEqual([
      { x: 92, y: 90 },
      { x: 92, y: 38 },
    ])
  })

  it('keeps arrow shafts and heads readable at 64 px', () => {
    for (const definition of pllDefinitions()) {
      const spec = buildDiagramSpec(model, definition)
      const document = parseSvg(readAsset(spec))
      for (const path of document.querySelectorAll('path.permutation-arrow')) {
        const stroke = Number(attribute(path, 'stroke-width'))
        expect(
          stroke * 0.5,
          `${spec.caseId} shaft width at 64 px`,
        ).toBeGreaterThanOrEqual(2)
        const line = parseLine(attribute(path, 'd'))
        expect(
          Math.hypot(line.end.x - line.start.x, line.end.y - line.start.y) *
            0.5,
          `${spec.caseId} shaft length at 64 px`,
        ).toBeGreaterThanOrEqual(6)
      }
      for (const head of document.querySelectorAll('polygon.arrowhead')) {
        const points = attribute(head, 'points')
          .trim()
          .split(/\s+/)
          .map((pair) => {
            const [x, y] = pair.split(',').map(Number)
            return { x: x!, y: y! }
          })
        assert(points.length === 3, `${spec.caseId} arrowhead is not a triangle`)
        const [tip, first, second] = points as [
          { x: number; y: number },
          { x: number; y: number },
          { x: number; y: number },
        ]
        const baseWidth = Math.hypot(
          first.x - second.x,
          first.y - second.y,
        )
        const baseMid = {
          x: (first.x + second.x) / 2,
          y: (first.y + second.y) / 2,
        }
        const headLength = Math.hypot(
          tip.x - baseMid.x,
          tip.y - baseMid.y,
        )
        expect(
          baseWidth * 0.5,
          `${spec.caseId} head width at 64 px`,
        ).toBeGreaterThanOrEqual(2)
        expect(
          headLength * 0.5,
          `${spec.caseId} head length at 64 px`,
        ).toBeGreaterThanOrEqual(3)
      }
    }
  })

  it('uses fixed 8 by 11 px heads on every path, with no head collisions or clipping', () => {
    type Point = { x: number; y: number }
    const points = (element: Element): Point[] => attribute(element, 'points')
      .split(/\s+/).map((pair) => {
        const [x, y] = pair.split(',').map(Number)
        return { x: x!, y: y! }
      })
    // Separating-axis test for the actual rendered triangles, not their bounds.
    const overlaps = (a: Point[], b: Point[]): boolean => [a, b].every((polygon) =>
      polygon.every((point, index) => {
        const next = polygon[(index + 1) % polygon.length]!
        const axis = { x: -(next.y - point.y), y: next.x - point.x }
        const project = (shape: Point[]) => shape.map((p) => p.x * axis.x + p.y * axis.y)
        const pa = project(a), pb = project(b)
        return Math.max(...pa) > Math.min(...pb) && Math.max(...pb) > Math.min(...pa)
      }),
    )
    for (const definition of pllDefinitions()) {
      const spec = buildDiagramSpec(model, definition)
      const document = parseSvg(readAsset(spec))
      const cycles = expectedCycles(spec)
      const mixed =
        cycles.some((cycle) => cycle.kind === 'corner') &&
        cycles.some((cycle) => cycle.positions.length > 2)
      const headElements = [...document.querySelectorAll('polygon.arrowhead')]
      const heads = headElements.map(points)
      const headLabel = (head: Element): string => {
        let sibling = head.previousElementSibling
        while (
          sibling &&
          sibling.tagName.toLowerCase() !== 'path'
        ) {
          sibling = sibling.previousElementSibling
        }
        return sibling
          ? `${sibling.getAttribute('data-from')}->${sibling.getAttribute('data-to')}`
          : 'unknown'
      }
      const collisions: string[] = []
      for (const [index, head] of heads.entries()) {
        const [tip, a, b] = head as [Point, Point, Point]
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeCloseTo(11, 1)
        expect(Math.hypot(tip.x - (a.x + b.x) / 2, tip.y - (a.y + b.y) / 2)).toBeCloseTo(8, 1)
        for (const point of head) {
          // Includes the 1.5 px halo, safely inside the face's 20..108 border.
          expect(point.x).toBeGreaterThan(21.5)
          expect(point.x).toBeLessThan(106.5)
          expect(point.y).toBeGreaterThan(21.5)
          expect(point.y).toBeLessThan(106.5)
        }
        for (const otherIndex of heads.keys()) {
          if (otherIndex <= index) continue
          if (overlaps(head, heads[otherIndex]!)) {
            collisions.push(
              [
                headLabel(headElements[index]!),
                headLabel(headElements[otherIndex]!),
              ]
                .sort()
                .join('|'),
            )
          }
        }
      }
      // Longer corner tips also separate the former Gb/Gd head overlaps.
      expect(collisions, `${spec.caseId} arrowhead collisions`).toEqual([])
      for (const path of document.querySelectorAll('path.permutation-arrow')) {
        expect(attribute(path, 'stroke-width')).toBe(
          mixed && attribute(path, 'data-kind') === 'edge' ? '4.2' : '5.5',
        )
      }
    }
  })

  it('centres Gc corner segments on a shared actual UFL cubie centre', () => {
    const spec = buildDiagramSpec(model, STANDARD_CASE_BY_ID.get('pll:gc')!)
    const document = parseSvg(readAsset(spec))
    const paths = [...document.querySelectorAll('path.permutation-arrow[data-kind="corner"]')]
    expect(paths.map((p) => [attribute(p, 'data-from'), attribute(p, 'data-to'), attribute(p, 'd')])).toEqual([
      ['UFR', 'UFL', 'M 84 92 L 47 92'],
      ['UFL', 'UBL', 'M 36 84 L 36 47'],
      ['UBL', 'UFR', 'M 41.66 41.66 L 84.22 84.22'],
    ])
    // Reconstruct the two lane anchors from the trims: both meet at (36,92).
    const incoming = headTip(document.querySelector('g.permutation-cycle[data-kind="corner"] polygon.arrowhead')!)
    const outgoing = parseLine(attribute(paths[1]!, 'd')).start
    expect({ x: incoming.x - 3, y: incoming.y }).toEqual({ x: 36, y: 92 })
    expect({ x: outgoing.x, y: outgoing.y + 8 }).toEqual({ x: 36, y: 92 })
  })

  it('commits exactly 57 OLL and 21 PLL assets with stable case IDs and filenames', () => {
    expect(OLL_STANDARD_CASES).toHaveLength(57)
    expect(PLL_NAMED_CASES).toHaveLength(21)
    expect(STANDARD_CASES).toHaveLength(78)

    const ollDirectory = path.join(
      ROOT,
      'src/assets/training/diagrams/oll',
    )
    const pllDirectory = path.join(
      ROOT,
      'src/assets/training/diagrams/pll',
    )
    const expectedOllFiles = OLL_STANDARD_CASES.map((definition) =>
      path.basename(definition.diagramAsset),
    ).sort()
    const expectedPllFiles = PLL_NAMED_CASES.map((definition) =>
      path.basename(definition.diagramAsset),
    ).sort()
    const ollFiles = fs.readdirSync(ollDirectory).sort()
    const pllFiles = fs.readdirSync(pllDirectory).sort()

    expect(ollFiles).toEqual(expectedOllFiles)
    expect(pllFiles).toEqual(expectedPllFiles)
    expect(ollFiles.every((file) => /^oll-\d{2}\.svg$/.test(file))).toBe(true)
    expect(pllFiles.every((file) => /^pll-[a-z]+\.svg$/.test(file))).toBe(true)

    const committedIds = new Set<string>()
    const committedSignatures = new Set<string>()
    for (const definition of standardDefinitions()) {
      const filename =
        definition.kind === 'oll-orientation'
          ? `oll-${String(Number(definition.id.slice('oll:'.length))).padStart(2, '0')}.svg`
          : `${definition.id.replace('pll:', 'pll-')}.svg`
      const folder = definition.kind === 'oll-orientation' ? 'oll' : 'pll'
      expect(definition.diagramAsset).toBe(
        `training/diagrams/${folder}/${filename}`,
      )
      const filePath = path.join(ROOT, 'src/assets', definition.diagramAsset)
      expect(fs.existsSync(filePath), definition.id).toBe(true)
      const document = parseSvg(fs.readFileSync(filePath, 'utf8'))
      const root = document.documentElement
      expect(attribute(root, 'data-case-id'), definition.id).toBe(
        definition.id,
      )
      expect(attribute(root, 'data-case-name'), definition.id).toBe(
        definition.name,
      )
      expect(attribute(root, 'data-signature'), definition.id).toBe(
        definition.canonicalSignature,
      )
      expect(attribute(root, 'data-representative-signature'), definition.id).toBe(
        definition.representativeSignature,
      )
      committedIds.add(attribute(root, 'data-case-id'))
      committedSignatures.add(attribute(root, 'data-signature'))
    }
    expect(committedIds.size).toBe(78)
    expect(committedSignatures.size).toBe(78)
    expect([...committedIds].sort()).toEqual(
      STANDARD_CASES.map((definition) => definition.id).sort(),
    )
  })

  it('rejects tampered stickers, bars and arrows in committed SVG content', () => {
    const definition = STANDARD_CASE_BY_ID.get('pll:t')!
    const spec = buildDiagramSpec(model, definition)
    const original = readAsset(spec)
    const clone = () => parseSvg(original)

    const wrongTop = clone()
    wrongTop.querySelector('rect.sticker')!.setAttribute('fill', '#000000')
    expect(() => assertSvgContent(wrongTop, spec)).toThrow()

    const roundedTop = clone()
    roundedTop.querySelector('rect.sticker')!.setAttribute('rx', '2')
    expect(() => assertSvgContent(roundedTop, spec)).toThrow()

    const missingBar = clone()
    missingBar.querySelector('rect.side-bar')!.remove()
    expect(() => assertSvgContent(missingBar, spec)).toThrow()

    const wrongBarColor = clone()
    wrongBarColor
      .querySelector('rect.side-bar')!
      .setAttribute('data-sticker-color', 'U')
    expect(() => assertSvgContent(wrongBarColor, spec)).toThrow()

    const wrongBarFill = clone()
    wrongBarFill.querySelector('rect.side-bar')!.setAttribute('fill', '#F2C230')
    expect(() => assertSvgContent(wrongBarFill, spec)).toThrow()

    const wrongBarPosition = clone()
    wrongBarPosition.querySelector('rect.side-bar')!.setAttribute('x', '0')
    expect(() => assertSvgContent(wrongBarPosition, spec)).toThrow()

    const missingHead = clone()
    missingHead.querySelector('polygon.arrowhead')!.remove()
    expect(() => assertSvgContent(missingHead, spec)).toThrow()

    const wrongCycle = clone()
    wrongCycle
      .querySelector('g.permutation-cycle')!
      .setAttribute('data-arrows', '')
    expect(() => assertSvgContent(wrongCycle, spec)).toThrow()

    const wrongDirection = clone()
    wrongDirection
      .querySelector('path.permutation-arrow')!
      .setAttribute('data-from', 'UBL')
    expect(() => assertSvgContent(wrongDirection, spec)).toThrow()

    const unsafe = clone()
    unsafe.documentElement.appendChild(unsafe.createElement('script'))
    expect(() => assertSvgContent(unsafe, spec)).toThrow()

    const ollDefinition = STANDARD_CASE_BY_ID.get('oll:1')!
    const ollSpec = buildDiagramSpec(model, ollDefinition)
    const oll = parseSvg(readAsset(ollSpec))
    const ollBar = oll.querySelector('rect.side-bar')!
    ollBar.setAttribute('data-sticker-color', 'F')
    ollBar.setAttribute('fill', PALETTE.neutral)
    expect(() => assertSvgContent(oll, ollSpec)).toThrow()
  })

  it('preserves the approved preview assets and preview contact sheet', () => {
    expect(() =>
      execFileSync(
        process.execPath,
        ['scripts/training/generate-diagrams.mjs', '--preview', '--check'],
        { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' },
      ),
    ).not.toThrow()

    const html = fs.readFileSync(CONTACT_SHEET, 'utf8')
    expect(html).toContain('Compact 3×3 last-layer diagram previews')
    expect(html).toContain('remaining 68 diagrams')
    expect(html).toContain('128 px')
    expect(html).toContain('64 px')
    expect(html).toContain('Dark surface')
    expect(html).not.toMatch(/<script\b/i)
    expect(html).not.toMatch(/https?:\/\//i)
    expect(html).not.toContain('references/')
    expect(html.toLowerCase()).not.toContain('cubeskills')
    for (const definition of previewDefinitions()) {
      expect(html).toContain(
        `src="../../../src/assets/${definition.diagramAsset}"`,
      )
      expect(html).toContain(definition.name)
    }
    expect(html.match(/class="card/g)?.length).toBe(20)
    expect(html.match(/<img /g)?.length).toBe(40)
    expect(html.match(/width="128"/g)?.length).toBe(20)
    expect(html.match(/width="64"/g)?.length).toBe(20)
  })

  it('regenerates all 78 assets byte-identically and the complete contact sheet shows both sizes', { timeout: 30_000 }, () => {
    expect(() =>
      execFileSync(
        process.execPath,
        ['scripts/training/generate-diagrams.mjs', '--all', '--check'],
        { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' },
      ),
    ).not.toThrow()

    const allOutput = execFileSync(
      process.execPath,
      ['scripts/training/generate-diagrams.mjs', '--all', '--dry-run'],
      { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' },
    )
    expect(allOutput).toContain('Rendered 78 all diagram(s) in memory')

    const html = fs.readFileSync(ALL_CONTACT_SHEET, 'utf8')
    expect(html).toContain('Complete 3×3 last-layer diagram set')
    expect(html).toContain('OLL (57 cases)')
    expect(html).toContain('PLL (21 cases)')
    expect(html).toContain('128 px')
    expect(html).toContain('64 px')
    expect(html).toContain('Dark surface')
    expect(html).not.toContain('remaining 68 diagrams')
    expect(html).not.toMatch(/<script\b/i)
    expect(html).not.toMatch(/https?:\/\//i)
    expect(html).not.toContain('references/')
    expect(html.toLowerCase()).not.toContain('cubeskills')
    for (const definition of standardDefinitions()) {
      expect(html).toContain(
        `src="../../../src/assets/${definition.diagramAsset}"`,
      )
      expect(html).toContain(definition.name)
    }
    expect(html.match(/class="card/g)?.length).toBe(156)
    expect(html.match(/<img /g)?.length).toBe(312)
    expect(html.match(/width="128"/g)?.length).toBe(156)
    expect(html.match(/width="64"/g)?.length).toBe(156)
  })
})
