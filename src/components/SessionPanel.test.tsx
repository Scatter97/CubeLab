import { useState } from 'react'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
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
      onReorder={(id, targetIndex) =>
        setSessions((current) => {
          const index = current.findIndex((entry) => entry.id === id)
          if (index < 0) return current
          const next = [...current]
          const [entry] = next.splice(index, 1)
          if (!entry) return current
          const target = Math.max(0, Math.min(targetIndex, next.length))
          next.splice(target, 0, entry)
          return next
        })
      }
    />
  )
}

const ROW_HEIGHT = 40

function rect(top: number, height = 36): DOMRect {
  return {
    top,
    bottom: top + height,
    height,
    left: 0,
    right: 300,
    width: 300,
    x: 0,
    y: top,
    toJSON: () => ({}),
  }
}

function mockSessionRows(container: HTMLElement) {
  const list = container.querySelector<HTMLElement>('.session-picker-list')
  const panel = container.querySelector<HTMLElement>('.session-picker-panel')
  if (!list) return
  list.getBoundingClientRect = () => rect(0, 120)
  if (panel) {
    panel.getBoundingClientRect = () => rect(0, 200)
    Object.defineProperty(panel, 'scrollHeight', {
      configurable: true,
      value: 400,
    })
    Object.defineProperty(panel, 'clientHeight', {
      configurable: true,
      value: 200,
    })
  }
  container
    .querySelectorAll<HTMLElement>('.session-picker-row')
    .forEach((row, index) => {
      row.getBoundingClientRect = () => rect(index * ROW_HEIGHT)
    })
}

function mockScrollableSessionRows(container: HTMLElement) {
  const panel = container.querySelector<HTMLElement>('.session-picker-panel')
  const list = container.querySelector<HTMLElement>('.session-picker-list')
  if (!panel || !list) throw new Error('Session panel is not open')

  let scrollTop = 0
  Object.defineProperty(panel, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = value
    },
  })
  Object.defineProperty(panel, 'scrollHeight', {
    configurable: true,
    value: 1_200,
  })
  Object.defineProperty(panel, 'clientHeight', {
    configurable: true,
    value: 200,
  })
  panel.getBoundingClientRect = () => rect(0, 200)
  list.getBoundingClientRect = () => rect(-scrollTop, 1_200)

  const rows = () =>
    Array.from(container.querySelectorAll<HTMLElement>('.session-picker-row'))
  for (const row of rows()) {
    row.getBoundingClientRect = () => {
      const index = rows().indexOf(row)
      return rect(index * ROW_HEIGHT - scrollTop)
    }
  }

  return {
    panel,
    scrollTop: () => scrollTop,
    setScrollTop: (value: number) => {
      scrollTop = value
    },
  }
}

