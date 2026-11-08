import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { SingleTabGate } from './SingleTabGate'

const lock = { name: 'cubelab-active-tab', mode: 'exclusive' } as Lock
function install(request: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('navigator', { locks: { request } })
}
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('never mounts children without ownership, then releases ownership on unmount', async () => {
  let grant: ((lock: Lock) => Promise<void>) | undefined
  const request = vi.fn((_name, options, callback) => {
    if (options.ifAvailable) return Promise.resolve(callback(null))
    grant = callback
    return new Promise(() => {})
  })
  install(request)
  const view = render(<SingleTabGate><div>Editable app</div></SingleTabGate>)
  await screen.findByTestId('single-tab-waiting')
  expect(screen.queryByText('Editable app')).toBeNull()
  let held: Promise<void> | undefined
  act(() => { held = grant!(lock) })
  expect(screen.getByText('Editable app')).toBeInTheDocument()
  view.unmount()
  await expect(held).resolves.toBeUndefined()
  expect(request.mock.calls[1]![1].signal.aborted).toBe(true)
})

it('does not mount recovery/application content when coordination is unavailable', async () => {
  vi.stubGlobal('navigator', {})
  render(<SingleTabGate><div>Editable app</div></SingleTabGate>)
  await screen.findByTestId('single-tab-unavailable')
  expect(screen.queryByText('Editable app')).toBeNull()
})

it('retries rejected requests', async () => {
  const request = vi.fn().mockRejectedValueOnce(new Error('Unavailable'))
    .mockImplementation((_name, _options, callback) => Promise.resolve(callback(lock)))
  install(request)
  render(<SingleTabGate><div>Editable app</div></SingleTabGate>)
  await screen.findByTestId('single-tab-unavailable')
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  await screen.findByText('Editable app')
})

it('aborts pending requests on unmount and ignores a late callback', async () => {
  let callback: ((lock: Lock) => unknown) | undefined
  const request = vi.fn((_name, _options, next) => { callback = next; return new Promise(() => {}) })
  install(request)
  const view = render(<SingleTabGate><div>Editable app</div></SingleTabGate>)
  view.unmount()
  expect(request.mock.calls[0]![1].signal).toBeUndefined()
  expect(callback!(lock)).toBeUndefined()
})

it('survives StrictMode cleanup and reacquires before mounting children', async () => {
  const request = vi.fn((_name, options, callback) => Promise.resolve().then(() => {
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    return callback(lock)
  }))
  install(request)
  render(<StrictMode><SingleTabGate><div>Editable app</div></SingleTabGate></StrictMode>)
  await waitFor(() => expect(screen.getByText('Editable app')).toBeInTheDocument())
  expect(request).toHaveBeenCalledTimes(2)
  expect(request.mock.calls[0]![1].signal).toBeUndefined()
})
