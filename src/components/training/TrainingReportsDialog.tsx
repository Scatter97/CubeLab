import { useState, type RefCallback } from 'react'
import type { TrainingData } from '../../lib/training/types'
import type { TrainingController } from '../../lib/training/controller'
import { calculateTrainingReport } from '../../lib/training/reports'
import { TrainingDialog } from './TrainingDialog'
import { TrainingSessionReport } from './TrainingSessionReport'
import { trainingCategoryLabel } from '../../lib/training/statisticsView'

export function TrainingReportsDialog({ data, controller, onOpenAttempt, onClose, toastHostRef, requiredId, reviewId, closeDisabled }: { data: TrainingData; controller: TrainingController; onOpenAttempt: (id: string) => void; onClose: () => void; toastHostRef?: RefCallback<HTMLDivElement>; requiredId?: string; reviewId?: string; closeDisabled?: boolean }) {
  const [id, setId] = useState<string | null>(null)
  const completed = data.visits.filter(v => v.endedAt !== null && (!v.session || v.attemptIds.length > 0))
  const selectedId = requiredId ?? reviewId
  const visit = data.visits.find(v => v.id === (selectedId ?? id))
  const report = visit ? calculateTrainingReport(data, visit.id) : null
  return <TrainingDialog title={selectedId ? visit?.session?.name ?? 'Session report' : 'Practice history'} onClose={onClose} toastHostRef={toastHostRef} closeLabel={requiredId ? 'Done' : undefined} closeDisabled={closeDisabled}>
    {!selectedId ? <><div className="training-report-list">{completed.toReversed().map(v => <div key={v.id}>
      <button type="button" className="button button-secondary" onClick={() => setId(v.id)}>{v.session ? `${v.session.name} · ` : ''}{new Date(v.startedAt).toLocaleString()} · {trainingCategoryLabel(v.startedCategoryId)} · {v.attemptIds.length} {v.attemptIds.length === 1 ? 'attempt' : 'attempts'}{v.lifecycle?.reportPending ? ' · New report' : ''}</button>
      {v.lifecycle?.reportPending && !v.session ? <button type="button" className="button button-secondary" onClick={() => controller.acknowledgeReport(v.id)}>Dismiss report</button> : null}
    </div>)}</div>
    {!completed.length ? <p>Completed practice sessions appear here.</p> : null}</> : null}
    {report && visit ? <TrainingSessionReport visit={visit} report={report} onOpenAttempt={onOpenAttempt} /> : null}
  </TrainingDialog>
}
