import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CompetitionFormat, Solve } from '../../types'
import { getCompetitionRounds } from '../../lib/competition'
import { CompetitionRounds } from './CompetitionRounds'
import { RoundSummaryDialog } from './RoundSummaryDialog'
import { SolveHistory } from '../SolveHistory'

const BASE = 1_700_000_000_000

function solve(
  id: string,
  rawMs: number,
  roundId: string,
  roundIndex: number,
  penalty: Solve['penalty'] = 'none',
  base = BASE,
): Solve {
  return {
    id,
    event: '333',
    rawMs,
    penalty,
    scramble: `Scramble ${id}`,
    comment: '',
    createdAt: base + roundIndex * 1_000,
    roundId,
    roundIndex,
  }
}

const format: CompetitionFormat = { type: 'ao', size: 5 }

const firstRound = [0, 1, 2, 3, 4].map((index) =>
  solve(`first-${index}`, 10_000 + index * 100, 'first', index),
)
const bestRound = [0, 1, 2, 3, 4].map((index) =>
  solve(`best-${index}`, 9_000, 'best', index, 'none', BASE + 100_000),
)
const dnfRound = [0, 1, 2, 3, 4].map((index) =>
  solve(
    `dnf-${index}`,
    8_000,
    'dnf',
    index,
    index < 2 ? 'dnf' : 'none',
    BASE + 200_000,
  ),
)

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

describe('competition round presentation', () => {
  it('labels latest, best and DNF rounds and marks incomplete rounds', () => {
    const incomplete = [0, 1, 2, 3].map((index) =>
      solve(
        `incomplete-${index}`,
        11_000 + index * 100,
        'incomplete',
        index,
        'none',
        BASE + 300_000,
      ),
    )
    const rounds = getCompetitionRounds(
      [...firstRound, ...bestRound, ...dnfRound, ...incomplete],
      format,
    )
    render(
      <CompetitionRounds
        format={format}
        rounds={rounds}
        precision="centiseconds"
      />,
    )
    const list = screen.getByTestId('competition-round-list')
    expect(list).toHaveTextContent('4 rounds')
    expect(screen.getByTestId('competition-stat-round-2')).toHaveTextContent('Best')
    expect(screen.getByTestId('competition-stat-round-3')).toHaveTextContent('DNF')
    expect(screen.getByTestId('competition-stat-round-4')).toHaveTextContent(
      'Incomplete · 4/5',
    )
  })

  it('shows attempt trimming and the session best in the summary dialog', () => {
    const rounds = getCompetitionRounds(
      [...firstRound, ...bestRound, ...dnfRound],
      format,
    )
    const dnf = rounds.find((round) => round.id === 'dnf')!
    render(
      <RoundSummaryDialog
        round={dnf}
        rounds={rounds}
        format={format}
        precision="centiseconds"
        onClose={vi.fn()}
      />,
    )
    const dialog = screen.getByTestId('competition-round-summary')
    expect(dialog).toHaveTextContent('Round 3')
    expect(dialog).toHaveTextContent('DNF')
    expect(within(dialog).getByTestId('competition-summary-attempt-1')).toHaveTextContent(
      'Trimmed worst',
    )
    expect(dialog).toHaveTextContent('Session best · Round 2')
  })

  it('groups attempts under expandable round headers', () => {
    const rounds = getCompetitionRounds(
      firstRound.filter((entry) => entry.id !== 'first-2'),
      format,
    )
    render(
      <SolveHistory
        solves={firstRound
          .filter((entry) => entry.id !== 'first-2')
          .reverse()}
        competition={{ format, rounds }}
        onSetPenalty={vi.fn()}
        onDelete={vi.fn()}
        onSetComment={vi.fn()}
        onNotify={vi.fn()}
      />,
    )
    const header = screen.getByTestId('competition-round-header-1')
    expect(header).toHaveTextContent('Round 1')
    expect(header).toHaveTextContent('Incomplete · 4/5')
    expect(header.querySelector('button')).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getAllByTestId('history-row')).toHaveLength(4)

    fireEvent.click(within(header).getByRole('button'))
    expect(header.querySelector('button')).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryAllByTestId('history-row')).toHaveLength(0)
  })
})
