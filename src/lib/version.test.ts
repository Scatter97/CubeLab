import { describe, expect, it } from 'vitest'
import { CUBELAB_VERSION } from './version'

describe('display version', () => {
  it('uses the documented date and patch format without touching schema versions', () => {
    expect(CUBELAB_VERSION).toMatch(/^\d+\.\d{2}\.\d{6}:\d+$/)
    expect(CUBELAB_VERSION).toBe('0.01.261104:1')
  })
})
