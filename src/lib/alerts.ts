import type { InspectionWarning } from '../types'

export type AlertTone = 'success' | 'danger' | 'warning'

let audioContext: AudioContext | null = null

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

export function playAlertSound(tone: AlertTone): void {
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
    gain.gain.exponentialRampToValueAtTime(0.08, start + 0.01)
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

export function inspectionWarningMs(warning: InspectionWarning): number | null {
  if (warning === '8s') return 8_000
  if (warning === '12s') return 12_000
  return null
}
