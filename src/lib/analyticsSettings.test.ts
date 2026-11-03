import { describe, expect, it } from 'vitest'
import {
  ANALYTICS_SECTION_IDS,
  createDefaultAnalyticsSettings,
  getSubXTargetMs,
  normalizeAnalyticsSections,
  parseAnalyticsSettings,
} from './analyticsSettings'
import { DEFAULT_SETTINGS, parseSettingsData } from './storage'

describe('analytics settings', () => {
  it('creates every section in order with defaults', () => {
    const settings = createDefaultAnalyticsSettings()
    expect(settings.sections.map((section) => section.id)).toEqual([
      ...ANALYTICS_SECTION_IDS,
    ])
    expect(settings.sections.find((section) => section.id === 'progression')?.wide).toBe(true)
    expect(getSubXTargetMs(settings, '333')).toBe(20_000)
  })

  it('keeps a saved order, visibility and widths while restoring missing sections', () => {
    const sections = normalizeAnalyticsSections([
      { id: 'activity', visible: false, wide: true },
      { id: 'overview', visible: true, wide: false },
      { id: 'activity', visible: true, wide: false },
      { id: 'unknown', visible: false, wide: false },
    ])
    expect(sections).toHaveLength(ANALYTICS_SECTION_IDS.length)
    expect(sections[0]?.id).toBe('activity')
    expect(sections[1]?.id).toBe('overview')
    expect(sections.filter((section) => section.id === 'activity')).toHaveLength(1)
    expect(sections.find((section) => section.id === 'activity')).toMatchObject({
      visible: false,
      wide: true,
    })
  })

  it('parses valid targets and falls back for invalid data', () => {
    const parsed = parseAnalyticsSettings({
      sections: [{ id: 'overview', visible: false, wide: true }],
      subXTargetsMs: {
        '333': 15_000,
        '222': 1,
        '444': 'fast',
      },
    })
    expect(parsed.sections.find((section) => section.id === 'overview')).toMatchObject({
      visible: false,
      wide: true,
    })
    expect(getSubXTargetMs(parsed, '333')).toBe(15_000)
    expect(getSubXTargetMs(parsed, '222')).toBe(5_000)
    expect(getSubXTargetMs(parsed, '444')).toBe(60_000)

    expect(parseAnalyticsSettings(null)).toEqual(createDefaultAnalyticsSettings())
  })

  it('upgrades settings records without analytics defaults', () => {
    const parsed = parseSettingsData({ inspectionEnabled: true })
    expect(parsed).toEqual({
      ...DEFAULT_SETTINGS,
      inspectionEnabled: true,
    })
    expect(parsed?.analytics.sections).toHaveLength(ANALYTICS_SECTION_IDS.length)
  })
})
