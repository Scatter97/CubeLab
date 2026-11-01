import { createPortal } from 'react-dom'
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useModalDialog } from '../hooks/useModalDialog'
import { buildTrendData, buildPBStats, trendAxis, trendPath, trendViewAxis, zoomTrendAxis, panTrendAxis, type TrendAxisView, type TrendPoint, type SeriesId } from '../lib/timeTrend'
import { DEFAULT_AVERAGE_TRIMMING } from '../lib/averageTrimming'
import type { AverageTrimming, Solve } from '../types'
import { formatTime } from '../lib/format'
import { PBStatsDialog } from './PBStatsDialog'

const SERIES: { key: SeriesId; label: string; size?: number }[] = [
  { key: 'single', label: 'Single' },
  { key: 'ao5', label: 'ao5', size: 5 },
  { key: 'ao12', label: 'ao12', size: 12 },
  { key: 'ao25', label: 'ao25', size: 25 },
  { key: 'ao50', label: 'ao50', size: 50 },
  { key: 'ao100', label: 'ao100', size: 100 },
  { key: 'ao200', label: 'ao200', size: 200 },
  { key: 'ao500', label: 'ao500', size: 500 },
  { key: 'ao1000', label: 'ao1000', size: 1000 },
]
const GESTURE_HELP = 'Scroll up/down to zoom time, left/right to zoom solves; pinch for both. Drag to pan. Shift + wheel zooms horizontally. Click a PB for stats.'

const color = (key: SeriesId | 'pb') => `var(--trend-${key})`
const axisTime = (ms: number) => ms >= 60000
  ? formatTime(Math.round(ms / 10) * 10).replace(/\.00$/, '')
  : `${Number((ms / 1000).toFixed(2))}`
const shortDate = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
const valueFor = (point: TrendPoint, key: SeriesId, size: number) => key === 'single'
  ? point.singleMs : point.averages[(key === 'custom' ? `ao${size}` : key) as `ao${number}`] ?? null

interface Props {
  solves: readonly Solve[]
  compact?: boolean
  disabled?: boolean
  trimming?: AverageTrimming
}

interface ChartProps {
  points: TrendPoint[]
  series: typeof SERIES
  customSize: number
  showPB: boolean
  expanded: boolean
  xAxis: 'solve' | 'date'
  onHover: (index: number | null) => void
  yAxis: ReturnType<typeof trendViewAxis>
  disabled: boolean
  onZoom: (factorX: number, factorY: number, anchorX: number, anchorY: number) => void
  onPan: (fractionX: number, fractionY: number) => void
  onSelectPB: (solveId: string) => void
  pbStatsId: string
}

