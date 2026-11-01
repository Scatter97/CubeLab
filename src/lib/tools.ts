export type CurrentTool = 'drawScramble' | 'timeTrend'

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
    description: 'Plot solve times and rolling averages over time',
  },
]

export function toolLabel(tool: CurrentTool): string {
  return TOOL_OPTIONS.find((option) => option.id === tool)?.label ?? 'Draw Scramble'
}
