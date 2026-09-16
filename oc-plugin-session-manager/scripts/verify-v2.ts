import { strict as assert } from "node:assert"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/service"
import { archiveSession, fileArchiveStore, restoreSession } from "../src/archive"

// Explicit opt-in integration check. Uses only sessions/shells created here;
// never prompts a model or reads the user's archive directory.
const endpoint = await Service.discover()
assert.ok(endpoint, "Start an OpenCode V2 service before running this check")
const client = OpenCode.make({ baseUrl: endpoint.url, headers: Service.headers(endpoint) })
const directory = await mkdtemp(join(tmpdir(), "session-manager-v2-"))
const location = { directory }
const store = fileArchiveStore(join(directory, "archives"))
const ids = new Set<string>()
const shells = new Set<string>()
try {
  const root = await client.session.create({ title: "Session manager V2 audit (disposable)", location })
  ids.add(root.id)
  await client.session.shell({ sessionID: root.id, command: "printf session-manager-archive-roundtrip" })
  const seed = await client.session.export({ sessionID: root.id, sanitize: false })
  const now = Date.now()
  seed.messages.push(
    { id: `msg_${randomUUID()}`, type: "user", time: { created: now }, text: "Keep this audit conversation" },
    { id: `msg_${randomUUID()}`, type: "assistant", time: { created: now + 1, completed: now + 2 },
      agent: "build", model: { providerID: "audit", id: "fixture" },
      content: [{ type: "text", text: "Retained assistant response" }], finish: "stop" },
  )
  await client.session.remove({ sessionID: root.id })
  await client.session.import({ ...seed, location })
  const before = await client.session.export({ sessionID: root.id, sanitize: false })
  assert.ok(before.messages.some((message) => message.type === "user"))
  assert.ok(before.messages.some((message) => message.type === "assistant"))
  const child = await client.session.import({
    info: { ...root, id: `ses_${randomUUID().replaceAll("-", "")}`, parentID: root.id }, messages: [], location,
  })
  ids.add(child.id)
  const owned = await client.shell.create({ location, command: "sleep 60", timeout: 60_000, metadata: { sessionID: child.id } })
  shells.add(owned.data.id)
  const unrelated = await client.shell.create({ location, command: "sleep 60", timeout: 60_000 })
  shells.add(unrelated.data.id)
  const archive = await archiveSession(client, store, root)
  assert.deepEqual(new Set(archive.familyIDs), ids)
  assert.deepEqual(archive.transcript.messages, before.messages)
  const remaining = (await client.shell.list({ location })).data
  assert.ok(remaining.some((shell) => shell.id === unrelated.data.id))
  assert.ok(!remaining.some((shell) => shell.id === owned.data.id))
  for (const sessionID of ids) await assert.rejects(client.session.get({ sessionID }), (error: any) => error?._tag === "SessionNotFoundError")
  const restored = await restoreSession(client, store, (await store.list())[0]!)
  ids.add(restored.id)
  assert.equal(restored.location.directory, root.location.directory, "Restore must preserve the archived location")
  assert.equal(restored.id, root.id)
  assert.deepEqual((await client.session.export({ sessionID: restored.id, sanitize: false })).messages, before.messages)
  assert.deepEqual((await client.session.list({ parentID: restored.id })).data, [])
  assert.deepEqual(await client.session.inbox.list({ sessionID: restored.id }), [])
  assert.deepEqual(await store.list(), [])
  await assert.rejects(client.session.import({ ...archive.transcript, location }), (error: any) => error?._tag === "ConflictError")
  const missingDirectory = join(directory, "removed-project")
  await mkdir(missingDirectory)
  const orphan = await client.session.create({ title: "Disposable removed-directory archive check", location: { directory: missingDirectory } })
  ids.add(orphan.id)
  await rm(missingDirectory, { recursive: true })
  const orphanArchive = await archiveSession(client, store, orphan)
  assert.equal(orphanArchive.transcript.info.location.directory, missingDirectory)
  await assert.rejects(client.session.get({ sessionID: orphan.id }), (error: any) => error?._tag === "SessionNotFoundError")
  assert.ok((await store.list()).some((item) => item.transcript.info.id === orphan.id))
  console.log("PASS: inactive session in a deleted directory archives successfully and retains its original location")
  console.log("PASS: V2 archive/export/delete/import round trip, child cleanup, shell ownership, location, and idle restore")
} finally {
  for (const id of shells) await client.shell.remove({ id, location }).catch(() => {})
  for (const sessionID of ids) await client.session.remove({ sessionID }).catch(() => {})
  await rm(directory, { recursive: true, force: true })
}
