import { describe, expect, it } from 'vitest'
import { ALERT_MAX_GAIN, alertGainForVolume } from './alerts'

describe('alert volume', () => {
  it('maps the preference to a safe gain range', () => {
    expect(alertGainForVolume(0)).toBe(0)
    expect(alertGainForVolume(50)).toBeCloseTo(ALERT_MAX_GAIN / 2)
    expect(alertGainForVolume(70)).toBeCloseTo(ALERT_MAX_GAIN * 0.7)
    expect(alertGainForVolume(100)).toBeCloseTo(ALERT_MAX_GAIN)
  })

  it('clamps invalid values instead of producing unsafe gain', () => {
    expect(alertGainForVolume(-20)).toBe(0)
    expect(alertGainForVolume(200)).toBeCloseTo(ALERT_MAX_GAIN)
    expect(alertGainForVolume(Number.NaN)).toBe(0)
  })
})
