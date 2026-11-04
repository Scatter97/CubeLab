import { useState } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionPanel } from './SessionPanel'
import type { Session } from '../types'

const NOW = new Date(2026, 10, 3, 12).getTime()

function session(id: string, name: string, solves = 0): Session {
  return {
    id,
    name,
    event: '333',
    createdAt: NOW - 10_000,
    updatedAt: NOW,
    solves: Array.from({ length: solves }, (_, index) => ({
      id: `${id}-${index}`,
      event: '333' as const,
      rawMs: 10_000,
      penalty: 'none' as const,
      scramble: 'R U',
      comment: '',
      createdAt: NOW - index,
    })),
  }
}

function Harness({
  initial = [session('a', 'Morning', 3), session('b', 'Evening', 2), session('c', 'Empty')],
  locked = false,
}: {
  initial?: Session[]
  locked?: boolean
}) {
  const [sessions, setSessions] = useState(initial)
  const [activeId, setActiveId] = useState(initial[0]!.id)
  return (
    <SessionPanel
      sessions={sessions}
      activeSessionId={activeId}
      locked={locked}
      onSelect={(id) => setActiveId(id)}
      onRename={() => true}
      onOpenSessionSettings={() => undefined}
      onMove={(id, direction) =>
        setSessions((current) => {
          const index = current.findIndex((entry) => entry.id === id)
          const target = index + direction
          if (index < 0 || target < 0 || target >= current.length) return current
          const next = [...current]
          const [entry] = next.splice(index, 1)
          if (entry) next.splice(target, 0, entry)
          return next
        })
      }
    />
  )
}

afterEach(cleanup)

describe('SessionPanel selector', () => {
  it('selects a session from the dropdown and restores trigger focus', () => {
    render(<Harness />)
    const trigger = screen.getByTestId('session-select')
    expect(trigger).toHaveTextContent('Morning')
    trigger.focus()
    fireEvent.click(trigger)
    const panel = screen.getByRole('group', { name: 'Session list' })
    expect(within(panel).getByTestId('session-option-a')).toHaveAttribute(
      'aria-current',
      'true',
    )
    fireEvent.click(within(panel).getByTestId('session-option-b'))
    expect(screen.queryByRole('group', { name: 'Session list' })).toBeNull()
    expect(trigger).toHaveTextContent('Evening')
    expect(trigger).toHaveFocus()
  })

  it('reorders without changing the active session and keeps focus', () => {
    render(<Harness />)
    const trigger = screen.getByTestId('session-select')
    fireEvent.click(trigger)
    const moveUp = screen.getByTestId('session-move-up-b')
    moveUp.focus()
    fireEvent.click(moveUp)
    expect(trigger).toHaveTextContent('Morning')
    expect(
      screen.getByRole('group', { name: 'Session list' }),
    ).toBeInTheDocument()
    const rows = screen
      .getByRole('group', { name: 'Session list' })
      .querySelectorAll('.session-picker-row')
    expect(rows[0]).toHaveTextContent('Evening')
    expect(rows[1]).toHaveTextContent('Morning')
    expect(screen.getByTestId('session-move-up-b')).toHaveFocus()
    expect(screen.getByTestId('session-move-up-b')).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })

  it('closes on Escape and outside presses, and stays locked during timing', () => {
    const { rerender } = render(<Harness />)
    const trigger = screen.getByTestId('session-select')
    trigger.focus()
    fireEvent.click(trigger)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('group', { name: 'Session list' })).toBeNull()
    expect(trigger).toHaveFocus()

    fireEvent.click(trigger)
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('group', { name: 'Session list' })).toBeNull()

    rerender(<Harness locked />)
    expect(screen.getByTestId('session-select')).toBeDisabled()
    fireEvent.click(screen.getByTestId('session-select'))
    expect(screen.queryByRole('group', { name: 'Session list' })).toBeNull()
  })

  it('keeps long names readable instead of truncating the selector rows', () => {
    render(
      <Harness
        initial={[
          session(
            'a',
            'Very long practice session name that must remain available',
          ),
        ]}
      />,
    )
    fireEvent.click(screen.getByTestId('session-select'))
    expect(
      screen.getByRole('button', {
        name: 'Select session Very long practice session name that must remain available',
      }),
    ).toBeVisible()
  })
})
