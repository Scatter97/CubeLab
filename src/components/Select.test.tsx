import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Select } from './Select'

const options = [
  { value: 'alpha', label: 'Alpha' },
  { value: 'beta', label: 'Beta' },
  { value: 'gamma', label: 'Gamma' },
]

function Harness({ disabled = false }: { disabled?: boolean }) {
  const [value, setValue] = useState('alpha')
  return (
    <Select
      value={value}
      options={options}
      onChange={setValue}
      ariaLabel="Test selection"
      testId="test-select"
      disabled={disabled}
    />
  )
}

afterEach(cleanup)

describe('Select', () => {
  it('opens with the keyboard and selects with arrows and Enter', () => {
    render(<Harness />)
    const trigger = screen.getByTestId('test-select')
    expect(trigger).toHaveTextContent('Alpha')
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    expect(screen.getByRole('listbox', { name: 'Test selection' })).toBeVisible()
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    fireEvent.keyDown(trigger, { key: 'Enter' })
    expect(trigger).toHaveTextContent('Beta')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(trigger).toHaveFocus()
  })

  it('supports type-ahead, Escape and pointer selection', () => {
    render(<Harness />)
    const trigger = screen.getByTestId('test-select')
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'g' })
    expect(screen.getByRole('listbox', { name: 'Test selection' })).toBeVisible()
    fireEvent.keyDown(trigger, { key: 'Enter' })
    expect(trigger).toHaveTextContent('Gamma')

    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    fireEvent.keyDown(trigger, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(trigger).toHaveFocus()

    fireEvent.click(trigger)
    fireEvent.click(screen.getByTestId('test-select-option-alpha'))
    expect(trigger).toHaveTextContent('Alpha')
    expect(trigger).toHaveFocus()
  })

  it('closes on outside pointer presses and does not open while disabled', () => {
    const { rerender } = render(<Harness />)
    const trigger = screen.getByTestId('test-select')
    fireEvent.click(trigger)
    expect(screen.getByRole('listbox')).toBeVisible()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('listbox')).toBeNull()

    rerender(<Harness disabled />)
    const disabled = screen.getByTestId('test-select')
    fireEvent.click(disabled)
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(disabled).toBeDisabled()
  })
})
