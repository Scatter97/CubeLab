import { useState } from 'react'
import { STANDARD_CASES } from '../../lib/training/catalog/standardCases'
import type {
  TrainingCaseId,
  TrainingData,
  TrainingPreset,
  TrainingSetId,
} from '../../lib/training/types'
import type { TrainingController } from '../../lib/training/controller'
import { TrainingDialog } from './TrainingDialog'
import { CaseDiagram } from './CaseDiagram'

interface CaseSelectionProps {
  data: TrainingData
  setId: TrainingSetId
  onClose: () => void
  controller: TrainingController
  locked?: boolean
  draft?: {
    caseIds: readonly TrainingCaseId[]
    includeSetupMoves: boolean
    onApply: (ids: readonly TrainingCaseId[], includeSetupMoves: boolean) => void
  }
}

/**
 * Case-only case selection and presets. Algorithm revision editing is
 * temporarily retired; built-in verified setups still drive generation.
 */
export function CaseSelectionDialog({
  data,
  controller,
  setId,
  onClose,
  locked = false,
  draft,
}: CaseSelectionProps) {
  const [search, setSearch] = useState('')
  const [family, setFamily] = useState('')
  const [difficultOnly, setDifficultOnly] = useState(false)
  const [presetName, setPresetName] = useState('')
  const [editingPreset, setEditingPreset] = useState('')
  const [deletedPreset, setDeletedPreset] = useState<TrainingPreset | null>(null)
  const prefs = data.preferences.sets[setId]
  const [draftIds, setDraftIds] = useState(() => draft?.caseIds ?? [])
  const [draftRecognition, setDraftRecognition] = useState(
    () => draft?.includeSetupMoves ?? false,
  )
  const selected = draft ? draftIds : prefs.enabledCaseIds
  const all = STANDARD_CASES.filter((c) => c.setId === setId)
  const visible = all.filter(
    (c) =>
      (!family || c.groupId === family) &&
      (!difficultOnly || prefs.difficultCaseIds.includes(c.id as TrainingCaseId)) &&
      c.name.toLowerCase().includes(search.toLowerCase()),
  )

  const choose = (ids: readonly TrainingCaseId[]) => {
    if (draft) setDraftIds(ids)
    else void controller.setEnabledCases(setId, ids)
  }

  return (
    <TrainingDialog title={`Edit ${setId.toUpperCase()} cases`} onClose={onClose}>
      <div className="training-actions">
        <label>
          Search cases
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            type="search"
          />
        </label>
        <label>
          Case family
          <select value={family} onChange={(e) => setFamily(e.target.value)}>
            <option value="">All families</option>
            {[...new Set(all.map((c) => c.groupId))].map((id) => (
              <option key={id} value={id}>
                {id.replaceAll('-', ' ')}
              </option>
            ))}
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={difficultOnly}
            onChange={(e) => setDifficultOnly(e.target.checked)}
          />{' '}
          Difficult only
        </label>
      </div>
      <div className="training-actions">
        <button
          type="button"
          className="button button-secondary"
          disabled={locked}
          onClick={() => choose(all.map((c) => c.id as TrainingCaseId))}
        >
          Select all
        </button>
        <button
          type="button"
          className="button button-secondary"
          disabled={locked}
          onClick={() => choose([])}
        >
          Clear selection
        </button>
        <button
          type="button"
          className="button button-secondary"
          disabled={locked}
          onClick={() => choose(visible.map((c) => c.id as TrainingCaseId))}
        >
          Use filtered cases
        </button>
        <button
          type="button"
          className="button button-secondary"
          disabled={locked}
          onClick={() => choose(prefs.difficultCaseIds)}
        >
          Practice difficult cases
        </button>
        <span>{selected.length} selected</span>
      </div>
      {draft ? (
        <div className="training-actions">
          <button
            type="button"
            className="button button-primary"
            disabled={locked}
            onClick={() => draft.onApply(draftIds, draftRecognition)}
          >
            Apply selection
          </button>
          <button type="button" className="button button-secondary" onClick={onClose}>
            Cancel
          </button>
          <label>
            <input
              type="checkbox"
              checked={draftRecognition}
              onChange={(event) => setDraftRecognition(event.target.checked)}
            />{' '}
            Recognition session (BETA)
          </label>
        </div>
      ) : null}
      <div className="training-case-grid">
        {visible.map((c) => {
          const id = c.id as TrainingCaseId
          return (
            <article key={id} className="training-case">
              <CaseDiagram caseId={id} />
              <label>
                <input
                  type="checkbox"
                  disabled={locked}
                  checked={selected.includes(id)}
                  onChange={(e) =>
                    choose(
                      e.target.checked
                        ? [...selected, id]
                        : selected.filter((x) => x !== id),
                    )
                  }
                />
                {c.name}
              </label>
              {controller ? (
                <button
                  type="button"
                  disabled={locked}
                  aria-pressed={prefs.difficultCaseIds.includes(id)}
                  aria-label={`Mark ${c.name} difficult`}
                  onClick={() => controller.toggleDifficult(id)}
                >
                  {prefs.difficultCaseIds.includes(id) ? '★ Difficult' : '☆ Difficult'}
                </button>
              ) : null}
            </article>
          )
        })}
      </div>
      {controller ? (
        <section className="training-preset-editor">
          <h3>My presets</h3>
          <label>
            Saved preset
            <select
              disabled={locked}
              value={editingPreset}
              onChange={(e) => {
                setEditingPreset(e.target.value)
                setPresetName(
                  data.presets.find((p) => p.id === e.target.value)?.name ?? '',
                )
              }}
            >
              <option value="">New preset</option>
              {data.presets
                .filter((p) => p.setId === setId)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Preset name
            <input
              disabled={locked}
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              maxLength={100}
            />
          </label>
          <div className="training-actions">
            <button
              type="button"
              className="button button-secondary"
              disabled={locked || !presetName.trim() || !selected.length}
              onClick={() => {
                controller.savePreset(
                  presetName,
                  editingPreset || undefined,
                  draft
                    ? {
                        setId,
                        caseIds: draftIds,
                        includeSetupMoves: draftRecognition,
                      }
                    : undefined,
                )
              }}
            >
              {editingPreset ? 'Save name and current selection' : 'Save current selection'}
            </button>
            {editingPreset ? (
              <>
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={locked}
                  onClick={() => {
                    if (draft) {
                      const preset = data.presets.find(
                        (item) => item.id === editingPreset,
                      )
                      if (preset) {
                        setDraftIds(preset.caseIds)
                        setDraftRecognition(preset.includeSetupMoves)
                      }
                    } else {
                      void controller.applyPreset(editingPreset)
                      onClose()
                    }
                  }}
                >
                  Use preset
                </button>
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={locked}
                  onClick={() => {
                    const deleted = controller.deletePreset(editingPreset)
                    if (deleted) setDeletedPreset(deleted)
                    setEditingPreset('')
                    setPresetName('')
                  }}
                >
                  Delete preset
                </button>
              </>
            ) : null}
          </div>
          {deletedPreset ? (
            <div className="training-actions" role="status">
              <span>Preset deleted.</span>
              <button
                type="button"
                className="button button-secondary button-small"
                onClick={() => {
                  if (controller.restorePreset(deletedPreset)) setDeletedPreset(null)
                }}
              >
                Undo
              </button>
            </div>
          ) : null}
        </section>
      ) : null}
    </TrainingDialog>
  )
}
