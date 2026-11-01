import { useCallback, useEffect, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import type { Settings } from '../types'
import {
  DEFAULT_SETTINGS,
  loadSettings,
  parseSettingsData,
  saveSettings,
  SETTINGS_STORAGE_KEY,
} from '../lib/storage'
import { SETTINGS_FIELD_KEYS } from '../lib/settingsMerge'
import type { SettingsFieldKey } from '../lib/syncStorage'

function fieldEquals(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (
    (Array.isArray(left) || (left !== null && typeof left === 'object')) &&
    (Array.isArray(right) || (right !== null && typeof right === 'object'))
  ) {
    return JSON.stringify(left) === JSON.stringify(right)
  }
  return false
}

export interface UseSettingsResult {
  settings: Settings
  settingsStorageOk: boolean
  setInspectionEnabled: (enabled: boolean) => void
  updateSettings: (next: Partial<Settings>) => void
  replaceSettings: (settings: Settings) => void
  /**
   * Defers external settings adoption while the timer is armed, running, or
   * inspecting so a cross-tab change cannot cancel inspection mid-solve.
   */
  setTimerActive: (active: boolean) => void
  /**
   * Fields adopted from another tab on the last storage event. Sync uses this
   * to preserve the other tab's field timestamps instead of recording the
   * adoption as a fresh local edit.
   */
  adoptedFieldsRef: MutableRefObject<ReadonlySet<SettingsFieldKey> | null>
}

export function useSettings(): UseSettingsResult {
  const [settings, setSettings] = useState<Settings>(() => loadSettings())
  const [settingsStorageOk, setSettingsStorageOk] = useState(true)
  const initialWrite = useRef(true)
  // Fields changed from this tab since the last external reconciliation. A
  // local pending edit wins over a stale external snapshot for the same field,
  // while unrelated external fields are still adopted.
  const localEdits = useRef<Set<SettingsFieldKey>>(new Set())
  const adoptedFieldsRef = useRef<ReadonlySet<SettingsFieldKey> | null>(null)
  const timerActiveRef = useRef(false)
  const pendingExternalRef = useRef<Settings | null>(null)

  useEffect(() => {
    const success = saveSettings(settings)
    if (initialWrite.current) {
      initialWrite.current = false
      return
    }
    setSettingsStorageOk(success)
  }, [settings])

  const mergeExternal = useCallback((loaded: Settings) => {
    setSettings((previous) => {
      const merged: Settings = { ...previous }
      const adopted = new Set<SettingsFieldKey>()
      let changed = false
      for (const key of SETTINGS_FIELD_KEYS) {
        if (localEdits.current.has(key)) {
          if (fieldEquals(previous[key], loaded[key])) {
            localEdits.current.delete(key)
          }
          continue
        }
        if (!fieldEquals(previous[key], loaded[key])) {
          Object.assign(merged, { [key]: loaded[key] })
          adopted.add(key)
          changed = true
        }
      }
      adoptedFieldsRef.current = adopted.size > 0 ? adopted : null
      return changed ? merged : previous
    })
  }, [])

  // Reconcile settings changed in another tab per field. Fields edited locally
  // are retained until the other tab's snapshot agrees with this tab, so an
  // unrelated local edit cannot be clobbered by (or clobber) another tab's
  // change. While the timer is active the whole external snapshot is deferred,
  // because changing inspection or hold behavior mid-solve is unsafe.
  useEffect(() => {
    const handler = (event: StorageEvent) => {
      if (event.key !== SETTINGS_STORAGE_KEY) return
      try {
        const loaded = loadSettings()
        if (timerActiveRef.current) {
          pendingExternalRef.current = loaded
          return
        }
        mergeExternal(loaded)
      } catch {
        // ignore parse failures
      }
    }
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }, [mergeExternal])

  const setTimerActive = useCallback(
    (active: boolean) => {
      timerActiveRef.current = active
      if (active) return
      const pending = pendingExternalRef.current
      pendingExternalRef.current = null
      if (pending) mergeExternal(pending)
    },
    [mergeExternal],
  )

  const updateSettings = useCallback((next: Partial<Settings>) => {
    setSettings((previous) => {
      const merged = { ...previous, ...next }
      for (const key of SETTINGS_FIELD_KEYS) {
        if (!fieldEquals(previous[key], merged[key])) {
          localEdits.current.add(key)
        }
      }
      return merged
    })
  }, [])

  const setInspectionEnabled = useCallback(
    (enabled: boolean) => {
      updateSettings({ inspectionEnabled: enabled })
    },
    [updateSettings],
  )

  const replaceSettings = useCallback((next: Settings) => {
    // Replacements come from imports, Drive restores, or a sync merge. They
    // are authoritative and must not be treated as pending cross-tab edits.
    localEdits.current.clear()
    adoptedFieldsRef.current = null
    setSettings(parseSettingsData(next) ?? DEFAULT_SETTINGS)
  }, [])

  return {
    settings,
    settingsStorageOk,
    setInspectionEnabled,
    updateSettings,
    replaceSettings,
    setTimerActive,
    adoptedFieldsRef,
  }
}
