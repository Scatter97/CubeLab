import { CubeMark, ScanIcon } from './Icons'

interface AppHeaderProps {
  inspectionEnabled: boolean
  onInspectionChange: (enabled: boolean) => void
  inspectionLocked: boolean
  storageOk: boolean
}

export function AppHeader({
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
          <span className="brand-subtitle">Precision timer</span>
        </span>
      </div>

      <div className="header-context" aria-hidden="true">
        <span className="context-divider" />
        <span className="context-label">3×3 session</span>
        <span className="context-dot" />
        <span className="context-meta">Random state</span>
      </div>

      <div className="header-actions">
        <span
          className={`storage-state ${storageOk ? 'is-ok' : 'is-error'}`}
          title={
            storageOk
              ? 'Solves are saved in this browser'
              : 'Browser storage is unavailable. Solves will not survive a refresh.'
          }
        >
          <span className="status-dot" aria-hidden="true" />
          {storageOk ? 'Saved locally' : 'Storage unavailable'}
        </span>

        <button
          type="button"
          role="switch"
          aria-checked={inspectionEnabled}
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
