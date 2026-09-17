import { strict as assert } from "node:assert"
import { test } from "node:test"
import type { Plugin } from "@opencode/plugin/tui"
import type { SessionInfo } from "@opencode/client"
import { attentionAPI, attentionClient } from "./attention-api"

function fixture() {
  let forms: unknown = []
  let permissions: unknown = []
  let status = "idle"
  const calls: unknown[] = []
  const session = { id: "ses_test", location: { directory: "/another/location" } } as SessionInfo
  const data = {
    status: () => status,
    form: {
      list: (id: string, location: unknown) => { calls.push(["forms", id, location]); return forms },
      sync: async () => {}, invalidate() {},
    },
    permission: { list: () => permissions, sync: async () => {}, invalidate() {} },
  }
  const context = { data: { session: data }, client: {} } as unknown as Plugin.Context
  return { api: attentionAPI(context), data, session, calls,
    forms: (value: unknown) => { forms = value }, permissions: (value: unknown) => { permissions = value },
    status: (value: string) => { status = value } }
}

test("host caches drive pending questions, permission priority, and answer removal without direct client calls", async () => {
  const f = fixture()
  const question = { id: "q1", sessionID: f.session.id, title: "Choose", fields: [] }
  f.forms([question])
  await f.api.sync(f.session)
  assert.deepEqual(f.api.read(f.session).forms, [question])
  assert.ok(f.calls.some((call) => JSON.stringify(call) === JSON.stringify(["forms", f.session.id, f.session.location])))
  f.permissions([{ id: "p1", sessionID: f.session.id, action: "shell", resources: ["pwd"] }])
  assert.equal(f.api.read(f.session).permissions.length, 1)
  f.forms([])
  f.permissions([])
  f.status("running")
  assert.deepEqual(f.api.read(f.session), { forms: [], permissions: [], running: true })
})

test("missing capabilities, unknown status, and undefined or malformed caches never look idle", async () => {
  const f = fixture()
  f.forms(undefined)
  await assert.rejects(f.api.sync(f.session), /Status unavailable.*unexpected form list/)
  f.forms([{ id: "q1", sessionID: f.session.id }])
  assert.throws(() => f.api.read(f.session), /Status unavailable/)
  f.forms([])
  f.status("blocked")
  assert.throws(() => f.api.read(f.session), /unexpected session status/)
  f.status("idle")
  Object.assign(f.data.form, { sync: undefined })
  await assert.rejects(f.api.sync(f.session), /missing data.session.form.sync/)
  const client = attentionClient({} as Plugin.Context["client"])
  await assert.rejects(client.discover(f.session.location), /missing client.permission.request.list/)
})

test("a question answered during cache sync triggers a serialized fresh read", async () => {
  const f = fixture()
  let pending = [{ id: "q1", sessionID: f.session.id, title: "Choose", fields: [] }]
  let release!: () => void
  let started!: () => void
  const began = new Promise<void>((resolve) => { started = resolve })
  let calls = 0
  f.data.form.sync = async () => {
    const snapshot = [...pending]
    if (++calls === 1) {
      started()
      await new Promise<void>((resolve) => { release = resolve })
    }
    f.forms(snapshot)
  }
  const first = f.api.sync(f.session)
  await began
  pending = []
  const second = f.api.sync(f.session)
  release()
  await Promise.all([first, second])
  assert.equal(calls, 2)
  assert.deepEqual(f.api.read(f.session).forms, [])
})

test("cross-location adapter validates response shape, forwards cancellation, and uses decision for replies", async () => {
  const calls: any[] = []
  const request = { id: "p1", sessionID: "ses_test", action: "shell", resources: ["pwd"] }
  const client = {
    permission: {
      request: { list: async (...args: unknown[]) => { calls.push(args); return { data: [request] } } },
      reply: async (...args: unknown[]) => { calls.push(args) },
    },
    form: { list: async (...args: unknown[]) => { calls.push(args); return { data: [] } } },
  }
  const api = attentionClient(client as unknown as Plugin.Context["client"])
  const signal = new AbortController().signal
  assert.deepEqual(await api.discover({ directory: "/other" }, signal), { permissions: [request], forms: [] })
  assert.ok(calls.slice(0, 2).every(([input, options]) => input.location.directory === "/other" && options.signal === signal))
  await api.reply(request, "once", signal)
  assert.deepEqual(calls.at(-1), [{ sessionID: request.sessionID, requestID: request.id, decision: "once" }, { signal }])
  client.form.list = async () => ({} as any)
  await assert.rejects(api.discover({ directory: "/other" }), /Status unavailable.*unexpected form list/)
})
