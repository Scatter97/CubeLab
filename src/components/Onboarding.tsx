import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
} from 'react'
import type { Backup } from '../lib/backup'
import { MAX_BACKUP_BYTES } from '../lib/backupLimits'
import type { CsTimerImportPreview } from '../lib/csTimerImport'
import { CUBELAB_EVENTS, getEventLabel } from '../lib/events'
import {
  buildFreshSessionSetup,
  chooseImportedMainSession,
  createOnboardingDraft,
  DEVICE_SPECIFIC_ONBOARDING_SETTINGS,
  hasMeaningfulLocalData,
  importedPreviewEvents,
  reconcileImportCheckpoint,
  saveOnboardingDraft,
  type FreshSessionSetup,
  type OnboardingDraft,
  type OnboardingImportCheckpoint,
  type OnboardingMode,
  type OnboardingPath,
  type OnboardingStage,
} from '../lib/onboarding'
import type { CloudDataSummary } from '../lib/onboardingCloud'
import {
  countSolves,
  isUntouchedDefaultSession,
} from '../lib/sessions'
import type { DriveTransport } from '../lib/driveTransport'
import type { UseSyncResult } from '../hooks/useSync'
import type { DrawScrambleMode } from '../hooks/useDrawScrambleMode'
import type { SessionsData, Settings } from '../types'
import { loadSyncStorage } from '../lib/syncStorage'
import { CheckIcon, ChevronRightIcon, CubeMark } from './Icons'
import { AppearanceControls } from './AppearanceControls'

const TIMER_UPDATE_OPTIONS = [
  { value: 'live', label: 'Live' },
  { value: 'tenths', label: '0.1 s' },
  { value: 'seconds', label: 'Seconds' },
] as const

const DRAW_SCRAMBLE_OPTIONS = [
  { value: 'net', label: '2D net' },
  { value: '3d', label: '3D puzzle' },
] as const

const HOLD_OPTIONS = [
  { value: 150, label: 'Quick · 0.15 s' },
  { value: 300, label: 'Standard · 0.30 s' },
  { value: 500, label: 'Deliberate · 0.50 s' },
] as const

type SyncOutcome =
  | 'idle'
  | 'connecting'
  | 'reading'
  | 'found'
  | 'none'
  | 'syncing'
  | 'synced'
  | 'failed'

export interface OnboardingCompletionSummary {
  path: OnboardingPath
  sessions: number
  solves: number
  events?: number
  mainEvent: string
  sync: 'synced' | 'skipped' | 'needs-attention' | 'not-connected'
}

export interface OnboardingProps {
  mode: OnboardingMode
  initialDraft?: OnboardingDraft
  sessionsData: SessionsData
  settings: Settings
  sync: UseSyncResult
  transport: DriveTransport | null
  drawScrambleMode: DrawScrambleMode
  onDrawScrambleModeChange: (mode: DrawScrambleMode) => void
  onChangeSettings: (next: Partial<Settings>) => void
  onCommitSetup: (
    sessionsData: SessionsData,
    settingsData: Settings,
  ) => Promise<boolean>
  onImportBackup: (
    backup: Backup,
  ) => Promise<
    { ok: true; importedSessionIds: string[] } | { ok: false; error: string }
  >
  onMarkComplete: () => void
  onSkip: () => void
  onClose: () => void
  onFinish: () => void
}

function plural(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? singular : pluralForm
}

function countLabel(count: number, singular: string, pluralForm: string): string {
  return `${count} ${plural(count, singular, pluralForm)}`
}

const countFormatter = new Intl.NumberFormat('en-US')

function formatCount(value: number): string {
  return countFormatter.format(value)
}

function sortSelectedEvents(events: readonly string[]): string[] {
  const builtInOrder = new Map(
    CUBELAB_EVENTS.map((event, index) => [event.id as string, index]),
  )
  return [...new Set(events)].sort(
    (left, right) =>
      (builtInOrder.get(left) ?? Number.MAX_SAFE_INTEGER) -
        (builtInOrder.get(right) ?? Number.MAX_SAFE_INTEGER) ||
      left.localeCompare(right),
  )
}

function initialEvents(draft: OnboardingDraft | undefined): string[] {
  const selected = sortSelectedEvents(draft?.selectedEvents ?? ['333'])
  return selected.length > 0 ? selected : ['333']
}

function initialStage(
  mode: OnboardingMode,
  draft: OnboardingDraft | undefined,
): OnboardingStage {
  if (mode === 'reopen' || !draft) return 'welcome'
  if (draft.path === 'cstimer' && draft.importCheckpoint?.status === 'committed') {
    return 'settings'
  }
  if (draft.stage === 'complete') {
    if (draft.path === 'fresh') return 'sync'
    if (draft.path === 'cstimer') return draft.importCheckpoint ? 'settings' : 'import'
    return 'restore'
  }
  return draft.stage
}

function previewIdentity(preview: CsTimerImportPreview): string {
  return preview.sessions
    .map(
      (session) =>
        `${session.sessionNumber}\u0000${session.name}\u0000${session.event}\u0000${session.solveCount}`,
    )
    .join('\u0001')
}

function waitForPaint(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => window.setTimeout(resolve, 0))
    } else {
      window.setTimeout(resolve, 0)
    }
  })
}

function syncStatusMessage(status: string, error: string | null): string {
  if (status === 'auth-required') {
    return 'Google authorization expired. Connect again to continue.'
  }
  if (status === 'offline') {
    return 'Google Drive is unreachable. Check your connection and retry.'
  }
  if (status === 'conflict') {
    return 'Synchronization needs review before it can complete.'
  }
  if (status === 'failed') {
    return error || 'Synchronization failed.'
  }
  return error || 'Synchronization did not finish.'
}

