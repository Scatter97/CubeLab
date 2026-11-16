import { useCallback, useState, type Dispatch, type SetStateAction } from 'react'
import {
  parseToolPanelLayout,
  type ToolPanelLayout,
} from '../lib/toolPanelLayout'

import { isSiteResetInProgress } from '../lib/siteReset'

export const TOOL_PANEL_LAYOUT_STORAGE_KEY = 'cubelab:toolPanelLayout:v1'

export function loadToolPanelLayout(storageKey = TOOL_PANEL_LAYOUT_STORAGE_KEY): ToolPanelLayout | null {
  try {
    return parseToolPanelLayout(
      localStorage.getItem(storageKey),
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

export function useToolPanelLayout(storageKey = TOOL_PANEL_LAYOUT_STORAGE_KEY): UseToolPanelLayout {
  const [layout, setLayout] = useState<ToolPanelLayout | null>(() =>
    loadToolPanelLayout(storageKey),
  )

  const persist = useCallback((next: ToolPanelLayout) => {
    try {
      if (!isSiteResetInProgress()) localStorage.setItem(storageKey, JSON.stringify(next))
    } catch {
      // A full or unavailable storage must not break the panel.
    }
  }, [storageKey])

  return { layout, setLayout, persist }
}
