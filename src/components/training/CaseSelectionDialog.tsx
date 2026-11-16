import { useLayoutEffect, useRef, useState } from 'react'
import { STANDARD_CASES } from '../../lib/training/catalog/standardCases'
import type { TrainingAlgorithmOverrides, TrainingCaseId, TrainingData, TrainingSetId } from '../../lib/training/types'
import type { TrainingController } from '../../lib/training/controller'
import { availableAlgorithm, availableAlgorithms, resolvePreferredAlgorithm, trainingAlgorithmKey } from '../../lib/training/algorithmSelection'
import { verifyCustomAlgorithm } from '../../lib/training/runtime'
import { TrainingDialog } from './TrainingDialog'
import { CaseDiagram } from './CaseDiagram'

interface CaseSelectionProps {
  data: TrainingData
  setId: TrainingSetId
  onClose: () => void
  controller: TrainingController
  draft?: {
    caseIds: readonly TrainingCaseId[]
    includeSetupMoves: boolean
    algorithmOverrides: TrainingAlgorithmOverrides
    onApply: (ids: readonly TrainingCaseId[], includeSetupMoves: boolean, algorithmOverrides: TrainingAlgorithmOverrides) => void
  }
}

export function CaseSelectionDialog({ data, controller, setId, onClose, draft }: CaseSelectionProps) {
  const [search, setSearch] = useState(''), [family, setFamily] = useState(''), [difficultOnly, setDifficultOnly] = useState(false)
  const [detail, setDetail] = useState<TrainingCaseId | null>(null), [notation, setNotation] = useState(''), [error, setError] = useState(''), [verifying, setVerifying] = useState(false)
  const editorTrigger = useRef<HTMLButtonElement>(null)
  const editorHeading = useRef<HTMLHeadingElement>(null)
  useLayoutEffect(() => {
    if (detail) editorHeading.current?.focus()
    else editorTrigger.current?.focus()
  }, [detail])
  const [presetName, setPresetName] = useState(''), [editingPreset, setEditingPreset] = useState('')
  const prefs = data.preferences.sets[setId]
  const [draftIds, setDraftIds] = useState(() => draft?.caseIds ?? [])
  const [draftRecognition, setDraftRecognition] = useState(() => draft?.includeSetupMoves ?? false)
  const [overrides, setOverrides] = useState<TrainingAlgorithmOverrides>(() => draft?.algorithmOverrides ?? {})
  const tracking = data.preferences.algorithmTracking === true
  const selected = draft ? draftIds : prefs.enabledCaseIds
  const all = STANDARD_CASES.filter(c => c.setId === setId)
  const visible = all.filter(c => (!family || c.groupId === family) && (!difficultOnly || prefs.difficultCaseIds.includes(c.id as TrainingCaseId)) && c.name.toLowerCase().includes(search.toLowerCase()))
  const preferred = detail ? resolvePreferredAlgorithm(data, detail) : null
  const alternatives = detail ? availableAlgorithms(data, detail) : []
  const builtIn = alternatives.find(a => a.source === 'built-in')?.record
  const customAlgorithms = detail ? data.customAlgorithms.filter(a => a.caseId === detail) : []
  const selectedAlgorithm = preferred?.record
  const choose = (ids: readonly TrainingCaseId[]) => {
    if (draft) setDraftIds(ids)
    else void controller?.setEnabledCases(setId, ids)
  }
  const save = async () => {
    if (!detail || !controller) return
    setVerifying(true); setError('')
    try { await controller.saveAlgorithm(await verifyCustomAlgorithm(detail, notation, selectedAlgorithm)); setNotation('') }
    catch (e) { setError(e instanceof Error ? e.message : 'Algorithm verification failed.') }
    finally { setVerifying(false) }
  }
  return <TrainingDialog title={`Edit ${setId.toUpperCase()} cases`} onClose={onClose}>
    <p>Select one case for execution or two for recognition. Each needs a usable algorithm.</p>
    <div className="training-actions">
      <label>Search cases<input value={search} onChange={e => setSearch(e.target.value)} type="search" /></label>
      <label>Case family<select value={family} onChange={e => setFamily(e.target.value)}><option value="">All families</option>{[...new Set(all.map(c => c.groupId))].map(id => <option key={id} value={id}>{id.replaceAll('-', ' ')}</option>)}</select></label>
      <label><input type="checkbox" checked={difficultOnly} onChange={e => setDifficultOnly(e.target.checked)} /> Difficult only</label>
    </div>
    <div className="training-actions">
      <button type="button" className="button button-secondary" onClick={() => choose(all.map(c => c.id as TrainingCaseId))}>Select all</button>
      <button type="button" className="button button-secondary" onClick={() => choose([])}>Clear selection</button>
      <button type="button" className="button button-secondary" onClick={() => choose(visible.map(c => c.id as TrainingCaseId))}>Use filtered cases</button>
      <button type="button" className="button button-secondary" onClick={() => choose(prefs.difficultCaseIds)}>Practice difficult cases</button>
      <span>{selected.length} selected</span>
    </div>
    {draft ? <div className="training-actions">
      <button type="button" className="button button-primary" onClick={() => draft.onApply(draftIds, draftRecognition,
        Object.fromEntries(draftIds.flatMap(id => overrides[id] ? [[id, overrides[id]]] : [])))}>Apply selection</button>
      <button type="button" className="button button-secondary" onClick={onClose}>Cancel</button>
    </div> : null}
    {tracking && detail ? <section className="training-algorithm-editor" aria-label="Case algorithms">
      <div className="training-actions"><h3 ref={editorHeading} tabIndex={-1}>{all.find(c => c.id === detail)?.name} algorithms</h3>
        <button type="button" className="button button-secondary button-small" onClick={() => setDetail(null)}>Back to cases</button>
      </div><CaseDiagram caseId={detail} size={96} />
      <div className="training-algorithm-summary">
        <p><strong>Built-in default</strong> {builtIn ? '· Verified' : '· Unavailable'}</p>
        {builtIn ? <p className="training-notation">{builtIn.notation}</p> : null}
        <p><strong>Preferred</strong> · {preferred?.source === 'built-in' ? 'Built-in default' : preferred ? 'Your algorithm' : 'None'} {preferred ? '· Verified' : '· No verified algorithm'}</p>
        {customAlgorithms.length ? <div><h4>Your algorithms</h4><ul className="training-algorithm-list">{customAlgorithms.map(a => <li key={a.id}><span>{a.label} · revision {a.version}</span><code>{a.notation}</code><span>{a.verification?.status === 'verified' ? 'Verified' : 'Not verified'}</span></li>)}</ul></div> : <p className="training-muted">No custom algorithms yet.</p>}
      </div>
      <label>Preferred algorithm<select value={preferred ? trainingAlgorithmKey(preferred.snapshot) : ''}
        onChange={e => { const next = alternatives.find(a => trainingAlgorithmKey(a.snapshot) === e.target.value); void controller.setPreferredAlgorithm(detail, next?.snapshot ?? null) }}>
        {!alternatives.length ? <option value="">No verified algorithm</option> : null}
        {alternatives.map(a => <option key={trainingAlgorithmKey(a.snapshot)} value={trainingAlgorithmKey(a.snapshot)}>{a.source === 'built-in' ? 'Built-in default' : `${a.record.label ?? 'My algorithm'} · revision ${a.record.version}`} · {a.record.notation}</option>)}
      </select></label>
      {draft && selected.includes(detail) ? <label>Algorithm for this session<select
        value={overrides[detail] ? trainingAlgorithmKey(overrides[detail]!) : ''}
        onChange={event => {
          const choice = alternatives.find(option => trainingAlgorithmKey(option.snapshot) === event.target.value)
          setOverrides(previous => ({ ...previous, [detail]: choice?.snapshot }))
        }}>
        <option value="">Use preferred algorithm</option>
        {alternatives.map(option => <option key={trainingAlgorithmKey(option.snapshot)} value={trainingAlgorithmKey(option.snapshot)}>
          {option.source === 'built-in' ? 'Built-in default' : option.record.label ?? 'My algorithm'} · revision {option.snapshot.revision} · {option.snapshot.notation}
        </option>)}
      </select></label> : null}
      <label>Your solving algorithm<input aria-label="Your solving algorithm" value={notation} onChange={e => setNotation(e.target.value)} placeholder="Enter your algorithm" spellCheck={false} /></label>
      <p>Saving a change creates a new revision and preserves the previous attribution.</p>
      <button type="button" className="button button-primary" disabled={verifying || !notation.trim()} onClick={() => { void save() }}>{verifying ? 'Verifying…' : preferred?.source === 'custom' ? 'Verify and save revision' : 'Verify and save algorithm'}</button>
      {error ? <p role="alert">{error}</p> : null}
    </section> : null}
    <div className="training-case-grid">{visible.map(c => {
      const id = c.id as TrainingCaseId
      return <article key={id} className="training-case">
        <CaseDiagram caseId={id} />
        <label><input type="checkbox" checked={selected.includes(id)} onChange={e => choose(e.target.checked ? [...selected, id] : selected.filter(x => x !== id))} />{c.name}</label>
        {controller ? <>
        <button type="button" aria-pressed={prefs.difficultCaseIds.includes(id)} aria-label={`Mark ${c.name} difficult`} onClick={() => controller.toggleDifficult(id)}>{prefs.difficultCaseIds.includes(id) ? '★ Difficult' : '☆ Difficult'}</button>
        {tracking ? <button type="button" onClick={event => { editorTrigger.current = event.currentTarget; setDetail(id); setNotation(''); setError('') }}>{availableAlgorithm(data, id) ? 'Algorithms' : 'Add algorithm'}</button> : null}
        </> : null}
      </article>
    })}</div>
    {controller ? <section className="training-preset-editor"><h3>My presets</h3>
      <label>Saved preset<select value={editingPreset} onChange={e => { setEditingPreset(e.target.value); setPresetName(data.presets.find(p => p.id === e.target.value)?.name ?? '') }}><option value="">New preset</option>{data.presets.filter(p => p.setId === setId).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label>Preset name<input value={presetName} onChange={e => setPresetName(e.target.value)} maxLength={100} /></label>
      <div className="training-actions"><button type="button" className="button button-secondary" disabled={!presetName.trim() || !selected.length} onClick={() => {
        controller.savePreset(presetName, editingPreset || undefined, draft ? { setId, caseIds: draftIds, includeSetupMoves: draftRecognition } : undefined)
      }}>{editingPreset ? 'Save name and current selection' : 'Save current selection'}</button>
      {editingPreset ? <><button type="button" className="button button-secondary" onClick={() => {
        if (draft) {
          const preset = data.presets.find(item => item.id === editingPreset)
          if (preset) { setDraftIds(preset.caseIds); setDraftRecognition(preset.includeSetupMoves) }
        } else { void controller.applyPreset(editingPreset); onClose() }
      }}>Use preset</button><button type="button" className="button button-secondary" onClick={() => { controller.deletePreset(editingPreset); setEditingPreset(''); setPresetName('') }}>Delete preset</button></> : null}</div>
    </section> : null}
  </TrainingDialog>
}
