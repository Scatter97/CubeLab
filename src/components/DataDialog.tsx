import { useRef, useState, type ChangeEvent } from 'react'
import type { Backup } from '../lib/backup'
import { MAX_BACKUP_BYTES, parseBackup } from '../lib/backup'
import { useModalDialog } from '../hooks/useModalDialog'
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

  const handleClose = () => {
    readIdRef.current += 1
    setError(null)
    setIsReading(false)
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

  return (
    <dialog
      ref={dialogRef}
      className="confirm-dialog data-dialog"
      aria-labelledby="data-title"
      aria-describedby="data-description"
      onKeyDown={handleKeyDown}
      onCancel={(event) => {
        event.preventDefault()
        handleClose()
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) handleClose()
      }}
    >
      <div className="dialog-content">
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
          accept=".json,application/json"
          hidden
          data-testid="backup-file-input"
          onChange={handleFileChange}
        />

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

        <p className="dialog-note">
          Backups stay on this device. CubeLab never uploads them.
        </p>
      </div>
    </dialog>
  )
}
