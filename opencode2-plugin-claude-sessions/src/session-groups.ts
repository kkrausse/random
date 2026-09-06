export type SessionState = "permission" | "question" | "running" | "idle" | "inactive"

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
  return ["Needs input", "Working", "Active · ready", "Inactive"][stateRank(state)]
}
