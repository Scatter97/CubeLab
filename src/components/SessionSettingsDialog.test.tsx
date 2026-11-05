import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionSettingsDialog } from './SessionSettingsDialog'
import type { Session, Solve } from '../types'

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

function solve(id: string): Solve {
  return {
    id,
    event: '333',
    rawMs: 12_345,
    penalty: 'none',
    scramble: 'R U',
    comment: '',
    createdAt: 1_700_000_000_000,
  }
}

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    name: 'Morning',
    event: '333',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    solves: [solve('a'), solve('b')],
    ...overrides,
  }
}

function renderDialog(
  overrides: {
    session?: Session
    onSetSessionEvent?: (id: string, event: string) => boolean
    onRenameSession?: (id: string, name: string) => boolean
  } = {},
) {
  const current = overrides.session ?? session()
  return render(
    <SessionSettingsDialog
      open
      sessions={[current]}
      session={current}
      effectiveInspectionEnabled={false}
      canDelete={false}
      onRenameSession={overrides.onRenameSession ?? (() => true)}
      onSetSessionEvent={(id, event) =>
        overrides.onSetSessionEvent?.(id, event) ?? true
      }
      onOpenEventManager={vi.fn()}
      onSetInspection={vi.fn()}
      onRequestClear={vi.fn()}
      onRequestDelete={vi.fn()}
      onClose={vi.fn()}
    />,
  )
}

describe('SessionSettingsDialog layout', () => {
  it('keeps concise state text and leaves destructive actions distinct', () => {
    renderDialog()
    const dialog = screen.getByRole('dialog', { name: 'Session settings' })
    expect(dialog).not.toHaveTextContent('Unique within this browser')
    expect(dialog).toHaveTextContent(
      'Changing the event also updates existing solves in this session.',
    )
    expect(dialog).toHaveTextContent('Global default · Off')
    expect(dialog).not.toHaveTextContent('Manage session')
    expect(within(dialog).getByTestId('session-clear')).toBeVisible()
    expect(within(dialog).getByTestId('session-delete')).toBeVisible()
  })
})

describe('SessionSettingsDialog event correction', () => {
  it('requires explicit confirmation before reassigning a session with solves', () => {
    const onSetSessionEvent = vi.fn(() => true)
    renderDialog({ onSetSessionEvent })
    const dialog = screen.getByRole('dialog', { name: 'Session settings' })
    expect(dialog).toHaveTextContent('Morning')
    expect(dialog).not.toHaveTextContent(
      'Event is locked because this session has solves',
    )
    expect(dialog).not.toHaveTextContent(
      'Create a new session for another event',
    )

    fireEvent.click(within(dialog).getByTestId('session-event-select'))
    fireEvent.click(within(dialog).getByTestId('session-event-select-option-222'))
    expect(onSetSessionEvent).not.toHaveBeenCalled()
    expect(dialog).toHaveTextContent('Change Morning from 3×3 to 2×2?')
    expect(dialog).toHaveTextContent('reassigns 2 solves')

    fireEvent.click(
      within(dialog).getByTestId('confirm-session-event'),
    )
    expect(onSetSessionEvent).toHaveBeenCalledWith('session-1', '222')
    expect(dialog).not.toHaveTextContent('Confirm event change')
  })

  it('cancels without changing the event and restores the selection', () => {
    const onSetSessionEvent = vi.fn(() => true)
    renderDialog({ onSetSessionEvent })
    const dialog = screen.getByRole('dialog', { name: 'Session settings' })
    const select = within(dialog).getByTestId('session-event-select')
    fireEvent.click(select)
    fireEvent.click(
      within(dialog).getByTestId('session-event-select-option-222'),
    )
    fireEvent.click(within(dialog).getByTestId('cancel-session-event'))
    expect(onSetSessionEvent).not.toHaveBeenCalled()
    expect(select).toHaveTextContent('3×3')
    expect(dialog).not.toHaveTextContent('Confirm event change')
  })

  it('applies immediately for an empty session and supports custom events', () => {
    const customSession = session({ name: 'FTO practice', event: 'custom:fto', solves: [] })
    const onSetSessionEvent = vi.fn(() => true)
    renderDialog({
      session: customSession,
      onSetSessionEvent,
      onRenameSession: () => true,
    })
    const dialog = screen.getByRole('dialog', { name: 'Session settings' })
    fireEvent.click(within(dialog).getByTestId('session-event-select'))
    fireEvent.click(within(dialog).getByTestId('session-event-select-option-222'))
    expect(onSetSessionEvent).toHaveBeenCalledWith('session-1', '222')
    expect(dialog).not.toHaveTextContent('Confirm event change')
  })

  it('reports a failed reassignment without pretending it changed', () => {
    renderDialog({ onSetSessionEvent: () => false })
    const dialog = screen.getByRole('dialog', { name: 'Session settings' })
    fireEvent.click(within(dialog).getByTestId('session-event-select'))
    fireEvent.click(within(dialog).getByTestId('session-event-select-option-222'))
    fireEvent.click(within(dialog).getByTestId('confirm-session-event'))
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'Could not change this session event.',
    )
  })
})
