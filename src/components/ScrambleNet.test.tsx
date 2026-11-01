import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { cubeNetForScramble } from '../lib/cubeNet'
import { ScrambleNet } from './ScrambleNet'

afterEach(cleanup)

describe('ScrambleNet', () => {
  it('renders six faces and every sticker for a 3x3 scramble', () => {
    const net = cubeNetForScramble("R U R' U' F2 D L2 B' R2 U2", 3)
    expect(net).not.toBeNull()

    const { container } = render(<ScrambleNet net={net!} />)
    expect(screen.getByTestId('scramble-net')).toHaveAttribute('data-size', '3')
    expect(container.querySelectorAll('[data-face]')).toHaveLength(6)
    expect(container.querySelectorAll('[data-sticker]')).toHaveLength(54)
  })

  it('renders the correct number of stickers for a big cube', () => {
    const net = cubeNetForScramble("Rw U2 3Fw'", 6)
    expect(net).not.toBeNull()

    const { container } = render(<ScrambleNet net={net!} />)
    expect(container.querySelectorAll('[data-sticker]')).toHaveLength(6 * 6 * 6)
  })
})
