import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, renderHook, render, screen } from '@testing-library/react'
import { DEFAULT_SETTINGS, loadSessions, loadSessionsForStartup, saveSessions, SESSIONS_STORAGE_KEY, SOLVES_STORAGE_KEY } from './storage'
import { createBackup, parseBackup } from './backup'
import { useSessions } from '../hooks/useSessions'
import { SolveHistory } from '../components/SolveHistory'
import { createMemoryDriveTransport } from './driveTransport'
import { readRemoteBackups } from './remoteBackups'
import { applyPendingCompletionAtStartup, loadPendingCompletion, recordPendingCompletion } from './pendingCompletion'

const now = 1_700_000_000_000
const solve = { id: 'safe-solve', event: '333' as const, rawMs: 12340, penalty: 'none' as const, scramble: 'R U', comment: 'Keep me', createdAt: now }
const data = { activeSessionId: 'safe-session', sessions: [{ id: 'safe-session', name: 'Safe', event: '333' as const, createdAt: now, updatedAt: now, solves: [solve] }] }
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear() })

it('never autosaves a fallback over a collection whose initial read failed', () => {
  saveSessions(data)
  const raw = localStorage.getItem(SESSIONS_STORAGE_KEY)
  const getItem = Storage.prototype.getItem
  let failed = false
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function(this: Storage, key) {
    if (key === SESSIONS_STORAGE_KEY && !failed) { failed = true; throw new Error('Synthetic read failure') }
    return getItem.call(this, key)
  })
  // A failed load may refuse to mount; it must never silently replace history.
  renderHook(() => useSessions(), { onRecoverableError: (error) => {
    expect((error as Error).cause).toEqual(expect.objectContaining({ message: expect.stringContaining('kept') }))
  } })
  expect(localStorage.getItem(SESSIONS_STORAGE_KEY)).toBe(raw)
  expect(loadSessions().sessions[0]?.solves).toEqual([solve])
})

it.each(['solve-created', 'solve-updated', 'session-created', 'session-updated'])('rejects an unrepresentable native %s date before applying any data', (field) => {
  const candidate = structuredClone(data)
  if (field === 'solve-created') candidate.sessions[0]!.solves[0]!.createdAt = 1e20
  if (field === 'solve-updated') Object.assign(candidate.sessions[0]!.solves[0]!, { updatedAt: 1e20 })
  if (field === 'session-created') candidate.sessions[0]!.createdAt = 1e20
  if (field === 'session-updated') candidate.sessions[0]!.updatedAt = 1e20
  const result = parseBackup(JSON.stringify(createBackup(candidate, DEFAULT_SETTINGS)))
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.error).toMatch(/date/i)
})

it('accepts the exact positive JavaScript Date boundary', () => {
  const candidate = structuredClone(data)
  candidate.sessions[0]!.solves[0]!.createdAt = 8_640_000_000_000_000
  expect(parseBackup(JSON.stringify(createBackup(candidate, DEFAULT_SETTINGS))).ok).toBe(true)
})

it('renders a defensive fallback for an invalid in-memory history date', () => {
  const scrollTo = HTMLElement.prototype.scrollTo
  HTMLElement.prototype.scrollTo = vi.fn()
  render(<SolveHistory solves={[{ ...solve, createdAt: 1e20 }]} onSetPenalty={vi.fn()} onDelete={vi.fn()} onSetComment={vi.fn()} onNotify={vi.fn()} />)
  expect(screen.getByText('Unknown date')).toBeInTheDocument()
  expect(document.querySelector('time')?.hasAttribute('datetime')).toBe(false)
  HTMLElement.prototype.scrollTo = scrollTo
})

it('passes the checked startup snapshot into hooks without reading the collection twice', () => {
  saveSessions(data)
  const read = vi.spyOn(Storage.prototype, 'getItem')
  const snapshot = loadSessionsForStartup()
  const { result } = renderHook(() => useSessions(snapshot))
  expect(result.current.sessions[0]?.solves).toEqual([solve])
  expect(read.mock.calls.filter(([key]) => key === SESSIONS_STORAGE_KEY)).toHaveLength(1)
})

it.each(['{broken json', JSON.stringify({ version: 999, ...data })])('keeps unsupported or malformed startup bytes intact', (raw) => {
  localStorage.setItem(SESSIONS_STORAGE_KEY, raw)
  expect(() => loadSessionsForStartup()).toThrow(/kept/)
  expect(localStorage.getItem(SESSIONS_STORAGE_KEY)).toBe(raw)
})

it('keeps a readable legacy record untouched when the current collection read fails', () => {
  localStorage.setItem(SOLVES_STORAGE_KEY, JSON.stringify({ version: 1, solves: [solve] }))
  saveSessions(data)
  const raw = localStorage.getItem(SESSIONS_STORAGE_KEY)
  const original = Storage.prototype.getItem
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function(this: Storage, key) {
    if (key === SESSIONS_STORAGE_KEY) throw new Error('Unavailable')
    return original.call(this, key)
  })
  expect(() => loadSessionsForStartup()).toThrow(/kept/)
  expect(original.call(localStorage, SESSIONS_STORAGE_KEY)).toBe(raw)
})

it('retains a previously stored invalid solve rather than silently dropping it during startup', () => {
  const invalid = { ...data, sessions: [{ ...data.sessions[0]!, solves: [{ ...solve, createdAt: 1e20 }] }] }
  const raw = JSON.stringify({ version: 6, ...invalid })
  localStorage.setItem(SESSIONS_STORAGE_KEY, raw)
  expect(() => loadSessionsForStartup()).toThrow(/invalid date/i)
  expect(localStorage.getItem(SESSIONS_STORAGE_KEY)).toBe(raw)
})

it('retains the completion buffer if the saved collection cannot be read during recovery', () => {
  saveSessions(data)
  const completed = { ...data, sessions: [{ ...data.sessions[0]!, solves: [{ ...solve, id: 'buffered' }, solve] }] }
  expect(recordPendingCompletion(data, completed)).toBe(true)
  const before = localStorage.getItem(SESSIONS_STORAGE_KEY)
  const original = Storage.prototype.getItem
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function(this: Storage, key) {
    if (key === SESSIONS_STORAGE_KEY) throw new Error('Unavailable')
    return original.call(this, key)
  })
  expect(applyPendingCompletionAtStartup().ok).toBe(false)
  expect(original.call(localStorage, SESSIONS_STORAGE_KEY)).toBe(before)
  expect(loadPendingCompletion().status).toBe('ok')
})

it('rejects an invalid-date downloaded snapshot through the real backup reader', async () => {
  const transport = createMemoryDriveTransport()
  await transport.connect()
  const invalid = { ...data, sessions: [{ ...data.sessions[0]!, solves: [{ ...solve, createdAt: 1e20 }] }] }
  await transport.uploadBackup(JSON.stringify(createBackup(invalid, DEFAULT_SETTINGS)))
  await expect(readRemoteBackups(transport)).rejects.toThrow(/date/i)
})
