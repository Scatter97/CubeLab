import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from 'react'
import type { Backup } from '../lib/backup'
import { parseBackup } from '../lib/backup'
import {
  MAX_PORTABLE_BACKUP_BYTES,
  readPortableBackupBytes,
} from '../lib/portableBackup'
import {
  summarizeTrainingData,
} from '../lib/training/backupSection'
import type { TrainingData } from '../lib/training/types'
import {
  analyzeCsTimerBackup,
  isCsTimerBackup,
  parseCsTimerBackup,
} from '../lib/csTimerImport'
import type { CsTimerImportPreview } from '../lib/csTimerImport'
import { useModalDialog } from '../hooks/useModalDialog'
import { loadSettings } from '../lib/storage'
import type { Session } from '../types'
import { CubeMark } from './Icons'

interface DataDialogProps {
  open: boolean
  sessions: readonly Session[]
  sessionCount: number
  solveCount: number
  /** Last committed local Training store, or null when it cannot be read. */
  trainingData?: TrainingData | null
  trainingUnreadable?: boolean
  /** True only when a new native backup would include Training. */
  trainingIncluded?: boolean
  /** Non-null when Training currently prevents a complete native export. */
  trainingExportBlockedReason?: string | null
  /** Non-null when local Training must be finished before a Training restore. */
  trainingImportBlockedReason?: string | null
  onClose: () => void
  onExport: () => Promise<{ ok: true } | { ok: false; error: string }>
  onImport: (backup: Backup) => void
}

const countFormatter = new Intl.NumberFormat('en-US')
const trainingDateFormatter = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
})

function formatCount(count: number): string {
  return countFormatter.format(count)
}

function formatTrainingRange(
  first: number | null,
  last: number | null,
): string | null {
  if (first === null || last === null) return null
  const from = trainingDateFormatter.format(new Date(first))
  const to = trainingDateFormatter.format(new Date(last))
  return from === to ? `Attempts on ${from}` : `Attempts ${from} – ${to}`
}

function plural(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? singular : pluralForm
}

function previewIdentity(preview: CsTimerImportPreview): string {
  return preview.sessions
    .map(
      (session) =>
        `${session.sessionNumber}\u0000${session.name}\u0000${session.solveCount}`,
    )
    .join('\u0001')
}

