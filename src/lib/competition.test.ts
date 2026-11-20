import { describe, expect, it } from 'vitest'
import type { Session, Solve } from '../types'
import {
  assignRoundMembership,
  competitionFormatLabel,
  defaultCompetitionFormat,
  getCompetitionFormatById,
  getCompetitionRounds,
  getCompetitionRoundSummary,
  isCompetitionFormat,
  normalizeRoundMembership,
  stripRoundMembership,
} from './competition'
import type { CompetitionFormat } from '../types'

const CREATE_AT = 1_700_000_000_000

function solve(overrides: Partial<Solve> = {}): Solve {
  return {
    id: 'solve-1',
    event: '333',
    rawMs: 10_000,
    penalty: 'none',
    scramble: "R U R' U'",
    comment: '',
    createdAt: CREATE_AT,
    ...overrides,
  }
}

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    name: 'Competition',
    event: '333',
    kind: 'competition',
    competitionFormat: { type: 'ao', size: 5 },
    createdAt: CREATE_AT,
    updatedAt: CREATE_AT,
    solves: [],
    ...overrides,
  }
}

function roundSolves(
  roundId: string,
  times: readonly number[],
  options: {
    base?: number
    penalties?: readonly Solve['penalty'][]
  } = {},
): Solve[] {
  const base = options.base ?? CREATE_AT
  return times.map((time, index) =>
    solve({
      id: `${roundId}-${index}`,
      rawMs: time,
      penalty: options.penalties?.[index] ?? 'none',
      createdAt: base + index * 1_000,
      roundId,
      roundIndex: index,
    }),
  )
}

function newestFirst(solves: readonly Solve[]): Solve[] {
  return [...solves].sort(
    (left, right) =>
      right.createdAt - left.createdAt || right.id.localeCompare(left.id),
  )
}

describe('competition formats', () => {
  it('uses mo3 by default for 6x6 and 7x7 and ao5 for every other event', () => {
    expect(defaultCompetitionFormat('666')).toEqual({ type: 'mo', size: 3 })
    expect(defaultCompetitionFormat('777')).toEqual({ type: 'mo', size: 3 })
    for (const event of ['333', '222', '444', '555', 'pyram', 'custom:fto']) {
      expect(defaultCompetitionFormat(event)).toEqual({ type: 'ao', size: 5 })
    }
  })

  it('validates only the five approved format combinations', () => {
    expect(competitionFormatLabel({ type: 'ao', size: 5 })).toBe('ao5')
    expect(competitionFormatLabel({ type: 'ao', size: 12 })).toBe('ao12')
    expect(competitionFormatLabel({ type: 'ao', size: 50 })).toBe('ao50')
    expect(competitionFormatLabel({ type: 'mo', size: 3 })).toBe('mo3')
    expect(competitionFormatLabel({ type: 'bo', size: 3 })).toBe('bo3')

    expect(isCompetitionFormat({ type: 'ao', size: 5 })).toBe(true)
    expect(isCompetitionFormat({ type: 'ao', size: 3 })).toBe(false)
    expect(isCompetitionFormat({ type: 'mo', size: 5 })).toBe(false)
    expect(isCompetitionFormat({ type: 'bo', size: 12 })).toBe(false)
    expect(isCompetitionFormat(null)).toBe(false)
    expect(getCompetitionFormatById('ao12')).toEqual({ type: 'ao', size: 12 })
    expect(getCompetitionFormatById('nope')).toBeNull()
  })
})

