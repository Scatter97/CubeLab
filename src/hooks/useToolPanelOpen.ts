import { useCallback, useState } from 'react'

const STORAGE_KEY = 'cubelab:toolPanelOpen:v1'

export function loadToolPanelOpen(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === 'true') return true
    if (raw === 'false') return false
  } catch {
    // ignore
  }
  return false
}

export function useToolPanelOpen(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState<boolean>(() => loadToolPanelOpen())
  const update = useCallback((next: boolean) => {
    setOpen(next)
    try {
      localStorage.setItem(STORAGE_KEY, next ? 'true' : 'false')
    } catch {
      // ignore
    }
  }, [])
  return [open, update]
}