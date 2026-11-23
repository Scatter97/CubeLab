import { useEffect, useMemo, useRef, useState } from 'react'
import type { Solve } from '../types'
import { effectiveTimeMs } from '../lib/stats'
import { formatTime } from '../lib/format'

function validTimes(solves: readonly Solve[]): number[] {
  return solves
    .map((solve) => effectiveTimeMs(solve))
    .filter((time): time is number => time !== null && Number.isFinite(time))
}

function minMax(values: readonly number[]): { min: number; max: number } | null {
  if (values.length === 0) return null
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const value of values) {
    if (value < min) min = value
    if (value > max) max = value
  }
  return { min, max }
}

export function StatisticsTool({ solves }: { solves: readonly Solve[] }) {
  const values = useMemo(() => validTimes(solves), [solves])
  const stats = useMemo(() => {
    if (solves.length === 0) return null
    const sorted = [...values].sort((a, b) => a - b)
    let total = 0
    for (const value of values) total += value
    const middle = Math.floor(sorted.length / 2)
    return {
      count: solves.length,
      valid: values.length,
      dnf: solves.length - values.length,
      best: sorted[0] ?? null,
      worst: sorted[sorted.length - 1] ?? null,
      mean: values.length > 0 ? total / values.length : null,
      median:
        sorted.length === 0
          ? null
          : sorted.length % 2 === 0
            ? (sorted[middle - 1]! + sorted[middle]!) / 2
            : sorted[middle]!,
      total: values.length > 0 ? total : null,
    }
  }, [solves.length, values])

  if (!stats) return <p className="tool-note">No solves in this session yet.</p>
  const allDnf = stats.count > 0 && stats.valid === 0
  return (
    <div className="tool-scroll">
      <dl className="tool-stat-grid">
        <div><dt>Solves</dt><dd>{stats.count}</dd></div>
        <div><dt>Valid</dt><dd>{stats.valid}</dd></div>
        <div><dt>DNF</dt><dd>{stats.dnf}</dd></div>
        <div><dt>Best</dt><dd>{stats.best === null ? '—' : formatTime(stats.best)}</dd></div>
        <div><dt>Worst</dt><dd>{stats.worst === null ? '—' : formatTime(stats.worst)}</dd></div>
        <div><dt>Mean</dt><dd>{stats.mean === null ? '—' : formatTime(stats.mean)}</dd></div>
        <div><dt>Median</dt><dd>{stats.median === null ? '—' : formatTime(stats.median)}</dd></div>
        <div><dt>Total</dt><dd>{stats.total === null ? '—' : formatTime(stats.total)}</dd></div>
      </dl>
      {allDnf ? (
        <p className="tool-note" data-testid="statistics-all-dnf">
          100% DNF. That’s consistency.
        </p>
      ) : null}
    </div>
  )
}

export function DistributionTool({ solves }: { solves: readonly Solve[] }) {
  const values = useMemo(() => validTimes(solves), [solves])
  const buckets = useMemo(() => {
    const range = minMax(values)
    if (!range) return []
    const { min, max } = range
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

interface DailyGroup {
  key: string
  date: Date
  year: number
  count: number
  total: number
  validCount: number
  best: number | null
}

export function DailyStatsTool({ solves }: { solves: readonly Solve[] }) {
  const days = useMemo(() => {
    const groups = new Map<string, DailyGroup>()
    for (const solve of solves) {
      const date = new Date(solve.createdAt)
      if (Number.isNaN(date.getTime())) continue
      const year = date.getFullYear()
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const dayOfMonth = String(date.getDate()).padStart(2, '0')
      const key = `${year}-${month}-${dayOfMonth}`
      const group = groups.get(key) ?? {
        key,
        date,
        year,
        count: 0,
        total: 0,
        validCount: 0,
        best: null,
      }
      group.count += 1
      const time = effectiveTimeMs(solve)
      if (time !== null) {
        group.total += time
        group.validCount += 1
        if (group.best === null || time < group.best) group.best = time
      }
      groups.set(key, group)
    }
    const values = [...groups.values()]
    const spansYears = new Set(values.map((group) => group.year)).size > 1
    const formatter = new Intl.DateTimeFormat(undefined, {
      ...(spansYears ? { year: 'numeric' as const } : {}),
      month: 'short',
      day: 'numeric',
    })
    return values.map((group) => ({
      ...group,
      label: formatter.format(group.date),
      mean: group.validCount > 0 ? group.total / group.validCount : null,
    }))
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
            <tr key={day.key} data-date={day.key}>
              <th scope="row">{day.label}</th>
              <td>{day.count}</td>
              <td>{day.best === null ? '—' : formatTime(day.best)}</td>
              <td>{day.mean === null ? '—' : formatTime(day.mean)}</td>
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