export function DataDialog({
  open,
  sessions,
  sessionCount,
  solveCount,
  trainingData = null,
  trainingUnreadable = false,
  trainingIncluded = false,
  trainingExportBlockedReason = null,
  trainingImportBlockedReason = null,
  onClose,
  onExport,
  onImport,
}: DataDialogProps) {
  const { dialogRef, handleKeyDown } = useModalDialog(open)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const importBackupRef = useRef<HTMLButtonElement>(null)
  const previewScrollRef = useRef<HTMLDivElement>(null)
  const hadPreviewRef = useRef(false)
  const readIdRef = useRef(0)
  const [error, setError] = useState<string | null>(null)
  const [isReading, setIsReading] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [csPreview, setCsPreview] = useState<CsTimerImportPreview | null>(null)
  const [csRaw, setCsRaw] = useState<string | null>(null)
  const [previewNotice, setPreviewNotice] = useState<string | null>(null)

  const previewOpen = csPreview !== null
  const busy = isReading || isExporting
  const localTraining = trainingData
    ? summarizeTrainingData(trainingData)
    : null

  useEffect(() => {
    if (previewOpen) {
      hadPreviewRef.current = true
      previewScrollRef.current?.focus()
      return
    }
    if (hadPreviewRef.current && open) {
      hadPreviewRef.current = false
      importBackupRef.current?.focus()
    }
  }, [open, previewOpen])

  const handleClose = () => {
    readIdRef.current += 1
    setError(null)
    setIsReading(false)
    setIsExporting(false)
    setCsPreview(null)
    setCsRaw(null)
    setPreviewNotice(null)
    onClose()
  }

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setError(null)
    setPreviewNotice(null)
    if (file.size > MAX_PORTABLE_BACKUP_BYTES) {
      setError('That backup file is larger than 16 MB.')
      return
    }

    const readId = readIdRef.current + 1
    readIdRef.current = readId
    setIsReading(true)
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      if (readId !== readIdRef.current) return
      const portable = await readPortableBackupBytes(bytes)
      if (readId !== readIdRef.current) return
      if (!portable.ok) {
        setError(portable.error)
        return
      }
      const raw = portable.raw

      const result = parseBackup(raw)
      if (!result.ok) {
        // A compressed file is never treated as a csTimer payload.
        if (!portable.compressed && isCsTimerBackup(raw)) {
          const analyzed = analyzeCsTimerBackup(raw, {
            existingSessionNames: sessions.map((session) => session.name),
          })
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
      if (result.backup.training && trainingImportBlockedReason) {
        setError(
          `Training history cannot be replaced yet: ${trainingImportBlockedReason} The backup was not imported.`,
        )
        return
      }
      onImport(result.backup)
    } catch {
      if (readId === readIdRef.current) setError('Could not read that file.')
    } finally {
      if (readId === readIdRef.current) setIsReading(false)
    }
  }

  const handleExport = async () => {
    if (busy) return
    setError(null)
    setPreviewNotice(null)
    setIsExporting(true)
    try {
      const result = await onExport()
      setError(result.ok ? null : result.error)
    } catch {
      setError('Backup not exported: the backup could not be created.')
    } finally {
      setIsExporting(false)
    }
  }

  const handleConfirmCsImport = () => {
    if (!csRaw || !csPreview) return
    const result = parseCsTimerBackup(csRaw, loadSettings(), {
      existingSessionNames: sessions.map((session) => session.name),
    })
    if (!result.ok) {
      setError(result.error)
      setCsPreview(null)
      setCsRaw(null)
      setPreviewNotice(null)
      return
    }

    // Local data may have changed while the preview was open. Never apply a
    // different set of names silently: show the updated list for another look.
    if (previewIdentity(result.preview) !== previewIdentity(csPreview)) {
      setCsPreview(result.preview)
      setPreviewNotice(
        'Some session names changed to avoid conflicts with your current sessions. Review the updated list, then import again.',
      )
      return
    }

    setError(null)
    setCsPreview(null)
    setCsRaw(null)
    setPreviewNotice(null)
    onImport(result.backup)
  }

  const handleCancelPreview = () => {
    setCsPreview(null)
    setCsRaw(null)
    setPreviewNotice(null)
  }

  return (
    <dialog
      ref={dialogRef}
      className={`confirm-dialog data-dialog${previewOpen ? ' is-cs-preview' : ''}`}
      aria-labelledby={previewOpen ? 'cs-preview-title' : 'data-title'}
      aria-describedby={previewOpen ? 'cs-preview-total' : 'data-description'}
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
      {open ? (
        <div
          className={`dialog-content${previewOpen ? ' cs-preview-content' : ''}`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.json.gz,.gz,.txt,application/json,application/gzip,application/x-gzip,text/plain"
            hidden
            data-testid="backup-file-input"
            onChange={handleFileChange}
          />

          {csPreview ? (
            <div className="cs-preview" data-testid="cs-preview">
              <header className="cs-preview-header">
                <h2 id="cs-preview-title">Import csTimer backup</h2>
                <p
                  id="cs-preview-total"
                  className="cs-preview-total"
                  data-testid="cs-preview-summary"
                >
                  <strong>{formatCount(csPreview.totalSessions)}</strong>{' '}
                  {plural(csPreview.totalSessions, 'session', 'sessions')}
                  <span aria-hidden="true"> · </span>
                  <strong>{formatCount(csPreview.totalSolves)}</strong>{' '}
                  {plural(csPreview.totalSolves, 'solve', 'solves')}
                </p>
              </header>

              <div
                ref={previewScrollRef}
                className="cs-preview-scroll"
                role="region"
                aria-label="Sessions in this csTimer backup"
                tabIndex={0}
              >
                <table className="cs-preview-table">
                  <caption className="sr-only">
                    Session names and solve counts in this csTimer backup
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Session</th>
                      <th scope="col" className="cs-preview-count">
                        Solves
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {csPreview.sessions.map((session) => (
                      <tr
                        key={`${session.sessionNumber}-${session.index}`}
                        data-testid="cs-preview-session"
                      >
                        <th scope="row" title={session.name}>
                          <span className="cs-preview-name">
                            {session.name}
                          </span>
                        </th>
                        <td className="cs-preview-count">
                          {formatCount(session.solveCount)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {previewNotice ? (
                <p
                  className="cs-preview-notice"
                  role="status"
                  data-testid="cs-preview-updated"
                >
                  {previewNotice}
                </p>
              ) : null}

              <div className="dialog-actions cs-preview-actions">
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
                  disabled={csPreview.totalSessions === 0}
                  data-testid="cs-preview-import"
                >
                  Import {formatCount(csPreview.totalSessions)}{' '}
                  {plural(csPreview.totalSessions, 'session', 'sessions')}
                </button>
              </div>
            </div>
          ) : (
            <>
              <span className="dialog-icon is-neutral" aria-hidden="true">
                <CubeMark size={24} />
              </span>
              <h2 id="data-title">Your local data</h2>
              <p id="data-description">
                Export every session, setting and available Training history, or
                restore a CubeLab backup. Importing replaces local sessions after
                confirmation. Large backups are compressed automatically.
              </p>

              <div className="data-summary" aria-label="Current local data">
                <span>
                  <strong>{sessionCount}</strong>{' '}
                  {plural(sessionCount, 'session', 'sessions')}
                </span>
                <span>
                  <strong>{solveCount}</strong>{' '}
                  {plural(solveCount, 'solve', 'solves')}
                </span>
                <span>Settings included</span>
                {localTraining ? (
                  <span data-testid="data-training-summary">
                    Training: {formatCount(localTraining.attempts)}{' '}
                    {plural(localTraining.attempts, 'attempt', 'attempts')} ·{' '}
                    {formatCount(localTraining.sessions)}{' '}
                    {plural(localTraining.sessions, 'session', 'sessions')} ·{' '}
                    {formatCount(localTraining.calibrations)}{' '}
                    {plural(
                      localTraining.calibrations,
                      'calibration',
                      'calibrations',
                    )}
                  </span>
                ) : (
                  <span data-testid="data-training-summary">
                    {trainingUnreadable
                      ? 'Training history unreadable'
                      : 'No Training history yet'}
                  </span>
                )}
                {localTraining &&
                localTraining.firstAttemptAt !== null &&
                localTraining.lastAttemptAt !== null ? (
                  <span data-testid="data-training-range">
                    {formatTrainingRange(
                      localTraining.firstAttemptAt,
                      localTraining.lastAttemptAt,
                    )}
                  </span>
                ) : null}
              </div>

              {error ? (
                <p className="data-error" role="alert" data-testid="backup-error">
                  {error}
                </p>
              ) : null}

              <div className="dialog-actions">
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={handleClose}
                  disabled={busy}
                  autoFocus
                >
                  Close
                </button>
                <button
                  ref={importBackupRef}
                  type="button"
                  className="button button-secondary"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={busy}
                  data-testid="import-backup"
                >
                  {isReading ? 'Reading…' : 'Import backup'}
                </button>
                <button
                  type="button"
                  className="button button-primary"
                  onClick={() => {
                    void handleExport()
                  }}
                  disabled={busy}
                  aria-busy={isExporting}
                  data-testid="export-backup"
                >
                  {isExporting ? 'Exporting…' : 'Export backup'}
                </button>
              </div>

              <p className="dialog-note" data-testid="training-backup-note">
                {trainingUnreadable && !localTraining
                  ? 'Training history is unreadable, so a complete backup is blocked until it is recovered. Local JSON backups stay on this device.'
                  : trainingExportBlockedReason
                    ? `Training history is not currently exportable: ${trainingExportBlockedReason}`
                    : trainingIncluded
                      ? 'Training history is included in new backups. Local JSON backups stay on this device.'
                      : 'No Training history exists yet, so new backups omit it. Local JSON backups stay on this device.'}{' '}
                Large backups are compressed automatically. The file can be
                restored by a current CubeLab build. Google Drive synchronization
                is a separate opt-in feature in Settings.
              </p>
            </>
          )}
        </div>
      ) : null}
    </dialog>
  )
}
