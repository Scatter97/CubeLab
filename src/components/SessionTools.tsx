import { useEffect, useMemo, useRef, useState } from 'react'
import type { Solve } from '../types'
import { effectiveTimeMs } from '../lib/stats'
import { formatTime } from '../lib/format'

function validTimes(solves: readonly Solve[]): number[] {
  return solves
    .map((solve) => effectiveTimeMs(solve))
    .filter((time): time is number => time !== null && Number.isFinite(time))
}

export function StatisticsTool({ solves }: { solves: readonly Solve[] }) {
  const values = useMemo(() => validTimes(solves), [solves])
  const stats = useMemo(() => {
    if (values.length === 0) return null
    const sorted = [...values].sort((a, b) => a - b)
    const total = values.reduce((sum, value) => sum + value, 0)
    const middle = Math.floor(sorted.length / 2)
    return {
      count: solves.length,
      valid: values.length,
      dnf: solves.length - values.length,
      best: sorted[0]!,
      worst: sorted[sorted.length - 1]!,
      mean: total / values.length,
      median:
        sorted.length % 2 === 0
          ? (sorted[middle - 1]! + sorted[middle]!) / 2
          : sorted[middle]!,
      total,
    }
  }, [solves.length, values])

  if (!stats) return <p className="tool-note">No solves in this session yet.</p>
  return (
    <div className="tool-scroll">
      <dl className="tool-stat-grid">
        <div><dt>Solves</dt><dd>{stats.count}</dd></div>
        <div><dt>Valid</dt><dd>{stats.valid}</dd></div>
        <div><dt>DNF</dt><dd>{stats.dnf}</dd></div>
        <div><dt>Best</dt><dd>{formatTime(stats.best)}</dd></div>
        <div><dt>Worst</dt><dd>{formatTime(stats.worst)}</dd></div>
        <div><dt>Mean</dt><dd>{formatTime(stats.mean)}</dd></div>
        <div><dt>Median</dt><dd>{formatTime(stats.median)}</dd></div>
        <div><dt>Total</dt><dd>{formatTime(stats.total)}</dd></div>
      </dl>
    </div>
  )
}

export function DistributionTool({ solves }: { solves: readonly Solve[] }) {
  const values = useMemo(() => validTimes(solves), [solves])
  const buckets = useMemo(() => {
    if (values.length === 0) return []
    const min = Math.min(...values)
    const max = Math.max(...values)
    const span = Math.max(1, max - min)
    const count = 8
    const step = span / count
    const result = Array.from({ length: count }, (_, index) => ({
      from: min + index * step,
      to: min + (index + 1) * step,
      count: 0,
    }))
    for (const value of values) {
      const index = Math.min(count - 1, Math.floor((value - min) / step))
      result[index]!.count += 1
    }
    return result
  }, [values])

  if (values.length === 0)
    return <p className="tool-note">No valid solves to distribute.</p>
  const peak = Math.max(...buckets.map((bucket) => bucket.count), 1)
  return (
    <div className="tool-scroll tool-bars">
      {buckets.map((bucket) => (
        <div className="tool-bar-row" key={bucket.from}>
          <span className="tool-bar-label">{formatTime(bucket.from)}</span>
          <span className="tool-bar-track">
            <span
              className="tool-bar-fill"
              style={{ width: `${(bucket.count / peak) * 100}%` }}
            />
          </span>
          <span className="tool-bar-value">{bucket.count}</span>
        </div>
      ))}
      <p className="tool-note">{values.length} valid solves</p>
    </div>
  )
}

export function DailyStatsTool({ solves }: { solves: readonly Solve[] }) {
  const days = useMemo(() => {
    const formatter = new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
    })
    const groups = new Map<string, { date: string; count: number; times: number[] }>()
    for (const solve of solves) {
      const date = new Date(solve.createdAt)
      if (Number.isNaN(date.getTime())) continue
      const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
      const group = groups.get(key) ?? {
        date: formatter.format(date),
        count: 0,
        times: [],
      }
      group.count += 1
      const time = effectiveTimeMs(solve)
      if (time !== null) group.times.push(time)
      groups.set(key, group)
    }
    return [...groups.values()]
  }, [solves])

  if (days.length === 0) return <p className="tool-note">No dated solves yet.</p>
  return (
    <div className="tool-scroll">
      <table className="tool-table">
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Solves</th>
            <th scope="col">Best</th>
            <th scope="col">Mean</th>
          </tr>
        </thead>
        <tbody>
          {days.map((day) => (
            <tr key={day.date}>
              <th scope="row">{day.date}</th>
              <td>{day.count}</td>
              <td>{day.times.length ? formatTime(Math.min(...day.times)) : '—'}</td>
              <td>
                {day.times.length
                  ? formatTime(
                      day.times.reduce((sum, time) => sum + time, 0) /
                        day.times.length,
                    )
                  : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function MetronomeTool() {
  const [intervalMs, setIntervalMs] = useState(1000)
  const [running, setRunning] = useState(false)
  const [beats, setBeats] = useState(0)
  const intervalRef = useRef<number | null>(null)
  const audioRef = useRef<AudioContext | null>(null)

  const stop = () => {
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    setRunning(false)
  }

  useEffect(
    () => () => {
      if (intervalRef.current !== null) window.clearInterval(intervalRef.current)
      void audioRef.current?.close()
    },
    [],
  )

  const click = () => {
    const audio =
      audioRef.current ??
      new AudioContext({ latencyHint: 'interactive' })
    audioRef.current = audio
    if (audio.state === 'suspended') void audio.resume()
    const oscillator = audio.createOscillator()
    const gain = audio.createGain()
    oscillator.frequency.value = 880
    gain.gain.setValueAtTime(0.14, audio.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.05)
    oscillator.connect(gain)
    gain.connect(audio.destination)
    oscillator.start()
    oscillator.stop(audio.currentTime + 0.05)
    setBeats((count) => count + 1)
  }

  const start = () => {
    if (running || intervalMs < 100) return
    click()
    setRunning(true)
    intervalRef.current = window.setInterval(click, intervalMs)
  }

  return (
    <div className="tool-scroll tool-form" data-timer-space-ignore>
      <label className="tool-field">
        <span>Interval (ms)</span>
        <input
          type="number"
          min={100}
          max={10000}
          step={10}
          value={intervalMs}
          disabled={running}
          onChange={(event) =>
            setIntervalMs(Math.max(100, Number(event.target.value || 0)))
          }
        />
      </label>
      <div className="tool-actions">
        <button
          type="button"
          className="button button-primary button-small"
          onClick={() => (running ? stop() : start())}
        >
          {running ? 'Stop' : 'Start'}
        </button>
        <span className="tool-note">{beats} beats</span>
      </div>
      <p className="tool-note">
        One click every {intervalMs} ms. Audio starts after a user gesture.
      </p>
    </div>
  )
}
