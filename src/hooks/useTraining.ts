import { useEffect, useState, useSyncExternalStore } from 'react'
import { TrainingController } from '../lib/training/controller'

/** Mounted only inside App, after SingleTabGate acquires the lifetime Web Lock. */
export function useTraining() {
  const [controller] = useState(() => new TrainingController())
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  useEffect(() => {
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    // Reload is the positive continuity signal. Session restore/back-forward is
    // deliberately ambiguous; pagehide does not prove a tab was closed.
    controller.recover(navigation?.type === 'reload' ? 'refresh' : 'unknown')
    const tick = window.setInterval(controller.tick, 10_000)
    const onVisibility = () => {
      if (document.visibilityState === 'visible') controller.tick()
      else controller.checkpointPractice()
    }
    const onKey = (event: KeyboardEvent) => { if (!event.repeat) controller.notePracticeInput() }
    window.addEventListener('pageshow', onVisibility)
    window.addEventListener('pagehide', controller.checkpointPractice)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerdown', controller.notePracticeInput, true)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearInterval(tick)
      window.removeEventListener('pageshow', onVisibility)
      window.removeEventListener('pagehide', controller.checkpointPractice)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerdown', controller.notePracticeInput, true)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [controller])
  useEffect(() => {
    if (!state.pendingSave) return
    const protectUnsaved = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', protectUnsaved)
    return () => window.removeEventListener('beforeunload', protectUnsaved)
  }, [state.pendingSave])
  return { controller, state }
}
