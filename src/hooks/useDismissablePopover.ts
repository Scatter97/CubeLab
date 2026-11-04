import { useEffect, useRef, type RefObject } from 'react'

interface DismissablePopoverOptions {
  open: boolean
  onClose: () => void
  triggerRef: RefObject<HTMLElement | null>
  /** The floating panel may be portalled outside the trigger's DOM tree. */
  panelRef: RefObject<HTMLElement | null>
  /** Optional container that also counts as inside, usually the trigger. */
  rootRef?: RefObject<HTMLElement | null>
}

/**
 * Shared disclosure behaviour for CubeLab dropdowns. A pointer press, focus
 * move or Escape outside the trigger/panel closes the panel. Escape returns
 * focus to the trigger; clicking elsewhere leaves focus where the user put it.
 */
export function useDismissablePopover({
  open,
  onClose,
  triggerRef,
  panelRef,
  rootRef,
}: DismissablePopoverOptions): void {
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!open) return
    const isInside = (target: EventTarget | null) =>
      target instanceof Node &&
      (Boolean(triggerRef.current?.contains(target)) ||
        Boolean(rootRef?.current?.contains(target)) ||
        Boolean(panelRef.current?.contains(target)))

    const handlePointerDown = (event: PointerEvent) => {
      if (isInside(event.target)) return
      onCloseRef.current()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onCloseRef.current()
      triggerRef.current?.focus()
    }
    const handleFocusIn = (event: FocusEvent) => {
      if (isInside(event.target)) return
      onCloseRef.current()
    }

    document.addEventListener('pointerdown', handlePointerDown, true)
    document.addEventListener('keydown', handleKeyDown, true)
    document.addEventListener('focusin', handleFocusIn)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
      document.removeEventListener('keydown', handleKeyDown, true)
      document.removeEventListener('focusin', handleFocusIn)
    }
  }, [open, panelRef, rootRef, triggerRef])
}
