import { strict as assert } from "node:assert"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { setTimeout as settle } from "node:timers/promises"
import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/service"
import { softArchiveSession } from "../src/soft-archive"

// Opt-in: only disposable fixtures, no model prompts or shared-service restart.
const endpoint = await Service.discover()
assert.ok(endpoint, "Start an OpenCode V2 service before running this check")
const client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) })
const directory = await mkdtemp(join(tmpdir(), "session-manager-soft-archive-"))
const location = { directory }
const ids = new Set<string>()
const shells = new Set<string>()
try {
  const root = await client.session.create({ title: "Soft archive audit (disposable)", location })
  ids.add(root.id)
  const child = await client.session.import({
    info: { ...root, id: `ses_${randomUUID().replaceAll("-", "")}`, parentID: root.id }, messages: [], location,
  })
  ids.add(child.id)
  const before = new Map()
  for (const sessionID of ids) {
    await client.session.shell({ sessionID, command: "printf retained-soft-archive-history" })
    before.set(sessionID, (await client.session.export({ sessionID, sanitize: false })).messages)
    const queued = await client.session.synthetic({ sessionID, text: "Disposable queued fixture", delivery: "queue", resume: false })
    assert.ok((await client.session.inbox.list({ sessionID })).some((item) => item.id === queued.id))
  }
  const owned = await client.shell.create({ location, command: "sleep 60", timeout: 60_000, metadata: { sessionID: child.id } })
  shells.add(owned.data.id)
  const unrelated = await client.shell.create({ location, command: "sleep 60", timeout: 60_000 })
  shells.add(unrelated.data.id)

  // Selecting an unloaded child must still stop the entire family.
  const stopped = await softArchiveSession(client, child)
  assert.deepEqual(new Set(stopped.map((s) => s.id)), ids)
  // Observe again after the bounded cleanup has returned.
  await settle(500)
  const active = await client.session.active()
  for (const sessionID of ids) {
    assert.equal((await client.session.get({ sessionID })).id, sessionID)
    assert.deepEqual((await client.session.export({ sessionID, sanitize: false })).messages, before.get(sessionID))
    assert.deepEqual(await client.session.inbox.list({ sessionID }), [])
    assert.equal(active[sessionID], undefined)
  }
  const remaining = (await client.shell.list({ location })).data
  assert.ok(remaining.some((shell) => shell.id === unrelated.data.id))
  assert.ok(!remaining.some((shell) => shell.id === owned.data.id))
  assert.ok((await client.session.list({ parentID: root.id })).data.some((session) => session.id === child.id))
  console.log("PASS: soft archive retains parent/child history, clears durable inboxes and owned shells, and stays inactive after cleanup")
} finally {
  for (const id of shells) await client.shell.remove({ id, location }).catch(() => {})
  for (const sessionID of ids) await client.session.remove({ sessionID }).catch(() => {})
  await rm(directory, { recursive: true, force: true })
}
