import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type {
  CustomAverageSetting,
  Penalty,
  Solve,
  StatMetricVisibility,
  StatVisibility,
} from '../types'
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

const allMetrics: StatMetricVisibility = {
  current: true,
  best: true,
  target: true,
  bpa: true,
  wpa: true,
}

const noMetrics: StatMetricVisibility = {
  current: false,
  best: false,
  target: false,
  bpa: false,
  wpa: false,
}

function renderPanel(
  overrides: Partial<React.ComponentProps<typeof StatsPanel>> = {},
) {
  const props: React.ComponentProps<typeof StatsPanel> = {
    stats: getSessionStats(solves, [5, 12, 7]),
    visibleStats,
    customAverages: [],
    metricVisibility: DEFAULT_SETTINGS.statMetricVisibility,
    precision: 'centiseconds',
    solves,
    ...overrides,
  }
  return render(<StatsPanel {...props} />)
}

describe('statistics panel rows', () => {
  beforeEach(() => {
    localStorage.clear()
  })
  afterEach(() => {
    cleanup()
    localStorage.clear()
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

  it('does not render expandable buttons, chevrons or target inputs', () => {
    renderPanel({ metricVisibility: allMetrics })
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByTestId('stat-details-ao5')).toBeNull()
    expect(document.querySelector('.stat-chevron')).toBeNull()
    expect(screen.queryByTestId('stat-target-ao5')).toBeNull()
  })

  it('shows every enabled metric inline without expanding a row', () => {
    renderPanel({ metricVisibility: allMetrics })
    expect(screen.getByTestId('bpa-ao5')).toHaveTextContent('13.00')
    expect(screen.getByTestId('wpa-ao5')).toHaveTextContent('15.67')
    expect(screen.getByTestId('target-ao5')).toHaveTextContent('14.98')
    expect(
      [
        ...screen
          .getByTestId('stat-row-ao5')
          .querySelectorAll('.stat-secondary .stat-metric-label'),
      ].map((label) => label.textContent),
    ).toEqual(['BPA', 'WPA', 'Target'])
    expect(screen.getByTestId('target-ao5').closest('.stat-target')).toHaveClass(
      'is-reachable',
    )
    expect(screen.getByTestId('target-ao5').getAttribute('aria-label')).toContain(
      'a tie does not count',
    )
  })

  it('shows a single target without inapplicable BPA or WPA metrics', () => {
    renderPanel({ metricVisibility: allMetrics })
    expect(screen.getByTestId('target-single')).toHaveTextContent('11.99')
    expect(screen.queryByTestId('bpa-single')).toBeNull()
    expect(screen.queryByTestId('wpa-single')).toBeNull()
  })

  it('honors each metric switch independently', () => {
    const { unmount } = renderPanel({
      metricVisibility: { ...noMetrics, bpa: true },
    })
    expect(screen.getByTestId('bpa-ao5')).toBeVisible()
    expect(screen.queryByTestId('current-ao5')).toBeNull()
    expect(screen.queryByTestId('best-ao5')).toBeNull()
    expect(screen.queryByTestId('wpa-ao5')).toBeNull()
    expect(screen.queryByTestId('target-ao5')).toBeNull()
    unmount()

    renderPanel({ metricVisibility: { ...noMetrics, target: true } })
    expect(screen.getByTestId('target-ao5')).toBeVisible()
    expect(screen.queryByTestId('bpa-ao5')).toBeNull()
    expect(screen.queryByTestId('current-ao5')).toBeNull()
  })

  it('keeps visible rows when every metric is disabled', () => {
    renderPanel({ metricVisibility: noMetrics })
    for (const key of ['single', 'mo3', 'ao5', 'ao12']) {
      expect(screen.getByTestId(`stat-row-${key}`)).toBeVisible()
    }
    expect(screen.queryByTestId('current-ao5')).toBeNull()
    expect(screen.queryByTestId('best-ao5')).toBeNull()
    expect(
      screen
        .getByTestId('stat-row-ao5')
        .querySelector('.stat-secondary'),
    ).toBeNull()
  })

  it('keeps average-row visibility independent from metric visibility', () => {
    renderPanel({
      metricVisibility: allMetrics,
      visibleStats: { ...visibleStats, ao5: false },
    })
    expect(screen.queryByTestId('stat-row-ao5')).toBeNull()
    expect(screen.getByTestId('target-ao12')).toBeVisible()
    expect(screen.getByTestId('current-ao12')).toBeVisible()
  })

  it('applies metrics and targets to custom averages', () => {
    const customAverages: CustomAverageSetting[] = [
      { id: 'custom-seven', size: 7, visible: true },
    ]
    renderPanel({
      customAverages,
      metricVisibility: { ...noMetrics, current: true, target: true },
      stats: getSessionStats(solves, [5, 12, 7]),
    })
    expect(screen.getByTestId('stat-row-custom:custom-seven')).toBeVisible()
    expect(screen.getByTestId('current-ao7')).toBeVisible()
    expect(screen.getByTestId('target-custom:custom-seven')).toBeVisible()
  })

  it('shows honest target states instead of inventing a threshold', () => {
    const shortSolves = solves.slice(0, 3)
    const { unmount } = renderPanel({
      stats: getSessionStats(shortSolves, [5]),
      solves: shortSolves,
      metricVisibility: { ...noMetrics, target: true },
    })
    expect(screen.getByTestId('target-ao5')).toHaveTextContent('—')
    unmount()

    const tiedSolves = [
      solve(10_000, 'none', 'a'),
      solve(10_000, 'none', 'b'),
      solve(10_000, 'none', 'c'),
      solve(10_000, 'none', 'd'),
      solve(10_000, 'none', 'e'),
    ]
    renderPanel({
      stats: getSessionStats(tiedSolves, [5]),
      solves: tiedSolves,
      metricVisibility: { ...noMetrics, target: true },
    })
    expect(screen.getByTestId('target-ao5')).toHaveTextContent('N/A')
  })


  it('renders the unbounded target state without inventing a number', () => {
    const four = [
      solve(5_000, 'none', 'a'),
      solve(5_000, 'none', 'b'),
      solve(5_000, 'none', 'c'),
      solve(9_000, 'none', 'd'),
    ]
    const base = getSessionStats(four, [5])
    renderPanel({
      stats: {
        ...base,
        averages: new Map([
          [5, { best: 7_000, latest: { status: 'value', ms: 6_330 } }],
        ]),
      },
      solves: four,
      visibleStats: {
        ...visibleStats,
        single: false,
        mo3: false,
        ao12: false,
      },
      metricVisibility: { ...noMetrics, target: true },
    })
    expect(screen.getByTestId('target-ao5')).toHaveTextContent('∞')
    expect(screen.getByTestId('target-ao5').getAttribute('title')).toContain(
      'Any next result, including a DNF',
    )
  })

  it('shows DNF with the existing error tone', () => {
    const dnfSolves = [
      solve(10_000, 'dnf', 'a'),
      solve(10_000, 'dnf', 'f'),
      solve(10_000, 'none', 'c'),
      solve(10_000, 'none', 'd'),
      solve(10_000, 'none', 'e'),
    ]
    renderPanel({
      stats: getSessionStats(dnfSolves, [5]),
      solves: dnfSolves,
      metricVisibility: allMetrics,
    })
    expect(screen.getByTestId('current-ao5')).toHaveTextContent('DNF')
    expect(screen.getByTestId('current-ao5').closest('.stat-current')).toHaveClass(
      'is-dnf',
    )
  })
})
