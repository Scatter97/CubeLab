import { StrictMode, type ReactNode } from 'react'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useTraining } from './useTraining'
import { createEmptyTrainingData, serializeTrainingData, TRAINING_STORAGE_KEY } from '../lib/training/storage'
import { createTrainingVisit } from '../lib/training/records'
import { closedTrainingHistory } from '../lib/training/persistenceFixtures.test-support'

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks() })
describe('useTraining browser lifecycle adapter', () => {
  it('performs checked reads without writing or starting calibration during Strict Mode startup', () => {
    const write = vi.spyOn(Storage.prototype, 'setItem')
    const { result } = renderHook(useTraining, { wrapper: ({children}: {children: ReactNode}) => <StrictMode>{children}</StrictMode> })
    expect(result.current.state.data!.visits).toHaveLength(0)
    expect(result.current.state.calibration).toBeNull()
    expect(result.current.controller.getBackupSnapshot()).toEqual({ status: 'absent' })
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
  expect(result.current.controller.getBackupSnapshot()).toEqual({
    status: 'blocked',
    reason:
      'A Training save is pending. Retry the save before exporting a complete backup.',
  })
  const blocked = new Event('beforeunload',{cancelable:true})
  window.dispatchEvent(blocked)
  expect(blocked.defaultPrevented).toBe(true)
  vi.restoreAllMocks()
  act(() => result.current.controller.retrySave())
  const safe = new Event('beforeunload',{cancelable:true})
  window.dispatchEvent(safe)
  expect(safe.defaultPrevented).toBe(false)
})

describe('checked Training replacement adoption', () => {
  it('recovers an unreadable store in memory without writing a second time', () => {
    localStorage.setItem(TRAINING_STORAGE_KEY, '{broken')
    const { result } = renderHook(useTraining)
    expect(result.current.state.data).toBeNull()
    expect(result.current.state.error).not.toBeNull()
    expect(result.current.controller.getBackupSnapshot()).toMatchObject({
      status: 'blocked',
    })

    const imported = closedTrainingHistory()
    const raw = serializeTrainingData(imported)
    let adopted = false
    act(() => {
      adopted = result.current.controller.adoptSavedTraining(imported, raw)
    })

    expect(adopted).toBe(true)
    expect(result.current.state.data).toEqual(imported)
    expect(result.current.state.error).toBeNull()
    expect(result.current.state.pendingSave).toBe(false)
    expect(result.current.state.needsContinuity).toBe(false)
    expect(result.current.state.category).toBeNull()
    expect(result.current.state.setup).toBeNull()
    expect(result.current.state.calibration).toBeNull()
    expect(result.current.state.lastResultId).toBe('fixture-attempt')
    expect(result.current.controller.getSavedData()).toEqual(imported)
    expect(result.current.controller.getBackupSnapshot()).toEqual({
      status: 'ready',
      data: imported,
    })
    // The durable replacement already wrote the key; adoption must not write.
    expect(localStorage.getItem(TRAINING_STORAGE_KEY)).toBe('{broken')
  })

  it('clears a continuity decision and does not resume an imported visit', () => {
    const at = Date.now()
    const visit = createTrainingVisit('oll:execution', at, 'open-visit')
    localStorage.setItem(
      TRAINING_STORAGE_KEY,
      JSON.stringify({
        ...createEmptyTrainingData(),
        visits: [visit],
        activeVisitId: visit.id,
      }),
    )
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([
      { type: 'back_forward' } as unknown as PerformanceNavigationTiming,
    ])
    const { result } = renderHook(useTraining)
    expect(result.current.state.needsContinuity).toBe(true)
    expect(result.current.controller.getBackupSnapshot()).toEqual({
      status: 'blocked',
      reason:
        'Training is waiting for a resume or end decision. Resolve it before exporting a complete backup.',
    })

    const imported = closedTrainingHistory()
    const raw = serializeTrainingData(imported)
    act(() => {
      expect(
        result.current.controller.adoptSavedTraining(imported, raw),
      ).toBe(true)
    })

    expect(result.current.state.needsContinuity).toBe(false)
    expect(result.current.state.data?.activeVisitId).toBeNull()
    expect(result.current.state.data?.visits.every((item) => item.endedAt !== null)).toBe(true)
    expect(result.current.state.category).toBeNull()
  })

  it('rejects an unfinished imported store without changing the checked snapshot', () => {
    const { result } = renderHook(useTraining)
    const previous = result.current.controller.getSavedData()
    const at = Date.now()
    const visit = createTrainingVisit('oll:execution', at, 'open-visit')
    const open = {
      ...createEmptyTrainingData(),
      visits: [visit],
      activeVisitId: visit.id,
    }
    const closed = closedTrainingHistory()

    act(() => {
      expect(
        result.current.controller.adoptSavedTraining(
          closed,
          serializeTrainingData(open),
        ),
      ).toBe(false)
    })

    expect(result.current.controller.getSavedData()).toEqual(previous)
    expect(result.current.state.error).toContain('could not be adopted')
  })
})
