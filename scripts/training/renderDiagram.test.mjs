import { describe, expect, it } from 'vitest'
import {
  assertDiagramSvgSafe,
  permutationCycleGroups,
  renderContactSheet,
  renderDiagramSvg,
  sideBarEntries,
} from './renderDiagram.mjs'

function spec(overrides = {}) {
  return {
    caseId: 'oll:1',
    caseName: 'OLL 1',
    caseLabel: 'OLL 1',
    kind: 'oll',
    setId: 'oll',
    signature: '1212|1111',
    representativeSignature: '1212|1111',
    family: 'edge-pattern-cross',
    viewingOrientation: 'U-top-down-standard-frame',
    asset: 'training/diagrams/oll/oll-01.svg',
    facelets: {
      top: [
        ['B', 'U', 'U'],
        ['U', 'U', 'U'],
        ['F', 'U', 'U'],
      ],
      back: ['U', 'F', 'F'],
      front: ['L', 'U', 'F'],
      left: ['U', 'L', 'F'],
      right: ['R', 'U', 'F'],
    },
    arrows: [],
    title: 'OLL 1 — orientation diagram',
    description: 'Test diagram description.',
    ...overrides,
  }
}

function pllSpec(overrides = {}) {
  return spec({
    caseId: 'pll:t',
    caseName: 'T',
    caseLabel: 'T',
    kind: 'pll',
    setId: 'pll',
    signature: 'UBL,UBR,UFL,UFR|UR,UF,UL,UB',
    representativeSignature: 'UBR,UFR,UBL,UFL|UF,UL,UB,UR',
    family: 'adjacent-swap',
    asset: 'training/diagrams/pll/pll-t.svg',
    facelets: {
      top: [
        ['U', 'U', 'U'],
        ['U', 'U', 'U'],
        ['U', 'U', 'U'],
      ],
      back: ['B', 'B', 'B'],
      front: ['F', 'F', 'F'],
      left: ['L', 'L', 'L'],
      right: ['R', 'R', 'R'],
    },
    arrows: [
      { kind: 'corner', piece: 'UBR', from: 'UFR', to: 'UBR' },
      { kind: 'corner', piece: 'UFR', from: 'UBR', to: 'UFR' },
      { kind: 'edge', piece: 'UL', from: 'UR', to: 'UL' },
      { kind: 'edge', piece: 'UR', from: 'UL', to: 'UR' },
    ],
    title: 'T — permutation diagram',
    ...overrides,
  })
}

function parseLine(d) {
  const match = /^M ([\d.-]+) ([\d.-]+) L ([\d.-]+) ([\d.-]+)$/.exec(d ?? '')
  if (!match) throw new Error(`Unexpected arrow path ${d}`)
  return {
    start: { x: Number(match[1]), y: Number(match[2]) },
    end: { x: Number(match[3]), y: Number(match[4]) },
  }
}

function parsePoints(points) {
  return points.trim().split(/\s+/).map((pair) => {
    const [x, y] = pair.split(',').map(Number)
    return { x, y }
  })
}

const CENTERS = {
  UBL: { x: 36, y: 36 },
  UB: { x: 64, y: 36 },
  UBR: { x: 92, y: 36 },
  UL: { x: 36, y: 64 },
  U: { x: 64, y: 64 },
  UR: { x: 92, y: 64 },
  UFL: { x: 36, y: 92 },
  UF: { x: 64, y: 92 },
  UFR: { x: 92, y: 92 },
}

