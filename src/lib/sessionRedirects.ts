import type { SessionsData, Solve, Session } from '../types'
import type { SessionRedirect } from './syncStorage'
import { mergeSolveFields } from './solveMerge'

export interface SessionRedirectMap {
  redirects: Array<{ fromId: string; toId: string }>
  resolve(id: string): string
}

/** Honor the approved destination, rather than electing the smallest ID. */
export function normalizeSessionRedirects(input: readonly SessionRedirect[]): SessionRedirect[] {
  const directed = new Map<string, SessionRedirect>()
  // Newer approvals supersede older decisions for the same source. Stable
  // sorting handles identical timestamps regardless of input order.
  const sorted = [...input].filter((r) => r.fromId && r.toId && r.fromId !== r.toId)
    .sort((a, b) => b.approvedAt - a.approvedAt ||
      a.fromId.localeCompare(b.fromId) || a.toId.localeCompare(b.toId))
  for (const redirect of sorted) {
    if (directed.has(redirect.fromId)) continue
    let cursor = redirect.toId
    const seen = new Set([redirect.fromId])
    let cycle = false
    while (directed.has(cursor)) {
      if (seen.has(cursor)) { cycle = true; break }
      seen.add(cursor)
      cursor = directed.get(cursor)!.toId
    }
    if (seen.has(cursor)) cycle = true
    if (!cycle) directed.set(redirect.fromId, redirect)
  }
  return [...directed.values()].map((item) => {
    let toId = item.toId
    const seen = new Set([item.fromId])
    while (directed.has(toId) && !seen.has(toId)) {
      seen.add(toId)
      toId = directed.get(toId)!.toId
    }
    return { ...item, toId }
  }).sort((a,b) => a.fromId.localeCompare(b.fromId))
}

export function applySessionRedirects(data: SessionsData, redirects: ReadonlyArray<SessionRedirect>): SessionsData {
  const normalized = normalizeSessionRedirects(redirects)
  if (!normalized.length) return data
  const mapping = new Map(normalized.map((r) => [r.fromId, r.toId]))
  const canonical = (id: string): string => mapping.get(id) ?? id
  const original = new Map(data.sessions.map((s) => [s.id, s]))
  const sessions = new Map<string, Session>()
  const grouped = new Map<string, Session[]>()
  for (const session of data.sessions) {
    const id = canonical(session.id)
    grouped.set(id, [...(grouped.get(id) ?? []), session])
  }
  for (const [id, members] of grouped) {
    const target = original.get(id) ?? members[0]!
    if (members.some((s) => (s.event ?? '333') !== (target.event ?? '333'))) {
      throw new Error(`Approved merge would combine incompatible puzzle events (${id}).`)
    }
    const solves = new Map<string, Solve>()
    for (const session of members) {
      for (const solve of session.solves) {
        if (solve.event !== (target.event ?? '333')) throw new Error(`Solve ${solve.id} has incompatible event.`)
        const existing = solves.get(solve.id)
        solves.set(solve.id, existing ? mergeSolveFields(existing, solve, false, []) : solve)
      }
    }
    const newest = [...members].sort((a,b)=> b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))[0]!
    sessions.set(id, {
      ...target, id,
      createdAt: Math.min(...members.map((m) => m.createdAt)),
      updatedAt: Math.max(...members.map((m) => m.updatedAt)),
      preferences: { ...newest.preferences, ...target.preferences },
      solves: [...solves.values()].sort((a,b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id)),
    })
  }
  const list = [...sessions.values()]
  if (!list.length) return data
  const active = canonical(data.activeSessionId)
  return { activeSessionId: sessions.has(active) ? active : list[0]!.id, sessions: list }
}
