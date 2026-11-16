import { expect, it } from 'vitest'
import { DEFAULT_TRAINING_STATISTICS, parseTrainingStatisticsPreferences, readShowUpcomingCase, saveTrainingPresentation, TRAINING_UPCOMING_CASE_KEY } from './statisticsPreferences'

it('preserves older preferences and defaults only malformed fields', () => {
  const result = parseTrainingStatisticsPreferences(JSON.stringify({
    'oll:execution': { rows: ['ao5', 'single', 'future', 'ao5'], visible: [], metric: 'estimated' },
    'oll:recognition': { visible: ['ao12', 'ao12'], metric: 'estimated', current: false, best: false },
  }))
  expect(result['oll:execution']).toMatchObject({ visible: [], metric: 'raw', current: true, best: true })
  expect(result['oll:execution']!.rows.slice(0, 3)).toEqual(['ao5', 'single', 'mo3'])
  expect(result['oll:recognition']).toMatchObject({ rows: DEFAULT_TRAINING_STATISTICS.rows, visible: ['ao12'], metric: 'estimated', current: true, best: false })
  expect(result['pll:recognition']).toBeUndefined()
  expect(parseTrainingStatisticsPreferences('{broken')).toEqual({})
})

it('uses a default-on preview and accepts only a stored JSON false to hide it', () => {
  localStorage.removeItem(TRAINING_UPCOMING_CASE_KEY)
  expect(readShowUpcomingCase()).toBe(true)
  try {
    for (const raw of ['{"show":false}', '"false"', '0', 'invalid', 'false\u00a0', 'true']) {
      localStorage.setItem(TRAINING_UPCOMING_CASE_KEY, raw)
      expect(readShowUpcomingCase()).toBe(true)
    }
    expect(saveTrainingPresentation(TRAINING_UPCOMING_CASE_KEY, false)).toBe(true)
    expect(readShowUpcomingCase()).toBe(false)
  } finally {
    localStorage.removeItem(TRAINING_UPCOMING_CASE_KEY)
  }
})
