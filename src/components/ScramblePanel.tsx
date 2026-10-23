import { useEffect, useRef, useState } from 'react'
import { copyText } from '../lib/clipboard'
import { CheckIcon, CopyIcon, RefreshIcon } from './Icons'

interface ScramblePanelProps {
  scramble: string | null
  nextScramble: string | null
  isLoading: boolean
  error: string | null
  canRegenerate: boolean
  onRegenerate: () => void
  onRetry: () => void
  onNotify: (message: string) => void
}

export function ScramblePanel({
  scramble,
  nextScramble,
  isLoading,
  error,
  canRegenerate,
  onRegenerate,
  onRetry,
  onNotify,
}: ScramblePanelProps) {
  const [copied, setCopied] = useState(false)
  const copiedTimer = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (copiedTimer.current !== null) {
        window.clearTimeout(copiedTimer.current)
      }
    }
  }, [])

  const handleCopy = async () => {
    if (!scramble) return
    const didCopy = await copyText(scramble)
    if (didCopy) {
      setCopied(true)
      onNotify('Scramble copied to clipboard')
      if (copiedTimer.current !== null) {
        window.clearTimeout(copiedTimer.current)
      }
      copiedTimer.current = window.setTimeout(() => setCopied(false), 1_800)
    } else {
      onNotify('Could not copy the scramble')
    }
  }

  return (
    <section className="panel scramble-panel" aria-labelledby="scramble-title">
      <div className="scramble-header">
        <div className="section-heading">
          <span className="eyebrow">
            <span className="eyebrow-index">01</span>
            Scramble
          </span>
          <span className="scramble-badge">
            <span className="badge-dot" aria-hidden="true" />
            3×3 · WCA random-state
          </span>
        </div>

        <div className="scramble-tools">
          <button
            type="button"
            className="icon-button"
            onClick={handleCopy}
            disabled={!scramble}
            aria-label="Copy scramble"
            title="Copy scramble"
          >
            {copied ? <CheckIcon size={17} /> : <CopyIcon size={17} />}
          </button>
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
        </div>
      </div>

      <div className="scramble-body" aria-busy={isLoading && !scramble}>
        {scramble ? (
          <p className="scramble-text" aria-live="polite">
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
