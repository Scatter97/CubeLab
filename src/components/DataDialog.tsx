import { useRef, useState, type ChangeEvent } from 'react'
import type { Backup } from '../lib/backup'
import { MAX_BACKUP_BYTES, parseBackup } from '../lib/backup'
import {
  analyzeCsTimerBackup,
  isCsTimerBackup,
  parseCsTimerBackup,
} from '../lib/csTimerImport'
import type { CsTimerImportPreview } from '../lib/csTimerImport'
import { useModalDialog } from '../hooks/useModalDialog'
import { loadSettings } from '../lib/storage'
import { CubeMark } from './Icons'

interface DataDialogProps {
  open: boolean
  sessionCount: number
  solveCount: number
  onClose: () => void
  onExport: () => boolean
  onImport: (backup: Backup) => void
}

function plural(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? singular : pluralForm
}

export function DataDialog({
  open,
  sessionCount,
  solveCount,
  onClose,
  onExport,
  onImport,
}: DataDialogProps) {
  const { dialogRef, handleKeyDown } = useModalDialog(open)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const readIdRef = useRef(0)
  const [error, setError] = useState<string | null>(null)
  const [isReading, setIsReading] = useState(false)
  const [csPreview, setCsPreview] = useState<CsTimerImportPreview | null>(null)
  const [csRaw, setCsRaw] = useState<string | null>(null)

  const handleClose = () => {
    readIdRef.current += 1
    setError(null)
    setIsReading(false)
    setCsPreview(null)
    setCsRaw(null)
    onClose()
  }

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setError(null)
    if (file.size > MAX_BACKUP_BYTES) {
      setError('That backup is larger than 10 MB.')
      return
    }

    const readId = readIdRef.current + 1
    readIdRef.current = readId
    setIsReading(true)
    try {
      const raw = await file.text()
      if (readId !== readIdRef.current) return

      const result = parseBackup(raw)
      if (!result.ok) {
        if (isCsTimerBackup(raw)) {
          const analyzed = analyzeCsTimerBackup(raw)
          if (!analyzed.ok) {
            setError(analyzed.error)
            return
          }
          setCsRaw(raw)
          setCsPreview(analyzed.preview)
          return
        }
        setError(result.error)
        return
      }
      onImport(result.backup)
    } catch {
      if (readId === readIdRef.current) setError('Could not read that file.')
    } finally {
      if (readId === readIdRef.current) setIsReading(false)
    }
  }

  const handleConfirmCsImport = () => {
    if (!csRaw) return
    const result = parseCsTimerBackup(csRaw, loadSettings())
    if (!result.ok) {
      setError(result.error)
      setCsPreview(null)
      setCsRaw(null)
      return
    }
    setCsPreview(null)
    setCsRaw(null)
    onImport(result.backup)
  }

  const handleCancelPreview = () => {
    setCsPreview(null)
    setCsRaw(null)
  }

  return (
    <dialog
      ref={dialogRef}
      className="confirm-dialog data-dialog"
      aria-labelledby="data-title"
      aria-describedby="data-description"
      onKeyDown={handleKeyDown}
      onCancel={(event) => {
        event.preventDefault()
        if (csPreview) {
          handleCancelPreview()
        } else {
          handleClose()
        }
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) {
          if (csPreview) handleCancelPreview()
          else handleClose()
        }
      }}
    >
      {open ? <div className="dialog-content">
        <span className="dialog-icon is-neutral" aria-hidden="true">
          <CubeMark size={24} />
        </span>
        <span className="eyebrow">Backup &amp; restore</span>
        <h2 id="data-title">Your local data</h2>
        <p id="data-description">
          Export every session and setting as a JSON file, or restore a CubeLab
          backup. Importing replaces local sessions after confirmation.
        </p>

        <div className="data-summary" aria-label="Current local data">
          <span>
            <strong>{sessionCount}</strong>{' '}
            {plural(sessionCount, 'session', 'sessions')}
          </span>
          <span>
            <strong>{solveCount}</strong> {plural(solveCount, 'solve', 'solves')}
          </span>
          <span>Settings included</span>
        </div>

        {error ? (
          <p className="data-error" role="alert" data-testid="backup-error">
            {error}
          </p>
        ) : null}

        <input
          ref={fileInputRef}
          type="file"
          accept=".json,.txt,application/json,text/plain"
          hidden
          data-testid="backup-file-input"
          onChange={handleFileChange}
        />

        {csPreview ? (
          <div className="cs-preview" data-testid="cs-preview">
            <h3>Import csTimer Backup</h3>
            <p>
              {csPreview.totalSessions} sessions found · {csPreview.totalSolves} solves
            </p>
            <p>
              {csPreview.supportedSessions} sessions supported ·{' '}
              {csPreview.supportedSolves} solves ready to import
            </p>
            <p>
              {csPreview.skippedSessions} sessions contain unknown puzzles ·{' '}
              {csPreview.skippedSolves} solves may be skipped
            </p>
            {csPreview.hasUnknown ? (
              <p role="alert" data-testid="cs-unknown-warning">
                Some sessions may not be imported due to an unknown puzzle.
              </p>
            ) : null}
            <p data-testid="cs-new-sessions-notice">
              Importing creates new sessions. Existing local data is not replaced.
            </p>
            <ul className="cs-preview-sessions" data-testid="cs-preview-sessions">
              {csPreview.sessions.map((s) => (
                <li key={s.index} data-testid="cs-preview-session">
                  <span>{s.name}</span>
                  <span> — {s.scrType}</span>
                  <span> — {s.solveCount} solves</span>
                  <span> — {s.supported ? 'Supported' : 'Unknown puzzle'}</span>
                </li>
              ))}
            </ul>
            <div className="dialog-actions">
              <button
                type="button"
                className="button button-secondary"
                onClick={handleCancelPreview}
                data-testid="cs-preview-cancel"
              >
                Cancel
              </button>
              <button
                type="button"
                className="button button-primary"
                onClick={handleConfirmCsImport}
                disabled={csPreview.supportedSessions === 0}
                data-testid="cs-preview-import"
              >
                Import {csPreview.supportedSessions} sessions
              </button>
            </div>
          </div>
        ) : null}

        {!csPreview ? (
          <div className="dialog-actions">
            <button
              type="button"
              className="button button-secondary"
              onClick={handleClose}
              autoFocus
            >
              Close
            </button>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => fileInputRef.current?.click()}
              disabled={isReading}
              data-testid="import-backup"
            >
              {isReading ? 'Reading…' : 'Import backup'}
            </button>
            <button
              type="button"
              className="button button-primary"
              onClick={() => {
                if (!onExport()) {
                  setError('Could not export the backup.')
                } else {
                  setError(null)
                }
              }}
              disabled={isReading}
              data-testid="export-backup"
            >
              Export backup
            </button>
          </div>
        ) : null}

        <p className="dialog-note">
          Local JSON backups stay on this device. Google Drive synchronization
          is a separate opt-in feature in Settings.
        </p>
      </div> : null}
    </dialog>
  )
}
