import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionSetupDialog } from './SessionSetupDialog'

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

function renderDialog(sessions: { id: string; name: string }[] = []) {
  const onClose = vi.fn()
  const onCreate = vi.fn(() => true)
  const props = {
    sessions,
    defaultEvent: '333',
    defaultInspectionEnabled: false,
    onClose,
    onCreate,
  }
  const { rerender } = render(<SessionSetupDialog {...props} open />)
  return {
    onClose,
    onCreate,
    update: (open: boolean, nextSessions = sessions) =>
      rerender(<SessionSetupDialog {...props} sessions={nextSessions} open={open} />),
    name: screen.getByRole('textbox', { name: 'Session name' }),
  }
}

function selectEvent(event: string) {
  fireEvent.click(screen.getByTestId('session-setup-event'))
  fireEvent.click(screen.getByTestId(`session-setup-event-option-${event}`))
}

function createSession() {
  fireEvent.click(screen.getByRole('button', { name: 'Create session' }))
}

function chooseFormat(format: string) {
  fireEvent.click(screen.getByTestId('session-setup-format'))
  fireEvent.click(screen.getByTestId(`session-setup-format-option-${format}`))
}

describe('SessionSetupDialog naming', () => {
  it('updates a blank suggestion and keeps a typed name equal to a prior suggestion', () => {
    const { name, onCreate } = renderDialog()
    expect(name).toHaveValue('3×3')
    expect(name).toHaveAttribute('placeholder', '3×3')

    selectEvent('222')
    expect(name).toHaveValue('2×2')
    fireEvent.keyDown(name, { key: '2' })
    fireEvent.change(name, { target: { value: '2×2' } })
    selectEvent('333')
    expect(name).toHaveAttribute('placeholder', '3×3')
    expect(name).toHaveValue('2×2')

    createSession()
    expect(onCreate).toHaveBeenCalledWith('2×2', '333', { inspectionEnabled: false })
  })

  it('rejects a typed duplicate and submits the latest suggestion for whitespace', () => {
    const occupied = [{ id: 'existing', name: '3×3' }]
    const { name, onCreate, update } = renderDialog(occupied)
    expect(name).toHaveAttribute('placeholder', '3×3 (2)')

    update(true, [...occupied, { id: 'another', name: '3×3 (2)' }])
    expect(name).toHaveAttribute('placeholder', '3×3 (3)')
    fireEvent.change(name, { target: { value: '  3×3 (2)  ' } })
    expect(screen.getByRole('alert')).toHaveTextContent('Session name already exists')
    createSession()
    expect(onCreate).not.toHaveBeenCalled()

    fireEvent.change(name, { target: { value: '  ' } })
    expect(name).toHaveValue('')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    createSession()
    expect(onCreate).toHaveBeenCalledWith('3×3 (3)', '333', { inspectionEnabled: false })
  })

  it('defaults competition formats per event and submits the chosen format', () => {
    const { onCreate } = renderDialog()
    fireEvent.click(screen.getByTestId('session-setup-kind-competition'))
    expect(screen.getByTestId('session-setup-format')).toHaveAttribute(
      'aria-label',
      'Competition round format',
    )
    expect(screen.getByTestId('session-setup-format')).toHaveTextContent(
      'ao5',
    )

    selectEvent('666')
    expect(screen.getByTestId('session-setup-format')).toHaveTextContent(
      'mo3',
    )
    chooseFormat('ao50')
    fireEvent.change(screen.getByRole('textbox', { name: 'Session name' }), {
      target: { value: 'Big cubes' },
    })
    createSession()
    expect(onCreate).toHaveBeenCalledWith(
      'Big cubes',
      '666',
      { inspectionEnabled: false },
      { type: 'ao', size: 50 },
    )

    fireEvent.click(screen.getByTestId('session-setup-kind-practice'))
    expect(screen.getByTestId('session-setup-format')).toBeDisabled()
  })

  it('cancels without creation and starts with an empty draft when reopened', () => {
    const { name, onClose, onCreate, update } = renderDialog()
    selectEvent('222')
    fireEvent.change(name, { target: { value: 'Morning' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledOnce()
    expect(onCreate).not.toHaveBeenCalled()

    update(false)
    update(true)
    const reopened = screen.getByRole('textbox', { name: 'Session name' })
    expect(reopened).toHaveValue('3×3')
    expect(reopened).toHaveAttribute('placeholder', '3×3')
  })
})
