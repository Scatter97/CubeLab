import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MergeSessionsDialog } from './MergeSessionsDialog'
import type { Session, SessionsData, Solve } from '../types'

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

function solve(id: string, event = '333'): Solve {
  return {
    id,
    event,
    rawMs: 10_000,
    penalty: 'none',
    scramble: 'R U',
    comment: '',
    createdAt: 1_700_000_000_000,
  }
}

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 'destination',
    name: 'Destination',
    event: '333',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    solves: [solve('d1'), solve('d2')],
    ...overrides,
  }
}

function data(overrides: Partial<SessionsData> = {}): SessionsData {
  return {
    activeSessionId: 'destination',
    sessions: [
      session(),
      session({
        id: 'source-a',
        name: 'Source A',
        solves: [solve('a1'), solve('a2'), solve('a3')],
      }),
      session({
        id: 'source-b',
        name: 'Source B',
        event: '222',
        solves: [solve('b1', '222')],
      }),
      session({ id: 'empty', name: 'Empty', solves: [] }),
    ],
    ...overrides,
  }
}

function renderDialog(
  overrides: {
    sessions?: SessionsData
    initialTargetId?: string
    onMerge?: (sourceIds: readonly string[], targetId: string) => boolean
    onClose?: () => void
  } = {},
) {
  const onMerge = overrides.onMerge ?? vi.fn(() => true)
  render(
    <MergeSessionsDialog
      open
      sessions={overrides.sessions ?? data()}
      initialTargetId={overrides.initialTargetId ?? 'destination'}
      onMerge={onMerge}
      onClose={overrides.onClose ?? vi.fn()}
    />,
  )
  return {
    dialog: screen.getByRole('dialog', { name: 'Merge sessions' }),
    onMerge,
  }
}

describe('MergeSessionsDialog', () => {
  it('disables incompatible events and previews names, counts and the merged total', () => {
    const { dialog } = renderDialog()
    const incompatible = within(dialog).getByTestId('merge-source-source-b')
    expect(incompatible).toBeDisabled()
    expect(dialog).toHaveTextContent('Uses a different event')

    fireEvent.click(within(dialog).getByTestId('merge-source-source-a'))
    expect(within(dialog).getByTestId('merge-preview')).toHaveTextContent(
      'Source A',
    )
    expect(within(dialog).getByTestId('merge-preview')).toHaveTextContent(
      'After merge5',
    )
    expect(within(dialog).getByTestId('merge-preview')).toHaveTextContent(
      'Sources removed1',
    )
    expect(
      within(dialog).getByRole('button', { name: 'Confirm merge' }),
    ).toBeDisabled()

    fireEvent.change(within(dialog).getByLabelText('Typed confirmation'), {
      target: { value: 'MERGE SESSIONS' },
    })
    expect(
      within(dialog).getByRole('button', { name: 'Confirm merge' }),
    ).toBeEnabled()
  })

  it('supports selecting multiple compatible sources and empty sessions', () => {
    const { dialog, onMerge } = renderDialog()
    fireEvent.click(within(dialog).getByTestId('merge-select-all'))
    expect(within(dialog).getByTestId('merge-source-source-a')).toBeChecked()
    expect(within(dialog).getByTestId('merge-source-empty')).toBeChecked()
    expect(within(dialog).getByTestId('merge-source-source-b')).not.toBeChecked()
    expect(within(dialog).getByTestId('merge-preview')).toHaveTextContent(
      'Sources removed2',
    )
    expect(within(dialog).getByTestId('merge-preview')).toHaveTextContent(
      'Source solves moved3',
    )
    expect(dialog).toHaveTextContent(
      'Empty source sessions contain no solves',
    )

    fireEvent.change(within(dialog).getByLabelText('Typed confirmation'), {
      target: { value: 'MERGE SESSIONS' },
    })
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Confirm merge' }),
    )
    expect(onMerge).toHaveBeenCalledWith(
      ['source-a', 'empty'],
      'destination',
    )
  })

  it('keeps the dialog open and reports a failed merge', () => {
    const onClose = vi.fn()
    const { dialog } = renderDialog({
      onMerge: () => false,
      onClose,
    })
    fireEvent.click(within(dialog).getByTestId('merge-source-source-a'))
    fireEvent.change(within(dialog).getByLabelText('Typed confirmation'), {
      target: { value: 'MERGE SESSIONS' },
    })
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Confirm merge' }),
    )

    expect(onClose).not.toHaveBeenCalled()
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'Could not merge these sessions',
    )
  })

  it('shows duplicate-name review information without forcing an automatic merge', () => {
    const { dialog } = renderDialog({
      sessions: data({
        sessions: [
          session({ id: 'shared-a', name: 'Shared', solves: [solve('a')] }),
          session({ id: 'shared-b', name: 'Shared', solves: [solve('b')] }),
        ],
      }),
      initialTargetId: undefined,
    })

    expect(dialog).toHaveTextContent('Found 2 separate sessions named')
    expect(within(dialog).getByTestId('merge-source-shared-b')).toBeChecked()
  })
})
