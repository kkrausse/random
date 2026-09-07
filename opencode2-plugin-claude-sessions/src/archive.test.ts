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
      import: async (data: any) => { calls.push("import"); assert.deepEqual(data, transcript); live.set(root.id, data.info); return data.info },
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
