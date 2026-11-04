import { CubeMark, SettingsIcon } from './Icons'
import { getEventLabel } from '../lib/events'

import type { PuzzleEvent } from '../types'

export type AppView = 'timer' | 'analytics'

interface AppHeaderProps {
  sessionName: string
  event?: PuzzleEvent
  inspectionEnabled: boolean
  onOpenSettings: () => void
  settingsLocked: boolean
  storageOk: boolean
  view: AppView
  onNavigate: (view: AppView) => void
}

export function AppHeader({
  sessionName,
  event = '333',
  inspectionEnabled,
  onOpenSettings,
  settingsLocked,
  storageOk,
  view,
  onNavigate,
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

        </span>
      </div>

      <nav className="app-nav" aria-label="Main views">
        <button
          type="button"
          className="app-nav-button"
          aria-current={view === 'timer' ? 'page' : undefined}
          onClick={() => onNavigate('timer')}
        >
          Timer
        </button>
        <button
          type="button"
          className="app-nav-button"
          aria-current={view === 'analytics' ? 'page' : undefined}
          disabled={settingsLocked}
          title={
            settingsLocked
              ? 'Finish or reset the current timer before opening Analytics'
              : 'Open solve analytics'
          }
          onClick={() => onNavigate('analytics')}
          data-testid="analytics-nav"
        >
          Analytics
        </button>
      </nav>

      <div className="header-context" aria-hidden="true">
        <span className="context-divider" />
        <span className="context-label" title={sessionName}>
          {sessionName}
        </span>
        <span className="context-dot" />
        <span className="context-meta">
          {getEventLabel(event)} · Inspection {inspectionLabel}
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
        </button>
      </div>
    </header>
  )
}