describe('static SVG renderer', () => {
  it('renders the compact 3x3 grid, OLL side bars and shared metadata', () => {
    const first = renderDiagramSvg(spec())
    const second = renderDiagramSvg(spec())
    expect(first).toBe(second)
    expect(first).toContain('width="128" height="128" viewBox="0 0 128 128"')
    expect(first).toContain('data-case-id="oll:1"')
    expect(first).toContain('data-signature="1212|1111"')
    expect(first).toContain('data-representative-signature="1212|1111"')
    expect(first).toContain('data-diagram-style="compact-3x3"')
    expect(first).toContain('<title id="case-title">')
    expect(first).toContain('<desc id="case-desc">')
    expect(first).toContain('class="grid-background"')
    expect(first.match(/class="sticker"/g)).toHaveLength(9)
    expect(first.match(/class="side-bar"/g)).toHaveLength(4)
    expect(first).not.toContain('class="side-strip"')
    expect(first).not.toContain('rx=')
    expect(first).not.toContain('<script')
    expect(first).not.toContain('onclick')
    expect(first).not.toContain('marker-')
    expect(first).not.toContain('url(#')
    assertDiagramSvgSafe(first)
  })

  it('renders only U-coloured OLL side bars at their adjacent positions', () => {
    const bars = sideBarEntries(spec())
    expect(bars.map((bar) => `${bar.face}:${bar.position}`)).toEqual([
      'B:UBL',
      'F:UF',
      'L:UBL',
      'R:UR',
    ])
    for (const bar of bars) {
      expect(bar.color).toBe('U')
    }
    expect(bars[0]).toMatchObject({
      x: 20,
      y: 10,
      width: 28,
      height: 5,
    })
    expect(bars[1]).toMatchObject({
      x: 50,
      y: 113,
      width: 28,
      height: 5,
    })
    expect(bars[2]).toMatchObject({
      x: 10,
      y: 20,
      width: 5,
      height: 28,
    })
    expect(bars[3]).toMatchObject({
      x: 113,
      y: 50,
      width: 5,
      height: 28,
    })
  })

  it('preserves the approved OLL styling and established PLL face geometry', () => {
    const oll = renderDiagramSvg(spec())
    expect(oll).toContain(
      'class="grid-background" x="18" y="18" width="92" height="92"',
    )
    expect(oll).toContain('fill="#FFF200"')
    expect(oll).toContain('stroke-width="1.25"')
    const ollStickers = [
      ...oll.matchAll(
        /class="sticker" [^>]*x="([\d.]+)" y="([\d.]+)" width="([\d.]+)"/g,
      ),
    ]
    expect(
      ollStickers.map((match) => match.slice(1, 4).map(Number)),
    ).toEqual([
      [20, 20, 28],
      [50, 20, 28],
      [80, 20, 28],
      [20, 50, 28],
      [50, 50, 28],
      [80, 50, 28],
      [20, 80, 28],
      [50, 80, 28],
      [80, 80, 28],
    ])
    const grid = /class="grid-background" x="([\d.]+)" y="[\d.]+" width="([\d.]+)"/.exec(
      oll,
    )
    const gridX = Number(grid?.[1])
    const gridWidth = Number(grid?.[2])
    const firstCell = ollStickers[0]
    const secondCell = ollStickers[1]
    const lastCell = ollStickers[8]
    expect(Number(firstCell?.[1]) - gridX).toBe(2)
    expect(
      Number(secondCell?.[1]) -
        (Number(firstCell?.[1]) + Number(firstCell?.[3])),
    ).toBe(2)
    expect(
      gridX + gridWidth - (Number(lastCell?.[1]) + Number(lastCell?.[3])),
    ).toBe(2)
    expect(oll).not.toContain('class="permutation-arrow"')

    const pll = renderDiagramSvg(pllSpec())
    expect(pll).toContain(
      'class="grid-background" x="20" y="20" width="88" height="88"',
    )
    expect(pll).toContain('fill="#FFF200"')
    expect(pll).toContain('stroke-width="2"')
  })

  it('uses a 2-unit inner grid and side outlines, with a slightly bolder 3-unit face border', () => {
    const svg = renderDiagramSvg(pllSpec())
    const cells = [...svg.matchAll(/class="sticker" [^>]*x="([\d.]+)" y="([\d.]+)" width="([\d.]+)"/g)]
    expect(cells[0].slice(1).map(Number)).toEqual([23, 23, 26])
    expect(Number(cells[1][1]) - Number(cells[0][1]) - Number(cells[0][3])).toBe(2)
    expect(Number(cells[0][1]) - 20).toBe(3)
    expect(108 - Number(cells[8][1]) - Number(cells[8][3])).toBe(3)
    const bars = sideBarEntries(pllSpec()).filter((bar) => bar.side === 'top')
    expect(bars[0]).toMatchObject({ x: 22, width: 28 })
    // Adjacent outlines coincide: 2 units of black, rather than doubled strokes plus a gap.
    expect(bars[0].x + bars[0].width).toBe(bars[1].x)
    expect(svg).toContain('stroke-width="2"')
  })

  it('aligns all four PLL strip ends with the main face corners without inset notches', () => {
    const svg = renderDiagramSvg(pllSpec())
    const strips = [...svg.matchAll(/<rect class="side-strip"[^>]*\/>/g)].map((match) => match[0])
    expect(strips).toHaveLength(4)
    for (const strip of strips) {
      if (/data-face="[BF]"/.test(strip)) {
        expect(strip).toContain('x="20"')
        expect(strip).toContain('width="88"')
      } else {
        expect(strip).toContain('y="20"')
        expect(strip).toContain('height="88"')
      }
    }
  })

  it('joins PLL side stickers to the face border without changing OLL spacing', () => {
    for (const bar of sideBarEntries(pllSpec())) {
      if (bar.side === 'top') expect(bar.y + bar.height - 1).toBe(20)
      if (bar.side === 'bottom') expect(bar.y + 1).toBe(108)
      if (bar.side === 'left') expect(bar.x + bar.width - 1).toBe(20)
      if (bar.side === 'right') expect(bar.x + 1).toBe(108)
    }
    expect(sideBarEntries(spec())[0].y).toBe(10)
    for (const diagram of [renderDiagramSvg(spec()), renderDiagramSvg(pllSpec())]) {
      expect(diagram).toContain('fill="#FFF200"')
    }
  })

  it('renders all twelve actual PLL side-bar colours', () => {
    const bars = sideBarEntries(pllSpec())
    expect(bars).toHaveLength(12)
    expect(bars.map((bar) => `${bar.face}:${bar.position}:${bar.color}`)).toEqual([
      'B:UBL:B',
      'B:UB:B',
      'B:UBR:B',
      'F:UFL:F',
      'F:UF:F',
      'F:UFR:F',
      'L:UBL:L',
      'L:UL:L',
      'L:UFL:L',
      'R:UBR:R',
      'R:UR:R',
      'R:UFR:R',
    ])
    expect(bars.some((bar) => bar.color === 'U')).toBe(false)
  })

  it('renders two-cycle swaps as double-headed black arrows with polygon heads', () => {
    const svg = renderDiagramSvg(pllSpec())
    expect(svg).not.toContain('<marker')
    expect(svg).not.toContain('url(#')
    const cycles = [...svg.matchAll(/<g class="permutation-cycle"[^>]*>/g)].map(
      (match) => match[0],
    )
    expect(cycles).toHaveLength(2)
    expect(cycles.some((cycle) => cycle.includes('data-kind="corner"'))).toBe(
      true,
    )
    expect(cycles.some((cycle) => cycle.includes('data-kind="edge"'))).toBe(true)
    const shafts = [...svg.matchAll(/<path class="permutation-arrow"[^>]*\/>/g)].map(
      (match) => match[0],
    )
    expect(shafts).toHaveLength(2)
    for (const shaft of shafts) {
      expect(shaft).toContain('data-bidirectional="true"')
      expect(shaft).toContain('stroke-width="')
      const path = / d="([^"]+)"/.exec(shaft)?.[1]
      expect(parseLine(path).end.x).toBeGreaterThan(0)
    }
    const heads = [...svg.matchAll(/<polygon class="arrowhead"[^>]*\/>/g)]
    expect(heads).toHaveLength(4)
    for (const head of heads) {
      const points = parsePoints(/points="([^"]+)"/.exec(head[0])?.[1] ?? '')
      expect(points).toHaveLength(3)
    }
  })

  it('lengthens the centred T corner swap while preserving its edge swap', () => {
    const svg = renderDiagramSvg(pllSpec())
    const edgeCycle = /<g class="permutation-cycle" data-kind="edge"[^>]*>([\s\S]*?)<\/g>/.exec(
      svg,
    )?.[1]
    expect(edgeCycle).toBeTruthy()
    const edgePath = parseLine(
      /<path class="permutation-arrow"[^>]*d="([^"]+)"/.exec(edgeCycle ?? '')?.[1],
    )
    expect(edgePath).toEqual({
      start: { x: 83, y: 64 },
      end: { x: 45, y: 64 },
    })
    const edgeTips = [
      ...(edgeCycle ?? '').matchAll(
        /<polygon class="arrowhead" points="([^"]+)"/g,
      ),
    ].map((match) => parsePoints(match[1] ?? '')[0])
    expect(edgeTips).toEqual([
      { x: 91, y: 64 },
      { x: 37, y: 64 },
    ])
    for (const tip of edgeTips) {
      expect(
        Math.min(Math.abs(tip.x - 36), Math.abs(tip.x - 92)),
      ).toBe(1)
      expect(tip.y).toBe(64)
    }

    const cornerCycle =
      /<g class="permutation-cycle" data-kind="corner"[^>]*>([\s\S]*?)<\/g>/.exec(
        svg,
      )?.[1]
    expect(cornerCycle).toBeTruthy()
    const cornerPath = parseLine(
      /<path class="permutation-arrow"[^>]*d="([^"]+)"/.exec(
        cornerCycle ?? '',
      )?.[1],
    )
    expect(cornerPath).toEqual({
      start: { x: 92, y: 82 },
      end: { x: 92, y: 46 },
    })
    const cornerTips = [
      ...(cornerCycle ?? '').matchAll(
        /<polygon class="arrowhead" points="([^"]+)"/g,
      ),
    ].map((match) => parsePoints(match[1] ?? '')[0])
    expect(cornerTips).toEqual([
      { x: 92, y: 90 },
      { x: 92, y: 38 },
    ])
  })

  it('centres both E corner swaps on their cubie columns', () => {
    const svg = renderDiagramSvg(pllSpec({
      caseId: 'pll:e',
      arrows: [
        { kind: 'corner', piece: 'UFL', from: 'UBL', to: 'UFL' },
        { kind: 'corner', piece: 'UBL', from: 'UFL', to: 'UBL' },
        { kind: 'corner', piece: 'UFR', from: 'UBR', to: 'UFR' },
        { kind: 'corner', piece: 'UBR', from: 'UFR', to: 'UBR' },
      ],
    }))
    const paths = [...svg.matchAll(/<path class="permutation-arrow"[^>]*d="([^"]+)"/g)]
      .map((match) => parseLine(match[1]))
    expect(paths).toEqual([
      { start: { x: 36, y: 46 }, end: { x: 36, y: 82 } },
      { start: { x: 92, y: 46 }, end: { x: 92, y: 82 } },
    ])
  })

  it('renders a three-cycle as three single-headed arrows', () => {
    const svg = renderDiagramSvg(
      pllSpec({
        caseId: 'pll:ua',
        caseName: 'Ua',
        caseLabel: 'Ua',
        asset: 'training/diagrams/pll/pll-ua.svg',
        arrows: [
          { kind: 'edge', piece: 'UR', from: 'UF', to: 'UR' },
          { kind: 'edge', piece: 'UL', from: 'UR', to: 'UL' },
          { kind: 'edge', piece: 'UF', from: 'UL', to: 'UF' },
        ],
      }),
    )
    const cycles = permutationCycleGroups(
      pllSpec({
        arrows: [
          { kind: 'edge', piece: 'UR', from: 'UF', to: 'UR' },
          { kind: 'edge', piece: 'UL', from: 'UR', to: 'UL' },
          { kind: 'edge', piece: 'UF', from: 'UL', to: 'UF' },
        ],
      }).arrows,
    )
    expect(cycles).toHaveLength(1)
    expect(cycles[0].positions).toEqual(['UF', 'UR', 'UL'])
    expect(svg.match(/class="permutation-cycle"/g)).toHaveLength(1)
    expect(svg.match(/class="permutation-arrow"/g)).toHaveLength(3)
    expect(svg.match(/class="arrowhead"/g)).toHaveLength(3)
    expect(svg).not.toContain('data-bidirectional="true"')
    for (const shaft of svg.matchAll(
      /<path class="permutation-arrow" data-kind="edge" data-from="([^"]+)" data-to="([^"]+)"[^>]*d="([^"]+)"/g,
    )) {
      const [, from, to, path] = shaft
      const line = parseLine(path)
      const fromCenter = CENTERS[from]
      const toCenter = CENTERS[to]
      expect(
        Math.hypot(line.start.x - fromCenter.x, line.start.y - fromCenter.y),
      ).toBeLessThanOrEqual(18)
      expect(
        Math.hypot(line.end.x - toCenter.x, line.end.y - toCenter.y),
      ).toBeLessThanOrEqual(18)
    }
  })

  it('uses shared shaft styling for separated T arrows and centres its corner lane', () => {
    const svg = renderDiagramSvg(pllSpec())
    const corner = /data-kind="corner"[^>]*stroke-width="([\d.]+)"/.exec(svg)
    const edge = /data-kind="edge"[^>]*stroke-width="([\d.]+)"/.exec(svg)
    expect(Number(corner?.[1])).toBe(Number(edge?.[1]))
    const cornerPath = /data-kind="corner"[^>]*d="M ([\d.-]+) ([\d.-]+)/.exec(
      svg,
    )
    expect(Number(cornerPath?.[1])).toBe(92)
  })

  it('rejects unsafe or incomplete SVG markup', () => {
    const valid = renderDiagramSvg(spec())
    expect(() => assertDiagramSvgSafe(valid)).not.toThrow()
    for (const tampered of [
      valid.replace('</svg>', '<script>alert(1)</script></svg>'),
      valid.replace('<svg ', '<svg onclick="alert(1)" '),
      valid.replace('</svg>', '<foreignObject></foreignObject></svg>'),
      valid.replace('</svg>', '<image href="https://example.com/a.png"/></svg>'),
      valid.replace(
        '</svg>',
        '<style>@import url(https://example.com/x.css)</style></svg>',
      ),
      valid.replace('viewBox="0 0 128 128"', 'viewBox="0 0 64 64"'),
      valid.replace('<title id="case-title">', '<title>'),
      valid.replace('class="grid-background"', 'class="other"'),
    ]) {
      expect(() => assertDiagramSvgSafe(tampered)).toThrow()
    }
  })

  it('rejects malformed diagram specs', () => {
    expect(() => renderDiagramSvg(null)).toThrow()
    expect(() => renderDiagramSvg(spec({ kind: 'other' }))).toThrow()
    expect(() =>
      renderDiagramSvg(spec({ facelets: { ...spec().facelets, top: [] } })),
    ).toThrow()
    expect(() =>
      renderDiagramSvg(
        spec({
          kind: 'pll',
          arrows: [{ kind: 'corner', piece: 'UBR', from: 'NOPE', to: 'UBR' }],
        }),
      ),
    ).toThrow()
    expect(() =>
      renderDiagramSvg(spec({ arrows: pllSpec().arrows })),
    ).toThrow()
    expect(() =>
      renderDiagramSvg(pllSpec({ arrows: [] })),
    ).toThrow()
    expect(() =>
      renderDiagramSvg(
        pllSpec({
          facelets: {
            ...pllSpec().facelets,
            front: ['U', 'F', 'F'],
          },
        }),
      ),
    ).toThrow()
    expect(() =>
      renderDiagramSvg(
        spec({
          facelets: {
            ...spec().facelets,
            left: ['U', 'X', 'F'],
          },
        }),
      ),
    ).toThrow()
  })

  it('keeps arrow and cell-boundary contrast above the documented thresholds', () => {
    const luminance = (hex) => {
      const channels = [1, 3, 5]
        .map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255)
        .map((value) =>
          value <= 0.03928
            ? value / 12.92
            : ((value + 0.055) / 1.055) ** 2.4,
        )
      return (
        0.2126 * channels[0] +
        0.7152 * channels[1] +
        0.0722 * channels[2]
      )
    }
    const contrast = (first, second) => {
      const [light, dark] = [luminance(first), luminance(second)].sort(
        (a, b) => b - a,
      )
      return (light + 0.05) / (dark + 0.05)
    }
    expect(contrast('#111418', '#FFF200')).toBeGreaterThanOrEqual(4.5)
    expect(contrast('#111418', '#C3CBD3')).toBeGreaterThanOrEqual(4.5)
    expect(contrast('#111418', '#00C853')).toBeGreaterThanOrEqual(3)
    expect(contrast('#111418', '#FF3030')).toBeGreaterThanOrEqual(3)
    expect(contrast('#111418', '#2962FF')).toBeGreaterThanOrEqual(3)
    expect(contrast('#111418', '#FF8A00')).toBeGreaterThanOrEqual(3)
  })

  it('renders a deterministic contact sheet with light, dark, 128 and 64 px surfaces', () => {
    const specs = [spec(), pllSpec()]
    const html = renderContactSheet(specs)
    expect(html).toBe(renderContactSheet(specs))
    expect(html).toContain('Compact 3×3 last-layer diagram previews')
    expect(html).toContain('OLL now uses a brighter yellow')
    expect(html).toContain('uniformly light 2 px outer border')
    expect(html).toContain('PLL uses a lighter 2 px inner grid and matching side outlines')
    expect(html).toContain('fixed-size arrowheads')
    expect(html).toContain('background:#FFF200')
    expect(html).toContain('Dark surface')
    expect(html).toContain('128 px')
    expect(html).toContain('64 px')
    expect(html.match(/class="card/g)).toHaveLength(4)
    expect(html.match(/<img /g)).toHaveLength(8)
    expect(html.match(/width="128"/g)).toHaveLength(4)
    expect(html.match(/width="64"/g)).toHaveLength(4)
    expect(html).toContain(
      'src="../../../src/assets/training/diagrams/oll/oll-01.svg"',
    )
    expect(html).toContain('on-dark')
    expect(html).not.toMatch(/<script\b/i)
    expect(html).not.toMatch(/https?:\/\//i)
  })

  it('renders a deterministic complete-collection contact sheet', () => {
    const specs = [spec(), pllSpec()]
    const html = renderContactSheet(specs, { fullCollection: true })
    expect(html).toBe(renderContactSheet(specs, { fullCollection: true }))
    expect(html).toContain('Phase 2C complete diagram set')
    expect(html).toContain('Complete 3×3 last-layer diagram set')
    expect(html).toContain('OLL (1 case)')
    expect(html).toContain('PLL (1 case)')
    expect(html).toContain('All 2 standard last-layer diagrams')
    expect(html).toContain('Both visual styles are owner-approved')
    expect(html).toContain('F12 is unresolved')
    expect(html).toContain('Dark surface')
    expect(html).toContain('128 px')
    expect(html).toContain('64 px')
    expect(html.match(/class="card/g)).toHaveLength(4)
    expect(html.match(/<img /g)).toHaveLength(8)
    expect(html.match(/width="128"/g)).toHaveLength(4)
    expect(html.match(/width="64"/g)).toHaveLength(4)
    expect(html).not.toContain('remaining 68 diagrams')
    expect(html).not.toContain('pll-refinement-comparison.html')
    expect(html).toContain('generate-diagrams.mjs --all')
    expect(html).not.toMatch(/<script\b/i)
    expect(html).not.toMatch(/https?:\/\//i)
  })
})