const TrendChart = memo(function TrendChart({ points, series, customSize, showPB, expanded, xAxis, onHover, yAxis: axis, disabled, onZoom, onPan, onSelectPB, pbStatsId }: ChartProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const clipId = useId()
  const [size, setSize] = useState({ width: 320, height: 180 })
  const [hover, setHover] = useState<number | null>(null)
  const dragRef = useRef<{ id: number; x: number; y: number; startX: number; startY: number; moved: boolean } | null>(null)
  const [dragging, setDragging] = useState(false)
  const suppressClickRef = useRef(false)
  useEffect(() => {
    const host = hostRef.current
    if (!host || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width > 0 && entry.contentRect.height > 0) {
        setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
      }
    })
    observer.observe(host)
    return () => observer.disconnect()
  }, [])
  const width = Math.max(100, size.width)
  const height = Math.max(60, size.height)
  const labelWidth = axis.ticks.reduce((max, tick) => Math.max(max, axisTime(tick).length * 6.2 + 8), 0)
  const margin = { top: 12, right: 12, bottom: 24, left: Math.max(width < 220 ? 32 : 44, labelWidth) }
  const plotW = Math.max(1, width - margin.left - margin.right)
  const plotH = Math.max(1, height - margin.top - margin.bottom)
  const values = useMemo(() => points.flatMap((p) => series.map((s) => valueFor(p, s.key, customSize))), [points, series, customSize])
  const dates = points.map((p) => p.solve.createdAt)
  let minDate = Infinity, maxDate = -Infinity
  for (const date of dates) { minDate = Math.min(minDate, date); maxDate = Math.max(maxDate, date) }
  const xScale = (index: number) => margin.left + (xAxis === 'date' && maxDate > minDate
    ? (dates[index]! - minDate) / (maxDate - minDate)
    : points.length > 1 ? index / (points.length - 1) : 0.5) * plotW
  const yScale = (ms: number) => margin.top + plotH * (1 - (ms - axis.min) / (axis.max - axis.min))
  const pbVisible = showPB && series.some((s) => s.key === 'single')
  const pbMarkers = pbVisible ? points.flatMap((point, index) => point.personalBest && point.singleMs !== null && point.singleMs >= axis.min && point.singleMs <= axis.max
    ? [{ point, x: xScale(index), y: yScale(point.singleMs) }] : []) : []
  const activatePB = (solveId: string) => {
    if (disabled) return
    // The chart remains mounted behind the stats dialog, so native close can
    // restore focus to the exact marker that opened it.
    Array.from(hostRef.current?.querySelectorAll<SVGElement>('[data-pb-id]') ?? []).find((element) => element.dataset.pbId === solveId)?.focus()
    clearHover()
    onSelectPB(solveId)
  }
  const tickCount = Math.min(points.length, width < 240 ? 2 : expanded ? 5 : 3)
  const xTicks = Array.from({ length: tickCount }, (_, i) =>
    Math.round(i * (points.length - 1) / Math.max(1, tickCount - 1)))
  const clearHover = () => { setHover(null); onHover(null) }

  // Native, non-passive listeners keep browser/page zoom out of plot gestures.
  // React's delegated wheel listener can be passive in Chromium.
  useEffect(() => {
    const host = hostRef.current
    if (!host || disabled) return
    const anchor = (clientX: number, clientY: number) => {
      const svg = host.querySelector('svg')
      if (!svg) return null
      const rect = svg.getBoundingClientRect()
      const x = (clientX - rect.left) * width / rect.width
      const y = (clientY - rect.top) * height / rect.height
      return {
        x: Math.max(0, Math.min(1, (x - margin.left) / plotW)),
        y: Math.max(0, Math.min(1, 1 - (y - margin.top) / plotH)),
      }
    }
    let gestureScale = 1
    let gestureAnchor: { x: number; y: number } | null = null
    const wheel = (event: WheelEvent) => {
      const at = anchor(event.clientX, event.clientY)
      if (!at) return
      event.preventDefault()
      event.stopPropagation()
      if (gestureAnchor && event.ctrlKey) return
      const unitX = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? plotW : 1
      const unitY = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? plotH : 1
      const dx = event.deltaX * unitX
      const dy = event.deltaY * unitY
      const factor = (delta: number, speed = 0.003) => Math.exp(-Math.max(-300, Math.min(300, delta)) * speed)
      if (event.ctrlKey) {
        const scale = factor(dy, 0.01)
        onZoom(scale, scale, at.x, at.y)
      } else if (event.shiftKey) {
        onZoom(factor(dx || dy), 1, at.x, at.y)
      } else {
        onZoom(factor(dx), factor(dy), at.x, at.y)
      }
      setHover(null); onHover(null)
    }
    // Safari emits gesture events for trackpad pinches instead of ctrl+wheel.
    type PinchEvent = Event & { scale: number; clientX: number; clientY: number }
    const gestureStart = (raw: Event) => {
      const event = raw as PinchEvent
      gestureAnchor = anchor(event.clientX, event.clientY)
      if (!gestureAnchor) return
      event.preventDefault()
      gestureScale = event.scale > 0 ? event.scale : 1
    }
    const gestureChange = (raw: Event) => {
      const event = raw as PinchEvent
      if (!gestureAnchor || !Number.isFinite(event.scale) || event.scale <= 0) return
      event.preventDefault()
      onZoom(event.scale / gestureScale, event.scale / gestureScale, gestureAnchor.x, gestureAnchor.y)
      gestureScale = event.scale
      setHover(null); onHover(null)
    }
    const gestureEnd = (event: Event) => {
      if (gestureAnchor) event.preventDefault()
      gestureAnchor = null
    }
    host.addEventListener('wheel', wheel, { passive: false })
    host.addEventListener('gesturestart', gestureStart, { passive: false })
    host.addEventListener('gesturechange', gestureChange, { passive: false })
    host.addEventListener('gestureend', gestureEnd, { passive: false })
    return () => {
      host.removeEventListener('wheel', wheel)
      host.removeEventListener('gesturestart', gestureStart)
      host.removeEventListener('gesturechange', gestureChange)
      host.removeEventListener('gestureend', gestureEnd)
    }
  }, [disabled, width, height, margin.left, margin.top, plotW, plotH, onZoom, onPan, onHover])

  return (
    <div className={`time-trend-chart${dragging ? ' is-panning' : ''}`} ref={hostRef} data-testid="time-trend-chart" title={GESTURE_HELP}>
      {points.length === 0 || !values.some((v) => v !== null) ? (
        <p className="time-trend-empty" role="status">{points.length === 0 ? 'Record a solve to see your trend.' : series.length === 0 ? 'Select a series to plot.' : 'No valid times in the selected series yet.'}</p>
      ) : (
        <svg viewBox={`0 0 ${width} ${height}`} role="group" aria-label="Solve times and rolling averages; oldest to newest" data-testid="time-trend-svg" data-y-min={axis.min} data-y-max={axis.max}
          onPointerDown={(event) => {
            if (disabled || event.button !== 0) return
            event.preventDefault()
            event.stopPropagation()
            dragRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, moved: false }
            suppressClickRef.current = false
            event.currentTarget.setPointerCapture(event.pointerId)
            clearHover()
          }}
          onPointerUp={(event) => {
            if (dragRef.current?.id !== event.pointerId) return
            suppressClickRef.current = dragRef.current.moved
            dragRef.current = null
            setDragging(false)
            event.currentTarget.releasePointerCapture(event.pointerId)
          }}
          onPointerCancel={() => { suppressClickRef.current = true; dragRef.current = null; setDragging(false) }}
          onLostPointerCapture={() => { dragRef.current = null; setDragging(false) }}
          onPointerMove={(event) => {
            const drag = dragRef.current
            if (drag && drag.id === event.pointerId) {
              if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4) return
              setDragging(true)
              const rect = event.currentTarget.getBoundingClientRect()
              onPan(-(event.clientX - drag.x) * width / rect.width / plotW, (event.clientY - drag.y) * height / rect.height / plotH)
              dragRef.current = { ...drag, x: event.clientX, y: event.clientY, moved: true }
              return
            }
            const rect = event.currentTarget.getBoundingClientRect()
            const x = (event.clientX - rect.left) * width / rect.width
            if (x < margin.left || x > margin.left + plotW) { clearHover(); return }
            let nearest = 0, distance = Infinity
            for (let i = 0; i < points.length; i++) {
              const delta = Math.abs(xScale(i) - x)
              if (delta < distance) { distance = delta; nearest = i }
            }
            setHover(nearest); onHover(nearest)
          }} onPointerLeave={clearHover}
          onClick={(event) => {
            if (disabled || suppressClickRef.current) return
            const target = event.target instanceof Element ? event.target.closest<SVGElement>('[data-pb-id]') : null
            if (event.detail === 0 && target?.dataset.pbId) { activatePB(target.dataset.pbId); return }
            const rect = event.currentTarget.getBoundingClientRect()
            const x = (event.clientX - rect.left) * width / rect.width
            const y = (event.clientY - rect.top) * height / rect.height
            let nearest: typeof pbMarkers[number] | null = null
            let distance = 14
            for (const marker of pbMarkers) {
              const delta = Math.hypot(marker.x - x, marker.y - y)
              if (delta <= distance) { nearest = marker; distance = delta }
            }
            if (nearest) activatePB(nearest.point.solve.id)
          }}>

          <defs><clipPath id={clipId}><rect x={margin.left} y={margin.top} width={plotW} height={plotH} /></clipPath></defs>
          {axis.ticks.map((tick) => <g key={tick}>
            <line className="time-trend-grid" x1={margin.left} y1={yScale(tick)} x2={width - margin.right} y2={yScale(tick)} />
            <text className="time-trend-axis-label" x={margin.left - 6} y={yScale(tick) + 3} textAnchor="end" data-testid="time-trend-y-tick">{axisTime(tick)}</text>
          </g>)}
          <line className="time-trend-axis" x1={margin.left} y1={margin.top + plotH} x2={width - margin.right} y2={margin.top + plotH} />
          {xTicks.map((index, i) => <text key={i} className="time-trend-axis-label" x={xScale(index)} y={height - 6} textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}>
            {xAxis === 'date' ? shortDate(dates[index]!) : `#${points[index]!.index}`}
          </text>)}
          <g clipPath={`url(#${clipId})`} data-testid="time-trend-plot">
            {series.map((s) => <path key={s.key} data-series={s.key} d={trendPath(points.map((p, i) => {
              const value = valueFor(p, s.key, customSize)
              return value === null ? null : { x: xScale(i), y: yScale(value) }
            }), Math.max(20, Math.floor(plotW)))} fill="none" stroke={color(s.key)} strokeWidth={s.key === 'single' ? 0.8 : 1.5} opacity={s.key === 'single' ? 0.5 : 0.95} strokeLinejoin="round" />)}
            {points.length === 1 && series.some((s) => s.key === 'single') && points[0]!.singleMs !== null && <circle cx={xScale(0)} cy={yScale(points[0]!.singleMs)} r={2} fill={color('single')} />}
            {pbVisible && points.map((point, i) => point.personalBest && point.singleMs !== null ? <circle key={point.solve.id} data-testid="time-trend-pb" cx={xScale(i)} cy={yScale(point.singleMs)} r={expanded ? 2.5 : 1.6} fill={color('pb')} stroke="var(--surface)" strokeWidth={0.7}>
              <title>{`PB · Solve #${point.index} · ${formatTime(point.singleMs)}`}</title>
            </circle> : null)}
            {hover !== null && points[hover] && <line className="time-trend-crosshair" x1={xScale(hover)} x2={xScale(hover)} y1={margin.top} y2={margin.top + plotH} />}
          </g>
          {pbMarkers.map(({ point, x, y }) => <g key={point.solve.id} className="time-trend-pb-hit" role="button" tabIndex={disabled ? -1 : 0} aria-disabled={disabled} aria-haspopup="dialog" aria-controls={pbStatsId}
            aria-label={`PB solve #${point.index}, ${formatTime(point.singleMs!)}. Show stats`} data-pb-id={point.solve.id}
            onKeyDown={(event) => {
              if (disabled) return
              if (event.key === 'Enter' || (expanded && event.key === ' ')) {
                event.preventDefault(); event.stopPropagation(); activatePB(point.solve.id)
              }
            }}>
            <title>{`PB · Solve #${point.index} · ${formatTime(point.singleMs!)} · Show stats`}</title>
            <circle cx={x} cy={y} r={14} fill="transparent" />
          </g>)}
        </svg>
      )}
    </div>
  )
})

