import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Backup } from '../lib/backup'
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
  onImport?: (backup: Backup) => void
  onExport?: () => { ok: true } | { ok: false; error: string }
} = {}) {
  return render(
    <DataDialog
      open
      sessions={input.sessions ?? []}
      sessionCount={input.sessions?.length ?? 0}
      solveCount={0}
      customEvents={[]}
      onClose={vi.fn()}
      onExport={input.onExport ?? (() => ({ ok: true }))}
      onImport={input.onImport ?? vi.fn()}
    />,
  )
}

function cstimerFile(raw: string): File {
  const file = new File([raw], 'cstimer.json', {
    type: 'application/json',
  })
  Object.defineProperty(file, 'text', {
    configurable: true,
    value: async () => raw,
  })
  return file
}

async function chooseFile(raw: string) {
  fireEvent.change(screen.getByTestId('backup-file-input'), {
    target: { files: [cstimerFile(raw)] },
  })
  return screen.findByTestId('cs-preview')
}

describe('backup export feedback', () => {
  it('shows an accurate output-limit error and keeps the dialog open', () => {
    renderDataDialog({
      onExport: () => ({
        ok: false,
        error:
          'Backup not exported: The complete backup is 10.5 MB; CubeLab\'s 10.00 MB backup limit was exceeded.',
      }),
    })

    fireEvent.click(screen.getByTestId('export-backup'))
    expect(screen.getByTestId('backup-error')).toHaveTextContent(
      'Backup not exported',
    )
    expect(screen.getByTestId('backup-error')).toHaveTextContent(
      'backup limit was exceeded',
    )
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
        customEvents={[]}
        onClose={vi.fn()}
        onExport={() => ({ ok: true })}
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
