import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { useDismissablePopover } from '../hooks/useDismissablePopover'

export interface CubeSelectOption {
  value: string
  label: ReactNode
  /** Plain text used for type-ahead; defaults from a string label. */
  text?: string
  disabled?: boolean
}

interface SelectProps {
  value: string
  options: readonly CubeSelectOption[]
  onChange: (value: string) => void
  id?: string
  ariaLabel?: string
  ariaDescribedBy?: string
  className?: string
  menuClassName?: string
  disabled?: boolean
  placeholder?: string
  testId?: string
}

interface MenuPosition {
  left: number
  top: number
  width: number
  maxHeight: number
}

const VIEWPORT_GAP = 8
const MENU_MAX_HEIGHT = 320

function optionText(option: CubeSelectOption): string {
  if (option.text) return option.text
  return typeof option.label === 'string' ? option.label : option.value
}

/**
 * A CubeLab-themed replacement for native selects. The trigger keeps the
 * combobox/listbox keyboard model (arrows, Home/End, Enter, Escape and
 * type-ahead) while the option list is portalled into the nearest dialog (or
 * the document) so it can escape scroll containers without breaking modal
 * focus containment.
 */
export function Select({
  value,
  options,
  onChange,
  id,
  ariaLabel,
  ariaDescribedBy,
  className,
  menuClassName,
  disabled = false,
  placeholder = 'Select…',
  testId,
}: SelectProps) {
  const generatedId = useId()
  const selectId = id ?? `cube-select-${generatedId}`
  const listboxId = `${selectId}-listbox`
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const typeaheadRef = useRef({ text: '', at: 0 })
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null)
  const [position, setPosition] = useState<MenuPosition>({
    left: VIEWPORT_GAP,
    top: VIEWPORT_GAP,
    width: 180,
    maxHeight: MENU_MAX_HEIGHT,
  })

  const selectedIndex = options.findIndex((option) => option.value === value)
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined

  const close = useCallback(() => {
    setOpen(false)
    setActiveIndex(-1)
    setPortalTarget(null)
  }, [])

  useDismissablePopover({
    open,
    onClose: close,
    triggerRef,
    panelRef: menuRef,
  })

  useEffect(() => {
    if (!disabled) return
    // oxlint-disable-next-line react/set-state-in-effect
    close()
  }, [close, disabled])

  const firstEnabled = (direction: -1 | 1): number => {
    if (options.length === 0) return -1
    if (direction === 1) {
      return options.findIndex((option) => !option.disabled)
    }
    for (let index = options.length - 1; index >= 0; index -= 1) {
      if (!options[index]?.disabled) return index
    }
    return -1
  }

  const openWithIndex = (index: number) => {
    setPortalTarget(
      triggerRef.current?.closest('dialog') ??
        (typeof document !== 'undefined' ? document.body : null),
    )
    setActiveIndex(index)
    setOpen(true)
  }

  const openMenu = (direction: -1 | 1 = 1) => {
    if (disabled || options.length === 0) return
    const start =
      selectedIndex >= 0 && !options[selectedIndex]?.disabled
        ? selectedIndex
        : firstEnabled(direction)
    openWithIndex(start)
  }

  const moveActive = (direction: -1 | 1) => {
    if (options.length === 0) return
    let index = activeIndex
    for (let step = 0; step < options.length; step += 1) {
      index = (index + direction + options.length) % options.length
      if (!options[index]?.disabled) {
        setActiveIndex(index)
        return
      }
    }
  }

  const choose = (index: number) => {
    const option = options[index]
    if (!option || option.disabled) return
    onChange(option.value)
    close()
    triggerRef.current?.focus()
  }

  const findTypeahead = (key: string, from: number): number => {
    const lower = key.toLocaleLowerCase()
    for (let step = 1; step <= options.length; step += 1) {
      const index = (Math.max(-1, from) + step) % options.length
      const option = options[index]
      if (
        option &&
        !option.disabled &&
        optionText(option).toLocaleLowerCase().startsWith(lower)
      ) {
        return index
      }
    }
    return -1
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      event.stopPropagation()
      close()
      triggerRef.current?.focus()
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      event.stopPropagation()
      if (!open) {
        openMenu(event.key === 'ArrowDown' ? 1 : -1)
      } else {
        moveActive(event.key === 'ArrowDown' ? 1 : -1)
      }
      return
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      event.stopPropagation()
      const index = event.key === 'Home' ? firstEnabled(1) : firstEnabled(-1)
      if (!open) openWithIndex(index)
      else setActiveIndex(index)
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      event.stopPropagation()
      if (!open) openMenu(1)
      else choose(activeIndex)
      return
    }
    if (event.key === 'Tab') {
      close()
      return
    }
    if (
      event.key.length === 1 &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      event.preventDefault()
      event.stopPropagation()
      const now = event.timeStamp
      const previous = typeaheadRef.current
      const text =
        now - previous.at > 700 ? event.key : `${previous.text}${event.key}`
      typeaheadRef.current = { text, at: now }
      let index = findTypeahead(text, activeIndex)
      if (index < 0 && text.length > 1) {
        index = findTypeahead(event.key, activeIndex)
        typeaheadRef.current = { text: event.key, at: now }
      }
      if (index >= 0) {
        if (!open) openWithIndex(index)
        else setActiveIndex(index)
      }
    }
  }

  useLayoutEffect(() => {
    if (!open) return
    const update = () => {
      const trigger = triggerRef.current
      if (!trigger) return
      const rect = trigger.getBoundingClientRect()
      const viewportWidth = window.innerWidth || 1024
      const viewportHeight = window.innerHeight || 768
      const width = Math.max(
        140,
        Math.min(Math.max(rect.width, 160), viewportWidth - VIEWPORT_GAP * 2),
      )
      const spaceBelow = viewportHeight - rect.bottom - VIEWPORT_GAP
      const spaceAbove = rect.top - VIEWPORT_GAP
      const openUp = spaceBelow < 170 && spaceAbove > spaceBelow
      const maxHeight = Math.max(
        96,
        Math.min(MENU_MAX_HEIGHT, openUp ? spaceAbove : spaceBelow),
      )
      const left = Math.min(
        Math.max(VIEWPORT_GAP, rect.left),
        viewportWidth - width - VIEWPORT_GAP,
      )
      const top = openUp
        ? Math.max(VIEWPORT_GAP, rect.top - maxHeight - 4)
        : rect.bottom + 4
      setPosition({ left, top, width, maxHeight })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open])

  const menu =
    open && portalTarget
      ? createPortal(
          <div
            ref={menuRef}
            className={`cube-select-menu${menuClassName ? ` ${menuClassName}` : ''}`}
            style={{
              left: position.left,
              top: position.top,
              width: position.width,
              maxHeight: position.maxHeight,
            }}
          >
            <div
              id={listboxId}
              role="listbox"
              aria-label={ariaLabel}
              aria-activedescendant={
                activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined
              }
              className="cube-select-list"
            >
              {options.map((option, index) => (
                <div
                  key={option.value}
                  id={`${listboxId}-option-${index}`}
                  role="option"
                  aria-selected={option.value === value}
                  aria-disabled={option.disabled || undefined}
                  className={[
                    'cube-select-option',
                    option.value === value ? 'is-selected' : '',
                    index === activeIndex ? 'is-active' : '',
                    option.disabled ? 'is-disabled' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  data-testid={
                    testId ? `${testId}-option-${option.value}` : undefined
                  }
                  onPointerDown={(event) => {
                    // Keep focus on the trigger so the menu owns the interaction
                    // and Escape can always restore the same place.
                    event.preventDefault()
                  }}
                  onPointerEnter={() => {
                    if (!option.disabled) setActiveIndex(index)
                  }}
                  onClick={() => choose(index)}
                >
                  <span className="cube-select-option-label">{option.label}</span>
                  <span className="cube-select-check" aria-hidden="true">
                    {option.value === value ? '✓' : ''}
                  </span>
                </div>
              ))}
            </div>
          </div>,
          portalTarget,
        )
      : null

  return (
    <>
      <button
        ref={triggerRef}
        id={selectId}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={
          open && activeIndex >= 0
            ? `${listboxId}-option-${activeIndex}`
            : undefined
        }
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        disabled={disabled}
        className={`cube-select${className ? ` ${className}` : ''}`}
        data-testid={testId}
        onClick={() => {
          if (open) close()
          else openMenu(1)
        }}
        onKeyDown={handleKeyDown}
      >
        <span className="cube-select-value">
          {selected ? selected.label : placeholder}
        </span>
        <span className="cube-select-chevron" aria-hidden="true" />
      </button>
      {menu}
    </>
  )
}