export function Onboarding({
  mode,
  initialDraft,
  sessionsData,
  settings,
  sync,
  transport,
  drawScrambleMode,
  onDrawScrambleModeChange,
  onChangeSettings,
  onCommitSetup,
  onImportBackup,
  onMarkComplete,
  onSkip,
  onClose,
  onFinish,
}: OnboardingProps) {
  const sessions = sessionsData.sessions
  const sessionsRef = useRef(sessionsData)
  sessionsRef.current = sessionsData
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  const [draft, setDraft] = useState<OnboardingDraft | null>(
    initialDraft ?? null,
  )
  const draftRef = useRef(draft)
  draftRef.current = draft
  const [stage, setStage] = useState<OnboardingStage>(() =>
    initialStage(mode, initialDraft),
  )
  const [selectedEvents, setSelectedEvents] = useState<string[]>(() =>
    initialEvents(initialDraft),
  )
  const [mainEvent, setMainEvent] = useState<string>(
    initialDraft?.mainEvent ?? initialEvents(initialDraft)[0]!,
  )
  const [eventError, setEventError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [importPreview, setImportPreview] =
    useState<CsTimerImportPreview | null>(null)
  const [importRaw, setImportRaw] = useState<string | null>(null)
  const [importFileName, setImportFileName] = useState('')
  const [importDragging, setImportDragging] = useState(false)
  const [importNotice, setImportNotice] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const importReadRef = useRef(0)

  const [syncOutcome, setSyncOutcome] = useState<SyncOutcome>('idle')
  const [syncError, setSyncError] = useState<string | null>(null)
  const [cloudSummary, setCloudSummary] =
    useState<CloudDataSummary | null>(null)
  const [freshSetup, setFreshSetup] = useState<FreshSessionSetup | null>(null)
  const [completion, setCompletion] =
    useState<OnboardingCompletionSummary | null>(null)
  const [exiting, setExiting] = useState(false)
  const startSyncRef = useRef<(() => Promise<void>) | null>(null)
  const restoreStartedRef = useRef(false)
  const localCommitRef = useRef<Promise<boolean> | null>(null)
  const completionRef = useRef(false)
  const importInFlightRef = useRef(false)

  const headingRef = useRef<HTMLHeadingElement>(null)
  const shellRef = useRef<HTMLDivElement>(null)

  const patchDraft = useCallback((patch: Partial<OnboardingDraft>) => {
    const base =
      draftRef.current ??
      createOnboardingDraft(
        patch.path ?? 'fresh',
        patch.stage ?? 'welcome',
      )
    const next: OnboardingDraft = {
      ...base,
      ...patch,
      updatedAt: Date.now(),
    }
    draftRef.current = next
    setDraft(next)
    saveOnboardingDraft(next)
  }, [])

  const beginPath = useCallback(
    (path: OnboardingPath, nextStage: OnboardingStage) => {
      const next = createOnboardingDraft(path, nextStage)
      const events = initialEvents(next)
      const nextDraft: OnboardingDraft = {
        ...next,
        ...(path === 'fresh' ? { selectedEvents: events, mainEvent: events[0] } : {}),
      }
      draftRef.current = nextDraft
      setDraft(nextDraft)
      setSelectedEvents(events)
      setMainEvent(events[0]!)
      setEventError(null)
      setActionError(null)
      setImportPreview(null)
      setImportRaw(null)
      setImportNotice(null)
      setSyncOutcome('idle')
      setSyncError(null)
      setCloudSummary(null)
      setFreshSetup(null)
      setBusy(false)
      restoreStartedRef.current = false
      completionRef.current = false
      importInFlightRef.current = false
      saveOnboardingDraft(nextDraft)
      setStage(nextStage)
    },
    [],
  )

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true })
  }, [stage])

  // Resume an additive import that was interrupted after its durable commit.
  useEffect(() => {
    if (mode === 'reopen' || !initialDraft) return
    const checkpoint = initialDraft.importCheckpoint
    if (!checkpoint || checkpoint.status === 'committed') return
    const reconciliation = reconcileImportCheckpoint(checkpoint, sessions)
    if (reconciliation.committed) {
      patchDraft({
        stage: 'settings',
        importCheckpoint: {
          ...checkpoint,
          status: 'committed',
          sessionIds: reconciliation.sessionIds,
        },
        mainEvent:
          initialDraft.mainEvent ??
          checkpoint.preview[0]?.event ??
          '333',
      })
      setStage('settings')
    } else {
      patchDraft({
        stage: 'import',
        importCheckpoint: undefined,
      })
      setStage('import')
      setImportNotice(
        'The previous import did not finish. Choose the csTimer file again.',
      )
    }
    // Only the initial checkpoint matters for recovery.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const availableMainEvents = useMemo(() => {
    if (draft?.path === 'cstimer') {
      const checkpoint = draft.importCheckpoint
      return checkpoint ? importedPreviewEvents(checkpoint) : []
    }
    return selectedEvents
  }, [draft?.importCheckpoint, draft?.path, selectedEvents])

  useEffect(() => {
    if (availableMainEvents.length === 0) return
    if (!availableMainEvents.includes(mainEvent)) {
      const next = availableMainEvents[0]!
      setMainEvent(next)
      if (draftRef.current) patchDraft({ mainEvent: next })
    }
  }, [availableMainEvents, mainEvent, patchDraft])

  const connected = transport?.isConnected() ?? false
  const connectedSyncLabel = !connected
    ? null
    : !sync.preferences?.enabled
      ? 'Automatic synchronization is off.'
      : sync.phase === 'synced'
        ? 'Last synchronization completed.'
        : sync.phase === 'pending'
          ? 'Changes are waiting to synchronize.'
          : sync.phase === 'syncing'
            ? 'Synchronization is in progress.'
            : sync.phase === 'offline'
              ? 'Google Drive is currently unreachable.'
              : sync.phase === 'auth-required'
                ? 'Google authorization is required.'
                : sync.phase === 'conflict'
                  ? 'Synchronization needs review.'
                  : sync.phase === 'failed'
                    ? 'The last synchronization failed.'
                    : null
  const selectedEventSet = useMemo(() => new Set(selectedEvents), [selectedEvents])
  const holdOptions = useMemo(() => HOLD_OPTIONS.map((option) => ({ ...option })), [])

  const handleToggleEvent = (eventId: string) => {
    setEventError(null)
    const selected = selectedEventSet.has(eventId)
    if (selected && selectedEvents.length === 1) {
      setEventError('Keep at least one event selected.')
      return
    }
    const next = selected
      ? selectedEvents.filter((event) => event !== eventId)
      : sortSelectedEvents([...selectedEvents, eventId])
    setSelectedEvents(next)
    const resolvedMain = next.includes(mainEvent) ? mainEvent : next[0]!
    setMainEvent(resolvedMain)
    if (draftRef.current?.path === 'fresh') {
      patchDraft({
        selectedEvents: next,
        mainEvent: resolvedMain,
        stage: 'events',
      })
    }
  }

  const handleMainEventChange = (eventId: string) => {
    setMainEvent(eventId)
    if (draftRef.current) patchDraft({ mainEvent: eventId })
  }

  const goToWelcome = () => {
    setActionError(null)
    setBusy(false)
    setSyncOutcome('idle')
    setSyncError(null)
    setCloudSummary(null)
    if (draftRef.current) patchDraft({ stage: 'welcome' })
    setStage('welcome')
  }

  const finishWithSummary = useCallback(
    (summary: OnboardingCompletionSummary) => {
      if (completionRef.current) return
      completionRef.current = true
      setCompletion(summary)
      onMarkComplete()
      setStage('complete')
    },
    [onMarkComplete],
  )

  const completionTimerRef = useRef<number | null>(null)
  useEffect(() => {
    if (stage !== 'complete') return
    setExiting(false)
    const exitTimer = window.setTimeout(() => setExiting(true), 1_750)
    completionTimerRef.current = window.setTimeout(() => {
      completionTimerRef.current = null
      onFinish()
    }, 2_000)
    return () => {
      window.clearTimeout(exitTimer)
      if (completionTimerRef.current !== null) {
        window.clearTimeout(completionTimerRef.current)
        completionTimerRef.current = null
      }
    }
  }, [onFinish, stage])

  const finishNow = () => {
    if (completionTimerRef.current !== null) {
      window.clearTimeout(completionTimerRef.current)
      completionTimerRef.current = null
    }
    onFinish()
  }

  const commitFreshSetup = useCallback(async (): Promise<FreshSessionSetup | null> => {
    if (!draftRef.current || draftRef.current.path !== 'fresh') return null
    const setup = buildFreshSessionSetup({
      data: sessionsRef.current,
      events: selectedEvents,
      mainEvent,
      runId: draftRef.current.runId,
      createdSessionIdsByEvent: draftRef.current.createdSessionIdsByEvent,
    })
    if (!setup) {
      setActionError('Select at least one event before continuing.')
      return null
    }
    setBusy(true)
    setActionError(null)
    const committed = await onCommitSetup(setup.data, settingsRef.current)
    setBusy(false)
    if (!committed) {
      setActionError(
        'CubeLab could not save the setup. Check browser storage and retry.',
      )
      return null
    }
    setFreshSetup(setup)
    patchDraft({
      selectedEvents,
      mainEvent,
      createdSessionIdsByEvent: setup.sessionIdsByEvent,
      localCommitted: true,
      stage: draftRef.current.stage === 'sync'
        ? 'sync'
        : draftRef.current.stage === 'appearance'
          ? 'appearance'
          : 'settings',
    })
    return setup
  }, [mainEvent, onCommitSetup, patchDraft, selectedEvents])

  const commitImportedSetup = useCallback(async (): Promise<boolean> => {
    const currentDraft = draftRef.current
    const checkpoint = currentDraft?.importCheckpoint
    if (!currentDraft || currentDraft.path !== 'cstimer' || !checkpoint) {
      setActionError('Import a csTimer backup before continuing.')
      return false
    }
    const target = chooseImportedMainSession({
      sessions,
      importedSessionIds: checkpoint.sessionIds ?? [],
      activeSessionId: sessionsData.activeSessionId,
      mainEvent,
    })
    if (!target) {
      setActionError('Choose an event represented by the imported sessions.')
      return false
    }
    setBusy(true)
    setActionError(null)
    const committed = await onCommitSetup(
      { ...sessionsRef.current, activeSessionId: target.id },
      settingsRef.current,
    )
    setBusy(false)
    if (!committed) {
      setActionError(
        'CubeLab could not save the imported setup. Check browser storage and retry.',
      )
      return false
    }
    patchDraft({ mainEvent, localCommitted: true, stage: 'sync' })
    return true
  }, [mainEvent, onCommitSetup, patchDraft, sessions, sessionsData.activeSessionId])

  const handleConnectForSync = useCallback(async () => {
    if (!transport) {
      setSyncOutcome('failed')
      setSyncError('Google Drive is not configured for this build.')
      return
    }
    setSyncError(null)
    setSyncOutcome(connected ? 'reading' : 'connecting')
    try {
      if (!transport.isConnected()) await transport.connect()
      setSyncOutcome('reading')
      const { readOnboardingCloudData } = await import('../lib/onboardingCloud')
      const cloud = await readOnboardingCloudData(transport)
      if (draftRef.current?.path === 'returning') {
        if (!cloud.summary) {
          setCloudSummary(null)
          setSyncOutcome('none')
          return
        }
        setCloudSummary(cloud.summary)
        setSyncOutcome('found')
        return
      }
      if (cloud.summary) {
        setCloudSummary(cloud.summary)
        setSyncOutcome('found')
        return
      }
      setCloudSummary(null)
      await startSyncRef.current?.()
    } catch (error) {
      setSyncOutcome('failed')
      setSyncError(
        error instanceof Error ? error.message : 'Could not read Google Drive.',
      )
    }
  }, [connected, transport])

  const readSyncResult = useCallback((): {
    ok: boolean
    status: string
    error: string | null
  } => {
    const runtime = loadSyncStorage().runtime
    return {
      ok: runtime.lastSyncStatus === 'synced',
      status: runtime.lastSyncStatus,
      error: runtime.lastError,
    }
  }, [])

  const runSynchronization = useCallback(async (): Promise<boolean> => {
    setSyncOutcome('syncing')
    setSyncError(null)
    sync.updatePreferences({ enabled: true })
    await sync.syncNow('onboarding')
    await waitForPaint()
    const result = readSyncResult()
    if (!result.ok) {
      setSyncOutcome('failed')
      setSyncError(syncStatusMessage(result.status, result.error))
      return false
    }
    setSyncOutcome('synced')
    return true
  }, [readSyncResult, sync])

  const completeReturningRestore = useCallback(
    async (expectedSolves: number) => {
      const cleanLocal = !hasMeaningfulLocalData(sessionsRef.current)
      await waitForPaint()
      let data = sessionsRef.current
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const minimum = cleanLocal ? expectedSolves : 0
        if (countSolves(data.sessions) >= minimum) break
        await waitForPaint()
        data = sessionsRef.current
      }
      const active =
        data.sessions.find((session) => session.id === data.activeSessionId) ??
        data.sessions[0]
      if (!active) {
        setSyncOutcome('failed')
        setSyncError('Restored data could not be verified.')
        return
      }
      if (cleanLocal && countSolves(data.sessions) < expectedSolves) {
        setSyncOutcome('failed')
        setSyncError(
          'Synchronization finished, but the restored solves could not be verified. Nothing was marked complete.',
        )
        return
      }
      if (DEVICE_SPECIFIC_ONBOARDING_SETTINGS.length === 0) {
        finishWithSummary({
          path: 'returning',
          sessions: data.sessions.length,
          solves: countSolves(data.sessions),
          mainEvent: active.event ?? '333',
          sync: 'synced',
        })
        return
      }
      patchDraft({ path: 'returning', stage: 'device' })
      setStage('device')
    },
    [finishWithSummary, patchDraft],
  )

  const finishFreshOrImportAfterSync = useCallback(
    async (syncStatus: OnboardingCompletionSummary['sync']) => {
      const currentDraft = draftRef.current
      if (!currentDraft) return
      if (currentDraft.path === 'fresh') {
        const setup =
          freshSetup ??
          buildFreshSessionSetup({
            data: sessionsRef.current,
            events: selectedEvents,
            mainEvent,
            runId: currentDraft.runId,
            createdSessionIdsByEvent: currentDraft.createdSessionIdsByEvent,
          })
        if (setup) setFreshSetup(setup)
        finishWithSummary({
          path: 'fresh',
          sessions: setup?.configuredSessionIds.length ?? selectedEvents.length,
          solves: 0,
          events: selectedEvents.length,
          mainEvent,
          sync: syncStatus,
        })
        return
      }
      const checkpoint = currentDraft.importCheckpoint
      finishWithSummary({
        path: 'cstimer',
        sessions:
          checkpoint?.importedSessionCount ??
          sessionsRef.current.sessions.filter((session) =>
            checkpoint?.sessionIds?.includes(session.id),
          ).length,
        solves: checkpoint?.importedSolveCount ?? 0,
        mainEvent,
        sync: syncStatus,
      })
    },
    [
      finishWithSummary,
      freshSetup,
      mainEvent,
      selectedEvents,
    ],
  )

  const ensureLocalCommitForSync = useCallback(async (): Promise<boolean> => {
    if (localCommitRef.current) return localCommitRef.current
    const currentDraft = draftRef.current
    if (!currentDraft) return false
    if (currentDraft.localCommitted) return true
    const promise = (async () => {
      if (currentDraft.path === 'fresh') {
        const setup = await commitFreshSetup()
        return Boolean(setup)
      }
      if (currentDraft.path === 'cstimer') {
        return commitImportedSetup()
      }
      return true
    })()
    localCommitRef.current = promise
    try {
      return await promise
    } finally {
      localCommitRef.current = null
    }
  }, [commitFreshSetup, commitImportedSetup])

  const handleMaybeLater = useCallback(async () => {
    const currentDraft = draftRef.current
    if (!currentDraft) return
    if (currentDraft.path === 'returning') {
      onSkip()
      return
    }
    setBusy(true)
    const committed = await ensureLocalCommitForSync()
    setBusy(false)
    if (!committed) return
    const syncEnabled = Boolean(sync.preferences?.enabled)
    await finishFreshOrImportAfterSync(
      syncOutcome === 'failed' ||
        (syncEnabled && sync.phase !== 'synced')
        ? 'needs-attention'
        : syncEnabled
          ? 'synced'
          : 'not-connected',
    )
  }, [
    ensureLocalCommitForSync,
    finishFreshOrImportAfterSync,
    onSkip,
    sync.preferences?.enabled,
    sync.phase,
    syncOutcome,
  ])

  const handleStartSync = useCallback(async () => {
    const currentDraft = draftRef.current
    if (!currentDraft) return
    const committed = await ensureLocalCommitForSync()
    if (!committed) {
      setSyncOutcome('idle')
      return
    }
    const synced = await runSynchronization()
    if (synced) {
      if (currentDraft.path === 'returning') {
        await completeReturningRestore(cloudSummary?.solves ?? 0)
        return
      }
      await finishFreshOrImportAfterSync('synced')
    }
  }, [
    cloudSummary?.solves,
    completeReturningRestore,
    ensureLocalCommitForSync,
    finishFreshOrImportAfterSync,
    runSynchronization,
  ])
  startSyncRef.current = handleStartSync

  const handleCloudMerge = useCallback(async () => {
    setSyncOutcome('syncing')
    await handleStartSync()
  }, [handleStartSync])

  const handleRestoreInstead = useCallback(() => {
    restoreStartedRef.current = false
    patchDraft({
      path: 'returning',
      stage: 'restore',
      localCommitted: undefined,
      mainEvent: undefined,
      selectedEvents: undefined,
    })
    setStage('restore')
    setActionError(null)
    setSyncError(null)
    setSyncOutcome('found')
  }, [patchDraft])

  const handleReturningConnect = useCallback(
    async (chooseDifferentAccount = false) => {
      if (!transport) {
        setSyncOutcome('failed')
        setSyncError('Google Drive is not configured for this build.')
        return
      }
      if (chooseDifferentAccount && transport.isConnected()) {
        transport.disconnect()
      }
      restoreStartedRef.current = false
      setSyncOutcome('connecting')
      setSyncError(null)
      setCloudSummary(null)
      setStage('restore')
      patchDraft({ path: 'returning', stage: 'restore' })
      await handleConnectForSync()
    },
    [handleConnectForSync, patchDraft, transport],
  )

  // Continue the returning path once cloud data has been found.
  useEffect(() => {
    if (draftRef.current?.path !== 'returning') return
    if (syncOutcome !== 'found') return
    if (stage !== 'restore') return
    if (restoreStartedRef.current) return
    restoreStartedRef.current = true
    void (async () => {
      setSyncOutcome('syncing')
      const synced = await runSynchronization()
      if (!synced) return
      await completeReturningRestore(cloudSummary?.solves ?? 0)
    })()
  }, [
    cloudSummary?.solves,
    completeReturningRestore,
    runSynchronization,
    stage,
    syncOutcome,
  ])

  const handleContinueWithoutRestore = useCallback(() => {
    if (sync.preferences?.enabled) {
      sync.updatePreferences({ enabled: false })
    }
    onSkip()
  }, [onSkip, sync])

  const handleStartFreshFromNoCloud = () => {
    beginPath('fresh', 'events')
  }

  const handleImportFromNoCloud = () => {
    beginPath('cstimer', 'import')
  }

  const handleWelcomeFresh = () => {
    beginPath('fresh', 'events')
  }

  const handleWelcomeImport = () => {
    beginPath('cstimer', 'import')
  }

  const handleWelcomeReturning = () => {
    beginPath('returning', 'signin')
  }

  const handleEventsContinue = () => {
    if (selectedEvents.length === 0) {
      setEventError('Select at least one event.')
      return
    }
    const resolvedMain = selectedEvents.includes(mainEvent)
      ? mainEvent
      : selectedEvents[0]!
    setMainEvent(resolvedMain)
    patchDraft({
      path: 'fresh',
      stage: 'settings',
      selectedEvents,
      mainEvent: resolvedMain,
    })
    setStage('settings')
  }

  const handleSettingsContinue = useCallback(async () => {
    const currentDraft = draftRef.current
    if (!currentDraft) return
    setActionError(null)
    patchDraft({ stage: 'appearance', mainEvent })
    setStage('appearance')
  }, [mainEvent, patchDraft])

  const handleAppearanceContinue = useCallback(async () => {
    const currentDraft = draftRef.current
    if (!currentDraft) return
    setActionError(null)
    if (currentDraft.path === 'cstimer') {
      const committed = await commitImportedSetup()
      if (!committed) return
    } else {
      patchDraft({ stage: 'sync', mainEvent })
    }
    setStage('sync')
  }, [commitImportedSetup, mainEvent, patchDraft])

  const handleBackFromAppearance = () => {
    setStage('settings')
  }

  const handleBackFromSettings = () => {
    const path = draftRef.current?.path
    setStage(path === 'cstimer' ? 'import' : 'events')
  }

  const handleDeviceFinish = () => {
    const data = sessionsRef.current
    const active =
      data.sessions.find((session) => session.id === data.activeSessionId) ??
      data.sessions[0]
    if (!active) {
      setActionError('No restored session is available.')
      return
    }
    finishWithSummary({
      path: 'returning',
      sessions: data.sessions.length,
      solves: countSolves(data.sessions),
      mainEvent: active.event ?? '333',
      sync: 'synced',
    })
  }

  // Import file handling -----------------------------------------------------

  const existingImportNames = useMemo(
    () =>
      sessions
        .filter((session) => !isUntouchedDefaultSession(session))
        .map((session) => session.name),
    [sessions],
  )

  const prepareFile = useCallback(
    async (file: File) => {
      setActionError(null)
      setImportNotice(null)
      if (file.size > MAX_BACKUP_BYTES) {
        setActionError('That backup is larger than 10 MB.')
        return
      }
      const readId = importReadRef.current + 1
      importReadRef.current = readId
      setBusy(true)
      try {
        const raw = await file.text()
        if (readId !== importReadRef.current) return
        // The csTimer parser and native-backup parser are loaded only when the
        // user actually selects a file, keeping Start Fresh/returning onboarding
        // free of import code.
        const { analyzeCsTimerBackup, isCsTimerBackup } = await import(
          '../lib/csTimerImport'
        )
        if (!isCsTimerBackup(raw)) {
          const { parseBackup } = await import('../lib/backup')
          const native = parseBackup(raw)
          setActionError(
            native.ok
              ? 'That is a CubeLab backup. Use Settings → Backup & restore to restore it.'
              : 'That file is not a csTimer backup.',
          )
          return
        }
        const analyzed = analyzeCsTimerBackup(raw, {
          existingSessionNames: existingImportNames,
        })
        if (!analyzed.ok) {
          setActionError(analyzed.error)
          return
        }
        setImportRaw(raw)
        setImportFileName(file.name)
        setImportPreview(analyzed.preview)
      } catch {
        if (readId === importReadRef.current) {
          setActionError('Could not read that file.')
        }
      } finally {
        if (readId === importReadRef.current) setBusy(false)
      }
    },
    [existingImportNames],
  )

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) await prepareFile(file)
  }

  const handleDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setImportDragging(false)
    const file = event.dataTransfer.files?.[0]
    if (file) await prepareFile(file)
  }

  const handleCancelImportPreview = () => {
    setImportPreview(null)
    setImportRaw(null)
    setImportFileName('')
    setActionError(null)
    setImportNotice(null)
  }

  const handleConfirmImport = async () => {
    if (!importRaw || !importPreview || importInFlightRef.current) return
    importInFlightRef.current = true
    try {
      const { parseCsTimerBackup } = await import('../lib/csTimerImport')
      const parsed = parseCsTimerBackup(importRaw, settings, {
        existingSessionNames: existingImportNames,
      })
      if (!parsed.ok) {
        setActionError(parsed.error)
        setImportPreview(null)
        setImportRaw(null)
        return
      }
      if (previewIdentity(parsed.preview) !== previewIdentity(importPreview)) {
        setImportPreview(parsed.preview)
        setImportNotice(
          'Some session names changed to avoid conflicts. Review the updated list, then import again.',
        )
        return
      }

      const checkpoint: OnboardingImportCheckpoint = {
        status: 'committing',
        fileName: importFileName,
        beforeSessionIds: sessions.map((session) => session.id),
        preview: parsed.preview.sessions.map((session) => ({
          sessionNumber: session.sessionNumber,
          name: session.name,
          event: session.event,
          solveCount: session.solveCount,
        })),
        importedSessionCount: parsed.preview.totalSessions,
        importedSolveCount: parsed.preview.totalSolves,
      }
      patchDraft({
        path: 'cstimer',
        stage: 'import',
        importCheckpoint: checkpoint,
        mainEvent: parsed.preview.sessions[0]?.event ?? '333',
        selectedEvents: undefined,
      })
      setBusy(true)
      setActionError(null)
      const result = await onImportBackup(parsed.backup)
      setBusy(false)
      if (!result.ok) {
        setActionError(result.error)
        patchDraft({ importCheckpoint: undefined, stage: 'import' })
        return
      }
      const committedCheckpoint: OnboardingImportCheckpoint = {
        ...checkpoint,
        status: 'committed',
        sessionIds: result.importedSessionIds,
      }
      const importEvents = importedPreviewEvents(committedCheckpoint)
      const activeEvent =
        parsed.preview.sessions[0]?.event ?? importEvents[0] ?? '333'
      setMainEvent(
        importEvents.includes(activeEvent) ? activeEvent : importEvents[0] ?? '333',
      )
      patchDraft({
        path: 'cstimer',
        stage: 'settings',
        importCheckpoint: committedCheckpoint,
        mainEvent: importEvents.includes(activeEvent)
          ? activeEvent
          : importEvents[0] ?? '333',
      })
      setImportPreview(null)
      setImportRaw(null)
      setImportNotice(null)
      setStage('settings')
    } catch {
      setActionError(
        'Could not load the csTimer importer. Check your connection and retry.',
      )
    } finally {
      importInFlightRef.current = false
    }
  }

  // Focus containment --------------------------------------------------------

  const handleShellKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && mode === 'reopen') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key !== 'Tab') return
    const shell = shellRef.current
    if (!shell) return
    const focusable = [
      ...shell.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ),
    ].filter(
      (element) =>
        element.offsetParent !== null ||
        element.getClientRects().length > 0,
    )
    if (focusable.length === 0) return
    const first = focusable[0]!
    const last = focusable[focusable.length - 1]!
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  // Rendering ---------------------------------------------------------------

  const progressSteps =
    draft?.path === 'returning'
      ? ['Google', 'Restore', 'Device']
      : draft?.path === 'cstimer'
        ? ['Import', 'Settings', 'Appearance', 'Sync']
        : ['Events', 'Settings', 'Appearance', 'Sync']
  const progressStageIndex =
    draft?.path === 'returning'
      ? stage === 'signin'
        ? 0
        : stage === 'restore'
          ? 1
          : 2
      : stage === 'events' || stage === 'import'
        ? 0
        : stage === 'settings'
          ? 1
          : stage === 'appearance'
            ? 2
            : 3
  const showProgress =
    stage !== 'welcome' && stage !== 'complete' && draft !== null

  const stageTitle =
    stage === 'welcome'
      ? 'Welcome to CubeLab'
      : stage === 'events'
        ? 'Select your events'
        : stage === 'import'
          ? 'Import from csTimer'
          : stage === 'settings'
            ? 'Set up CubeLab'
            : stage === 'appearance'
              ? 'Make it yours'
              : stage === 'sync'
              ? 'Turn on Sync?'
              : stage === 'signin'
                ? 'Welcome Back'
                : stage === 'restore'
                  ? 'Restoring your CubeLab data'
                  : stage === 'device'
                    ? 'Device settings'
                    : "You're all set!"

  return (
    <div
      ref={shellRef}
      className="onboarding-screen"
      onKeyDown={handleShellKeyDown}
    >
      <div className="onboarding-topbar">
        <div className="onboarding-brand">
          <span className="brand-mark">
            <CubeMark size={24} />
          </span>
          <span>CubeLab</span>
        </div>
        {mode === 'reopen' ? (
          <button
            type="button"
            className="onboarding-text-button"
            onClick={onClose}
          >
            Close setup
          </button>
        ) : null}
      </div>

      <main className="onboarding-main">
        {showProgress ? (
          <nav className="onboarding-progress" aria-label="Setup progress">
            <ol>
              {progressSteps.map((label, index) => (
                <li
                  key={label}
                  className={
                    index === progressStageIndex
                      ? 'is-current'
                      : index < progressStageIndex
                        ? 'is-complete'
                        : ''
                  }
                  aria-current={index === progressStageIndex ? 'step' : undefined}
                >
                  <span className="onboarding-progress-number" aria-hidden="true">
                    {index < progressStageIndex ? (
                      <CheckIcon size={11} />
                    ) : (
                      index + 1
                    )}
                  </span>
                  <span>{label}</span>
                </li>
              ))}
            </ol>
          </nav>
        ) : null}

        <section
          className={`onboarding-panel${stage === 'welcome' ? ' is-wide' : ''}${
            stage === 'complete' ? ' is-complete' : ''
          }${exiting ? ' is-exiting' : ''}`}
          aria-labelledby="onboarding-heading"
          key={stage}
        >
          {stage !== 'complete' ? (
            <header className="onboarding-heading">
              <h1 id="onboarding-heading" ref={headingRef} tabIndex={-1}>
                {stageTitle}
              </h1>
              <p>
                {stage === 'welcome'
                  ? 'Your solves. Your progress. Your way.'
                  : stage === 'events'
                    ? 'Pick the puzzles you want ready to time. Each one gets its own session.'
                    : stage === 'import'
                      ? 'Bring your csTimer sessions and solves into CubeLab.'
                      : stage === 'settings'
                        ? 'A few preferences now. Everything stays changeable in Settings.'
                        : stage === 'appearance'
                          ? 'Choose a theme and tune every color. Hold the preview to try the timer states.'
                          : stage === 'sync'
                            ? 'Sync across your devices now, or enable it later in Settings.'
                            : stage === 'signin'
                            ? 'Sign in to restore your CubeLab data.'
                            : stage === 'restore'
                              ? 'Checking Google Drive and merging your existing data safely.'
                              : stage === 'device'
                                ? 'These options are not included in synchronization.'
                                : ''}
              </p>
            </header>
          ) : null}

          {actionError ? (
            <p className="onboarding-error" role="alert" data-testid="onboarding-error">
              {actionError}
            </p>
          ) : null}

          {stage === 'welcome' ? (
            <div className="onboarding-welcome">
              <div className="onboarding-paths">
                <button
                  type="button"
                  className="onboarding-path"
                  onClick={handleWelcomeFresh}
                  data-testid="onboarding-start-fresh"
                >
                  <span className="onboarding-path-copy">
                    <span className="onboarding-path-title">Start Fresh</span>
                    <span className="onboarding-path-description">
                      Choose your events, create your sessions, and get started.
                    </span>
                  </span>
                  <ChevronRightIcon size={16} />
                </button>
                <button
                  type="button"
                  className="onboarding-path"
                  onClick={handleWelcomeImport}
                  data-testid="onboarding-import-cstimer"
                >
                  <span className="onboarding-path-copy">
                    <span className="onboarding-path-title">
                      Import from csTimer
                    </span>
                    <span className="onboarding-path-description">
                      Bring your existing sessions and solves into CubeLab.
                    </span>
                  </span>
                  <ChevronRightIcon size={16} />
                </button>
                <button
                  type="button"
                  className="onboarding-path"
                  onClick={handleWelcomeReturning}
                  data-testid="onboarding-returning"
                >
                  <span className="onboarding-path-copy">
                    <span className="onboarding-path-title">
                      Already Use CubeLab?
                    </span>
                    <span className="onboarding-path-description">
                      Sync your data from another device.
                    </span>
                  </span>
                  <ChevronRightIcon size={16} />
                </button>
              </div>
              {mode === 'first-run' ? (
                <button
                  type="button"
                  className="onboarding-skip"
                  onClick={onSkip}
                  data-testid="onboarding-skip"
                >
                  Skip Setup
                </button>
              ) : (
                <button
                  type="button"
                  className="onboarding-skip"
                  onClick={onClose}
                >
                  Return to CubeLab
                </button>
              )}
            </div>
          ) : null}

          {stage === 'events' ? (
            <div className="onboarding-step">
              <fieldset className="onboarding-fieldset">
                <legend className="sr-only">Events</legend>
                <div className="onboarding-event-grid">
                  {CUBELAB_EVENTS.map((event) => {
                    const selected = selectedEventSet.has(event.id)
                    return (
                      <label
                        key={event.id}
                        className={`onboarding-event${selected ? ' is-selected' : ''}`}
                        data-testid={`onboarding-event-card-${event.id}`}
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => handleToggleEvent(event.id)}
                          data-testid={`onboarding-event-${event.id}`}
                        />
                        <span>{event.label}</span>
                        {selected ? (
                          <CheckIcon size={12} className="onboarding-event-check" />
                        ) : null}
                      </label>
                    )
                  })}
                </div>
              </fieldset>
              {eventError ? (
                <p className="onboarding-note is-warning" role="status">
                  {eventError}
                </p>
              ) : (
                <p className="onboarding-note">
                  At least one event stays selected.
                </p>
              )}
              <div className="onboarding-actions">
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={goToWelcome}
                >
                  Back
                </button>
                <button
                  type="button"
                  className="button button-primary"
                  onClick={handleEventsContinue}
                  data-testid="onboarding-events-continue"
                >
                  Continue
                </button>
              </div>
            </div>
          ) : null}

          {stage === 'import' ? (
            <div className="onboarding-step">
              {importPreview ? (
                <div className="onboarding-import-preview">
                  <div className="onboarding-import-summary">
                    <span>
                      <strong>{formatCount(importPreview.totalSessions)}</strong>{' '}
                      {plural(importPreview.totalSessions, 'session', 'sessions')}
                    </span>
                    <span>
                      <strong>{formatCount(importPreview.totalSolves)}</strong>{' '}
                      {plural(importPreview.totalSolves, 'solve', 'solves')}
                    </span>
                  </div>
                  <div
                    className="onboarding-import-scroll"
                    role="region"
                    aria-label="Sessions in this csTimer backup"
                    tabIndex={0}
                  >
                    <table className="onboarding-import-table">
                      <caption className="sr-only">
                        Session names, events and solve counts in this csTimer
                        backup
                      </caption>
                      <thead>
                        <tr>
                          <th scope="col">Session</th>
                          <th scope="col">Event</th>
                          <th scope="col">Solves</th>
                        </tr>
                      </thead>
                      <tbody>
                        {importPreview.sessions.map((session) => (
                          <tr key={`${session.sessionNumber}-${session.index}`}>
                            <th scope="row" title={session.name}>
                              <span className="onboarding-cs-name">
                                {session.name}
                              </span>
                            </th>
                            <td>{session.eventLabel}</td>
                            <td>{formatCount(session.solveCount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {importPreview.hasUnknown ? (
                    <p className="onboarding-note is-warning">
                      Unknown puzzle types are grouped into{' '}
                      <strong>MISC</strong> and are never treated as 3×3. MISC
                      sessions have no generated scramble.
                    </p>
                  ) : null}
                  {importNotice ? (
                    <p className="onboarding-note" role="status">
                      {importNotice}
                    </p>
                  ) : null}
                  <div className="onboarding-actions">
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={handleCancelImportPreview}
                      disabled={busy}
                    >
                      Choose another file
                    </button>
                    <button
                      type="button"
                      className="button button-primary"
                      onClick={handleConfirmImport}
                      disabled={busy}
                      data-testid="onboarding-import-confirm"
                    >
                      {busy
                        ? 'Importing…'
                        : `Import ${formatCount(
                            importPreview.totalSessions,
                          )} ${plural(
                            importPreview.totalSessions,
                            'session',
                            'sessions',
                          )}`}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".txt,text/plain"
                    hidden
                    data-testid="onboarding-import-file"
                    onChange={handleFileChange}
                  />
                  <div
                    className={`onboarding-dropzone${importDragging ? ' is-dragging' : ''}`}
                    onDragOver={(event) => {
                      event.preventDefault()
                      setImportDragging(true)
                    }}
                    onDragLeave={() => setImportDragging(false)}
                    onDrop={handleDrop}
                  >
                    <p>
                      Drop a csTimer <code>.txt</code> file here, or choose one.
                    </p>
                    <button
                      type="button"
                      className="button button-primary"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={busy}
                      data-testid="onboarding-choose-file"
                    >
                      {busy ? 'Reading…' : 'Choose csTimer file'}
                    </button>
                  </div>
                  {importNotice ? (
                    <p className="onboarding-note" role="status">
                      {importNotice}
                    </p>
                  ) : null}
                  <div className="onboarding-actions">
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={goToWelcome}
                    >
                      Back
                    </button>
                  </div>
                </>
              )}
              {draft?.importCheckpoint?.status === 'committed' && !importPreview ? (
                <div className="onboarding-imported-state">
                  <p className="onboarding-note">
                    This csTimer file was already imported:{' '}
                    {countLabel(
                      draft.importCheckpoint.importedSessionCount,
                      'session',
                      'sessions',
                    )}{' '}
                    and{' '}
                    {countLabel(
                      draft.importCheckpoint.importedSolveCount,
                      'solve',
                      'solves',
                    )}
                    .
                  </p>
                  <button
                    type="button"
                    className="button button-primary"
                    onClick={() => setStage('settings')}
                  >
                    Continue to settings
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          {stage === 'settings' ? (
            <div className="onboarding-step">
              <div className="onboarding-preference-list">
                <div className="onboarding-preference">
                  <div className="onboarding-preference-copy">
                    <span className="onboarding-preference-title">
                      WCA inspection
                    </span>
                    <span className="onboarding-preference-description">
                      15 seconds before each solve.
                    </span>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={settings.inspectionEnabled}
                    aria-label="WCA inspection"
                    className="settings-switch"
                    onClick={() =>
                      onChangeSettings({
                        inspectionEnabled: !settings.inspectionEnabled,
                      })
                    }
                  >
                    <span className="switch-track">
                      <span className="switch-thumb" />
                    </span>
                  </button>
                </div>

                <fieldset className="onboarding-choice-group">
                  <legend>Hold to start</legend>
                  <div className="onboarding-segments">
                    {holdOptions.map((option) => (
                      <label
                        key={option.value}
                        className="onboarding-segment"
                      >
                        <input
                          type="radio"
                          name="onboarding-hold"
                          checked={settings.holdDurationMs === option.value}
                          onChange={() =>
                            onChangeSettings({ holdDurationMs: option.value })
                          }
                        />
                        <span>{option.label}</span>
                      </label>
                    ))}
                  </div>
                  <label className="onboarding-custom-hold">
                    <span>Custom hold time</span>
                    <input
                      type="number"
                      min={0}
                      max={10000}
                      step={50}
                      value={settings.holdDurationMs}
                      aria-label="Custom hold time in milliseconds"
                      data-testid="onboarding-custom-hold"
                      onChange={(event) =>
                        onChangeSettings({
                          holdDurationMs: Math.max(
                            0,
                            Math.min(10000, Number(event.target.value || 0)),
                          ),
                        })
                      }
                    />
                    <span>ms</span>
                  </label>
                  <HoldTestArea holdDurationMs={settings.holdDurationMs} />
                </fieldset>

                <fieldset className="onboarding-choice-group">
                  <legend>Timer display</legend>
                  <div className="onboarding-segments">
                    {TIMER_UPDATE_OPTIONS.map((option) => (
                      <label
                        key={option.value}
                        className="onboarding-segment"
                      >
                        <input
                          type="radio"
                          name="onboarding-timer-update"
                          checked={settings.timerUpdateMode === option.value}
                          onChange={() =>
                            onChangeSettings({ timerUpdateMode: option.value })
                          }
                        />
                        <span>{option.label}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>

              </div>

              <fieldset className="onboarding-choice-group onboarding-main-event">
                <legend>Main Event</legend>
                {availableMainEvents.length > 0 ? (
                  <div className="onboarding-main-event-grid">
                    {availableMainEvents.map((event) => (
                      <label
                        key={event}
                        className={`onboarding-main-event-option${
                          mainEvent === event ? ' is-selected' : ''
                        }`}
                        data-testid={`onboarding-main-card-${event}`}
                      >
                        <input
                          type="radio"
                          name="onboarding-main-event"
                          checked={mainEvent === event}
                          onChange={() => handleMainEventChange(event)}
                          data-testid={`onboarding-main-${event}`}
                        />
                        <span>{getEventLabel(event)}</span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="onboarding-note">
                    Import a csTimer file to choose a Main Event.
                  </p>
                )}
              </fieldset>

              <div className="onboarding-actions">
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={handleBackFromSettings}
                  disabled={busy}
                >
                  Back
                </button>
                <button
                  type="button"
                  className="button button-primary"
                  onClick={() => void handleSettingsContinue()}
                  disabled={busy}
                  data-testid="onboarding-settings-continue"
                >
                  Continue
                </button>
              </div>
            </div>
          ) : null}

          {stage === 'appearance' ? (
            <div className="onboarding-step">
              <AppearanceControls
                settings={settings}
                onChange={onChangeSettings}
                testIdPrefix="onboarding-appearance"
              />
              <div className="onboarding-actions">
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={handleBackFromAppearance}
                  disabled={busy}
                >
                  Back
                </button>
                <button
                  type="button"
                  className="button button-primary"
                  onClick={() => void handleAppearanceContinue()}
                  disabled={busy}
                  data-testid="onboarding-appearance-continue"
                >
                  {busy ? 'Saving…' : 'Continue'}
                </button>
              </div>
            </div>
          ) : null}

          {stage === 'sync' ? (
            <div className="onboarding-step">
              <div className="onboarding-sync-state" data-testid="onboarding-sync">
                {syncOutcome === 'idle' ? (
                  <>
                    <div className="onboarding-sync-card">
                      <span className="onboarding-google-mark" aria-hidden="true">
                        G
                      </span>
                      <div className="onboarding-sync-card-copy">
                        <strong>Google Drive</strong>
                        <span>
                          {connected
                            ? 'Connected. Synchronize this device now.'
                            : 'Back up and sync across your devices.'}
                        </span>
                      </div>
                    </div>
                    {connectedSyncLabel ? (
                      <p className="onboarding-note">{connectedSyncLabel}</p>
                    ) : null}
                    <div className="onboarding-sync-choices">
                      <button
                        type="button"
                        className="button button-primary onboarding-sync-choice"
                        onClick={() => void handleConnectForSync()}
                        disabled={busy}
                        data-testid="onboarding-connect-google"
                      >
                        {connected ? 'Sync this device' : 'Connect with Google'}
                      </button>
                      <button
                        type="button"
                        className="button button-secondary onboarding-sync-choice"
                        onClick={() => void handleMaybeLater()}
                        disabled={busy}
                        data-testid="onboarding-maybe-later"
                      >
                        Maybe later
                      </button>
                    </div>
                  </>
                ) : null}

                {syncOutcome === 'connecting' || syncOutcome === 'reading' ? (
                  <div className="onboarding-status" role="status">
                    <span className="onboarding-spinner" aria-hidden="true" />
                    {syncOutcome === 'connecting'
                      ? 'Connecting to Google Drive…'
                      : 'Checking for existing CubeLab data…'}
                  </div>
                ) : null}

                {syncOutcome === 'found' && cloudSummary ? (
                  <div className="onboarding-cloud-found">
                    <h2>Existing CubeLab data found</h2>
                    <p>
                      This Google account already contains{' '}
                      {countLabel(cloudSummary.sessions, 'session', 'sessions')}{' '}
                      and {countLabel(cloudSummary.solves, 'solve', 'solves')}.
                      Sync merges both sides; nothing is deleted automatically.
                    </p>
                    {cloudSummary.events.length > 0 ? (
                      <p className="onboarding-note">
                        Events:{' '}
                        {cloudSummary.events
                          .map((event) => getEventLabel(event))
                          .join(', ')}
                      </p>
                    ) : null}
                    <div className="onboarding-actions is-start">
                      <button
                        type="button"
                        className="button button-primary"
                        onClick={() => void handleCloudMerge()}
                        disabled={busy}
                        data-testid="onboarding-cloud-merge"
                      >
                        Merge and sync
                      </button>
                      <button
                        type="button"
                        className="button button-secondary"
                        onClick={() => void handleMaybeLater()}
                        disabled={busy}
                      >
                        Keep this setup local
                      </button>
                    </div>
                    {draft?.path === 'fresh' && !draft.localCommitted ? (
                      <button
                        type="button"
                        className="onboarding-text-button"
                        onClick={() => void handleRestoreInstead()}
                        disabled={busy}
                      >
                        Restore existing data instead
                      </button>
                    ) : null}
                  </div>
                ) : null}

                {syncOutcome === 'syncing' ? (
                  <div className="onboarding-status" role="status">
                    <span className="onboarding-spinner" aria-hidden="true" />
                    {draft?.path === 'returning'
                      ? 'Restoring sessions and settings…'
                      : 'Synchronizing this setup…'}
                  </div>
                ) : null}

                {syncOutcome === 'synced' ? (
                  <div className="onboarding-synced" role="status">
                    <CheckIcon size={16} />
                    <span>Google Drive is synchronized.</span>
                  </div>
                ) : null}

                {syncOutcome === 'none' && draft?.path === 'returning' ? (
                  <div className="onboarding-cloud-none">
                    <h2>No CubeLab data found</h2>
                    <p>
                      We couldn't find existing CubeLab data in this Google
                      account.
                    </p>
                    <div className="onboarding-actions is-start">
                      <button
                        type="button"
                        className="button button-secondary"
                        onClick={() => void handleReturningConnect(true)}
                      >
                        Try another Google account
                      </button>
                      <button
                        type="button"
                        className="button button-secondary"
                        onClick={handleStartFreshFromNoCloud}
                      >
                        Start Fresh
                      </button>
                      <button
                        type="button"
                        className="button button-secondary"
                        onClick={handleImportFromNoCloud}
                      >
                        Import from csTimer
                      </button>
                    </div>
                    <button
                      type="button"
                      className="onboarding-text-button"
                      onClick={onSkip}
                    >
                      Skip Setup
                    </button>
                  </div>
                ) : null}

                {syncOutcome === 'failed' ? (
                  <div className="onboarding-sync-error" role="alert">
                    <h2>Synchronization did not complete</h2>
                    <p>{syncError || 'Google Drive could not be reached.'}</p>
                    <div className="onboarding-actions is-start">
                      <button
                        type="button"
                        className="button button-primary"
                        onClick={() =>
                          draft?.path === 'returning'
                            ? void handleReturningConnect(true)
                            : void handleConnectForSync()
                        }
                      >
                        Retry
                      </button>
                      {draft?.path !== 'returning' ? (
                        <button
                          type="button"
                          className="button button-secondary"
                          onClick={() => void handleMaybeLater()}
                          disabled={busy}
                        >
                          Continue without sync
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="button button-secondary"
                          onClick={handleContinueWithoutRestore}
                        >
                          Continue without restoring
                        </button>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>

              {syncOutcome === 'idle' || syncOutcome === 'found' ? (
                <div className="onboarding-footer-row">
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() =>
                      setStage(
                        draft?.path === 'returning' ? 'welcome' : 'appearance',
                      )
                    }
                    disabled={
                      busy ||
                      syncOutcome === 'found' ||
                      Boolean(draft?.localCommitted)
                    }
                  >
                    Back
                  </button>
                  {syncOutcome === 'idle' ? (
                    <span className="onboarding-note">
                      You can enable sync later in Settings.
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {stage === 'signin' ? (
            <div className="onboarding-step">
              <p className="onboarding-sync-lead">
                Use the same Google account you use for CubeLab on your other
                device.
              </p>
              <div className="onboarding-actions is-start">
                <button
                  type="button"
                  className="button button-primary"
                  onClick={() => void handleReturningConnect()}
                  data-testid="onboarding-returning-connect"
                >
                  Connect with Google
                </button>
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={goToWelcome}
                >
                  Back
                </button>
              </div>
              {syncOutcome === 'failed' ? (
                <p className="onboarding-error" role="alert">
                  {syncError}
                </p>
              ) : null}
              {!transport ? (
                <p className="onboarding-note is-warning">
                  Google Drive is not configured for this build. You can still
                  start fresh or import from csTimer.
                </p>
              ) : null}
            </div>
          ) : null}

          {stage === 'restore' ? (
            <div className="onboarding-step">
              {syncOutcome === 'connecting' || syncOutcome === 'reading' ? (
                <div className="onboarding-status" role="status">
                  <span className="onboarding-spinner" aria-hidden="true" />
                  {syncOutcome === 'connecting'
                    ? 'Connecting to Google Drive…'
                    : 'Looking for existing CubeLab data…'}
                </div>
              ) : null}
              {syncOutcome === 'found' && cloudSummary ? (
                <>
                  <div className="onboarding-cloud-details">
                    <span>{countLabel(cloudSummary.sessions, 'session', 'sessions')}</span>
                    <span>{countLabel(cloudSummary.solves, 'solve', 'solves')}</span>
                    <span>
                      {countLabel(cloudSummary.files, 'snapshot', 'snapshots')}
                    </span>
                  </div>
                  {cloudSummary.events.length > 0 ? (
                    <p className="onboarding-note">
                      Events:{' '}
                      {cloudSummary.events
                        .map((event) => getEventLabel(event))
                        .join(', ')}
                    </p>
                  ) : null}
                </>
              ) : null}
              {syncOutcome === 'syncing' || syncOutcome === 'found' ? (
                <div className="onboarding-status" role="status">
                  <span className="onboarding-spinner" aria-hidden="true" />
                  Restoring sessions, solves and settings…
                </div>
              ) : null}
              {syncOutcome === 'none' ? (
                <div className="onboarding-cloud-none">
                  <h2>No CubeLab data found</h2>
                  <p>
                    We couldn't find existing CubeLab data in this Google
                    account.
                  </p>
                  <div className="onboarding-actions is-start">
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={() => void handleReturningConnect(true)}
                    >
                      Try another Google account
                    </button>
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={handleStartFreshFromNoCloud}
                    >
                      Start Fresh
                    </button>
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={handleImportFromNoCloud}
                    >
                      Import from csTimer
                    </button>
                  </div>
                  <button
                    type="button"
                    className="onboarding-text-button"
                    onClick={onSkip}
                  >
                    Skip Setup
                  </button>
                </div>
              ) : null}
              {syncOutcome === 'failed' ? (
                <div className="onboarding-sync-error" role="alert">
                  <h2>Restore did not complete</h2>
                  <p>{syncError || 'Google Drive could not be reached.'}</p>
                  <div className="onboarding-actions is-start">
                    <button
                      type="button"
                      className="button button-primary"
                      onClick={() => void handleReturningConnect(true)}
                    >
                      Retry
                    </button>
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={onSkip}
                    >
                      Continue without restoring
                    </button>
                  </div>
                  <p className="onboarding-note">
                    Your cloud data is unchanged. Start fresh or import a
                    backup later from Settings.
                  </p>
                </div>
              ) : null}
              <div className="onboarding-actions">
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={goToWelcome}
                  disabled={syncOutcome === 'syncing'}
                >
                  Back
                </button>
              </div>
            </div>
          ) : null}

          {stage === 'device' ? (
            <div className="onboarding-step">
              <fieldset className="onboarding-choice-group">
                <legend>Scramble view</legend>
                <div className="onboarding-segments">
                  {DRAW_SCRAMBLE_OPTIONS.map((option) => (
                    <label key={option.value} className="onboarding-segment">
                      <input
                        type="radio"
                        name="onboarding-draw-scramble"
                        checked={drawScrambleMode === option.value}
                        onChange={() =>
                          onDrawScrambleModeChange(option.value as DrawScrambleMode)
                        }
                      />
                      <span>{option.label}</span>
                    </label>
                  ))}
                </div>
                <p className="onboarding-note">
                  Stored only in this browser. Synchronized preferences were
                  already applied from Google Drive.
                </p>
              </fieldset>
              <div className="onboarding-actions">
                <button
                  type="button"
                  className="button button-primary"
                  onClick={handleDeviceFinish}
                  data-testid="onboarding-device-finish"
                >
                  Finish setup
                </button>
              </div>
            </div>
          ) : null}

          {stage === 'complete' && completion ? (
            <div className="onboarding-complete">
              <span className="onboarding-complete-icon" aria-hidden="true">
                <CheckIcon size={22} />
              </span>
              <h1 id="onboarding-heading" ref={headingRef} tabIndex={-1}>
                You're all set!
              </h1>
              <p>Your CubeLab setup is ready.</p>
              <dl className="onboarding-summary" aria-live="polite">
                {completion.path === 'fresh' ? (
                  <>
                    <div>
                      <dt>Events selected</dt>
                      <dd>{completion.events ?? completion.sessions}</dd>
                    </div>
                    <div>
                      <dt>Sessions ready</dt>
                      <dd>{completion.sessions}</dd>
                    </div>
                  </>
                ) : completion.path === 'cstimer' ? (
                  <>
                    <div>
                      <dt>Imported sessions</dt>
                      <dd>{formatCount(completion.sessions)}</dd>
                    </div>
                    <div>
                      <dt>Imported solves</dt>
                      <dd>{formatCount(completion.solves)}</dd>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <dt>Restored sessions</dt>
                      <dd>{formatCount(completion.sessions)}</dd>
                    </div>
                    <div>
                      <dt>Restored solves</dt>
                      <dd>{formatCount(completion.solves)}</dd>
                    </div>
                  </>
                )}
                <div>
                  <dt>Main Event</dt>
                  <dd>{getEventLabel(completion.mainEvent)}</dd>
                </div>
                <div>
                  <dt>Google Drive</dt>
                  <dd>
                    {completion.sync === 'synced'
                      ? 'Synchronized'
                      : completion.sync === 'needs-attention'
                        ? 'Needs attention'
                        : completion.sync === 'not-connected'
                          ? 'Not connected'
                          : 'Skipped'}
                  </dd>
                </div>
              </dl>
              <button
                type="button"
                className="button button-primary onboarding-complete-dismiss"
                data-testid="onboarding-complete-dismiss"
                onClick={finishNow}
              >
                Skip to timer
              </button>
            </div>
          ) : null}
        </section>
      </main>
    </div>
  )
}

/**
 * A small self-contained hold/start/stop trainer for the onboarding hold-time
 * step. It mirrors the real timer's hold gate without mounting the application
 * timer or recording a solve.
 */
function HoldTestArea({ holdDurationMs }: { holdDurationMs: number }) {
  const [phase, setPhase] = useState<'idle' | 'holding' | 'ready' | 'running' | 'result'>(
    'idle',
  )
  const [elapsedMs, setElapsedMs] = useState(0)
  const phaseRef = useRef(phase)
  const holdTimeoutRef = useRef<number | null>(null)
  const frameRef = useRef<number | null>(null)
  const startedAtRef = useRef(0)

  const setPhaseSafe = (next: typeof phase) => {
    phaseRef.current = next
    setPhase(next)
  }

  const cancelFrame = () => {
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
  }

  const clearHold = () => {
    if (holdTimeoutRef.current !== null) {
      window.clearTimeout(holdTimeoutRef.current)
      holdTimeoutRef.current = null
    }
  }

  useEffect(
    () => () => {
      clearHold()
      cancelFrame()
    },
    [],
  )

  // oxlint-disable-next-line react/purity -- animation-frame timing is inherently impure
  const tick = () => {
    frameRef.current = null
    if (phaseRef.current !== 'running') return
    // oxlint-disable-next-line react/purity -- rAF timing is inherently impure
    setElapsedMs(performance.now() - startedAtRef.current)
    frameRef.current = window.requestAnimationFrame(tick)
  }

  const begin = () => {
    if (phaseRef.current === 'holding' || phaseRef.current === 'ready') return
    if (phaseRef.current === 'running') {
      cancelFrame()
      setPhaseSafe('result')
      return
    }
    if (phaseRef.current === 'result') {
      setElapsedMs(0)
      setPhaseSafe('idle')
      return
    }
    setElapsedMs(0)
    setPhaseSafe('holding')
    holdTimeoutRef.current = window.setTimeout(() => {
      holdTimeoutRef.current = null
      if (phaseRef.current === 'holding') setPhaseSafe('ready')
    }, Math.max(0, holdDurationMs))
  }

  const release = () => {
    if (phaseRef.current !== 'holding' && phaseRef.current !== 'ready') return
    clearHold()
    if (phaseRef.current !== 'ready') {
      setPhaseSafe('idle')
      return
    }
    startedAtRef.current = performance.now()
    setElapsedMs(0)
    setPhaseSafe('running')
    frameRef.current = window.requestAnimationFrame(tick)
  }

  const cancel = () => {
    clearHold()
    cancelFrame()
    if (phaseRef.current === 'running') return
    setElapsedMs(0)
    setPhaseSafe('idle')
  }

  const label =
    phase === 'holding'
      ? 'Keep holding…'
      : phase === 'ready'
        ? 'Ready — release to start'
        : phase === 'running'
          ? 'Running — press to stop'
          : phase === 'result'
            ? 'Press to try again'
            : 'Hold here, or press and hold Space'

  return (
    <div className="onboarding-hold-test">
      <button
        type="button"
        className={`onboarding-hold-surface is-${phase}`}
        aria-label="Hold to start test"
        aria-describedby="onboarding-hold-test-help"
        data-testid="onboarding-hold-test"
        onPointerDown={(event) => {
          if (event.pointerType === 'mouse' && event.button !== 0) return
          event.preventDefault()
          event.currentTarget.setPointerCapture?.(event.pointerId)
          begin()
        }}
        onPointerUp={(event) => {
          event.preventDefault()
          release()
        }}
        onPointerCancel={cancel}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            cancel()
            return
          }
          if (event.key !== ' ') return
          event.preventDefault()
          event.stopPropagation()
          if (!event.repeat) begin()
        }}
        onKeyUp={(event) => {
          if (event.key !== ' ') return
          event.preventDefault()
          event.stopPropagation()
          release()
        }}
        onBlur={cancel}
      >
        {phase === 'running' || phase === 'result'
          ? `${(elapsedMs / 1000).toFixed(2)} s`
          : '12.34'}
      </button>
      <span className="onboarding-note" id="onboarding-hold-test-help" role="status">
        {label}
      </span>
    </div>
  )
}
