import { useLayoutEffect, useRef } from 'react'
import {
  DEFAULT_TRAINING_STATISTICS, TRAINING_STAT_BY_ID, type TrainingStatId, type TrainingStatisticsPreferences,
} from '../../lib/training/statisticsPreferences'
import { trainingCategoryLabel } from '../../lib/training/statisticsView'
import type { TrainingCategoryId } from '../../lib/training/types'
import { TrainingDialog } from './TrainingDialog'

interface Props {
  category: TrainingCategoryId
  preferences: TrainingStatisticsPreferences
  onChange: (preferences: TrainingStatisticsPreferences) => void
  onClose: () => void
}

export function TrainingStatisticsSettings({ category, preferences, onChange, onClose }: Props) {
  const { rows, visible, current, best } = preferences
  const available = rows.filter(id => id !== 'estimate' || category.endsWith(':recognition'))
  const movedControl = useRef<HTMLButtonElement>(null)
  useLayoutEffect(() => {
    const control = movedControl.current
    movedControl.current = null
    if (!control) return
    const target = control.disabled ? control.parentElement?.querySelector<HTMLButtonElement>('button:not([disabled])') : control
    target?.focus({ preventScroll: true })
  }, [rows])

  const move = (id: TrainingStatId, other: TrainingStatId | undefined, control: HTMLButtonElement) => {
    if (!other) return
    movedControl.current = control
    onChange({ ...preferences, rows: rows.map(row => row === id ? other : row === other ? id : row) })
  }

  return (
    <TrainingDialog title="Customize Training statistics" onClose={onClose}>
      <p className="settings-note">{trainingCategoryLabel(category)}</p>
      <fieldset className="settings-fieldset">
        <legend className="settings-field-label">Row metrics</legend>
        <div className="settings-checkbox-grid">
          <label className="settings-checkbox">
            <input type="checkbox" checked={current} disabled={current && !best}
              onChange={event => onChange({ ...preferences, current: event.target.checked })} />
            Current
          </label>
          <label className="settings-checkbox">
            <input type="checkbox" checked={best} disabled={best && !current}
              onChange={event => onChange({ ...preferences, best: event.target.checked })} />
            Best
          </label>
        </div>
      </fieldset>
      <fieldset className="settings-fieldset">
        <legend className="settings-field-label">Visible rows and order</legend>
        <ol className="training-stat-settings-list">
          {available.map((id, index) => {
            const label = TRAINING_STAT_BY_ID.get(id)!.label
            const isVisible = visible.includes(id)
            return (
              <li key={id}>
                <label className="settings-checkbox">
                  <input type="checkbox" checked={isVisible}
                    onChange={() => onChange({ ...preferences, visible: isVisible ? visible.filter(row => row !== id) : [...visible, id] })} />
                  {label}
                </label>
                <div className="training-stat-order">
                  <button type="button" className="icon-button" aria-label={`Move ${label} up`} disabled={index === 0}
                    onClick={event => move(id, available[index - 1], event.currentTarget)}>↑</button>
                  <button type="button" className="icon-button" aria-label={`Move ${label} down`} disabled={index === available.length - 1}
                    onClick={event => move(id, available[index + 1], event.currentTarget)}>↓</button>
                </div>
              </li>
            )
          })}
        </ol>
      </fieldset>
      <div><button type="button" className="button button-secondary"
        onClick={() => onChange(DEFAULT_TRAINING_STATISTICS)}>Restore defaults</button></div>
    </TrainingDialog>
  )
}
