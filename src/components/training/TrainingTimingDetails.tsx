import { trainingTime, trainingWindowCell } from '../../lib/training/format'
import { STANDARD_CASE_BY_ID } from '../../lib/training/catalog/standardCases'
import { trainingOutcome } from '../../lib/training/results'
import { storedTrainingEstimate, trainingTimingWindows, type TrainingMetric, type TrainingTimingWindow } from '../../lib/training/stats'
import type { TrainingAttempt } from '../../lib/training/types'
import { TrainingDialog } from './TrainingDialog'

interface Props {
  label: string
  size: number
  trim: number
  metric: TrainingMetric
  attempts: readonly TrainingAttempt[]
  onClose: () => void
}

export function TrainingTimingDetails({ label, size, trim, metric, attempts, onClose }: Props) {
  const { current, best } = trainingTimingWindows(attempts, size, trim, metric)
  const renderWindow = (label: string, window: TrainingTimingWindow | null) => {
    const cell = trainingWindowCell(window?.result)
    return (
      <section>
        <h3>{label} · {cell.text}</h3>
        {cell.title ? <p>{cell.title}</p> : null}
        {window && window.end >= size ? (
          <ol className="training-timing-list">
            {attempts.slice(window.end - size, window.end).map(attempt => {
              const outcome = trainingOutcome(attempt.result)
              return (
                <li key={attempt.id}>
                  <span>{STANDARD_CASE_BY_ID.get(attempt.caseId)?.name ?? attempt.caseId}</span>
                  <strong>{outcome === 'dnf' ? 'DNF' : outcome === 'unsupported' ? 'Legacy result' : trainingTime(metric === 'raw' ? attempt.rawMs : storedTrainingEstimate(attempt))}</strong>
                </li>
              )
            })}
          </ol>
        ) : null}
      </section>
    )
  }

  return (
    <TrainingDialog title={`${label} · ${metric === 'raw' ? 'Raw' : 'Estimated'}`} onClose={onClose}>
      {size > 1 ? <p className="settings-note">{trim > 0 ? `${trim}% trimmed per side, rounded up. DNFs rank slowest.` : 'Untrimmed. A DNF makes the window a DNF.'}</p> : null}
      <div className="training-timing-windows">{renderWindow('Current', current)}{renderWindow('Best', best)}</div>
    </TrainingDialog>
  )
}
