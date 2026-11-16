import { createContext, useContext, type ReactNode } from 'react'

interface Recovery {
  error: string | null
  retry: () => void
  download: () => void
}
const TrainingSaveRecoveryContext = createContext<Recovery | null>(null)

export function TrainingSaveRecoveryProvider({ recovery, children }: { recovery: Recovery | null; children: ReactNode }) {
  return <TrainingSaveRecoveryContext value={recovery}>{children}</TrainingSaveRecoveryContext>
}

export function TrainingSaveRecovery() {
  const recovery = useContext(TrainingSaveRecoveryContext)
  if (!recovery) return null
  return (
    <div className="training-error" data-timer-space-ignore>
      <p role="alert"><strong>Training changes weren’t saved. Keep this page open.</strong>{' '}
        {recovery.error?.includes('changed since it was read')
          ? 'Saved Training data changed. Download a recovery copy before reloading.'
          : 'Retry saving or download a recovery copy.'}</p>
      <div className="training-actions">
        <button type="button" className="button button-secondary" onClick={recovery.retry}>Retry save</button>
        <button type="button" className="button button-secondary" onClick={recovery.download}>Download recovery copy</button>
      </div>
    </div>
  )
}
