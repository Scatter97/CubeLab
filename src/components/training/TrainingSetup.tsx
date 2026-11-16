import { pendingTrainingReports } from '../../lib/training/visits'
import type { TrainingController, TrainingControllerState } from '../../lib/training/controller'
import type { TrainingData, TrainingSetId } from '../../lib/training/types'
import { TrainingActions } from './TrainingActions'
import { selectedTrainingCasesLabel, trainingSelectionMessage } from './trainingSelectionPresentation'

interface Props {
  data: TrainingData
  state: TrainingControllerState
  controller: TrainingController
  eligible: number
  locked: boolean
  openCases: () => void
  openSettings: () => void
  openReports: () => void
}

export function TrainingSetSelect({ setId, onChange }: { setId: TrainingSetId; onChange: (setId: TrainingSetId) => void }) {
  return <select className="training-select" value={setId} data-timer-space-ignore
    onChange={event => onChange(event.target.value as TrainingSetId)}>
    <option value="oll">OLL</option><option value="pll">PLL</option>
  </select>
}

export function TrainingSetup({ data, state, controller, eligible, locked, openCases, openSettings, openReports }: Props) {
  const setId = data.preferences.selectedSetId
  const prefs = data.preferences.sets[setId]
  const count = prefs.enabledCaseIds.length
  const selectedCases = selectedTrainingCasesLabel(count)
  const reports = pendingTrainingReports(data).length
  const presets = data.presets.filter(preset => preset.setId === setId)
  const eligibility = trainingSelectionMessage(count, eligible, prefs.includeSetupMoves)

  return (
    <section className="panel session-panel training-controls" aria-label="Training Setup">
      <div className="panel-heading">
        <h2>Training Setup</h2>
        <TrainingActions label={reports ? `Training options, ${reports} new reports` : 'Training options'}
          disabled={locked} indicator={reports} focusFallback>{close => <>
          <button type="button" className="text-button" onClick={() => { close(); openSettings() }}>Training settings</button>
          <button type="button" className="text-button" onClick={() => { close(); openReports() }}>
            Practice history{reports ? ` (${reports} new)` : ''}
          </button>
          {presets.length ? (
            <label className="training-preset-field">Preset
              <select className="training-select" value={prefs.selectedPresetId ?? ''} onChange={event => {
                const id = event.target.value
                if (id) { close(); void controller.applyPreset(id) }
              }}>
                <option value="">Choose preset</option>{presets.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
              </select>
            </label>
          ) : null}
        </>}</TrainingActions>
      </div>
      <fieldset disabled={locked}>
        <legend className="sr-only">Training mode</legend>
        <div className="training-mode">
          <label>
            <span className="sr-only">Algorithm set</span>
            <TrainingSetSelect setId={setId} onChange={next => {
              void controller.selectCategory(`${next}:${data.preferences.sets[next].includeSetupMoves ? 'recognition' : 'execution'}`)
            }} />
          </label>
          <label className="settings-checkbox">
            <input type="checkbox" checked={prefs.includeSetupMoves} onChange={event => {
              void controller.selectCategory(`${setId}:${event.target.checked ? 'recognition' : 'execution'}`)
            }} /> Include setup moves
          </label>
        </div>
        <button type="button" className="text-button training-selected-cases" aria-label={`${selectedCases}, edit cases`} onClick={openCases}>
          {selectedCases}
        </button>
      </fieldset>
      {eligibility ? <p className="training-muted" role="status">{eligibility}</p> : null}
      {state.renewalRecommended && !state.calibration ? <p className="training-muted" role="status">Recalibration recommended.</p> : null}
    </section>
  )
}
