import { useEffect, useState, type ReactNode } from 'react'

export const ACTIVE_TAB_LOCK = 'cubelab-active-tab'

type Ownership = 'checking' | 'active' | 'waiting' | 'unavailable'

/** Hold a separate document-lifetime lock before recovery or application hooks mount. */
export function SingleTabGate({ children }: { children: ReactNode }) {
  const [ownership, setOwnership] = useState<Ownership>(() => navigator.locks ? 'checking' : 'unavailable')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const locks = navigator.locks
    if (!locks) return
    const controller = new AbortController()
    let disposed = false
    let acquired = false
    let release: (() => void) | undefined

    const hold = (lock: Lock | null): Promise<void> | undefined => {
      if (disposed || !lock) return
      acquired = true
      setOwnership('active')
      // Browsers release this lock when the document closes or crashes. Never
      // steal it or expire it on a heartbeat: a background tab may be timing.
      return new Promise<void>((resolve) => { release = resolve })
    }

    void locks.request(
      ACTIVE_TAB_LOCK,
      { mode: 'exclusive', ifAvailable: true },
      hold,
    ).then(() => {
      if (disposed || acquired) return
      setOwnership('waiting')
      // Queue without polling. Closing the owner automatically admits one waiter.
      return locks.request(
        ACTIVE_TAB_LOCK,
        { mode: 'exclusive', signal: controller.signal },
        hold,
      )
    }).catch(() => {
      if (!disposed) setOwnership('unavailable')
    })

    return () => {
      disposed = true
      controller.abort()
      release?.()
    }
  }, [attempt])

  if (ownership === 'active') return children
  const waiting = ownership === 'waiting'
  const unavailable = ownership === 'unavailable'
  return (
    <main
      className="startup-recovery"
      data-testid={`single-tab-${ownership}`}
      aria-live="polite"
      aria-busy={ownership === 'checking'}
    >
      <section className="startup-recovery-card">
        <h1>{waiting ? 'CubeLab is already open' : unavailable ? 'Unable to open CubeLab' : 'Opening CubeLab'}</h1>
        <p>
          {waiting
            ? 'Another CubeLab tab or window is open in this browser. Close it and this tab will open automatically.'
            : unavailable
              ? 'CubeLab could not safely check for another open tab. Try again, or use a browser that supports tab coordination.'
              : 'Checking for another open CubeLab tab…'}
        </p>
        {waiting ? <p>Your saved history will load when this tab opens.</p> : null}
        {unavailable ? (
          <button type="button" className="primary-button" onClick={() => {
            if (!navigator.locks) return
            setOwnership('checking')
            setAttempt((value) => value + 1)
          }}>
            Try again
          </button>
        ) : null}
      </section>
    </main>
  )
}
