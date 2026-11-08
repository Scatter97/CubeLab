import { useEffect, useState } from 'react'

/** Start of the local calendar day containing `timestamp`. */
export function localDayStart(timestamp: number): number {
  const date = new Date(timestamp)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/**
 * Delay until the next local calendar midnight. Calendar arithmetic is used
 * instead of adding 24 hours so DST transitions keep the refresh aligned.
 */
export function millisecondsUntilNextLocalMidnight(timestamp: number): number {
  const date = new Date(timestamp)
  const nextMidnight = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + 1,
  ).getTime()
  return Math.max(0, nextMidnight - timestamp)
}

/**
 * One shared clock invalidation source for a mounted view. It changes only when
 * the local calendar day changes, so time-dependent calculations can include
 * the returned value in memo dependencies without recomputing on unrelated
 * renders. The timer is rescheduled from the wall clock after every wakeup,
 * and visibility/focus returns catch up after background throttling, sleep or
 * a clock/time-zone change.
 */
export function useLocalDayRefresh(): number {
  const [dayStart, setDayStart] = useState(() => localDayStart(Date.now()))

  useEffect(() => {
    let timer: number | null = null
    let cancelled = false

    const refresh = () => {
      if (cancelled) return
      const nextDay = localDayStart(Date.now())
      setDayStart((previous) => (previous === nextDay ? previous : nextDay))
      schedule()
    }

    const schedule = () => {
      if (cancelled) return
      if (timer !== null) window.clearTimeout(timer)
      // The extra tick avoids waking a few milliseconds before midnight and
      // then waiting nearly a full day because the date has not changed yet.
      const delay = millisecondsUntilNextLocalMidnight(Date.now()) + 50
      timer = window.setTimeout(refresh, delay)
    }

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') refresh()
    }

    schedule()
    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('focus', refresh)
    window.addEventListener('pageshow', refresh)

    return () => {
      cancelled = true
      if (timer !== null) window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('focus', refresh)
      window.removeEventListener('pageshow', refresh)
    }
  }, [])

  return dayStart
}
