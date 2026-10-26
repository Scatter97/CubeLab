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
  onOpenDriveBackup: () => void
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
  onOpenDriveBackup,
  onClose,
}: SettingsDialogProps) {
  const { dialogRef, handleKeyDown } = useModalDialog(open)

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
      {open ? (
        <SettingsContent
          settings={settings}
          storageOk={storageOk}
          sessionCount={sessionCount}
          solveCount={solveCount}
          onChange={onChange}
          onOpenBackup={onOpenBackup}
          onOpenDriveBackup={onOpenDriveBackup}
          onClose={onClose}
        />
      ) : null}
    </dialog>
  )
}

function SettingsContent({
  settings,
  storageOk,
  sessionCount,
  solveCount,
  onChange,
  onOpenBackup,
  onOpenDriveBackup,
  onClose,
}: Omit<SettingsDialogProps, 'open'>) {
  const updateCustomAverages = (next: CustomAverageSetting[]): string | null => {
    const sizes = next.map((average) => average.size)
    if (new Set(sizes).size !== sizes.length) {
      return 'Custom averages must use different sizes.'
    }
    onChange({ customAverages: next })
    return null
  }

  const changeCustomAverageSize = (id: string, size: number): string | null => {
    if (
      !Number.isInteger(size) ||
      size < MIN_CUSTOM_AVERAGE_SIZE ||
      size > MAX_CUSTOM_AVERAGE_SIZE
    ) {
      return `Use a whole number from ${MIN_CUSTOM_AVERAGE_SIZE} to ${MAX_CUSTOM_AVERAGE_SIZE}.`
    }
    if (isBuiltInAverageSize(size)) {
      return `ao${size} is already available above.`
    }
    return updateCustomAverages(
      settings.customAverages.map((average) =>
        average.id === id ? { ...average, size } : average,
      ),
    )
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

  return (
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
                <option value="down">Count down</option>
                <option value="up">Count up</option>
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

            <div className="settings-row settings-row-spaced">
              <div className="settings-row-copy">
                <label
                  className="settings-row-label"
                  htmlFor="stop-with-any-key"
                >
                  Stop with any key
                </label>
                <span className="settings-row-description">
                  While the timer is running, any non-modifier key stops it.
                  Space always works.
                </span>
              </div>
              <input
                id="stop-with-any-key"
                data-testid="stop-with-any-key"
                type="checkbox"
                checked={settings.stopWithAnyKey}
                onChange={(event) =>
                  onChange({ stopWithAnyKey: event.target.checked })
                }
              />
            </div>
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
                <option value="sound">Sound only</option>
                <option value="sound-visual">Sound + visual</option>
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
                  min={50}
                  max={150}
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

            <label className="settings-field">
              <span className="settings-field-label">Inspection warning display</span>
              <select
                data-testid="inspection-warning-display"
                value={settings.inspectionWarningVisualScope}
                onChange={(event) =>
                  onChange({
                    inspectionWarningVisualScope: event.target.value as
                      | 'timer'
                      | 'screen',
                  })
                }
              >
                <option value="timer">Timer surface</option>
                <option value="screen">Entire screen</option>
              </select>
            </label>

            <fieldset className="settings-fieldset">
              <legend className="settings-field-label">
                Inspection warnings
              </legend>
              <div className="settings-checkbox-grid">
                {(
                  settings.inspectionCountDirection === 'up'
                    ? [
                        {
                          key: '8s' as const,
                          label: '8 seconds elapsed',
                          checked: settings.inspectionWarning8s,
                        },
                        {
                          key: '12s' as const,
                          label: '12 seconds elapsed',
                          checked: settings.inspectionWarning12s,
                        },
                      ]
                    : [
                        {
                          key: '8s' as const,
                          label: '7 seconds remaining',
                          checked: settings.inspectionWarning8s,
                        },
                        {
                          key: '12s' as const,
                          label: '3 seconds remaining',
                          checked: settings.inspectionWarning12s,
                        },
                      ]
                ).map(({ key, label, checked }) => (
                  <label className="settings-checkbox" key={key}>
                    <input
                      type="checkbox"
                      data-testid={`inspection-warning-${key}`}
                      checked={checked}
                      onChange={(event) =>
                        onChange(
                          key === '8s'
                            ? { inspectionWarning8s: event.target.checked }
                            : { inspectionWarning12s: event.target.checked },
                        )
                      }
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <p className="settings-note">
              {settings.inspectionCountDirection === 'up'
                ? 'Count up warns at 8 and 12 seconds elapsed.'
                : 'Count down warns at 7 and 3 seconds remaining.'}{' '}
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
                  <CustomAverageRow
                    key={`${average.id}:${average.size}`}
                    average={average}
                    index={index}
                    onCommitSize={changeCustomAverageSize}
                    onVisibleChange={(id, visible) =>
                      updateCustomAverages(
                        settings.customAverages.map((candidate) =>
                          candidate.id === id
                            ? { ...candidate, visible }
                            : candidate,
                        ),
                      )
                    }
                    onRemove={(id) =>
                      updateCustomAverages(
                        settings.customAverages.filter(
                          (candidate) => candidate.id !== id,
                        ),
                      )
                    }
                  />
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
            <button
              type="button"
              className="settings-data-button"
              onClick={onOpenDriveBackup}
              data-testid="settings-drive-button"
            >
              <span className="settings-data-copy">
                <span className="settings-data-title">Google Drive backup</span>
                <span className="settings-data-description">
                  Synchronize sessions and settings with Google Drive app data
                </span>
              </span>
              <ChevronRightIcon size={16} />
            </button>
            <p className="settings-note">
              Local JSON backups stay on this device. Google Drive
              synchronization uploads session and setting data to your Google
              account only when you connect it.
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
  )
}
interface CustomAverageRowProps {
  average: CustomAverageSetting
  index: number
  onCommitSize: (id: string, size: number) => string | null
  onVisibleChange: (id: string, visible: boolean) => void
  onRemove: (id: string) => void
}

function CustomAverageRow({
  average,
  index,
  onCommitSize,
  onVisibleChange,
  onRemove,
}: CustomAverageRowProps) {
  // Keep a draft string so typing `100` is not clamped to `300` after the
  // first keystroke. Validation happens on blur or Enter.
  const [draft, setDraft] = useState(String(average.size))
  const [error, setError] = useState<string | null>(null)

  const commit = () => {
    const trimmed = draft.trim()
    if (!/^\d+$/.test(trimmed)) {
      setError(
        `Enter a whole number from ${MIN_CUSTOM_AVERAGE_SIZE} to ${MAX_CUSTOM_AVERAGE_SIZE}.`,
      )
      return
    }
    const size = Number(trimmed)
    const message = onCommitSize(average.id, size)
    if (message) {
      setError(message)
      return
    }
    setError(null)
    setDraft(String(size))
  }

  return (
    <div className="settings-custom-average">
      <label className="settings-checkbox">
        <input
          type="checkbox"
          aria-label={`Show custom ao${average.size}`}
          data-testid={`custom-average-visible-${index}`}
          checked={average.visible}
          onChange={(event) =>
            onVisibleChange(average.id, event.target.checked)
          }
        />
        <span>ao</span>
      </label>
      <input
        type="number"
        className="settings-custom-size"
        aria-label={`Custom average size ${index + 1}`}
        aria-invalid={Boolean(error)}
        data-testid={`custom-average-size-${index}`}
        min={MIN_CUSTOM_AVERAGE_SIZE}
        max={MAX_CUSTOM_AVERAGE_SIZE}
        step={1}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value)
          setError(null)
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commit()
            event.currentTarget.blur()
          }
        }}
      />
      <button
        type="button"
        className="text-button danger-text"
        aria-label={`Remove custom ao${average.size}`}
        data-testid={`remove-custom-average-${index}`}
        onClick={() => onRemove(average.id)}
      >
        Remove
      </button>
      {error ? (
        <p className="settings-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
