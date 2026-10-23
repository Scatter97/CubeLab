import { useCallback, useEffect, useRef, useState } from 'react'
import type { ToastData } from '../components/Toast'
import { createId } from '../lib/id'

interface ToastInput {
  message: string
  actionLabel?: string
  onAction?: () => void
}

export interface UseToastResult {
  toast: ToastData | null
  showToast: (input: ToastInput) => void
  dismissToast: () => void
}

export function useToast(): UseToastResult {
  const [toast, setToast] = useState<ToastData | null>(null)
  const timerRef = useRef<number | null>(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const dismissToast = useCallback(() => {
    clearTimer()
    setToast(null)
  }, [clearTimer])

  const showToast = useCallback(
    (input: ToastInput) => {
      clearTimer()
      const id = createId()
      setToast({ id, ...input })
      timerRef.current = window.setTimeout(
        () => {
          setToast((current) => (current?.id === id ? null : current))
          timerRef.current = null
        },
        input.actionLabel ? 6_000 : 3_500,
      )
    },
    [clearTimer],
  )

  useEffect(() => clearTimer, [clearTimer])

  return { toast, showToast, dismissToast }
}
