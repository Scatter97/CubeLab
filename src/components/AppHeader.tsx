import { CubeMark, SettingsIcon } from './Icons'

interface AppHeaderProps {
  sessionName: string
  inspectionEnabled: boolean
  onOpenSettings: () => void
  settingsLocked: boolean
  storageOk: boolean
}

export function AppHeader({
  sessionName,
  inspectionEnabled,
  onOpenSettings,
  settingsLocked,
  storageOk,
}: AppHeaderProps) {
  const inspectionLabel = inspectionEnabled ? 'on' : 'off'

  return (
    <header className="app-header">
      <div className="brand">
        <span className="brand-mark">
          <CubeMark size={40} />
        </span>
        <span className="brand-copy">
          <span className="brand-name">
            Cube<span>Lab</span>
          </span>
          <span className="brand-subtitle">Speedcubing timer</span>
        </span>
      </div>

      <div className="header-context" aria-hidden="true">
        <span className="context-divider" />
        <span className="context-label" title={sessionName}>
          {sessionName}
        </span>
        <span className="context-dot" />
        <span className="context-meta">
          3×3 · Inspection {inspectionLabel}
        </span>
      </div>

      <div className="header-actions">
        {!storageOk ? (
          <span
            className="storage-state is-error"
            title="Browser storage is unavailable. Sessions and solves will not survive a refresh."
          >
            <span className="status-dot" aria-hidden="true" />
            Storage unavailable
          </span>
        ) : null}

        <button
          type="button"
          className="settings-button"
          aria-label={`Settings. Inspection ${inspectionLabel}.`}
          aria-haspopup="dialog"
          disabled={settingsLocked}
          onClick={onOpenSettings}
          data-testid="settings-button"
          title={
            settingsLocked
              ? 'Finish or reset the current timer before opening settings'
              : 'Open timer, data, and app settings'
          }
        >
          <span className="settings-button-icon">
            <SettingsIcon size={17} />
          </span>
          <span className="settings-button-copy">
            <span className="settings-button-label">Settings</span>
            <span className="settings-button-hint">
              Inspection {inspectionLabel}
            </span>
          </span>
        </button>
      </div>
    </header>
  )
}
