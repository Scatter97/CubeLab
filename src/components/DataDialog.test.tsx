import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Backup } from '../lib/backup'
import { createBackup, serializeBackup } from '../lib/backup'
import { DEFAULT_SETTINGS } from '../lib/storage'
import { gzipBytes } from '../lib/portableBackup'
import { closedTrainingHistory } from '../lib/training/persistenceFixtures.test-support'
import type { Session } from '../types'
import { DataDialog } from './DataDialog'

beforeEach(() => {
  localStorage.clear()
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: vi.fn(function (this: HTMLDialogElement) {
      this.open = true
    }),
  })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: vi.fn(function (this: HTMLDialogElement) {
      this.open = false
    }),
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function session(id: string, name: string): Session {
  return {
    id,
    name,
    event: '333',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    solves: [],
  }
}

function renderDataDialog(input: {
  sessions?: readonly Session[]
  trainingData?: ReturnType<typeof closedTrainingHistory> | null
  trainingUnreadable?: boolean
  trainingIncluded?: boolean
  trainingExportBlockedReason?: string | null
  trainingImportBlockedReason?: string | null
  onImport?: (backup: Backup) => void
  onExport?: () => Promise<{ ok: true } | { ok: false; error: string }>
} = {}) {
  return render(
    <DataDialog
      open
      sessions={input.sessions ?? []}
      sessionCount={input.sessions?.length ?? 0}
      solveCount={0}
      trainingData={input.trainingData}
      trainingUnreadable={input.trainingUnreadable}
      trainingIncluded={
        input.trainingIncluded ??
        (input.trainingData !== undefined && input.trainingData !== null)
      }
      trainingExportBlockedReason={input.trainingExportBlockedReason}
      trainingImportBlockedReason={input.trainingImportBlockedReason}
      onClose={vi.fn()}
      onExport={input.onExport ?? (async () => ({ ok: true }))}
      onImport={input.onImport ?? vi.fn()}
    />,
  )
}

function fileWithBytes(
  bytes: Uint8Array,
  name: string,
  type = 'application/json',
): File {
  const file = new File([bytes as BlobPart], name, { type })
  Object.defineProperty(file, 'arrayBuffer', {
    configurable: true,
    value: async () => bytes.slice().buffer,
  })
  return file
}

function textFile(raw: string, name = 'cstimer.json', type = 'application/json'): File {
  return fileWithBytes(new TextEncoder().encode(raw), name, type)
}

async function chooseFile(raw: string) {
  fireEvent.change(screen.getByTestId('backup-file-input'), {
    target: { files: [textFile(raw)] },
  })
  return screen.findByTestId('cs-preview')
}

describe('backup export feedback', () => {
  it('shows an accurate output-limit error and keeps the dialog open', async () => {
    renderDataDialog({
      onExport: async () => ({
        ok: false,
        error:
          'Backup not exported: The complete backup is 10.5 MB; CubeLab\'s 10.00 MB backup limit was exceeded.',
      }),
    })

    fireEvent.click(screen.getByTestId('export-backup'))
    expect(await screen.findByTestId('backup-error')).toHaveTextContent(
      'Backup not exported',
    )
    expect(screen.getByTestId('backup-error')).toHaveTextContent(
      'backup limit was exceeded',
    )
  })

  it('shows a busy state while an asynchronous export runs', async () => {
    let resolveExport!: (value: { ok: true }) => void
    const pending = new Promise<{ ok: true }>((resolve) => {
      resolveExport = resolve
    })
    renderDataDialog({ onExport: () => pending })

    fireEvent.click(screen.getByTestId('export-backup'))
    const button = screen.getByTestId('export-backup')
    expect(button).toHaveTextContent('Exporting…')
    expect(button).toBeDisabled()
    expect(screen.getByTestId('import-backup')).toBeDisabled()

    resolveExport({ ok: true })
    await waitFor(() => expect(button).toHaveTextContent('Export backup'))
    expect(button).toBeEnabled()
    expect(screen.getByTestId('import-backup')).toBeEnabled()
  })
})

describe('compressed native import', () => {
  it('detects gzip by content and imports a checked backup', async () => {
    const backup = createBackup(
      {
        activeSessionId: 'session-1',
        sessions: [session('session-1', 'Morning')],
      },
      DEFAULT_SETTINGS,
      new Date('2026-11-20T00:00:00.000Z'),
      undefined,
      closedTrainingHistory(),
    )
    const compressed = await gzipBytes(
      new TextEncoder().encode(serializeBackup(backup)),
    )
    const onImport = vi.fn()
    renderDataDialog({ onImport, trainingData: closedTrainingHistory() })

    fireEvent.change(screen.getByTestId('backup-file-input'), {
      target: {
        files: [
          fileWithBytes(
            compressed,
            'cubelab-backup-2026-11-20.json.gz',
            'application/gzip',
          ),
        ],
      },
    })

    await waitFor(() => expect(onImport).toHaveBeenCalledOnce())
    expect(onImport.mock.calls[0]![0]).toEqual(backup)
  })

  it('reports corrupt compressed files without attempting a csTimer import', async () => {
    const onImport = vi.fn()
    renderDataDialog({ onImport })
    fireEvent.change(screen.getByTestId('backup-file-input'), {
      target: {
        files: [
          fileWithBytes(
            new Uint8Array([0x1f, 0x8b, 0x00, 0x00, 0x00]),
            'broken.json.gz',
            'application/gzip',
          ),
        ],
      },
    })

    expect(await screen.findByTestId('backup-error')).toHaveTextContent(
      'corrupt or incomplete',
    )
    expect(onImport).not.toHaveBeenCalled()
    expect(screen.queryByTestId('cs-preview')).toBeNull()
  })
})

