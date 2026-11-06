import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Penalty, Solve, StatVisibility } from '../types'
import { getSessionStats } from '../lib/stats'
import { DEFAULT_SETTINGS } from '../lib/storage'
import { StatsPanel } from './StatsPanel'

function solve(rawMs: number, penalty: Penalty = 'none', id?: string): Solve {
  return {
    id: id ?? `solve-${rawMs}`,
    event: '333',
    rawMs,
    penalty,
    scramble: "R U R' U'",
    comment: '',
    createdAt: 1_700_000_000_000 + rawMs,
  }
}

const solves = [
  solve(12_000, 'none', 's1'),
  solve(13_000, 'none', 's2'),
  solve(14_000, 'none', 's3'),
  solve(20_000, 'none', 's4'),
  solve(15_000, 'none', 's5'),
]

const visibleStats: StatVisibility = {
  ...DEFAULT_SETTINGS.statVisibility,
  ao25: false,
  ao100: false,
  ao200: false,
  ao500: false,
  ao1000: false,
  ao5000: false,
  ao10000: false,
}

function expandRow(key: string) {
  const row = screen.getByTestId(`stat-row-${key}`)
  if (row.getAttribute('aria-expanded') === 'false') fireEvent.click(row)
}

function renderPanel(overrides: Partial<React.ComponentProps<typeof StatsPanel>> = {}) {
  const onSetTarget = vi.fn()
  const props: React.ComponentProps<typeof StatsPanel> = {
    stats: getSessionStats(solves),
    visibleStats,
    customAverages: [],
    precision: 'centiseconds',
    solves,
    targetsMs: {},
    onSetTarget,
    showAllRows: true,
    ...overrides,
  }
  const result = render(<StatsPanel {...props} />)
  return { ...result, onSetTarget, props }
}

describe('statistics panel rows', () => {
  beforeEach(() => {
    localStorage.clear()
  })
  afterEach(() => {
    cleanup()
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('shows single, mo3, ao5 and ao12 with current and best values by default', () => {
    renderPanel()
    for (const key of ['single', 'mo3', 'ao5', 'ao12']) {
      expect(screen.getByTestId(`stat-row-${key}`)).toBeVisible()
      expect(screen.getByTestId(`best-${key}`)).toBeVisible()
      expect(screen.getByTestId(`current-${key}`)).toBeVisible()
    }
    expect(screen.getByTestId('current-ao5')).toHaveTextContent('14.00')
    expect(screen.getByTestId('best-ao5')).toHaveTextContent('14.00')
  })

  it('expands rows independently and preserves multiple open rows', () => {
    renderPanel()
    const ao5 = screen.getByTestId('stat-row-ao5')
    const ao12 = screen.getByTestId('stat-row-ao12')
    expect(ao5).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(ao5)
    expect(ao5).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('stat-details-ao5')).toBeVisible()

    fireEvent.click(ao12)
    expect(screen.getByTestId('stat-details-ao5')).toBeVisible()
    expect(screen.getByTestId('stat-details-ao12')).toBeVisible()

    fireEvent.click(ao5)
    expect(screen.queryByTestId('stat-details-ao5')).toBeNull()
    expect(screen.getByTestId('stat-details-ao12')).toBeVisible()
  })

  it('persists expanded rows across remounts', () => {
    const first = renderPanel()
    fireEvent.click(screen.getByTestId('stat-row-ao5'))
    expect(screen.getByTestId('stat-details-ao5')).toBeVisible()
    first.unmount()

    renderPanel()
    expect(screen.getByTestId('stat-details-ao5')).toBeVisible()
  })

  it('shows target, BPA, WPA and the next solve needed', () => {
    renderPanel({ targetsMs: { ao5: 14_000 } })
    expandRow('ao5')
    const details = screen.getByTestId('stat-details-ao5')
    expect(details).toHaveTextContent('Target')
    expect(details).toHaveTextContent('BPA')
    expect(details).toHaveTextContent('WPA')
    expect(details).toHaveTextContent('Next solve needed')
    expect(screen.getByTestId('stat-next-ao5')).toHaveTextContent('≤ 15.01')
    expect(details).toHaveTextContent('13.00')
    expect(details).toHaveTextContent('15.67')
  })

  it('edits and validates the target directly in the row', () => {
    const { props, onSetTarget } = renderPanel()
    expandRow('ao5')
    const input = screen.getByTestId('stat-target-ao5')
    fireEvent.change(input, { target: { value: '15.00' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSetTarget).toHaveBeenCalledWith('ao5', 15_000)

    fireEvent.change(input, { target: { value: 'nope' } })
    fireEvent.blur(input)
    expect(screen.getByRole('alert')).toHaveTextContent('Enter seconds')
    expect(onSetTarget).toHaveBeenCalledTimes(1)

    fireEvent.change(input, { target: { value: '1:05.00' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSetTarget).toHaveBeenLastCalledWith('ao5', 65_000)

    cleanup()
    render(<StatsPanel {...props} targetsMs={{ ao5: 15_000 }} />)
    expandRow('ao5')
    expect(screen.getByTestId('stat-target-ao5')).toHaveValue('15.00')
  })

  it('does not show BPA/WPA for a single but still offers a target', () => {
    renderPanel({ targetsMs: { single: 10_000 } })
    expandRow('single')
    const details = screen.getByTestId('stat-details-single')
    expect(details).toHaveTextContent('Target')
    expect(details).toHaveTextContent('Next solve needed')
    expect(details).not.toHaveTextContent('BPA')
    expect(details).not.toHaveTextContent('WPA')
    expect(screen.getByTestId('stat-next-single')).toHaveTextContent('≤ 10.00')
  })

  it('shows honest states without enough history or with an impossible target', () => {
    const shortSolves = solves.slice(0, 3)
    const { unmount } = renderPanel({
      stats: getSessionStats(shortSolves),
      solves: shortSolves,
      targetsMs: { ao5: 14_000 },
    })
    expandRow('ao5')
    expect(screen.getByTestId('stat-next-ao5')).toHaveTextContent(
      'Not enough solves',
    )
    unmount()

    renderPanel({ targetsMs: { ao5: 12_000 } })
    expandRow('ao5')
    expect(screen.getByTestId('stat-next-ao5')).toHaveTextContent(
      'Not reachable',
    )
  })
})
