import { useState, type ReactNode } from 'react'
import { useModalDialog } from '../hooks/useModalDialog'
import { formatSolveCount } from '../lib/format'
import { CUBELAB_VERSION } from '../lib/version'
import { AVERAGE_TRIM_OPTIONS, getAverageTrimCounts } from '../lib/averageTrimming'
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
import { Select } from './Select'
import type { CustomAverageSetting, Settings } from '../types'
import type { DrawScrambleMode } from '../hooks/useDrawScrambleMode'

const INSPECTION_DIRECTION_OPTIONS = [
  { value: 'down', label: 'Count down' },
  { value: 'up', label: 'Count up' },
] as const

const TIMER_UPDATE_OPTIONS = [
  { value: 'live', label: 'Live' },
  { value: 'tenths', label: 'Every 0.1 seconds' },
  { value: 'seconds', label: 'Whole seconds' },
] as const

const ALERT_CHANNEL_OPTIONS = [
  { value: 'off', label: 'Off' },
  { value: 'visual', label: 'Visual only' },
  { value: 'sound', label: 'Sound only' },
  { value: 'sound-visual', label: 'Sound + visual' },
  { value: 'haptic', label: 'Haptic' },
  { value: 'sound-haptic', label: 'Sound + haptic' },
] as const

const WARNING_DISPLAY_OPTIONS = [
  { value: 'timer', label: 'Timer surface' },
  { value: 'screen', label: 'Entire screen' },
] as const

const THEME_OPTIONS = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
] as const

const ACCENT_OPTIONS = [
  { value: 'green', label: 'Green' },
  { value: 'blue', label: 'Blue' },
  { value: 'violet', label: 'Violet' },
  { value: 'amber', label: 'Amber' },
] as const

const PRECISION_OPTIONS = [
  { value: 'centiseconds', label: 'Hundredths (12.34)' },
  { value: 'tenths', label: 'Tenths (12.3)' },
] as const

const SCRAMBLE_ALIGNMENT_OPTIONS = [
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Center' },
  { value: 'right', label: 'Right' },
] as const

const SCRAMBLE_ACTION_OPTIONS = [
  { value: 'none', label: 'Nothing' },
  { value: 'copy', label: 'Copy scramble' },
  { value: 'next', label: 'Next scramble' },
] as const

const DRAW_SCRAMBLE_OPTIONS = [
  { value: 'net', label: '2D net' },
  { value: '3d', label: '3D puzzle' },
] as const

function SettingsHelp({
  summary,
  children,
  testId,
}: {
  summary: string
  children: ReactNode
  testId?: string
}) {
  return (
    <details className="settings-help" data-testid={testId}>
      <summary>{summary}</summary>
      <div className="settings-help-body">{children}</div>
    </details>
  )
}

interface SettingsDialogProps {
  open: boolean
  settings: Settings
  storageOk: boolean
  sessionCount: number
  solveCount: number
  drawScrambleMode: DrawScrambleMode
  onDrawScrambleModeChange: (mode: DrawScrambleMode) => void
  onChange: (next: Partial<Settings>) => void
  onOpenBackup: () => void
  onOpenDriveBackup: () => void
  onRequestResetAllSolveData: () => void
  /** Why the destructive reset is unavailable, if it is. */
  resetAllDisabledReason?: string | null
  onRequestDeleteAllSessions: () => void
  /** Why deleting every session is unavailable, if it is. */
  deleteAllSessionsDisabledReason?: string | null
  /** Current Google Drive synchronization state for the Developer section. */
  developerSyncStatus: string
  onClose: () => void
}

