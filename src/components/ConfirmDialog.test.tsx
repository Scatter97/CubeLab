import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfirmDialog } from './ConfirmDialog'

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: vi.fn(function (this: HTMLDialogElement) {
      this.open = true
    }),
  })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: vi.fn(function (this: HTMLDialogElement) {
      this.open = false
    }),
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ConfirmDialog typed confirmation', () => {
  it('requires the exact reset phrase and supports cancellation', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    render(
      <ConfirmDialog
        open
        eyebrow="Developer · Danger zone"
        title="Reset all solve data?"
        description="This cannot be undone without a backup."
        cancelLabel="Cancel reset"
        confirmLabel="Reset all solve data"
        requireText="DELETE ALL SOLVES"
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    )

    const confirm = screen.getByRole('button', { name: 'Reset all solve data' })
    const input = screen.getByLabelText('Type DELETE ALL SOLVES to confirm')
    expect(confirm).toBeDisabled()

    fireEvent.change(input, { target: { value: 'delete all solves' } })
    expect(confirm).toBeDisabled()

    fireEvent.change(input, { target: { value: 'DELETE ALL SOLVES' } })
    expect(confirm).toBeEnabled()
    fireEvent.click(confirm)
    expect(onConfirm).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel reset' }))
    expect(onCancel).toHaveBeenCalledOnce()
  })
})
