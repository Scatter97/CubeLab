import { useCallback, useEffect, useRef, useState } from 'react'
import App from './App'
import { RecoveryCenter, type RecoveryFailureInfo } from './components/RecoveryCenter'
import {
  loadSessionsForStartup,
  loadSettingsForStartup,
  type SessionsSnapshot,
  type SettingsSnapshot,
} from './lib/storage'
import { applyPendingCompletionAtStartup } from './lib/pendingCompletion'
import { recoverReplacementAtStartup } from './lib/startupRecovery'
import { runStartupMigration } from './lib/startupMigration'
import {
  loadOnboardingBootstrap,
  startOnboardingWelcomeDraft,
  type OnboardingBootstrap,
} from './lib/onboarding'

type BootstrapPhase =
  | { kind: 'checking' }
  | { kind: 'blocked'; message: string; failure: RecoveryFailureInfo }
  | {
      kind: 'ready'
      snapshot: SessionsSnapshot
      settingsSnapshot: SettingsSnapshot
      onboarding: OnboardingBootstrap
    }

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
        setPhase({
          kind: 'blocked',
          message: replacement.message,
          failure: { kind: 'replacement', message: replacement.message },
        })
        return
      }
      const completion = applyPendingCompletionAtStartup()
      if (!completion.ok) {
        setPhase({
          kind: 'blocked',
          message: completion.message,
          failure: { kind: 'pending-completion', message: completion.message },
        })
        return
      }
      // Archive and commit any legacy/older schema before any editable hook can
      // normalize it. A failed archive leaves the source bytes untouched.
      const migration = await runStartupMigration()
      if (migration.status === 'blocked') {
        const kind =
          migration.reason === 'archive'
            ? 'archive'
            : migration.reason === 'write'
              ? 'quota'
              : migration.reason === 'journal'
                ? 'replacement'
                : migration.reason === 'verification'
                  ? 'migration'
                  : 'storage'
        setPhase({
          kind: 'blocked',
          message: migration.message,
          failure: { kind, message: migration.message },
        })
        return
      }
      let snapshot: SessionsSnapshot
      try {
        snapshot = loadSessionsForStartup()
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'Saved history could not be opened safely. The original data has been kept.'
        setPhase({
          kind: 'blocked',
          message,
          failure: { kind: 'sessions', message },
        })
        return
      }
      const settings = loadSettingsForStartup()
      if (!settings.ok) {
        setPhase({
          kind: 'blocked',
          message: settings.message,
          failure: { kind: 'settings', message: settings.message },
        })
        return
      }
      let onboarding = loadOnboardingBootstrap(snapshot.data)
      if (onboarding.show && !onboarding.draft) {
        const draft = startOnboardingWelcomeDraft()
        if (draft) onboarding = { ...onboarding, draft }
      }
      setPhase({
        kind: 'ready',
        snapshot,
        settingsSnapshot: settings,
        onboarding,
      })
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Saved history could not be opened safely. The original data has been kept.'
      setPhase({
        kind: 'blocked',
        message,
        failure: { kind: 'storage', message },
      })
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

  if (phase.kind === 'ready') {
    return (
      <App
        initialSessions={phase.snapshot}
        initialSettings={phase.settingsSnapshot}
        initialOnboarding={phase.onboarding}
      />
    )
  }
  if (phase.kind === 'blocked') {
    return (
      <RecoveryCenter
        failure={phase.failure}
        busy={busy}
        onRetry={() => void runRecovery()}
      />
    )
  }
  return (
    <RecoveryGate
      phase={phase}
      busy={busy}
      onRetry={() => void runRecovery()}
    />
  )
}
