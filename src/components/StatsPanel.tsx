import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  formatOptionalTime,
  formatSolveCount,
  formatStatValue,
} from '../lib/format'
import { BUILT_IN_STAT_DEFINITIONS } from '../lib/statDefinitions'
import type { SessionStats, StatPair, StatResult } from '../lib/stats'
import type {
  CustomAverageSetting,
  StatPrecision,
  StatVisibility,
} from '../types'

interface StatsPanelProps {
  stats: SessionStats
  visibleStats: StatVisibility
  customAverages: readonly CustomAverageSetting[]
  precision: StatPrecision
  /** When true, render every enabled statistic instead of fitting to height. */
  showAllRows?: boolean
  style?: React.CSSProperties
}

const EMPTY_PAIR: StatPair = { best: null, latest: null }

function resultClass(result: StatResult): string {
  if (result === null) return 'is-empty'
  return result.status === 'dnf' ? 'is-dnf' : ''
}

function StatTile({
  label,
  best,
  latest,
  testId,
  precision,
  measurement = false,
}: {
  label: string
  best: number | null
  latest: StatResult
  testId: string
  precision: StatPrecision
  measurement?: boolean
}) {
  const latestClass = resultClass(latest)
  return (
    <div className={measurement ? 'stat-measure-row' : 'stat-tile'}>
      <span className="stat-label">{label}</span>
      <strong
        className={`stat-value ${best === null ? 'is-empty' : ''}`}
        data-testid={measurement ? undefined : testId}
      >
        {formatOptionalTime(best, precision)}
      </strong>
      <span className={`stat-latest ${latestClass}`}>
        <span>Latest</span>
        {formatStatValue(latest, precision)}
      </span>
    </div>
  )
}

export const StatsPanel = memo(function StatsPanel({
  stats,
  visibleStats,
  customAverages,
  precision,
  showAllRows = false,
  style,
}: StatsPanelProps) {
  const gridRef = useRef<HTMLDivElement>(null)
  const naturalRowsRef = useRef<HTMLDivElement>(null)
  const compactRowsRef = useRef<HTMLDivElement>(null)
  const [layout, setLayout] = useState({ count: 0, compact: false })

  const tiles = useMemo(() => {
    const builtInTiles = BUILT_IN_STAT_DEFINITIONS.filter(
      (definition) => visibleStats[definition.key],
    ).map((definition) => {
      const pair =
        definition.key === 'single'
          ? stats.single
          : definition.key === 'mo3'
            ? stats.mo3
            : stats.averages.get(definition.size as number) ?? EMPTY_PAIR

      return {
        key: definition.key as string,
        label: definition.label,
        best: pair.best,
        latest: pair.latest,
        testId: `best-${definition.key}`,
      }
    })

    const customTiles = customAverages
      .filter((average) => average.visible)
      .map((average) => {
        const pair = stats.averages.get(average.size) ?? EMPTY_PAIR
        return {
          key: `custom-${average.id}`,
          label: `Best ao${average.size}`,
          best: pair.best,
          latest: pair.latest,
          testId: `best-ao${average.size}`,
        }
      })

    return [...builtInTiles, ...customTiles]
  }, [stats, visibleStats, customAverages])

  // Measure independent, intrinsic rows. The visible row count and density never
  // change these samples or the flex area's size, so resizing cannot feed back
  // into its own measurement. All comparisons use viewport coordinates (zoom too).
  const measure = useCallback(() => {
    const grid = gridRef.current
    const natural = naturalRowsRef.current
    const compact = compactRowsRef.current
    if (showAllRows || !grid || !natural || !compact) return
    const bottom = grid.getBoundingClientRect().bottom - 1
    const fitCount = (sample: HTMLElement) => {
      let count = 0
      for (const row of Array.from(sample.children)) {
        if (row.getBoundingClientRect().bottom > bottom) break
        count += 1
      }
      return count
    }
    const naturalCount = fitCount(natural)
    const compactCount = fitCount(compact)
    const next = compactCount > naturalCount
      ? { count: compactCount, compact: true }
      : { count: naturalCount, compact: false }
    setLayout((previous) => (
      previous.count === next.count && previous.compact === next.compact ? previous : next
    ))
  }, [showAllRows])

  useLayoutEffect(() => {
    measure()
  }, [measure, tiles, precision, style?.height])

  const hasTiles = tiles.length > 0
  useLayoutEffect(() => {
    if (showAllRows || !hasTiles) return
    const elements = [gridRef.current, naturalRowsRef.current, compactRowsRef.current]
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    for (const element of elements) if (element) observer?.observe(element)
    // Font loading can change intrinsic text metrics without changing the panel.
    let disposed = false
    void document.fonts?.ready.then(() => { if (!disposed) measure() })
    window.addEventListener('resize', measure)
    return () => {
      disposed = true
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [measure, hasTiles, showAllRows])

  const renderedTiles = showAllRows ? tiles : tiles.slice(0, layout.count)

  return (
    <section
      className={`panel stats-panel${!showAllRows && layout.compact ? ' is-compact' : ''}`}
      aria-labelledby="stats-title"
      style={{ position: 'relative', ...style }}
    >
      <div className="panel-heading">
        <h2 id="stats-title">Statistics</h2>
        <span className="count-pill">{formatSolveCount(stats.count)}</span>
      </div>

      {tiles.length > 0 ? (
        <div className="stats-grid" ref={gridRef}>
          {!showAllRows ? (
            <>
              <div className="stats-measure-rows" ref={naturalRowsRef} aria-hidden="true">
                {tiles.map(({ key, ...tile }) => (
                  <StatTile key={key} {...tile} precision={precision} measurement />
                ))}
              </div>
              <div className="stats-measure-rows is-compact" ref={compactRowsRef} aria-hidden="true">
                {tiles.map(({ key, ...tile }) => (
                  <StatTile key={key} {...tile} precision={precision} measurement />
                ))}
              </div>
            </>
          ) : null}
          {renderedTiles.map((tile) => (
            <StatTile
              key={tile.key}
              label={tile.label}
              best={tile.best}
              latest={tile.latest}
              testId={tile.testId}
              precision={precision}
            />
          ))}
        </div>
      ) : null}

      {tiles.length === 0 ? (
        <p className="stats-empty">
          No statistics shown. Enable at least one in Settings.
        </p>
      ) : null}
    </section>
  )
})
