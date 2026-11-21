import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RangeCalendar } from './RangeCalendar'

afterEach(cleanup)

function renderCalendar(start = '', end = '') {
  const onChange = vi.fn()
  render(<RangeCalendar start={start} end={end} onChange={onChange} />)
  return { onChange }
}

describe('RangeCalendar', () => {
  it('opens a themed calendar and selects a start then an end day', () => {
    const { onChange } = renderCalendar('2026-11-01')
    fireEvent.click(screen.getByTestId('analytics-custom-date-trigger'))
    const panel = screen.getByRole('dialog', {
      name: 'Choose a custom date range',
    })
    expect(panel).toBeVisible()
    const grid = within(panel).getByRole('grid')
    const days = within(grid).getAllByRole('button')
    const day10 = days.find((button) => button.textContent === '10')!
    fireEvent.click(day10)
    expect(onChange).toHaveBeenLastCalledWith('2026-11-01', '2026-11-10')
  })

  it('moves the start when an earlier day is chosen and supports clearing', () => {
    const { onChange } = renderCalendar('2026-11-20', '')
    fireEvent.click(screen.getByTestId('analytics-custom-date-trigger'))
    const panel = screen.getByRole('dialog', {
      name: 'Choose a custom date range',
    })
    const days = within(within(panel).getByRole('grid')).getAllByRole('button')
    const day5 = days.find((button) => button.textContent === '5')!
    fireEvent.click(day5)
    expect(onChange).toHaveBeenLastCalledWith('2026-11-05', '')
    fireEvent.click(within(panel).getByRole('button', { name: 'Clear' }))
    expect(onChange).toHaveBeenLastCalledWith('', '')
  })
})
