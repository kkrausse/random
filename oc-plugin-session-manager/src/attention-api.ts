import type { FormInfo, PermissionRequest, SessionInfo } from "@opencode/client"
import type { Plugin } from "@opencode/plugin/tui"

type Client = Plugin.Context["client"]
type Location = SessionInfo["location"]
export type Requests = { permissions: PermissionRequest[]; forms: FormInfo[] }

export class AttentionUnavailable extends Error {
  constructor(detail: string) {
    super(`Status unavailable: ${detail}`)
    this.name = "AttentionUnavailable"
  }
}

// Check capabilities, not version strings: a new patch may still be compatible.
function method(value: unknown, name: string): asserts value is (...args: never[]) => unknown {
  if (typeof value !== "function") throw new AttentionUnavailable(`OpenCode is missing ${name}; update the session-manager plugin`)
}

function requests<T extends PermissionRequest | FormInfo>(value: unknown, kind: "permission" | "form"): T[] {
  if (!Array.isArray(value) || !value.every((item) => item && typeof item.id === "string"
    && typeof item.sessionID === "string"
    && (kind === "form" ? typeof item.title === "string" && Array.isArray(item.fields) : typeof item.action === "string" && Array.isArray(item.resources)))) {
    throw new AttentionUnavailable(`OpenCode returned an unexpected ${kind} list; update the session-manager plugin`)
  }
  return value
}

// The only direct request/approval client calls. Keep the host's authenticated
// client; never construct a second connection in the TUI.
export function attentionClient(client: Client) {
  return {
    async discover(location: Location, signal?: AbortSignal): Promise<Requests> {
      method(client.permission?.request?.list, "client.permission.request.list")
      method(client.form?.list, "client.form.list")
      const [permissions, forms] = await Promise.all([
        client.permission.request.list({ location: { directory: location.directory } }, { signal }),
        client.form.list({ location: { directory: location.directory } }, { signal }),
      ])
      return { permissions: requests(permissions?.data, "permission"), forms: requests(forms?.data, "form") }
    },
    async reply(request: PermissionRequest, decision: "once" | "always" | "reject", signal?: AbortSignal) {
      method(client.permission?.reply, "client.permission.reply")
      await client.permission.reply({ sessionID: request.sessionID, requestID: request.id, decision }, { signal })
    },
    // Used by the read-only installed-service smoke check. Normal previews use
    // the documented TUI caches below rather than these transport methods.
    async probe(sessionID: string, signal?: AbortSignal): Promise<Requests> {
      method(client.permission?.list, "client.permission.list")
      method(client.session?.form?.list, "client.session.form.list")
      const [permissions, forms] = await Promise.all([
        client.permission.list({ sessionID }, { signal }),
        client.session.form.list({ sessionID }, { signal }),
      ])
      return { permissions: requests(permissions, "permission"), forms: requests(forms, "form") }
    },
  }
}

export function attentionAPI(context: Plugin.Context) {
  const data = context.data.session
  // Host cache sync cannot be aborted. Serialize overlapping refreshes and rerun
  // after an event received mid-flight, so an older result cannot win the race.
  const flights = new Map<string, { dirty: boolean; done: Promise<void> }>()
  function read(session: SessionInfo) {
    method(data.permission?.list, "data.session.permission.list")
    method(data.form?.list, "data.session.form.list")
    method(data.status, "data.session.status")
    const permissions = requests<PermissionRequest>(data.permission.list(session.id), "permission")
    const forms = requests<FormInfo>(data.form.list(session.id, session.location), "form")
    const status = data.status(session.id)
    if (status !== "idle" && status !== "running") throw new AttentionUnavailable("OpenCode returned an unexpected session status")
    return { permissions, forms, running: status === "running" }
  }
  return {
    ...attentionClient(context.client),
    read,
    sync(session: SessionInfo): Promise<void> {
      const current = flights.get(session.id)
      if (current) {
        current.dirty = true
        return current.done
      }
      const flight = { dirty: true, done: Promise.resolve() }
      flights.set(session.id, flight)
      flight.done = Promise.resolve().then(async () => {
        method(data.permission?.sync, "data.session.permission.sync")
        method(data.permission?.invalidate, "data.session.permission.invalidate")
        method(data.form?.sync, "data.session.form.sync")
        method(data.form?.invalidate, "data.session.form.invalidate")
        do {
          flight.dirty = false
          data.permission.invalidate(session.id)
          data.form.invalidate(session.id, session.location)
          const results = await Promise.allSettled([data.permission.sync(session.id), data.form.sync(session.id, session.location)])
          for (const result of results) if (result.status === "rejected") throw result.reason
          read(session) // Undefined/malformed caches are failures, never empty lists.
        } while (flight.dirty)
      }).finally(() => { flights.delete(session.id) })
      return flight.done
    },
  }
}
