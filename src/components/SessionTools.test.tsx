import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { Solve } from '../types'
import {
  DailyStatsTool,
  DistributionTool,
  StatisticsTool,
} from './SessionTools'

const BASE_AT = new Date(2026, 10, 22, 12, 0, 0).getTime()

function solve(overrides: Partial<Solve> = {}): Solve {
  return {
    id: `solve-${Math.random().toString(36).slice(2)}`,
    event: '333',
    rawMs: 10_000,
    penalty: 'none',
    scramble: "R U R' U'",
    comment: '',
    createdAt: BASE_AT,
    ...overrides,
  }
}

function rowValue(label: string): string {
  const term = screen.getByText(label, { selector: 'dt' })
  return within(term.parentElement!).getByText((_, element) => element?.tagName === 'DD')
    .textContent ?? ''
}

describe('StatisticsTool', () => {
  afterEach(cleanup)

  it('keeps the empty state for a session with no solves', () => {
    render(<StatisticsTool solves={[]} />)
    expect(screen.getByText('No solves in this session yet.')).toBeInTheDocument()
    expect(screen.queryByTestId('statistics-all-dnf')).not.toBeInTheDocument()
  })

  it('shows real counts, dashes and the Easter egg for an all-DNF session', () => {
    render(
      <StatisticsTool
        solves={[
          solve({ id: 'dnf-1', penalty: 'dnf' }),
          solve({ id: 'dnf-2', penalty: 'dnf' }),
          solve({ id: 'dnf-3', penalty: 'dnf' }),
        ]}
      />,
    )

    expect(rowValue('Solves')).toBe('3')
    expect(rowValue('Valid')).toBe('0')
    expect(rowValue('DNF')).toBe('3')
    for (const label of ['Best', 'Worst', 'Mean', 'Median', 'Total']) {
      expect(rowValue(label)).toBe('—')
    }
    expect(screen.getByTestId('statistics-all-dnf')).toHaveTextContent(
      '100% DNF. That’s consistency.',
    )
  })

  it('keeps valid times in mixed-session statistics and hides the Easter egg', () => {
    render(
      <StatisticsTool
        solves={[
          solve({ id: 'fast', rawMs: 10_000 }),
          solve({ id: 'dnf', penalty: 'dnf' }),
          solve({ id: 'slow', rawMs: 14_000 }),
        ]}
      />,
    )

    expect(rowValue('Solves')).toBe('3')
    expect(rowValue('Valid')).toBe('2')
    expect(rowValue('DNF')).toBe('1')
    expect(rowValue('Best')).toBe('10.00')
    expect(rowValue('Worst')).toBe('14.00')
    expect(rowValue('Mean')).toBe('12.00')
    expect(rowValue('Median')).toBe('12.00')
    expect(rowValue('Total')).toBe('24.00')
    expect(screen.queryByTestId('statistics-all-dnf')).not.toBeInTheDocument()
  })
})

describe('DistributionTool', () => {
  afterEach(cleanup)

  it('renders and counts every entry in a 150,000-solve session', () => {
    const solves = Array.from({ length: 150_000 }, (_, index) =>
      solve({
        id: `large-${index}`,
        rawMs: 1_000 + index * 10,
      }),
    )
    render(<DistributionTool solves={solves} />)

    expect(screen.getByText('150000 valid solves')).toBeInTheDocument()
    expect(screen.queryAllByRole('progressbar')).toHaveLength(0)
    expect(document.querySelectorAll('.tool-bar-row')).toHaveLength(8)
  })

  it('still shows only valid times in a mixed session', () => {
    render(
      <DistributionTool
        solves={[
          solve({ id: 'fast', rawMs: 10_000 }),
          solve({ id: 'dnf', penalty: 'dnf' }),
          solve({ id: 'slow', rawMs: 20_000 }),
        ]}
      />,
    )

    expect(screen.getByText('2 valid solves')).toBeInTheDocument()
    expect(document.querySelectorAll('.tool-bar-row').length).toBeGreaterThan(0)
  })
})

describe('DailyStatsTool', () => {
  afterEach(cleanup)

  it('uses full local calendar dates and includes years across multi-year history', () => {
    render(
      <DailyStatsTool
        solves={[
          solve({
            id: 'nov-2026',
            createdAt: new Date(2026, 10, 22, 12).getTime(),
          }),
          solve({
            id: 'nov-2025',
            createdAt: new Date(2025, 10, 22, 12).getTime(),
          }),
        ]}
      />,
    )

    const rows = screen.getAllByRole('row').slice(1)
    expect(rows.map((row) => row.getAttribute('data-date'))).toEqual([
      '2026-11-22',
      '2025-11-22',
    ])
    expect(rows[0]).toHaveTextContent(/2026/)
    expect(rows[1]).toHaveTextContent(/2025/)
  })

  it('omits the year when every entry falls in one year', () => {
    render(
      <DailyStatsTool
        solves={[
          solve({
            id: 'nov-2026',
            createdAt: new Date(2026, 10, 22, 12).getTime(),
          }),
          solve({
            id: 'dec-2026',
            createdAt: new Date(2026, 11, 1, 12).getTime(),
          }),
        ]}
      />,
    )

    const rows = screen.getAllByRole('row').slice(1)
    expect(rows[0]).not.toHaveTextContent(/2026/)
    expect(rows[1]).not.toHaveTextContent(/2026/)
  })
})
