import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TimeTrend } from './TimeTrend'
import type { Solve } from '../types'

const solves: Solve[] = Array.from({ length: 40 }, (_, i) => ({ id: String(i), event: '333', rawMs: 10000 + i * 1200, penalty: 'none', scramble: 'R U', comment: '', createdAt: Date.UTC(2026, 9, 31) - i * 60000 }))

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: vi.fn(function (this: HTMLDialogElement) { this.open = true }) })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: vi.fn(function (this: HTMLDialogElement) { this.open = false }) })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('TimeTrend', () => {
  it('fits the compact chart to its container with small PBs and nonnegative ticks', () => {
    render(<TimeTrend solves={solves} compact />)
    expect(screen.getByTestId('time-trend-svg')).toHaveAttribute('viewBox')
    expect(screen.getAllByTestId('time-trend-pb')[0]).toHaveAttribute('r', '1.6')
    expect(screen.getAllByTestId('time-trend-y-tick').every((tick) => !tick.textContent?.startsWith('-'))).toBe(true)
    expect(screen.getByTestId('time-trend-plot')).toHaveAttribute('clip-path')
  })

  it('opens a named modal, zooms, pans, resets and closes', () => {
    render(<TimeTrend solves={solves} compact />)
    fireEvent.click(screen.getByRole('button', { name: 'Expand Time Trend' }))
    expect(screen.getByRole('dialog', { name: 'Time Trend' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(screen.getByTestId('time-trend-visible-range')).toHaveTextContent('Solves #21–40')
    fireEvent.click(screen.getByRole('button', { name: 'Earlier solves' }))
    expect(screen.getByTestId('time-trend-visible-range')).toHaveTextContent('Solves #16–35')
    fireEvent.click(screen.getByRole('button', { name: 'Fit all' }))
    expect(screen.getByTestId('time-trend-visible-range')).toHaveTextContent('Solves #1–40')
    fireEvent.click(screen.getByRole('button', { name: 'Close Time Trend' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('updates series, custom averages and PB visibility without losing the chart', () => {
    render(<TimeTrend solves={solves} />)
    fireEvent.click(screen.getByTestId('time-trend-expand'))
    fireEvent.click(screen.getByRole('button', { name: 'PB markers' }))
    expect(screen.queryAllByTestId('time-trend-pb')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Custom' }))
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Custom average size' }), { target: { value: '25' } })
    expect(screen.getByTestId('time-trend-legend')).toHaveTextContent('ao25')
    expect(document.querySelector('[data-series="custom"]')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Single' }))
    expect(document.querySelector('[data-series="single"]')).toBeNull()
  })

  it('handles independent wheel axes, pinch gestures, and resets in compact mode', () => {
    render(<TimeTrend solves={solves} compact />)
    const svg = screen.getByTestId('time-trend-svg')
    vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, width: 320, height: 180, right: 320, bottom: 180, toJSON: () => ({}) })
    const ySpan = () => Number(svg.getAttribute('data-y-max')) - Number(svg.getAttribute('data-y-min'))
    const originalY = ySpan()
    const originalTicks = svg.querySelectorAll('text')[svg.querySelectorAll('text').length - 1]!.textContent
    expect(fireEvent.wheel(svg, { deltaY: -150, clientX: 180, clientY: 90, cancelable: true })).toBe(false)
    expect(ySpan()).toBeLessThan(originalY)
    const afterY = ySpan()
    fireEvent.wheel(svg, { deltaX: -150, clientX: 180, clientY: 90 })
    expect(ySpan()).toBe(afterY)
    expect(svg.querySelectorAll('text')[svg.querySelectorAll('text').length - 1]!.textContent).not.toBe(originalTicks)
    fireEvent.click(screen.getByRole('button', { name: 'Reset Time Trend view' }))
    expect(ySpan()).toBe(originalY)
    fireEvent.wheel(svg, { deltaY: -50, ctrlKey: true, clientX: 180, clientY: 90 })
    expect(ySpan()).toBeLessThan(originalY)
    fireEvent.click(screen.getByRole('button', { name: 'Reset Time Trend view' }))
    for (const [type, scale] of [['gesturestart', 1], ['gesturechange', 2], ['gestureend', 2]] as const) {
      const event = new Event(type, { bubbles: true, cancelable: true })
      Object.assign(event, { scale, clientX: 180, clientY: 90 })
      fireEvent(svg, event)
    }
    expect(ySpan()).toBe(originalY / 2)
  })

  it('leaves wheel events alone while timing', () => {
    render(<TimeTrend solves={solves} disabled />)
    expect(fireEvent.wheel(screen.getByTestId('time-trend-svg'), { deltaY: -100, cancelable: true })).toBe(true)
  })

  it('opens stats from a compact PB marker, retains them on hover, and closes', () => {
    render(<TimeTrend solves={solves} compact />)
    const marker = screen.getByRole('button', { name: 'PB solve #40, 10.00. Show stats' })
    fireEvent.click(marker)
    const dialog = screen.getByRole('dialog', { name: 'Personal best' })
    expect(dialog).toBeVisible()
    expect(screen.getByTestId('pb-stats-time')).toHaveTextContent('10.00')
    expect(screen.getByTestId('pb-stats-improvement')).toHaveTextContent('1.20 faster')
    expect(screen.getByTestId('pb-stats-ao5')).toHaveTextContent('12.40')
    expect(screen.getByTestId('pb-stats-ao12')).toHaveTextContent('16.60')
    expect(dialog).toHaveTextContent('R U')
    fireEvent.pointerLeave(screen.getByTestId('time-trend-svg'))
    expect(dialog).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Close PB stats' }))
    expect(screen.queryByRole('dialog', { name: 'Personal best' })).toBeNull()
    expect(screen.getByTestId('time-trend-svg')).toBeVisible()
  })

  it('supports Enter on PBs and removes stale stats when the session changes', () => {
    const { rerender } = render(<TimeTrend solves={solves} compact />)
    fireEvent.keyDown(screen.getByRole('button', { name: 'PB solve #1, 56.80. Show stats' }), { key: 'Enter' })
    expect(screen.getByRole('dialog', { name: 'Personal best' })).toHaveTextContent('First valid solve')
    expect(screen.getByTestId('pb-stats-ao5')).toHaveTextContent('—')
    rerender(<TimeTrend solves={[]} compact />)
    expect(screen.queryByRole('dialog', { name: 'Personal best' })).toBeNull()
  })

  it('keeps PB stats locked while timing', () => {
    render(<TimeTrend solves={solves} compact disabled />)
    const marker = screen.getByRole('button', { name: 'PB solve #40, 10.00. Show stats' })
    expect(marker).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(marker)
    const globalKey = vi.fn()
    window.addEventListener('keydown', globalKey)
    fireEvent.keyDown(marker, { key: 'Enter' })
    window.removeEventListener('keydown', globalKey)
    expect(globalKey).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog', { name: 'Personal best' })).toBeNull()
  })

  it('shows useful empty/DNF states and prevents expansion during timing', () => {
    const { rerender } = render(<TimeTrend solves={[]} disabled />)
    expect(screen.getByRole('status')).toHaveTextContent('Record a solve')
    expect(screen.getByTestId('time-trend-expand')).toBeDisabled()
    rerender(<TimeTrend solves={solves.map((s) => ({ ...s, penalty: 'dnf' }))} />)
    expect(screen.getByRole('status')).toHaveTextContent('No valid times')
  })
})
