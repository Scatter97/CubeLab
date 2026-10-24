import type { SessionsData } from '../types'
import type { SessionRedirect } from './syncStorage'

export interface SessionRedirectMap {
  redirects: Array<{ fromId: string; toId: string }>
  resolve(id: string): string
}

export function normalizeSessionRedirects(
  input: readonly SessionRedirect[],
): SessionRedirect[] {
  const nodes = new Set<string>()
  const union = new Map<string, string>()

  function find(id: string): string {
    if (!union.has(id)) union.set(id, id)
    const root = union.get(id)!
    if (root === id) return id
    const canonical = find(root)
    union.set(id, canonical)
    return canonical
  }

  function merge(fromId: string, toId: string): void {
    if (fromId === toId || !fromId || !toId) return
    const rootA = find(fromId)
    const rootB = find(toId)
    if (rootA !== rootB) {
      // The smallest stable identifier becomes canonical so that every
      // participant gets the same permanent target.
      const canonical = rootA < rootB ? rootA : rootB
      union.set(rootA, canonical)
      union.set(rootB, canonical)
    }
  }

  for (const redirect of input) {
    nodes.add(redirect.fromId)
    nodes.add(redirect.toId)
    merge(redirect.fromId, redirect.toId)
  }

  const approvedAt = new Map(input.map((redirect) => [
    `${redirect.fromId}:${redirect.toId}`,
    redirect.approvedAt,
  ]))

  const seen = new Set<string>()
  const result: SessionRedirect[] = []
  for (const id of nodes) {
    const canonical = find(id)
    if (canonical === id) continue
    const key = `${id}:${canonical}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push({
      fromId: id,
      toId: canonical,
      approvedAt: approvedAt.get(key) ?? input.find((r) => r.fromId === id)?.approvedAt ?? Date.now(),
      byDeviceId: input.find((r) => r.fromId === id)?.byDeviceId,
    })
  }

  // Ensure every historical mapping remains current.
  const all = new Map(result.map((redirect) => [redirect.fromId, redirect]))
  for (const redirect of all.values()) {
    const deeper = all.get(redirect.toId)
    if (deeper && deeper.fromId !== redirect.toId && deeper.toId !== redirect.toId) {
      redirect.toId = deeper.toId
    }
  }

  return [...new Map(result.map((redirect) => [redirect.fromId, redirect])).values()]
}

export function applySessionRedirects(
  data: SessionsData,
  redirects: ReadonlyArray<SessionRedirect>,
): SessionsData {
  if (redirects.length === 0) return data

  const normalized = normalizeSessionRedirects(redirects)
  const targetById = new Map(normalized.map((redirect) => [redirect.fromId, redirect.toId]))

  function canonical(id: string): string {
    let current = id
    const seen = new Set<string>()
    while (targetById.has(current) && !seen.has(current)) {
      seen.add(current)
      current = targetById.get(current)!
    }
    return current
  }

  const sessionsById = new Map(data.sessions.map((session) => [session.id, { ...session, solves: [...session.solves] }]))
  const solveOwner = new Map<string, string>()

  for (const session of data.sessions) {
    for (const solve of session.solves) {
      solveOwner.set(solve.id, session.id)
    }
  }

  for (const [fromId, toId] of targetById.entries()) {
    const source = sessionsById.get(fromId)
    if (!source) continue

    if (!sessionsById.has(toId)) {
      const canonicalSession = source
      sessionsById.set(toId, {
        id: toId,
        name: canonicalSession.name,
        createdAt: canonicalSession.createdAt,
        updatedAt: canonicalSession.updatedAt,
        solves: [],
        inspectionEnabled: canonicalSession.inspectionEnabled,
      })
    }

    const target = sessionsById.get(toId)!
    for (const solve of source.solves) {
      const existing = target.solves.find((candidate) => candidate.id === solve.id)
      if (!existing) {
        target.solves.push(solve)
      } else if (
        (solve.updatedAt ?? solve.createdAt) > (existing.updatedAt ?? existing.createdAt)
      ) {
        const index = target.solves.indexOf(existing)
        target.solves[index] = solve
      }
    }

    sessionsById.delete(fromId)
  }

  const sessions = [...sessionsById.values()]
  if (sessions.length === 0) return data

  const nextActiveId = canonical(data.activeSessionId)
  const activeSessionId = sessions.some((session) => session.id === nextActiveId)
    ? nextActiveId
    : sessions[0]!.id

  return {
    activeSessionId,
    sessions,
  }
}