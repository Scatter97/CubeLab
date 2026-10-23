import { CubeMark, ScanIcon } from './Icons'

interface AppHeaderProps {
  sessionName: string
  inspectionEnabled: boolean
  onInspectionChange: (enabled: boolean) => void
  inspectionLocked: boolean
  storageOk: boolean
}

export function AppHeader({
  sessionName,
  inspectionEnabled,
  onInspectionChange,
  inspectionLocked,
  storageOk,
}: AppHeaderProps) {
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
        <span className="context-meta">3×3 · Random state</span>
      </div>

      <div className="header-actions">
        <span
          className={`storage-state ${storageOk ? 'is-ok' : 'is-error'}`}
          title={
            storageOk
              ? 'Sessions and solves are saved in this browser'
              : 'Browser storage is unavailable. Sessions and solves will not survive a refresh.'
          }
        >
          <span className="status-dot" aria-hidden="true" />
          {storageOk ? 'Saved locally' : 'Storage unavailable'}
        </span>

        <button
          type="button"
          role="switch"
          aria-checked={inspectionEnabled}
          aria-label="Inspection (WCA 15 seconds)"
          className={`inspection-toggle ${
            inspectionLocked ? 'is-locked' : ''
          }`}
          disabled={inspectionLocked}
          onClick={() => onInspectionChange(!inspectionEnabled)}
          title={
            inspectionLocked
              ? 'Finish or reset the current timer before changing inspection'
              : 'Enable the WCA 15-second inspection period'
          }
        >
          <span className="toggle-icon">
            <ScanIcon size={17} />
          </span>
          <span className="toggle-copy">
            <span className="toggle-label">Inspection</span>
            <span className="toggle-hint">WCA · 15 sec</span>
          </span>
          <span className="switch-track" aria-hidden="true">
            <span className="switch-thumb" />
          </span>
        </button>
      </div>
    </header>
  )
}
