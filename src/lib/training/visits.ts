/** Pure decisions only. The caller supplies continuity; no listeners, hooks or navigation. */
import { createTrainingVisit, finishTrainingVisit } from './records'
import { assertTrainingData, assertTrainingJson } from './schema'
import { assertTrainingTimestamp, getTrainingDomainSettings } from './settings'
import type { TrainingCategoryId, TrainingData, TrainingSessionConfiguration } from './types'

type EventBase = { readonly at: number; readonly attemptRunning?: boolean }
export type TrainingVisitEvent = EventBase & (
  | { readonly type: 'open-training' | 'activity' | 'tick' | 'tab-closed' }
  | { readonly type: 'select-category'; readonly categoryId: TrainingCategoryId; readonly newVisitId: string }
  | { readonly type: 'navigate'; readonly destination: 'timer' | 'analytics' }
  | { readonly type: 'startup'; readonly continuity: 'refresh' | 'closed' | 'unknown'; readonly closedAt?: number }
)
export type TrainingVisitDecision = 'unchanged' | 'started' | 'resumed' | 'continued' | 'ended' | 'switched' | 'deferred-running' | 'needs-continuity-signal' | 'legacy-visit-needs-finalization' | 'session-needs-explicit-transition'
export interface TrainingVisitTransition { readonly decision: TrainingVisitDecision; readonly data: TrainingData }

export function activeTrainingSession(data: TrainingData | null) {
  return data?.visits.find(visit => visit.id === data.activeVisitId && visit.session !== undefined)
}

/** Begin with validated, selected revisions supplied by the future practice flow. */
export function beginTrainingSession(data: TrainingData, input: {
  readonly id: string
  readonly at: number
  readonly categoryId: TrainingCategoryId
  readonly session: TrainingSessionConfiguration
}): TrainingData {
  assertTrainingData(data)
  if (data.activeVisitId !== null) throw new Error('End the active Training visit before beginning a session')
  if (data.visits.some((v) => v.id === input.id)) throw new Error('Visit ID already exists')
  const visit = createTrainingVisit(input.categoryId, input.at, input.id, getTrainingDomainSettings(data.preferences))
  assertTrainingJson(input.session)
  const session = structuredClone(input.session)
  const next = { ...data, activeVisitId: visit.id, visits: [...data.visits, { ...visit, session }] }
  assertTrainingData(next)
  return next
}

export function transitionTrainingVisit(data: TrainingData, event: TrainingVisitEvent): TrainingVisitTransition {
  assertTrainingData(data)
  assertTrainingTimestamp(event.at)
  const visit = data.visits.find((v) => v.id === data.activeVisitId)
  if (visit?.session) return { decision: event.attemptRunning ? 'deferred-running' : 'session-needs-explicit-transition', data }
  if (visit && (event.at < (visit.lifecycle?.lastActivityAt ?? visit.startedAt) || data.attempts.some((a) => a.visitId === visit.id && a.createdAt > event.at))) throw new Error('Lifecycle event predates visit activity')
  const result = (decision: TrainingVisitDecision, next = data): TrainingVisitTransition => { assertTrainingData(next); return { decision, data: next } }
  if (event.attemptRunning) return result('deferred-running')
  if (event.type === 'startup' && event.continuity === 'unknown' && visit) return result('needs-continuity-signal')
  if (visit && !visit.lifecycle) return result('legacy-visit-needs-finalization')
  if (event.type === 'open-training') return result('unchanged')
  let next = data
  let active = visit
  if (active && event.type === 'startup' && event.continuity === 'closed') {
    // A confirmed closure with no reliable close timestamp uses the last known activity.
    const at = event.closedAt ?? active.lifecycle!.lastActivityAt
    assertTrainingTimestamp(at)
    if (at < active.lifecycle!.lastActivityAt || at > event.at) throw new Error('Invalid tab-closure timestamp')
    return result('ended', finishTrainingVisit(next, active.id, at, 'tab-closed'))
  }
  if (active && event.at - active.lifecycle!.lastActivityAt >= active.lifecycle!.inactivityMinutes * 60_000) {
    next = finishTrainingVisit(next, active.id, active.lifecycle!.lastActivityAt + active.lifecycle!.inactivityMinutes * 60_000, 'inactivity')
    active = undefined
  }
  if (event.type === 'select-category') {
    if (active?.startedCategoryId === event.categoryId) {
      return result('continued', { ...next, visits: next.visits.map((v) => v.id === active!.id ? { ...v, lifecycle: { ...v.lifecycle!, lastActivityAt: event.at } } : v) })
    }
    if (active) next = finishTrainingVisit(next, active.id, event.at, 'category-switch')
    if (next.visits.some((v) => v.id === event.newVisitId)) throw new Error('Visit ID already exists')
    const settings = getTrainingDomainSettings(next.preferences)
    const created = createTrainingVisit(event.categoryId, event.at, event.newVisitId, settings)
    return result(visit ? 'switched' : 'started', { ...next, activeVisitId: created.id, visits: [...next.visits, created] })
  }
  if (!active) return result(next === data ? 'unchanged' : 'ended', next)
  if (event.type === 'navigate' || event.type === 'tab-closed') return result('ended', finishTrainingVisit(next, active.id, event.at, event.type === 'navigate' ? 'navigation' : 'tab-closed'))
  if (event.type === 'activity' || event.type === 'startup') return result(event.type === 'startup' ? 'resumed' : 'continued', {
    ...next, visits: next.visits.map((v) => v.id === active!.id ? { ...v, lifecycle: { ...v.lifecycle!, lastActivityAt: event.at } } : v),
  })
  return result('unchanged', next)
}

export function pendingTrainingReports(data: TrainingData, kind: 'legacy' | 'session' = 'legacy'): readonly string[] {
  return data.visits.filter((v) => Boolean(v.session) === (kind === 'session') && v.lifecycle?.reportPending).map((v) => v.id)
}
export function acknowledgeTrainingReport(data: TrainingData, visitId: string, kind: 'legacy' | 'session' = 'legacy'): TrainingData {
  assertTrainingData(data)
  const index = data.visits.findIndex((v) => v.id === visitId && Boolean(v.session) === (kind === 'session'))
  const visit = data.visits[index]
  if (!visit?.lifecycle?.reportPending) return data
  return { ...data, visits: data.visits.with(index, { ...visit, lifecycle: { ...visit.lifecycle, reportPending: false } }) }
}
