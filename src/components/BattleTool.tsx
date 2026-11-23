import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PuzzleEvent } from '../types'
import { copyText } from '../lib/clipboard'
import {
  generateScramble,
  SCRAMBLE_TIMEOUT_MESSAGE,
} from '../lib/scramble'
import { getEventLabel, isUnscrambledEvent } from '../lib/events'

type BattlePhase =
  | 'setup'
  | 'host-offer'
  | 'guest-answer'
  | 'waiting'
  | 'connected'
  | 'countdown'
  | 'racing'
  | 'finished'
  | 'failed'

interface InvitePayload {
  v: 1
  roomId: string
  password: string
  sdp: RTCSessionDescriptionInit
}

type BattleMessage =
  | { type: 'hello' }
  | { type: 'scramble'; event: string; scramble: string; raceId: string }
  | { type: 'start'; raceId: string }
  | { type: 'result'; rawMs: number; raceId: string }
  | { type: 'reset'; raceId: string }

function encodePayload(payload: InvitePayload): string {
  const bytes = new TextEncoder().encode(JSON.stringify(payload))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function decodePayload(raw: string): InvitePayload | null {
  try {
    const binary = atob(raw.trim())
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes))
    if (!value || typeof value !== 'object') return null
    const record = value as Record<string, unknown>
    if (
      record.v !== 1 ||
      typeof record.roomId !== 'string' ||
      typeof record.password !== 'string' ||
      !record.sdp ||
      typeof record.sdp !== 'object'
    ) {
      return null
    }
    return record as unknown as InvitePayload
  } catch {
    return null
  }
}

function randomRoomId(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const values = crypto.getRandomValues(new Uint8Array(6))
  return [...values].map((value) => alphabet[value % alphabet.length]).join('')
}

function randomPassword(): string {
  const values = crypto.getRandomValues(new Uint8Array(4))
  return [...values].map((value) => String(value % 10)).join('')
}

function randomRaceId(): string {
  const values = crypto.getRandomValues(new Uint8Array(8))
  return [...values]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
}

function waitForIceGathering(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve()
  return new Promise((resolve) => {
    const timeout = window.setTimeout(done, 6_000)
    function done() {
      window.clearTimeout(timeout)
      pc.removeEventListener('icegatheringstatechange', check)
      resolve()
    }
    function check() {
      if (pc.iceGatheringState === 'complete') done()
    }
    pc.addEventListener('icegatheringstatechange', check)
  })
}

function formatBattleTime(ms: number): string {
  return `${(ms / 1000).toFixed(2)} s`
}

/**
 * Serverless online battle. Two peers exchange one invitation code and one
 * answer code (manual WebRTC signaling), then race over a direct data channel.
 * Room ID and password gate acceptance of the invitation; they are not a
 * substitute for authenticated encryption. A STUN server is used only for NAT
 * discovery; no CubeLab backend or account is involved.
 */
