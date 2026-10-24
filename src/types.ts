/** The puzzles CubeLab can currently record solves for. */
export type PuzzleEvent = '333'

/** A WCA penalty. Penalties are mutually exclusive. */
export type Penalty = 'none' | '+2' | 'dnf'

export interface FieldUpdate {
  updatedAt: number
  editorId: string
}

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
  comment: string
  createdAt: number
  /**
   * Wall-clock edit timestamp. Used only for conflict comparison during sync;
   * it never controls whether a solve is included in a merge.
   */
  updatedAt?: number
  /**
   * Per-field modification metadata used to resolve independent edits during sync.
   * Fields without metadata fall back to createdAt/updatedAt conservatively.
   */
  fieldUpdates?: Partial<{
    rawMs: FieldUpdate
    penalty: FieldUpdate
    scramble: FieldUpdate
    comment: FieldUpdate
  }>
}

export type TimerUpdateMode = 'live' | 'tenths' | 'seconds'
export type ScrambleAlignment = 'left' | 'center' | 'right'
export type ScrambleAction = 'none' | 'copy' | 'next'
export type AlertChannel = 'off' | 'visual' | 'sound' | 'sound-visual' | 'haptic' | 'sound-haptic'
export type InspectionCountDirection = 'down' | 'up'
export type InspectionWarningVisualScope = 'timer' | 'screen'
export type AccentColor = 'green' | 'blue' | 'violet' | 'amber'
export type StatPrecision = 'centiseconds' | 'tenths'
export type StatKey =
  | 'single'
  | 'mo3'
  | 'ao5'
  | 'ao12'
  | 'ao25'
  | 'ao100'
  | 'ao200'
  | 'ao500'
  | 'ao1000'
  | 'ao5000'
  | 'ao10000'

export interface StatVisibility {
  single: boolean
  mo3: boolean
  ao5: boolean
  ao12: boolean
  ao25: boolean
  ao100: boolean
  ao200: boolean
  ao500: boolean
  ao1000: boolean
  ao5000: boolean
  ao10000: boolean
}

export interface CustomAverageSetting {
  id: string
  size: number
  visible: boolean
}

/**
 * User preferences. Settings are local first and are intentionally small in
 * scope: they control presentation and timer interaction, not WCA rules.
 */
export interface Settings {
  inspectionEnabled: boolean
  inspectionCountDirection: InspectionCountDirection
  timerUpdateMode: TimerUpdateMode
  holdDurationMs: number
  stopWithAnyKey: boolean
  showTimerDecimalSmall: boolean
  uiZoomPercent: number
  scrambleAlignment: ScrambleAlignment
  scrambleLimitHeight: boolean
  scrambleAction: ScrambleAction
  alertChannel: AlertChannel
  alertVolume: number
  inspectionWarning8s: boolean
  inspectionWarning12s: boolean
  inspectionWarningVisualScope: InspectionWarningVisualScope
  accentColor: AccentColor
  statVisibility: StatVisibility
  customAverages: CustomAverageSetting[]
  statPrecision: StatPrecision
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
  /** Optional per-session override; falls back to the global default. */
  inspectionEnabled?: boolean
}

/** The complete locally persisted session collection. */
export interface SessionsData {
  activeSessionId: string
  sessions: Session[]
}

export type NewSolve = Omit<Solve, 'id' | 'event' | 'createdAt' | 'comment'>
