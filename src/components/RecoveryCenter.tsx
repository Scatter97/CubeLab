import { useEffect, useRef, useState } from 'react'
import type { RecoveryStorage } from '../lib/recoveryPackage'
import {
  createRecoveryPackage,
  recoveryPackageFileName,
  resetLocalDataAfterRecoveryExport,
  restoreVerifiedUpgradeArchive,
  type RecoveryPackage,
} from '../lib/recoveryPackage'
import {
  inspectRecoveryStatus,
  type RecoveryInspection,
  type RecoveryStoreStatus,
} from '../lib/recoveryStatus'
import type { UpgradeArchiveRecord } from '../lib/upgradeArchive'

export interface RecoveryFailureInfo {
  kind: string
  message: string
}

export interface RecoveryCenterProps {
  failure: RecoveryFailureInfo
  busy: boolean
  onRetry: () => void
  storage?: RecoveryStorage | null
}

function defaultStorage(): RecoveryStorage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null
    return window.localStorage
  } catch {
    return null
  }
}

function downloadText(contents: string, fileName: string): void {
  const blob = new Blob([contents], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

function storeStateLabel(state: RecoveryStoreStatus['state']): string {
  switch (state) {
    case 'ok':
      return 'Readable'
    case 'absent':
      return 'Not present'
    case 'blocked':
      return 'Blocked'
    default:
      return 'Unavailable'
  }
}

function archiveTitle(archive: UpgradeArchiveRecord): string {
  const date = new Date(archive.createdAt)
  const when = Number.isNaN(date.getTime())
    ? 'Unknown date'
    : date.toLocaleString()
  return `${archive.reason.replace(/-/g, ' ')} · ${when}`
}

export function RecoveryCenter({
  failure,
  busy,
  onRetry,
  storage = defaultStorage(),
}: RecoveryCenterProps) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [inspection, setInspection] = useState<RecoveryInspection | null>(null)
  const [inspectionError, setInspectionError] = useState<string | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [exportPrepared, setExportPrepared] = useState(false)
  const [acknowledgedPackage, setAcknowledgedPackage] =
    useState<RecoveryPackage | null>(null)
  const [exportMessage, setExportMessage] = useState<string | null>(null)
  const [savedAcknowledged, setSavedAcknowledged] = useState(false)
  const [resetConfirmation, setResetConfirmation] = useState('')
  const [confirmRestoreId, setConfirmRestoreId] = useState<string | null>(null)
  const [restoreMessage, setRestoreMessage] = useState<string | null>(null)
  const [restoring, setRestoring] = useState(false)
  const [resetMessage, setResetMessage] = useState<string | null>(null)

  const refreshInspection = async () => {
    try {
      const next = await inspectRecoveryStatus(storage)
      setInspection(next)
      setInspectionError(null)
    } catch (error) {
      setInspectionError(
        error instanceof Error
          ? error.message
          : 'Recovery information could not be inspected.',
      )
    }
  }

  useEffect(() => {
    headingRef.current?.focus()
    let cancelled = false
    void inspectRecoveryStatus(storage)
      .then((next) => {
        if (cancelled) return
        setInspection(next)
        setInspectionError(null)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setInspectionError(
          error instanceof Error
            ? error.message
            : 'Recovery information could not be inspected.',
        )
      })
    return () => {
      cancelled = true
    }
  }, [storage])

  const prepareExport = (): RecoveryPackage | null => {
    if (!storage) {
      setExportMessage(
        'Browser storage is unavailable, so a recovery copy cannot be prepared here.',
      )
      setExportPrepared(false)
      setAcknowledgedPackage(null)
      return null
    }
    try {
      const pkg = createRecoveryPackage(storage, {
        failureKind: failure.kind,
        failureMessage: failure.message,
        archives: inspection?.archives ?? [],
      })
      downloadText(JSON.stringify(pkg, null, 2), recoveryPackageFileName())
      setSavedAcknowledged(false)
      if ((pkg.unreadableKeys?.length ?? 0) > 0) {
        setExportPrepared(false)
        setAcknowledgedPackage(null)
        setExportMessage(
          `An incomplete recovery copy was downloaded. ${pkg.unreadableKeys!.length} data record(s) could not be read (${pkg.unreadableKeys!.join(', ')}). Reset is blocked; keep this partial copy and retry after storage recovers.`,
        )
        return pkg
      }
      setExportPrepared(true)
      setAcknowledgedPackage(pkg)
      setExportMessage(
        'Recovery copy prepared. The browser started a download; verify that you can open the file before resetting anything.',
      )
      return pkg
    } catch (error) {
      setExportPrepared(false)
      setAcknowledgedPackage(null)
      setExportMessage(
        `The recovery copy could not be prepared. ${
          error instanceof Error ? error.message : 'Nothing was reset.'
        }`,
      )
      return null
    }
  }

  const restoreArchive = async (archive: UpgradeArchiveRecord) => {
    if (!storage || !inspection?.archiveStore) {
      setRestoreMessage(
        'The verified local archive store is not available in this context.',
      )
      return
    }
    setRestoring(true)
    setRestoreMessage(null)
    try {
      const result = await restoreVerifiedUpgradeArchive({
        archive,
        storage,
        archiveStore: inspection.archiveStore,
      })
      setRestoreMessage(result.message)
      setConfirmRestoreId(null)
      if (result.ok) await refreshInspection()
    } catch (error) {
      setRestoreMessage(
        error instanceof Error
          ? error.message
          : 'The archive could not be restored.',
      )
    } finally {
      setRestoring(false)
    }
  }

  const resetAndStartFresh = () => {
    if (!storage) return
    if (
      !exportPrepared ||
      !acknowledgedPackage ||
      !savedAcknowledged ||
      resetConfirmation !== 'RESET CUBELAB'
    ) {
      setResetMessage(
        'Prepare a recovery copy, confirm you can access it, and type RESET CUBELAB exactly.',
      )
      return
    }
    const result = resetLocalDataAfterRecoveryExport(
      storage,
      acknowledgedPackage,
    )
    if (!result.ok) {
      if (result.reason === 'unreadable') {
        setExportPrepared(false)
        setAcknowledgedPackage(null)
        setResetMessage(
          `Reset blocked because ${result.failed.length} data record(s) could not be read. Nothing was removed; the unreadable records were left in place. Retry after storage recovers, then prepare a fresh recovery copy.`,
        )
      } else if (result.reason === 'changed') {
        setExportPrepared(false)
        setAcknowledgedPackage(null)
        setSavedAcknowledged(false)
        setResetMessage(
          'Reset blocked because the local data no longer matches the recovery copy you acknowledged. Nothing was removed. Download a fresh recovery copy, confirm you can access it, then type the confirmation again.',
        )
      } else {
        setResetMessage(
          `Reset incomplete. ${result.failed.length} record(s) could not be removed; the recovery copy was downloaded. Reload and retry, or export again before changing anything.`,
        )
      }
      return
    }
    setResetMessage(
      'Local CubeLab data was removed. Verified upgrade archives, browser caches, the service worker and all Google Drive files were kept. Reloading…',
    )
    window.setTimeout(() => window.location.reload(), 50)
  }

  const blockedStores = inspection?.stores.filter(
    (store) => store.state === 'blocked' || store.state === 'unavailable',
  )
  const archived = inspection?.archives ?? []

  return (
    <main className="startup-recovery" data-testid="startup-recovery">
      <section
        className="startup-recovery-card recovery-center"
        aria-labelledby="recovery-heading"
      >
        <h1 id="recovery-heading" ref={headingRef} tabIndex={-1}>
          Recovery required
        </h1>
        <p className="recovery-lead">{failure.message}</p>
        <p className="startup-recovery-note">
          Sessions, imports and timing controls stay closed. Nothing in the
          affected records is changed until you explicitly choose an action
          below. Google Drive is never modified automatically.
        </p>

        <div className="recovery-actions" role="group" aria-label="Recovery actions">
          <button
            type="button"
            className="primary-button"
            data-testid="startup-recovery-retry"
            onClick={onRetry}
            disabled={busy}
          >
            {busy ? 'Retrying…' : 'Retry recovery'}
          </button>
          <button
            type="button"
            className="secondary-button"
            data-testid="recovery-download"
            onClick={() => {
              prepareExport()
            }}
          >
            Download recovery copy
          </button>
          <button
            type="button"
            className="secondary-button"
            aria-expanded={detailsOpen}
            aria-controls="recovery-information"
            onClick={() => setDetailsOpen((open) => !open)}
          >
            {detailsOpen ? 'Hide recovery information' : 'View recovery information'}
          </button>
        </div>

        <p className="recovery-status" role="status" aria-live="polite">
          {exportMessage}
        </p>
        {inspectionError ? (
          <p className="recovery-error" role="alert">
            {inspectionError}
          </p>
        ) : null}

        {detailsOpen ? (
          <div id="recovery-information" className="recovery-information">
            <h2>Affected stores</h2>
            {inspection?.storageAvailable === false ? (
              <p className="recovery-error">
                Browser storage is unavailable. The raw records cannot be read
                or exported in this context.
              </p>
            ) : null}
            {inspection ? (
              <ul className="recovery-store-list">
                {inspection.stores.map((store) => (
                  <li key={store.key}>
                    <strong>{store.label}</strong>{' '}
                    <span data-state={store.state}>{storeStateLabel(store.state)}</span>
                    <span className="recovery-version">
                      {store.version === null ? '' : ` · schema v${store.version}`}
                    </span>
                    <p>{store.message}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p>Reading the affected stores…</p>
            )}
            {blockedStores && blockedStores.length === 0 ? (
              <p>The individual stores now validate; retry startup recovery.</p>
            ) : null}
            <h2>Verified local archives</h2>
            {inspection?.archiveError ? (
              <p className="recovery-error">{inspection.archiveError}</p>
            ) : archived.length === 0 ? (
              <p>No verified local recovery archive is available.</p>
            ) : (
              <ul className="recovery-archive-list">
                {archived.map((archive) => (
                  <li key={archive.id}>
                    <strong>{archiveTitle(archive)}</strong>
                    <span> · {archive.status}</span>
                    <p>
                      {archive.includedKeys.join(', ')} · app {archive.appVersion}
                    </p>
                    {confirmRestoreId === archive.id ? (
                      <div
                        className="recovery-confirm"
                        role="group"
                        aria-label="Confirm archive restore"
                      >
                        <p>
                          This replaces the current sessions, legacy solve
                          history and settings with the exact archived bytes.
                          Training, synchronization provenance and Google Drive
                          are not touched. A new pre-restore archive is created
                          first.
                        </p>
                        <button
                          type="button"
                          className="primary-button"
                          disabled={restoring}
                          onClick={() => void restoreArchive(archive)}
                        >
                          {restoring ? 'Restoring…' : 'Confirm archive restore'}
                        </button>
                        <button
                          type="button"
                          className="secondary-button"
                          disabled={restoring}
                          onClick={() => setConfirmRestoreId(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => setConfirmRestoreId(archive.id)}
                      >
                        Preview and restore this archive
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <p className="recovery-status" role="status" aria-live="polite">
              {restoreMessage}
            </p>
          </div>
        ) : null}

        <div className="recovery-danger-zone">
          <h2>Export and start fresh</h2>
          <p>
            This removes local CubeLab sessions, settings, Training history,
            synchronization provenance and pending recovery records. It keeps
            verified upgrade archives, browser caches, the service worker and
            every Google Drive file. It is irreversible without an independent
            backup.
          </p>
          <p>
            A browser download starting is not proof that the file was saved.
            Open and keep the downloaded recovery copy somewhere you can access
            after this page reloads.
          </p>
          <label className="recovery-check">
            <input
              type="checkbox"
              checked={savedAcknowledged}
              onChange={(event) => setSavedAcknowledged(event.target.checked)}
            />
            I saved the recovery copy and can access it independently.
          </label>
          <label className="recovery-confirm-field">
            Type <code>RESET CUBELAB</code> to confirm
            <input
              type="text"
              value={resetConfirmation}
              onChange={(event) => setResetConfirmation(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              aria-label="Type RESET CUBELAB to confirm export and reset"
            />
          </label>
          <button
            type="button"
            className="danger-button"
            data-testid="recovery-reset"
            onClick={resetAndStartFresh}
            disabled={
              !exportPrepared ||
              !savedAcknowledged ||
              resetConfirmation !== 'RESET CUBELAB'
            }
          >
            Start fresh with the saved recovery copy
          </button>
          <p className="recovery-error" role="status" aria-live="assertive">
            {resetMessage}
          </p>
        </div>
      </section>
    </main>
  )
}
