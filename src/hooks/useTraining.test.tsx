import { StrictMode, type ReactNode } from 'react'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useTraining } from './useTraining'
import { createEmptyTrainingData, TRAINING_STORAGE_KEY } from '../lib/training/storage'
import { createTrainingVisit } from '../lib/training/records'

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks() })
describe('useTraining browser lifecycle adapter', () => {
  it('performs checked reads without writing or starting calibration during Strict Mode startup', () => {
    const write = vi.spyOn(Storage.prototype, 'setItem')
    const { result } = renderHook(useTraining, { wrapper: ({children}: {children: ReactNode}) => <StrictMode>{children}</StrictMode> })
    expect(result.current.state.data!.visits).toHaveLength(0)
    expect(result.current.state.calibration).toBeNull()
    expect(write).not.toHaveBeenCalled()
  })
  it('resumes a known reload without duplicating its visit, but gates ambiguous session restoration', () => {
    const at = Date.now()
    const visit = createTrainingVisit('oll:execution', at, 'resumed-visit')
    localStorage.setItem(TRAINING_STORAGE_KEY, JSON.stringify({ ...createEmptyTrainingData(), visits: [visit], activeVisitId: visit.id }))
    vi.spyOn(performance,'getEntriesByType').mockReturnValue([{type:'reload'} as unknown as PerformanceNavigationTiming])
    const { result, unmount } = renderHook(useTraining, { wrapper: ({children}: {children: ReactNode}) => <StrictMode>{children}</StrictMode> })
    expect(result.current.state.needsContinuity).toBe(false)
    expect(result.current.state.data!.visits).toHaveLength(1)
    expect(result.current.state.data!.activeVisitId).toBe(visit.id)
    unmount()
    vi.spyOn(performance,'getEntriesByType').mockReturnValue([{type:'back_forward'} as unknown as PerformanceNavigationTiming])
    const restored = renderHook(useTraining)
    expect(restored.result.current.state.needsContinuity).toBe(true)
    act(() => restored.result.current.controller.recover('closed'))
    expect(restored.result.current.state.data!.activeVisitId).toBeNull()
    expect(restored.result.current.state.data!.visits).toHaveLength(1)
  })
})

it('protects an unsaved Training candidate on exit until retry succeeds', async () => {
  const { result } = renderHook(useTraining)
  const original = Storage.prototype.setItem
  vi.spyOn(Storage.prototype,'setItem').mockImplementation(function (this: Storage,key,value) {
    if (key === TRAINING_STORAGE_KEY) throw Error('synthetic quota')
    original.call(this,key,value)
  })
  await act(async () => { await result.current.controller.selectCategory('oll:execution') })
  expect(result.current.state.pendingSave).toBe(true)
  const blocked = new Event('beforeunload',{cancelable:true})
  window.dispatchEvent(blocked)
  expect(blocked.defaultPrevented).toBe(true)
  vi.restoreAllMocks()
  act(() => result.current.controller.retrySave())
  const safe = new Event('beforeunload',{cancelable:true})
  window.dispatchEvent(safe)
  expect(safe.defaultPrevented).toBe(false)
})
