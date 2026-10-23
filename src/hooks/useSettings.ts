import { useCallback, useEffect, useRef, useState } from 'react'
import type { Settings } from '../types'
import { loadSettings, saveSettings } from '../lib/storage'

export interface UseSettingsResult {
  settings: Settings
  settingsStorageOk: boolean
  setInspectionEnabled: (enabled: boolean) => void
}

export function useSettings(): UseSettingsResult {
  const [settings, setSettings] = useState<Settings>(() => loadSettings())
  const [settingsStorageOk, setSettingsStorageOk] = useState(true)
  const initialWrite = useRef(true)

  useEffect(() => {
    const success = saveSettings(settings)
    if (initialWrite.current) {
      initialWrite.current = false
      return
    }
    setSettingsStorageOk(success)
  }, [settings])

  const setInspectionEnabled = useCallback((enabled: boolean) => {
    setSettings({ inspectionEnabled: enabled })
  }, [])

  return { settings, settingsStorageOk, setInspectionEnabled }
}
