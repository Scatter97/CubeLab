import { useEffect, useState } from 'react'
import { loadDriveBackupState, type DriveBackupState } from '../lib/driveStorage'
import {
  createRecoveryPackage,
  recoveryPackageFileName,
} from '../lib/recoveryPackage'
import {
  openDefaultUpgradeArchiveStore,
  listUpgradeArchives,
  type UpgradeArchiveRecord,
} from '../lib/upgradeArchive'
import {
  readStorageHealth,
  requestStoragePersistence,
  type StorageHealth,
} from '../lib/storagePersistence'

export interface StorageHealthPanelProps {
  storageOk: boolean
  lastSyncAt: number | null
}

function formatBytes(value: number | null): string {
  if (value === null) return 'Not reported'
  if (value < 1024) return `${value} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let amount = value
  let unit = 'B'
  for (const candidate of units) {
    if (amount < 1024) break
    amount /= 1024
    unit = candidate
  }
  return `${amount.toFixed(amount >= 10 ? 0 : 1)} ${unit}`
}

function formatTimestamp(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 'Not recorded'
  }
  return new Date(value).toLocaleString()
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

export function StorageHealthPanel({
  storageOk,
  lastSyncAt,
}: StorageHealthPanelProps) {
  const [health, setHealth] = useState<StorageHealth | null>(null)
  const [drive, setDrive] = useState<DriveBackupState>(() =>
    loadDriveBackupState(),
  )
  const [lastArchiveAt, setLastArchiveAt] = useState<number | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [requesting, setRequesting] = useState(false)

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      readStorageHealth(),
      (async () => {
        try {
          const store = await openDefaultUpgradeArchiveStore(window.localStorage)
          return await listUpgradeArchives(store)
        } catch {
          return []
        }
      })(),
    ]).then(([nextHealth, archives]) => {
      if (cancelled) return
      setHealth(nextHealth)
      setDrive(loadDriveBackupState())
      setLastArchiveAt(
        archives
          .filter((archive) => archive.status === 'complete')
          .sort((left, right) => right.createdAt - left.createdAt)[0]?.createdAt ??
          null,
      )
    })
    return () => {
      cancelled = true
    }
  }, [])

  const requestPersistence = async () => {
    setRequesting(true)
    try {
      const result = await requestStoragePersistence({ force: true })
      setHealth(result)
      setStatus(
        result.granted === true
          ? 'Persistent storage granted.'
          : result.granted === false
            ? 'The browser did not grant persistent storage. Your data remains subject to browser eviction.'
            : 'Persistent storage could not be requested in this browser.',
      )
    } finally {
      setRequesting(false)
    }
  }

  const exportRecovery = async () => {
    try {
      let archives: UpgradeArchiveRecord[] = []
      try {
        const store = await openDefaultUpgradeArchiveStore(window.localStorage)
        archives = await listUpgradeArchives(store)
      } catch {
        archives = []
      }
      const pkg = createRecoveryPackage(window.localStorage, {
        failureKind: 'settings-export',
        archives,
      })
      downloadText(JSON.stringify(pkg, null, 2), recoveryPackageFileName())
      setStatus(
        'Recovery copy prepared. Verify that the downloaded file is accessible; a started download is not proof that it was saved.',
      )
    } catch (error) {
      setStatus(
        `The recovery copy could not be prepared. ${
          error instanceof Error ? error.message : ''
        }`,
      )
    }
  }

  const usageLabel = formatBytes(health?.usage ?? null)
  const quotaLabel = formatBytes(health?.quota ?? null)
  const storageUseLabel =
    usageLabel === 'Not reported' && quotaLabel === 'Not reported'
      ? 'Not reported'
      : `${usageLabel} of ${quotaLabel}`

  const persistedLabel =
    health === null
      ? 'Checking…'
      : health.persisted === true
        ? 'Granted'
        : health.persisted === false
          ? 'Not granted'
          : health.supported
            ? 'Not reported'
            : 'Not supported'

  return (
    <div className="storage-health" data-testid="storage-health">
      <div className="settings-row">
        <span className="settings-row-label">Persistent storage</span>
        <span
          className={`settings-storage ${
            health?.persisted === true ? 'is-ok' : 'is-error'
          }`}
        >
          {persistedLabel}
        </span>
      </div>
      <p className="storage-health-note">
        Persistence reduces browser-managed eviction. It cannot protect against
        clearing site data, private browsing or storage pressure.
      </p>
      <div className="settings-row">
        <span className="settings-row-label">Browser storage used</span>
        <span>{storageUseLabel}</span>
      </div>
      <div className="settings-row">
        <span className="settings-row-label">Last verified local archive</span>
        <span>{formatTimestamp(lastArchiveAt)}</span>
      </div>
      <div className="settings-row">
        <span className="settings-row-label">Last successful Drive sync</span>
        <span>{formatTimestamp(lastSyncAt)}</span>
      </div>
      <div className="settings-row">
        <span className="settings-row-label">Last Drive backup file</span>
        <span>{formatTimestamp(drive.lastBackupAt)}</span>
      </div>
      <p className="storage-health-note">
        Synchronization is not an independent backup. A successful sync does not
        replace an exported native backup or recovery copy.
      </p>
      {!storageOk ? (
        <p className="settings-error" role="alert">
          Local writes are failing. The last durable state is retained; free
          browser storage before changing data.
        </p>
      ) : null}
      <div className="storage-health-actions">
        <button
          type="button"
          className="settings-data-button"
          onClick={() => void requestPersistence()}
          disabled={requesting || health?.persisted === true}
          data-testid="storage-request-persistence"
        >
          Request persistent storage
        </button>
        <button
          type="button"
          className="settings-data-button"
          onClick={() => void exportRecovery()}
          data-testid="storage-recovery-export"
        >
          Download recovery copy
        </button>
      </div>
      <p className="storage-health-status" role="status" aria-live="polite">
        {status}
      </p>
      <span className="sr-only" aria-live="polite">
        {health?.error ?? ''}
      </span>
    </div>
  )
}
