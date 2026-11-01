import { useEffect, useState } from 'react'
import type { TimerUpdateMode } from '../types'

/** Display-only clock. Recorded time always comes from the timer machine. */
export function useRunningElapsed(startedAt: number | null, mode: TimerUpdateMode): number | null {
  const [display, setDisplay] = useState<{ startedAt: number | null; ms: number }>({ startedAt: null, ms: 0 })

  useEffect(() => {
    if (startedAt === null) return
    let frame = 0
    const animate = () => {
      const elapsed = Math.max(0, performance.now() - startedAt)
      const ms = mode === 'tenths'
        ? Math.floor(elapsed / 100) * 100
        : mode === 'seconds' ? Math.floor(elapsed / 1000) * 1000 : elapsed
      setDisplay((previous) => previous.startedAt === startedAt && previous.ms === ms
        ? previous : { startedAt, ms })
      frame = requestAnimationFrame(animate)
    }
    frame = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(frame)
  }, [startedAt, mode])

  return startedAt === null ? null : display.startedAt === startedAt ? display.ms : 0
}
