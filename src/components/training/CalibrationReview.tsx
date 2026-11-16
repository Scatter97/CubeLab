import { useLayoutEffect, useRef } from 'react'
import type { TrainingController, TrainingControllerState } from '../../lib/training/controller'
import { trainingTime } from '../../lib/training/format'

export function CalibrationReview({ state, controller, active, locked }: {
  state: TrainingControllerState
  controller: TrainingController
  active: boolean
  locked: boolean
}) {
  const { calibration, sample } = state
  const keep = useRef<HTMLButtonElement>(null)
  useLayoutEffect(() => {
    if (sample !== null) keep.current?.focus()
  }, [sample])
  if (!calibration) return null

  return (
    <section className="panel training-calibration-review" aria-label="Calibration controls" data-timer-space-ignore>
      <div className="training-actions">
        {sample !== null ? <>
          <strong>Sample {trainingTime(sample)}</strong>
          <button ref={keep} type="button" className="button button-primary button-small"
            disabled={locked} onClick={() => controller.acceptSample()}>Keep sample</button>
          <button type="button" className="button button-secondary button-small"
            disabled={locked} onClick={() => controller.acceptSample(false)}>Retry sample</button>
        </> : null}
        <button type="button" className="button button-secondary button-small"
          disabled={active || state.pendingSave} onClick={controller.cancelCalibration}>Cancel calibration</button>
      </div>
      {calibration.invalidSampleCount ? <p className="training-muted" role="status">Invalid samples: {calibration.invalidSampleCount}</p> : null}
      {calibration.samplesMs.length ? (
        <details><summary>Sample times</summary>
          <ol className="training-samples">{calibration.samplesMs.map((ms, index) => <li key={index}>{trainingTime(ms)}</li>)}</ol>
        </details>
      ) : null}
    </section>
  )
}
