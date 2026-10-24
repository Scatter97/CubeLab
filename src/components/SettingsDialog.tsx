import { useState } from 'react'
import { useModalDialog } from '../hooks/useModalDialog'
import { formatSolveCount } from '../lib/format'
import { createId } from '../lib/id'
import {
  BUILT_IN_STAT_DEFINITIONS,
  MAX_CUSTOM_AVERAGES,
  MAX_CUSTOM_AVERAGE_SIZE,
  MIN_CUSTOM_AVERAGE_SIZE,
  isBuiltInAverageSize,
  nextCustomAverageSize,
} from '../lib/statDefinitions'
import { ChevronRightIcon, CloseIcon } from './Icons'
import type { CustomAverageSetting, Settings } from '../types'

interface SettingsDialogProps {
  open: boolean
  settings: Settings
  storageOk: boolean
  sessionCount: number
  solveCount: number
  onChange: (next: Partial<Settings>) => void
  onOpenBackup: () => void
  onClose: () => void
}

export function SettingsDialog({
  open,
  settings,
  storageOk,
  sessionCount,
  solveCount,
  onChange,
  onOpenBackup,
  onClose,
}: SettingsDialogProps) {
  const { dialogRef, handleKeyDown } = useModalDialog(open)
  const [customAverageError, setCustomAverageError] = useState<string | null>(
    null,
  )

  const updateCustomAverages = (next: CustomAverageSetting[]) => {
    const sizes = next.map((average) => average.size)
    if (new Set(sizes).size !== sizes.length) {
      setCustomAverageError('Custom averages must use different sizes.')
      return
    }
    setCustomAverageError(null)
    onChange({ customAverages: next })
  }

  const addCustomAverage = () => {
    if (settings.customAverages.length >= MAX_CUSTOM_AVERAGES) return
    const size = nextCustomAverageSize(
      settings.customAverages.map((average) => average.size),
    )
    updateCustomAverages([
      ...settings.customAverages,
      { id: createId(), size, visible: true },
    ])
  }

  const changeCustomAverageSize = (id: string, value: number) => {
    const size = Math.max(
      MIN_CUSTOM_AVERAGE_SIZE,
      Math.min(MAX_CUSTOM_AVERAGE_SIZE, Math.round(value)),
    )
    if (isBuiltInAverageSize(size)) {
      setCustomAverageError(`ao${size} is already available above.`)
      return
    }
    updateCustomAverages(
      settings.customAverages.map((average) =>
        average.id === id ? { ...average, size } : average,
      ),
    )
  }

  return (
    <dialog
      ref={dialogRef}
      className="confirm-dialog settings-dialog"
      aria-labelledby="settings-title"
      aria-describedby="settings-description"
      onKeyDown={handleKeyDown}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose()
      }}
    >
      <div className="dialog-content settings-content">
        <header className="settings-header">
          <div>
            <span className="eyebrow">Preferences</span>
            <h2 id="settings-title">Settings</h2>
          </div>
          <button
            type="button"
            className="icon-button settings-close"
            aria-label="Close settings"
            title="Close settings"
            onClick={onClose}
          >
            <CloseIcon size={16} />
          </button>
        </header>

        <p id="settings-description" className="settings-intro">
          Timer, alerts, appearance, statistics, scramble, and local-data
          preferences. Changes save automatically in this browser.
        </p>

        <div className="settings-body">
          <section className="settings-section" aria-labelledby="settings-timer-title">
            <div className="settings-section-heading">
              <h3 id="settings-timer-title">Timer</h3>
              <span className="settings-badge">WCA</span>
            </div>

            <div className="settings-row">
              <div className="settings-row-copy">
                <label className="settings-row-label" htmlFor="inspection-setting">
                  Inspection
                </label>
                <span className="settings-row-description">
                  15-second WCA inspection before each solve. This is the default
                  for sessions without an override. Started late: over 15 seconds
                  is +2; over 17 seconds is DNF.
                </span>
              </div>
              <button
                type="button"
                role="switch"
                id="inspection-setting"
                aria-checked={settings.inspectionEnabled}
                className="settings-switch"
                data-testid="inspection-setting"
                onClick={() => onChange({ inspectionEnabled: !settings.inspectionEnabled })}
              >
                <span className="switch-track" aria-hidden="true">
                  <span className="switch-thumb" />
                </span>
              </button>
            </div>

            <label className="settings-field">
              <span className="settings-field-label">Inspection timer</span>
              <select
                data-testid="inspection-direction"
                value={settings.inspectionCountDirection}
                onChange={(event) =>
                  onChange({
                    inspectionCountDirection: event.target
                      .value as Settings['inspectionCountDirection'],
                  })
                }
              >
                <option value="down">Count down (15 → 0)</option>
                <option value="up">Count up (0 → 17)</option>
              </select>
            </label>

            <label className="settings-field">
              <span className="settings-field-label">Timer updates</span>
              <select
                data-testid="timer-update-mode"
                value={settings.timerUpdateMode}
                onChange={(event) =>
                  onChange({ timerUpdateMode: event.target.value as Settings['timerUpdateMode'] })
                }
              >
                <option value="live">Live</option>
                <option value="tenths">Every 0.1 seconds</option>
                <option value="seconds">Whole seconds</option>
              </select>
            </label>

            <label className="settings-field">
              <span className="settings-field-label">Space hold time (ms)</span>
              <input
                data-testid="hold-duration"
                type="number"
                min={0}
                max={10000}
                step={50}
                value={settings.holdDurationMs}
                onChange={(event) =>
                  onChange({
                    holdDurationMs: Math.max(
                      0,
                      Math.min(10000, Number(event.target.value || 0)),
                    ),
                  })
                }
              />
            </label>
          </section>

          <section className="settings-section" aria-labelledby="settings-alerts-title">
            <div className="settings-section-heading">
              <h3 id="settings-alerts-title">Alerts</h3>
            </div>

            <label className="settings-field">
              <span className="settings-field-label">Solve / DNF feedback</span>
              <select
                data-testid="alert-channel"
                value={settings.alertChannel}
                onChange={(event) =>
                  onChange({
                    alertChannel: event.target.value as Settings['alertChannel'],
                  })
                }
              >
                <option value="off">Off</option>
                <option value="visual">Visual only</option>
                <option value="sound">Sound</option>
                <option value="haptic">Haptic</option>
                <option value="sound-haptic">Sound + haptic</option>
              </select>
            </label>

            <div className="settings-field">
              <span className="settings-field-label">Alert volume</span>
              <span className="settings-volume">
                <input
                  id="alert-volume"
                  data-testid="alert-volume"
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={settings.alertVolume}
                  aria-label="Alert volume"
                  onChange={(event) =>
                    onChange({ alertVolume: Number(event.target.value) })
                  }
                />
                <output htmlFor="alert-volume">{settings.alertVolume}%</output>
              </span>
            </div>

            <fieldset className="settings-fieldset">
              <legend className="settings-field-label">
                Inspection warnings
              </legend>
              <div className="settings-checkbox-grid">
                <label className="settings-checkbox">
                  <input
                    type="checkbox"
                    data-testid="inspection-warning-8s"
                    checked={settings.inspectionWarning8s}
                    onChange={(event) =>
                      onChange({ inspectionWarning8s: event.target.checked })
                    }
                  />
                  <span>8 seconds</span>
                </label>
                <label className="settings-checkbox">
                  <input
                    type="checkbox"
                    data-testid="inspection-warning-12s"
                    checked={settings.inspectionWarning12s}
                    onChange={(event) =>
                      onChange({ inspectionWarning12s: event.target.checked })
                    }
                  />
                  <span>12 seconds</span>
                </label>
              </div>
            </fieldset>

            <p className="settings-note">
              Warnings always show their text when enabled and follow the
              inspection timer direction. Sound and haptic follow the feedback
              channel above; volume applies to sound, and haptic support varies
              by browser and device.
            </p>
          </section>

          <section className="settings-section" aria-labelledby="settings-display-title">
            <div className="settings-section-heading">
              <h3 id="settings-display-title">Display</h3>
            </div>

            <label className="settings-field">
              <span className="settings-field-label">Interface zoom</span>
              <select
                data-testid="ui-zoom"
                value={settings.uiZoomPercent}
                onChange={(event) => onChange({ uiZoomPercent: Number(event.target.value) })}
              >
                {[70, 80, 90, 100, 110, 125, 150].map((value) => (
                  <option key={value} value={value}>{value}%</option>
                ))}
              </select>
            </label>

            <label className="settings-field" htmlFor="decimal-small">
              <span className="settings-field-label">Small decimal point</span>
              <input
                id="decimal-small"
                type="checkbox"
                checked={settings.showTimerDecimalSmall}
                onChange={(event) => onChange({ showTimerDecimalSmall: event.target.checked })}
              />
            </label>

          </section>

          <section className="settings-section" aria-labelledby="settings-appearance-title">
            <div className="settings-section-heading">
              <h3 id="settings-appearance-title">Appearance</h3>
            </div>

            <label className="settings-field">
              <span className="settings-field-label">Accent color</span>
              <select
                data-testid="accent-color"
                value={settings.accentColor}
                onChange={(event) =>
                  onChange({
                    accentColor: event.target.value as Settings['accentColor'],
                  })
                }
              >
                <option value="green">Green</option>
                <option value="blue">Blue</option>
                <option value="violet">Violet</option>
                <option value="amber">Amber</option>
              </select>
            </label>
          </section>

          <section className="settings-section" aria-labelledby="settings-statistics-title">
            <div className="settings-section-heading">
              <h3 id="settings-statistics-title">Statistics</h3>
            </div>

            <fieldset className="settings-fieldset">
              <legend className="settings-field-label">Visible cards</legend>
              <div className="settings-checkbox-grid">
                {BUILT_IN_STAT_DEFINITIONS.map(({ key, label }) => (
                  <label key={key} className="settings-checkbox">
                    <input
                      type="checkbox"
                      data-testid={`stat-visible-${key}`}
                      checked={settings.statVisibility[key]}
                      onChange={(event) =>
                        onChange({
                          statVisibility: {
                            ...settings.statVisibility,
                            [key]: event.target.checked,
                          },
                        })
                      }
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="settings-fieldset">
              <span className="settings-field-label">Custom averages</span>
              <div className="settings-custom-averages">
                {settings.customAverages.map((average, index) => (
                  <div className="settings-custom-average" key={average.id}>
                    <label className="settings-checkbox">
                      <input
                        type="checkbox"
                        aria-label={`Show custom ao${average.size}`}
                        data-testid={`custom-average-visible-${index}`}
                        checked={average.visible}
                        onChange={(event) =>
                          updateCustomAverages(
                            settings.customAverages.map((candidate) =>
                              candidate.id === average.id
                                ? {
                                    ...candidate,
                                    visible: event.target.checked,
                                  }
                                : candidate,
                            ),
                          )
                        }
                      />
                      <span>ao</span>
                    </label>
                    <input
                      type="number"
                      className="settings-custom-size"
                      aria-label={`Custom average size ${index + 1}`}
                      data-testid={`custom-average-size-${index}`}
                      min={MIN_CUSTOM_AVERAGE_SIZE}
                      max={MAX_CUSTOM_AVERAGE_SIZE}
                      step={1}
                      value={average.size}
                      onChange={(event) =>
                        changeCustomAverageSize(
                          average.id,
                          Number(event.target.value || MIN_CUSTOM_AVERAGE_SIZE),
                        )
                      }
                    />
                    <button
                      type="button"
                      className="text-button danger-text"
                      aria-label={`Remove custom ao${average.size}`}
                      data-testid={`remove-custom-average-${index}`}
                      onClick={() =>
                        updateCustomAverages(
                          settings.customAverages.filter(
                            (candidate) => candidate.id !== average.id,
                          ),
                        )
                      }
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="text-button settings-add-average"
                data-testid="add-custom-average"
                disabled={settings.customAverages.length >= MAX_CUSTOM_AVERAGES}
                onClick={addCustomAverage}
              >
                Add custom average
              </button>
              <p className="settings-note settings-custom-note">
                Up to {MAX_CUSTOM_AVERAGES} custom trimmed averages, from ao
                {MIN_CUSTOM_AVERAGE_SIZE} to ao{MAX_CUSTOM_AVERAGE_SIZE}. Built-in
                sizes such as ao5 and ao12 are already listed above.
              </p>
              {customAverageError ? (
                <p className="settings-error" role="alert">
                  {customAverageError}
                </p>
              ) : null}
            </div>

            <label className="settings-field">
              <span className="settings-field-label">Stat precision</span>
              <select
                data-testid="stat-precision"
                value={settings.statPrecision}
                onChange={(event) =>
                  onChange({
                    statPrecision: event.target.value as Settings['statPrecision'],
                  })
                }
              >
                <option value="centiseconds">Hundredths (12.34)</option>
                <option value="tenths">Tenths (12.3)</option>
              </select>
            </label>

            <p className="settings-note">
              Display only. WCA calculations always use the stored centisecond
              value.
            </p>
          </section>

          <section className="settings-section" aria-labelledby="settings-scramble-title">
            <div className="settings-section-heading">
              <h3 id="settings-scramble-title">Scramble</h3>
            </div>

            <label className="settings-field">
              <span className="settings-field-label">Alignment</span>
              <select
                data-testid="scramble-alignment"
                value={settings.scrambleAlignment}
                onChange={(event) =>
                  onChange({ scrambleAlignment: event.target.value as Settings['scrambleAlignment'] })
                }
              >
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
              </select>
            </label>

            <label className="settings-field" htmlFor="scramble-limit-height">
              <span className="settings-field-label">Limit scramble height</span>
              <input
                id="scramble-limit-height"
                type="checkbox"
                checked={settings.scrambleLimitHeight}
                onChange={(event) => onChange({ scrambleLimitHeight: event.target.checked })}
              />
            </label>

            <label className="settings-field">
              <span className="settings-field-label">Click scramble action</span>
              <select
                data-testid="scramble-action"
                value={settings.scrambleAction}
                onChange={(event) =>
                  onChange({ scrambleAction: event.target.value as Settings['scrambleAction'] })
                }
              >
                <option value="none">Nothing</option>
                <option value="copy">Copy scramble</option>
                <option value="next">Next scramble</option>
              </select>
            </label>
          </section>

          <section className="settings-section" aria-labelledby="settings-controls-title">
            <div className="settings-section-heading">
              <h3 id="settings-controls-title">Controls</h3>
            </div>
            <dl className="settings-controls">
              <div>
                <dt><kbd>Space</kbd></dt>
                <dd>Hold to arm, release to start; press again to stop.</dd>
              </div>
              <div>
                <dt><kbd>Esc</kbd></dt>
                <dd>Cancel a hold or inspection, or reset the timer stage.</dd>
              </div>
              <div>
                <dt><kbd>Enter</kbd></dt>
                <dd>Activate the focused button, switch, or scramble action.</dd>
              </div>
              <div>
                <dt><kbd>Tab</kbd></dt>
                <dd>Move focus through the timer, sessions, and settings.</dd>
              </div>
              <div>
                <dt><kbd>←</kbd> <kbd>→</kbd></dt>
                <dd>Change the focused session or select value.</dd>
              </div>
            </dl>
          </section>

          <section className="settings-section" aria-labelledby="settings-data-title">
            <div className="settings-section-heading">
              <h3 id="settings-data-title">Data</h3>
            </div>
            <div className="settings-row">
              <div className="settings-row-copy">
                <span className="settings-row-label">Local storage</span>
                <span className="settings-row-description">
                  {storageOk
                    ? `${formatSolveCount(solveCount)} in ${sessionCount === 1 ? '1 session' : `${sessionCount} sessions`}.`
                    : 'Browser storage is unavailable. Sessions and settings will not survive a refresh.'}
                </span>
              </div>
              <span className={`settings-storage ${storageOk ? 'is-ok' : 'is-error'}`}>
                <span className="status-dot" aria-hidden="true" />
                {storageOk ? 'Saved' : 'Unavailable'}
              </span>
            </div>
            <button
              type="button"
              className="settings-data-button"
              onClick={onOpenBackup}
              data-testid="settings-backup-button"
            >
              <span className="settings-data-copy">
                <span className="settings-data-title">Backup &amp; restore</span>
                <span className="settings-data-description">
                  Export or import every session, solve, and setting
                </span>
              </span>
              <ChevronRightIcon size={16} />
            </button>
            <p className="settings-note">
              Backups stay on this device. CubeLab never uploads them.
            </p>
          </section>

          <section className="settings-section" aria-labelledby="settings-about-title">
            <div className="settings-section-heading">
              <h3 id="settings-about-title">About</h3>
            </div>
            <dl className="settings-about">
              <div>
                <dt>Timer</dt>
                <dd>3×3 · WCA random-state</dd>
              </div>
              <div>
                <dt>Data</dt>
                <dd>Local-first, with no accounts or telemetry</dd>
              </div>
              <div>
                <dt>Offline</dt>
                <dd>Installable PWA with offline scramble generation</dd>
              </div>
            </dl>
          </section>
        </div>

        <footer className="settings-footer">
          <span className="settings-footer-note">Changes save automatically.</span>
          <button
            type="button"
            className="button button-secondary"
            onClick={onClose}
            data-testid="settings-done"
          >
            Done
          </button>
        </footer>
      </div>
    </dialog>
  )
}