export const TimeTrend = memo(function TimeTrend({ solves, compact = false, disabled = false, trimming = DEFAULT_AVERAGE_TRIMMING }: Props) {
  const [enabled, setEnabled] = useState<SeriesId[]>(['single', 'ao5', 'ao12'])
  const [customSize, setCustomSize] = useState(10)
  const [customDraft, setCustomDraft] = useState('10')
  const [expanded, setExpanded] = useState(false)
  const [hover, setHover] = useState<number | null>(null)
  const [selectedPBId, setSelectedPBId] = useState<string | null>(null)
  const pbStatsId = useId()
  const pbAverageSizes = useMemo(() => [...SERIES.flatMap((entry) => entry.size ? [entry.size] : []), ...(enabled.includes('custom') ? [customSize] : [])], [enabled, customSize])
  const [xView, setXView] = useState<TrendAxisView>({ zoom: 1, position: 1 })
  const [yView, setYView] = useState<TrendAxisView>({ zoom: 1, position: 0.5 })
  const [zoomAxes, setZoomAxes] = useState<'both' | 'x' | 'y'>('both')
  const { zoom, position } = xView
  const [showPB, setShowPB] = useState(true)
  const [xAxis, setXAxis] = useState<'solve' | 'date'>('solve')
  const { dialogRef, handleKeyDown } = useModalDialog(expanded)
  const titleId = useId()
  const descriptionId = useId()
  const series = useMemo(() => [...SERIES.filter((s) => enabled.includes(s.key)), ...(enabled.includes('custom') ? [{ key: 'custom' as const, label: `ao${customSize}`, size: customSize }] : [])], [enabled, customSize])
  const sizes = useMemo(() => [...new Set([5, 12, ...series.flatMap((s) => s.size ? [s.size] : [])])], [series])
  const points = useMemo(() => buildTrendData(solves, sizes, trimming), [solves, sizes, trimming])
  const selectedPB = useMemo(() => selectedPBId === null ? null : buildPBStats(points, selectedPBId, pbAverageSizes, trimming), [points, selectedPBId, pbAverageSizes, trimming])
  const closePBStats = useCallback(() => setSelectedPBId(null), [])
  const fullYAxis = useMemo(() => trendAxis(points.flatMap((p) => series.map((s) => valueFor(p, s.key, customSize)))), [points, series, customSize])
  const yAxis = useMemo(() => trendViewAxis(fullYAxis, yView, expanded ? 5 : 3), [fullYAxis, yView, expanded])
  const maxYZoom = Math.max(1, Math.min(1000, (fullYAxis.max - fullYAxis.min) / 100))
  const handleZoom = useCallback((factorX: number, factorY: number, anchorX: number, anchorY: number) => {
    setXView((view) => zoomTrendAxis(view, factorX, anchorX, points.length / 2))
    setYView((view) => zoomTrendAxis(view, factorY, anchorY, maxYZoom))
    setHover(null)
  }, [points.length, maxYZoom])
  const handlePan = useCallback((fractionX: number, fractionY: number) => {
    setXView((view) => panTrendAxis(view, fractionX))
    setYView((view) => panTrendAxis(view, fractionY))
    setHover(null)
  }, [])
  const setPosition = (next: number | ((previous: number) => number)) => setXView((view) => ({ ...view, position: typeof next === 'function' ? next(view.position) : next }))
  const count = Math.min(points.length, Math.max(2, Math.ceil(points.length / zoom)))
  const start = Math.round((points.length - count) * position)
  const visiblePoints = useMemo(() => points.slice(start, start + count), [points, start, count])
  const hovered = hover === null ? null : visiblePoints[hover]
  const stats = useMemo(() => {
    const valid = visiblePoints.flatMap((p) => p.singleMs === null ? [] : [p.singleMs])
    if (valid.length === 0) return null
    const mean = valid.reduce((a, b) => a + b, 0) / valid.length
    const bestAverage = (key: `ao${number}`) => {
      const values = visiblePoints.flatMap((p) => typeof p.averages[key] === 'number' ? [p.averages[key]!] : [])
      return values.length ? values.reduce((a, b) => Math.min(a, b), Infinity) : null
    }
    let improvement: number | null = null
    if (visiblePoints.length >= 20) {
      const section = Math.max(1, Math.floor(visiblePoints.length * 0.1))
      const meanFor = (range: TrendPoint[]) => {
        const times = range.flatMap((p) => p.singleMs === null ? [] : [p.singleMs])
        return times.length ? times.reduce((a, b) => a + b, 0) / times.length : null
      }
      const first = meanFor(visiblePoints.slice(0, section))
      const last = meanFor(visiblePoints.slice(-section))
      if (first !== null && first > 0 && last !== null) improvement = (first - last) / first * 100
    }
    return { mean, bestAo5: bestAverage('ao5'), bestAo12: bestAverage('ao12'), improvement, best: valid.reduce((a, b) => Math.min(a, b), Infinity), sd: Math.sqrt(valid.reduce((sum, v) => sum + (v - mean) ** 2, 0) / valid.length), dnfs: visiblePoints.length - valid.length }
  }, [visiblePoints])
  const zoomButton = (factor: number) => handleZoom(zoomAxes === 'y' ? 1 : factor, zoomAxes === 'x' ? 1 : factor, 1, 0.5)
  const fitAll = () => { setXView({ zoom: 1, position: 1 }); setYView({ zoom: 1, position: 0.5 }); setHover(null) }
  const toggle = (key: SeriesId) => setEnabled((current) => current.includes(key) ? current.filter((s) => s !== key) : [...current, key])
  const legend = <div className="time-trend-legend" data-testid="time-trend-legend">
    {series.map((s) => <span key={s.key}><i style={{ background: color(s.key) }} />{s.label}</span>)}
    {showPB && enabled.includes('single') && <span><i className="is-pb" style={{ background: color('pb') }} />PB</span>}
  </div>
  const chart = <TrendChart key={expanded ? 'expanded' : 'compact'} points={visiblePoints} series={series} customSize={customSize} showPB={showPB} expanded={expanded} xAxis={xAxis} onHover={setHover} yAxis={yAxis} disabled={disabled} onZoom={handleZoom} onPan={handlePan} onSelectPB={setSelectedPBId} pbStatsId={pbStatsId} />

  return (
    <div className={`time-trend${compact ? ' is-compact' : ''}`} data-testid="time-trend">
      <div className="time-trend-header">
        <span className="time-trend-caption">{points.length.toLocaleString()} solves</span>
        <span className="time-trend-header-actions">{!expanded && (zoom > 1 || yView.zoom > 1) && <button type="button" className="time-trend-button" onClick={fitAll} aria-label="Reset Time Trend view">Fit</button>}<button type="button" className="time-trend-button" onClick={() => { setHover(null); setExpanded(true) }} disabled={disabled} data-testid="time-trend-expand" aria-label="Expand Time Trend" aria-haspopup="dialog">Expand ↗</button></span>
      </div>
      {!expanded && <>{chart}{legend}</>}
      <PBStatsDialog id={pbStatsId} stats={selectedPB} onClose={closePBStats} />
      {createPortal(
        <dialog ref={dialogRef} className="time-trend-dialog" data-testid="time-trend-modal" aria-labelledby={titleId} aria-describedby={descriptionId}
          onKeyDown={(event) => { event.stopPropagation(); handleKeyDown(event) }} onKeyUp={(event) => event.stopPropagation()}
          onCancel={(event) => { event.preventDefault(); setExpanded(false); setHover(null) }}
          onClick={(event) => { if (event.target === event.currentTarget) { setExpanded(false); setHover(null) } }}>
          {expanded && <div className="time-trend-expanded">
            <header className="time-trend-modal-header">
              <div><h2 id={titleId}>Time Trend</h2><p id={descriptionId}>Solve times and rolling averages, oldest to newest.</p></div>
              <button type="button" className="time-trend-button" onClick={() => { setExpanded(false); setHover(null) }} data-testid="time-trend-modal-close" aria-label="Close Time Trend">Close</button>
            </header>
            <div className="time-trend-series" aria-label="Chart series">
              {SERIES.map((s) => <button key={s.key} type="button" className="time-trend-chip" aria-pressed={enabled.includes(s.key)} onClick={() => toggle(s.key)}><i style={{ background: color(s.key) }} />{s.label}</button>)}
              <button type="button" className="time-trend-chip" aria-pressed={enabled.includes('custom')} onClick={() => toggle('custom')}>Custom</button>
              <label className="time-trend-custom">ao<input type="number" aria-label="Custom average size" min={3} max={10000} step={1} value={customDraft} onBlur={() => setCustomDraft(String(customSize))} onChange={(e) => {
                setCustomDraft(e.target.value)
                const value = e.target.valueAsNumber
                if (Number.isInteger(value) && value >= 3 && value <= 10000) setCustomSize(value)
              }} /></label>
              <button type="button" className="time-trend-chip" aria-pressed={showPB} onClick={() => setShowPB((show) => !show)}>PB markers</button>
            </div>
            {chart}
            {legend}
            <div className="time-trend-navigation" aria-label="Chart view">
              <div className="time-trend-navigation-buttons">
                <button type="button" className="time-trend-button" disabled={count === points.length || position === 0} onClick={() => { setPosition((p) => Math.max(0, p - 0.25)); setHover(null) }} aria-label="Earlier solves">←</button>
                <button type="button" className="time-trend-button" disabled={count === points.length || position === 1} onClick={() => { setPosition((p) => Math.min(1, p + 0.25)); setHover(null) }} aria-label="Later solves">→</button>
                <button type="button" className="time-trend-button" disabled={(zoomAxes === 'y' || count <= 2) && (zoomAxes === 'x' || yView.zoom >= maxYZoom)} onClick={() => zoomButton(2)}>Zoom in</button>
                <button type="button" className="time-trend-button" disabled={(zoomAxes === 'y' || zoom <= 1) && (zoomAxes === 'x' || yView.zoom <= 1)} onClick={() => zoomButton(0.5)}>Zoom out</button>
                <button type="button" className="time-trend-button" onClick={fitAll}>Fit all</button>
              </div>
              <label className="time-trend-axis-select">Zoom axes<select value={zoomAxes} onChange={(event) => setZoomAxes(event.target.value as 'both' | 'x' | 'y')}><option value="both">Both</option><option value="x">Horizontal</option><option value="y">Vertical</option></select></label>
              <label className="time-trend-axis-select">X axis<select value={xAxis} onChange={(e) => { setXAxis(e.target.value as 'solve' | 'date'); setHover(null) }}><option value="solve">Solve #</option><option value="date">Date</option></select></label>
            </div>
            <p className="time-trend-gesture-help">{GESTURE_HELP}</p>
            <div className="time-trend-range">
              <span data-testid="time-trend-visible-range">{count ? `Solves #${start + 1}–${start + count} of ${points.length.toLocaleString()}` : 'No solves'}</span>
              <input type="range" aria-label="Visible solve range" min={0} max={1} step={0.001} value={position} disabled={count === points.length} onChange={(e) => { setPosition(Number(e.target.value)); setHover(null) }} />
            </div>
            <div className="time-trend-details" data-testid="time-trend-tooltip" aria-live="off">
              {hovered ? <><strong>#{hovered.index} · {hovered.singleMs === null ? 'DNF' : formatTime(hovered.singleMs)}{hovered.solve.penalty === '+2' ? ' (+2)' : ''}</strong><span>{new Date(hovered.solve.createdAt).toLocaleString()}</span>{series.filter((s) => s.size).map((s) => <span key={s.key}>{s.label}: {valueFor(hovered, s.key, customSize) === null ? '—' : formatTime(valueFor(hovered, s.key, customSize)!)}</span>)}{hovered.solve.comment && <span>{hovered.solve.comment}</span>}{hovered.solve.scramble && <span className="time-trend-scramble">{hovered.solve.scramble}</span>}</> : <span>Point to the chart to inspect a solve.</span>}
            </div>
            <footer className="time-trend-stats" data-testid="time-trend-range-stats">
              <span>Solves <strong>{count.toLocaleString()}</strong></span><span>Mean <strong>{stats ? formatTime(stats.mean) : '—'}</strong></span><span>Best <strong>{stats ? formatTime(stats.best) : '—'}</strong></span><span>Best ao5 <strong>{stats?.bestAo5 !== null && stats?.bestAo5 !== undefined ? formatTime(stats.bestAo5) : '—'}</strong></span><span>Best ao12 <strong>{stats?.bestAo12 !== null && stats?.bestAo12 !== undefined ? formatTime(stats.bestAo12) : '—'}</strong></span><span>SD <strong>{stats ? `${(stats.sd / 1000).toFixed(2)}s` : '—'}</strong></span><span>DNFs <strong>{stats?.dnfs ?? count}</strong></span>{stats?.improvement !== null && stats?.improvement !== undefined && <span>Improvement <strong>{stats.improvement.toFixed(1)}%</strong></span>}
            </footer>
          </div>}
        </dialog>, document.body,
      )}
    </div>
  )
})
