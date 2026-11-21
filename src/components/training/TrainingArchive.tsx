import { useState } from 'react'
import type { TrainingController } from '../../lib/training/controller'
import { trainingArchiveVisits, type TrainingArchiveFilters } from '../../lib/training/archive'
import type { TrainingData, TrainingVisit } from '../../lib/training/types'
import { addLocalDays } from '../../lib/analytics'
import { useLocalDayRefresh } from '../../hooks/useLocalDayRefresh'
import { ConfirmDialog } from '../ConfirmDialog'
import { AttemptDetailsDialog } from './AttemptDetailsDialog'
import { downloadTrainingRecovery } from './downloadTrainingRecovery'
import { TrainingArchiveRows } from './TrainingArchiveRows'
import { TrainingDialog } from './TrainingDialog'
import { TrainingReportsDialog } from './TrainingReportsDialog'
import { TrainingSaveRecoveryProvider } from './TrainingSaveRecovery'

export interface TrainingArchiveRequest {
  reviewId?: string
  filters?: TrainingArchiveFilters
  dateRange?: number
}

export default function TrainingArchive({ data, controller, request, error, pendingSave, canDelete, onClose }: {
  data: TrainingData
  controller: TrainingController
  request: TrainingArchiveRequest
  error: string | null
  pendingSave: boolean
  canDelete: boolean
  onClose: () => void
}) {
  const [set, setSet] = useState<TrainingArchiveFilters['set']>(request.filters?.set ?? 'all')
  const [mode, setMode] = useState<TrainingArchiveFilters['mode']>(request.filters?.mode ?? 'all')
  const [days, setDays] = useState(request.dateRange ?? 0)
  const day = useLocalDayRefresh()
  const [limit, setLimit] = useState(20)
  const [review, setReview] = useState(request.reviewId)
  const [deleteTarget, setDeleteTarget] = useState<TrainingVisit | null>(null)
  const [attemptId, setAttemptId] = useState<string | null>(null)
  const attempt = data.attempts.find(item => item.id === attemptId)
  const visits = trainingArchiveVisits(data, { set, mode, since: days ? addLocalDays(day, 1 - days) : undefined })
  const recovery = pendingSave ? { error, retry: controller.retrySave, download: () => downloadTrainingRecovery(controller) } : null
  const closeReview = () => {
    if (request.reviewId) onClose()
    else setReview(undefined)
  }

  return <TrainingSaveRecoveryProvider recovery={recovery}>
    {!request.reviewId ? <TrainingDialog title="Practice history" onClose={onClose}>
      {error && !pendingSave ? <p role="alert">{error}</p> : null}
      <div className="training-actions">
        <label>Set <select value={set} onChange={event => { setSet(event.target.value as typeof set); setLimit(20) }}>
          <option value="all">All sets</option><option value="oll">OLL</option><option value="pll">PLL</option>
        </select></label>
        <label>Practice type <select value={mode} onChange={event => { setMode(event.target.value as typeof mode); setLimit(20) }}>
          <option value="all">All types</option><option value="execution">Execution</option><option value="recognition">Recognition (BETA)</option>
        </select></label>
        <label>Date range <select value={days} onChange={event => { setDays(Number(event.target.value)); setLimit(20) }}>
          <option value={0}>All dates</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option>
        </select></label>
      </div>
      {visits.length ? <TrainingArchiveRows data={data} visits={visits.slice(0, limit)}
        onReview={setReview} onDelete={canDelete && !pendingSave ? setDeleteTarget : undefined} />
        : <p>{trainingArchiveVisits(data).length ? 'No sessions match these filters.' : 'Completed practice sessions appear here.'}</p>}
      {visits.length > limit ? <button type="button" className="button button-secondary" onClick={() => setLimit(limit + 20)}>Show more</button> : null}
    </TrainingDialog> : null}
    {review ? <TrainingReportsDialog data={data} controller={controller} reviewId={review}
      onOpenAttempt={setAttemptId} onClose={closeReview} /> : null}
    {attempt ? <AttemptDetailsDialog controller={controller} attempt={attempt}
      locked onDelete={() => false} onClose={() => setAttemptId(null)} /> : null}
    {deleteTarget ? <ConfirmDialog open eyebrow="Practice history" title={`Delete ${deleteTarget.session?.name}?`}
      description={`This permanently deletes the session and its ${deleteTarget.attemptIds.length} saved ${deleteTarget.attemptIds.length === 1 ? 'attempt' : 'attempts'}.`}
      requireText="DELETE" cancelLabel="Cancel" confirmLabel="Delete session" onCancel={() => setDeleteTarget(null)}
      onConfirm={() => { controller.deleteArchivedSession(deleteTarget.id); setDeleteTarget(null) }} /> : null}
  </TrainingSaveRecoveryProvider>
}
