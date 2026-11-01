import { startTransition, useEffect, useState } from 'react'

/** Let urgent feedback render before refreshing expensive presentation data. */
export function usePostPaintValue<T>(value: T): T {
  const [presented, setPresented] = useState(() => value)
  useEffect(() => {
    if (presented === value) return
    let task: number | undefined
    // A task queued from rAF runs after that frame's rendering opportunity.
    // Unlike a deferred render alone, it cannot consume the same frame's
    // remaining time before the urgent result has had an opportunity to paint.
    const frame = requestAnimationFrame(() => {
      task = window.setTimeout(() => startTransition(() => setPresented(() => value)), 0)
    })
    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(task)
    }
  }, [value, presented])
  return presented
}