describe('Training backup copy', () => {
  it('shows local Training counts and inclusion wording', () => {
    renderDataDialog({ trainingData: closedTrainingHistory() })
    expect(screen.getByTestId('data-training-summary')).toHaveTextContent(
      'Training: 1 attempt · 1 session · 1 calibration',
    )
    expect(screen.getByTestId('data-training-range')).toHaveTextContent(
      'Attempts',
    )
    expect(screen.getByTestId('training-backup-note')).toHaveTextContent(
      'Training history is included in new backups',
    )
    expect(screen.getByTestId('training-backup-note')).toHaveTextContent(
      'Large backups are compressed automatically',
    )
  })

  it('states when no Training history exists', () => {
    renderDataDialog({ trainingData: null })
    expect(screen.getByTestId('data-training-summary')).toHaveTextContent(
      'No Training history yet',
    )
    expect(screen.getByTestId('training-backup-note')).toHaveTextContent(
      'new backups omit it',
    )
  })

  it('explains why Training is not currently exportable', () => {
    renderDataDialog({
      trainingData: closedTrainingHistory(),
      trainingIncluded: false,
      trainingExportBlockedReason: 'An active Training session is open.',
    })
    expect(screen.getByTestId('data-training-summary')).toHaveTextContent(
      'Training: 1 attempt',
    )
    expect(screen.getByTestId('training-backup-note')).toHaveTextContent(
      'not currently exportable: An active Training session is open.',
    )
  })

  it('blocks a Training restore while local Training is busy', async () => {
    const onImport = vi.fn()
    const backup = createBackup(
      {
        activeSessionId: 'session-1',
        sessions: [session('session-1', 'Morning')],
      },
      DEFAULT_SETTINGS,
      new Date('2026-11-20T00:00:00.000Z'),
      undefined,
      closedTrainingHistory(),
    )
    renderDataDialog({
      onImport,
      trainingData: closedTrainingHistory(),
      trainingImportBlockedReason: 'An active Training session is open.',
    })

    fireEvent.change(screen.getByTestId('backup-file-input'), {
      target: {
        files: [textFile(serializeBackup(backup), 'backup.json')],
      },
    })

    expect(await screen.findByTestId('backup-error')).toHaveTextContent(
      'An active Training session is open.',
    )
    expect(screen.getByTestId('backup-error')).toHaveTextContent(
      'The backup was not imported.',
    )
    expect(onImport).not.toHaveBeenCalled()
  })
})

describe('csTimer import preview', () => {
  it('shows only final session names and solve counts, including empty sessions', async () => {
    const raw = JSON.stringify({
      session1: [[[0, 1000], 'R U', '', 1700000000]],
      session2: [],
      session3: [],
      properties: {
        sessionData: {
          '1': { name: 14, opt: {}, rank: 1, date: [1700000000] },
          '2': { name: '4x4', opt: {}, rank: 2, date: [1700000000] },
          '3': { name: '8x8', opt: {}, rank: 3, date: [null, null] },
        },
      },
    })

    renderDataDialog()
    const preview = await chooseFile(raw)

    expect(
      screen.getByRole('heading', { name: 'Import csTimer backup' }),
    ).toBeVisible()
    expect(screen.getByTestId('cs-preview-summary')).toHaveTextContent(
      '3 sessions · 1 solve',
    )
    const rows = screen.getAllByTestId('cs-preview-session')
    expect(rows).toHaveLength(3)
    expect(rows.map((row) => row.textContent)).toEqual([
      '141',
      '4x40',
      '8x80',
    ])
    expect(screen.getByRole('button', { name: 'Import 3 sessions' })).toBeEnabled()
    expect(preview).not.toHaveTextContent('Event mappings')
    expect(preview).not.toHaveTextContent('Unknown')
    expect(preview).not.toHaveTextContent('replaced')
    expect(screen.queryByTestId('cs-event-mappings')).toBeNull()
    expect(screen.queryByTestId('cs-skipped-empty-sessions')).toBeNull()
  })

  it('rechecks names and shows the updated list before importing', async () => {
    const raw = JSON.stringify({
      session1: [[[0, 1000], 'R U', '', 1700000000]],
      properties: {
        sessionData: {
          '1': { name: 'Practice', opt: {}, date: [1700000000] },
        },
      },
    })
    const onImport = vi.fn()
    const initial = renderDataDialog({ onImport })
    await chooseFile(raw)
    expect(screen.getByTestId('cs-preview-session')).toHaveTextContent(
      'Practice1',
    )

    const existingSession = session('existing', 'Practice')
    initial.rerender(
      <DataDialog
        open
        sessions={[existingSession]}
        sessionCount={1}
        solveCount={0}
          onClose={vi.fn()}
        onExport={async () => ({ ok: true })}
        onImport={onImport}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Import 1 session' }))
    expect(await screen.findByTestId('cs-preview-updated')).toHaveTextContent(
      'names changed',
    )
    expect(screen.getByTestId('cs-preview-session')).toHaveTextContent(
      'Practice(1)1',
    )
    expect(onImport).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Import 1 session' }))
    await waitFor(() => expect(onImport).toHaveBeenCalledOnce())
    const backup = onImport.mock.calls[0]![0] as Backup
    expect(backup.sessions.sessions[0]!.name).toBe('Practice(1)')
  })
})