export function BattleTool({ event }: { event: PuzzleEvent }) {
  const [phase, setPhase] = useState<BattlePhase>('setup')
  const [roomId, setRoomId] = useState(randomRoomId)
  const [password, setPassword] = useState(randomPassword)
  const [invite, setInvite] = useState('')
  const [answer, setAnswer] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [error, setError] = useState('')
  const [status, setStatus] = useState('Create a room or paste an invitation.')
  const [scramble, setScramble] = useState('')
  const [receivedEvent, setReceivedEvent] = useState<PuzzleEvent>(event)
  const [elapsed, setElapsed] = useState(0)
  const [myResult, setMyResult] = useState<number | null>(null)
  const [peerResult, setPeerResult] = useState<number | null>(null)
  const [countdown, setCountdown] = useState(0)
  const [copyStatus, setCopyStatus] = useState('')
  const [channelOpen, setChannelOpen] = useState(false)

  const pcRef = useRef<RTCPeerConnection | null>(null)
  const channelRef = useRef<RTCDataChannel | null>(null)
  const connectionEpochRef = useRef(0)
  const signalingRef = useRef(0)
  const scrambleAbortRef = useRef<AbortController | null>(null)
  const raceIdRef = useRef<string | null>(null)
  const [role, setRole] = useState<'host' | 'guest'>('host')
  const startedAtRef = useRef(0)
  const frameRef = useRef<number | null>(null)
  const countdownRef = useRef<number | null>(null)

  const stopFrame = useCallback(() => {
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
    if (countdownRef.current !== null) {
      window.clearInterval(countdownRef.current)
      countdownRef.current = null
    }
  }, [])

  const cancelPendingScramble = useCallback(() => {
    scrambleAbortRef.current?.abort()
    scrambleAbortRef.current = null
  }, [])

  const closeConnection = useCallback(() => {
    connectionEpochRef.current += 1
    signalingRef.current += 1
    raceIdRef.current = null
    cancelPendingScramble()
    setChannelOpen(false)
    stopFrame()
    const channel = channelRef.current
    const pc = pcRef.current
    channelRef.current = null
    pcRef.current = null
    channel?.close()
    void pc?.close()
  }, [cancelPendingScramble, stopFrame])

  useEffect(() => () => closeConnection(), [closeConnection])

  const send = (message: BattleMessage) => {
    const channel = channelRef.current
    if (channel?.readyState === 'open') {
      channel.send(JSON.stringify(message))
    }
  }

  const beginRace = useCallback((raceId: string) => {
    raceIdRef.current = raceId
    stopFrame()
    setMyResult(null)
    setPeerResult(null)
    setElapsed(0)
    setPhase('countdown')
    setCountdown(3)
    let remaining = 3
    countdownRef.current = window.setInterval(() => {
      remaining -= 1
      setCountdown(remaining)
      if (remaining > 0) return
      if (countdownRef.current !== null) {
        window.clearInterval(countdownRef.current)
        countdownRef.current = null
      }
      startedAtRef.current = performance.now()
      setPhase('racing')
      const tick = () => {
        frameRef.current = null
        setElapsed(performance.now() - startedAtRef.current)
        frameRef.current = window.requestAnimationFrame(tick)
      }
      frameRef.current = window.requestAnimationFrame(tick)
    }, 1000)
  }, [stopFrame])

  const handleMessage = useCallback(
    (message: BattleMessage) => {
      if (message.type === 'hello') {
        setStatus('Opponent connected.')
        return
      }
      if (message.type === 'scramble') {
        stopFrame()
        raceIdRef.current = message.raceId
        setScramble(message.scramble)
        setReceivedEvent(message.event)
        setMyResult(null)
        setPeerResult(null)
        setElapsed(0)
        setPhase('connected')
        setStatus('New scramble received. Waiting for the host to start.')
        return
      }
      if (message.type === 'start') {
        if (message.raceId !== raceIdRef.current) return
        beginRace(message.raceId)
        return
      }
      if (message.type === 'result') {
        // A late result from an abandoned race must not appear in the current
        // one after a reset or a new scramble.
        if (message.raceId !== raceIdRef.current) return
        setPeerResult(message.rawMs)
        setStatus(`Opponent finished in ${formatBattleTime(message.rawMs)}.`)
        return
      }
      if (message.type === 'reset') {
        if (
          message.raceId &&
          raceIdRef.current &&
          message.raceId !== raceIdRef.current
        ) {
          return
        }
        stopFrame()
        raceIdRef.current = null
        setScramble('')
        setMyResult(null)
        setPeerResult(null)
        setElapsed(0)
        setPhase('connected')
        setStatus('Race reset. Waiting for a scramble.')
      }
    },
    [beginRace, stopFrame],
  )

  const attachChannel = useCallback(
    (channel: RTCDataChannel) => {
      channelRef.current = channel
      channel.onopen = () => {
        if (channelRef.current !== channel) return
        setChannelOpen(true)
        setPhase('connected')
        setStatus('Opponent connected. Waiting for a scramble.')
        send({ type: 'hello' })
      }
      channel.onclose = () => {
        if (channelRef.current !== channel) return
        channelRef.current = null
        connectionEpochRef.current += 1
        raceIdRef.current = null
        cancelPendingScramble()
        stopFrame()
        setChannelOpen(false)
        setPhase('failed')
        setStatus(
          'Opponent disconnected. The race was stopped; create or join a room to reconnect.',
        )
      }
      channel.onmessage = (message) => {
        try {
          const parsed = JSON.parse(String(message.data)) as BattleMessage
          handleMessage(parsed)
        } catch {
          setError('Received an unreadable battle message.')
        }
      }
    },
    [cancelPendingScramble, handleMessage, stopFrame],
  )

  const createPeerConnection = () => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    })
    pcRef.current = pc
    pc.onconnectionstatechange = () => {
      if (pcRef.current !== pc) return
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        connectionEpochRef.current += 1
        raceIdRef.current = null
        cancelPendingScramble()
        stopFrame()
        channelRef.current = null
        setChannelOpen(false)
        setPhase('failed')
        setStatus(
          'The peer connection closed. Create or join a room to reconnect.',
        )
      }
    }
    return pc
  }

  const createRoom = async () => {
    setError('')
    closeConnection()
    const attempt = ++signalingRef.current
    setRole('host')
    try {
      const pc = createPeerConnection()
      const channel = pc.createDataChannel('cubelab-battle', { ordered: true })
      attachChannel(channel)
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      await waitForIceGathering(pc)
      // A second Create/Join click owns a newer attempt. Do not let this stale
      // continuation overwrite the visible code after its peer was closed.
      if (signalingRef.current !== attempt) return
      const code = encodePayload({
        v: 1,
        roomId: roomId.trim().toUpperCase(),
        password: password.trim(),
        sdp: pc.localDescription ?? offer,
      })
      setInvite(code)
      setPhase('host-offer')
      setStatus('Send the invitation code, then paste the answer code here.')
    } catch (caught) {
      if (signalingRef.current !== attempt) return
      setError(caught instanceof Error ? caught.message : 'Could not create the room.')
      setPhase('failed')
    }
  }

  const joinRoom = async () => {
    setError('')
    closeConnection()
    const attempt = ++signalingRef.current
    setRole('guest')
    const payload = decodePayload(joinCode)
    if (!payload) {
      setError('That is not a valid battle invitation code.')
      return
    }
    if (
      payload.roomId !== roomId.trim().toUpperCase() ||
      payload.password !== password.trim()
    ) {
      setError('The room ID or password does not match this invitation.')
      return
    }
    try {
      const pc = createPeerConnection()
      pc.ondatachannel = (dataEvent) => attachChannel(dataEvent.channel)
      await pc.setRemoteDescription(payload.sdp)
      const joined = await pc.createAnswer()
      await pc.setLocalDescription(joined)
      await waitForIceGathering(pc)
      if (signalingRef.current !== attempt) return
      setAnswer(
        encodePayload({
          v: 1,
          roomId: payload.roomId,
          password: payload.password,
          sdp: pc.localDescription ?? joined,
        }),
      )
      setPhase('guest-answer')
      setStatus('Send this answer code back to the host.')
    } catch (caught) {
      if (signalingRef.current !== attempt) return
      setError(caught instanceof Error ? caught.message : 'Could not join the room.')
      setPhase('failed')
    }
  }

  const acceptAnswer = async () => {
    const payload = decodePayload(answer)
    if (!payload) {
      setError('That is not a valid battle answer code.')
      return
    }
    if (
      payload.roomId !== roomId.trim().toUpperCase() ||
      payload.password !== password.trim()
    ) {
      setError('The answer code belongs to another room.')
      return
    }
    try {
      await pcRef.current?.setRemoteDescription(payload.sdp)
      setPhase('waiting')
      setStatus('Connecting to the opponent…')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not connect.')
    }
  }

  const sendScramble = async () => {
    if (isUnscrambledEvent(event)) {
      setError('Choose a generated-scramble event before starting a battle.')
      return
    }
    const channel = channelRef.current
    if (!channel || channel.readyState !== 'open') {
      setError('Connect to the opponent before starting a race.')
      return
    }
    setError('')
    const epoch = connectionEpochRef.current
    cancelPendingScramble()
    const controller = new AbortController()
    scrambleAbortRef.current = controller
    try {
      const next = await generateScramble(event, {
        signal: controller.signal,
      })
      // The channel can close while the worker is still preparing a scramble.
      // Abandon that result instead of starting a local race with no peer.
      if (
        controller.signal.aborted ||
        connectionEpochRef.current !== epoch ||
        channelRef.current !== channel ||
        channel.readyState !== 'open'
      ) {
        return
      }
      const raceId = randomRaceId()
      raceIdRef.current = raceId
      setScramble(next)
      setReceivedEvent(event)
      setMyResult(null)
      setPeerResult(null)
      send({ type: 'scramble', event, scramble: next, raceId })
      if (role === 'host') {
        send({ type: 'start', raceId })
        beginRace(raceId)
      }
    } catch (caught) {
      if (!controller.signal.aborted) {
        setError(
          caught instanceof Error && caught.message === SCRAMBLE_TIMEOUT_MESSAGE
            ? 'Battle scramble generation timed out. Try again on the same connection.'
            : 'Could not generate a battle scramble.',
        )
      }
    } finally {
      if (scrambleAbortRef.current === controller) {
        scrambleAbortRef.current = null
      }
    }
  }

  const stopRace = () => {
    stopFrame()
    const rawMs = Math.max(0, Math.floor(performance.now() - startedAtRef.current))
    const raceId = raceIdRef.current
    setElapsed(rawMs)
    setMyResult(rawMs)
    setPhase('finished')
    send({ type: 'result', rawMs, raceId: raceId ?? '' })
  }

  const resetRace = () => {
    stopFrame()
    const raceId = raceIdRef.current
    raceIdRef.current = null
    setMyResult(null)
    setPeerResult(null)
    setElapsed(0)
    setScramble('')
    setPhase('connected')
    send({ type: 'reset', raceId: raceId ?? '' })
  }

  const copy = async (value: string, label: string) => {
    const copied = await copyText(value)
    setCopyStatus(copied ? `${label} copied.` : `Could not copy the ${label.toLowerCase()}.`)
  }

  const winner = useMemo(() => {
    if (myResult === null || peerResult === null) return null
    return myResult === peerResult
      ? 'tie'
      : myResult < peerResult
        ? 'you'
        : 'peer'
  }, [myResult, peerResult])

  const connected =
    channelOpen &&
    (phase === 'connected' ||
      phase === 'countdown' ||
      phase === 'racing' ||
      phase === 'finished')

  return (
    <div className="tool-scroll battle-tool" data-timer-space-ignore>
      <div className="battle-room">
        <label className="tool-field">
          <span>Room ID</span>
          <input
            value={roomId}
            maxLength={12}
            disabled={connected}
            onChange={(input) => setRoomId(input.target.value.toUpperCase())}
          />
        </label>
        <label className="tool-field">
          <span>Password</span>
          <input
            value={password}
            maxLength={20}
            disabled={connected}
            onChange={(input) => setPassword(input.target.value)}
          />
        </label>
      </div>

      {phase === 'setup' || phase === 'failed' ? (
        <>
          <div className="tool-actions">
            <button
              type="button"
              className="button button-primary button-small"
              disabled={!roomId.trim() || !password.trim()}
              onClick={() => void createRoom()}
            >
              Create room
            </button>
            <button
              type="button"
              className="button button-secondary button-small"
              disabled={!roomId.trim() || !password.trim() || !joinCode.trim()}
              onClick={() => void joinRoom()}
            >
              Join with code
            </button>
          </div>
          <label className="tool-field">
            <span>Invitation code</span>
            <textarea
              rows={4}
              value={joinCode}
              placeholder="Paste the host's invitation code"
              onChange={(input) => setJoinCode(input.target.value)}
            />
          </label>
        </>
      ) : null}

      {phase === 'host-offer' ? (
        <>
          <label className="tool-field">
            <span>Invitation code</span>
            <textarea rows={4} readOnly value={invite} />
          </label>
          <div className="tool-actions">
            <button type="button" className="text-button" onClick={() => void copy(invite, 'Invitation code')}>
              Copy invitation
            </button>
          </div>
          <label className="tool-field">
            <span>Answer code from opponent</span>
            <textarea
              rows={4}
              value={answer}
              onChange={(input) => setAnswer(input.target.value)}
            />
          </label>
          <button type="button" className="button button-primary button-small" disabled={!answer.trim()} onClick={() => void acceptAnswer()}>
            Connect
          </button>
        </>
      ) : null}

      {phase === 'guest-answer' ? (
        <>
          <label className="tool-field">
            <span>Answer code</span>
            <textarea rows={4} readOnly value={answer} />
          </label>
          <button type="button" className="text-button" onClick={() => void copy(answer, 'Answer code')}>
            Copy answer code
          </button>
        </>
      ) : null}

      {phase === 'waiting' ? (
        <p className="tool-status" role="status">Waiting for the data channel…</p>
      ) : null}

      {connected ? (
        <>
          <div className="battle-scramble">
            <span className="tool-label">{getEventLabel(receivedEvent)} scramble</span>
            <p>{scramble || 'No scramble yet.'}</p>
          </div>
          <div className="battle-clock" aria-live="off">
            {phase === 'countdown'
              ? countdown > 0
                ? countdown
                : 'Go!'
              : formatBattleTime(elapsed)}
          </div>
          <div className="tool-actions">
            {role === 'host' ? (
              <button
                type="button"
                className="button button-primary button-small"
                data-testid="battle-start"
                disabled={
                  !channelOpen ||
                  phase === 'racing' ||
                  phase === 'countdown'
                }
                onClick={() => void sendScramble()}
              >
                New scramble + start
              </button>
            ) : null}
            {phase === 'racing' ? (
              <button type="button" className="button button-danger button-small" onClick={stopRace}>
                Stop
              </button>
            ) : null}
            {phase === 'finished' ? (
              <button type="button" className="button button-secondary button-small" onClick={resetRace}>
                Reset race
              </button>
            ) : null}
          </div>
          <dl className="tool-stat-grid battle-results">
            <div><dt>You</dt><dd>{myResult === null ? '—' : formatBattleTime(myResult)}</dd></div>
            <div><dt>Opponent</dt><dd>{peerResult === null ? '—' : formatBattleTime(peerResult)}</dd></div>
          </dl>
          {winner ? (
            <p className="battle-winner" role="status">
              {winner === 'you' ? 'You won!' : winner === 'peer' ? 'Opponent won.' : 'Tie.'}
            </p>
          ) : null}
        </>
      ) : null}

      <p className="tool-note">{status}</p>
      {copyStatus ? <p className="tool-status" role="status">{copyStatus}</p> : null}
      {error ? <p className="tool-status is-error" role="alert">{error}</p> : null}
      <p className="tool-note">
        Codes are exchanged manually; there is no CubeLab server. Share them
        only with your opponent. Some strict networks may block a direct
        connection.
      </p>
    </div>
  )
}
