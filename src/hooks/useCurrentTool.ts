import { useCallback, useState } from 'react'

import { isSiteResetInProgress } from '../lib/siteReset'
import { DEFAULT_TOOL, isCurrentTool, type CurrentTool } from '../lib/tools'

export const CURRENT_TOOL_STORAGE_KEY = 'cubelab:currentTool:v1'

export function loadCurrentTool(storageKey = CURRENT_TOOL_STORAGE_KEY): CurrentTool {
  try {
    const raw = localStorage.getItem(storageKey)
    if (raw !== null && isCurrentTool(raw)) return raw
  } catch {
    // ignore
  }
  return DEFAULT_TOOL
}

/** The selected tool is a device-local presentation preference. */
export function useCurrentTool(): [CurrentTool, (tool: CurrentTool) => void] {
  const [tool, setTool] = useState<CurrentTool>(() => loadCurrentTool())
  const update = useCallback((next: CurrentTool) => {
    setTool(next)
    try {
      if (!isSiteResetInProgress()) localStorage.setItem(CURRENT_TOOL_STORAGE_KEY, next)
    } catch {
      // ignore
    }
  }, [])
  return [tool, update]
}
