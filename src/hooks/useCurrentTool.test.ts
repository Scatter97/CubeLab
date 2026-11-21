import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  beginSiteResetGate,
  resetSiteResetGateForTests,
} from '../lib/siteReset'
import { isCurrentTool, TOOL_OPTIONS } from '../lib/tools'
import {
  CURRENT_TOOL_STORAGE_KEY,
  loadCurrentTool,
  useCurrentTool,
} from './useCurrentTool'

describe('current tool persistence', () => {
  beforeEach(() => {
    localStorage.clear()
    resetSiteResetGateForTests()
  })

  afterEach(() => {
    cleanup()
    resetSiteResetGateForTests()
    localStorage.clear()
  })

  it('loads a valid stored tool and falls back for missing or retired IDs', () => {
    expect(loadCurrentTool()).toBe('drawScramble')
    localStorage.setItem(CURRENT_TOOL_STORAGE_KEY, 'timeTrend')
    expect(loadCurrentTool()).toBe('timeTrend')
    localStorage.setItem(CURRENT_TOOL_STORAGE_KEY, 'retired-tool')
    expect(loadCurrentTool()).toBe('drawScramble')
    expect(TOOL_OPTIONS.every((option) => isCurrentTool(option.id))).toBe(true)
    expect(isCurrentTool('unknown')).toBe(false)
  })

  it('publishes and persists a selected tool', () => {
    const { result } = renderHook(() => useCurrentTool())
    expect(result.current[0]).toBe('drawScramble')
    act(() => result.current[1]('statistics'))
    expect(result.current[0]).toBe('statistics')
    expect(localStorage.getItem(CURRENT_TOOL_STORAGE_KEY)).toBe('statistics')
  })

  it('blocks the write while a site reset is in progress', () => {
    beginSiteResetGate()
    const { result } = renderHook(() => useCurrentTool())
    act(() => result.current[1]('timeTrend'))
    expect(result.current[0]).toBe('timeTrend')
    expect(localStorage.getItem(CURRENT_TOOL_STORAGE_KEY)).toBeNull()
  })
})
