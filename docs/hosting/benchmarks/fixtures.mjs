/**
 * Deterministic synthetic CubeLab history fixtures for bandwidth benchmarks.
 *
 * These records use the same persisted shape as `src/lib/storage.ts`
 * (sessions schema v7). They never touch a real browser profile, Google Drive
 * or existing user history.
 */

const FACE_MOVES = ['R', 'U', "R'", "U'", 'F', "F'", 'L', "L'", 'D', "D'", 'B', "B'"]
export const ONBOARDING_COMPLETED = JSON.stringify({
  version: 1,
  decision: { status: 'completed', at: 1 },
})

function scramble(index) {
  const tokens = []
  for (let step = 0; step < 20; step += 1) {
    tokens.push(FACE_MOVES[(index * 7 + step * 5) % FACE_MOVES.length])
  }
  return tokens.join(' ')
}

function solve(id, index, createdAt) {
  const penalty = index % 211 === 0 ? 'dnf' : index % 97 === 0 ? '+2' : 'none'
  return {
    id,
    event: '333',
    rawMs: 8_000 + ((index * 137) % 12_000),
    penalty,
    scramble: scramble(index),
    comment: index % 50 === 0 ? 'Synthetic benchmark solve' : '',
    createdAt,
  }
}

function splitCounts(total, sessions) {
  const counts = Array.from({ length: sessions }, (_, index) =>
    Math.floor(total / sessions) + (index < total % sessions ? 1 : 0),
  )
  return counts
}

/**
 * Builds a v7 sessions payload with `solveCount` solves spread over
 * `sessionCount` named sessions. Solves are newest-first within each session.
 */
export function createSessionsFixture({
  solveCount,
  sessionCount = Math.min(20, Math.max(1, Math.ceil(solveCount / 50))),
  now = Date.UTC(2026, 10, 19, 12, 0, 0),
} = {}) {
  if (!Number.isInteger(solveCount) || solveCount < 0) {
    throw new Error('solveCount must be a non-negative integer')
  }
  if (!Number.isInteger(sessionCount) || sessionCount < 1) {
    throw new Error('sessionCount must be a positive integer')
  }
  const counts = splitCounts(solveCount, sessionCount)
  const spacingMs = solveCount > 1 ? Math.floor((180 * 86_400_000) / solveCount) : 60_000
  let globalIndex = 0
  const sessions = counts.map((count, sessionIndex) => {
    const solves = []
    for (let position = 0; position < count; position += 1) {
      // Newest solve first, exactly as CubeLab stores it.
      const ageSteps = globalIndex
      const createdAt = now - ageSteps * spacingMs
      solves.push(solve(`bench-s${sessionIndex + 1}-${position + 1}`, globalIndex, createdAt))
      globalIndex += 1
    }
    return {
      id: `bench-session-${sessionIndex + 1}`,
      name: sessionIndex === 0 ? 'Benchmark main' : `Benchmark ${sessionIndex + 1}`,
      event: '333',
      createdAt: now - 181 * 86_400_000,
      updatedAt: now,
      solves,
    }
  })
  return {
    version: 7,
    activeSessionId: sessions[0].id,
    sessions,
  }
}

export function fixtureStats(fixture) {
  const solves = fixture.sessions.reduce((sum, session) => sum + session.solves.length, 0)
  const raw = JSON.stringify(fixture)
  return {
    sessions: fixture.sessions.length,
    solves,
    jsonBytes: Buffer.byteLength(raw, 'utf8'),
    jsonMiB: Buffer.byteLength(raw, 'utf8') / (1024 * 1024),
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const solveCount = Number(process.argv[2] ?? 1000)
  const fixture = createSessionsFixture({ solveCount })
  const stats = fixtureStats(fixture)
  process.stdout.write(`${JSON.stringify(stats, null, 2)}\n`)
  if (process.argv[3]) {
    const { writeFileSync } = await import('node:fs')
    writeFileSync(process.argv[3], JSON.stringify(fixture))
  }
}
