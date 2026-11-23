import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { AppearanceControls } from './AppearanceControls'
import { DEFAULT_SETTINGS } from '../lib/storage'
import type { Settings } from '../types'

afterEach(cleanup)

function Harness({ onChange }: { onChange?: (next: Partial<Settings>) => void }) {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  return (
    <>
      <AppearanceControls
        settings={settings}
        onChange={(next) => {
          setSettings((current) => ({
            ...current,
            ...next,
            appearance: {
              ...current.appearance,
              ...(next.appearance ?? {}),
            },
          }))
          onChange?.(next)
        }}
      />
      <output data-testid="accent-value">
        {settings.appearance.accent ?? 'default'}
      </output>
    </>
  )
}

describe('AppearanceControls', () => {
  it('allows a custom hex color to be typed one character at a time', () => {
    render(<Harness />)
    const input = screen.getByLabelText('Custom accent hex value')

    for (const value of ['#', '#f', '#ff', '#ff0', '#ff00', '#ff000', '#ff0000']) {
      fireEvent.change(input, { target: { value } })
      expect(input).toHaveValue(value)
    }

    expect(screen.getByTestId('accent-value')).toHaveTextContent('#ff0000')
  })

  it('normalizes a completed uppercase value and restores it after invalid blur', () => {
    render(<Harness />)
    const input = screen.getByLabelText('Custom accent hex value')

    fireEvent.change(input, { target: { value: '#AABBCC' } })
    expect(screen.getByTestId('accent-value')).toHaveTextContent('#aabbcc')
    expect(input).toHaveValue('#AABBCC')
    fireEvent.blur(input)
    expect(input).toHaveValue('#aabbcc')

    fireEvent.change(input, { target: { value: '#abc' } })
    expect(input).toHaveValue('#abc')
    fireEvent.blur(input)
    expect(input).toHaveValue('#aabbcc')
    expect(screen.getByTestId('accent-value')).toHaveTextContent('#aabbcc')
  })

  it('clears the custom color when the field is emptied or reset', () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    const input = screen.getByLabelText('Custom accent hex value')

    fireEvent.change(input, { target: { value: '#123456' } })
    expect(screen.getByTestId('accent-value')).toHaveTextContent('#123456')

    fireEvent.change(input, { target: { value: '' } })
    expect(input).toHaveValue('')
    expect(screen.getByTestId('accent-value')).toHaveTextContent('default')

    fireEvent.change(input, { target: { value: '#123456' } })
    fireEvent.click(screen.getByTestId('appearance-color-reset-accent'))
    expect(input).toHaveValue('')
    expect(screen.getByTestId('accent-value')).toHaveTextContent('default')
  })
})