describe('round assignment', () => {
  it('starts a round for the first solve and fills it in order', () => {
    const first = assignRoundMembership(
      [solve({ id: 'a', createdAt: CREATE_AT })],
      session(),
      { type: 'ao', size: 5 },
    )
    expect(first[0]?.roundId).toBeTruthy()
    expect(first[0]?.roundIndex).toBe(0)

    const existing = session({ solves: first })
    const second = assignRoundMembership(
      [solve({ id: 'b', createdAt: CREATE_AT + 1_000 })],
      existing,
      { type: 'ao', size: 5 },
    )
    expect(second[0]?.roundId).toBe(first[0]?.roundId)
    expect(second[0]?.roundIndex).toBe(1)
  })

  it('spills into a new round when the newest round is full', () => {
    const existing = newestFirst(roundSolves('round-1', [10, 11, 12, 13, 14]))
    const assigned = assignRoundMembership(
      [solve({ id: 'next', createdAt: CREATE_AT + 10_000 })],
      session({ solves: existing }),
      { type: 'ao', size: 5 },
    )
    expect(assigned[0]?.roundId).not.toBe('round-1')
    expect(assigned[0]?.roundIndex).toBe(0)
  })

  it('discards foreign round fields before assigning chronological membership', () => {
    const incoming = [
      solve({
        id: 'later',
        createdAt: CREATE_AT + 3_000,
        roundId: 'foreign',
        roundIndex: 9,
      }),
      solve({
        id: 'earlier',
        createdAt: CREATE_AT + 1_000,
        roundId: 'foreign',
        roundIndex: 8,
      }),
    ]
    const assigned = assignRoundMembership(
      incoming,
      session({ solves: newestFirst(roundSolves('round-1', [9, 8])) }),
      { type: 'ao', size: 5 },
    )
    expect(assigned.map((entry) => entry.id)).toEqual(['later', 'earlier'])
    expect(assigned[0]?.roundId).toBe('round-1')
    expect(assigned[1]?.roundId).toBe('round-1')
    expect(assigned.find((entry) => entry.id === 'earlier')?.roundIndex).toBe(2)
    expect(assigned.find((entry) => entry.id === 'later')?.roundIndex).toBe(3)
  })

  it('keeps incomplete rounds open and continues their next index', () => {
    const existing = newestFirst(roundSolves('round-1', [10, 11]))
    const assigned = assignRoundMembership(
      [solve({ id: 'next', createdAt: CREATE_AT + 5_000 })],
      session({ solves: existing }),
      { type: 'ao', size: 5 },
    )
    expect(assigned[0]).toMatchObject({ roundId: 'round-1', roundIndex: 2 })
  })

  it('strips round fields without mutating the input', () => {
    const original = roundSolves('round-1', [10, 11])[0]!
    const stripped = stripRoundMembership([original])[0]!
    expect(stripped).not.toHaveProperty('roundId')
    expect(stripped).not.toHaveProperty('roundIndex')
    expect(original.roundId).toBe('round-1')
  })
})

