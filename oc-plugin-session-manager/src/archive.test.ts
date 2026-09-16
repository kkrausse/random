import { test } from "node:test"
import { strict as assert } from "node:assert"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { archiveSession, fileArchiveStore, restoreSession, type ArchiveStore } from "./archive"

function fixture() {
  const session = (id: string, parentID?: string, directory = "/one") => ({
    id, ...(parentID ? { parentID } : {}), title: id, projectID: "project", location: { directory },
    time: { created: 1, updated: 2 }, cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  })
  const root = session("ses_root")
  const child = session("ses_child", root.id, "/two")
  const grandchild = session("ses_grandchild", child.id)
  const sibling = session("ses_sibling", root.id)
  const live = new Map([root, child, grandchild, sibling].map(s => [s.id, s]))
  const shells = new Map([
    ["sh_root", { id: "sh_root", directory: "/one", metadata: { sessionID: root.id } }],
    ["sh_child", { id: "sh_child", directory: "/two", metadata: { sessionID: child.id } }],
    ["sh_unrelated", { id: "sh_unrelated", directory: "/one", metadata: { sessionID: "ses_other" } }],
  ])
  const calls: string[] = []
  const transcript = { info: root, messages: [{ id: "msg_history", type: "user", text: "Keep this conversation" }] }
  const client: any = {
    session: {
      interrupt: async ({ sessionID }: any) => { calls.push(`interrupt:${sessionID}`) },
      list: async ({ parentID, cursor }: any) => {
        if (parentID === root.id) return cursor ? { data: [sibling], cursor: {} } : { data: [child], cursor: { next: "page2" } }
        return { data: [...live.values()].filter(s => s.parentID === parentID), cursor: {} }
      },
      export: async ({ sessionID, sanitize }: any) => { assert.equal(sanitize, false); calls.push(`export:${sessionID}`); return transcript },
      remove: async () => { calls.push("delete"); live.clear() },
      get: async ({ sessionID }: any) => { if (!live.has(sessionID)) throw { _tag: "SessionNotFoundError", sessionID }; return live.get(sessionID) },
      import: async ({ location, ...data }: any) => { calls.push("import"); assert.deepEqual(location, transcript.info.location); assert.deepEqual(data, transcript); live.set(root.id, data.info); return data.info },
    },
    shell: {
      list: async ({ location }: any) => ({ data: [...shells.values()].filter(s => s.directory === location.directory) }),
      remove: async ({ id, location }: any) => { assert.equal(shells.get(id)?.directory, location.directory); calls.push(`shell:${id}`); shells.delete(id) },
    },
  }
  return { client, root, live, shells, calls }
}

