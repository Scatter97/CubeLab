import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Solve } from '../types'
import { copyText } from '../lib/clipboard'
import { ConfirmTimeTool } from './ConfirmTimeTool'

vi.mock('../lib/clipboard', () => ({ copyText: vi.fn() }))

const copyTextMock = vi.mocked(copyText)

const solve: Solve = {
  id: 'solve-1',
  event: '333',
  rawMs: 12_340,
  penalty: 'none',
  scramble: "R U R' U' F2 D L2 B' R2 U2",
  comment: '',
  createdAt: Date.UTC(2026, 10, 21, 13, 18),
}

describe('ConfirmTimeTool', () => {
  beforeEach(() => {
    copyTextMock.mockReset()
    copyTextMock.mockResolvedValue(true)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('shows an empty state when the session has no solves', () => {
    render(<ConfirmTimeTool solve={null} number={0} />)

    expect(screen.getByTestId('confirm-time-empty')).toHaveTextContent(
      'No solves to confirm yet',
    )
  })

  it('shows the latest solve, its number, round context, date and scramble', () => {
    render(
      <ConfirmTimeTool
        solve={solve}
        number={12}
        roundLabel="Round 2 · attempt 3/5"
      />,
    )

    expect(screen.getByTestId('confirm-time-heading')).toHaveTextContent(
      'Solve #12 · Round 2 · attempt 3/5',
    )
    expect(screen.getByTestId('confirm-time-value')).toHaveTextContent('12.34')
    expect(screen.getByText(solve.scramble)).toBeInTheDocument()
    expect(screen.getByText(/2026/)).toBeInTheDocument()
  })

  it('sets OK, +2 and DNF through the supplied handler', () => {
    const onSetPenalty = vi.fn()
    render(
      <ConfirmTimeTool solve={solve} number={1} onSetPenalty={onSetPenalty} />,
    )

    fireEvent.click(screen.getByTestId('confirm-time-plus-two'))
    fireEvent.click(screen.getByTestId('confirm-time-dnf'))
    fireEvent.click(screen.getByTestId('confirm-time-ok'))

    expect(onSetPenalty).toHaveBeenNthCalledWith(1, solve.id, '+2')
    expect(onSetPenalty).toHaveBeenNthCalledWith(2, solve.id, 'dnf')
    expect(onSetPenalty).toHaveBeenNthCalledWith(3, solve.id, 'none')
  })

  it('shows the effective time for +2 and the raw time for DNF', () => {
    const { rerender } = render(
      <ConfirmTimeTool
        solve={{ ...solve, penalty: '+2' }}
        number={1}
      />,
    )
    expect(screen.getByTestId('confirm-time-value')).toHaveTextContent(
      '12.34+2',
    )
    expect(screen.getByTestId('confirm-time-secondary')).toHaveTextContent(
      'Effective 14.34',
    )
    expect(screen.getByTestId('confirm-time-plus-two')).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    rerender(
      <ConfirmTimeTool solve={{ ...solve, penalty: 'dnf' }} number={1} />,
    )
    expect(screen.getByTestId('confirm-time-value')).toHaveTextContent('DNF')
    expect(screen.getByTestId('confirm-time-value')).toHaveClass('is-dnf')
    expect(screen.getByTestId('confirm-time-secondary')).toHaveTextContent(
      'Raw 12.34',
    )
    expect(screen.getByTestId('confirm-time-dnf')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('saves a trimmed comment with the explicit action and with Enter', () => {
    const onSetComment = vi.fn().mockReturnValue(true)
    const onNotify = vi.fn()
    render(
      <ConfirmTimeTool
        solve={solve}
        number={1}
        onSetComment={onSetComment}
        onNotify={onNotify}
      />,
    )

    const save = screen.getByTestId('confirm-time-save-comment')
    expect(save).toBeDisabled()

    const input = screen.getByTestId('confirm-time-comment')
    fireEvent.change(input, { target: { value: '  New note  ' } })
    expect(save).toBeEnabled()
    fireEvent.click(save)

    expect(onSetComment).toHaveBeenCalledWith(solve.id, 'New note')
    expect(onNotify).toHaveBeenCalledWith('Solve comment saved')

    fireEvent.change(input, { target: { value: 'Enter note' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onSetComment).toHaveBeenLastCalledWith(solve.id, 'Enter note')
  })

  it('keeps the draft and does not claim success when the comment write fails', () => {
    const onSetComment = vi.fn().mockReturnValue(false)
    const onNotify = vi.fn()
    render(
      <ConfirmTimeTool
        solve={solve}
        number={1}
        onSetComment={onSetComment}
        onNotify={onNotify}
      />,
    )

    const input = screen.getByTestId('confirm-time-comment')
    fireEvent.change(input, { target: { value: 'Keep this draft' } })
    fireEvent.click(screen.getByTestId('confirm-time-save-comment'))

    expect(onSetComment).toHaveBeenCalledWith(solve.id, 'Keep this draft')
    expect(onNotify).toHaveBeenCalledWith('Could not save solve comment')
    expect(onNotify).not.toHaveBeenCalledWith('Solve comment saved')
    expect(input).toHaveValue('Keep this draft')
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The comment was not saved',
    )
  })

  it('resets the comment draft when the latest solve changes', () => {
    const { rerender } = render(
      <ConfirmTimeTool solve={solve} number={1} />,
    )
    const input = screen.getByTestId('confirm-time-comment')
    fireEvent.change(input, { target: { value: 'Draft' } })
    expect(input).toHaveValue('Draft')

    rerender(
      <ConfirmTimeTool
        solve={{ ...solve, id: 'solve-2', comment: 'Previous note' }}
        number={2}
      />,
    )
    expect(screen.getByTestId('confirm-time-comment')).toHaveValue(
      'Previous note',
    )
  })

  it('copies the solve and scramble through the clipboard helper', async () => {
    const onNotify = vi.fn()
    render(
      <ConfirmTimeTool solve={solve} number={1} onNotify={onNotify} />,
    )

    fireEvent.click(screen.getByTestId('confirm-time-copy-solve'))
    await waitFor(() =>
      expect(onNotify).toHaveBeenCalledWith('Solve copied to clipboard'),
    )
    expect(copyTextMock).toHaveBeenCalledWith(
      expect.stringContaining('12.34'),
    )
    expect(copyTextMock).toHaveBeenCalledWith(
      expect.stringContaining(solve.scramble),
    )

    fireEvent.click(screen.getByTestId('confirm-time-copy-scramble'))
    await waitFor(() =>
      expect(onNotify).toHaveBeenCalledWith('Scramble copied to clipboard'),
    )
    expect(copyTextMock).toHaveBeenLastCalledWith(solve.scramble)
  })

  it('reports a clipboard failure without throwing', async () => {
    copyTextMock.mockResolvedValue(false)
    const onNotify = vi.fn()
    render(
      <ConfirmTimeTool solve={solve} number={1} onNotify={onNotify} />,
    )

    fireEvent.click(screen.getByTestId('confirm-time-copy-solve'))
    await waitFor(() =>
      expect(onNotify).toHaveBeenCalledWith(
        'Could not copy to the clipboard',
      ),
    )
  })

  it('deletes the latest solve through the supplied handler', () => {
    const onDeleteSolve = vi.fn()
    render(
      <ConfirmTimeTool
        solve={solve}
        number={1}
        onDeleteSolve={onDeleteSolve}
      />,
    )

    const button = screen.getByTestId('confirm-time-delete')
    button.focus()
    expect(button).toHaveFocus()
    fireEvent.click(button)
    expect(onDeleteSolve).toHaveBeenCalledWith(solve.id)
    expect(button).not.toHaveFocus()
  })

  it('locks mutations while timing', () => {
    render(
      <ConfirmTimeTool
        solve={solve}
        number={1}
        disabled
        onSetPenalty={vi.fn()}
        onSetComment={vi.fn()}
        onDeleteSolve={vi.fn()}
      />,
    )

    expect(screen.getByTestId('confirm-time-ok')).toBeDisabled()
    expect(screen.getByTestId('confirm-time-plus-two')).toBeDisabled()
    expect(screen.getByTestId('confirm-time-dnf')).toBeDisabled()
    expect(screen.getByTestId('confirm-time-comment')).toBeDisabled()
    expect(screen.getByTestId('confirm-time-save-comment')).toBeDisabled()
    expect(screen.getByTestId('confirm-time-delete')).toBeDisabled()
    expect(
      screen.getByText('Result changes are locked while timing.'),
    ).toBeInTheDocument()
  })
})
