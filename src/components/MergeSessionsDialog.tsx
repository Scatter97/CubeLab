import { useMemo, useState } from 'react'
import { useModalDialog } from '../hooks/useModalDialog'
import type { SessionsData } from '../types'
import { normalizeSessionName } from '../lib/sessions'
import { CloseIcon } from './Icons'
import { Select } from './Select'

interface MergeSessionsDialogProps {
  open: boolean
  sessions: SessionsData
  onClose: () => void
  onMerge: (sourceId: string, targetId: string) => boolean
}

type MergeSessionsContentProps = Omit<MergeSessionsDialogProps, 'open'>

function candidatePairs(sessions: SessionsData) {
  const pairs: Array<{
    name: string
    sessions: (typeof sessions.sessions[number])[]
  }> = []
  const groups = new Map<string, (typeof sessions.sessions[number])[]>()
  for (const session of sessions.sessions) {
    const key = normalizeSessionName(session.name).toLowerCase()
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)?.push(session)
  }
  for (const [name, candidates] of groups.entries()) {
    if (candidates.length > 1) pairs.push({ name, sessions: candidates })
  }
  return pairs
}

/**
 * The dialog shell owns the native modal lifecycle. Its body is mounted only
 * while open, so a previously typed confirmation can never survive a close and
 * silently authorise a later destructive merge.
 */
export function MergeSessionsDialog({
  open,
  sessions,
  onClose,
  onMerge,
}: MergeSessionsDialogProps) {
  const { dialogRef, handleKeyDown } = useModalDialog(open)

  return (
    <dialog
      ref={dialogRef}
      className="confirm-dialog settings-dialog"
      aria-labelledby="merge-sessions-title"
      aria-describedby="merge-sessions-description"
      onKeyDown={handleKeyDown}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose()
      }}
    >
      {open ? (
        <MergeSessionsContent
          sessions={sessions}
          onClose={onClose}
          onMerge={onMerge}
        />
      ) : null}
    </dialog>
  )
}

function MergeSessionsContent({
  sessions,
  onClose,
  onMerge,
}: MergeSessionsContentProps) {
  const pairs = useMemo(() => candidatePairs(sessions), [sessions])
  const [targetId, setTargetId] = useState('')
  const [sourceId, setSourceId] = useState('')
  const [phrase, setPhrase] = useState('')

  const firstPair = pairs[0]
  const effectiveTarget = targetId || firstPair?.sessions[0]?.id || ''
  const effectiveSource = sourceId || firstPair?.sessions[1]?.id || ''

  const target =
    sessions.sessions.find((session) => session.id === effectiveTarget) ?? null
  const source =
    sessions.sessions.find((session) => session.id === effectiveSource) ?? null
  const sameName =
    target &&
    source &&
    normalizeSessionName(target.name).toLowerCase() ===
      normalizeSessionName(source.name).toLowerCase()
  const canPreview =
    sameName && target && source && target.id !== source.id &&
    (target.event ?? '333') === (source.event ?? '333')
  const mergedSolveCount = canPreview
    ? new Set([...target.solves, ...source.solves].map((solve) => solve.id))
        .size
    : target?.solves.length ?? 0
  const approved = phrase === 'MERGE SESSIONS'
  const canSubmit = Boolean(canPreview && approved)

  return (
    <div className="dialog-content settings-content">
      <header className="settings-header">
        <div>
          <span className="eyebrow">Sessions</span>
          <h2 id="merge-sessions-title">Merge sessions</h2>
        </div>
        <button
          type="button"
          className="icon-button settings-close"
          aria-label="Close merge sessions"
          onClick={() => {
            onClose()
          }}
        >
          <CloseIcon size={16} />
        </button>
      </header>

      <p id="merge-sessions-description" className="settings-intro">
        Manually merge one session into another. Name matching alone does not
        merge sessions automatically.
      </p>

      <div className="settings-body">
        {pairs.length === 0 ? (
          <p className="settings-note">
            No duplicate session names were found.
          </p>
        ) : null}

        {pairs.map((group) => (
          <p key={group.name} className="settings-note">
            Found {group.sessions.length} separate sessions named{' '}
            &ldquo;{group.name}&rdquo;.
          </p>
        ))}

        {pairs.length > 0 ? (
          <>
            <div className="settings-row">
              <div className="settings-row-copy">
                <span className="settings-row-label">Destination session</span>
              </div>
              <Select
                ariaLabel="Destination session"
                className="compact-select"
                value={effectiveTarget}
                testId="merge-destination"
                options={sessions.sessions.map((session) => ({
                  value: session.id,
                  label: `${session.name} (${session.solves.length} solves)`,
                  text: session.name,
                }))}
                onChange={(value) => {
                  setTargetId(value)
                  // A confirmation applies to one reviewed pair only.
                  setPhrase('')
                }}
              />
            </div>

            <div className="settings-row">
              <div className="settings-row-copy">
                <span className="settings-row-label">Source session</span>
              </div>
              <Select
                ariaLabel="Source session"
                className="compact-select"
                value={effectiveSource}
                testId="merge-source"
                options={sessions.sessions
                  .filter((session) => session.id !== effectiveTarget)
                  .map((session) => ({
                    value: session.id,
                    label: `${session.name} (${session.solves.length} solves)`,
                    text: session.name,
                  }))}
                onChange={(value) => {
                  setSourceId(value)
                  setPhrase('')
                }}
              />
            </div>
          </>
        ) : null}

        {target && source && canPreview ? (
          <div className="settings-facts">
            <div>
              <span>Destination solves</span>
              <strong>{target.solves.length}</strong>
            </div>
            <div>
              <span>Source solves</span>
              <strong>{source.solves.length}</strong>
            </div>
            <div>
              <span>After merge</span>
              <strong>{mergedSolveCount}</strong>
            </div>
            <div>
              <span>Shared solve IDs</span>
              <strong>
                {
                  target.solves.filter((solve) =>
                    source.solves.some((item) => item.id === solve.id),
                  ).length
                }
              </strong>
            </div>
          </div>
        ) : null}

        {target && source ? (
          <div className="settings-field">
            <label htmlFor="merge-phrase">Typed confirmation</label>
            <input
              id="merge-phrase"
              type="text"
              placeholder="MERGE SESSIONS"
              value={phrase}
              onChange={(event) => setPhrase(event.target.value)}
              disabled={!canPreview}
            />
          </div>
        ) : null}
      </div>

      <footer className="settings-footer">
        <span className="settings-footer-note">
          Cancel leaves both sessions unchanged.
        </span>
        <button
          type="button"
          className="button button-secondary"
          aria-label="Cancel merge"
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          type="button"
          className="button button-primary"
          aria-label="Confirm merge"
          disabled={!canSubmit}
          onClick={() => {
            if (canSubmit && onMerge(effectiveSource, effectiveTarget)) {
              onClose()
            }
          }}
        >
          Merge sessions
        </button>
      </footer>
    </div>
  )
}
