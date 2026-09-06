export type Attention = "permission" | "question"

export type SessionState = "permission" | "question" | "running" | "idle" | "inactive"

export function isSubagent(session: { parentID?: string | null }): boolean {
  return !!session.parentID
}

// Subagent (child) sessions are hidden from the picker: their permission and
// question requests already surface through the parent, and the extra rows
// are noise. A child whose parent isn't loaded (paging) or which is the
// current session stays visible so its requests can't disappear.
export function visibleSessions<T extends { id: string; parentID?: string | null }>(
  sessions: readonly T[],
  currentSessionID?: string,
): T[] {
  const ids = new Set(sessions.map((session) => session.id))
  return sessions.filter((session) => {
    if (!isSubagent(session)) return true
    if (session.id === currentSessionID) return true
    return !ids.has(session.parentID!)
  })
}

// Fold hidden descendants' attention into their top-level ancestor so a
// child's pending permission/question still lights up the parent row.
// Permission outranks question.
export function propagateAttention<T extends { id: string; parentID?: string | null }>(
  sessions: readonly T[],
  attention: ReadonlyMap<string, Attention>,
  currentSessionID?: string,
): Map<string, Attention> {
  const byID = new Map(sessions.map((session) => [session.id, session]))
  const next = new Map<string, Attention>()
  const rank = (state: Attention) => (state === "permission" ? 0 : 1)
  const ancestorOf = (id: string): string | undefined => {
    let current = byID.get(id)
    const seen = new Set<string>([id])
    while (current?.parentID) {
      const parent = current.parentID
      if (seen.has(parent)) return undefined
      seen.add(parent)
      const parentSession = byID.get(parent)
      if (!parentSession) return parent
      current = parentSession
    }
    return current?.id
  }
  const visible = new Set(visibleSessions(sessions, currentSessionID).map((session) => session.id))
  for (const [id, state] of attention) {
    const ancestor = ancestorOf(id) ?? id
    // Visible sessions keep their own entry; hidden descendants fold into
    // the ancestor so the parent row lights up.
    const target = visible.has(id) || !byID.has(id) ? id : ancestor
    const current = next.get(target)
    if (!current || rank(state) < rank(current)) next.set(target, state)
  }
  return next
}

// All loaded descendants of a session (transitive children), for aggregating
// their pending requests into the parent preview.
export function descendantIDs<T extends { id: string; parentID?: string | null }>(
  sessions: readonly T[],
  sessionID: string,
): string[] {
  const children = new Map<string, string[]>()
  for (const session of sessions) {
    if (!session.parentID) continue
    const list = children.get(session.parentID) ?? []
    list.push(session.id)
    children.set(session.parentID, list)
  }
  const result: string[] = []
  const queue = [...(children.get(sessionID) ?? [])]
  const seen = new Set(queue)
  while (queue.length > 0) {
    const id = queue.shift()!
    result.push(id)
    for (const child of children.get(id) ?? []) {
      if (!seen.has(child)) {
        seen.add(child)
        queue.push(child)
      }
    }
  }
  return result
}

export function stateRank(state: SessionState) {
  if (state === "permission" || state === "question") return 0
  if (state === "running") return 1
  if (state === "idle") return 2
  return 3
}

export function sessionState(attention: "permission" | "question" | undefined, running: boolean, inactive: boolean): SessionState {
  return attention ?? (running ? "running" : inactive ? "inactive" : "idle")
}

export function sortRows<T extends { state: SessionState; session: { id: string; time: { updated: number } } }>(rows: T[]): T[] {
  return rows.sort((a, b) => stateRank(a.state) - stateRank(b.state)
    || b.session.time.updated - a.session.time.updated
    || a.session.id.localeCompare(b.session.id))
}

export function groupLabel(state: SessionState | "new") {
  if (state === "new") return undefined
  return state === "inactive" ? "Inactive" : "Active"
}
