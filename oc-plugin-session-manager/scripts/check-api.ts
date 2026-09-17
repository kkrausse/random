import { strict as assert } from "node:assert"
import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/service"
import { attentionClient } from "../src/attention-api"

// Read-only smoke check against the installed service, not a mocked client.
// Discovery never starts/restarts a service. No prompts or disposable sessions.
const endpoint = await Service.discover()
assert.ok(endpoint, "Start OpenCode before running check:api")
const headers = Service.headers(endpoint)
const signal = AbortSignal.timeout(20_000)
const readOnlyFetch: typeof fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const method = init?.method ?? (input instanceof Request ? input.method : "GET")
  assert.ok(["GET", "HEAD"].includes(method.toUpperCase()), `Read-only check refused ${method}`)
  return fetch(input, { ...init, signal })
}
const client = OpenCode.make({ baseUrl: endpoint.url, headers, fetch: readOnlyFetch })
const info = await client.server.info()
const response = await readOnlyFetch(new URL("/openapi.json", endpoint.url), { headers })
assert.ok(response.ok, `OpenAPI request failed: HTTP ${response.status}`)
const spec = await response.json()

// Check mutation contracts without performing any mutations. These renamed
// fields caused the 2.0.3 -> 2.0.6 break and aren't covered by GET probes.
const reply = spec.paths["/api/session/{sessionID}/permission/{requestID}/reply"]?.post
assert.ok(reply?.requestBody?.content?.["application/json"]?.schema?.required?.includes("decision"),
  "Permission reply contract changed: expected required decision")
const interrupt = spec.paths["/api/session/{sessionID}/interrupt"]?.post
assert.ok(interrupt?.parameters?.some((parameter: { name: string; in: string }) => parameter.name === "resume" && parameter.in === "query"),
  "Interrupt contract changed: expected resume query parameter")

const api = attentionClient(client)
const page = await client.session.list({ limit: 5, order: "desc" }, { signal })
assert.ok(Array.isArray(page.data), "Unexpected session list response")
const active = await client.session.active({ signal })
assert.ok(active && typeof active === "object" && !Array.isArray(active), "Unexpected active-session response")
const directory = process.argv[2] ?? process.cwd()
const requests = await api.discover({ directory }, signal)
for (const session of page.data) await api.probe(session.id, signal)
console.log(`PASS: OpenCode ${info.version}; location attention reads; ${page.data.length} session request probes; permission/interrupt contracts`)
console.log(`Pending at checked location: ${requests.permissions.length} permissions, ${requests.forms.length} questions (contents not printed)`)
if (!page.data.length) console.log("SKIP: per-session reads (service has no sessions)")
console.log("TUI cache capabilities are checked by the plugin at runtime; this check exercises the installed HTTP API only.")
