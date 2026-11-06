import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SplitSessionDialog } from './SplitSessionDialog'
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

function solve(id: string, createdAt: number): Solve {
  return {
    id,
    event: '333',
    rawMs: 10_000 + createdAt,
    penalty: 'none',
    scramble: 'R U',
    comment: id === 's3' ? 'Keep this comment' : '',
    createdAt,
  }
}

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 'source',
    name: 'Morning',
    event: '333',
    createdAt: 1,
    updatedAt: 1,
    solves: [
      solve('s5', 5_000),
      solve('s4', 4_000),
      solve('s3', 3_000),
      solve('s2', 2_000),
      solve('s1', 1_000),
    ],
    ...overrides,
  }
}

function renderDialog(
  overrides: {
    session?: Session
    sessions?: Session[]
    onSplit?: (name: string, solveIds: readonly string[]) => string | null
    onClose?: () => void
  } = {},
) {
  const source = overrides.session ?? session()
  const onSplit = overrides.onSplit ?? vi.fn(() => 'new-session')
  render(
    <SplitSessionDialog
      open
      session={source}
      sessions={overrides.sessions ?? [session({ id: 'before', name: 'Before' }), source]}
      onSplit={onSplit}
      onClose={overrides.onClose ?? vi.fn()}
    />,
  )
  return {
    dialog: screen.getByRole('dialog', { name: 'Move solves to a new session' }),
    onSplit,
  }
}

describe('SplitSessionDialog', () => {
  it('selects all or none, counts the selection and previews moved/remaining totals', () => {
    const { dialog, onSplit } = renderDialog()
    expect(within(dialog).getByTestId('split-selection-count')).toHaveTextContent(
      '0 of 5 selected · 5 remaining',
    )
    expect(within(dialog).getByTestId('split-preview')).toHaveTextContent(
      'Moving0',
    )

    fireEvent.click(within(dialog).getByTestId('split-select-all'))
    expect(within(dialog).getByTestId('split-selection-count')).toHaveTextContent(
      '5 of 5 selected · 0 remaining',
    )
    expect(within(dialog).getByTestId('split-preview')).toHaveTextContent(
      'Staying in source0',
    )
    expect(
      within(dialog).getByRole('button', { name: 'Confirm split' }),
    ).toBeDisabled()

    fireEvent.change(within(dialog).getByLabelText('Typed confirmation'), {
      target: { value: 'SPLIT SESSION' },
    })
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Confirm split' }),
    )
    expect(onSplit).toHaveBeenCalledWith('Morning (split)', [
      's5',
      's4',
      's3',
      's2',
      's1',
    ])

    fireEvent.click(within(dialog).getByTestId('split-select-none'))
    expect(within(dialog).getByTestId('split-selection-count')).toHaveTextContent(
      '0 of 5 selected · 5 remaining',
    )
  })

  it('adds an inclusive range without individual clicks', () => {
    const { dialog, onSplit } = renderDialog()
    fireEvent.change(within(dialog).getByTestId('split-range-start'), {
      target: { value: '2' },
    })
    fireEvent.change(within(dialog).getByTestId('split-range-end'), {
      target: { value: '4' },
    })
    fireEvent.click(within(dialog).getByTestId('split-select-range'))
    expect(within(dialog).getByTestId('split-selection-count')).toHaveTextContent(
      '3 of 5 selected · 2 remaining',
    )

    fireEvent.change(within(dialog).getByLabelText('Typed confirmation'), {
      target: { value: 'SPLIT SESSION' },
    })
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Confirm split' }),
    )
    expect(onSplit).toHaveBeenCalledWith('Morning (split)', [
      's4',
      's3',
      's2',
    ])
  })

  it('supports Shift-click range selection from a keyboard-accessible checkbox', () => {
    const { dialog } = renderDialog()
    const second = within(dialog).getByTestId('split-solve-1')
    const fourth = within(dialog).getByTestId('split-solve-3')
    fireEvent.click(second)
    fireEvent.click(fourth, { shiftKey: true })

    expect(within(dialog).getByTestId('split-selection-count')).toHaveTextContent(
      '3 of 5 selected · 2 remaining',
    )
  })

  it('validates the new session name before moving solves', () => {
    const { dialog, onSplit } = renderDialog()
    fireEvent.change(within(dialog).getByLabelText('New session name'), {
      target: { value: 'Before' },
    })
    fireEvent.click(within(dialog).getByTestId('split-select-all'))
    fireEvent.change(within(dialog).getByLabelText('Typed confirmation'), {
      target: { value: 'SPLIT SESSION' },
    })
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Confirm split' }),
    )

    expect(onSplit).not.toHaveBeenCalled()
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'Session name already exists',
    )
  })

  it('keeps the dialog open when the split cannot be saved', () => {
    const onClose = vi.fn()
    const { dialog } = renderDialog({
      onSplit: () => null,
      onClose,
    })
    fireEvent.click(within(dialog).getByTestId('split-select-all'))
    fireEvent.change(within(dialog).getByLabelText('Typed confirmation'), {
      target: { value: 'SPLIT SESSION' },
    })
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Confirm split' }),
    )

    expect(onClose).not.toHaveBeenCalled()
    expect(within(dialog).getByTestId('split-error')).toHaveTextContent(
      'Could not split this session',
    )
  })

  it('keeps a large solve list windowed while Select all covers every solve', () => {
    const solves = Array.from({ length: 260 }, (_, index) =>
      solve(`large-${index}`, 10_000 - index),
    )
    const { dialog, onSplit } = renderDialog({
      session: session({ id: 'large', name: 'Large', solves }),
    })

    expect(within(dialog).getAllByRole('checkbox').length).toBeLessThan(260)
    fireEvent.click(within(dialog).getByTestId('split-select-all'))
    expect(within(dialog).getByTestId('split-selection-count')).toHaveTextContent(
      '260 of 260 selected · 0 remaining',
    )
    fireEvent.change(within(dialog).getByLabelText('Typed confirmation'), {
      target: { value: 'SPLIT SESSION' },
    })
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Confirm split' }),
    )
    expect(onSplit).toHaveBeenCalledTimes(1)
    const [, ids] = (onSplit as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(ids).toHaveLength(260)
    expect(ids).toContain('large-0')
    expect(ids).toContain('large-259')
  })

  it('cancel closes without moving anything', () => {
    const onClose = vi.fn()
    const { dialog, onSplit } = renderDialog({ onClose })
    fireEvent.click(within(dialog).getByTestId('split-select-all'))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel split' }))
    expect(onSplit).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
