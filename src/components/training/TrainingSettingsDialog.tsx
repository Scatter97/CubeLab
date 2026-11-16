import { useState } from 'react'
import type { TrainingData, TrainingSetId } from '../../lib/training/types'
import type { TrainingController } from '../../lib/training/controller'
import { assertTrainingDomainSettings, getTrainingDomainSettings } from '../../lib/training/settings'
import { latestTrainingCalibration } from '../../lib/training/calibration'
import { trainingTime } from '../../lib/training/format'
import { TrainingDialog } from './TrainingDialog'

export function TrainingSettingsDialog({ data, setId, controller, showUpcomingCase, onShowUpcomingCaseChange, canRecalibrate, onClose, sessionFlow }: {
  data: TrainingData
  setId: TrainingSetId
  controller: TrainingController
  showUpcomingCase: boolean
  onShowUpcomingCaseChange: (value: boolean) => boolean
  canRecalibrate: boolean
  sessionFlow?: boolean
  onClose: () => void
}) {
  const [displayError, setDisplayError] = useState(false)
  const [algorithmTracking, setAlgorithmTracking] = useState(data.preferences.algorithmTracking === true)
  const calibration = latestTrainingCalibration(data, setId)
  const [domain, setDomain] = useState(() => getTrainingDomainSettings(data.preferences))
  const [renewal, setRenewal] = useState(data.preferences.sets[setId].recognition), [error, setError] = useState('')
  const save = () => {
    try {
      assertTrainingDomainSettings(domain)
      if (!Number.isSafeInteger(renewal.renewalDays) || renewal.renewalDays < 1 || !Number.isSafeInteger(renewal.renewalAttempts) || renewal.renewalAttempts < 1) throw Error('Renewal thresholds must be positive whole numbers.')
      if (controller.updateSettings(domain, renewal, setId, algorithmTracking)) onClose()
    } catch (e) { setError(e instanceof Error ? e.message : 'Invalid settings.') }
  }
  return <TrainingDialog title="Training settings" onClose={onClose}><div className="training-settings-fields">
    <fieldset className="training-display-settings">
      <legend>Display</legend>
      <label><input type="checkbox" checked={showUpcomingCase} aria-describedby="training-preview-scope"
        onChange={event => setDisplayError(!onShowUpcomingCaseChange(event.target.checked))} /> Show upcoming case</label>
      <p className="training-muted" id="training-preview-scope">Execution only</p>
      {displayError ? <p role="alert">Couldn’t save the display preference. Try again.</p> : null}
    </fieldset>
    <label><input type="checkbox" checked={algorithmTracking} onChange={event => setAlgorithmTracking(event.target.checked)} /> Track algorithm revisions</label>
    <p className="training-muted">New attempts count toward their case either way. Tracking adds revision statistics and unlocks algorithm choices. Existing revision history stays visible.</p>
    <label>Rolling average trim per side (%)<input type="number" min="0" max="49.99" step="0.1" value={domain.trimPercent} onChange={e => setDomain({ ...domain, trimPercent: Number(e.target.value) })} /></label>
    <label>Inactivity timeout (minutes)<input type="number" min="1" value={domain.inactivityMinutes} onChange={e => setDomain({ ...domain, inactivityMinutes: Number(e.target.value) })} /></label>
    <label>Historical baseline<select value={domain.baseline.kind} onChange={e => setDomain({ ...domain, baseline: { ...domain.baseline, kind: e.target.value as 'days' | 'attempts' } })}><option value="days">Previous days</option><option value="attempts">Previous attempts per case</option></select></label>
    <label>Baseline count<input type="number" min="1" value={domain.baseline.count} onChange={e => setDomain({ ...domain, baseline: { ...domain.baseline, count: Number(e.target.value) } })} /></label>
    <label>{setId.toUpperCase()} recalibration after days<input type="number" min="1" value={renewal.renewalDays} onChange={e => setRenewal({ ...renewal, renewalDays: Number(e.target.value) })} /></label>
    <label>{setId.toUpperCase()} recalibration after recognition attempts<input type="number" min="1" value={renewal.renewalAttempts} onChange={e => setRenewal({ ...renewal, renewalAttempts: Number(e.target.value) })} /></label>
    {!sessionFlow ? <label><input type="checkbox" checked={domain.requireRecalibrationWhenDue} onChange={e => setDomain({ ...domain, requireRecalibrationWhenDue: e.target.checked })} /> Require recalibration when due</label> : null}
    <details><summary>How renewal works</summary>
      <p>{sessionFlow ? 'When calibration is due, collect seven samples before starting a new Recognition session. Threshold changes apply to the next calibration you save.'
        : 'When required, collect seven new samples before the next recognition attempt. Otherwise you can keep using the previous median.'}</p>
    </details>
    {calibration ? <p>{setId.toUpperCase()} calibration median: {trainingTime(calibration.medianMs)}</p> : null}
    {canRecalibrate ? <button type="button" className="button button-secondary" onClick={() => {
      controller.startCalibration()
      onClose()
    }}>{calibration ? 'Recalibrate' : 'Calibrate'} {setId.toUpperCase()}</button> : null}
    <p>Training data stays in this browser.</p>
    {error ? <p role="alert">{error}</p> : null}<button type="button" className="button button-primary" onClick={save}>Save Training settings</button>
  </div></TrainingDialog>
}
