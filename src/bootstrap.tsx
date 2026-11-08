import { useCallback, useEffect, useRef, useState } from 'react'
import App from './App'
import { loadSessionsForStartup, type SessionsSnapshot } from './lib/storage'
import { applyPendingCompletionAtStartup } from './lib/pendingCompletion'
import { recoverReplacementAtStartup } from './lib/startupRecovery'

type BootstrapPhase =
  | { kind: 'checking' }
  | { kind: 'blocked'; message: string }
  | { kind: 'ready'; snapshot: SessionsSnapshot }

function RecoveryGate({
  phase,
  busy,
  onRetry,
}: {
  phase: BootstrapPhase
  busy: boolean
  onRetry: () => void
}) {
  const blocked = phase.kind === 'blocked'
  return (
    <main
      className="startup-recovery"
      data-testid="startup-recovery"
      aria-busy={busy}
    >
      <section className="startup-recovery-card">
        <h1>{blocked ? 'Recovery required' : 'Opening CubeLab'}</h1>
        <p>
          {blocked
            ? phase.message
            : 'Checking for an interrupted replacement before opening your data.'}
        </p>
        {blocked ? (
          <>
            <p className="startup-recovery-note">
              Sessions, imports and timing controls stay closed until the
              recovery record is resolved.
            </p>
            <button
              type="button"
              className="primary-button"
              data-testid="startup-recovery-retry"
              onClick={onRetry}
              disabled={busy}
            >
              {busy ? 'Retrying…' : 'Retry recovery'}
            </button>
          </>
        ) : null}
      </section>
    </main>
  )
}

export default function Bootstrap() {
  const [phase, setPhase] = useState<BootstrapPhase>({ kind: 'checking' })
  const [busy, setBusy] = useState(false)
  const runningRef = useRef(false)

  const runRecovery = useCallback(async () => {
    if (runningRef.current) return
    runningRef.current = true
    setBusy(true)
    try {
      const replacement = await recoverReplacementAtStartup()
      if (replacement.status === 'blocked') {
        setPhase({ kind: 'blocked', message: replacement.message })
        return
      }
      const completion = applyPendingCompletionAtStartup()
      if (!completion.ok) {
        setPhase({ kind: 'blocked', message: completion.message })
        return
      }
      setPhase({ kind: 'ready', snapshot: loadSessionsForStartup() })
    } catch (error) {
      setPhase({ kind: 'blocked', message: error instanceof Error ? error.message : 'Saved history could not be opened safely. The original data has been kept.' })
    } finally {
      runningRef.current = false
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    // Reconcile external storage before mounting any writable application hooks.
    // oxlint-disable-next-line react/set-state-in-effect
    void runRecovery()
  }, [runRecovery])

  if (phase.kind === 'ready') return <App initialSessions={phase.snapshot} />
  return (
    <RecoveryGate
      phase={phase}
      busy={busy}
      onRetry={() => void runRecovery()}
    />
  )
}
