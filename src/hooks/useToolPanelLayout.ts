import { useCallback, useState, type Dispatch, type SetStateAction } from 'react'
import {
  parseToolPanelLayout,
  type ToolPanelLayout,
} from '../lib/toolPanelLayout'

export const TOOL_PANEL_LAYOUT_STORAGE_KEY = 'cubelab:toolPanelLayout:v1'

export function loadToolPanelLayout(): ToolPanelLayout | null {
  try {
    return parseToolPanelLayout(
      localStorage.getItem(TOOL_PANEL_LAYOUT_STORAGE_KEY),
    )
  } catch {
    return null
  }
}

interface UseToolPanelLayout {
  layout: ToolPanelLayout | null
  setLayout: Dispatch<SetStateAction<ToolPanelLayout | null>>
  /** Write the end-of-interaction position; drags never persist mid-move. */
  persist: (layout: ToolPanelLayout) => void
}

export function useToolPanelLayout(): UseToolPanelLayout {
  const [layout, setLayout] = useState<ToolPanelLayout | null>(() =>
    loadToolPanelLayout(),
  )

  const persist = useCallback((next: ToolPanelLayout) => {
    try {
      localStorage.setItem(TOOL_PANEL_LAYOUT_STORAGE_KEY, JSON.stringify(next))
    } catch {
      // A full or unavailable storage must not break the panel.
    }
  }, [])

  return { layout, setLayout, persist }
}
