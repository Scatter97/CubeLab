import { describe, expect, it } from 'vitest'
import release from '../release.json'
import { CUBELAB_VERSION } from './version'

describe('display version', () => {
  it('derives the documented release format from the release record', () => {
    expect(CUBELAB_VERSION).toMatch(/^\d+\.\d{2}\.\d{6}:\d+$/)
    expect(CUBELAB_VERSION).toBe(
      `${release.major}.${String(release.feature).padStart(2, '0')}.${release.date}:${release.patch}`,
    )
  })

  it('does not use storage, backup or sync schema versions', () => {
    expect(CUBELAB_VERSION).not.toContain('schema')
    expect(release.date).toMatch(/^\d{6}$/)
  })
})
