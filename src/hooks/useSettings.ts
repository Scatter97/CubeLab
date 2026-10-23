import { useCallback, useEffect, useRef, useState } from 'react'
import type { Settings } from '../types'
import {
  DEFAULT_SETTINGS,
  loadSettings,
  parseSettingsData,
  saveSettings,
} from '../lib/storage'

export interface UseSettingsResult {
  settings: Settings
  settingsStorageOk: boolean
  setInspectionEnabled: (enabled: boolean) => void
  updateSettings: (next: Partial<Settings>) => void
  replaceSettings: (settings: Settings) => void
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

  const updateSettings = useCallback(
    (next: Partial<Settings>) =>
      setSettings((previous) => ({ ...previous, ...next })),
    [],
  )

  const setInspectionEnabled = useCallback(
    (enabled: boolean) => {
      updateSettings({ inspectionEnabled: enabled })
    },
    [updateSettings],
  )

  const replaceSettings = useCallback((next: Settings) => {
    setSettings(parseSettingsData(next) ?? DEFAULT_SETTINGS)
  }, [])

  return {
    settings,
    settingsStorageOk,
    setInspectionEnabled,
    updateSettings,
    replaceSettings,
  }
}
