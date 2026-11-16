import { memo } from 'react'
import { useHistoryList } from '../../hooks/useHistoryList'
import { useHistoryMenu } from '../../hooks/useHistoryMenu'
import { copyText } from '../../lib/clipboard'
import { formatRelativeTime } from '../../lib/format'
import { dateTimeAttribute } from '../../lib/dates'
import { STANDARD_CASE_BY_ID } from '../../lib/training/catalog/standardCases'
import { trainingTime } from '../../lib/training/format'
import { trainingOutcome } from '../../lib/training/results'
import { storedTrainingEstimate } from '../../lib/training/stats'
import type { TrainingAttempt } from '../../lib/training/types'
import { HistoryPanel, HistoryRow } from '../HistoryPanel'
import { HistoryActionMenu, HistoryMenuAction } from '../HistoryActionMenu'
import { CopyIcon, ListIcon, TrashIcon } from '../Icons'

interface Props {
  attempts: readonly TrainingAttempt[]
  selectedId: string | null
  locked: boolean
  showEstimated: boolean
  onOpen: (id: string) => void
  onCorrectResult: (id: string, outcome: 'success' | 'dnf') => void
  onDelete: (id: string) => boolean
  onNotify: (message: string) => void
}

export const TrainingAttempts = memo(function TrainingAttempts({
  attempts, selectedId, locked, showEstimated, onOpen, onCorrectResult, onDelete, onNotify,
}: Props) {
  const history = useHistoryList(attempts)
  const { openMenu, menuRef, toggleMenu, hoverMenu, closeMenu } =
    useHistoryMenu(attempts, history.scrollRef, history.captureAnchor, locked)
  const attempt = openMenu?.item
  const outcome = attempt ? trainingOutcome(attempt.result) : null
  const time = attempt ? outcome === 'dnf' ? 'DNF' : trainingTime(attempt.rawMs) : ''
  const name = attempt ? STANDARD_CASE_BY_ID.get(attempt.caseId)?.name ?? attempt.caseId : ''
  const setup = attempt?.setup.generated.scramble ?? ''

  const copy = async (text: string, message: string) => {
    closeMenu()
    const copied = await copyText(text)
    onNotify(copied ? message : 'Could not copy to the clipboard')
  }
  return (
    <HistoryPanel
      title="Attempts" count={attempts.length} empty="No attempts yet."
      listLabel="Training attempt history" listTestId="attempt-history-list" countTestId="attempt-count"
      windowToggleTestId="attempt-history-window-toggle" history={history} locked={locked}
      renderRows={(start, end) => attempts.slice(start, end).map((attempt, offset) => {
        const number = attempts.length - start - offset
        const menuOpen = openMenu?.id === attempt.id
        const selected = menuOpen || selectedId === attempt.id
        const outcome = trainingOutcome(attempt.result)
        const time = outcome === 'dnf' ? 'DNF' : trainingTime(attempt.rawMs)
        const name = STANDARD_CASE_BY_ID.get(attempt.caseId)?.name ?? attempt.caseId
        const estimate = showEstimated ? storedTrainingEstimate(attempt) : null
        return (
          <HistoryRow key={attempt.id} rowId={attempt.id} selected={selected} time={time}
            timeClassName={outcome === 'dnf' ? 'is-dnf' : undefined}
            data-testid="attempt-history-row" aria-posinset={start + offset + 1} aria-setsize={attempts.length}
            main={{
              'aria-haspopup': 'menu', 'aria-expanded': menuOpen, disabled: locked,
              onClick: event => toggleMenu(attempt, event.currentTarget),
              onMouseEnter: event => hoverMenu(attempt, event.currentTarget),
            }}>
            <span className="history-meta">
              <span>#{number}</span><span aria-hidden="true">·</span>
              <time dateTime={dateTimeAttribute(attempt.createdAt)} title={new Date(attempt.createdAt).toLocaleString()}>{formatRelativeTime(attempt.createdAt)}</time>
              {outcome === 'dnf' ? <span className="effective-time">Raw {trainingTime(attempt.rawMs)}</span> : null}
            </span>
            <span className="history-scramble">{name}
              {estimate !== null ? ` · Est. ${trainingTime(estimate)}` : outcome === 'unsupported' ? ' · Legacy result' : ''}
            </span>
          </HistoryRow>
        )
      })}
    >
      {openMenu && attempt ? (
        <HistoryActionMenu
          menuRef={menuRef} rect={openMenu.rect}
          label={`Attempt ${openMenu.number} actions`} title={`Attempt #${openMenu.number}`}
          time={time} secondary={outcome === 'dnf' ? `${name} · Raw ${trainingTime(attempt.rawMs)}` : name}
          footer={<HistoryMenuAction icon={<TrashIcon size={14} />} danger onClick={() => {
            history.captureAnchor()
            closeMenu()
            if (onDelete(attempt.id)) openMenu.trigger.closest<HTMLElement>('.history-panel')?.focus({ preventScroll: true })
          }}>Delete attempt</HistoryMenuAction>}
        >
          <HistoryMenuAction icon={<span className="solve-menu-action-icon" aria-hidden="true">DNF</span>}
            disabled={outcome === 'unsupported'} onClick={() => {
              history.captureAnchor()
              closeMenu()
              onCorrectResult(attempt.id, outcome === 'dnf' ? 'success' : 'dnf')
            }}>
            {outcome === 'dnf' ? 'Mark successful' : 'Mark as DNF'}
          </HistoryMenuAction>
          <HistoryMenuAction icon={<CopyIcon size={14} />} onClick={() => void copy(setup, 'Setup copied to clipboard')}>
            Copy setup
          </HistoryMenuAction>
          <HistoryMenuAction icon={<CopyIcon size={14} />} onClick={() => void copy(time, 'Attempt time copied')}>
            Copy attempt time
          </HistoryMenuAction>
          <HistoryMenuAction icon={<CopyIcon size={14} />} onClick={() => void copy(`${time} — ${name} — ${setup}`, 'Attempt copied to clipboard')}>
            Copy attempt text
          </HistoryMenuAction>
          <HistoryMenuAction icon={<ListIcon size={14} />} onClick={() => { closeMenu(); onOpen(attempt.id) }}>
            Attempt details
          </HistoryMenuAction>
        </HistoryActionMenu>
      ) : null}
    </HistoryPanel>
  )
})
