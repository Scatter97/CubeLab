import { useState } from 'react'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AnalyticsPage from './AnalyticsPage'
import { DEFAULT_SETTINGS } from '../lib/storage'
import { createDefaultAnalyticsSettings } from '../lib/analyticsSettings'
import type { Session, Settings, Solve } from '../types'

const NOW = new Date(2026, 10, 3, 12).getTime()

function solve(
  id: string,
  rawMs: number,
  offsetMs: number,
  event: '333' | '222' = '333',
  penalty: Solve['penalty'] = 'none',
): Solve {
  return {
    id,
    event,
    rawMs,
    penalty,
    scramble: `Scramble ${id}`,
    comment: id === 'a3' ? 'Look ahead' : '',
    createdAt: NOW + offsetMs,
  }
}

const sessions: Session[] = [
  {
    id: 'a',
    name: 'Morning',
    event: '333',
    createdAt: NOW - 10_000,
    updatedAt: NOW,
    solves: [
      solve('a5', 13_000, -1_000),
      solve('a4', 12_000, -2_000, '333', 'dnf'),
      solve('a3', 11_500, -3_000),
      solve('a2', 11_000, -4_000),
      solve('a1', 10_000, -5_000),
    ],
  },
  {
    id: 'b',
    name: 'Evening',
    event: '333',
    createdAt: NOW - 10_000,
    updatedAt: NOW,
    solves: [
      solve('b2', 20_000, -1_500),
      solve('b1', 19_000, -2_500),
    ],
  },
  {
    id: 'c',
    name: 'Two by two',
    event: '222',
    createdAt: NOW - 10_000,
    updatedAt: NOW,
    solves: [solve('c1', 4_000, -1_200, '222')],
  },
]

function Harness({
  initial = DEFAULT_SETTINGS,
  data = sessions,
}: {
  initial?: Settings
  data?: Session[]
}) {
  const [settings, setSettings] = useState<Settings>(initial)
  return (
    <AnalyticsPage
      sessions={data}
      initialEvent="333"
      settings={settings}
      onChange={(next) =>
        setSettings((previous) => ({ ...previous, ...next }))
      }
    />
  )
}

function selectAnalysis(name: string) {
  fireEvent.click(screen.getByRole('tab', { name }))
}

