import { copyText } from '../lib/clipboard'
import { toolLabel, type CurrentTool } from '../lib/tools'
import { WrenchIcon, RefreshIcon } from './Icons'
import type { ScrambleAction, ScrambleAlignment, PuzzleEvent } from '../types'
import { CUBELAB_EVENTS } from '../lib/events'

interface ScramblePanelProps {
  event: PuzzleEvent
  scramble: string | null
  nextScramble: string | null
  isLoading: boolean
  error: string | null
  canRegenerate: boolean
  onRegenerate: () => void
  onRetry: () => void
  onNotify: (message: string) => void
  scrambleAction?: ScrambleAction
  alignment?: ScrambleAlignment
  limitHeight?: boolean
  activeTool: CurrentTool
  toolPanelOpen: boolean
  onToggleToolPanel: () => void
}

export function ScramblePanel({
  event,
  scramble,
  nextScramble,
  isLoading,
  error,
  canRegenerate,
  onRegenerate,
  onRetry,
  onNotify,
  scrambleAction = 'none',
  alignment,
  limitHeight = false,
  activeTool,
  toolPanelOpen,
  onToggleToolPanel,
}: ScramblePanelProps) {
  const handleCopy = async () => {
    if (!scramble) return
    const didCopy = await copyText(scramble)
    onNotify(didCopy ? 'Scramble copied to clipboard' : 'Could not copy the scramble')
  }

  const activateScramble = () => {
    if (scrambleAction === 'copy') {
      void handleCopy()
    } else if (scrambleAction === 'next' && canRegenerate) {
      onRegenerate()
    }
  }

  const canActivate = Boolean(scramble) && scrambleAction !== 'none'

  return (
    <section className="panel scramble-panel" aria-labelledby="scramble-title">
      <div className="scramble-header">
        <div className="section-heading">
          <span className="eyebrow">
            <span className="eyebrow-index">02</span>
            Scramble
          </span>
          <span className="scramble-badge">
            <span className="badge-dot" aria-hidden="true" />
            {CUBELAB_EVENTS.find((option) => option.id === event)?.label ?? event} · scramble
          </span>
        </div>

        <div className="scramble-tools">
          <button
            type="button"
            className="icon-button"
            onClick={onRegenerate}
            disabled={!canRegenerate}
            aria-label="Generate a new scramble"
            title="New scramble"
          >
            <RefreshIcon
              size={17}
              className={isLoading && !scramble ? 'is-spinning' : undefined}
            />
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={onToggleToolPanel}
            aria-label={`${toolPanelOpen ? 'Hide' : 'Show'} current tool panel: ${toolLabel(activeTool)}`}
            aria-expanded={toolPanelOpen}
            aria-controls="tool-panel"
            title={toolPanelOpen ? 'Hide tool panel' : 'Show tool panel'}
            data-testid="current-tool-button"
          >
            <WrenchIcon size={17} />
          </button>
        </div>
      </div>

      <div
        className="scramble-body"
        aria-busy={isLoading && !scramble}
        role={canActivate ? 'button' : undefined}
        tabIndex={canActivate ? 0 : undefined}
        aria-label={
          canActivate
            ? scrambleAction === 'copy'
              ? `Copy scramble: ${scramble}`
              : `Generate next scramble: ${scramble}`
            : undefined
        }
        onClick={canActivate ? activateScramble : undefined}
        onKeyDown={(event) => {
          // Space remains reserved for the timer; Enter activates the
          // scramble action for keyboard users.
          if (!canActivate || event.key !== 'Enter') return
          event.preventDefault()
          activateScramble()
        }}
      >
        {scramble ? (
          <p
            className={`scramble-text${
              alignment ? ` is-aligned-${alignment}` : ''
            }${limitHeight ? ' is-height-limited' : ''}`}
            aria-live="polite"
          >
            {scramble}
          </p>
        ) : error ? (
          <div className="scramble-error" role="alert">
            <span>{error}</span>
            <button type="button" className="text-button" onClick={onRetry}>
              Retry
            </button>
          </div>
        ) : (
          <div className="scramble-skeleton" aria-label="Generating scramble">
            <span />
            <span />
          </div>
        )}
      </div>

      <div className="scramble-footer">
        <span className="queue-label">
          <span
            className={`queue-indicator ${
              error ? 'is-error' : isLoading ? 'is-loading' : ''
            }`}
            aria-hidden="true"
          />
          {error ? 'Scramble unavailable' : isLoading ? 'Preparing next' : 'Queue ready'}
        </span>
        {error && scramble ? (
          <button type="button" className="text-button" onClick={onRetry}>
            Retry next scramble
          </button>
        ) : (
          <span className="next-scramble" title={nextScramble ?? undefined}>
            {error
              ? 'Retry above to continue'
              : nextScramble ?? 'Next scramble will appear here'}
          </span>
        )}
      </div>
    </section>
  )
}