describe('round grouping and results', () => {
  const format: CompetitionFormat = { type: 'ao', size: 5 }

  it('groups, orders and numbers rounds from chronology without a stored counter', () => {
    const older = roundSolves('older', [10, 11, 12, 13, 14], {
      base: CREATE_AT,
    })
    const newer = roundSolves('newer', [9_000, 9_000, 9_000, 9_000, 9_000], {
      base: CREATE_AT + 100_000,
    })
    const rounds = getCompetitionRounds(newestFirst([...older, ...newer]), format)
    expect(rounds.map((round) => round.id)).toEqual(['older', 'newer'])
    expect(rounds.map((round) => round.number)).toEqual([1, 2])
    expect(rounds[0]?.complete).toBe(true)
    expect(rounds[1]?.result).toEqual({ status: 'value', ms: 9_000 })
  })

  it('uses the shared trimming rules with DNFs as worst results', () => {
    const fourFastOneDnf = roundSolves(
      'round-1',
      [10_000, 11_000, 12_000, 13_000, 99_000],
      { penalties: ['none', 'none', 'none', 'none', 'dnf'] },
    )
    const [round] = getCompetitionRounds(newestFirst(fourFastOneDnf), format)
    expect(round?.result).toEqual({ status: 'value', ms: 12_000 })
    expect(round?.attempts.find((attempt) => attempt.solve.penalty === 'dnf')?.trimmed).toBe('worse')

    const twoDnfs = roundSolves(
      'round-2',
      [10_000, 11_000, 12_000, 13_000, 14_000],
      { penalties: ['none', 'none', 'none', 'dnf', 'dnf'] },
    )
    expect(getCompetitionRounds(newestFirst(twoDnfs), format)[0]?.result).toEqual({
      status: 'dnf',
    })
  })

  it('keeps mo3 untrimmed and makes bo3 the best attempt', () => {
    const mo = roundSolves('mo', [10_000, 12_000, 14_000])
    const moRound = getCompetitionRounds(newestFirst(mo), {
      type: 'mo',
      size: 3,
    })[0]
    expect(moRound?.result).toEqual({ status: 'value', ms: 12_000 })
    expect(moRound?.attempts.every((attempt) => attempt.trimmed === null)).toBe(true)

    const bo = roundSolves(
      'bo',
      [10_000, 9_000, 11_000],
      { penalties: ['none', '+2', 'none'] },
    )
    const boRound = getCompetitionRounds(newestFirst(bo), {
      type: 'bo',
      size: 3,
    })[0]
    expect(boRound?.result).toEqual({ status: 'value', ms: 10_000 })
    expect(boRound?.attempts.find((attempt) => attempt.solve.id === 'bo-0')?.best).toBe(true)
  })

  it('marks rounds incomplete after one attempt is deleted and removes empty rounds', () => {
    const solves = roundSolves('round-1', [10, 11, 12, 13, 14])
    const withoutOne = solves.filter((entry) => entry.id !== 'round-1-2')
    const [round] = getCompetitionRounds(newestFirst(withoutOne), format)
    expect(round).toMatchObject({ attemptCount: 4, complete: false, result: null })

    expect(getCompetitionRounds([], format)).toEqual([])
  })

  it('reports latest, best and DNF rounds for the statistics list', () => {
    const first = roundSolves('first', [10, 10, 10, 10, 10], { base: CREATE_AT })
    const best = roundSolves('best', [9, 9, 9, 9, 9], {
      base: CREATE_AT + 100_000,
    })
    const dnf = roundSolves('dnf', [8, 8, 8, 8, 8], {
      base: CREATE_AT + 200_000,
      penalties: ['dnf', 'dnf', 'none', 'none', 'none'],
    })
    const rounds = getCompetitionRounds(
      newestFirst([...first, ...best, ...dnf]),
      format,
    )
    const summary = getCompetitionRoundSummary(rounds)
    expect(summary.latest?.id).toBe('dnf')
    expect(summary.best?.id).toBe('best')
    expect(summary.dnfRounds.map((round) => round.id)).toEqual(['dnf'])
  })

  it('flattens practice sessions and repairs missing competition membership', () => {
    const practice = normalizeRoundMembership(
      session({
        kind: undefined,
        competitionFormat: undefined,
        solves: roundSolves('foreign', [10, 11]),
      }),
    )
    expect(practice.kind).toBeUndefined()
    expect(practice.solves.every((entry) => entry.roundId === undefined)).toBe(true)

    const unassigned = [
      solve({ id: 'a', createdAt: CREATE_AT + 1_000 }),
      solve({ id: 'b', createdAt: CREATE_AT + 2_000 }),
    ]
    const competition = normalizeRoundMembership(
      session({ kind: 'competition', competitionFormat: format, solves: unassigned }),
    )
    const first = competition.solves.find((entry) => entry.id === 'a')
    const second = competition.solves.find((entry) => entry.id === 'b')
    expect(first?.roundId).toBeTruthy()
    expect(first?.roundIndex).toBe(0)
    expect(second?.roundId).toBe(first?.roundId)
    expect(second?.roundIndex).toBe(1)
  })
})
