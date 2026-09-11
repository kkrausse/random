/** @jsxImportSource @opentui/solid */
import { strict as assert } from "node:assert"
import { test } from "node:test"
import { extend, testRender } from "@opentui/solid"
import { TextRenderable } from "@opentui/core"
import { SessionPicker } from "./tui"

extend({ spinner: TextRenderable })

test("New session drains a stable cross-location inbox without selecting its owners", async () => {
  const sessions = ["First owner", "Second owner", "Unloaded child"].map((title, i) => ({
    id: `s${i}`, title, location: { directory: i === 0 ? "/first" : "/second", workspaceID: i === 0 ? undefined : "ws2" },
    time: { updated: 100 - i }, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, cost: 0,
  }))
  let requests = [
    { id: "p1", sessionID: "s0", action: "shell", resources: ["first command"] },
    { id: "p2", sessionID: "s2", action: "shell", resources: ["child command"] },
  ]
  let questions = [{ id: "q1", sessionID: "s1", title: "Choose a branch", fields: [{ key: "branch", type: "string", title: "Branch name" }] }]
  const commands: any[] = []
  const replies: any[] = []
  const toasts: any[] = []
  let notify: (event: any) => void = () => {}
  let finish: (() => void) | undefined
  let failReply = false
  let failRefresh = false
  let failFirstLocation = false
  let destination: any
  const empty = async () => []
  const context: any = {
    storage: { store: () => [{ inactive: {} }, async () => {}] },
    theme: {
      text: { default: "#ffffff", subdued: "#888888", status: { permission: "#ffffff", question: "#ffffff", running: "#ffffff" }, feedback: { error: { default: "#ffffff" } } },
      hue: { accent: { 400: "#ffffff" }, yellow: { 400: "#ffff00" } },
      contextual: { overlay: { background: { default: "#000000", surface: { offset: "#444444" } }, scrollbar: { default: "#888888" } } },
    },
    ui: {
      router: { current: () => ({ type: "home" }), navigate: (value: any) => { destination = value } },
      dialog: { clear() {}, prompt: async () => "no matching rows" },
      toast: { show: (value: any) => toasts.push(value) }, format: { path: (path: string) => path },
    },
    keymap: { layer: (fn: any) => commands.push(...fn().commands) },
    data: {
      session: { status: () => "idle", message: { list: () => [], sync: empty }, cost: () => 0 },
      location: { model: { list: () => [], sync: empty } },
      on: () => () => {}, listen: (fn: any) => { notify = fn; return () => {} },
    },
    client: {
      session: {
        list: async ({ cursor }: any) => ({ data: cursor ? [sessions[1]] : [sessions[0]], cursor: cursor ? {} : { next: "page2" } }),
        active: async () => ({}), get: async ({ sessionID }: any) => sessions.find((session) => session.id === sessionID),
      },
      permission: {
        list: async ({ sessionID }: any) => requests.filter((request) => request.sessionID === sessionID),
        request: { list: async ({ location }: any) => {
          if (failRefresh || (failFirstLocation && location.directory === "/first")) throw new Error("inbox unavailable")
          // The inbox must pass the workspace selector for locations on later pages.
          return { data: requests.filter((request) => request.sessionID === "s0" ? location.directory === "/first" : location.workspace === "ws2") }
        } },
        reply: async (input: any) => {
          replies.push(input)
          await new Promise<void>((resolve) => { finish = resolve })
          if (failReply) throw new Error("reply failed")
          requests = requests.filter((request) => request.id !== input.requestID)
        },
      },
      form: { list: empty, request: { list: async ({ location }: any) => ({ data: location.workspace === "ws2" ? questions : [] }) } },
    },
  }
  const setup = await testRender(() => <SessionPicker context={context} archiveStore={{ list: empty, save: async () => {}, remove: async () => {} }} hostDialogInsets={false} />, { width: 36, height: 24 })
  const settle = async () => { await new Promise((resolve) => setTimeout(resolve, 30)); await setup.renderOnce() }
  const changed = () => notify({ details: { type: "permission.asked" } })
  const run = (bind: string) => commands.find((command) => command.bind === bind).run()
  try {
    await settle()
    assert.match(setup.captureCharFrame(), /first command/)
    assert.match(setup.captureCharFrame(), /shell · 1\/2 · \?1/)
    assert.equal(setup.renderer.root.findDescendantById("claude-session-preview-lifecycle"), undefined)
    await run("/")
    await settle()
    assert.match(setup.captureCharFrame(), /first command/, "filtering rows does not hide global requests")
    requests.reverse()
    changed()
    await settle()
    assert.match(setup.captureCharFrame(), /first command/, "refresh keeps the current request steady")

    const first = run("a")
    await settle()
    assert.match(setup.captureCharFrame(), /Sending…/)
    await run("d")
    assert.equal(replies.length, 1)
    failReply = true
    finish!()
    await first
    await settle()
    assert.match(setup.captureCharFrame(), /first command/)
    assert.match(toasts.at(-1).message, /reply failed/)
    failReply = false
    const retry = run("a")
    await settle()
    finish!()
    await retry
    await settle()
    assert.match(setup.captureCharFrame(), /Unloaded child/)
    assert.match(setup.captureCharFrame(), /child command/)
    assert.deepEqual(replies.at(-1), { sessionID: "s0", requestID: "p1", reply: "once" })
    assert.equal(destination, undefined)

    failFirstLocation = true
    changed()
    await settle()
    assert.match(setup.captureCharFrame(), /child command/, "an unavailable location does not hide reachable requests")
    assert.match(setup.captureCharFrame(), /1 unavailable/)
    failFirstLocation = false

    failRefresh = true
    changed()
    await settle()
    await run("a")
    assert.equal(replies.length, 2, "failed refresh disables stale approval controls")
    failRefresh = false
    changed()
    await settle()
    const second = run("shift+a")
    await settle()
    finish!()
    await second
    await settle()
    assert.deepEqual(replies.at(-1), { sessionID: "s2", requestID: "p2", reply: "always" })
    assert.match(setup.captureCharFrame(), /Choose a branch/)
    assert.equal(setup.renderer.root.findDescendantById("claude-session-approve"), undefined)
    await run("a")
    assert.equal(replies.length, 3)
    const open = setup.renderer.root.findDescendantById("claude-session-inbox-open")!
    await setup.mockMouse.click(open.x + 1, open.y)
    assert.deepEqual(destination, { type: "session", sessionID: "s1" })
    questions = []
    notify({ details: { type: "form.replied" } })
    await settle()
    assert.equal(setup.renderer.root.findDescendantById("claude-session-inbox-open"), undefined)
    assert.match(setup.captureCharFrame(), /Start with a blank prompt/)
    run("return")
    assert.deepEqual(destination, { type: "home" }, "Enter on New session still starts a new session")
  } finally {
    setup.renderer.destroy()
  }
})
