import { describe, expect, it } from 'vitest'
import type { Session, SessionsData } from '../types'
import {
  SESSIONS_VERSION,
  parseSessionsData,
  serializeSessionsData,
} from './storage'
import { getSessionStats } from './stats'
import { DEFAULT_AVERAGE_TRIMMING } from './averageTrimming'
import { filterAnalyticsSolves, buildAnalyticsTrend } from './analytics'
import { getCompetitionRounds } from './competition'

const TOTAL_SOLVES = 100_000
const SESSION_COUNT = 100
const PER_SESSION = TOTAL_SOLVES / SESSION_COUNT
const NOW = Date.UTC(2026, 10, 21, 12)

function solve(index: number, sessionIndex: number) {
  return {
    id: `solve-${sessionIndex}-${index}`,
    event: '333' as const,
    rawMs: 8_000 + ((index * 37 + sessionIndex * 11) % 12_000),
    penalty: index % 97 === 0 ? ('dnf' as const) : index % 41 === 0 ? ('+2' as const) : ('none' as const),
    scramble: "R U R' U' F2 D L2 B' R2 U2",
    comment: '',
    createdAt: NOW - (TOTAL_SOLVES - (sessionIndex * PER_SESSION + index)) * 1_000,
    updatedAt: NOW,
  }
}

function sessionsFixture(): SessionsData {
  const sessions: Session[] = Array.from({ length: SESSION_COUNT }, (_, sessionIndex) => ({
    id: `session-${sessionIndex}`,
    name: `Session ${sessionIndex + 1}`,
    event: '333',
    createdAt: NOW - 200_000_000,
    updatedAt: NOW,
    solves: Array.from({ length: PER_SESSION }, (_, index) =>
      solve(index, sessionIndex),
    ).toReversed(),
  }))
  return {
    activeSessionId: sessions[0]!.id,
    sessions,
    sessionOrder: {
      ids: sessions.map((session) => session.id),
      updatedAt: NOW,
      editorId: 'large-history-test',
    },
  }
}

function timed<T>(label: string, run: () => T): T {
  const start = performance.now()
  const result = run()
  const elapsed = performance.now() - start
  // Visible in verbose test output; these are observations, not thresholds.
  console.info(`[large-history] ${label}: ${elapsed.toFixed(1)} ms`)
  return result
}

describe('100k solves and 100 sessions', () => {
  it('serializes, validates and reloads a 100-session, 100,000-solve collection', () => {
    const data = sessionsFixture()
    expect(data.sessions).toHaveLength(SESSION_COUNT)
    expect(
      data.sessions.reduce((total, session) => total + session.solves.length, 0),
    ).toBe(TOTAL_SOLVES)

    const raw = timed('serialize 100k', () => serializeSessionsData(data))
    expect(raw.length).toBeGreaterThan(1_000_000)
    const parsed = timed('parse 100k', () =>
      parseSessionsData(JSON.parse(raw)),
    )
    expect(parsed).not.toBeNull()
    expect(parsed!.sessions).toHaveLength(SESSION_COUNT)
    expect(
      parsed!.sessions.reduce(
        (total, session) => total + session.solves.length,
        0,
      ),
    ).toBe(TOTAL_SOLVES)
    expect(JSON.parse(raw).version).toBe(SESSIONS_VERSION)
  })

  it('calculates large-window statistics over 100,000 solves', () => {
    const data = sessionsFixture()
    const solves = data.sessions.flatMap((session) => session.solves)
    expect(solves).toHaveLength(TOTAL_SOLVES)
    const stats = timed('session stats 100k', () =>
      getSessionStats(solves, [5, 12, 100, 1000, 10_000], {
        better: 'p5',
        worse: 'auto',
      }),
    )
    expect(stats.count).toBe(TOTAL_SOLVES)
    expect(stats.single.best).not.toBeNull()
    expect(stats.averages.get(10_000)?.latest).not.toBeUndefined()
    expect(DEFAULT_AVERAGE_TRIMMING.better).toBe('p5')
  })

  it('filters and builds an Analytics trend across 100,000 solves', () => {
    const data = sessionsFixture()
    const filters = {
      event: 'all' as const,
      sessionKind: 'all' as const,
      sessionIds: null,
      datePreset: 'all' as const,
      customStart: '',
      customEnd: '',
      solveLimit: null,
      penalty: 'all' as const,
    }
    const filtered = timed('analytics filter 100k', () =>
      filterAnalyticsSolves(data.sessions, filters, NOW + 1),
    )
    expect(filtered).toHaveLength(TOTAL_SOLVES)
    const trend = timed('analytics trend 100k', () =>
      buildAnalyticsTrend(filtered, [5, 12, 100, 1000], {
        better: 'p5',
        worse: 'auto',
      }),
    )
    expect(trend.solves.length).toBe(TOTAL_SOLVES)
  })

  it('derives competition rounds from a large competition history', () => {
    const solves = Array.from({ length: 10_000 }, (_, index) => ({
      ...solve(index, 0),
      roundId: `round-${Math.floor(index / 5)}`,
      roundIndex: index % 5,
    }))
    const rounds = timed('competition rounds 10k', () =>
      getCompetitionRounds(solves, { type: 'ao', size: 5 }, {
        better: 'p5',
        worse: 'auto',
      }),
    )
    expect(rounds).toHaveLength(2_000)
    expect(rounds[0]!.complete).toBe(true)
    expect(rounds[0]!.result?.status).toBe('value')
  })
})
