import type { InspectionCountDirection } from '../types'
import { INSPECTION_LIMIT_MS } from '../timer/machine'

export type AlertTone = 'success' | 'danger' | 'warning'

/** Peak gain at 100% volume. Kept below clipping for the short alert tones. */
export const ALERT_MAX_GAIN = 0.4
const MAX_TONE_GAIN = 0.75
const TONE_GAIN_MULTIPLIER: Record<AlertTone, number> = {
  success: 1,
  warning: 1,
  danger: 1.5,
}

let audioContext: AudioContext | null = null

/** Maps the 50–150% preference to a safe Web Audio gain. */
export function alertGainForVolume(volume: number): number {
  if (!Number.isFinite(volume)) return 0
  const normalized = Math.min(150, Math.max(50, volume)) / 100
  return normalized * ALERT_MAX_GAIN
}

/** The DNF/danger tone is deliberately louder than the other feedback tones. */
export function alertGainForTone(tone: AlertTone, volume: number): number {
  return Math.min(
    MAX_TONE_GAIN,
    alertGainForVolume(volume) * TONE_GAIN_MULTIPLIER[tone],
  )
}

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (audioContext) return audioContext

  try {
    audioContext = new AudioContext()
    return audioContext
  } catch {
    return null
  }
}

/**
 * Creates or resumes the alert audio context during a user gesture. Browsers
 * otherwise block audio that starts from a timer-driven warning.
 */
export function primeAlertAudio(): void {
  const context = getAudioContext()
  if (!context) return
  if (context.state === 'suspended') void context.resume()
}

interface ToneStep {
  frequency: number
  offset: number
  duration: number
}

function toneSequence(tone: AlertTone): ToneStep[] {
  switch (tone) {
    case 'danger':
      return [
        { frequency: 220, offset: 0, duration: 0.16 },
        { frequency: 180, offset: 0.18, duration: 0.2 },
      ]
    case 'warning':
      return [
        { frequency: 660, offset: 0, duration: 0.09 },
        { frequency: 660, offset: 0.14, duration: 0.09 },
      ]
    case 'success':
      return [
        { frequency: 880, offset: 0, duration: 0.09 },
        { frequency: 1_175, offset: 0.1, duration: 0.12 },
      ]
  }
}

export function playAlertSound(tone: AlertTone, volume = 70): void {
  const peakGain = alertGainForTone(tone, volume)
  if (peakGain <= 0) return

  const context = getAudioContext()
  if (!context) return
  if (context.state === 'suspended') void context.resume()

  const now = context.currentTime
  for (const { frequency, offset, duration } of toneSequence(tone)) {
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    const start = now + offset

    oscillator.type = 'sine'
    oscillator.frequency.value = frequency
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(peakGain, start + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)

    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.start(start)
    oscillator.stop(start + duration + 0.02)
  }
}

export function vibrateAlert(tone: AlertTone): void {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') {
    return
  }

  const pattern =
    tone === 'danger' ? [80, 60, 80] : tone === 'warning' ? [30, 50, 30] : [35]
  navigator.vibrate(pattern)
}

export interface InspectionWarningEvent {
  key: '8s' | '12s'
  elapsedMs: number
  label: string
}

/**
 * Maps the two optional warnings to elapsed inspection times. Countdown
 * warnings fire when the display reaches 7s and 3s remaining (8s and 12s
 * elapsed); count-up warnings fire at 8s and 12s elapsed.
 */
export function inspectionWarningEvents(
  direction: InspectionCountDirection,
  warnAt8s: boolean,
  warnAt12s: boolean,
): InspectionWarningEvent[] {
  const events: InspectionWarningEvent[] = []

  if (warnAt8s) {
    events.push({
      key: '8s',
      elapsedMs:
        direction === 'down' ? INSPECTION_LIMIT_MS - 7_000 : 8_000,
      label: direction === 'down' ? '7 seconds remaining' : '8 seconds',
    })
  }
  if (warnAt12s) {
    events.push({
      key: '12s',
      elapsedMs:
        direction === 'down' ? INSPECTION_LIMIT_MS - 3_000 : 12_000,
      label: direction === 'down' ? '3 seconds remaining' : '12 seconds',
    })
  }

  return events.sort((a, b) => a.elapsedMs - b.elapsedMs)
}
