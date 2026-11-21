/** Imperative event coordinator. Constructing/reading it never writes; callers hold the active-tab lock. */
import type { StorageLike } from '../storage'
import { createId } from '../id'
import { MAX_SESSION_NAME_LENGTH, resolveSessionName, sessionNameKey, suggestSessionName } from '../sessionNames'
import { loadTraining, saveTraining, deserializeTrainingData } from './storage'
import { assertTrainingData } from './schema'
import { addCalibrationSample, beginCalibration, completeCalibration, decideTrainingActivation, isUsableTrainingCalibration, latestTrainingCalibration, recognitionCount, type CalibrationDraft } from './calibration'
import { appendTrainingAttempt, correctTrainingAttribution, correctTrainingResult, createTrainingAttempt, finishTrainingVisit, removeArchivedTrainingSession } from './records'
import { acknowledgeTrainingReport, activeTrainingSession, beginTrainingSession, transitionTrainingVisit, type TrainingVisitEvent } from './visits'
import { getTrainingDomainSettings } from './settings'
import { trainingOutcome } from './results'
import { algorithmSnapshot, availableAlgorithm, prepareTrainingSetup } from './runtime'
import { preferredAlgorithmSnapshot, resolveCapturedAlgorithm } from './algorithmSelection'
import { browserTrainingDeletionLedger, type TrainingDeletionLedger } from '../trainingDeletion'
import type { TrainingAlgorithmOverrides, TrainingAlgorithmSnapshot, TrainingAttempt, TrainingCalibrationSnapshot, TrainingCaseId, TrainingCategoryId, TrainingCustomAlgorithm, TrainingData, TrainingDomainSettings, TrainingPreset, TrainingReportDestination, TrainingSessionConfiguration, TrainingSetId, TrainingSetupSnapshot } from './types'
import { STANDARD_CASE_BY_ID } from './catalog/standardCases'

export interface TrainingSessionDraft {
  name: string
  categoryId: TrainingCategoryId
  caseIds: readonly TrainingCaseId[]
  algorithmOverrides?: TrainingAlgorithmOverrides
}

export function trainingCategoryName(category: TrainingCategoryId) {
  const [set, mode] = category.split(':')
  return `${set!.toUpperCase()} ${mode === 'recognition' ? 'Recognition' : 'Execution'}`
}

export interface TrainingControllerState {
  readonly data: TrainingData | null
  readonly error: string | null
  readonly pendingSave: boolean
  readonly needsContinuity: boolean
  readonly category: TrainingCategoryId | null
  readonly setup: TrainingSetupSnapshot | null
  readonly preparing: boolean
  readonly calibration: CalibrationDraft | null
  readonly sample: number | null
  readonly lastResultId: string | null
  readonly renewalRecommended: boolean
  readonly idlePrompt: number | null
  readonly closedSessionName?: string
  /** Increments when a whole saved store is adopted (restore/sync). */
  readonly storeEpoch: number
}

export type TrainingBackupSnapshot =
  | { readonly status: 'ready'; readonly data: TrainingData }
  | { readonly status: 'absent' }
  | { readonly status: 'blocked'; readonly reason: string }
interface Options {
  storage?: StorageLike | null
  now?: () => number
  generate?: typeof prepareTrainingSetup
  deletionLedger?: TrainingDeletionLedger
}
interface AttemptContext {
  id: string
  setup: TrainingSetupSnapshot
  visitId: string
  preferredAlgorithm: TrainingAlgorithmSnapshot | null
  algorithmTracking: boolean
  calibration: TrainingCalibrationSnapshot | null
}
/** In-memory handle valid for the latest committed deletion in this controller. */
export interface DeletedTrainingAttempt {
  readonly id: string
}
interface AttemptDeletion {
  readonly token: DeletedTrainingAttempt
  readonly attempt: TrainingAttempt
  readonly index: number
  readonly visitIndex: number
}
interface PendingOperation {
  readonly archiveDeleteId?: string
  readonly restoredAttempt?: TrainingAttempt
  /** Re-asserts deletion intent before a delayed retry writes the candidate. */
  readonly beforeRetry?: () => boolean
  readonly onSaved: () => void
}

