import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  SETTINGS_STORAGE_KEY,
} from '../lib/storage'
import { useSettings } from './useSettings'

function dispatchSettingsEvent() {
  window.dispatchEvent(
    new StorageEvent('storage', {
      key: SETTINGS_STORAGE_KEY,
      newValue: localStorage.getItem(SETTINGS_STORAGE_KEY),
    }),
  )
}

describe('useSettings cross-tab reconciliation', () => {
  beforeEach(() => {
    localStorage.clear()
    saveSettings(DEFAULT_SETTINGS)
  })

  it('adopts an external settings change', () => {
    const { result } = renderHook(() => useSettings())

    const metrics = {
      ...DEFAULT_SETTINGS.statMetricVisibility,
      target: true,
      bpa: true,
      wpa: true,
    }
    act(() => {
      saveSettings({
        ...DEFAULT_SETTINGS,
        theme: 'dark',
        accentColor: 'blue',
        statMetricVisibility: metrics,
      })
      dispatchSettingsEvent()
    })

    expect(result.current.settings.theme).toBe('dark')
    expect(result.current.settings.accentColor).toBe('blue')
    expect(result.current.settings.statMetricVisibility).toEqual(metrics)
  })

  it('keeps an external field when an unrelated local edit follows', () => {
    const { result } = renderHook(() => useSettings())

    act(() => {
      saveSettings({ ...DEFAULT_SETTINGS, theme: 'dark' })
      dispatchSettingsEvent()
    })
    expect(result.current.settings.theme).toBe('dark')

    act(() => {
      result.current.updateSettings({ statPrecision: 'tenths' })
    })

    expect(result.current.settings.theme).toBe('dark')
    expect(result.current.settings.statPrecision).toBe('tenths')
    expect(loadSettings()).toMatchObject({
      theme: 'dark',
      statPrecision: 'tenths',
    })
  })

  it('does not let a stale external field overwrite a local edit', () => {
    const { result } = renderHook(() => useSettings())

    // This tab changes the theme and writes it.
    act(() => {
      result.current.updateSettings({ theme: 'dark' })
    })
    expect(loadSettings().theme).toBe('dark')

    // Another tab publishes a fresh precision but its snapshot still carries
    // the old theme. The local theme must survive while the external precision
    // is adopted.
    act(() => {
      saveSettings({
        ...DEFAULT_SETTINGS,
        theme: 'light',
        statPrecision: 'tenths',
      })
      dispatchSettingsEvent()
    })

    expect(result.current.settings.theme).toBe('dark')
    expect(result.current.settings.statPrecision).toBe('tenths')
    expect(loadSettings()).toMatchObject({
      theme: 'dark',
      statPrecision: 'tenths',
    })
  })

  it('ignores a storage event whose value matches the current settings', () => {
    const { result } = renderHook(() => useSettings())
    const before = result.current.settings

    act(() => {
      saveSettings(before)
      dispatchSettingsEvent()
    })

    expect(result.current.settings).toBe(before)
  })
})

it('defers cross-tab trimming changes during timing, then adopts both sides', () => {
  const { result } = renderHook(() => useSettings())
  act(() => result.current.setTimerActive(true))
  act(() => {
    saveSettings({ ...DEFAULT_SETTINGS, averageTrimBetter: '1', averageTrimWorse: 'p10' })
    dispatchSettingsEvent()
  })
  expect(result.current.settings).toMatchObject({ averageTrimBetter: 'p5', averageTrimWorse: 'auto' })
  act(() => result.current.setTimerActive(false))
  expect(result.current.settings).toMatchObject({ averageTrimBetter: '1', averageTrimWorse: 'p10' })
  act(() => result.current.updateSettings({ theme: 'dark' }))
  expect(loadSettings()).toMatchObject({ averageTrimBetter: '1', averageTrimWorse: 'p10', theme: 'dark' })
})

describe('useSettings staged replacements', () => {
  beforeEach(() => {
    localStorage.clear()
    saveSettings(DEFAULT_SETTINGS)
  })

  it('saves a replacement without publishing React state', () => {
    const { result } = renderHook(() => useSettings())
    let staged = false
    act(() => {
      staged = result.current.stageSettings({
        ...DEFAULT_SETTINGS,
        theme: 'dark',
        accentColor: 'blue',
      })
    })

    expect(staged).toBe(true)
    expect(result.current.settings.theme).toBe('light')
    expect(loadSettings()).toMatchObject({ theme: 'dark', accentColor: 'blue' })
  })

  it('reports a failed stage without changing visible settings', () => {
    const { result } = renderHook(() => useSettings())
    const original = Storage.prototype.setItem
    const spy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(function setItem(this: Storage, key, value) {
        if (key === SETTINGS_STORAGE_KEY) {
          throw new DOMException('Quota exceeded', 'QuotaExceededError')
        }
        return original.call(this, key, value)
      })
    try {
      let staged = true
      act(() => {
        staged = result.current.stageSettings({
          ...DEFAULT_SETTINGS,
          theme: 'dark',
        })
      })
      expect(staged).toBe(false)
      expect(result.current.settings.theme).toBe('light')
      expect(loadSettings().theme).toBe('light')
    } finally {
      spy.mockRestore()
    }
  })
})
