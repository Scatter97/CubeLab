import { useState } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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
      activeSessionId="a"
      initialEvent="333"
      settings={settings}
      onChange={(next) =>
        setSettings((previous) => ({ ...previous, ...next }))
      }
    />
  )
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
})

describe('AnalyticsPage', () => {
  it('updates every section from the global filters and resets them', () => {
    render(<Harness />)
    expect(screen.getByRole('heading', { name: 'Analytics' })).toBeVisible()
    expect(screen.getByText('7 matching solves')).toBeVisible()
    expect(
      within(screen.getByTestId('analytics-overview')).getByText('7'),
    ).toBeVisible()
    expect(screen.getByTestId('analytics-section-overview')).toBeVisible()
    expect(screen.getByTestId('analytics-section-explorer')).toBeVisible()

    fireEvent.change(screen.getByLabelText('Analytics event'), {
      target: { value: '222' },
    })
    expect(screen.getByText('1 matching solves')).toBeVisible()
    expect(screen.getByTestId('analytics-solve-list')).toHaveTextContent(
      '4.00',
    )

    fireEvent.click(screen.getByTestId('analytics-reset-filters'))
    expect(screen.getByText('7 matching solves')).toBeVisible()

    fireEvent.change(screen.getByLabelText('Penalty'), {
      target: { value: 'dnf' },
    })
    expect(screen.getByText('1 matching solves')).toBeVisible()
    expect(screen.getByTestId('analytics-overview')).toHaveTextContent(
      '100.0%',
    )
  })

  it('opens solve details from a chart and from the solve explorer', () => {
    render(<Harness />)
    const plot = screen.getByRole('group', { name: /Solve time progression/ })
    fireEvent.keyDown(plot, { key: 'ArrowLeft' })
    fireEvent.keyDown(plot, { key: 'Enter' })
    const dialog = screen.getByRole('dialog', { name: 'Solve details' })
    expect(dialog).toBeVisible()
    expect(screen.getByTestId('analytics-solve-time')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Close solve details' }))
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getAllByRole('listitem')[0]!)
    expect(screen.getByRole('dialog', { name: 'Solve details' })).toBeVisible()
  })

  it('filters the explorer from a histogram interval', () => {
    render(<Harness />)
    const histogram = screen.getByTestId('analytics-histogram')
    const bars = within(histogram).getAllByRole('button')
    fireEvent.click(bars[0]!)
    expect(screen.getByTestId('analytics-explorer-count')).toHaveTextContent(
      'solves ·',
    )
    expect(
      screen.getAllByRole('button', { name: 'Clear interval filter' })[0],
    ).toBeVisible()
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Clear interval filter' })[0]!,
    )
    expect(screen.getByTestId('analytics-explorer-count')).toHaveTextContent(
      '7 solves · newest first',
    )
  })

  it('recomputes every section when solve data changes', () => {
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

  it('persists section visibility and order through settings', () => {
    render(<Harness initial={{ ...DEFAULT_SETTINGS, analytics: createDefaultAnalyticsSettings() }} />)
    fireEvent.click(screen.getByTestId('analytics-customize-toggle'))
    const consistency = screen.getByRole('checkbox', { name: 'Consistency' })
    fireEvent.click(consistency)
    expect(
      screen.queryByTestId('analytics-section-consistency'),
    ).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Reset layout' }))
    expect(screen.getByTestId('analytics-section-consistency')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'Move Practice activity up' }))
    const ids = screen
      .getAllByTestId(/analytics-section-/)
      .map((section) => section.getAttribute('data-testid'))
    expect(ids.indexOf('analytics-section-activity')).toBeLessThan(
      ids.indexOf('analytics-section-sessions'),
    )
  })
})
