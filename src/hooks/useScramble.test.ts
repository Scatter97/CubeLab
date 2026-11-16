import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useScramble } from './useScramble'
import { generateScramble } from '../lib/scramble'
vi.mock('../lib/scramble', () => ({ generateScramble: vi.fn() }))
afterEach(() => { cleanup(); vi.resetAllMocks() })
it('suspends ordinary event generation outside Timer and resumes its existing queue', async () => {
  vi.mocked(generateScramble).mockResolvedValue("R U R' U'")
  const { result, rerender } = renderHook(({enabled}) => useScramble('333',enabled), {initialProps:{enabled:false}})
  expect(generateScramble).not.toHaveBeenCalled()
  act(() => rerender({enabled:true}))
  await waitFor(() => expect(result.current.scramble).not.toBeNull())
  expect(generateScramble).toHaveBeenCalledTimes(2)
  act(() => rerender({enabled:false}))
  act(() => rerender({enabled:true}))
  await waitFor(() => expect(result.current.isLoading).toBe(false))
  expect(generateScramble).toHaveBeenCalledTimes(2)
})
