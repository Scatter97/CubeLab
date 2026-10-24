import { describe, expect, it } from 'vitest'
import {
  ALERT_MAX_GAIN,
  alertGainForTone,
  alertGainForVolume,
  inspectionWarningEvents,
} from './alerts'

describe('alert volume', () => {
  it('maps the preference to a safe gain range', () => {
    expect(alertGainForVolume(0)).toBeCloseTo(ALERT_MAX_GAIN * 0.5)
    expect(alertGainForVolume(50)).toBeCloseTo(ALERT_MAX_GAIN * 0.5)
    expect(alertGainForVolume(70)).toBeCloseTo(ALERT_MAX_GAIN * 0.7)
    expect(alertGainForVolume(100)).toBeCloseTo(ALERT_MAX_GAIN)
    expect(alertGainForVolume(150)).toBeCloseTo(ALERT_MAX_GAIN * 1.5)
  })

  it('clamps invalid values instead of producing unsafe gain', () => {
    expect(alertGainForVolume(-20)).toBeCloseTo(ALERT_MAX_GAIN * 0.5)
    expect(alertGainForVolume(200)).toBeCloseTo(ALERT_MAX_GAIN * 1.5)
    expect(alertGainForVolume(Number.NaN)).toBe(0)
  })
})


describe('alert tone gains', () => {
  it('boosts only the danger tone by about 50%', () => {
    expect(alertGainForTone('success', 70)).toBeCloseTo(alertGainForVolume(70))
    expect(alertGainForTone('warning', 70)).toBeCloseTo(alertGainForVolume(70))
    expect(alertGainForTone('danger', 70)).toBeCloseTo(
      alertGainForVolume(70) * 1.5,
    )
  })

  it('caps the danger gain below clipping at full volume', () => {
    expect(alertGainForTone('danger', 100)).toBeLessThanOrEqual(0.75)
    expect(alertGainForTone('danger', 0)).toBeCloseTo(ALERT_MAX_GAIN * 0.5 * 1.5)
  })
})

describe('inspection warning events', () => {
  it('fires countdown warnings when the display reaches 7s and 3s remaining', () => {
    expect(inspectionWarningEvents('down', true, true)).toEqual([
      { key: '8s', elapsedMs: 8_000, label: '7 seconds remaining' },
      { key: '12s', elapsedMs: 12_000, label: '3 seconds remaining' },
    ])
  })

  it('fires count-up warnings at 8s and 12s elapsed', () => {
    expect(inspectionWarningEvents('up', true, true)).toEqual([
      { key: '8s', elapsedMs: 8_000, label: '8 seconds' },
      { key: '12s', elapsedMs: 12_000, label: '12 seconds' },
    ])
  })

  it('honors each warning toggle independently', () => {
    expect(inspectionWarningEvents('down', false, false)).toEqual([])
    expect(inspectionWarningEvents('down', true, false)).toEqual([
      { key: '8s', elapsedMs: 8_000, label: '7 seconds remaining' },
    ])
    expect(inspectionWarningEvents('down', false, true)).toEqual([
      { key: '12s', elapsedMs: 12_000, label: '3 seconds remaining' },
    ])
  })
})
