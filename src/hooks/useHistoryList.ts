/* oxlint-disable react/set-state-in-effect, react-hooks/set-state-in-effect */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { averageMeasuredHeight, buildRowOffsets, computeHistoryWindow, findRowAtOffset } from '../lib/historyWindow'

interface HistoryAnchor {
  id: string
  index: number
  offset: number
}

/** Keep small histories fully available to find-in-page and sequential focus. */
const VIRTUALIZE_THRESHOLD = 200
const ROW_HEIGHT_FALLBACK = 44
const WINDOW_OVERSCAN_PX = 320

export function useHistoryList<T extends { id: string }>(items: readonly T[]) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [showAll, setShowAll] = useState(false)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewport, setViewport] = useState({ height: 0, width: 0 })
  const [heights, setHeights] = useState(() => new Map<string, number>())
  const newestId = items[0]?.id
  const canWindow = items.length > VIRTUALIZE_THRESHOLD
  const virtualized = canWindow && !showAll

  const anchorRef = useRef<HistoryAnchor | null>(null)
  const previousNewestRef = useRef<string | undefined>(newestId)
  const scrollRafRef = useRef<number | null>(null)
  const itemsRef = useRef(items)
  const offsetsRef = useRef<Float64Array | null>(null)
  const virtualizedRef = useRef(virtualized)

  const estimate = useMemo(
    () => averageMeasuredHeight(heights, ROW_HEIGHT_FALLBACK),
    [heights],
  )
  const offsets = useMemo(
    () =>
      virtualized
        ? buildRowOffsets(
            items.map((item) => item.id),
            heights,
            estimate,
          )
        : null,
    [estimate, heights, items, virtualized],
  )

  useLayoutEffect(() => {
    itemsRef.current = items
    virtualizedRef.current = virtualized
    offsetsRef.current = offsets
  }, [items, virtualized, offsets])

  const windowRange = useMemo(
    () =>
      offsets
        ? computeHistoryWindow(
            offsets,
            scrollTop,
            viewport.height,
            WINDOW_OVERSCAN_PX,
          )
        : {
            start: 0,
            end: items.length,
            topSpacer: 0,
            bottomSpacer: 0,
            totalHeight: 0,
          },
    [offsets, scrollTop, items.length, viewport.height],
  )

  useEffect(() => {
    const ids = new Set(items.map((item) => item.id))
    setHeights((previous) => {
      let changed = false
      const next = new Map(previous)
      for (const id of previous.keys()) {
        if (!ids.has(id)) {
          next.delete(id)
          changed = true
        }
      }
      return changed ? next : previous
    })
  }, [items])

  useEffect(() => {
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    scrollRef.current?.scrollTo?.({ top: 0, behavior: reduceMotion ? 'instant' : 'smooth' })
  }, [newestId])

  useEffect(
    () => () => {
      if (scrollRafRef.current !== null) {
        cancelAnimationFrame(scrollRafRef.current)
      }
    },
    [],
  )

  useLayoutEffect(() => {
    const scroller = scrollRef.current
    if (!scroller) return
    const update = () => {
      const { clientHeight: height, clientWidth: width } = scroller
      setViewport(current => current.height === height && current.width === width ? current : { height, width })
    }
    update()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update)
      return () => window.removeEventListener('resize', update)
    }

    const observer = new ResizeObserver(update)
    observer.observe(scroller)
    return () => observer.disconnect()
  }, [])

  // Measure the rendered window. Heights vary with comments and wrapped
  // metadata, so the offset table is corrected before paint and the current
  // scroll anchor is restored by the effect below.
  useLayoutEffect(() => {
    if (!virtualized && !showAll) return
    const scroller = scrollRef.current
    if (!scroller) return

    setHeights((previous) => {
      const next = new Map(previous)
      let changed = false
      for (const node of scroller.querySelectorAll<HTMLElement>('[data-history-id]')) {
        const id = node.dataset.historyId
        if (!id) continue
        const height = node.offsetHeight
        if (height <= 0) continue
        const existing = previous.get(id)
        if (existing === undefined || Math.abs(existing - height) > 0.5) {
          next.set(id, height)
          changed = true
        }
      }
      return changed ? next : previous
    })
  }, [items, showAll, viewport, virtualized, windowRange.start, windowRange.end])

  useLayoutEffect(() => {
    const scroller = scrollRef.current
    const currentNewest = items[0]?.id
    const newestChanged = currentNewest !== previousNewestRef.current
    previousNewestRef.current = currentNewest

    if (newestChanged) {
      anchorRef.current = null
      return
    }
    if (!virtualized || !offsets || !scroller) return

    const anchor = anchorRef.current
    if (!anchor) return

    const foundIndex = items.findIndex((item) => item.id === anchor.id)
    const index =
      foundIndex >= 0
        ? foundIndex
        : Math.min(anchor.index, items.length - 1)
    if (index < 0) return

    const target =
      (offsets[index] ?? 0) + (foundIndex >= 0 ? anchor.offset : 0)
    if (Math.abs(scroller.scrollTop - target) > 1) {
      scroller.scrollTop = target
      setScrollTop(target)
    }
  }, [heights, offsets, items, virtualized])

  const captureAnchor = useCallback(() => {
    const scroller = scrollRef.current
    const currentOffsets = offsetsRef.current
    const currentItems = itemsRef.current
    if (
      !virtualizedRef.current ||
      !scroller ||
      !currentOffsets ||
      currentItems.length === 0
    ) {
      return
    }

    const top = scroller.scrollTop
    const index = findRowAtOffset(currentOffsets, top)
    const item = currentItems[index]
    if (item) {
      anchorRef.current = {
        id: item.id,
        index,
        offset: top - (currentOffsets[index] ?? top),
      }
    }
  }, [])

  const handleScroll = useCallback(() => {
    const scroller = scrollRef.current
    if (!scroller || !virtualizedRef.current || scrollRafRef.current !== null) return

    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null
      const top = scroller.scrollTop
      setScrollTop(top)

      captureAnchor()
    })
  }, [captureAnchor])

  const toggleShowAll = () => {
    // Show all may have been scrolled since the last windowed anchor.
    anchorRef.current = null
    setScrollTop(scrollRef.current?.scrollTop ?? 0)
    setShowAll(current => !current)
  }

  return { scrollRef, showAll, canWindow, virtualized, windowRange, handleScroll, captureAnchor, toggleShowAll }
}
