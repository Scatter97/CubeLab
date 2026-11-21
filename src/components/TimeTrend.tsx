import {
  memo,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react'
import {
  buildPBStats,
  buildTrendData,
  latestPersonalBest,
  panTrendAxis,
  trendAxis,
  trendOutlierLimit,
  trendPath,
  trendViewAxis,
  zoomTrendAxis,
  type TrendAxisView,
  type TrendPoint,
} from '../lib/timeTrend'
import { DEFAULT_AVERAGE_TRIMMING } from '../lib/averageTrimming'
import type { AverageTrimming, Solve, TimeTrendCutoff, TimeTrendScale } from '../types'
import { formatStatValue, formatTime } from '../lib/format'

const AVERAGE_KEYS = ['ao5', 'ao12'] as const
const AVERAGE_SIZES = [5, 12]

interface SeriesDefinition {
  key: 'single' | 'average'
  label: string
  average?: (typeof AVERAGE_KEYS)[number]
}

const SERIES: readonly SeriesDefinition[] = [
  { key: 'single', label: 'time' },
  { key: 'average', label: 'ao5', average: 'ao5' },
  { key: 'average', label: 'ao12', average: 'ao12' },
]
const PB_HIT_RADIUS = 16

type Selection = { kind: 'solve' | 'pb'; index: number }

const color = (key: 'single' | 'ao5' | 'ao12' | 'pb') => `var(--trend-${key})`
const axisTime = (ms: number) => ms >= 60000
  ? formatTime(Math.round(ms / 10) * 10).replace(/\.00$/, '')
  : `${Number((ms / 1000).toFixed(2))}`
const shortDate = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
const averageValue = (point: TrendPoint, key: (typeof AVERAGE_KEYS)[number]) => point.averages[key] ?? null
const effectiveLabel = (point: TrendPoint) => point.singleMs === null
  ? 'DNF'
  : `${formatTime(point.singleMs)}${point.solve.penalty === '+2' ? ' (+2)' : ''}`
const averageLabel = (value: number | null) => value === null ? '—' : formatTime(value)

function describePoint(point: TrendPoint, total: number, currentPBId: string | null): string {
  const pb = point.personalBest
    ? point.solve.id === currentPBId
      ? ' Current personal best.'
      : ' Personal best.'
    : ''
  const time = point.singleMs === null
    ? 'DNF'
    : `${formatTime(point.singleMs)}${point.solve.penalty === '+2' ? ' plus two' : ''}`
  return `Solve ${point.index} of ${total}. ${time}.${pb}`
}

interface CardProps {
  cardRef: RefObject<HTMLDivElement | null>
  onPointerEnter: () => void
  style: CSSProperties
}

function GenericSolveCard({ point, total, cardRef, onPointerEnter, style }: CardProps & { point: TrendPoint; total: number }) {
  return (
    <div
      ref={cardRef}
      className="time-trend-hover-card"
      data-testid="time-trend-hover-card"
      data-kind="solve"
      role="group"
      aria-label={`Solve ${point.index} details`}
      style={style}
      onPointerEnter={onPointerEnter}
    >
      <strong data-testid="time-trend-card-title">Solve #{point.index} of {total}</strong>
      <div className="time-trend-card-main">
        <span className="time-trend-card-time" data-testid="time-trend-card-time">{effectiveLabel(point)}</span>
        <span className="time-trend-card-date" data-testid="time-trend-card-date">{shortDate(point.solve.createdAt)}</span>
      </div>
      <dl className="time-trend-card-stats">
        {AVERAGE_KEYS.map((key) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd data-testid={`time-trend-card-${key}`}>{averageLabel(averageValue(point, key))}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function PBCard({
  stats,
  current,
  total,
  cardRef,
  onPointerEnter,
  style,
}: CardProps & {
  stats: NonNullable<ReturnType<typeof buildPBStats>>
  current: boolean
  total: number
}) {
  const { point, previousPB, improvementMs, improvementPercent } = stats
  return (
    <div
      ref={cardRef}
      className="time-trend-hover-card is-pb"
      data-testid="time-trend-hover-card"
      data-kind="pb"
      role="group"
      aria-label={`${current ? 'Current personal best' : 'Personal best'} solve ${point.index} details`}
      style={style}
      onPointerEnter={onPointerEnter}
    >
      <strong data-testid="time-trend-card-title">{current ? 'Current PB' : 'PB'} · #{point.index} of {total}</strong>
      <div className="time-trend-card-main">
        <span className="time-trend-card-time" data-testid="time-trend-card-time">{effectiveLabel(point)}</span>
        {improvementMs !== null ? (
          <span className="time-trend-card-improvement" data-testid="time-trend-pb-improvement">
            {formatTime(improvementMs)} faster{improvementPercent !== null ? ` (${improvementPercent.toFixed(1)}%)` : ''}
          </span>
        ) : (
          <span className="time-trend-card-improvement" data-testid="time-trend-pb-improvement">First PB</span>
        )}
      </div>
      <div className="time-trend-card-meta">
        <span data-testid="time-trend-card-date">{shortDate(point.solve.createdAt)}</span>
        <span>
          Prev <span data-testid="time-trend-pb-previous">
            {previousPB?.singleMs !== null && previousPB?.singleMs !== undefined
              ? `${formatTime(previousPB.singleMs)} · #${previousPB.index}`
              : '—'}
          </span>
        </span>
      </div>
      <dl className="time-trend-card-stats">
        {stats.results.map((result) => (
          <div key={result.label}>
            <dt>{result.label}</dt>
            <dd data-testid={`time-trend-pb-${result.label}`}>{formatStatValue(result.value)}</dd>
          </div>
        ))}
      </dl>
      {point.solve.scramble ? (
        <p className="time-trend-card-scramble" title={point.solve.scramble}>
          {point.solve.scramble}
        </p>
      ) : null}
    </div>
  )
}

function AxisIcon({ axis }: { axis: 'x' | 'y' }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      {axis === 'x'
        ? <path d="M2 8h12M4.5 5.5 2 8l2.5 2.5M11.5 5.5 14 8l-2.5 2.5" />
        : <path d="M8 2v12M5.5 4.5 8 2l2.5 2.5M5.5 11.5 8 14l2.5-2.5" />}
    </svg>
  )
}

function PanIcon({ direction }: { direction: 'earlier' | 'later' }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      {direction === 'earlier'
        ? <path d="M10 3 5 8l5 5" />
        : <path d="M6 3l5 5-5 5" />}
    </svg>
  )
}

function ZoomIcon({ direction }: { direction: 'in' | 'out' }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <circle cx="7" cy="7" r="4.5" />
      <path d="m10.5 10.5 3 3" />
      <path d="M5 7h4" />
      {direction === 'in' ? <path d="M7 5v4" /> : null}
    </svg>
  )
}

interface Props {
  solves: readonly Solve[]
  /** Retained for callers that explicitly request the compact presentation. */
  compact?: boolean
  disabled?: boolean
  trimming?: AverageTrimming
  scale?: TimeTrendScale
  cutoff?: TimeTrendCutoff
}

export const TimeTrend = memo(function TimeTrend({
  solves,
  disabled = false,
  trimming = DEFAULT_AVERAGE_TRIMMING,
  scale = 'auto',
  cutoff = 'balanced',
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const hoverCloseTimer = useRef<number | null>(null)
  const clipId = useId()
  const [size, setSize] = useState({ width: 320, height: 180 })
  const [xView, setXView] = useState<TrendAxisView>({ zoom: 1, position: 1 })
  const [yView, setYView] = useState<TrendAxisView>({ zoom: 1, position: 0.5 })
  const [axis, setAxis] = useState<'x' | 'y'>('x')
  const [hover, setHover] = useState<Selection | null>(null)
  const [pinned, setPinned] = useState<Selection | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [cardPosition, setCardPosition] = useState<{ left: number; top: number } | null>(null)

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

  useEffect(() => () => {
    if (hoverCloseTimer.current !== null) window.clearTimeout(hoverCloseTimer.current)
  }, [])

  // A settings change resets only the Y viewport; X navigation stays put.
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    setYView({ zoom: 1, position: 0.5 })
    // oxlint-disable-next-line react/set-state-in-effect
    setHover(null)
    // oxlint-disable-next-line react/set-state-in-effect
    setPinned(null)
    // oxlint-disable-next-line react/set-state-in-effect
    setAnnouncement('')
  }, [scale, cutoff])

  // Timer activity locks the details card as well as the plotting controls.
  useEffect(() => {
    if (!disabled) return
    // oxlint-disable-next-line react/set-state-in-effect
    setHover(null)
    // oxlint-disable-next-line react/set-state-in-effect
    setPinned(null)
    // oxlint-disable-next-line react/set-state-in-effect
    setAnnouncement('')
  }, [disabled])

  const points = useMemo(() => buildTrendData(solves, AVERAGE_SIZES, trimming), [solves, trimming])
  const currentPB = useMemo(() => latestPersonalBest(points), [points])
  const currentPBId = currentPB?.solve.id ?? null

  const axisValues = useMemo(() => {
    const singles: number[] = []
    const averages: number[] = []
    const all: (number | null)[] = []
    for (const point of points) {
      if (point.singleMs !== null) {
        singles.push(point.singleMs)
        all.push(point.singleMs)
      }
      for (const key of AVERAGE_KEYS) {
        const value = averageValue(point, key)
        all.push(value)
        if (value !== null) averages.push(value)
      }
    }
    return { singles, averages, all }
  }, [points])
  const fullYAxis = useMemo(() => trendAxis(axisValues.all), [axisValues])
  const autoLimit = useMemo(
    () => trendOutlierLimit(axisValues.singles, axisValues.averages, cutoff),
    [axisValues, cutoff],
  )
  const autoYAxis = useMemo(() => trendAxis(axisValues.all, 5, autoLimit), [axisValues, autoLimit])
  const effectiveYAxis = useMemo(
    () => scale === 'auto' ? autoYAxis : fullYAxis,
    [scale, autoYAxis, fullYAxis],
  )
  const yAxis = useMemo(
    () => trendViewAxis(effectiveYAxis, yView, 3),
    [effectiveYAxis, yView],
  )

  const width = Math.max(100, size.width)
  const height = Math.max(80, size.height)
  const labelWidth = yAxis.ticks.reduce((max, tick) => Math.max(max, axisTime(tick).length * 6.2 + 8), 0)
  const margin = { top: 10, right: 10, bottom: 10, left: Math.max(width < 220 ? 32 : 44, labelWidth) }
  const plotW = Math.max(1, width - margin.left - margin.right)
  const plotH = Math.max(1, height - margin.top - margin.bottom)
  const plotBottom = margin.top + plotH

  const count = points.length <= 1
    ? points.length
    : Math.min(points.length, Math.max(2, Math.ceil(points.length / xView.zoom)))
  const start = points.length <= count ? 0 : Math.round((points.length - count) * xView.position)
  const visiblePoints = useMemo(() => points.slice(start, start + count), [points, start, count])
  const maxXZoom = points.length > 1 ? points.length / 2 : 1
  const maxYZoom = Math.max(1, Math.min(1000, (effectiveYAxis.max - effectiveYAxis.min) / 100))

  const xPositions = useMemo(
    () => visiblePoints.map((_, index) => visiblePoints.length > 1
      ? margin.left + (index / (visiblePoints.length - 1)) * plotW
      : margin.left + plotW / 2),
    [visiblePoints, margin.left, plotW],
  )
  const xScale = (index: number) => xPositions[index] ?? margin.left
  const yScale = (ms: number) => margin.top + plotH * (1 - (ms - yAxis.min) / (yAxis.max - yAxis.min))

  const seriesPaths = useMemo(() => {
    const yFor = (ms: number) => margin.top + plotH * (1 - (ms - yAxis.min) / (yAxis.max - yAxis.min))
    return SERIES.flatMap((series) => {
      if (series.key === 'average' && !series.average) return []
      const values = visiblePoints.map((point, index) => {
        const value = series.key === 'single' ? point.singleMs : averageValue(point, series.average!)
        return value === null ? null : { x: xPositions[index]!, y: yFor(value) }
      })
      return [{
        key: series.average ?? series.key,
        color: series.average ?? series.key,
        d: trendPath(values, Math.max(20, Math.floor(plotW))),
      }]
    })
  }, [visiblePoints, xPositions, plotW, yAxis.min, yAxis.max, plotH, margin.top])

  const pbMarkers = useMemo(() => {
    const markers: { point: TrendPoint; x: number; y: number; current: boolean }[] = []
    const yFor = (ms: number) => margin.top + plotH * (1 - (ms - yAxis.min) / (yAxis.max - yAxis.min))
    visiblePoints.forEach((point, index) => {
      if (!point.personalBest || point.singleMs === null) return
      if (point.singleMs < yAxis.min || point.singleMs > yAxis.max) return
      markers.push({
        point,
        x: xPositions[index]!,
        y: yFor(point.singleMs),
        current: point.solve.id === currentPBId,
      })
    })
    return markers
  }, [visiblePoints, xPositions, yAxis.min, yAxis.max, plotH, margin.top, currentPBId])

  const activeSelection = disabled ? null : hover ?? pinned
  const activePoint = activeSelection && activeSelection.index >= 0 && activeSelection.index < points.length
    ? points[activeSelection.index]!
    : null
  const pbSolveId = activeSelection?.kind === 'pb' && activePoint?.personalBest
    ? activePoint.solve.id
    : null
  const pbStats = useMemo(
    () => pbSolveId === null ? null : buildPBStats(points, pbSolveId, AVERAGE_SIZES, trimming),
    [points, pbSolveId, trimming],
  )
  const selectionLocal = activeSelection ? activeSelection.index - start : -1
  const crosshairX = selectionLocal >= 0 && selectionLocal < visiblePoints.length
    ? xPositions[selectionLocal]
    : null
  const hasVisibleValues = visiblePoints.some((point) =>
    point.singleMs !== null || AVERAGE_KEYS.some((key) => averageValue(point, key) !== null))
  const hasAnyValues = points.some((point) =>
    point.singleMs !== null || AVERAGE_KEYS.some((key) => averageValue(point, key) !== null))
  const emptyMessage = points.length === 0
    ? 'Record a solve to see your trend.'
    : !hasAnyValues
      ? 'No valid times in this session yet.'
      : 'No valid times in this view.'

  const cancelHoverClose = () => {
    if (hoverCloseTimer.current !== null) {
      window.clearTimeout(hoverCloseTimer.current)
      hoverCloseTimer.current = null
    }
  }

  const scheduleHoverClose = () => {
    if (hoverCloseTimer.current !== null || !hover) return
    hoverCloseTimer.current = window.setTimeout(() => {
      hoverCloseTimer.current = null
      setHover(null)
    }, 140)
  }

  const clearInspection = () => {
    cancelHoverClose()
    setHover(null)
    setPinned(null)
    setAnnouncement('')
  }

  const selectByKeyboard = (index: number) => {
    const point = points[index]
    if (!point) return
    setHover(null)
    setPinned({ kind: point.personalBest ? 'pb' : 'solve', index })
    setAnnouncement(describePoint(point, points.length, currentPBId))
    if (points.length <= 1 || (index >= start && index < start + count)) return
    const span = 1 / xView.zoom
    const fraction = index / (points.length - 1)
    const position = span >= 1
      ? 1
      : Math.max(0, Math.min(1, (fraction - span / 2) / (1 - span)))
    setXView((view) => ({ ...view, position }))
  }

  const handleKeyDown = (event: ReactKeyboardEvent<SVGSVGElement>) => {
    if (disabled || points.length === 0) return
    const current = pinned?.index ?? hover?.index ?? null
    if (event.key === 'Escape') {
      if (hover || pinned) {
        event.preventDefault()
        clearInspection()
      }
      return
    }
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    let next: number
    if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = points.length - 1
    else if (current === null) next = event.key === 'ArrowRight' ? 0 : points.length - 1
    else next = Math.max(0, Math.min(points.length - 1, current + (event.key === 'ArrowRight' ? 1 : -1)))
    if (next !== current) selectByKeyboard(next)
  }

  const chartCoordinates = (clientX: number, clientY: number) => {
    const svg = svgRef.current
    if (!svg) return null
    const rect = svg.getBoundingClientRect()
    const scaleX = rect.width > 0 ? width / rect.width : 1
    const scaleY = rect.height > 0 ? height / rect.height : 1
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    }
  }

  const hitPB = (x: number, y: number) => {
    let nearest: { point: TrendPoint; x: number; y: number; current: boolean } | null = null
    let distance = PB_HIT_RADIUS
    for (const marker of pbMarkers) {
      const delta = Math.hypot(marker.x - x, marker.y - y)
      if (delta <= distance) {
        nearest = marker
        distance = delta
      }
    }
    return nearest
  }

  const pinAt = (x: number, y: number) => {
    const marker = hitPB(x, y)
    if (marker) {
      cancelHoverClose()
      setPinned({ kind: 'pb', index: marker.point.index - 1 })
      setAnnouncement(describePoint(marker.point, points.length, currentPBId))
      return
    }
    // Ordinary solves are not click targets in the compact chart.
    setPinned(null)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled) return
    if (event.target instanceof Element && event.target.closest('.time-trend-hover-card')) {
      cancelHoverClose()
      return
    }
    const at = chartCoordinates(event.clientX, event.clientY)
    if (!at || at.x < margin.left || at.x > margin.left + plotW || at.y < margin.top || at.y > plotBottom) {
      scheduleHoverClose()
      return
    }
    const marker = hitPB(at.x, at.y)
    if (marker) {
      cancelHoverClose()
      setHover({ kind: 'pb', index: marker.point.index - 1 })
      return
    }
    // Compact mouse hover is PB-only. Solve details remain available through
    // tap/keyboard inspection instead of a nearest-point card.
    scheduleHoverClose()
  }

  const changeAxis = () => {
    setAxis((value) => value === 'x' ? 'y' : 'x')
    clearInspection()
  }

  const pan = (direction: 'earlier' | 'later') => {
    const fraction = direction === 'later' ? 0.25 : -0.25
    if (axis === 'x') setXView((view) => panTrendAxis(view, fraction))
    else setYView((view) => panTrendAxis(view, fraction))
    clearInspection()
  }

  const zoom = (direction: 'in' | 'out') => {
    const factor = direction === 'in' ? Math.SQRT2 : 1 / Math.SQRT2
    if (axis === 'x') setXView((view) => zoomTrendAxis(view, factor, 0.5, maxXZoom))
    else setYView((view) => zoomTrendAxis(view, factor, 0.5, maxYZoom))
    clearInspection()
  }

  const xCanPan = xView.zoom > 1
  const yCanPan = yView.zoom > 1
  const panEarlierDisabled = disabled ||
    (axis === 'x' ? !xCanPan || xView.position <= 0 : !yCanPan || yView.position <= 0)
  const panLaterDisabled = disabled ||
    (axis === 'x' ? !xCanPan || xView.position >= 1 : !yCanPan || yView.position >= 1)
  const zoomInDisabled = disabled ||
    (axis === 'x'
      ? points.length <= 1 || xView.zoom >= maxXZoom
      : yView.zoom >= maxYZoom)
  const zoomOutDisabled = disabled ||
    (axis === 'x' ? xView.zoom <= 1 : yView.zoom <= 1)
  const axisLabel = axis === 'x' ? 'horizontal (solve order)' : 'vertical (time)'

  const cardAnchorX = activePoint && selectionLocal >= 0 && selectionLocal < xPositions.length
    ? xPositions[selectionLocal]!
    : width / 2
  const cardAnchorY = activePoint && activePoint.singleMs !== null
    ? yScale(activePoint.singleMs)
    : plotBottom / 2
  const cardStyle = cardPosition ?? { left: 4, top: 4 }

  useLayoutEffect(() => {
    if (!activePoint) {
      // oxlint-disable-next-line react/set-state-in-effect
      setCardPosition(null)
      return
    }
    const node = cardRef.current
    if (!node) return
    const pad = 4
    const gap = 8
    const cardW = Math.min(node.offsetWidth || 190, Math.max(1, width - pad * 2))
    const cardH = Math.min(node.offsetHeight || 84, Math.max(1, height - pad * 2))
    const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))
    const clampLeft = (value: number) => clamp(value, pad, Math.max(pad, width - cardW - pad))
    const clampTop = (value: number) => clamp(value, pad, Math.max(pad, height - cardH - pad))
    const aboveFits = cardAnchorY - gap - cardH >= pad
    const belowFits = cardAnchorY + gap + cardH <= height - pad
    let left: number
    let top: number
    if (cardAnchorY >= height / 2 ? aboveFits : belowFits) {
      // Prefer above/below so the marker dot stays visible.
      top = clampTop(cardAnchorY >= height / 2 ? cardAnchorY - gap - cardH : cardAnchorY + gap)
      left = clampLeft(cardAnchorX - cardW / 2)
    } else {
      const leftFits = cardAnchorX - gap - cardW >= pad
      const rightFits = cardAnchorX + gap + cardW <= width - pad
      if (leftFits || rightFits) {
        left = rightFits && (!leftFits || cardAnchorX <= width / 2)
          ? cardAnchorX + gap
          : cardAnchorX - gap - cardW
        top = clampTop(cardAnchorY - cardH / 2)
      } else {
        top = clampTop(cardAnchorY >= height / 2 ? cardAnchorY - gap - cardH : cardAnchorY + gap)
        left = clampLeft(cardAnchorX - cardW / 2)
      }
    }
    const next = { left: Math.round(left), top: Math.round(top) }
    setCardPosition((previous) => previous?.left === next.left && previous.top === next.top ? previous : next)
  }, [activePoint, cardAnchorX, cardAnchorY, height, pbStats, width])

  useEffect(() => {
    if (!pinned) return
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && hostRef.current?.contains(event.target)) return
      setPinned(null)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [pinned])

  useEffect(() => {
    if (disabled || (!hover && !pinned)) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setHover(null)
      setPinned(null)
      setAnnouncement('')
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [disabled, hover, pinned])

  return (
    <div
      className={`time-trend is-compact${disabled ? ' is-timer-active' : ''}`}
      data-testid="time-trend"
      data-y-scale={scale}
      data-axis={axis}
      data-timer-active={disabled ? 'true' : 'false'}
    >
      <div className="time-trend-legend" data-testid="time-trend-legend" aria-label="Time Trend series">
        <span><i style={{ background: color('single') }} />time</span>
        <span><i style={{ background: color('ao5') }} />ao5</span>
        <span><i style={{ background: color('ao12') }} />ao12</span>
        <span><i className="is-pb" style={{ background: color('pb') }} />PB</span>
      </div>

      <div
        className="time-trend-chart"
        ref={hostRef}
        data-testid="time-trend-chart"
        onPointerDown={(event) => {
          // Mouse clicks inspect PB markers only and must not focus the chart
          // into a visible outline. Keyboard users still reach it with Tab.
          if (event.target instanceof Element && event.target.closest('.time-trend-hover-card')) return
          if (event.pointerType === 'mouse' && event.button === 0) event.preventDefault()
        }}
        onPointerMove={handlePointerMove}
        onPointerLeave={() => {
          cancelHoverClose()
          setHover(null)
        }}
        onClick={(event) => {
          if (disabled) return
          if (event.target instanceof Element && event.target.closest('.time-trend-hover-card')) return
          const at = chartCoordinates(event.clientX, event.clientY)
          if (at) pinAt(at.x, at.y)
        }}
      >
        {points.length === 0 || !hasVisibleValues ? (
          <p className="time-trend-empty" role="status">
            {points.length === 0 || !hasAnyValues ? emptyMessage : 'No valid times in this view.'}
          </p>
        ) : (
          <svg
            ref={svgRef}
            viewBox={`0 0 ${width} ${height}`}
            role="group"
            aria-label="Time Trend chart. Use Left and Right to inspect solves, Home and End for first and latest, and Escape to close details."
            tabIndex={0}
            data-testid="time-trend-svg"
            data-y-min={yAxis.min}
            data-y-max={yAxis.max}
            data-x-zoom={xView.zoom}
            data-x-position={xView.position}
            data-x-start={start}
            data-x-count={count}
            data-y-zoom={yView.zoom}
            data-y-position={yView.position}
            onKeyDown={handleKeyDown}
          >
            <defs>
              <clipPath id={clipId}>
                <rect x={margin.left} y={margin.top} width={plotW} height={plotH} />
              </clipPath>
            </defs>
            {yAxis.ticks.map((tick) => (
              <g key={tick}>
                <line className="time-trend-grid" x1={margin.left} y1={yScale(tick)} x2={width - margin.right} y2={yScale(tick)} />
                <text className="time-trend-axis-label" x={margin.left - 6} y={yScale(tick) + 3} textAnchor="end" data-testid="time-trend-y-tick">
                  {axisTime(tick)}
                </text>
              </g>
            ))}
            <g clipPath={`url(#${clipId})`} data-testid="time-trend-plot">
              {seriesPaths.map((path) => (
                <path
                  key={path.key}
                  data-series={path.key}
                  d={path.d}
                  fill="none"
                  stroke={color(path.color as 'single' | 'ao5' | 'ao12')}
                  strokeWidth={path.key === 'single' ? 0.8 : 1.5}
                  opacity={path.key === 'single' ? 0.5 : 0.95}
                  strokeLinejoin="round"
                />
              ))}
              {visiblePoints.length === 1 && visiblePoints[0]!.singleMs !== null ? (
                <circle cx={xScale(0)} cy={yScale(visiblePoints[0]!.singleMs!)} r={2} fill={color('single')} />
              ) : null}
              {crosshairX !== null ? (
                <line className="time-trend-crosshair" x1={crosshairX} x2={crosshairX} y1={margin.top} y2={plotBottom} />
              ) : null}
            </g>
            {pbMarkers.map((marker) => (
              <g
                key={marker.point.solve.id}
                className="time-trend-pb-hit"
                data-testid="time-trend-pb-hit"
                data-pb-id={marker.point.solve.id}
                data-current-pb={marker.current ? 'true' : undefined}
                role="img"
                aria-label={`${marker.current ? 'Current personal best' : 'Personal best'} · Solve #${marker.point.index} · ${formatTime(marker.point.singleMs!)}`}
                onPointerEnter={() => {
                  cancelHoverClose()
                  setHover({ kind: 'pb', index: marker.point.index - 1 })
                }}
                onClick={(event) => {
                  event.stopPropagation()
                  if (disabled) return
                  setPinned({ kind: 'pb', index: marker.point.index - 1 })
                  setAnnouncement(describePoint(marker.point, points.length, currentPBId))
                }}
              >
                <title>{`${marker.current ? 'Current personal best' : 'Personal best'} · Solve #${marker.point.index} · ${formatTime(marker.point.singleMs!)}`}</title>
                <circle cx={marker.x} cy={marker.y} r={PB_HIT_RADIUS} fill="transparent" />
                {marker.current ? (
                  <circle
                    className="time-trend-pb-ring"
                    data-testid="time-trend-pb-ring"
                    cx={marker.x}
                    cy={marker.y}
                    r={7.2}
                    fill="none"
                    stroke={color('pb')}
                    strokeWidth={1.2}
                  />
                ) : null}
                <circle
                  className={`time-trend-pb-marker${marker.current ? ' is-current-pb' : ''}`}
                  data-testid="time-trend-pb"
                  cx={marker.x}
                  cy={marker.y}
                  r={marker.current ? 4.2 : 3.4}
                  fill={color('pb')}
                  stroke="var(--surface)"
                  strokeWidth={0.9}
                />
              </g>
            ))}
          </svg>
        )}
        {activePoint ? (
          pbStats ? (
            <PBCard
              stats={pbStats}
              current={activePoint.solve.id === currentPBId}
              total={points.length}
              cardRef={cardRef}
              onPointerEnter={cancelHoverClose}
              style={cardStyle}
            />
          ) : (
            <GenericSolveCard
              point={activePoint}
              total={points.length}
              cardRef={cardRef}
              onPointerEnter={cancelHoverClose}
              style={cardStyle}
            />
          )
        ) : null}
      </div>

      <div className="time-trend-controls" role="group" aria-label="Chart viewport" data-testid="time-trend-controls" data-axis={axis}>
        <button
          type="button"
          className="time-trend-control-button"
          data-testid="time-trend-axis-toggle"
          disabled={disabled}
          onClick={changeAxis}
          aria-label={`Pan and zoom ${axisLabel}. Switch to ${axis === 'x' ? 'vertical (time)' : 'horizontal (solve order)'}.`}
        >
          <AxisIcon axis={axis} />
        </button>
        <button
          type="button"
          className="time-trend-control-button"
          data-testid="time-trend-pan-earlier"
          disabled={panEarlierDisabled}
          onClick={() => pan('earlier')}
          aria-label={`Pan earlier along ${axisLabel}`}
        >
          <PanIcon direction="earlier" />
        </button>
        <button
          type="button"
          className="time-trend-control-button"
          data-testid="time-trend-pan-later"
          disabled={panLaterDisabled}
          onClick={() => pan('later')}
          aria-label={`Pan later along ${axisLabel}`}
        >
          <PanIcon direction="later" />
        </button>
        <button
          type="button"
          className="time-trend-control-button"
          data-testid="time-trend-zoom-in"
          disabled={zoomInDisabled}
          onClick={() => zoom('in')}
          aria-label={`Zoom in along ${axisLabel}`}
        >
          <ZoomIcon direction="in" />
        </button>
        <button
          type="button"
          className="time-trend-control-button"
          data-testid="time-trend-zoom-out"
          disabled={zoomOutDisabled}
          onClick={() => zoom('out')}
          aria-label={`Zoom out along ${axisLabel}`}
        >
          <ZoomIcon direction="out" />
        </button>
      </div>

      <p className="sr-only" role="status" aria-live="polite" data-testid="time-trend-announcement">
        {announcement}
      </p>
    </div>
  )
})
