/** The puzzles CubeLab can currently record solves for. */
export type PuzzleEvent =
  | '333'
  | '222'
  | '444'
  | '333oh'
  | '555'
  | '666'
  | '777'
  | 'pyram'
  | 'skewb'
  | 'sq1'
  | 'clock'
  | 'minx'

/** A WCA penalty. Penalties are mutually exclusive. */
export type Penalty = 'none' | '+2' | 'dnf'

export interface FieldUpdate {
  updatedAt: number
  editorId: string
}

/**
 * A single completed solve.
 *
 * `rawMs` is the reading before penalties, in milliseconds; timer recordings
 * are floored to whole milliseconds. Statistics apply their own recorded-result
 * precision. `createdAt` is wall-clock metadata for display and legacy sync
 * fallbacks; it never determines elapsed solve duration.
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
   * Wall-clock edit timestamp used for sync conflict comparison and legacy
   * recovery fallbacks. It never determines elapsed solve duration.
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
export type ThemePreference = 'light' | 'dark' | 'system'
export type AverageTrimRule = '0' | '1' | 'p1' | 'p5' | 'p10' | 'p20' | 'median'
export interface AverageTrimming {
  better: AverageTrimRule
  worse: AverageTrimRule | 'auto'
}

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
 * scope: they control presentation, timer interaction, and training-average trimming.
 */
export type AnalyticsSectionId =
  | 'overview'
  | 'progression'
  | 'averages'
  | 'personalBests'
  | 'distribution'
  | 'consistency'
  | 'subX'
  | 'sessions'
  | 'activity'
  | 'advanced'
  | 'explorer'

export interface AnalyticsSectionSetting {
  id: AnalyticsSectionId
  visible: boolean
  /** Wider chart/card spans both dashboard columns on desktop. */
  wide: boolean
}

export interface AnalyticsSettings {
  /** Persisted dashboard order, visibility and width. */
  sections: AnalyticsSectionSetting[]
  /** Sub-X target in milliseconds, configured per puzzle event. */
  subXTargetsMs: Partial<Record<PuzzleEvent, number>>
}

export interface Settings {
  inspectionEnabled: boolean
  inspectionCountDirection: InspectionCountDirection
  timerUpdateMode: TimerUpdateMode
  holdDurationMs: number
  stopWithAnyKey: boolean
  showTimerDecimalSmall: boolean
  uiZoomPercent: number
  statsPanelHeightPercent: number
  scrambleAlignment: ScrambleAlignment
  scrambleLimitHeight: boolean
  scrambleAction: ScrambleAction
  alertChannel: AlertChannel
  alertVolume: number
  inspectionWarning8s: boolean
  inspectionWarning12s: boolean
  inspectionWarningVisualScope: InspectionWarningVisualScope
  theme: ThemePreference
  accentColor: AccentColor
  statVisibility: StatVisibility
  customAverages: CustomAverageSetting[]
  statPrecision: StatPrecision
  averageTrimBetter: AverageTrimRule
  averageTrimWorse: AverageTrimRule | 'auto'
  /** Analytics page layout and per-puzzle Sub-X targets. */
  analytics: AnalyticsSettings
}

/**
/**
 * Session-local overrides for inspection, scramble presentation, and timer behavior.
 * Global appearance, accent, alert volume, stats display, sync, and text scaling
 * remain application-wide and are not duplicated here.
 */
export interface SessionPreferences {
  inspectionEnabled?: boolean
  inspectionCountDirection?: InspectionCountDirection
  inspectionWarning8s?: boolean
  inspectionWarning12s?: boolean
  inspectionWarningVisualScope?: InspectionWarningVisualScope
  scrambleAlignment?: ScrambleAlignment
  scrambleLimitHeight?: boolean
  scrambleAction?: ScrambleAction
  timerUpdateMode?: TimerUpdateMode
  holdDurationMs?: number
  stopWithAnyKey?: boolean
  showTimerDecimalSmall?: boolean
}

export type SessionPreferenceKey = keyof SessionPreferences

/**
 * Per-field session metadata. Fields without an entry fall back to the
 * session's `updatedAt` at merge time; older records stay untouched rather
 * than receiving fabricated historical timestamps.
 */
export interface SessionFieldUpdates {
  name?: FieldUpdate
  event?: FieldUpdate
  inspectionEnabled?: FieldUpdate
  preferences?: Partial<Record<SessionPreferenceKey, FieldUpdate>>
}

/**
 * A named local session. Solves are stored newest-first inside the session.
 * Timestamps are wall-clock metadata only; solve duration always comes from
 * the monotonic timer.
 */
export interface Session {
  id: string
  name: string
  /** True only for CubeLab's untouched, auto-created local placeholder. */
  isAutoCreatedDefault?: boolean
  /** The WCA puzzle event for every solve in this session. */
  event?: PuzzleEvent
  createdAt: number
  updatedAt: number
  solves: Solve[]
  /** Optional per-session override; falls back to the global default. */
  inspectionEnabled?: boolean
  /** Session-specific inspection, scramble, and timer overrides. */
  preferences?: SessionPreferences
  /** Field-level conflict metadata for synchronization. */
  fieldUpdates?: SessionFieldUpdates
}


/** The complete locally persisted session collection. */
export interface SessionsData {
  activeSessionId: string
  sessions: Session[]
}

export type NewSolve = Omit<Solve, 'id' | 'event' | 'createdAt' | 'comment'>
