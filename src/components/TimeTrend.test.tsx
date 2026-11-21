import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { TimeTrend } from './TimeTrend'
import type { Penalty, Solve } from '../types'

const BASE = Date.UTC(2026, 9, 31)

function solvesFrom(times: { ms: number; penalty?: Penalty; scramble?: string }[]): Solve[] {
  return times.map((entry, index) => ({
    id: `solve-${index + 1}`,
    event: '333',
    rawMs: entry.ms,
    penalty: entry.penalty ?? 'none',
    scramble: entry.scramble ?? 'R U',
    comment: index === 4 ? 'Clean last layer' : '',
    createdAt: BASE + index * 60_000,
  })).reverse()
}

const steady = solvesFrom(Array.from({ length: 40 }, () => ({ ms: 12_000 })))
const pbs = solvesFrom([
  { ms: 20_000 },
  { ms: 22_000 },
  { ms: 21_000 },
  { ms: 23_000 },
  { ms: 16_000, penalty: '+2', scramble: 'R U F2' },
  { ms: 16_000 },
  { ms: 15_000 },
  { ms: 17_000 },
  { ms: 19_000 },
])

function svg() {
  return screen.getByTestId('time-trend-svg')
}

function hoverAt(x = 310, y = 90) {
  fireEvent.pointerMove(svg(), { clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse' })
}

function card() {
  return screen.getByTestId('time-trend-hover-card')
}

afterEach(() => {
  cleanup()
})

describe('TimeTrend compact layout', () => {
  it('shows the fixed legend, plot card and exactly five viewport buttons', () => {
    render(<TimeTrend solves={steady} />)
    expect(screen.getByTestId('time-trend-legend')).toHaveTextContent('timeao5ao12PB')
    expect(screen.getByTestId('time-trend-chart')).toBeInTheDocument()
    const controls = screen.getByTestId('time-trend-controls')
    expect(within(controls).getAllByRole('button')).toHaveLength(5)
    expect(screen.queryByTestId('time-trend-expand')).toBeNull()
    expect(screen.queryByTestId('time-trend-modal')).toBeNull()
    expect(screen.queryByText(/Expand/)).toBeNull()
    expect(screen.queryByText('Custom')).toBeNull()
    expect(screen.queryByText('PB markers')).toBeNull()
    expect(screen.queryByText(/Drag to pan/)).toBeNull()
    expect(screen.queryByTestId('time-trend-visible-range')).toBeNull()
  })

  it('applies full range and cutoff settings to the Y axis', () => {
    const cluster = Array.from({ length: 100 }, (_, index) => ({ ms: 10_000 + (index % 20) * 250 }))
    const values = [...cluster, { ms: 90_000 }]
    const { rerender } = render(<TimeTrend solves={solvesFrom(values)} scale="auto" cutoff="strong" />)
    expect(Number(svg().getAttribute('data-y-max'))).toBeLessThan(90_000)
    rerender(<TimeTrend solves={solvesFrom(values)} scale="full" cutoff="strong" />)
    expect(Number(svg().getAttribute('data-y-max'))).toBeGreaterThan(90_000)
    rerender(<TimeTrend solves={solvesFrom(values)} scale="auto" cutoff="gentle" />)
    expect(Number(svg().getAttribute('data-y-max'))).toBeLessThan(90_000)
  })
})

describe('TimeTrend hover details', () => {
  it('keeps hover details PB-only and leaves the card open over the marker or card', () => {
    render(<TimeTrend solves={steady} />)
    hoverAt()
    expect(screen.queryByTestId('time-trend-hover-card')).toBeNull()
    expect(screen.getByTestId('time-trend-plot').querySelector('.time-trend-crosshair')).toBeNull()

    const pbGroup = screen.getByTestId('time-trend-pb-hit')
    const pbMarker = within(pbGroup).getByTestId('time-trend-pb')
    fireEvent.pointerMove(svg(), {
      clientX: Number(pbMarker.getAttribute('cx')),
      clientY: Number(pbMarker.getAttribute('cy')),
      pointerId: 1,
      pointerType: 'mouse',
    })
    expect(screen.getByTestId('time-trend-plot').querySelector('.time-trend-crosshair')).not.toBeNull()
    expect(card()).toHaveAttribute('data-kind', 'pb')
    expect(card()).toHaveTextContent('Current PB · #1 of 40')
    expect(screen.getByTestId('time-trend-card-time')).toHaveTextContent('12.00')
    fireEvent.pointerMove(card(), { clientX: 0, clientY: 0 })
    expect(card()).toBeInTheDocument()
    fireEvent.pointerLeave(screen.getByTestId('time-trend-chart'))
    expect(screen.queryByTestId('time-trend-hover-card')).toBeNull()
    expect(screen.getByTestId('time-trend-plot').querySelector('.time-trend-crosshair')).toBeNull()
  })

  it('gives PB markers hover priority and shows improvement versus the previous PB', () => {
    render(<TimeTrend solves={pbs} />)
    const hitGroups = screen.getAllByTestId('time-trend-pb-hit')
    const older = hitGroups.find((group) => group.getAttribute('data-pb-id') === 'solve-5')!
    const olderMarker = within(older).getByTestId('time-trend-pb')
    fireEvent.pointerMove(svg(), {
      clientX: Number(olderMarker.getAttribute('cx')),
      clientY: Number(olderMarker.getAttribute('cy')),
      pointerId: 1,
      pointerType: 'mouse',
    })
    expect(card()).toHaveAttribute('data-kind', 'pb')
    expect(screen.getByTestId('time-trend-card-title')).toHaveTextContent('PB · #5 of 9')
    expect(screen.getByTestId('time-trend-pb-improvement')).toHaveTextContent(
      '2.00 faster (10.0%)',
    )
    expect(screen.getByTestId('time-trend-pb-previous')).toHaveTextContent('20.00 · #1')
    fireEvent.pointerLeave(screen.getByTestId('time-trend-chart'))

    const currentGroup = hitGroups.find((group) => group.getAttribute('data-current-pb') === 'true')!
    const currentMarker = within(currentGroup).getByTestId('time-trend-pb')
    fireEvent.pointerMove(svg(), {
      clientX: Number(currentMarker.getAttribute('cx')),
      clientY: Number(currentMarker.getAttribute('cy')),
      pointerId: 1,
      pointerType: 'mouse',
    })
    expect(card()).toHaveAttribute('data-kind', 'pb')
    expect(screen.getByTestId('time-trend-card-title')).toHaveTextContent('Current PB · #7 of 9')
    expect(screen.getByTestId('time-trend-pb-improvement')).toHaveTextContent(
      '1.00 faster (6.3%)',
    )
    expect(screen.getByTestId('time-trend-pb-mo3')).toHaveTextContent('16.33')
    expect(card().querySelector('.time-trend-card-scramble')).toHaveTextContent('R U')
  })

  it('shows the first-PB explanation for the first valid solve', () => {
    render(<TimeTrend solves={pbs} />)
    const first = screen.getAllByTestId('time-trend-pb-hit')[0]!
    const marker = within(first).getByTestId('time-trend-pb')
    fireEvent.pointerMove(svg(), {
      clientX: Number(marker.getAttribute('cx')),
      clientY: Number(marker.getAttribute('cy')),
      pointerId: 1,
      pointerType: 'mouse',
    })
    expect(screen.getByTestId('time-trend-pb-improvement')).toHaveTextContent('First PB')
  })
})

describe('TimeTrend PB markers', () => {
  it('marks only the latest lifetime PB as current and keeps older PBs static', () => {
    render(<TimeTrend solves={pbs} />)
    const groups = screen.getAllByTestId('time-trend-pb-hit')
    expect(groups).toHaveLength(4)
    const current = groups.filter((group) => group.getAttribute('data-current-pb') === 'true')
    expect(current).toHaveLength(1)
    expect(current[0]).toHaveAttribute('aria-label', expect.stringContaining('Current personal best'))
    expect(current[0]).toHaveAttribute('aria-label', expect.stringContaining('Solve #7'))
    expect(within(current[0]!).getByTestId('time-trend-pb')).toHaveAttribute('r', '4.2')
    expect(within(current[0]!).getByTestId('time-trend-pb-ring')).toBeInTheDocument()
    for (const group of groups.filter((item) => item !== current[0])) {
      expect(group).not.toHaveAttribute('data-current-pb')
      expect(within(group).getByTestId('time-trend-pb')).toHaveAttribute('r', '3.4')
      expect(within(group).queryByTestId('time-trend-pb-ring')).toBeNull()
    }
    for (const group of groups) {
      expect(group.querySelector('circle')).toHaveAttribute('r', '16')
    }
  })

  it('locks PB interaction while the timer is active', () => {
    render(<TimeTrend solves={pbs} disabled />)
    const root = screen.getByTestId('time-trend')
    expect(root).toHaveClass('is-timer-active')
    expect(root).toHaveAttribute('data-timer-active', 'true')
    expect(screen.getByTestId('time-trend-pb-ring')).toBeInTheDocument()
    for (const button of within(screen.getByTestId('time-trend-controls')).getAllByRole('button')) {
      expect(button).toBeDisabled()
    }
    fireEvent.pointerMove(svg(), { clientX: 310, clientY: 90, pointerId: 1, pointerType: 'mouse' })
    expect(screen.queryByTestId('time-trend-hover-card')).toBeNull()
    fireEvent.click(svg(), { clientX: 310, clientY: 90 })
    expect(screen.queryByTestId('time-trend-hover-card')).toBeNull()
    fireEvent.keyDown(svg(), { key: 'End' })
    expect(screen.queryByTestId('time-trend-hover-card')).toBeNull()
  })
})

describe('TimeTrend pointer and keyboard inspection', () => {
  it('pins only PB markers by click/tap and dismisses the card outside or with Escape', () => {
    render(<TimeTrend solves={steady} />)
    fireEvent.click(svg(), { clientX: 310, clientY: 90 })
    expect(screen.queryByTestId('time-trend-hover-card')).toBeNull()

    const current = screen.getByTestId('time-trend-pb-hit')
    fireEvent.click(current)
    expect(card()).toHaveAttribute('data-kind', 'pb')
    fireEvent.pointerDown(document.body)
    expect(screen.queryByTestId('time-trend-hover-card')).toBeNull()

    fireEvent.click(current)
    expect(card()).toHaveAttribute('data-kind', 'pb')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('time-trend-hover-card')).toBeNull()
  })

  it('inspects with arrows, Home/End, announces changes and never captures Space', () => {
    render(<TimeTrend solves={pbs} />)
    const chart = svg()
    chart.focus()
    fireEvent.keyDown(chart, { key: 'End' })
    expect(card()).toHaveTextContent('Solve #9 of 9')
    expect(screen.getByTestId('time-trend-announcement')).toHaveTextContent('Solve 9 of 9')
    fireEvent.keyDown(chart, { key: 'Home' })
    expect(card()).toHaveTextContent('PB · #1 of 9')
    expect(card()).toHaveAttribute('data-kind', 'pb')
    fireEvent.keyDown(chart, { key: 'ArrowRight' })
    expect(card()).toHaveTextContent('Solve #2 of 9')
    fireEvent.keyDown(chart, { key: 'ArrowLeft' })
    expect(card()).toHaveTextContent('PB · #1 of 9')
    expect(fireEvent.keyDown(chart, { key: ' ' })).toBe(true)
    expect(card()).toHaveTextContent('PB · #1 of 9')
    fireEvent.keyDown(chart, { key: 'Escape' })
    expect(screen.queryByTestId('time-trend-hover-card')).toBeNull()
    expect(screen.getByTestId('time-trend-announcement')).toHaveTextContent('')
  })

  it('moves keyboard inspection to a PB so its stats are reachable', () => {
    render(<TimeTrend solves={pbs} />)
    const chart = svg()
    chart.focus()
    fireEvent.keyDown(chart, { key: 'End' })
    expect(card()).toHaveAttribute('data-kind', 'solve')
    fireEvent.keyDown(chart, { key: 'ArrowLeft' })
    expect(card()).toHaveAttribute('data-kind', 'solve')
    fireEvent.keyDown(chart, { key: 'ArrowLeft' })
    expect(card()).toHaveAttribute('data-kind', 'pb')
    expect(screen.getByTestId('time-trend-card-title')).toHaveTextContent('Current PB · #7 of 9')
  })
})

describe('TimeTrend viewport controls', () => {
  it('zooms, pans, toggles the axis and reaches the bounds', () => {
    render(<TimeTrend solves={steady} />)
    const chart = svg()
    const zoomIn = screen.getByTestId('time-trend-zoom-in')
    const zoomOut = screen.getByTestId('time-trend-zoom-out')
    const panEarlier = screen.getByTestId('time-trend-pan-earlier')
    const panLater = screen.getByTestId('time-trend-pan-later')
    const axisToggle = screen.getByTestId('time-trend-axis-toggle')

    expect(zoomOut).toBeDisabled()
    expect(panEarlier).toBeDisabled()
    expect(panLater).toBeDisabled()
    fireEvent.click(zoomIn)
    expect(Number(chart.getAttribute('data-x-zoom'))).toBeGreaterThan(1)
    expect(zoomOut).toBeEnabled()
    const beforePan = chart.getAttribute('data-x-position')
    fireEvent.click(panEarlier)
    expect(chart.getAttribute('data-x-position')).not.toBe(beforePan)

    fireEvent.click(axisToggle)
    expect(screen.getByTestId('time-trend-controls')).toHaveAttribute('data-axis', 'y')
    const xZoom = chart.getAttribute('data-x-zoom')
    fireEvent.click(zoomIn)
    expect(chart.getAttribute('data-x-zoom')).toBe(xZoom)
    expect(Number(chart.getAttribute('data-y-zoom'))).toBeGreaterThan(1)
    fireEvent.click(zoomOut)
    expect(Number(chart.getAttribute('data-y-zoom'))).toBe(1)
    expect(zoomOut).toBeDisabled()
    fireEvent.click(axisToggle)

    for (let index = 0; index < 20; index += 1) fireEvent.click(zoomIn)
    expect(zoomIn).toBeDisabled()
    expect(Number(chart.getAttribute('data-x-zoom'))).toBe(20)
    for (let index = 0; index < 20; index += 1) fireEvent.click(zoomOut)
    expect(Number(chart.getAttribute('data-x-zoom'))).toBe(1)
    expect(zoomOut).toBeDisabled()
    expect(panEarlier).toBeDisabled()
    expect(panLater).toBeDisabled()
  })

  it('never changes the viewport from wheel or pointer drag', () => {
    render(<TimeTrend solves={steady} />)
    const chart = svg()
    const before = {
      yMin: chart.getAttribute('data-y-min'),
      yMax: chart.getAttribute('data-y-max'),
      xStart: chart.getAttribute('data-x-start'),
      xCount: chart.getAttribute('data-x-count'),
      xZoom: chart.getAttribute('data-x-zoom'),
      yZoom: chart.getAttribute('data-y-zoom'),
    }
    expect(fireEvent.wheel(chart, { deltaX: -240, deltaY: -240, cancelable: true })).toBe(true)
    fireEvent.pointerDown(chart, { clientX: 80, clientY: 80, pointerId: 1, pointerType: 'mouse' })
    fireEvent.pointerMove(chart, { clientX: 280, clientY: 150, pointerId: 1, pointerType: 'mouse' })
    fireEvent.pointerUp(chart, { clientX: 280, clientY: 150, pointerId: 1, pointerType: 'mouse' })
    expect({
      yMin: chart.getAttribute('data-y-min'),
      yMax: chart.getAttribute('data-y-max'),
      xStart: chart.getAttribute('data-x-start'),
      xCount: chart.getAttribute('data-x-count'),
      xZoom: chart.getAttribute('data-x-zoom'),
      yZoom: chart.getAttribute('data-y-zoom'),
    }).toEqual(before)
  })
})

describe('TimeTrend empty and DNF states', () => {
  it('keeps the legend and controls in the empty state', () => {
    render(<TimeTrend solves={[]} />)
    expect(screen.getByText('Record a solve to see your trend.')).toBeInTheDocument()
    expect(screen.getByTestId('time-trend-legend')).toHaveTextContent('time')
    expect(within(screen.getByTestId('time-trend-controls')).getAllByRole('button')).toHaveLength(5)
    expect(screen.queryByTestId('time-trend-svg')).toBeNull()
  })

  it('reports sessions with no valid times', () => {
    render(<TimeTrend solves={steady.map((solve) => ({ ...solve, penalty: 'dnf' }))} />)
    expect(screen.getByText('No valid times in this session yet.')).toBeInTheDocument()
    expect(screen.queryAllByTestId('time-trend-pb')).toHaveLength(0)
    expect(screen.queryByTestId('time-trend-svg')).toBeNull()
  })
})
