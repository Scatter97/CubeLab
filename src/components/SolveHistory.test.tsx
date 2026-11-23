import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Solve } from '../types'
import { SolveHistory } from './SolveHistory'

const solve: Solve = {
  id: 'solve-a',
  event: '333',
  rawMs: 12_340,
  penalty: 'none',
  scramble: "R U R' U' F2 D L2 B' R2 U2",
  comment: '',
  createdAt: 1_700_000_000_000,
}

function renderHistory(onSetComment: (id: string, comment: string) => boolean) {
  const onNotify = vi.fn()
  render(
    <SolveHistory
      solves={[solve]}
      onSetPenalty={vi.fn()}
      onDelete={vi.fn()}
      onSetComment={onSetComment}
      onNotify={onNotify}
    />,
  )
  fireEvent.click(screen.getByTestId('history-main'))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Add comment' }))
  const input = screen.getByRole('textbox', { name: 'Solve comment' })
  fireEvent.change(input, { target: { value: '  Draft note  ' } })
  return { input, onNotify }
}

describe('SolveHistory comment editing', () => {
  afterEach(cleanup)

  it('closes the editor and reports success after the comment is saved', () => {
    const onSetComment = vi.fn().mockReturnValue(true)
    const { onNotify } = renderHistory(onSetComment)

    fireEvent.click(screen.getByRole('button', { name: 'Save comment' }))

    expect(onSetComment).toHaveBeenCalledWith('solve-a', 'Draft note')
    expect(onNotify).toHaveBeenCalledWith('Solve comment saved')
    expect(
      screen.queryByRole('textbox', { name: 'Solve comment' }),
    ).not.toBeInTheDocument()
  })

  it('keeps the draft and editor open when the comment is not durable', () => {
    const onSetComment = vi.fn().mockReturnValue(false)
    const { input, onNotify } = renderHistory(onSetComment)

    fireEvent.click(screen.getByRole('button', { name: 'Save comment' }))

    expect(onSetComment).toHaveBeenCalledWith('solve-a', 'Draft note')
    expect(onNotify).toHaveBeenCalledWith('Could not save solve comment')
    expect(onNotify).not.toHaveBeenCalledWith('Solve comment saved')
    expect(input).toHaveValue('  Draft note  ')
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The comment was not saved',
    )
    expect(
      screen.getByRole('textbox', { name: 'Solve comment' }),
    ).toBeInTheDocument()
  })
})
