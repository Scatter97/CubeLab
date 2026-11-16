import { useState } from 'react'
import type { TrainingController } from '../../lib/training/controller'
import type { TrainingData } from '../../lib/training/types'
import { AttemptDetailsDialog } from './AttemptDetailsDialog'
import { downloadTrainingRecovery } from './downloadTrainingRecovery'
import { TrainingDialog } from './TrainingDialog'
import { TrainingReportsDialog } from './TrainingReportsDialog'
import { TrainingSaveRecoveryProvider } from './TrainingSaveRecovery'

type Props = {
  controller: TrainingController
  data: TrainingData
  pendingSave: boolean
  error: string | null
} & (
  | { reportId: string; onDone: () => void }
  | { reportId?: never; onEnd: () => void }
)

export default function TrainingLifecycleDialog(props: Props) {
  const { controller, data, pendingSave, error, reportId } = props
  const [attemptId, setAttemptId] = useState<string | null>(null)
  const attempt = data.attempts.find(item => item.id === attemptId)
  const recovery = pendingSave ? { error, retry: controller.retrySave, download: () => downloadTrainingRecovery(controller) } : null
  return <TrainingSaveRecoveryProvider recovery={recovery}>
    {props.reportId !== undefined ? <>
      <TrainingReportsDialog data={data} controller={controller} requiredId={reportId} closeDisabled={pendingSave}
        onOpenAttempt={setAttemptId} onClose={props.onDone} />
      {attempt ? <AttemptDetailsDialog data={data} controller={controller} attempt={attempt}
        locked onDelete={() => false} onClose={() => setAttemptId(null)} /> : null}
    </> : <TrainingDialog title="Are you still there?" onClose={() => {}} dismissible={false} className="training-idle-dialog">
      <p>Your Training session is paused. End it when you’re done, or keep practicing.</p>
      <div className="training-actions">
        <button type="button" className="button button-primary" disabled={pendingSave} onClick={props.onEnd}>End session</button>
        <button type="button" className="button button-secondary" disabled={pendingSave} onClick={controller.keepPracticing} autoFocus>Keep practicing</button>
      </div>
    </TrainingDialog>}
  </TrainingSaveRecoveryProvider>
}
