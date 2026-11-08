import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from 'react'
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
import type { CustomEventDefinition, Session } from '../types'
import { CubeMark } from './Icons'

interface DataDialogProps {
  open: boolean
  sessions: readonly Session[]
  sessionCount: number
  solveCount: number
  customEvents: readonly CustomEventDefinition[]
  onClose: () => void
  onExport: () => { ok: true } | { ok: false; error: string }
  onImport: (backup: Backup) => void
}

const countFormatter = new Intl.NumberFormat('en-US')

function formatCount(count: number): string {
  return countFormatter.format(count)
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
  customEvents,
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
  const [csPreview, setCsPreview] = useState<CsTimerImportPreview | null>(null)
  const [csRaw, setCsRaw] = useState<string | null>(null)
  const [previewNotice, setPreviewNotice] = useState<string | null>(null)

  const previewOpen = csPreview !== null

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
          const analyzed = analyzeCsTimerBackup(raw, {
            existingCustomEvents: customEvents,
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
      onImport(result.backup)
    } catch {
      if (readId === readIdRef.current) setError('Could not read that file.')
    } finally {
      if (readId === readIdRef.current) setIsReading(false)
    }
  }

  const handleConfirmCsImport = () => {
    if (!csRaw || !csPreview) return
    const result = parseCsTimerBackup(csRaw, loadSettings(), {
      existingCustomEvents: customEvents,
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
            accept=".json,.txt,application/json,text/plain"
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
                Export every session and setting as a JSON file, or restore a
                CubeLab backup. Importing replaces local sessions after
                confirmation.
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
                  autoFocus
                >
                  Close
                </button>
                <button
                  ref={importBackupRef}
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
                    const result = onExport()
                    setError(result.ok ? null : result.error)
                  }}
                  disabled={isReading}
                  data-testid="export-backup"
                >
                  Export backup
                </button>
              </div>

              <p className="dialog-note">
                Local JSON backups stay on this device. Google Drive
                synchronization is a separate opt-in feature in Settings.
              </p>
            </>
          )}
        </div>
      ) : null}
    </dialog>
  )
}
