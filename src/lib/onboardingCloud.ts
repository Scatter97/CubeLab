import type { PuzzleEvent } from '../types'
import type { DriveTransport } from './driveTransport'
import {
  listRemoteBackups,
  mergeRemoteBackupSnapshots,
  readRemoteBackups,
  type RemoteBackupSnapshot,
} from './remoteBackups'
import { countSolves } from './sessions'

export interface CloudDataSummary {
  /** Number of immutable CubeLab snapshots discovered in Google Drive. */
  files: number
  sessions: number
  solves: number
  events: PuzzleEvent[]
  activeEvent?: PuzzleEvent
}

export interface OnboardingCloudRead {
  snapshots: RemoteBackupSnapshot[]
  summary: CloudDataSummary | null
}

/**
 * Reads every remote snapshot through the existing synchronization reader.
 * Any invalid or oversized file aborts the read; callers must not mutate local
 * data or enable sync from a partial cloud view.
 */
export async function readOnboardingCloudData(
  transport: DriveTransport,
): Promise<OnboardingCloudRead> {
  const files = await listRemoteBackups(transport)
  if (files.length === 0) return { snapshots: [], summary: null }
  const snapshots = await readRemoteBackups(transport, files)
  const merged = mergeRemoteBackupSnapshots(snapshots)
  const active =
    merged.sessions.sessions.find(
      (session) => session.id === merged.sessions.activeSessionId,
    ) ?? merged.sessions.sessions[0]
  const events: PuzzleEvent[] = []
  const seenEvents = new Set<string>()
  for (const session of merged.sessions.sessions) {
    const event = session.event ?? '333'
    if (seenEvents.has(event)) continue
    seenEvents.add(event)
    events.push(event)
  }
  return {
    snapshots,
    summary: {
      files: files.length,
      sessions: merged.sessions.sessions.length,
      solves: countSolves(merged.sessions.sessions),
      events,
      ...(active?.event ? { activeEvent: active.event } : {}),
    },
  }
}
