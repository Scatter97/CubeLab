import { memo } from 'react'
import { archivedTrainingChange } from '../../lib/training/archive'
import { trainingChangeLabel } from '../../lib/training/format'
import { trainingCategoryLabel } from '../../lib/training/statisticsView'
import type { TrainingData, TrainingVisit } from '../../lib/training/types'

export const TrainingArchiveRows = memo(function TrainingArchiveRows({ data, visits, onReview, onDelete }: {
  data: TrainingData
  visits: readonly TrainingVisit[]
  onReview: (id: string) => void
  onDelete?: (visit: TrainingVisit) => void
}) {
  return <ul className="training-archive-rows">{visits.map(visit => {
    const name = visit.session?.name ?? 'Legacy visit'
    const change = archivedTrainingChange(data, visit)
    return <li key={visit.id}>
      <div className="training-archive-row-copy">
        <strong>{name}</strong>
        <span>{visit.categoryIds.map(trainingCategoryLabel).join(', ')} · {visit.attemptIds.length} {visit.attemptIds.length === 1 ? 'attempt' : 'attempts'}</span>
        {change !== null ? <span className={change < 0 ? 'training-faster' : change > 0 ? 'training-slower' : undefined}>{trainingChangeLabel(change)}</span> : null}
      </div>
      <time dateTime={new Date(visit.startedAt).toISOString()}>{new Date(visit.startedAt).toLocaleDateString()}</time>
      <div className="training-actions">
        <button type="button" className="button button-secondary button-small" aria-label={`Review ${name}`} onClick={() => onReview(visit.id)}>Review</button>
        {onDelete && visit.session && !visit.lifecycle?.reportPending ? <button type="button" className="text-button"
          aria-label={`Delete ${name}`} onClick={() => onDelete(visit)}>Delete</button> : null}
      </div>
    </li>
  })}</ul>
})
