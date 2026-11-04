import { copyText } from '../lib/clipboard'
import { toolLabel, type CurrentTool } from '../lib/tools'
import { WrenchIcon, RefreshIcon } from './Icons'
import type { ScrambleAction, ScrambleAlignment, PuzzleEvent } from '../types'
import { getEventLabel } from '../lib/events'

interface ScramblePanelProps {
  event: PuzzleEvent
  scramble: string | null
  isLoading: boolean
  error: string | null
  canRegenerate: boolean
  onRegenerate: () => void
  onRetry: () => void
  onNotify: (message: string) => void
  scrambleAction?: ScrambleAction
  alignment?: ScrambleAlignment
  limitHeight?: boolean
  /** True when the text is a custom-event placeholder, not a real scramble. */
  placeholder?: boolean
  activeTool: CurrentTool
  toolPanelOpen: boolean
  onToggleToolPanel: () => void
}

export function ScramblePanel({
  event,
  scramble,
  isLoading,
  error,
  canRegenerate,
  onRegenerate,
  onRetry,
  onNotify,
  scrambleAction = 'none',
  alignment,
  limitHeight = false,
  placeholder = false,
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

  const canActivate =
    Boolean(scramble) && !placeholder && scrambleAction !== 'none'

  return (
    <section className="panel scramble-panel" aria-labelledby="scramble-title">
      <div className="scramble-header">
        <div className="section-heading">
          <h2 id="scramble-title" className="scramble-heading">
            Scramble
          </h2>
          <span className="scramble-badge">
            {getEventLabel(event)}
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
              placeholder ? ' is-placeholder' : ''
            }${
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

      {error ? (
        <div className="scramble-footer">
          <button type="button" className="text-button" onClick={onRetry}>
            {scramble ? 'Retry next scramble' : 'Retry'}
          </button>
        </div>
      ) : null}
    </section>
  )
}