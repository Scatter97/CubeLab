import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'

interface MenuAnchor {
  id: string
  rect: DOMRect
  row: Element
  trigger: HTMLElement
}

export function useHistoryMenu<T extends { id: string }>(
  items: readonly T[],
  scrollRef: RefObject<HTMLDivElement | null>,
  captureAnchor: () => void,
  locked = false,
  onOpen?: (item: T) => void,
) {
  const menuRef = useRef<HTMLDivElement>(null)
  const anchorRef = useRef<MenuAnchor | null>(null)
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null)
  const index = anchor && !locked ? items.findIndex(item => item.id === anchor.id) : -1
  const item = items[index]
  const openMenu = anchor && item ? { ...anchor, item, number: items.length - index } : null
  if (anchor && !openMenu) setAnchor(null)

  // Keep row handlers stable for memoized rows as the menu moves between them.
  useLayoutEffect(() => {
    anchorRef.current = anchor
  }, [anchor])

  const closeMenu = useCallback((restoreFocus = true) => {
    if (restoreFocus) anchorRef.current?.trigger.focus({ preventScroll: true })
    anchorRef.current = null
    setAnchor(null)
  }, [])

  const showMenu = useCallback((item: T, trigger: HTMLElement) => {
    if (locked) return
    captureAnchor()
    onOpen?.(item)
    const row = trigger.closest('.history-row') ?? trigger
    const nextAnchor = {
      id: item.id,
      rect: row.getBoundingClientRect(),
      row,
      trigger,
    }
    anchorRef.current = nextAnchor
    setAnchor(nextAnchor)
  }, [captureAnchor, locked, onOpen])

  const toggleMenu = useCallback((item: T, trigger: HTMLElement) => {
    if (locked || window.getSelection()?.toString()) return
    if (anchorRef.current?.id === item.id) closeMenu()
    else showMenu(item, trigger)
  }, [closeMenu, locked, showMenu])

  const hoverMenu = useCallback((item: T, trigger: HTMLElement) => {
    const current = anchorRef.current
    if (current && current.id !== item.id) showMenu(item, trigger)
  }, [showMenu])

  const trigger = anchor?.trigger
  useEffect(() => {
    if (trigger) menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus({ preventScroll: true })
  }, [trigger])

  useEffect(() => {
    if (!anchor) return

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (!menuRef.current?.contains(target) && !anchor.trigger.contains(target)) closeMenu()
    }
    const handleResize = () => closeMenu(false)
    const handleScroll = () => {
      if (!scroller) return
      const rect = anchor.row.getBoundingClientRect()
      const bounds = scroller.getBoundingClientRect()
      if (!anchor.row.isConnected || rect.bottom <= bounds.top || rect.top >= bounds.bottom) {
        closeMenu(false)
      } else if (Math.abs(rect.top - anchor.rect.top) > 1) {
        // Keyboard focus and row measurement can adjust the scroll position as the menu opens.
        const nextAnchor = { ...anchor, rect }
        anchorRef.current = nextAnchor
        setAnchor(nextAnchor)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      closeMenu()
    }

    const scroller = scrollRef.current
    document.addEventListener('pointerdown', handlePointerDown, true)
    document.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('resize', handleResize)
    scroller?.addEventListener('scroll', handleScroll, { passive: true })
    scroller?.addEventListener('wheel', handleResize, { passive: true })

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
      document.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('resize', handleResize)
      scroller?.removeEventListener('scroll', handleScroll)
      scroller?.removeEventListener('wheel', handleResize)
    }
  }, [anchor, closeMenu, scrollRef])

  return { openMenu, menuRef, toggleMenu, hoverMenu, closeMenu }
}
