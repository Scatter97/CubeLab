import { useId, useState } from 'react'
import type { TrainingAttempt, TrainingData } from '../../lib/training/types'
import type { TrainingController } from '../../lib/training/controller'
import { availableAlgorithms, trainingAlgorithmKey, type ResolvedTrainingAlgorithm } from '../../lib/training/algorithmSelection'
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
  data: TrainingData
  controller: TrainingController
  locked: boolean
  onDelete: (id: string) => boolean
  onClose: () => void
}

const attemptDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

function algorithmName(option: ResolvedTrainingAlgorithm) {
  return option.source === 'built-in' ? 'Built-in default' : option.record.label ?? 'My algorithm'
}

export function AttemptDetailsDialog({ attempt, data, controller, locked, onDelete, onClose }: Props) {
  const [editing, setEditing] = useState(false)
  const [copyStatus, setCopyStatus] = useState('')
  const editorId = useId()
  const outcome = trainingOutcome(attempt.result)
  const outcomeLabel = outcome === 'dnf' ? 'DNF' : outcome === 'unsupported' ? 'Unsupported legacy result' : 'Successful'
  const raw = trainingTime(attempt.rawMs)
  const attributed = attempt.attribution.kind === 'unknown' ? null : attempt.attribution.algorithm
  const canEditAttribution = data.preferences.algorithmTracking && attempt.algorithmTracking !== false
  const alternatives = attributed || canEditAttribution ? availableAlgorithms(data, attempt.caseId) : []
  const selected = attributed ? trainingAlgorithmKey(attributed) : ''
  const current = alternatives.find(option => trainingAlgorithmKey(option.snapshot) === selected)
  const setup = attempt.setup.generated.scramble

  return (
    <TrainingDialog title="Attempt details" className="training-attempt-dialog" onClose={onClose}>
      <div className="training-attempt-summary">
        <CaseDiagram caseId={attempt.caseId} size={64} decorative />
        <div className="training-attempt-case">
          <h3>{STANDARD_CASE_BY_ID.get(attempt.caseId)?.name ?? attempt.caseId}</h3>
          <p>{trainingCategoryLabel(attempt.categoryId)}</p>
          <time dateTime={dateTimeAttribute(attempt.createdAt)}>{attemptDate.format(attempt.createdAt)}</time>
        </div>
        <div className="training-attempt-result" aria-label="Attempt result">
          <strong className={outcome === 'dnf' ? 'is-dnf' : undefined}>{outcome === 'dnf' ? 'DNF' : raw}</strong>
          <p>{outcome === 'dnf' ? `Raw ${raw}` : outcomeLabel}</p>
        </div>
      </div>
      {attempt.mode === 'recognition' ? (
        <dl className="training-attempt-measures">
          <div>
            <dt>Estimated recognition + execution</dt>
            <dd>{trainingTime(storedTrainingEstimate(attempt))}</dd>
            {attempt.estimateUnavailableReason ? <dd className="training-attempt-measure-note">{attempt.estimateUnavailableReason.replaceAll('-', ' ')}</dd> : null}
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
          <button type="button" className="button button-secondary button-small" aria-label="Copy setup" onClick={async event => {
            const trigger = event.currentTarget
            const copied = await copyText(setup, trigger.closest('dialog') ?? undefined)
            setCopyStatus(copied ? 'Setup copied' : 'Could not copy setup')
          }}>Copy</button>
        </div>
        <span className={copyStatus ? 'training-attempt-copy-status' : 'sr-only'} role="status">{copyStatus}</span>
        {attempt.setup.generated.precursor ? <p>Fixed precursor <span className="training-notation">{attempt.setup.generated.precursor}</span></p> : null}
      </section>
      <section className="training-attempt-section">
        <h3>Algorithm</h3>
        {attributed ? (
          <>
            <p>{current ? algorithmName(current) : 'Historical algorithm'} · Rev. {attributed.revision} · {attempt.attribution.kind === 'assumed-preferred' ? 'Assumed preferred' : 'User corrected'}</p>
            <p className="training-notation">{attributed.notation ?? attributed.id}</p>
          </>
        ) : <p>{attempt.algorithmTracking === false ? 'Tracking was off for this attempt.' : 'Unknown'}</p>}
        {canEditAttribution ? <><button type="button" className="button button-secondary button-small" aria-expanded={editing}
          aria-controls={editorId} disabled={locked} onClick={() => setEditing(open => !open)}>
          {editing ? 'Hide attribution editor' : 'Change attribution…'}
        </button>
        <div id={editorId} hidden={!editing} className="training-attempt-attribution">
          <label htmlFor={`${editorId}-algorithm`}>Correct algorithm attribution</label>
          <select id={`${editorId}-algorithm`} disabled={locked} value={selected} onChange={event => {
            const value = event.target.value
            const algorithm = alternatives.find(option => trainingAlgorithmKey(option.snapshot) === value)
            if (!value || algorithm) controller.correctAttribution(attempt.id, algorithm?.snapshot ?? null)
          }}>
            <option value="">Unknown</option>
            {attributed && !current ? <option value={selected}>Historical algorithm · revision {attributed.revision}</option> : null}
            {alternatives.map(option => (
              <option key={trainingAlgorithmKey(option.snapshot)} value={trainingAlgorithmKey(option.snapshot)}>
                {algorithmName(option)}{option.source === 'custom' ? ` · revision ${option.record.version}` : ''} · {option.record.notation}
              </option>
            ))}
          </select>
          <p>Changing attribution preserves the original assumption.</p>
        </div></> : null}
      </section>
      <footer className="training-attempt-footer">
        <button type="button" className="button button-secondary button-small" disabled={locked || outcome === 'unsupported'}
          onClick={() => controller.correctResult(attempt.id, outcome === 'dnf' ? 'success' : 'dnf')}>
          {outcome === 'dnf' ? 'Mark successful' : 'Mark as DNF'}
        </button>
        <button type="button" className="button button-small training-attempt-delete" disabled={locked}
          onClick={() => { if (onDelete(attempt.id)) onClose() }}>Delete attempt</button>
      </footer>
    </TrainingDialog>
  )
}