export function SettingsDialog({
  open,
  settings,
  storageOk,
  sessionCount,
  solveCount,
  drawScrambleMode,
  onDrawScrambleModeChange,
  onChange,
  onOpenBackup,
  onOpenDriveBackup,
  onRequestResetAllSolveData,
  resetAllDisabledReason,
  onRequestDeleteAllSessions,
  deleteAllSessionsDisabledReason,
  developerSyncStatus,
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
          drawScrambleMode={drawScrambleMode}
          onDrawScrambleModeChange={onDrawScrambleModeChange}
          onChange={onChange}
          onOpenBackup={onOpenBackup}
          onOpenDriveBackup={onOpenDriveBackup}
          onRequestResetAllSolveData={onRequestResetAllSolveData}
          resetAllDisabledReason={resetAllDisabledReason}
          onRequestDeleteAllSessions={onRequestDeleteAllSessions}
          deleteAllSessionsDisabledReason={deleteAllSessionsDisabledReason}
          developerSyncStatus={developerSyncStatus}
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
  drawScrambleMode,
  onDrawScrambleModeChange,
  onChange,
  onOpenBackup,
  onOpenDriveBackup,
  onRequestResetAllSolveData,
  resetAllDisabledReason,
  onRequestDeleteAllSessions,
  deleteAllSessionsDisabledReason,
  developerSyncStatus,
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

  const trimExample = getAverageTrimCounts(1000, { better: settings.averageTrimBetter, worse: settings.averageTrimWorse })

  return (
    <div className="dialog-content settings-content">
        <header className="settings-header">
          <div>
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

        <p id="settings-description" className="sr-only">
          CubeLab settings. Changes save automatically in this browser.
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
                  WCA inspection for sessions without an override.
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

            <SettingsHelp summary="Inspection penalties">
              15 seconds are penalty-free. Starting after 15 seconds and through
              17 seconds adds +2; starting after 17 seconds is a DNF.
            </SettingsHelp>

            <label className="settings-field">
              <span className="settings-field-label">Inspection timer</span>
              <Select
                testId="inspection-direction"
                value={settings.inspectionCountDirection}
                options={INSPECTION_DIRECTION_OPTIONS}
                onChange={(value) =>
                  onChange({
                    inspectionCountDirection:
                      value as Settings['inspectionCountDirection'],
                  })
                }
              />
            </label>

            <label className="settings-field">
              <span className="settings-field-label">Timer updates</span>
              <Select
                testId="timer-update-mode"
                value={settings.timerUpdateMode}
                options={TIMER_UPDATE_OPTIONS}
                onChange={(value) =>
                  onChange({
                    timerUpdateMode: value as Settings['timerUpdateMode'],
                  })
                }
              />
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
                  Any non-modifier key stops a running solve.
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
              <Select
                testId="alert-channel"
                value={settings.alertChannel}
                options={ALERT_CHANNEL_OPTIONS}
                onChange={(value) =>
                  onChange({
                    alertChannel: value as Settings['alertChannel'],
                  })
                }
              />
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
              <Select
                testId="inspection-warning-display"
                value={settings.inspectionWarningVisualScope}
                options={WARNING_DISPLAY_OPTIONS}
                onChange={(value) =>
                  onChange({
                    inspectionWarningVisualScope:
                      value as Settings['inspectionWarningVisualScope'],
                  })
                }
              />
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

            <SettingsHelp summary="How warning alerts work">
              {settings.inspectionCountDirection === 'up'
                ? 'Count up warns at 8 and 12 seconds elapsed.'
                : 'Count down warns at 7 and 3 seconds remaining.'}{' '}
              Warnings follow the selected feedback channel. Haptics depend on
              browser and device support.
            </SettingsHelp>
          </section>

          <section className="settings-section" aria-labelledby="settings-display-title">
            <div className="settings-section-heading">
              <h3 id="settings-display-title">Display</h3>
            </div>

            <label className="settings-field">
              <span className="settings-field-label">Interface zoom</span>
              <Select
                testId="ui-zoom"
                value={String(settings.uiZoomPercent)}
                options={[70, 80, 90, 100, 110, 125, 150].map((value) => ({
                  value: String(value),
                  label: `${value}%`,
                }))}
                onChange={(value) =>
                  onChange({ uiZoomPercent: Number(value) })
                }
              />
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

            <div className="settings-row settings-row-spaced">
              <div className="settings-row-copy">
                <label
                  className="settings-row-label"
                  htmlFor="session-solve-progress"
                >
                  Session solve progress
                </label>
                <span className="settings-row-description">
                  Shows completed and total solves in the timer footer.
                </span>
              </div>
              <input
                id="session-solve-progress"
                data-testid="session-solve-progress-setting"
                type="checkbox"
                checked={settings.showSessionSolveProgress}
                onChange={(event) =>
                  onChange({ showSessionSolveProgress: event.target.checked })
                }
              />
            </div>

            <div className="settings-row settings-row-spaced">
              <div className="settings-row-copy">
                <label
                  className="settings-row-label"
                  htmlFor="session-total-time"
                >
                  Session total time
                </label>
                <span className="settings-row-description">
                  Shows total solve time in the timer footer.
                </span>
              </div>
              <input
                id="session-total-time"
                data-testid="session-total-time-setting"
                type="checkbox"
                checked={settings.showSessionTotalTime}
                onChange={(event) =>
                  onChange({ showSessionTotalTime: event.target.checked })
                }
              />
            </div>

            <SettingsHelp summary="DNF and +2 in summaries">
              DNFs stay in the attempt total but are excluded from completed
              solves and total time. A +2 counts as completed and adds two
              seconds.
            </SettingsHelp>
          </section>

          <section className="settings-section" aria-labelledby="settings-appearance-title">
            <div className="settings-section-heading">
              <h3 id="settings-appearance-title">Appearance</h3>
            </div>

            <label className="settings-field">
              <span className="settings-field-label">Theme</span>
              <Select
                testId="theme-setting"
                value={settings.theme}
                options={THEME_OPTIONS}
                onChange={(value) =>
                  onChange({ theme: value as Settings['theme'] })
                }
              />
            </label>

            <label className="settings-field">
              <span className="settings-field-label">Accent color</span>
              <Select
                testId="accent-color"
                value={settings.accentColor}
                options={ACCENT_OPTIONS}
                onChange={(value) =>
                  onChange({ accentColor: value as Settings['accentColor'] })
                }
              />
            </label>
          </section>

          <section className="settings-section" aria-labelledby="settings-statistics-title">
            <div className="settings-section-heading">
              <h3 id="settings-statistics-title">Statistics</h3>
            </div>

            <fieldset className="settings-fieldset" data-testid="average-trimming-settings">
              <legend className="settings-field-label">Average trimming</legend>
              <label className="settings-field">
                <span className="settings-field-label">Better side (fastest)</span>
                <Select
                  testId="average-trim-better"
                  value={settings.averageTrimBetter}
                  options={AVERAGE_TRIM_OPTIONS.map((option) => ({
                    value: option.value,
                    label: option.label,
                  }))}
                  onChange={(value) =>
                    onChange({
                      averageTrimBetter: value as Settings['averageTrimBetter'],
                    })
                  }
                />
              </label>
              <label className="settings-field">
                <span className="settings-field-label">Worse side (slowest)</span>
                <Select
                  testId="average-trim-worse"
                  value={settings.averageTrimWorse}
                  options={[
                    { value: 'auto', label: 'Auto (match better side)' },
                    ...AVERAGE_TRIM_OPTIONS.map((option) => ({
                      value: option.value,
                      label: option.label,
                    })),
                  ]}
                  onChange={(value) =>
                    onChange({
                      averageTrimWorse: value as Settings['averageTrimWorse'],
                    })
                  }
                />
              </label>
              <p className="settings-note">
                Removes the fastest and slowest results before averaging.
              </p>
              <SettingsHelp
                summary="How averages work"
                testId="average-trim-help"
              >
                <p data-testid="average-trim-example">
                  ao1000 currently drops {trimExample.better} fastest and{' '}
                  {trimExample.worse} worst; {trimExample.counted} solves count.
                </p>
                <p>
                  Percentages round up. DNFs fill the worst-side slots first;
                  more than {trimExample.worse} makes the average DNF. mo3 stays
                  untrimmed. Changes recalculate rolling averages and average
                  PBs; recorded solves and single PBs stay intact.
                </p>
              </SettingsHelp>
            </fieldset>

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
                Up to {MAX_CUSTOM_AVERAGES} averages, from ao
                {MIN_CUSTOM_AVERAGE_SIZE} to ao{MAX_CUSTOM_AVERAGE_SIZE}.
                Built-in sizes are already listed above.
              </p>
            </div>

            <label className="settings-field">
              <span className="settings-field-label">Stat precision</span>
              <Select
                testId="stat-precision"
                value={settings.statPrecision}
                options={PRECISION_OPTIONS}
                onChange={(value) =>
                  onChange({
                    statPrecision: value as Settings['statPrecision'],
                  })
                }
              />
            </label>

            <p className="settings-note">
              Display only. Recorded times keep their original precision.
            </p>
          </section>

          <section className="settings-section" aria-labelledby="settings-scramble-title">
            <div className="settings-section-heading">
              <h3 id="settings-scramble-title">Scramble</h3>
            </div>

            <label className="settings-field">
              <span className="settings-field-label">Alignment</span>
              <Select
                testId="scramble-alignment"
                value={settings.scrambleAlignment}
                options={SCRAMBLE_ALIGNMENT_OPTIONS}
                onChange={(value) =>
                  onChange({
                    scrambleAlignment: value as Settings['scrambleAlignment'],
                  })
                }
              />
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
              <Select
                testId="scramble-action"
                value={settings.scrambleAction}
                options={SCRAMBLE_ACTION_OPTIONS}
                onChange={(value) =>
                  onChange({
                    scrambleAction: value as Settings['scrambleAction'],
                  })
                }
              />
            </label>

            <label className="settings-field">
              <span className="settings-field-label">Draw Scramble visualization</span>
              <Select
                testId="scramble-draw-mode"
                value={drawScrambleMode}
                options={DRAW_SCRAMBLE_OPTIONS}
                onChange={(value) =>
                  onDrawScrambleModeChange(value as DrawScrambleMode)
                }
              />
            </label>
          </section>

          <details
            className="settings-section settings-shortcuts"
            data-testid="settings-shortcuts"
          >
            <summary className="settings-shortcuts-summary">
              <span id="settings-controls-title">Keyboard shortcuts</span>
              <ChevronRightIcon
                className="settings-shortcuts-chevron"
                size={16}
              />
            </summary>
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
          </details>

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
                  Export or import all local data
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
                  Sync with your Google account
                </span>
              </span>
              <ChevronRightIcon size={16} />
            </button>
            <p className="settings-note">
              Backups stay on this device. Drive sync uploads data only after
              you connect an account.
            </p>
          </section>

          <details
            className="settings-section settings-developer"
            data-testid="settings-developer"
          >
            <summary className="settings-developer-summary">
              <span className="settings-developer-title">
                <span className="settings-section-heading">
                  <span className="settings-developer-heading">
                    Developer options
                  </span>
                  <span className="settings-badge">Advanced</span>
                </span>
                <span className="settings-row-description">
                  Destructive maintenance with typed confirmation.
                </span>
              </span>
              <ChevronRightIcon
                className="settings-developer-chevron"
                size={16}
              />
            </summary>
            <div className="settings-developer-body">
              <div
                className="settings-danger-zone"
                data-testid="settings-danger-zone"
              >
                <div className="settings-danger-zone-heading">
                  <h4>Danger Zone</h4>
                  <span className="settings-danger-badge">Destructive</span>
                </div>
                <p className="settings-row-description">
                  Removes every solve from every session. Session names, event
                  assignments, custom events, preferences, and settings remain.
                  Cannot be undone without a backup.
                </p>
                <button
                  type="button"
                  className="button button-danger"
                  data-testid="settings-reset-all-solves"
                  disabled={solveCount === 0 || Boolean(resetAllDisabledReason)}
                  title={
                    solveCount === 0
                      ? 'There are no solves to reset.'
                      : resetAllDisabledReason ?? undefined
                  }
                  onClick={onRequestResetAllSolveData}
                >
                  Reset All Solve Data
                </button>
                {resetAllDisabledReason ? (
                  <p className="settings-inline-error" role="alert">
                    {resetAllDisabledReason}
                  </p>
                ) : null}
                <p
                  className="settings-note"
                  data-testid="settings-reset-sync-status"
                >
                  {developerSyncStatus}
                </p>
              </div>

              <div
                className="settings-danger-zone settings-danger-zone-secondary"
                data-testid="settings-delete-all-sessions-zone"
              >
                <div className="settings-danger-zone-heading">
                  <h4>Delete all sessions</h4>
                  <span className="settings-danger-badge">Destructive</span>
                </div>
                <p className="settings-row-description">
                  Deletes all sessions and solves, then creates one empty{' '}
                  <strong>Session 1</strong>. Settings and custom events remain.
                  Deletion records prevent sync from restoring the data; remote
                  snapshots are retained. Cannot be undone without a backup.
                </p>
                <button
                  type="button"
                  className="button button-danger"
                  data-testid="settings-delete-all-sessions"
                  disabled={Boolean(deleteAllSessionsDisabledReason)}
                  title={deleteAllSessionsDisabledReason ?? undefined}
                  onClick={onRequestDeleteAllSessions}
                >
                  Delete All Sessions
                </button>
                {deleteAllSessionsDisabledReason ? (
                  <p className="settings-inline-error" role="alert">
                    {deleteAllSessionsDisabledReason}
                  </p>
                ) : null}
              </div>
            </div>
          </details>

          <section className="settings-section" aria-labelledby="settings-about-title">
            <div className="settings-section-heading">
              <h3 id="settings-about-title">About</h3>
            </div>
            <dl className="settings-about">
              <div>
                <dt>Version</dt>
                <dd>{CUBELAB_VERSION}</dd>
              </div>
              <div>
                <dt>Timer</dt>
                <dd>12 WCA events · official scrambles</dd>
              </div>
              <div>
                <dt>Data</dt>
                <dd>Local-first · no accounts or telemetry</dd>
              </div>
              <div>
                <dt>Offline</dt>
                <dd>Installable PWA with offline scrambles</dd>
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