test("archives only the parent, cleans paginated descendants across locations, restores only the parent", async () => {
  const directory = await mkdtemp(join(tmpdir(), "session-archive-"))
  try {
    const f = fixture()
    const disk = fileArchiveStore(directory)
    const store: ArchiveStore = { ...disk, save: async (archive) => { await disk.save(archive); f.calls.push("saved") } }
    const archive = await archiveSession(f.client, store, f.root)
    assert.deepEqual(archive.familyIDs.sort(), ["ses_child", "ses_grandchild", "ses_root", "ses_sibling"])
    assert.deepEqual([...f.shells.keys()], ["sh_unrelated"])
    assert.ok(f.calls.indexOf("saved") < f.calls.indexOf("delete"))
    assert.deepEqual(f.calls.filter(c => c.startsWith("export:")), ["export:ses_root"])
    assert.ok(f.calls.includes("interrupt:ses_grandchild"))
    assert.equal(JSON.parse(await readFile(join(directory, "ses_root.json"), "utf8")).transcript.messages[0].text, "Keep this conversation")
    const [loaded] = await fileArchiveStore(directory).list()
    await restoreSession(f.client, store, loaded!)
    assert.deepEqual([...f.live.keys()], ["ses_root"])
    assert.deepEqual(await disk.list(), [])
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test("archive write failure never deletes the live session", async () => {
  const f = fixture()
  await assert.rejects(archiveSession(f.client, { list: async () => [], remove: async () => {}, save: async () => { throw new Error("disk full") } }, f.root), /disk full/)
  assert.ok(!f.calls.includes("delete"))
  assert.ok(f.live.has(f.root.id))
})

test("cleanup failure never exports or deletes; unrelated shell is untouched", async () => {
  const f = fixture()
  f.client.shell.remove = async () => { throw new Error("shell removal failed") }
  await assert.rejects(archiveSession(f.client, { list: async () => [], remove: async () => {}, save: async () => {} }, f.root), /shell removal failed/)
  assert.ok(!f.calls.includes("delete"))
  assert.ok(!f.calls.includes("export:ses_root"))
  assert.ok(f.shells.has("sh_unrelated"))
})

test("delete and import failures retain the saved archive", async () => {
  const f = fixture()
  let saved: any
  const store: ArchiveStore = { list: async () => saved ? [saved] : [], save: async (a) => { saved = a }, remove: async () => { saved = undefined } }
  f.client.session.remove = async () => { throw new Error("delete failed") }
  await assert.rejects(archiveSession(f.client, store, f.root), /delete failed/)
  assert.equal(saved.transcript.info.id, f.root.id)
  f.client.session.import = async () => { throw new Error("import failed") }
  await assert.rejects(restoreSession(f.client, store, saved), /import failed/)
  assert.equal(saved.transcript.info.id, f.root.id)
})

test("a generic HTTP 404 does not confirm session deletion", async () => {
  const f = fixture()
  let saved = false
  f.client.session.get = async () => { throw { status: 404, message: "Proxy route not found" } }
  await assert.rejects(archiveSession(f.client, { list: async () => [], remove: async () => {}, save: async () => { saved = true } }, f.root))
  assert.ok(saved)
})

test("repeated child cursors stop before export or deletion", async () => {
  const f = fixture()
  f.client.session.list = async () => ({ data: [], cursor: { next: "same" } })
  await assert.rejects(archiveSession(f.client, { list: async () => [], remove: async () => {}, save: async () => {} }, f.root), /repeated a cursor/)
  assert.ok(!f.calls.includes("delete"))
  assert.ok(!f.calls.some((call) => call.startsWith("export:")))
})

test("archives inactive sessions in deleted directories while cleaning reachable children", async () => {
  const directory = await mkdtemp(join(tmpdir(), "session-archive-missing-"))
  await rm(directory, { recursive: true })
  const f = fixture()
  f.root.location.directory = directory
  f.client.session.active = async () => ({})
  const interrupt = f.client.session.interrupt
  f.client.session.interrupt = async (input: any) => {
    if (input.sessionID === f.root.id) throw new Error("UnexpectedStatus", { cause: { status: 500 } })
    await interrupt(input)
  }
  const list = f.client.shell.list
  f.client.shell.list = async (input: any) => {
    assert.notEqual(input.location.directory, directory, "must not start a runtime in the missing directory")
    return list(input)
  }
  let saved: any
  await archiveSession(f.client, { list: async () => [], remove: async () => {}, save: async (a) => { saved = a } }, f.root)
  assert.equal(saved.transcript.info.location.directory, directory)
  assert.ok(f.calls.includes("delete"))
  assert.ok(f.calls.includes("shell:sh_child"))
})

test("missing-directory fallback refuses active sessions and unrelated server errors", async () => {
  const directory = await mkdtemp(join(tmpdir(), "session-archive-missing-"))
  await rm(directory, { recursive: true })
  for (const [path, status, active] of [[directory, 500, true], [directory, 503, false], [tmpdir(), 500, false]] as const) {
    const f = fixture()
    f.root.location.directory = path
    f.client.session.active = async () => active ? { [f.root.id]: { type: "running" } } : {}
    f.client.session.interrupt = async () => { throw new Error("UnexpectedStatus", { cause: { status } }) }
    await assert.rejects(archiveSession(f.client, { list: async () => [], remove: async () => {}, save: async () => {} }, f.root), /UnexpectedStatus/)
    assert.ok(!f.calls.includes("delete"))
    assert.ok(!f.calls.includes("export:ses_root"))
  }
})

test("restoring a child with a missing parent explains the required order and retains its archive", async () => {
  const f = fixture()
  const transcript = await f.client.session.export({ sessionID: f.root.id, sanitize: false })
  transcript.info = { ...transcript.info, parentID: "ses_missing_parent" }
  let removed = false
  await assert.rejects(restoreSession(f.client, {
    list: async () => [], save: async () => {}, remove: async () => { removed = true },
  }, { version: 1, archivedAt: 1, familyIDs: [f.root.id], transcript }), /Restore parent session ses_missing_parent/)
  assert.equal(removed, false)
  assert.ok(!f.calls.includes("import"))
})
