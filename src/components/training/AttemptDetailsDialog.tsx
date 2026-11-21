import { useState } from 'react'
import type { TrainingAttempt } from '../../lib/training/types'
import type { TrainingController } from '../../lib/training/controller'
import { copyText } from '../../lib/clipboard'
import { dateTimeAttribute } from '../../lib/dates'
import { trainingOutcome } from '../../lib/training/results'
import { STANDARD_CASE_BY_ID } from '../../lib/training/catalog/standardCases'
import { TrainingDialog } from './TrainingDialog'
import { CaseDiagram } from './CaseDiagram'
import { storedTrainingEstimate } from '../../lib/training/stats'
import { trainingTime } from '../../lib/training/format'
import { trainingCategoryLabel } from '../../lib/training/statisticsView'

interface Props {
  attempt: TrainingAttempt
  controller: TrainingController
  locked: boolean
  onDelete: (id: string) => boolean
  onClose: () => void
}

const attemptDate = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
})

export function AttemptDetailsDialog({
  attempt,
  controller,
  locked,
  onDelete,
  onClose,
}: Props) {
  const [copyStatus, setCopyStatus] = useState('')
  const outcome = trainingOutcome(attempt.result)
  const outcomeLabel =
    outcome === 'dnf'
      ? 'DNF'
      : outcome === 'unsupported'
        ? 'Unsupported legacy result'
        : 'Successful'
  const raw = trainingTime(attempt.rawMs)
  const setup = attempt.setup.generated.scramble

  return (
    <TrainingDialog
      title="Attempt details"
      className="training-attempt-dialog"
      onClose={onClose}
    >
      <div className="training-attempt-summary">
        <CaseDiagram caseId={attempt.caseId} size={64} decorative />
        <div className="training-attempt-case">
          <h3>{STANDARD_CASE_BY_ID.get(attempt.caseId)?.name ?? attempt.caseId}</h3>
          <p>{trainingCategoryLabel(attempt.categoryId)}</p>
          <time dateTime={dateTimeAttribute(attempt.createdAt)}>
            {attemptDate.format(attempt.createdAt)}
          </time>
        </div>
        <div className="training-attempt-result" aria-label="Attempt result">
          <strong className={outcome === 'dnf' ? 'is-dnf' : undefined}>
            {outcome === 'dnf' ? 'DNF' : raw}
          </strong>
          <p>{outcome === 'dnf' ? `Raw ${raw}` : outcomeLabel}</p>
        </div>
      </div>
      {attempt.mode === 'recognition' ? (
        <dl className="training-attempt-measures">
          <div>
            <dt>Estimated recognition + execution</dt>
            <dd>{trainingTime(storedTrainingEstimate(attempt))}</dd>
            {attempt.estimateUnavailableReason ? (
              <dd className="training-attempt-measure-note">
                {attempt.estimateUnavailableReason.replaceAll('-', ' ')}
              </dd>
            ) : null}
          </div>
          <div>
            <dt>Captured calibration median</dt>
            <dd>{trainingTime(attempt.calibration?.medianMs ?? null)}</dd>
          </div>
        </dl>
      ) : null}
      <section className="training-attempt-section">
        <h3>Setup</h3>
        <div className="training-attempt-setup">
          <p className="training-notation">{setup}</p>
          <button
            type="button"
            className="button button-secondary button-small"
            aria-label="Copy setup"
            onClick={async (event) => {
              const trigger = event.currentTarget
              const copied = await copyText(
                setup,
                trigger.closest('dialog') ?? undefined,
              )
              setCopyStatus(copied ? 'Setup copied' : 'Could not copy setup')
            }}
          >
            Copy
          </button>
        </div>
        <span
          className={copyStatus ? 'training-attempt-copy-status' : 'sr-only'}
          role="status"
        >
          {copyStatus}
        </span>
        {attempt.setup.generated.precursor ? (
          <p>
            Fixed precursor{' '}
            <span className="training-notation">
              {attempt.setup.generated.precursor}
            </span>
          </p>
        ) : null}
      </section>
      <footer className="training-attempt-footer">
        <button
          type="button"
          className="button button-secondary button-small"
          disabled={locked || outcome === 'unsupported'}
          onClick={() =>
            controller.correctResult(
              attempt.id,
              outcome === 'dnf' ? 'success' : 'dnf',
            )
          }
        >
          {outcome === 'dnf' ? 'Mark successful' : 'Mark as DNF'}
        </button>
        <button
          type="button"
          className="button button-small training-attempt-delete"
          disabled={locked}
          onClick={() => {
            if (onDelete(attempt.id)) onClose()
          }}
        >
          Delete attempt
        </button>
      </footer>
    </TrainingDialog>
  )
}
