/** The puzzles CubeLab can currently record solves for. */
export type PuzzleEvent = '333'

/** A WCA penalty. Penalties are mutually exclusive. */
export type Penalty = 'none' | '+2' | 'dnf'

/**
 * A single completed solve.
 *
 * `rawMs` is the timer reading before penalties, stored at centisecond
 * precision. `createdAt` is wall-clock time and is only used for display.
 */
export interface Solve {
  id: string
  event: PuzzleEvent
  rawMs: number
  penalty: Penalty
  scramble: string
  createdAt: number
}

export interface Settings {
  inspectionEnabled: boolean
}

/**
 * A named local session. Solves are stored newest-first inside the session.
 * Timestamps are wall-clock metadata only; solve duration always comes from
 * the monotonic timer.
 */
export interface Session {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  solves: Solve[]
}

/** The complete locally persisted session collection. */
export interface SessionsData {
  activeSessionId: string
  sessions: Session[]
}

export type NewSolve = Omit<Solve, 'id' | 'event' | 'createdAt'>
