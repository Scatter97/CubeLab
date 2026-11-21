import type { TrainingController, TrainingControllerState } from '../../lib/training/controller'
import { CALIBRATION_PROTOCOLS } from '../../lib/training/calibration'
import { STANDARD_CASE_BY_ID } from '../../lib/training/catalog/standardCases'
import type { TrainingCategoryId, TrainingSetId } from '../../lib/training/types'
import { CaseDiagram } from './CaseDiagram'
import { TrainingActions } from './TrainingActions'

interface Props {
  state: TrainingControllerState
  controller: TrainingController
  selectedCategory: TrainingCategoryId
  setId: TrainingSetId
  locked: boolean
  eligible: boolean
  showUpcomingCase: boolean
}

export function TrainingPreparation({ state, controller, selectedCategory, setId, locked, eligible, showUpcomingCase }: Props) {
  const { category, setup, calibration, preparing, pendingSave, error } = state
  const generated = setup?.generated
  const matchesCategory = generated && category === `${generated.setId}:${generated.mode}`
  const target = showUpcomingCase && matchesCategory && !preparing && !pendingSave
    && generated.mode === 'execution' && generated.targetHidden === false
    ? STANDARD_CASE_BY_ID.get(generated.caseId) : null
  const protocol = calibration ? CALIBRATION_PROTOCOLS[calibration.setId] : null
  const visitActive = Boolean(state.data?.activeVisitId)
  const activated = Boolean(category && visitActive)
  const action = preparing ? 'Preparing…' : !activated ? (category ? 'Resume practice' : 'Begin training')
    : error ? 'Retry setup' : 'Next setup'
  const setupError = eligible && !pendingSave ? error : null

  return (
    <section className="panel scramble-panel training-scramble" aria-label={calibration ? 'Calibration setup' : 'Practice setup'}>
      <div className="scramble-header">
        <div className="section-heading">
          <h2>{calibration ? `${calibration.setId.toUpperCase()} calibration` : 'Setup'}</h2>
        </div>
        <div className="training-setup-toolbar">
          <TrainingActions label="Practice help" symbol="?">{() => <div className="training-practice-help">
            {calibration ? <p>Repeat from solved each time. Keep seven valid samples.</p> : <>
              <p>{setId === 'oll' ? 'Stop after OLL orientation. PLL can remain unsolved.' : 'Stop after PLL, including AUF if needed.'}</p>
              {selectedCategory.endsWith(':recognition') ? <p>Start before doing the fixed precursor. The target is revealed after the attempt.</p> : null}
              <p>Training has no inspection or +2. Mark a DNF in Attempt details.</p>
            </>}
          </div>}</TrainingActions>
          {!calibration ? (
            <button type="button" className={`button ${activated && !error ? 'button-secondary' : 'button-primary'} button-small`}
              disabled={locked || !eligible || preparing}
              onClick={() => { void (activated ? controller.prepare() : controller.selectCategory(selectedCategory)) }}>
              {action}
            </button>
          ) : <span className="training-muted" role="status">{calibration.samplesMs.length} of 7 samples</span>}
        </div>
      </div>
      <div className="scramble-body training-setup-body" role="region" aria-label="Setup moves"
        aria-busy={preparing} tabIndex={protocol || matchesCategory ? 0 : undefined} data-timer-space-ignore>
        {protocol ? (
          <div className="training-calibration">
            <div>
              <p>From solved, apply setup</p>
              <p className="scramble-text" data-testid="training-scramble">{protocol.scramble}</p>
            </div>
            <div>
              <p>Start, perform precursor, stop at solved</p>
              <p className="training-notation">{protocol.precursor}</p>
            </div>
          </div>
        ) : matchesCategory ? (
          <div className={`training-preparation${generated.mode === 'recognition' ? ' is-recognition' : ''}`}>
            <p className="scramble-text" data-testid="training-scramble">{generated.scramble}</p>
            {generated.mode === 'recognition' ? (
              <div className="training-precursor">
                <span>Precursor after start</span>
                <strong className="training-notation">{generated.precursor}</strong>
              </div>
            ) : target ? (
              <div className="training-current-case">
                <CaseDiagram caseId={target.id} size={48} decorative /><strong>{target.name}</strong>
              </div>
            ) : null}
          </div>
        ) : preparing ? <p className="training-muted" role="status">Preparing setup…</p>
          : setupError ? <p className="training-muted training-setup-error" role="alert">{setupError}</p>
          : pendingSave || state.needsContinuity || !eligible ? <p className="training-muted">{pendingSave ? 'Save Training changes to continue.'
            : state.needsContinuity ? 'Choose whether to continue your previous visit.'
            : 'Edit cases to prepare a setup.'}</p> : null}
      </div>
    </section>
  )
}