export class TrainingController {
  private state: TrainingControllerState
  private savedData: TrainingData | null
  private retryTarget: TrainingCaseId | undefined
  private expectedRaw: string | null = null
  private readonly listeners = new Set<() => void>()
  private readonly storage: StorageLike | null | undefined
  private readonly now: () => number
  private readonly generate: typeof prepareTrainingSetup
  private readonly deletionLedger: TrainingDeletionLedger
  private generation = 0
  private busy = false
  private context: AttemptContext | null = null
  private calibrationRunning = false
  private calibrationId: string | null = null
  private calibrationSource: 'initial' | 'manual' | 'due' = 'initial'
  private pendingBegin: { categoryId: TrainingCategoryId; session: TrainingSessionConfiguration } | null = null
  private recovered = false
  private namedActivityAt: number | null = null
  private attemptDeletion: AttemptDeletion | null = null
  private pendingOperation: PendingOperation | null = null
  constructor(options: Options = {}) {
    this.storage = options.storage
    this.now = options.now ?? Date.now
    this.generate = options.generate ?? prepareTrainingSetup
    this.deletionLedger = options.deletionLedger ?? browserTrainingDeletionLedger
    const loaded = loadTraining(this.storage)
    if (loaded.ok) this.expectedRaw = loaded.raw
    this.savedData = loaded.ok ? loaded.data : null
    this.state = { data: loaded.ok ? loaded.data : null, error: loaded.ok ? null : loaded.error,
      pendingSave: false, needsContinuity: false, category: null, setup: null, preparing: false,
      calibration: null, sample: null, lastResultId: loaded.ok ? loaded.data.attempts.at(-1)?.id ?? null : null, renewalRecommended: false, idlePrompt: null, storeEpoch: 0 }
  }
  getSnapshot = () => this.state
  getSavedData = () => this.savedData
  /**
   * Last committed store for a complete native backup. `absent` is distinct
   * from an unreadable store so the caller can omit an untouched key but must
   * block instead of silently exporting a partial backup.
   */
  getBackupSnapshot = (): TrainingBackupSnapshot => {
    if (this.state.data === null || this.savedData === null) {
      return {
        status: 'blocked',
        reason:
          this.state.error ??
          'Training data could not be read. Restore Training storage before exporting a complete backup.',
      }
    }
    if (this.state.pendingSave) {
      return {
        status: 'blocked',
        reason:
          'A Training save is pending. Retry the save before exporting a complete backup.',
      }
    }
    if (this.state.needsContinuity) {
      return {
        status: 'blocked',
        reason:
          'Training is waiting for a resume or end decision. Resolve it before exporting a complete backup.',
      }
    }
    if (this.state.data.activeVisitId !== null) {
      return {
        status: 'blocked',
        reason:
          'An active Training session is open. Finish or end it before exporting a complete backup.',
      }
    }
    if (this.expectedRaw === null) return { status: 'absent' }
    return { status: 'ready', data: this.savedData }
  }
  /**
   * Adopts the exact bytes a durable replacement already wrote. This must not
   * call saveTraining or write a second time. No imported visit is resumed.
   */
  adoptSavedTraining = (data: TrainingData, raw: string): boolean => {
    let validated: TrainingData
    try {
      assertTrainingData(data)
      validated = deserializeTrainingData(raw)
      if (
        validated.activeVisitId !== null ||
        validated.visits.some((visit) => visit.endedAt === null)
      ) {
        throw new Error(
          'Imported Training history must not contain an active or unfinished session.',
        )
      }
    } catch (error) {
      this.patch({
        error:
          error instanceof Error
            ? `Imported Training history could not be adopted. ${error.message}`
            : 'Imported Training history could not be adopted.',
      })
      return false
    }

    this.expectedRaw = raw
    this.savedData = validated
    this.generation += 1
    this.retryTarget = undefined
    this.busy = false
    this.context = null
    this.calibrationRunning = false
    this.calibrationId = null
    this.pendingBegin = null
    this.recovered = true
    this.namedActivityAt = null
    this.attemptDeletion = null
    this.pendingOperation = null
    this.patch({
      data: validated,
      error: null,
      pendingSave: false,
      needsContinuity: false,
      category: null,
      setup: null,
      preparing: false,
      calibration: null,
      sample: null,
      lastResultId: validated.attempts.at(-1)?.id ?? null,
      renewalRecommended: false,
      idlePrompt: null,
      closedSessionName: undefined,
      storeEpoch: this.state.storeEpoch + 1,
    })
    return true
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private patch(change: Partial<TrainingControllerState>) {
    this.state = { ...this.state, ...change }
    for (const listener of this.listeners) listener()
  }
  private writable() { return !!this.state.data && !this.state.pendingSave && !this.state.needsContinuity }
  private commit(data: TrainingData, change?: Partial<TrainingControllerState>) {
    const operation = this.pendingOperation
    const saved = saveTraining(data, this.expectedRaw, this.storage, operation?.restoredAttempt, operation?.archiveDeleteId)
    if (saved.ok) {
      this.expectedRaw = saved.raw
      this.savedData = data
      this.pendingOperation = null
    }
    this.patch({ ...change, data, pendingSave: !saved.ok, error: saved.ok ? null : saved.error })
    if (saved.ok) operation?.onSaved()
    return saved.ok
  }
  retrySave = () => {
    if (this.busy) return
    if (this.state.pendingSave && this.state.data) {
      if (this.pendingOperation?.beforeRetry && !this.pendingOperation.beforeRetry()) {
        this.patch({ error: 'Deletion metadata could not be saved. The pending change was not committed.' })
        return
      }
      if (this.commit(this.state.data)) {
        if (this.state.calibration?.status === 'complete' && this.state.data.calibrations.some(c => c.id === this.calibrationId)) this.patch({ calibration: null })
        if (this.state.category && !this.state.calibration && !this.state.preparing && !this.state.setup) void this.prepare()
      }
    }
    else if (!this.state.data) {
      const loaded = loadTraining(this.storage)
      if (loaded.ok) { this.expectedRaw = loaded.raw; this.savedData = loaded.data; this.patch({ data: loaded.data, error: null }); this.recovered = false; this.recover('unknown') }
      else this.patch({ error: loaded.error })
    }
  }
  /** No result is discarded to resolve a changed-snapshot conflict. Export both copies for recovery. */
  exportRecovery = () => JSON.stringify({ format: 'cubelab-training-recovery', draft: this.state.data, expectedRaw: this.expectedRaw, stored: loadTraining(this.storage) }, null, 2)
  recover = (continuity: 'refresh' | 'closed' | 'unknown', closedAt?: number) => {
    if (this.busy || !this.state.data || this.state.pendingSave) return
    if (this.recovered && continuity === 'unknown') return
    this.recovered = true
    if (activeTrainingSession(this.state.data)) {
      if (continuity === 'closed') this.endSession({ confirmedClosed: true, closedAt })
      else this.patch({ needsContinuity: true })
      return
    }
    const transition = transitionTrainingVisit(this.state.data, { type: 'startup', continuity, at: this.now() })
    if (transition.decision === 'needs-continuity-signal' || transition.decision === 'legacy-visit-needs-finalization' || transition.decision === 'session-needs-explicit-transition') {
      this.patch({ needsContinuity: true }); return
    }
    this.patch({ needsContinuity: false })
    if (transition.data !== this.state.data) this.commit(transition.data)
  }
  finishLegacyVisit = () => {
    if (this.busy || !this.state.data || this.state.pendingSave) return
    const data = this.state.data
    if (data.visits.some(v => v.id === data.activeVisitId && v.session)) return
    if (data.activeVisitId) this.commit(finishTrainingVisit(data, data.activeVisitId, this.now()))
    this.patch({ needsContinuity: false })
  }
  private visit(event: TrainingVisitEvent) {
    if (!this.writable()) return false
    let transition
    try { transition = transitionTrainingVisit(this.state.data!, event) } catch (error) { this.patch({ error: error instanceof Error ? error.message : 'Visit transition failed.' }); return false }
    if (transition.decision === 'session-needs-explicit-transition') return false
    return transition.data === this.state.data || this.commit(transition.data)
  }
  private activation(category: TrainingCategoryId, event: 'select-mode' | 'begin-attempt') {
    const data = this.state.data!, setId: TrainingSetId = category.startsWith('oll') ? 'oll' : 'pll'
    return decideTrainingActivation({ event, categoryId: category, caseIds: data.preferences.sets[setId].enabledCaseIds,
      calibration: latestTrainingCalibration(data, setId), now: this.now(), recognitionCount: recognitionCount(data, setId), settings: getTrainingDomainSettings(data.preferences) })
  }
  private gate(category: TrainingCategoryId, event: 'select-mode' | 'begin-attempt') {
    const decision = this.activation(category, event)
    if (decision.state === 'invalid-selection') {
      this.patch({ error: decision.reason === 'recognition-needs-two-cases' ? 'Select at least two cases for recognition.' : 'Select a case for execution.', setup: null }); return false
    }
    if (decision.state === 'calibration-required') {
      const setId = category.startsWith('oll') ? 'oll' : 'pll'
      this.calibrationSource = decision.reason === 'renewal-due' ? 'due' : 'initial'
      this.calibrationId = createId()
      this.patch({ calibration: beginCalibration(setId), sample: null, setup: null, error: null }); return false
    }
    this.patch({ renewalRecommended: decision.state === 'ready' && decision.renewalRecommended })
    return decision.state === 'ready'
  }
  beginSession = async ({ name, categoryId, caseIds }: TrainingSessionDraft) => {
    const { data } = this.state
    if (this.busy || !data || !this.writable() || this.pendingBegin || data.activeVisitId) return
    if (data.visits.some(visit => visit.session && visit.lifecycle?.reportPending)) return
    const setId = categoryId.startsWith('oll:') ? 'oll' : 'pll'
    const names = data.visits.flatMap(visit => visit.session ? [visit.session.name] : [])
    const resolved = resolveSessionName(name, suggestSessionName(trainingCategoryName(categoryId), names))
    if (resolved.length > MAX_SESSION_NAME_LENGTH || names.some(existing => sessionNameKey(existing) === sessionNameKey(resolved))) {
      this.patch({ error: 'Choose a unique session name of 40 characters or fewer.' })
      return
    }
    const cases: TrainingSessionConfiguration['cases'][number][] = []
    for (const caseId of new Set(caseIds)) {
      if (STANDARD_CASE_BY_ID.get(caseId)?.setId !== setId) continue
      const algorithm = preferredAlgorithmSnapshot(data, caseId)
      if (algorithm) cases.push({ caseId, algorithm })
    }
    const decision = decideTrainingActivation({ event: 'select-mode', categoryId, caseIds: cases.map(choice => choice.caseId),
      calibration: latestTrainingCalibration(data, setId), now: this.now(), recognitionCount: recognitionCount(data, setId),
      settings: { ...getTrainingDomainSettings(data.preferences), requireRecalibrationWhenDue: true } })
    if (decision.state !== 'ready' && decision.state !== 'calibration-required') {
      this.patch({ error: categoryId.endsWith(':recognition') ? 'Select two cases with usable algorithms.' : 'Select a case with a usable algorithm.' })
      return
    }
    this.pendingBegin = { categoryId, session: { version: 1, name: resolved, cases } }
    if (decision.state === 'calibration-required') {
      this.calibrationId = createId()
      this.calibrationSource = decision.reason === 'renewal-due' ? 'due' : 'initial'
      this.patch({ category: categoryId, calibration: beginCalibration(setId), sample: null, lastResultId: null, error: null, closedSessionName: undefined })
    } else await this.saveBegin(data)
  }

  private async saveBegin(data: TrainingData) {
    const { categoryId, session } = this.pendingBegin!
    const setId = categoryId.startsWith('oll:') ? 'oll' : 'pll'
    const preferences = { ...data.preferences, selectedSetId: setId, sets: { ...data.preferences.sets,
      [setId]: { ...data.preferences.sets[setId], enabledCaseIds: session.cases.map(choice => choice.caseId),
        includeSetupMoves: categoryId.endsWith(':recognition'), selectedPresetId: null },
    } } as const
    const next = beginTrainingSession({ ...data, preferences }, { id: createId(), at: this.now(), categoryId, session })
    this.pendingBegin = null
    this.retryTarget = undefined
    this.attemptDeletion = null
    if (this.commit(next, { category: categoryId, calibration: null, sample: null, setup: null, lastResultId: null, renewalRecommended: false, closedSessionName: undefined })) {
      await this.prepare()
    }
  }

  resumeSession = (onSaved?: () => void) => {
    const data = this.state.data
    const visit = activeTrainingSession(data)
    if (!data || !visit?.lifecycle || this.busy || this.state.pendingSave || !this.state.needsContinuity) return false
    const at = Math.max(this.now(), visit.lifecycle.lastActivityAt)
    const gap = at - visit.lifecycle.lastActivityAt
    const pausedMs = gap >= this.idleInterval(data) ? (visit.lifecycle.pausedMs ?? 0) + gap : visit.lifecycle.pausedMs
    const next = { ...visit, lifecycle: { ...visit.lifecycle, lastActivityAt: at,
      ...(pausedMs === undefined ? {} : { pausedMs }),
    } }
    this.pendingOperation = { onSaved: () => {
      this.namedActivityAt = at
      this.patch({ needsContinuity: false, category: visit.startedCategoryId, lastResultId: visit.attemptIds.at(-1) ?? null })
      onSaved?.()
      void this.prepare()
    } }
    return this.commit({ ...data, visits: data.visits.map(item => item === visit ? next : item) })
  }

  endSession = ({ destination = 'training', confirmedClosed = false, closedAt, onEmpty }: {
    destination?: TrainingReportDestination
    confirmedClosed?: boolean
    closedAt?: number
    onEmpty?: () => void
  } = {}) => {
    const data = this.state.data
    const visit = activeTrainingSession(data)
    if (!data || !visit?.lifecycle || this.busy || this.state.pendingSave) return false
    const idle = this.state.idlePrompt
    const lastActivity = visit.lifecycle.lastActivityAt
    const now = Math.max(this.now(), lastActivity)
    const at = confirmedClosed ? Math.min(now, Math.max(lastActivity, closedAt ?? lastActivity))
      : this.state.needsContinuity ? lastActivity : Math.max(lastActivity, idle ?? now)
    const reason = confirmedClosed ? 'tab-closed' : idle !== null ? 'inactivity'
      : !this.state.needsContinuity && destination !== 'training' ? 'navigation' : 'manual'
    this.generation++
    this.pendingOperation = { onSaved: () => {
      this.clearPractice()
      if (!visit.attemptIds.length) {
        if (confirmedClosed) this.patch({ closedSessionName: visit.session?.name })
        onEmpty?.()
      }
    } }
    return this.commit(finishTrainingVisit(data, visit.id, at, reason, destination))
  }

  dismissClosureNotice = () => this.patch({ closedSessionName: undefined })

  closeSessionReport = (id: string, onSaved?: () => void) => {
    const data = this.state.data
    if (!data || !this.writable() || this.busy || data.activeVisitId) return false
    const next = acknowledgeTrainingReport(data, id, 'session')
    if (next === data) return false
    this.pendingOperation = { onSaved: () => onSaved?.() }
    return this.commit(next)
  }

  deleteArchivedSession = (id: string) => {
    if (this.busy || !this.writable()) return false
    const data = this.state.data!
    const visit = data.visits.find((candidate) => candidate.id === id)
    if (!visit) return false
    const attempts = data.attempts.filter((attempt) => attempt.visitId === id)
    const attemptIds = attempts.map((attempt) => attempt.id)
    // The visit and all attempt tombstones are written in one storage write.
    // A partial ledger state must never outlive a reported failed deletion.
    const recordDeletion = () =>
      this.deletionLedger.recordArchivedSessionDeletion(visit, attempts)
    if (!recordDeletion()) {
      this.patch({ error: 'Training deletion metadata could not be saved. The session was not deleted.' })
      return false
    }
    const revoke = () =>
      this.deletionLedger.revokeArchivedSessionDeletion(id, attemptIds)
    let next: TrainingData | null
    try { next = removeArchivedTrainingSession(data, id) } catch (error) {
      if (!revoke()) {
        this.patch({ error: 'Training deletion metadata could not be revoked. Synchronization is paused until the ledger is repaired.' })
        return false
      }
      this.patch({ error: error instanceof Error ? error.message : 'Training session could not be deleted.' })
      return false
    }
    if (!next) {
      revoke()
      return false
    }
    this.pendingOperation = { archiveDeleteId: id, beforeRetry: recordDeletion, onSaved: () => {
      if (this.attemptDeletion?.attempt.visitId === id) this.attemptDeletion = null
    } }
    const saved = this.commit(next)
    if (!saved && !revoke()) {
      this.patch({ error: 'Training deletion metadata could not be revoked. Synchronization is paused until the ledger is repaired.' })
    }
    return saved
  }

  private idleInterval(data: TrainingData) {
    return getTrainingDomainSettings(data.preferences).inactivityMinutes * 60_000
  }

  notePracticeInput = () => {
    if (!this.state.category || this.state.idlePrompt !== null || !this.writable() || !activeTrainingSession(this.state.data)) return
    this.namedActivityAt = Math.max(this.namedActivityAt ?? 0, this.now())
  }

  checkpointPractice = () => {
    const { data, category } = this.state
    if (!data || !category || this.busy || !this.writable()) return
    const visit = activeTrainingSession(data)
    if (!visit?.lifecycle || this.namedActivityAt === null || this.namedActivityAt <= visit.lifecycle.lastActivityAt) return
    const lastActivityAt = this.namedActivityAt
    this.commit({ ...data, visits: data.visits.map(item => item === visit
      ? { ...visit, lifecycle: { ...visit.lifecycle!, lastActivityAt } } : item) })
  }

  keepPracticing = () => {
    const { data, idlePrompt } = this.state
    const visit = activeTrainingSession(data)
    if (!data || !visit?.lifecycle || idlePrompt === null || !this.writable() || this.busy) return
    const at = Math.max(this.now(), idlePrompt, visit.lifecycle.lastActivityAt)
    const pausedMs = (visit.lifecycle.pausedMs ?? 0) + at - Math.max(idlePrompt, visit.lifecycle.lastActivityAt)
    this.pendingOperation = { onSaved: () => {
      this.namedActivityAt = at
      this.patch({ idlePrompt: null })
    } }
    const next = { ...visit, lifecycle: { ...visit.lifecycle, lastActivityAt: at, pausedMs } }
    this.commit({ ...data, visits: data.visits.map(item => item === visit ? next : item) })
  }

  private clearPractice() {
    this.generation++
    this.pendingBegin = null
    this.retryTarget = undefined
    this.namedActivityAt = null
    this.patch({ idlePrompt: null, category: null, needsContinuity: false, setup: null, preparing: false, calibration: null, sample: null, lastResultId: null })
  }
  private async activateCategory(data: TrainingData, category: TrainingCategoryId, retryCase?: TrainingCaseId) {
    const setId: TrainingSetId = category.startsWith('oll') ? 'oll' : 'pll'
    const preferences = { ...data.preferences, selectedSetId: setId,
      sets: { ...data.preferences.sets, [setId]: { ...data.preferences.sets[setId], includeSetupMoves: category.endsWith('recognition') } } }
    const transition = transitionTrainingVisit({ ...data, preferences }, {
      type: 'select-category', categoryId: category, newVisitId: createId(), at: this.now(),
    })
    if (transition.decision === 'legacy-visit-needs-finalization' || transition.decision === 'session-needs-explicit-transition') {
      this.patch({ needsContinuity: true })
      return
    }
    this.generation++
    this.retryTarget = retryCase
    if (!this.commit(transition.data, {
      category, setup: null, preparing: false, calibration: null, sample: null, renewalRecommended: false,
    })) return
    if (this.gate(category, 'select-mode')) await this.prepare()
  }
  selectCategory = async (category: TrainingCategoryId) => {
    if (this.busy || !this.writable()) return
    await this.activateCategory(this.state.data!, category)
  }
  retryCase = async (caseId: TrainingCaseId) => {
    if (this.busy || !this.writable()) return
    const data = this.state.data!
    const active = activeTrainingSession(data)
    if (active) {
      if (!active.startedCategoryId.endsWith(':execution') || !active.session?.cases.some(choice => choice.caseId === caseId)) return false
      await this.prepare(caseId)
      return true
    }
    const setId = caseId.startsWith('oll') ? 'oll' : 'pll'
    if (!data.preferences.sets[setId].enabledCaseIds.includes(caseId) || !availableAlgorithm(data, caseId)) {
      return false
    }
    await this.activateCategory(data, `${setId}:execution`, caseId)
    return true
  }
  prepare = async (retryCase = this.retryTarget) => {
    const { data, category, setup, calibration } = this.state
    if (this.busy || !this.writable() || !category || calibration || !data?.activeVisitId) return
    const visit = activeTrainingSession(data)
    const previous = setup?.generated.caseId ?? data.attempts.findLast(a => a.categoryId === category && (!visit || a.visitId === visit.id))?.caseId ?? null
    const version = ++this.generation
    this.patch({ preparing: false, setup: null, error: null })
    if (!visit && !this.gate(category, 'begin-attempt')) return
    const setId = category.startsWith('oll') ? 'oll' : 'pll'
    const recognition = category.endsWith('recognition')
    if (visit && recognition && !isUsableTrainingCalibration(latestTrainingCalibration(data, setId), setId, this.now())) {
      this.patch({ error: 'This session’s calibration is unavailable. End the session and begin a new one.' })
      return
    }
    const eligible = visit?.session?.cases.map(choice => choice.caseId) ?? data.preferences.sets[setId].enabledCaseIds.filter(id => availableAlgorithm(data, id))
    if (eligible.length < (recognition ? 2 : 1)) {
      this.patch({ error: recognition ? 'Select two cases with usable algorithms.' : 'Select a case with a usable algorithm.' })
      return
    }
    if (retryCase && !eligible.includes(retryCase)) {
      this.retryTarget = undefined
      this.patch({ error: 'Enable this case in Edit cases to retry it.' })
      return
    }
    this.patch({ preparing: true })
    try {
      const prepared = await this.generate(data, category, previous, retryCase)
      if (version === this.generation) {
        if (visit) {
          const { generated, generatorAlgorithm } = prepared
          const captured = visit.session?.cases.find(choice => choice.caseId === generated.caseId)?.algorithm
          if (`${generated.setId}:${generated.mode}` !== category || !captured || generatorAlgorithm.id !== captured.id ||
            generatorAlgorithm.revision !== captured.revision || (captured.notation !== null && generatorAlgorithm.notation !== captured.notation)) {
            throw new Error('The setup does not match the captured session.')
          }
        }
        this.retryTarget = undefined
        this.patch({ setup: prepared, preparing: false })
      }
    } catch {
      if (version === this.generation) this.patch({ preparing: false, error: 'Could not prepare a setup. Try again or check your cases.' })
    }
  }
  setTimerActive = (active: boolean) => { this.busy = active }
  /** Captured by the shared timer exactly when arming becomes running. */
  beginAttempt = () => {
    if (this.context || this.calibrationRunning || this.state.idlePrompt !== null || !this.writable()) return false
    if (this.state.calibration) {
      if (this.state.calibration.status !== 'collecting' || this.state.sample !== null) return false
      this.calibrationRunning = true; this.busy = true; return true
    }
    const { category, setup, data } = this.state
    if (!category || !setup || !data?.activeVisitId) return false
    const visit = activeTrainingSession(data)
    if (visit ? visit.startedCategoryId !== category : !this.gate(category, 'begin-attempt')) return false
    // Activity before the timer starts closes an expired visit and starts another.
    if (!visit && !this.visit({ type: 'select-category', categoryId: category, newVisitId: createId(), at: this.now() })) return false
    const current = this.state.data!
    // Algorithm tracking is temporarily retired: every new attempt is case-only.
    const algorithmTracking = false
    this.context = { id: createId(), setup: structuredClone(setup), visitId: current.activeVisitId!,
      algorithmTracking,
      preferredAlgorithm: null,
      calibration: category.endsWith('recognition') ? structuredClone(latestTrainingCalibration(current, setup.generated.setId as TrainingSetId)) : null }
    this.busy = true
    return true
  }
  completeAttempt = (rawMs: number) => {
    this.busy = false
    if (this.calibrationRunning) {
      this.calibrationRunning = false
      this.patch({ sample: rawMs }); return 'sample'
    }
    const context = this.context
    this.context = null // consume before save, notification or next generation
    if (!context || !this.state.data) return
    const attempt = createTrainingAttempt({ ...context, rawMs, createdAt: this.now() })
    const next = appendTrainingAttempt(this.state.data, attempt)
    const saved = this.commit(next)
    this.patch({ lastResultId: attempt.id, setup: null })
    if (saved) void this.prepare()
    return saved ? 'saved' : 'unsaved'
  }
  cancelAttempt = () => { this.busy = false; this.context = null; this.calibrationRunning = false }
  acceptSample = (valid = true) => {
    if (this.busy || !this.writable() || !this.state.calibration || this.state.sample === null) return
    const draft = addCalibrationSample(this.state.calibration, this.state.sample, valid)
    this.patch({ calibration: draft, sample: null })
    if (draft.status === 'complete') {
      const next = completeCalibration(this.state.data!, draft, { id: this.calibrationId!, at: this.now(), source: this.calibrationSource })
      if (this.pendingBegin) void this.saveBegin(next)
      else if (this.commit(next)) { this.patch({ calibration: null }); void this.prepare() }
    }
  }
  cancelCalibration = () => {
    if (this.busy || this.state.pendingSave) return
    if (this.pendingBegin) { this.clearPractice(); return }
    this.generation++
    this.patch({ calibration: null, sample: null, category: null, setup: null, preparing: false })
    this.navigate('timer')
  }
  startCalibration = () => {
    if (this.busy || !this.writable() || !this.state.category || activeTrainingSession(this.state.data)) return
    this.calibrationSource = 'manual'; this.calibrationId = createId(); this.generation++
    this.patch({ calibration: beginCalibration(this.state.category.startsWith('oll') ? 'oll' : 'pll'), sample: null, setup: null, preparing: false })
  }
  navigate = (destination: 'timer' | 'analytics') => {
    if (this.busy) return false
    if (this.writable()) this.visit({ type: 'navigate', destination, at: this.now() })
    else if (this.state.pendingSave && this.state.data) {
      // Retain navigation alongside the failed result; Retry still requires the original checked bytes.
      const transition = transitionTrainingVisit(this.state.data, { type: 'navigate', destination, at: this.now() })
      this.patch({ data: transition.data })
    }
    this.generation++
    this.retryTarget = undefined
    this.patch({ category: null, setup: null, calibration: null, sample: null, preparing: false })
    return true
  }
  tick = () => {
    if (this.busy || !this.writable()) return
    const data = this.state.data!
    const named = activeTrainingSession(data)
    if (named?.lifecycle) {
      if (!this.state.category || this.state.idlePrompt !== null) return
      const deadline = Math.max(named.lifecycle.lastActivityAt, this.namedActivityAt ?? 0) + this.idleInterval(data)
      this.checkpointPractice()
      if (this.now() >= deadline) this.patch({ idlePrompt: deadline })
      return
    }
    const wasActive = data.activeVisitId
    this.visit({ type: 'tick', at: this.now() })
    if (wasActive && !this.state.data!.activeVisitId) {
      this.generation++
      this.retryTarget = undefined
      this.patch({ setup: null, preparing: false, error: this.state.pendingSave ? this.state.error : null })
    }
  }
  activity = () => {
    if (activeTrainingSession(this.state.data)) this.notePracticeInput()
    else if (!this.busy && this.writable() && this.state.category) this.visit({ type: 'activity', at: this.now() })
  }
  setEnabledCases = async (setId: TrainingSetId, ids: readonly TrainingCaseId[]) => {
    if (this.busy || !this.writable()) return
    const data = this.state.data!
    if (!this.commit({ ...data, preferences: { ...data.preferences, sets: { ...data.preferences.sets, [setId]: { ...data.preferences.sets[setId], enabledCaseIds: [...ids], selectedPresetId: null } } } })) return
    this.activity()
    if (!activeTrainingSession(data) && this.state.category?.startsWith(setId) && !this.state.calibration) await this.prepare()
  }
  toggleDifficult = (caseId: TrainingCaseId) => {
    if (this.busy || !this.writable()) return
    const data = this.state.data!, setId = caseId.startsWith('oll') ? 'oll' : 'pll', prefs = data.preferences.sets[setId]
    const difficultCaseIds = prefs.difficultCaseIds.includes(caseId) ? prefs.difficultCaseIds.filter(id => id !== caseId) : [...prefs.difficultCaseIds, caseId]
    this.commit({ ...data, preferences: { ...data.preferences, sets: { ...data.preferences.sets, [setId]: { ...prefs, difficultCaseIds } } } })
  }
  saveAlgorithm = async (algorithm: TrainingCustomAlgorithm) => {
    if (this.busy || !this.writable()) return
    const data = this.state.data!
    if (!data.preferences.algorithmTracking || algorithm.verification?.status !== 'verified') return
    if (!this.commit({ ...data, customAlgorithms: [...data.customAlgorithms, algorithm], preferences: { ...data.preferences,
      preferredAlgorithms: [...data.preferences.preferredAlgorithms.filter(p => p.caseId !== algorithm.caseId), { caseId: algorithm.caseId as TrainingCaseId, algorithm: algorithmSnapshot(algorithm) }] } })) return
    this.activity()
    if (!activeTrainingSession(data) && this.state.category && !this.state.calibration) await this.prepare()
  }
  setPreferredAlgorithm = async (caseId: TrainingCaseId, algorithm: TrainingAlgorithmSnapshot | null) => {
    if (this.busy || !this.writable()) return
    const data = this.state.data!
    if (!data.preferences.algorithmTracking || (algorithm && !resolveCapturedAlgorithm(data, caseId, algorithm))) return
    if (!this.commit({ ...data, preferences: { ...data.preferences, preferredAlgorithms: [...data.preferences.preferredAlgorithms.filter(p => p.caseId !== caseId), ...(algorithm ? [{ caseId, algorithm }] : [])] } })) return
    this.activity()
    if (!activeTrainingSession(data)) await this.prepare()
  }
  updateSettings = (domain: TrainingDomainSettings, renewal: { renewalDays: number; renewalAttempts: number }, setId: TrainingSetId, algorithmTracking?: boolean) => {
    if (this.busy || !this.writable()) return
    const data = this.state.data!
    const saved = this.commit({ ...data, preferences: { ...data.preferences, domain,
      ...(algorithmTracking === undefined ? {} : { algorithmTracking: false }), sets: {
      ...data.preferences.sets, [setId]: { ...data.preferences.sets[setId], recognition: renewal },
    } } })
    this.activity()
    return saved
  }
  /** Commit both set renewals and domain settings in one checked write. */
  updateGlobalSettings = (domain: TrainingDomainSettings, renewals: Record<TrainingSetId, { renewalDays: number; renewalAttempts: number }>) => {
    if (this.busy || !this.writable()) return false
    const data = this.state.data!
    const saved = this.commit({ ...data, preferences: { ...data.preferences, domain,
      algorithmTracking: false, sets: {
      ...data.preferences.sets,
      oll: { ...data.preferences.sets.oll, recognition: renewals.oll },
      pll: { ...data.preferences.sets.pll, recognition: renewals.pll },
    } } })
    this.activity()
    return saved
  }
  updateAttempt = (attempt: TrainingAttempt) => {
    if (this.busy || !this.writable()) return
    const data = this.state.data!
    const previous = data.attempts.find(a => a.id === attempt.id)
    if (!previous || data.visits.some(v => v.id === previous.visitId && v.session && v.endedAt !== null)) return
    this.commit({ ...data, attempts: data.attempts.map(a => a.id === attempt.id ? attempt : a) })
  }
  correctResult = (id: string, outcome: 'success' | 'dnf') => {
    const a = this.state.data?.attempts.find(a => a.id === id)
    if (a) this.updateAttempt(correctTrainingResult(a, outcome, Math.max(this.now(), a.createdAt, a.resultCorrectedAt ?? 0)))
  }
  correctAttribution = (id: string, algorithm: TrainingAlgorithmSnapshot | null) => {
    const data = this.state.data
    const attempt = data?.attempts.find(item => item.id === id)
    // Tracking is prospective; an attempt that was attributed while tracking
    // was on remains correctable even if the global preference is now off.
    if (!data || !attempt || attempt.algorithmTracking === false || (algorithm && !resolveCapturedAlgorithm(data, attempt.caseId, algorithm))) return
    this.updateAttempt(correctTrainingAttribution(attempt, algorithm, Math.max(this.now(), attempt.createdAt)))
  }
  deleteAttempt = (id: string, onSaved?: (deleted: DeletedTrainingAttempt) => void) => {
    if (this.busy || !this.writable()) return
    const data = this.state.data!
    const index = data.attempts.findIndex(a => a.id === id)
    const attempt = data.attempts[index]
    if (!attempt) return
    const visit = data.visits.find(v => v.id === attempt.visitId)
    if (visit?.session && visit.endedAt !== null) return
    const visitIndex = visit?.attemptIds.indexOf(id) ?? -1
    if (visitIndex < 0) return
    // Materialize inferred totals before deleting older records without stored counts.
    let counters: Pick<TrainingData, 'recognitionCounts'> = {}
    try {
      if (attempt.mode === 'recognition' && trainingOutcome(attempt.result) !== 'unsupported') {
        counters = { recognitionCounts: { ...data.recognitionCounts, oll: recognitionCount(data, 'oll'), pll: recognitionCount(data, 'pll') } }
      }
    } catch (error) {
      this.patch({ error: error instanceof Error ? error.message : 'Training attempt could not be deleted.' })
      return false
    }
    const token = { id }
    const recordDeletion = () => this.deletionLedger.recordAttemptDeletion(attempt)
    if (!recordDeletion()) {
      this.patch({ error: 'Training deletion metadata could not be saved. The attempt was not deleted.' })
      return false
    }
    this.pendingOperation = {
      beforeRetry: recordDeletion,
      onSaved: () => {
        this.attemptDeletion = { token, attempt, index, visitIndex }
        onSaved?.(token)
      },
    }
    const saved = this.commit({
      ...data, ...counters,
      attempts: data.attempts.toSpliced(index, 1),
      visits: data.visits.map(v => v === visit ? { ...v, attemptIds: v.attemptIds.toSpliced(visitIndex, 1) } : v),
    })
    if (!saved) this.deletionLedger.revokeAttemptDeletion(attempt.id)
    return saved
  }
  undoDeleteAttempt = (token: DeletedTrainingAttempt, onSaved?: () => void) => {
    if (this.busy || !this.writable() || this.attemptDeletion?.token !== token) return
    const { attempt, index, visitIndex } = this.attemptDeletion
    const data = this.state.data!
    const visit = data.visits.find(v => v.id === attempt.visitId)
    if (!visit || (visit.session && visit.endedAt !== null) || data.attempts.some(a => a.id === attempt.id)) return
    if (!this.deletionLedger.revokeAttemptDeletion(attempt.id)) {
      this.patch({ error: 'Training deletion metadata could not be updated. Undo was not applied.' })
      return false
    }
    this.pendingOperation = {
      restoredAttempt: attempt,
      beforeRetry: () => this.deletionLedger.revokeAttemptDeletion(attempt.id),
      onSaved: () => {
        this.attemptDeletion = null
        onSaved?.()
      },
    }
    const saved = this.commit({
      ...data,
      attempts: data.attempts.toSpliced(index, 0, attempt),
      visits: data.visits.map(v => v === visit ? { ...v, attemptIds: v.attemptIds.toSpliced(visitIndex, 0, attempt.id) } : v),
    })
    if (!saved) this.deletionLedger.recordAttemptDeletion(attempt)
    return saved
  }
  acknowledgeReport = (id: string) => {
    if (this.busy || !this.writable()) return
    const data = this.state.data!
    const next = acknowledgeTrainingReport(data, id)
    if (next !== data) this.commit(next)
  }
  savePreset = (name: string, id?: string, draft?: { setId: TrainingSetId; caseIds: readonly TrainingCaseId[]; includeSetupMoves: boolean }) => {
    if (this.busy || !this.writable() || !name.trim()) return
    const data = this.state.data!, setId = draft?.setId ?? data.preferences.selectedSetId, p = data.preferences.sets[setId], previous = data.presets.find(p => p.id === id)
    const preset = { version: 1 as const, id: previous?.id ?? createId(), name: name.trim(), setId,
      caseIds: [...(draft?.caseIds ?? p.enabledCaseIds)], includeSetupMoves: draft?.includeSetupMoves ?? p.includeSetupMoves,
      kind: 'user' as const, createdAt: previous?.createdAt ?? this.now(), updatedAt: this.now() }
    this.commit({ ...data, presets: [...data.presets.filter(p => p.id !== preset.id), preset] })
  }
  deletePreset = (id: string): TrainingPreset | null => {
    if (this.busy || !this.writable()) return null
    const data = this.state.data!
    const preset = data.presets.find((candidate) => candidate.id === id)
    if (!preset) return null
    const recordDeletion = () => this.deletionLedger.recordPresetDeletion(preset)
    if (!recordDeletion()) {
      this.patch({ error: 'Training deletion metadata could not be saved. The preset was not deleted.' })
      return null
    }
    this.pendingOperation = { beforeRetry: recordDeletion, onSaved: () => undefined }
    const saved = this.commit({ ...data, presets: data.presets.filter(p => p.id !== id), preferences: { ...data.preferences, sets: {
      oll: { ...data.preferences.sets.oll, selectedPresetId: null }, pll: { ...data.preferences.sets.pll, selectedPresetId: null },
    } } })
    if (!saved) {
      this.deletionLedger.revokePresetDeletion(id)
      return null
    }
    return preset
  }
  restorePreset = (preset: TrainingPreset): boolean => {
    if (this.busy || !this.writable()) return false
    const data = this.state.data!
    if (data.presets.some((candidate) => candidate.id === preset.id)) return true
    if (!this.deletionLedger.revokePresetDeletion(preset.id)) {
      this.patch({ error: 'Training deletion metadata could not be updated. The preset was not restored.' })
      return false
    }
    const saved = this.commit({
      ...data,
      presets: [...data.presets, preset],
      preferences: {
        ...data.preferences,
        sets: {
          oll: {
            ...data.preferences.sets.oll,
            selectedPresetId:
              data.preferences.sets.oll.selectedPresetId ??
              (preset.setId === 'oll' ? preset.id : null),
          },
          pll: {
            ...data.preferences.sets.pll,
            selectedPresetId:
              data.preferences.sets.pll.selectedPresetId ??
              (preset.setId === 'pll' ? preset.id : null),
          },
        },
      },
    })
    if (!saved) this.deletionLedger.recordPresetDeletion(preset)
    return saved
  }
  applyPreset = async (id: string) => {
    if (this.busy || !this.writable()) return
    const data = this.state.data!
    const preset = data.presets.find(p => p.id === id)
    if (!preset) return
    const { setId } = preset
    const preferences = { ...data.preferences, sets: { ...data.preferences.sets,
      [setId]: { ...data.preferences.sets[setId], enabledCaseIds: [...preset.caseIds], selectedPresetId: preset.id },
    } }
    await this.activateCategory({ ...data, preferences }, `${setId}:${preset.includeSetupMoves ? 'recognition' : 'execution'}`)
  }
}