function chooseOption(testId: string, value: string) {
  fireEvent.click(screen.getByTestId(testId))
  fireEvent.click(screen.getByTestId(`${testId}-option-${value}`))
}

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: vi.fn(function (this: HTMLDialogElement) {
      this.open = true
    }),
  })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: vi.fn(function (this: HTMLDialogElement) {
      this.open = false
    }),
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('AnalyticsPage', () => {
  it('keeps the overview visible and shows one selected analysis at a time', () => {
    render(<Harness />)
    expect(screen.getByRole('heading', { name: 'Analytics' })).toBeVisible()
    expect(screen.getByText('7 matching solves')).toBeVisible()
    expect(
      within(screen.getByTestId('analytics-overview')).getByText('7'),
    ).toBeVisible()
    expect(screen.getByTestId('analytics-section-overview')).toBeVisible()
    expect(
      screen.getByRole('tab', { name: 'Time progression' }),
    ).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('analytics-section-progression')).toBeVisible()
    expect(screen.queryByTestId('analytics-section-explorer')).toBeNull()
    expect(
      screen.queryByRole('tab', { name: 'Solve explorer' }),
    ).toBeNull()

    selectAnalysis('Solve time distribution')
    expect(screen.getByTestId('analytics-section-distribution')).toBeVisible()
    expect(screen.queryByTestId('analytics-section-progression')).toBeNull()
  })

  it('updates the overview and selected analysis from global filters and resets them', () => {
    render(<Harness />)
    chooseOption('analytics-event', '222')
    expect(screen.getByText('1 matching solves')).toBeVisible()
    expect(screen.getByTestId('analytics-overview')).toHaveTextContent(
      'Total solves1',
    )
    fireEvent.click(screen.getByTestId('analytics-view-solves'))
    expect(screen.getByTestId('analytics-solve-list')).toHaveTextContent(
      '4.00',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Close solve list' }))

    fireEvent.click(screen.getByTestId('analytics-reset-filters'))
    expect(screen.getByText('7 matching solves')).toBeVisible()

    chooseOption('analytics-penalty', 'dnf')
    expect(screen.getByText('1 matching solves')).toBeVisible()
    expect(screen.getByTestId('analytics-overview')).toHaveTextContent(
      '100.0%',
    )
  })

  it('groups hero metrics with the active scope context', () => {
    render(<Harness />)
    const overview = screen.getByTestId('analytics-overview')
    expect(overview).toHaveTextContent('Best single')
    expect(overview).toHaveTextContent('Current ao5')
    expect(overview).toHaveTextContent('Total solves')
    expect(overview).toHaveTextContent('6 valid · 1 DNF')
    expect(screen.getByTestId('analytics-section-overview')).toHaveTextContent(
      'sessions · 6 valid solves',
    )
  })

  it('shows per-series values and DNF gaps in the chart tooltip', () => {
    render(<Harness />)
    const plot = screen.getByRole('group', { name: /Solve time progression/ })
    fireEvent.keyDown(plot, { key: 'ArrowLeft' })
    const tooltip = screen.getByTestId('analytics-chart-tooltip')
    expect(tooltip).toHaveTextContent('Single')
    expect(tooltip).toHaveTextContent('ao5')
    expect(tooltip).toHaveTextContent('ao12')
    expect(tooltip).toHaveTextContent('20.00')
    fireEvent.keyDown(plot, { key: 'ArrowLeft' })
    fireEvent.keyDown(plot, { key: 'ArrowLeft' })
    expect(tooltip).toHaveTextContent('—')
  })

  it('does not show a stale chart legend when there are no values', () => {
    const { container } = render(<Harness data={[]} />)
    expect(container.querySelector('.analytics-legend')).toBeNull()
    expect(screen.getByTestId('analytics-section-overview')).toHaveTextContent(
      'No solves match this scope.',
    )
  })

  it('selects all, none and individual sessions from the compact rows', () => {
    render(<Harness />)
    const trigger = screen.getByTestId('analytics-sessions-trigger')
    fireEvent.click(trigger)
    const panel = screen.getByRole('group', { name: 'Session filters' })
    const rows = panel.querySelectorAll<HTMLElement>(
      '.analytics-multiselect-row',
    )
    expect(rows).toHaveLength(3)

    const all = screen.getByTestId(
      'analytics-sessions-all',
    ) as HTMLInputElement
    expect(all).toBeChecked()
    expect(all.indeterminate).toBe(false)
    expect(screen.getByText('7 matching solves')).toBeVisible()

    // Individual uncheck creates a partial selection.
    fireEvent.click(rows[2]!)
    expect(screen.getByText('5 matching solves')).toBeVisible()
    expect(all).not.toBeChecked()
    expect(all.indeterminate).toBe(true)
    expect(all).toHaveAttribute('aria-checked', 'mixed')
    expect(trigger).toHaveTextContent('Morning')

    // Checking All restores every matching session.
    fireEvent.click(all)
    expect(all).toBeChecked()
    expect(all.indeterminate).toBe(false)
    expect(screen.getByText('7 matching solves')).toBeVisible()
    expect(
      screen.getByTestId('analytics-session-option-a'),
    ).toBeChecked()
    expect(
      screen.getByTestId('analytics-session-option-b'),
    ).toBeChecked()

    // Unchecking All clears every session and shows an explicit empty state.
    fireEvent.click(all)
    expect(all).not.toBeChecked()
    expect(all.indeterminate).toBe(false)
    expect(
      screen.getByTestId('analytics-session-option-a'),
    ).not.toBeChecked()
    expect(
      screen.getByTestId('analytics-session-option-b'),
    ).not.toBeChecked()
    expect(screen.getByText('0 matching solves')).toBeVisible()
    expect(screen.getByTestId('analytics-no-sessions')).toBeVisible()
    expect(trigger).toHaveTextContent('No sessions')

    // Selecting one session checks it and puts All in the mixed state.
    fireEvent.click(screen.getByTestId('analytics-session-option-a'))
    expect(
      screen.getByTestId('analytics-session-option-a'),
    ).toBeChecked()
    expect(all.indeterminate).toBe(true)
    expect(screen.getByText('5 matching solves')).toBeVisible()

    // Individual sessions can be added and removed, including the last one.
    fireEvent.click(screen.getByTestId('analytics-session-option-b'))
    expect(all).toBeChecked()
    expect(screen.getByText('7 matching solves')).toBeVisible()
    fireEvent.click(screen.getByTestId('analytics-session-option-a'))
    fireEvent.click(screen.getByTestId('analytics-session-option-b'))
    expect(screen.getByText('0 matching solves')).toBeVisible()
    expect(screen.getByTestId('analytics-no-sessions')).toBeVisible()

    // The empty-state action restores the all-sessions selection.
    fireEvent.click(screen.getByTestId('analytics-select-all-sessions'))
    expect(screen.getByText('7 matching solves')).toBeVisible()
    expect(all).toBeChecked()
  })

  it('opens solve details from a chart and from the solve list', () => {
    render(<Harness />)
    const plot = screen.getByRole('group', { name: /Solve time progression/ })
    fireEvent.keyDown(plot, { key: 'ArrowLeft' })
    fireEvent.keyDown(plot, { key: 'Enter' })
    const dialog = screen.getByRole('dialog', { name: 'Solve details' })
    expect(dialog).toBeVisible()
    expect(screen.getByTestId('analytics-solve-time')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Close solve details' }))
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByTestId('analytics-view-solves'))
    const listDialog = screen.getByTestId('analytics-solve-list-dialog')
    fireEvent.click(within(listDialog).getAllByRole('listitem')[0]!)
    expect(screen.getByRole('dialog', { name: 'Solve details' })).toBeVisible()
  })

  it('filters the solve list from a histogram interval', () => {
    render(<Harness />)
    selectAnalysis('Solve time distribution')
    const histogram = screen.getByTestId('analytics-histogram')
    const bars = within(histogram).getAllByRole('button')
    fireEvent.click(bars[0]!)
    const listDialog = screen.getByTestId('analytics-solve-list-dialog')
    expect(listDialog).toHaveTextContent('Solves')
    expect(screen.getByTestId('analytics-solve-list')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Close solve list' }))
    expect(
      screen.getAllByRole('button', { name: 'Clear interval filter' })[0],
    ).toBeVisible()
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Clear interval filter' })[0]!,
    )
    fireEvent.click(screen.getByTestId('analytics-view-solves'))
    expect(screen.getByTestId('analytics-solve-list-dialog')).toHaveTextContent(
      'newest first',
    )
  })

  it('resets a drill-down interval when filters change', () => {
    render(<Harness />)
    selectAnalysis('Solve time distribution')
    fireEvent.click(
      within(screen.getByTestId('analytics-histogram')).getAllByRole('button')[0]!,
    )
    expect(screen.getByTestId('analytics-solve-list-dialog')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Close solve list' }))
    chooseOption('analytics-penalty', 'none')
    expect(
      screen.queryByRole('button', { name: 'Clear interval filter' }),
    ).toBeNull()
    fireEvent.click(screen.getByTestId('analytics-view-solves'))
    expect(screen.getByTestId('analytics-solve-list-dialog')).toHaveTextContent(
      'newest first',
    )
  })

  it('handles empty data without hiding the analysis controls', () => {
    render(<Harness data={[]} />)
    expect(screen.getByText('0 matching solves')).toBeVisible()
    expect(screen.getByTestId('analytics-view-solves')).toBeDisabled()
    selectAnalysis('Practice activity')
    expect(
      screen.getByText('No practice activity matches the current filters.'),
    ).toBeVisible()
    expect(screen.getByTestId('analytics-activity-chart')).toHaveTextContent(
      'No practice activity yet.',
    )
  })

  it('attaches chart measurement when an empty scope becomes populated', async () => {
    const observed: Element[] = []
    class MockResizeObserver {
      constructor(_callback: ResizeObserverCallback) {}
      observe(target: Element) {
        observed.push(target)
      }
      unobserve() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', MockResizeObserver)

    const { rerender } = render(<Harness data={[]} />)
    expect(observed).toHaveLength(0)

    rerender(<Harness data={sessions} />)
    await waitFor(() => expect(observed.length).toBeGreaterThan(0))
    expect(observed[0]).toHaveClass('analytics-chart-plot')
  })

  it('recomputes the overview when solve data changes', () => {
    const { rerender } = render(<Harness data={sessions} />)
    expect(screen.getByText('7 matching solves')).toBeVisible()
    const changed = sessions.map((session) => ({
      ...session,
      solves: session.solves.slice(1),
    }))
    rerender(<Harness data={changed} />)
    expect(screen.getByText('5 matching solves')).toBeVisible()
    expect(screen.getByTestId('analytics-overview')).toHaveTextContent('4')
  })

  it('persists visibility and order through the analysis navigation', () => {
    render(
      <Harness
        initial={{
          ...DEFAULT_SETTINGS,
          analytics: createDefaultAnalyticsSettings(),
        }}
      />,
    )
    fireEvent.click(screen.getByTestId('analytics-customize-toggle'))
    const consistency = screen.getByRole('checkbox', { name: 'Consistency' })
    fireEvent.click(consistency)
    expect(
      screen.queryByRole('tab', { name: 'Consistency' }),
    ).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Reset layout' }))
    expect(screen.getByRole('tab', { name: 'Consistency' })).toBeVisible()

    fireEvent.click(
      screen.getByRole('button', { name: 'Move Practice activity up' }),
    )
    const tabs = screen.getAllByRole('tab').map((tab) => tab.textContent)
    expect(tabs.indexOf('Practice activity')).toBeLessThan(
      tabs.indexOf('Session comparison'),
    )
  })

  it('makes every analysis reachable and provides a narrow-screen selector', () => {
    render(<Harness />)
    const labels = [
      'Time progression',
      'Average progression',
      'Historical personal bests',
      'Solve time distribution',
      'Consistency',
      'Sub-X analysis',
      'Session comparison',
      'Practice activity',
      'Advanced analytics',
    ]
    for (const label of labels) {
      selectAnalysis(label)
      expect(screen.getByRole('tab', { name: label })).toHaveAttribute(
        'aria-selected',
        'true',
      )
      expect(screen.getByTestId('analytics-analysis-panel')).toBeVisible()
    }

    chooseOption('analytics-analysis-select', 'distribution')
    expect(
      screen.getByRole('tab', { name: 'Solve time distribution' }),
    ).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('analytics-section-distribution')).toBeVisible()
  })

  it('keeps every Sub-X session visible in a scrollable breakdown', () => {
    render(<Harness />)
    selectAnalysis('Sub-X analysis')
    const region = screen.getByTestId('analytics-subx-table-scroll')
    expect(region).toHaveAttribute('tabindex', '0')
    const table = within(region).getByRole('table')
    expect(table).toHaveTextContent('Morning')
    expect(table).toHaveTextContent('Evening')
    expect(table).toHaveTextContent('80.0%')
    expect(within(table).getAllByRole('row')).toHaveLength(3)

    const divider = screen.getByTestId('analytics-subx-divider')
    divider.focus()
    expect(divider).toHaveAttribute('aria-valuenow', '58')
    fireEvent.keyDown(divider, { key: 'ArrowDown' })
    expect(divider).toHaveAttribute('aria-valuenow', '61')
    fireEvent.keyDown(divider, { key: 'Home' })
    expect(divider).toHaveAttribute('aria-valuenow', '38')
    fireEvent.keyDown(divider, { key: 'End' })
    expect(divider).toHaveAttribute('aria-valuenow', '72')
  })

  it('closes the session filter on Escape and outside presses', () => {
    render(<Harness />)
    const trigger = screen.getByTestId('analytics-sessions-trigger')
    trigger.focus()
    fireEvent.click(trigger)
    expect(screen.getByRole('group', { name: 'Session filters' })).toBeVisible()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('group', { name: 'Session filters' })).toBeNull()
    expect(trigger).toHaveFocus()

    fireEvent.click(trigger)
    expect(screen.getByRole('group', { name: 'Session filters' })).toBeVisible()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('group', { name: 'Session filters' })).toBeNull()
  })

  it('uses a compact accessible zoom group with reset semantics', () => {
    render(<Harness />)
    const chart = screen.getByTestId('analytics-progression')
    const zoomIn = within(chart).getByRole('button', {
      name: 'Zoom in on Time progression',
    })
    const zoomOut = within(chart).getByRole('button', {
      name: 'Zoom out of Time progression',
    })
    const reset = within(chart).getByRole('button', {
      name: 'Reset Time progression view',
    })
    expect(zoomOut).toBeDisabled()
    expect(reset).toBeDisabled()
    fireEvent.click(zoomIn)
    expect(zoomOut).toBeEnabled()
    expect(reset).toBeEnabled()
    expect(chart).toHaveTextContent('of 7')
    fireEvent.click(reset)
    expect(zoomOut).toBeDisabled()
    expect(reset).toBeDisabled()
  })

  it('accepts precise Sub-X targets and exposes useful presets', () => {
    render(<Harness />)
    selectAnalysis('Sub-X analysis')
    expect(screen.getByRole('button', { name: 'Sub-15' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Sub-15' }))
    expect(
      (screen.getByLabelText('Target for 3×3') as HTMLInputElement).value,
    ).toBe('15')

    let input = screen.getByLabelText('Target for 3×3') as HTMLInputElement
    fireEvent.change(input, { target: { value: '12.345' } })
    fireEvent.blur(input)
    input = screen.getByLabelText('Target for 3×3') as HTMLInputElement
    expect(input.value).toBe('12.345')

    fireEvent.change(input, { target: { value: 'abc' } })
    fireEvent.blur(input)
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Enter seconds with up to three decimal places',
    )
    expect(
      screen.getByLabelText('Target for 3×3') as HTMLInputElement,
    ).toHaveAttribute('aria-invalid', 'true')
  })
})
