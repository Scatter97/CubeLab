import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BattleTool } from './BattleTool'
import { generateScramble } from '../lib/scramble'

vi.mock('../lib/scramble', () => ({
  generateScramble: vi.fn(),
  SCRAMBLE_TIMEOUT_MESSAGE: 'Scramble generation timed out.',
}))

class FakeChannel {
  readyState: RTCDataChannelState = 'connecting'
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  sent: string[] = []
  send(value: string) {
    this.sent.push(value)
  }
  close() {
    this.readyState = 'closed'
    this.onclose?.()
  }
  open() {
    this.readyState = 'open'
    this.onopen?.()
  }
}

class FakePeerConnection {
  static latest: FakePeerConnection | null = null
  iceGatheringState: RTCIceGatheringState = 'complete'
  connectionState: RTCPeerConnectionState = 'new'
  localDescription: RTCSessionDescriptionInit | null = null
  ondatachannel: ((event: RTCDataChannelEvent) => void) | null = null
  onconnectionstatechange: (() => void) | null = null
  readonly channel = new FakeChannel()
  constructor() {
    FakePeerConnection.latest = this
  }
  createDataChannel() {
    return this.channel as unknown as RTCDataChannel
  }
  async createOffer() {
    return { type: 'offer' as const, sdp: 'offer-sdp' }
  }
  async createAnswer() {
    return { type: 'answer' as const, sdp: 'answer-sdp' }
  }
  async setLocalDescription(description: RTCSessionDescriptionInit) {
    this.localDescription = description
  }
  async setRemoteDescription() {}
  close() {
    this.connectionState = 'closed'
  }
}

function encodePayload(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

async function connectHost() {
  render(<BattleTool event="333" />)
  const roomId = (screen.getByLabelText('Room ID') as HTMLInputElement).value
  const password = (screen.getByLabelText('Password') as HTMLInputElement).value
  fireEvent.click(screen.getByRole('button', { name: 'Create room' }))
  const answerLabel = await screen.findByLabelText('Answer code from opponent')
  fireEvent.change(answerLabel, {
    target: {
      value: encodePayload({
        v: 1,
        roomId,
        password,
        sdp: { type: 'answer', sdp: 'answer-sdp' },
      }),
    },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
  await screen.findByText('Waiting for the data channel…')
  return FakePeerConnection.latest!
}

describe('BattleTool connection gating', () => {
  beforeEach(() => {
    vi.stubGlobal('RTCPeerConnection', FakePeerConnection)
    vi.mocked(generateScramble).mockResolvedValue("R U R' U' F2 D L2 B' R2 U2")
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.resetAllMocks()
    FakePeerConnection.latest = null
  })

  it('does not offer Start until the data channel is open', async () => {
    const pc = await connectHost()
    expect(
      screen.queryByRole('button', { name: 'New scramble + start' }),
    ).not.toBeInTheDocument()

    act(() => pc.channel.open())
    await waitFor(() =>
      expect(screen.getByTestId('battle-start')).toBeEnabled(),
    )
  })

  it('shows a retryable timeout error and retries on the open channel', async () => {
    const pc = await connectHost()
    act(() => pc.channel.open())
    const scramble = "F R U' R' U' R U R' F'"
    vi.mocked(generateScramble)
      .mockRejectedValueOnce(new Error('Scramble generation timed out.'))
      .mockResolvedValueOnce(scramble)

    fireEvent.click(screen.getByTestId('battle-start'))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(
      'Battle scramble generation timed out. Try again on the same connection.',
    )
    expect(screen.getByTestId('battle-start')).toBeEnabled()
    expect(pc.channel.readyState).toBe('open')
    expect(screen.queryByText(/Opponent disconnected/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('battle-start'))
    await waitFor(() => expect(screen.getByText(scramble)).toBeInTheDocument())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(pc.channel.sent.some((message) => message.includes('"type":"scramble"'))).toBe(
      true,
    )
  })

  it('abandons a scramble preparation when the channel closes', async () => {
    const pc = await connectHost()
    act(() => pc.channel.open())
    const pending = deferred<string>()
    let pendingSignal: AbortSignal | undefined
    vi.mocked(generateScramble).mockImplementationOnce((_event, options) => {
      pendingSignal = options?.signal
      return pending.promise
    })

    fireEvent.click(screen.getByTestId('battle-start'))
    await waitFor(() => expect(generateScramble).toHaveBeenCalled())

    act(() => pc.channel.close())
    expect(pendingSignal?.aborted).toBe(true)
    expect(screen.getByText(/Opponent disconnected/)).toBeInTheDocument()

    await act(async () => {
      pending.resolve('STALE BATTLE SCRAMBLE')
      await Promise.resolve()
    })
    expect(screen.queryByText('STALE BATTLE SCRAMBLE')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'New scramble + start' }),
    ).not.toBeInTheDocument()
  })

  it('stops the running clock on reset and ignores stale race results', async () => {
    const pc = await connectHost()
    act(() => pc.channel.open())
    vi.useFakeTimers()
    fireEvent.click(screen.getByTestId('battle-start'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_100)
    })
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument()

    const start = pc.channel.sent
      .map((message) => JSON.parse(message) as { type: string; raceId?: string })
      .find((message) => message.type === 'start')
    expect(start?.raceId).toBeTruthy()

    act(() => {
      pc.channel.onmessage?.({
        data: JSON.stringify({
          type: 'result',
          rawMs: 1_000,
          raceId: 'abandoned-race',
        }),
      } as MessageEvent)
    })
    expect(screen.queryByText(/Opponent finished/)).not.toBeInTheDocument()

    act(() => {
      pc.channel.onmessage?.({
        data: JSON.stringify({ type: 'reset', raceId: start!.raceId }),
      } as MessageEvent)
    })
    expect(
      screen.queryByRole('button', { name: 'Stop' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByText('Race reset. Waiting for a scramble.'),
    ).toBeInTheDocument()

    // A late start from the abandoned race must not begin a new countdown.
    act(() => {
      pc.channel.onmessage?.({
        data: JSON.stringify({ type: 'start', raceId: 'abandoned-race' }),
      } as MessageEvent)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_100)
    })
    expect(
      screen.queryByRole('button', { name: 'Stop' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByText('Race reset. Waiting for a scramble.'),
    ).toBeInTheDocument()
  })

  it('stops an active race cleanly when the channel closes', async () => {
    const pc = await connectHost()
    act(() => pc.channel.open())
    vi.useFakeTimers()
    fireEvent.click(screen.getByTestId('battle-start'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_100)
    })
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument()

    act(() => pc.channel.close())
    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument()
    expect(screen.getByText(/race was stopped/)).toBeInTheDocument()
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}