function dragHandle(handle: HTMLElement, fromY: number, toY: number) {
  fireEvent.pointerDown(handle, {
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
    clientX: 10,
    clientY: fromY,
  })
  fireEvent.pointerMove(handle, {
    pointerId: 1,
    isPrimary: true,
    clientX: 10,
    clientY: toY,
  })
  fireEvent.pointerUp(handle, {
    pointerId: 1,
    isPrimary: true,
    clientX: 10,
    clientY: toY,
  })
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

  it('drags a session upward without changing the active session', () => {
    const { container } = render(<Harness />)
    const trigger = screen.getByTestId('session-select')
    fireEvent.click(trigger)
    mockSessionRows(container)

    const handle = screen.getByTestId('session-drag-handle-b')
    fireEvent.pointerDown(handle, {
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      clientX: 10,
      clientY: 58,
    })
    fireEvent.pointerMove(handle, {
      pointerId: 1,
      isPrimary: true,
      clientX: 10,
      clientY: 4,
    })

    expect(
      screen.getByTestId('session-drop-indicator'),
    ).toBeInTheDocument()
    expect(
      container.querySelector('[data-session-id="b"]'),
    ).toHaveClass('is-dragging')
    expect(trigger).toHaveTextContent('Morning')

    fireEvent.pointerUp(handle, {
      pointerId: 1,
      isPrimary: true,
      clientX: 10,
      clientY: 4,
    })

    const rows = container.querySelectorAll('.session-picker-row')
    expect(rows[0]).toHaveTextContent('Evening')
    expect(rows[1]).toHaveTextContent('Morning')
    expect(trigger).toHaveTextContent('Morning')
    expect(screen.getByTestId('session-option-a')).toHaveAttribute(
      'aria-current',
      'true',
    )
    expect(handle).toHaveFocus()
    expect(screen.getByRole('status')).toHaveTextContent(
      'Evening moved to position 1 of 3.',
    )
  })

  it('drags a session downward without selecting it', () => {
    const { container } = render(<Harness />)
    const trigger = screen.getByTestId('session-select')
    fireEvent.click(trigger)
    mockSessionRows(container)

    dragHandle(screen.getByTestId('session-drag-handle-a'), 18, 110)

    const rows = container.querySelectorAll('.session-picker-row')
    expect(rows[0]).toHaveTextContent('Evening')
    expect(rows[1]).toHaveTextContent('Empty')
    expect(rows[2]).toHaveTextContent('Morning')
    expect(trigger).toHaveTextContent('Morning')
    expect(screen.getByTestId('session-option-a')).toHaveAttribute(
      'aria-current',
      'true',
    )
    expect(screen.getByRole('group', { name: 'Session list' })).toBeVisible()
  })

  it('does not reorder or select when a drag handle is pressed and released', () => {
    const { container } = render(<Harness />)
    const trigger = screen.getByTestId('session-select')
    fireEvent.click(trigger)
    mockSessionRows(container)

    const handle = screen.getByTestId('session-drag-handle-b')
    fireEvent.pointerDown(handle, {
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      clientX: 10,
      clientY: 58,
    })
    fireEvent.pointerUp(handle, {
      pointerId: 1,
      isPrimary: true,
      clientX: 10,
      clientY: 58,
    })

    const rows = container.querySelectorAll('.session-picker-row')
    expect(rows[0]).toHaveTextContent('Morning')
    expect(rows[1]).toHaveTextContent('Evening')
    expect(trigger).toHaveTextContent('Morning')
    expect(screen.getByRole('group', { name: 'Session list' })).toBeVisible()
  })

  it('reorders from a focused drag handle with arrow keys', () => {
    const { container } = render(<Harness />)
    const trigger = screen.getByTestId('session-select')
    fireEvent.click(trigger)

    const handle = screen.getByTestId('session-drag-handle-b')
    handle.focus()
    fireEvent.keyDown(handle, { key: 'ArrowUp' })

    const rows = container.querySelectorAll('.session-picker-row')
    expect(rows[0]).toHaveTextContent('Evening')
    expect(rows[1]).toHaveTextContent('Morning')
    expect(trigger).toHaveTextContent('Morning')
    expect(handle).toHaveFocus()
    expect(screen.getByRole('status')).toHaveTextContent(
      'Evening moved up to position 1 of 3.',
    )
  })

  it('scrolls a keyboard-moved row into view in a long list', async () => {
    const many = Array.from({ length: 30 }, (_, index) =>
      session(`s${index}`, `Session ${index + 1}`),
    )
    const { container } = render(<Harness initial={many} />)
    const trigger = screen.getByTestId('session-select')
    fireEvent.click(trigger)
    const mock = mockScrollableSessionRows(container)
    await waitFor(() =>
      expect(screen.getByTestId('session-option-s0')).toHaveFocus(),
    )

    const handle = screen.getByTestId('session-drag-handle-s0')
    handle.focus()
    for (let index = 0; index < 12; index += 1) {
      fireEvent.keyDown(handle, { key: 'ArrowDown' })
    }
    await waitFor(() => expect(mock.scrollTop()).toBeGreaterThan(0))
    expect(trigger).toHaveTextContent('Session 1')
    expect(handle).toHaveFocus()

    for (let index = 0; index < 12; index += 1) {
      fireEvent.keyDown(handle, { key: 'ArrowUp' })
    }
    await waitFor(() => expect(mock.scrollTop()).toBe(0))
    const rows = container.querySelectorAll('.session-picker-row')
    expect(rows[0]).toHaveTextContent('Session 1')
    expect(trigger).toHaveTextContent('Session 1')
    expect(screen.getByTestId('session-option-s0')).toHaveAttribute(
      'aria-current',
      'true',
    )
  })

  it('recalculates the drop position when the list scrolls under a stationary pointer', () => {
    const initial = [
      session('a', 'Morning'),
      session('b', 'Evening'),
      session('c', 'Empty'),
      session('d', 'Night'),
    ]
    const { container } = render(<Harness initial={initial} />)
    const trigger = screen.getByTestId('session-select')
    fireEvent.click(trigger)
    const mock = mockScrollableSessionRows(container)

    const handle = screen.getByTestId('session-drag-handle-b')
    fireEvent.pointerDown(handle, {
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      clientX: 10,
      clientY: 100,
    })
    fireEvent.pointerMove(handle, {
      pointerId: 1,
      isPrimary: true,
      clientX: 10,
      clientY: 110,
    })
    expect(screen.getByTestId('session-drop-indicator')).toHaveStyle({
      top: '120px',
    })

    mock.setScrollTop(60)
    fireEvent.scroll(mock.panel)
    expect(screen.getByTestId('session-drop-indicator')).toHaveStyle({
      top: '156px',
    })

    fireEvent.pointerUp(handle, {
      pointerId: 1,
      isPrimary: true,
      clientX: 10,
      clientY: 110,
    })
    const rows = container.querySelectorAll('.session-picker-row')
    expect(rows[0]).toHaveTextContent('Morning')
    expect(rows[1]).toHaveTextContent('Empty')
    expect(rows[2]).toHaveTextContent('Night')
    expect(rows[3]).toHaveTextContent('Evening')
    expect(trigger).toHaveTextContent('Morning')
    expect(screen.getByTestId('session-option-a')).toHaveAttribute(
      'aria-current',
      'true',
    )
  })

  it('refreshes the drop position on release after a manual scroll', () => {
    const initial = [
      session('a', 'Morning'),
      session('b', 'Evening'),
      session('c', 'Empty'),
      session('d', 'Night'),
    ]
    const { container } = render(<Harness initial={initial} />)
    const trigger = screen.getByTestId('session-select')
    fireEvent.click(trigger)
    const mock = mockScrollableSessionRows(container)

    const handle = screen.getByTestId('session-drag-handle-b')
    fireEvent.pointerDown(handle, {
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      clientX: 10,
      clientY: 100,
    })
    fireEvent.pointerMove(handle, {
      pointerId: 1,
      isPrimary: true,
      clientX: 10,
      clientY: 110,
    })

    // Simulate a scroll that did not dispatch a scroll event before release.
    mock.setScrollTop(60)
    fireEvent.pointerUp(handle, {
      pointerId: 1,
      isPrimary: true,
      clientX: 10,
      clientY: 110,
    })

    const rows = container.querySelectorAll('.session-picker-row')
    expect(rows[0]).toHaveTextContent('Morning')
    expect(rows[1]).toHaveTextContent('Empty')
    expect(rows[2]).toHaveTextContent('Night')
    expect(rows[3]).toHaveTextContent('Evening')
    expect(trigger).toHaveTextContent('Morning')
  })

  it('keeps long session lists scrollable with a handle on every row', () => {
    const many = Array.from({ length: 30 }, (_, index) =>
      session(`s${index}`, `Session ${index + 1}`),
    )
    const { container } = render(<Harness initial={many} />)
    fireEvent.click(screen.getByTestId('session-select'))

    const panel = screen.getByRole('group', { name: 'Session list' })
    expect(panel).toHaveClass('session-picker-panel')
    expect(panel).toHaveStyle({ maxHeight: '430px' })
    expect(container.querySelectorAll('.session-drag-handle')).toHaveLength(30)
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
