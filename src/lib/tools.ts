export type CurrentTool =
  | 'drawScramble'
  | 'timeTrend'
  | 'confirmTime'
  | 'statistics'
  | 'distribution'
  | 'dailyStats'
  | 'metronome'
  | 'battle'

export interface ToolOption {
  id: CurrentTool
  label: string
  description: string
}

/** The tool shown when the panel is first opened. */
export const DEFAULT_TOOL: CurrentTool = 'drawScramble'

/**
 * The single source of truth for the in-panel Function dropdown. Only add a
 * tool here when it has real content; the panel switches on these IDs.
 */
export const TOOL_OPTIONS: readonly ToolOption[] = [
  {
    id: 'drawScramble',
    label: 'Draw Scramble',
    description: 'Show the current scramble as a cube diagram',
  },
  {
    id: 'timeTrend',
    label: 'Time Trend',
    description: 'Plot time, ao5, ao12 and personal bests',
  },
  {
    id: 'confirmTime',
    label: 'Confirm Time',
    description: 'Confirm or correct the latest solve',
  },
  {
    id: 'statistics',
    label: 'Statistics',
    description: 'Session summary for the current solve set',
  },
  {
    id: 'distribution',
    label: 'Time Distribution',
    description: 'Histogram of solve times in this session',
  },
  {
    id: 'dailyStats',
    label: 'Daily Stats',
    description: 'Solve count and times grouped by day',
  },
  {
    id: 'metronome',
    label: 'Metronome',
    description: 'Steady click at a chosen interval',
  },
  {
    id: 'battle',
    label: 'Online Battle',
    description: 'Race another CubeLab user over a direct peer connection',
  },
]

const TOOL_IDS: ReadonlySet<string> = new Set(TOOL_OPTIONS.map((option) => option.id))

export function isCurrentTool(value: unknown): value is CurrentTool {
  return typeof value === 'string' && TOOL_IDS.has(value)
}

export function toolLabel(tool: CurrentTool): string {
  return TOOL_OPTIONS.find((option) => option.id === tool)?.label ?? 'Draw Scramble'
}
