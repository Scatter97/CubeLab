import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { applyCubeFaceColors, type PuzzleGeometryColors } from '../lib/cubeColors'
import { cubeNetForScramble } from '../lib/cubeNet'
import { getEventDefinition } from '../lib/events'
import {
  TOOL_PANEL_MIN_HEIGHT,
  TOOL_PANEL_MIN_WIDTH,
  clampToolPanelLayout,
  type StageSize,
  type ToolPanelLayout,
} from '../lib/toolPanelLayout'
import type { DrawScrambleMode } from '../hooks/useDrawScrambleMode'
import { useToolPanelLayout } from '../hooks/useToolPanelLayout'
import { TOOL_OPTIONS, toolLabel, type CurrentTool } from '../lib/tools'
import type { Solve } from '../types'
import type { PuzzleEvent } from '../types'
import { ScrambleNet } from './ScrambleNet'
import { DEFAULT_AVERAGE_TRIMMING } from '../lib/averageTrimming'
import type { AverageTrimming } from '../types'
import { TimeTrend } from './TimeTrend'

function TwistyCube({
  scramble,
  puzzle,
  useStandardCubeColors,
}: {
  scramble: string
  puzzle: string
  useStandardCubeColors: boolean
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const playerRef = useRef<HTMLElement | null>(null)
  const scrambleRef = useRef(scramble)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => { scrambleRef.current = scramble }, [scramble])

  useEffect(() => {
    let cancelled = false
    const host = hostRef.current
    if (!host) return
    host.innerHTML = ''
    playerRef.current = null
    setStatus('loading')

    void (async () => {
      try {
        const { puzzles } = await import('cubing/puzzles')
        const loader = puzzles[puzzle]
        const geometry = await loader?.pg?.()
        if (geometry && useStandardCubeColors) {
          applyCubeFaceColors(geometry as unknown as PuzzleGeometryColors)
          const typed = geometry as unknown as PuzzleGeometryColors & {
            get3d?: (...args: unknown[]) => unknown
            __cubeColorsWrapped?: boolean
          }
          if (typeof typed.get3d === 'function' && !typed.__cubeColorsWrapped) {
            const originalGet3d = typed.get3d.bind(typed)
            typed.get3d = (...args: unknown[]) => {
              applyCubeFaceColors(typed)
              return originalGet3d(...args)
            }
            typed.__cubeColorsWrapped = true
          }
          if (loader && typeof loader.pg === 'function') {
            const loaderTyped = loader as { pg: () => Promise<unknown>; __cubeColorsWrapped?: boolean }
            if (!loaderTyped.__cubeColorsWrapped) {
              const originalPg = loaderTyped.pg.bind(loader)
              loaderTyped.pg = async () => {
                const g = await originalPg()
                applyCubeFaceColors(g as unknown as PuzzleGeometryColors)
                return g
              }
              loaderTyped.__cubeColorsWrapped = true
            }
          }
        }
        if (cancelled) return
        await import('cubing/twisty')
        if (cancelled || !hostRef.current) return
        const player = document.createElement('twisty-player')
        player.setAttribute('puzzle', puzzle)
        player.setAttribute('visualization', 'PG3D')
        player.setAttribute('background', 'none')
        player.setAttribute('control-panel', 'none')
        player.setAttribute('experimental-drag-input', 'auto')
        player.setAttribute('alg', scrambleRef.current)
        hostRef.current.innerHTML = ''
        hostRef.current.appendChild(player)
        playerRef.current = player
        if (!cancelled) setStatus('ready')
      } catch {
        if (!cancelled) setStatus('error')
      }
    })()

    return () => {
      cancelled = true
      host.innerHTML = ''
      playerRef.current = null
    }
  }, [puzzle, useStandardCubeColors])

  useEffect(() => {
    const player = playerRef.current
    if (player) player.setAttribute('alg', scramble)
  }, [scramble])

  return (
    <div className="scramble-draw-3d">
      <div className="scramble-draw-3d-host" ref={hostRef} />
      {status !== 'ready' ? (
        <p className="scramble-draw-status" role={status === 'error' ? 'alert' : 'status'}>
          {status === 'error' ? '3D diagram unavailable' : 'Loading 3D diagram…'}
        </p>
      ) : null}
    </div>
  )
}

interface Props {
  scramble: string | null
  event: PuzzleEvent
  mode: DrawScrambleMode
  activeTool: CurrentTool
  onSelectTool: (tool: CurrentTool) => void
  solves?: readonly Solve[]
  timerActive?: boolean
  trimming?: AverageTrimming
}

type InteractionMode = 'drag' | 'resize'

interface InteractionState {
  pointerId: number
  mode: InteractionMode
  startX: number
  startY: number
  origin: ToolPanelLayout
  latest: ToolPanelLayout
  stage: StageSize
}

