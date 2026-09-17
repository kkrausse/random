import type { Plugin } from "@opencode/plugin/tui"
import type { FormInfo, PermissionRequest, SessionInfo } from "@opencode/client"
import { Effect } from "effect"
import { operation } from "./effects"
import { attentionClient } from "./attention-api"

export type Inbox = { sessions: SessionInfo[]; permissions: PermissionRequest[]; forms: FormInfo[]; errors: string[] }

// Query the controller's loaded/current/active locations independently of the
// picker filter. Inbox discovery never fetches session history.
export function loadInbox(client: Plugin.Context["client"], knownSessions: readonly SessionInfo[]) {
  return Effect.gen(function* () {
    const sessions = new Map(knownSessions.map((session) => [session.id, session]))
    const locations = new Map([...sessions.values()].map((session) =>
      [session.location.directory, session.location]))
    const requests = yield* Effect.all([...locations.values()].map((location) =>
      operation({ operation: "Load inbox requests", directory: location.directory }, (signal) =>
        attentionClient(client).discover(location, signal)).pipe(
      Effect.map((requests) => ({ ...requests, error: undefined as string | undefined })),
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
