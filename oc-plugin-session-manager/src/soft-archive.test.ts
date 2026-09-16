import { test } from "node:test"
import { strict as assert } from "node:assert"
import { sessionFamily, softArchiveSession } from "./soft-archive"

function fixture() {
  const makeSession = (id: string, parentID?: string, directory = "/one") => ({
    id, parentID, title: id, projectID: "project", location: { directory },
    time: { created: 1, updated: 2 }, cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  })
  const root = makeSession("ses_root")
  const child = makeSession("ses_child", root.id, "/two")
  const grandchild = makeSession("ses_grandchild", child.id)
  const sibling = makeSession("ses_sibling", root.id)
  const sessions = new Map([root, child, grandchild, sibling].map((s) => [s.id, s]))
  const inboxes = new Map([...sessions.keys()].map((id) => [id, [
    { id: `${id}_user`, type: "user" }, { id: `${id}_synthetic`, type: "synthetic" },
    { id: `${id}_move`, type: "move" }, { id: `${id}_compaction`, type: "compaction" },
  ]]))
  const active = new Set(sessions.keys())
  const shells = new Map([
    ["sh_root", { id: "sh_root", directory: "/one", metadata: { sessionID: root.id } }],
    ["sh_child", { id: "sh_child", directory: "/two", metadata: { sessionID: child.id } }],
    ["sh_other", { id: "sh_other", directory: "/one", metadata: { sessionID: "ses_other" } }],
  ])
  const calls: string[] = []
  const client: any = {
    session: {
      get: async ({ sessionID }: any) => { assert.ok(sessions.has(sessionID)); return sessions.get(sessionID) },
      list: async ({ parentID, cursor }: any) => {
        const children = [...sessions.values()].filter((s) => s.parentID === parentID)
        return cursor ? { data: children.slice(1), cursor: {} } : { data: children.slice(0, 1), cursor: children.length > 1 ? { next: "page2" } : {} }
      },
      interrupt: async ({ sessionID, continue: resume }: any) => {
        assert.equal(resume, false)
        calls.push(`interrupt:${sessionID}`)
        active.delete(sessionID)
      },
      active: async () => { calls.push("verify-active"); return Object.fromEntries([...active].map((id) => [id, { type: "running" }])) },
      inbox: {
        list: async ({ sessionID }: any) => inboxes.get(sessionID) ?? [],
        cancel: async ({ sessionID, inboxID }: any) => {
          calls.push(`cancel:${inboxID}`)
          inboxes.set(sessionID, (inboxes.get(sessionID) ?? []).filter((item) => item.id !== inboxID))
        },
      },
      export: async () => assert.fail("soft archive must not export"),
      remove: async () => assert.fail("soft archive must not delete"),
      import: async () => assert.fail("soft archive must not import"),
    },
    shell: {
      list: async ({ location }: any) => ({ data: [...shells.values()].filter((s) => s.directory === location.directory) }),
      remove: async ({ id, location }: any) => {
        const shell = shells.get(id)!
        assert.equal(shell.directory, location.directory)
        calls.push(`shell:${id}`)
        shells.delete(id)
        // Realistic completion: new inbox work AND execution after the first stop.
        inboxes.get(shell.metadata.sessionID)!.push({ id: "msg_completion", type: "synthetic" })
        active.add(shell.metadata.sessionID)
      },
    },
  }
  return { client, root, child, makeSession, sessions, inboxes, active, shells, calls }
}

test("soft archive resolves unloaded ancestors, drains all inbox types and shell completions, retains the whole family", async () => {
  const f = fixture()
  const before = structuredClone([...f.sessions.values()])
  const stopped = await softArchiveSession(f.client, f.child)
  assert.deepEqual(new Set(stopped.map((s) => s.id)), new Set(f.sessions.keys()))
  assert.deepEqual([...f.sessions.values()], before)
  assert.deepEqual([...f.shells.keys()], ["sh_other"])
  assert.equal(f.active.size, 0)
  assert.ok([...f.inboxes.values()].every((items) => !items.length))
  assert.equal(f.calls.filter((call) => call === "verify-active").length, 2)
  assert.ok(f.calls.includes("cancel:msg_completion"))
  assert.ok(f.calls.lastIndexOf("interrupt:ses_child") > f.calls.indexOf("shell:sh_child"))
})

test("a late descendant, shell and inbox are discovered and drained before success", async () => {
  const f = fixture()
  const late = f.makeSession("ses_late", f.child.id, "/two")
  const active = f.client.session.active
  let checks = 0
  f.client.session.active = async () => {
    if (++checks === 1) {
      f.sessions.set(late.id, late)
      f.inboxes.set(late.id, [{ id: "msg_late", type: "synthetic" }])
      f.shells.set("sh_late", { id: "sh_late", directory: "/two", metadata: { sessionID: late.id } })
      f.active.add(late.id)
    }
    return active()
  }
  const stopped = await softArchiveSession(f.client, f.root)
  assert.ok(stopped.some((s) => s.id === late.id))
  assert.equal(f.active.size, 0)
  assert.deepEqual([...f.shells.keys()], ["sh_other"])
  assert.equal(f.inboxes.get(late.id)!.length, 0)
  assert.equal(checks, 3)
})

test("continuous reactivation fails bounded cleanup instead of reporting an archived session", async () => {
  const f = fixture()
  f.client.session.active = async () => ({ [f.root.id]: { type: "running" } })
  await assert.rejects(softArchiveSession(f.client, f.root), /did not settle.*active session: ses_root/)
  assert.equal(f.sessions.size, 4)
})

test("interrupt, shell and inbox failures propagate without touching history", async () => {
  for (const stage of ["interrupt", "shell", "inbox"]) {
    const f = fixture()
    const fail = async () => { throw new Error(`${stage} unavailable`) }
    if (stage === "interrupt") f.client.session.interrupt = fail
    if (stage === "shell") f.client.shell.remove = fail
    if (stage === "inbox") f.client.session.inbox.cancel = fail
    await assert.rejects(softArchiveSession(f.client, f.root), new RegExp(`${stage} unavailable`))
    assert.equal(f.sessions.size, 4)
  }
})

test("invalid ancestry and repeated pagination fail instead of looping", async () => {
  const f = fixture()
  f.root.parentID = f.child.id
  await assert.rejects(sessionFamily(f.client, f.child), /ancestry contains a cycle/)
  f.root.parentID = undefined
  f.client.session.list = async () => ({ data: [], cursor: { next: "same" } })
  await assert.rejects(softArchiveSession(f.client, f.root), /pagination repeated a cursor/)
})