export function ToolPanel({ scramble, event, mode, activeTool, onSelectTool, solves = [], timerActive = false, trimming = DEFAULT_AVERAGE_TRIMMING }: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLElement | null>(null)
  const ghostRef = useRef<HTMLDivElement | null>(null)
  const interactionRef = useRef<InteractionState | null>(null)
  const { layout, setLayout, persist } = useToolPanelLayout()
  const [interaction, setInteraction] = useState<InteractionMode | null>(null)
  const [ghostPortalContainer, setGhostPortalContainer] = useState<HTMLElement | null>(null)

  useEffect(() => {
    if (!menuOpen) return
    const handlePointerDown = (event: MouseEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) setMenuOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setMenuOpen(false)
      buttonRef.current?.focus()
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [menuOpen])

  const stageSize = useCallback((): StageSize | null => {
    const stage = panelRef.current?.parentElement
    if (!stage) return null
    const width = stage.clientWidth
    const height = stage.clientHeight
    if (width <= 0 || height <= 0) return null
    return { width, height }
  }, [])

  useEffect(() => {
    const stage = panelRef.current?.parentElement
    if (stage) setGhostPortalContainer(stage)
    if (!stage) return
    const reclamp = () => {
      const size = stageSize()
      if (!size) return
      setLayout((current) => {
        if (!current) return current
        const next = clampToolPanelLayout(current, size)
        return next.x === current.x && next.y === current.y && next.width === current.width && next.height === current.height
          ? current
          : next
      })
    }
    reclamp()
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(reclamp) : null
    observer?.observe(stage)
    window.addEventListener('resize', reclamp)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', reclamp)
    }
  }, [setLayout, stageSize])

  const beginInteraction = useCallback(
    (mode: InteractionMode) => (event: ReactPointerEvent<HTMLElement>) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return
      if (mode === 'drag') {
        const dragTarget = event.target as HTMLElement | null
        if (dragTarget && dragTarget !== event.currentTarget && /^(BUTTON|A|INPUT|SELECT|TEXTAREA)$/i.test(dragTarget.tagName ?? '')) {
          return
        }
      }
      const panel = panelRef.current
      const stage = panel?.parentElement
      const size = stageSize()
      if (!panel || !stage || !size) return

      event.preventDefault()
      setMenuOpen(false)

      const panelRect = panel.getBoundingClientRect()
      const stageRect = stage.getBoundingClientRect()
      const origin = layout ?? {
        x: Math.round(panelRect.left - stageRect.left),
        y: Math.round(panelRect.top - stageRect.top),
        width: Math.round(panelRect.width) || TOOL_PANEL_MIN_WIDTH,
        height: Math.round(panelRect.height) || TOOL_PANEL_MIN_HEIGHT,
      }
      const start = clampToolPanelLayout(origin, size)

      try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* noop */ }

      if (mode === 'resize') {
        const ghost = ghostRef.current
        if (ghost) {
          ghost.style.display = 'block'
          ghost.style.left = `${start.x}px`
          ghost.style.top = `${start.y}px`
          ghost.style.width = `${start.width}px`
          ghost.style.height = `${start.height}px`
        }
      }

      interactionRef.current = {
        pointerId: event.pointerId,
        mode,
        startX: event.clientX,
        startY: event.clientY,
        origin: start,
        latest: start,
        stage: size,
      }
      if (mode === 'drag') {
        setLayout(start)
      }
      setInteraction(mode)
    },
    [layout, setLayout, stageSize],
  )

  const moveInteraction = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const state = interactionRef.current
      if (!state || state.pointerId !== event.pointerId) return
      event.preventDefault()

      const dx = event.clientX - state.startX
      const dy = event.clientY - state.startY

      if (state.mode === 'drag') {
        const next = clampToolPanelLayout(
          { ...state.origin, x: state.origin.x + dx, y: state.origin.y + dy },
          state.stage,
        )
        state.latest = next
        setLayout(next)
      } else {
        const right = state.origin.x + state.origin.width
        const bottom = state.origin.y + state.origin.height
        const newX = Math.max(0, Math.min(state.origin.x + dx, right - TOOL_PANEL_MIN_WIDTH))
        const newY = Math.max(0, Math.min(state.origin.y + dy, bottom - TOOL_PANEL_MIN_HEIGHT))
        const next: ToolPanelLayout = {
          x: newX,
          y: newY,
          width: Math.max(TOOL_PANEL_MIN_WIDTH, right - newX),
          height: Math.max(TOOL_PANEL_MIN_HEIGHT, bottom - newY),
        }
        const clamped = clampToolPanelLayout(next, state.stage)
        state.latest = clamped
        const ghost = ghostRef.current
        if (ghost) {
          ghost.style.left = `${clamped.x}px`
          ghost.style.top = `${clamped.y}px`
          ghost.style.width = `${clamped.width}px`
          ghost.style.height = `${clamped.height}px`
        }
      }
    },
    [setLayout],
  )

  const endInteraction = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const state = interactionRef.current
      if (!state || state.pointerId !== event.pointerId) return
      interactionRef.current = null
      setInteraction(null)
      try { event.currentTarget.releasePointerCapture(event.pointerId) } catch { /* noop */ }
      const ghost = ghostRef.current
      if (ghost) ghost.style.display = 'none'
      if (state.mode === 'resize') {
        setLayout(state.latest)
        persist(state.latest)
      } else if (state.mode === 'drag') {
        persist(state.latest)
      }
    },
    [setLayout, persist],
  )

  const cancelInteraction = useCallback(() => {
    interactionRef.current = null
    setInteraction(null)
    const ghost = ghostRef.current
    if (ghost) ghost.style.display = 'none'
  }, [])

  useEffect(() => {
    const handler = () => {
      if (interactionRef.current) cancelInteraction()
    }
    window.addEventListener('blur', handler)
    return () => window.removeEventListener('blur', handler)
  }, [cancelInteraction])

  const definition = getEventDefinition(event)
  const size = definition?.cubeSize ?? null
  const puzzle = definition?.puzzleId ?? '3x3x3'
  const label = definition?.label ?? event
  const net = (() => (scramble && size ? cubeNetForScramble(scramble, size) : null))()

  return (
    <>
    <section id="tool-panel" ref={panelRef} className={`scramble-draw-panel tool-panel${interaction ? ` is-${interaction}` : ''}`} aria-label="Tool panel" data-testid="tool-panel" data-mode={mode} data-tool={activeTool} data-scramble={scramble ?? ''} data-interaction={interaction ?? undefined}
      style={layout ? { left: `${layout.x}px`, top: `${layout.y}px`, right: 'auto', bottom: 'auto', width: `${layout.width}px`, height: `${layout.height}px` } : undefined}>

      <div className="scramble-draw-header" data-testid="tool-panel-drag-handle" title="Drag to move" onPointerDown={beginInteraction('drag')} onPointerMove={moveInteraction} onPointerUp={endInteraction} onPointerCancel={endInteraction}>
        <span>{toolLabel(activeTool)}</span>
        {activeTool === 'drawScramble' ? <span className="scramble-draw-mode">{mode === 'net' ? '2D' : '3D'}</span> : null}
      </div>
      <div className="scramble-draw-stage" style={{ position: 'relative' }}>
        {activeTool === 'drawScramble' ? (
          !scramble ? <p className="scramble-draw-status">Preparing scramble…</p>
          : mode === 'net' ? (
            size === null ? (
              <p
                className="scramble-draw-status"
                role="status"
                data-testid="draw-scramble-unavailable"
              >
                2D net is not available for {label}. Switch Draw Scramble to
                3D in Settings to see this puzzle.
              </p>
            ) : net ? (
              <ScrambleNet net={net} />
            ) : (
              <p className="scramble-draw-status" role="alert">
                This scramble cannot be drawn.
              </p>
            )
          ) : (
            <TwistyCube
              scramble={scramble}
              puzzle={puzzle}
              useStandardCubeColors={size !== null}
            />
          )
        ) : activeTool === 'timeTrend' ? (
          <TimeTrend solves={solves} compact disabled={timerActive} trimming={trimming} />
        ) : null}
      </div>
      <footer className="scramble-draw-footer">
        <span className="scramble-draw-footer-label">Function</span>
        <div className="scramble-tool-menu-wrap" ref={menuRef}>
          <button ref={buttonRef} type="button" className="scramble-draw-select" onClick={() => setMenuOpen((o) => !o)} aria-label={`Function: ${toolLabel(activeTool)}`} aria-haspopup="menu" aria-expanded={menuOpen} data-testid="tool-select-button">
            <span className="scramble-draw-select-value">{toolLabel(activeTool)}</span>
            <span className="scramble-tool-caret" aria-hidden="true">▴</span>
          </button>
          {menuOpen ? (
            <div className="scramble-tool-menu is-up" role="menu" aria-label="Function" data-testid="tool-select-menu">
              {TOOL_OPTIONS.map((option) => {
                const selected = option.id === activeTool
                return (
                  <button key={option.id} type="button" className={`scramble-tool-item${selected ? ' is-selected' : ''}`} role="menuitemradio" aria-checked={selected} title={option.description} onClick={() => { setMenuOpen(false); onSelectTool(option.id) }}>
                    <span>{option.label}</span>
                    <span className="scramble-tool-check" aria-hidden="true">{selected ? '✓' : ''}</span>
                  </button>
                )
              })}
            </div>
          ) : null}
        </div>
      </footer>
      <span className="scramble-draw-resize" data-testid="tool-panel-resize-handle" aria-hidden="true" onPointerDown={beginInteraction('resize')} onPointerMove={moveInteraction} onPointerUp={endInteraction} onPointerCancel={endInteraction} />
    </section>
    {ghostPortalContainer
      ? createPortal(
          <div className="scramble-draw-ghost" ref={ghostRef} aria-hidden="true" data-testid="tool-panel-ghost" />,
          ghostPortalContainer,
        )
      : null}
    </>
  )
}