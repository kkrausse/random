import type { Plugin } from "@opencode-ai/plugin/tui"
import type { FormInfo, PermissionRequest, SessionInfo } from "@opencode-ai/client"
import { Effect } from "effect"
import { operation } from "./effects"

export type Inbox = { sessions: SessionInfo[]; permissions: PermissionRequest[]; forms: FormInfo[]; errors: string[] }

// Discover every live location, not just the picker's loaded/filtered rows.
export function loadInbox(client: Plugin.Context["client"]) {
  return Effect.gen(function* () {
    const sessions = new Map<string, SessionInfo>()
    const cursors = new Set<string>()
    let cursor: string | undefined
    do {
      const page = yield* operation({ operation: "Load inbox sessions" }, (signal) =>
        client.session.list({ limit: 100, order: "desc", ...(cursor ? { cursor } : {}) }, { signal }))
      for (const session of page.data) sessions.set(session.id, session)
      cursor = page.cursor.next ?? undefined
      if (cursor && cursors.has(cursor)) throw new Error("Inbox session pagination repeated a cursor")
      if (cursor) cursors.add(cursor)
    } while (cursor)
    const locations = new Map([...sessions.values()].map((session) =>
      [`${session.location.workspaceID ?? ""}\0${session.location.directory}`, session.location]))
    const requests = yield* Effect.all([...locations.values()].map((location) => Effect.all([
      operation({ operation: "Load inbox permissions", directory: location.directory }, (signal) =>
        client.permission.request.list({ location: { directory: location.directory, workspace: location.workspaceID } }, { signal })),
      operation({ operation: "Load inbox questions", directory: location.directory }, (signal) =>
        client.form.request.list({ location: { directory: location.directory, workspace: location.workspaceID } }, { signal })),
    ], { concurrency: 2 }).pipe(
      Effect.map(([permissions, forms]) => ({ permissions: permissions.data, forms: forms.data, error: undefined as string | undefined })),
      Effect.catch((error) => Effect.sync(() => {
        console.error(`[claude.sessions] ${error.message}`, error)
        return { permissions: [] as PermissionRequest[], forms: [] as FormInfo[], error: error.message }
      })),
    )), { concurrency: 4 })
    const permissions = pendingOrder([], requests.flatMap((result) => result.permissions))
    const forms = pendingOrder([], requests.flatMap((result) => result.forms))
    // Location request lists can include children absent from the session pages.
    const missing = [...new Set([...permissions, ...forms].map((request) => request.sessionID))]
      .filter((id) => !sessions.has(id))
    yield* Effect.all(missing.map((sessionID) => operation({ operation: "Load inbox owner", sessionID }, (signal) =>
      client.session.get({ sessionID }, { signal })).pipe(Effect.tap((session) => Effect.sync(() => { sessions.set(session.id, session) })))), { concurrency: 4 })
    return { sessions: [...sessions.values()], permissions, forms, errors: requests.flatMap((result) => result.error ? [result.error] : []) } satisfies Inbox
  })
}

export const requestKey = (request: { sessionID: string; id: string }) => `${request.sessionID}\0${request.id}`

// Keep the displayed request steady when new requests arrive or list ordering changes.
export function pendingOrder<T extends { sessionID: string; id: string }>(previous: readonly T[], incoming: readonly T[]): T[] {
  const next = new Map(incoming.map((request) => [requestKey(request), request]))
  const ordered: T[] = []
  for (const request of previous) {
    const key = requestKey(request)
    const fresh = next.get(key)
    if (!fresh) continue
    ordered.push(fresh)
    next.delete(key)
  }
  return [...ordered, ...next.values()]
}
