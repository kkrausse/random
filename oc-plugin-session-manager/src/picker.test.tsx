/** @jsxImportSource @opentui/solid */
import { strict as assert } from "node:assert"
import { test } from "node:test"
import { extend, testRender } from "@opentui/solid"
import { createStore, reconcile } from "solid-js/store"
import { TextRenderable, type ScrollBoxRenderable } from "@opentui/core"
import { SessionPicker } from "./tui"
import type { Archive, ArchiveStore } from "./archive"
import { INACTIVE_AFTER_MS } from "./session-groups"

// The host registers its spinner; the standalone renderer only needs a row placeholder.
extend({ spinner: TextRenderable })

test("mouse and keyboard selection stay correct across lifecycle reordering", { timeout: 30_000 }, async () => {
  const commands: any[] = []
  const [lifecycle, setLifecycle] = createStore({ inactive: {} as Record<string, boolean> })
  let opened: string | undefined
  let closed = 0
  let withPermission = false
  let badgePermission: string | undefined
  let approved = false
  let finishReply: (() => void) | undefined
  const replies: string[] = []
  let interruptFailure = false
  let storageFailure = false
  let running = false
  let interruptCalls = 0
  let pauseLifecycle = false
  let releaseLifecycle: (() => void) | undefined
  const toasts: Array<{ message: string; variant: string }> = []
  const now = Date.now() - 60_000
  const sessions = Array.from({ length: 40 }, (_, i) => ({
    id: `s${i}`,
    title: `Session ${i}`,
    location: { directory: "/test" },
    time: { updated: now - i },
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    cost: 0,
  }))
  const empty = async () => []
  const handlers = new Map<string, (event: any) => void>()
  const children = [
    { ...sessions[0]!, id: "child", parentID: "s0", title: "Child" },
    { ...sessions[0]!, id: "grandchild", parentID: "child", title: "Grandchild" },
  ]
  const activeChildren = new Set(["grandchild"])
  const deleted = new Set<string>()
  const saved = new Map<string, Archive>()
  const archiveStore: ArchiveStore = {
    list: async () => [...saved.values()],
    save: async (archive) => { if (storageFailure) throw new Error("disk unavailable"); saved.set(archive.transcript.info.id, archive) },
    remove: async (id) => { saved.delete(id) },
  }
  const context: any = {
    storage: {
      store: () => [
        lifecycle,
        async (update: any) => {
          if (storageFailure) throw new Error("disk unavailable")
          if (pauseLifecycle) await new Promise<void>((resolve) => { releaseLifecycle = resolve })
          const draft = { inactive: { ...lifecycle.inactive } }
          update(draft)
          setLifecycle("inactive", reconcile(draft.inactive))
        },
      ],
    },
    ui: {
      router: {
        current: () => ({ type: "home" }),
        navigate: (route: any) => {
          opened = route.sessionID
          if (route.type === "home") closed++
        },
      },
      dialog: { set() {}, clear() { closed++ }, prompt: async () => "Session 20" },
      toast: { show: (toast: any) => toasts.push(toast) },
      format: { path: (s: string) => s },
    },
    keymap: { layer: (fn: any) => commands.push(...fn().commands) },
    data: {
      session: { status: (id: string) => running || activeChildren.has(id) ? "running" : "idle", message: { list: () => [], sync: empty, invalidate() {} }, cost: () => 0 },
      location: { model: { list: () => [], sync: empty } },
      on: (type: string, handler: (event: any) => void) => { handlers.set(type, handler); return () => handlers.delete(type) },
      listen: (handler: (event: any) => void) => { handlers.set("*", handler); return () => handlers.delete("*") },
    },
    client: {
      session: {
        form: { list: empty },
        list: async ({ parentID }: any = {}) => ({ data: (parentID ? children.filter((s) => s.parentID === parentID) : sessions).filter((s) => !deleted.has(s.id)), cursor: {} }),
        active: async () => Object.fromEntries([...activeChildren].map((id) => [id, { type: "running" }])),
        inbox: { list: empty, cancel: empty },
        interrupt: async ({ sessionID }: any) => {
          interruptCalls++
          if (interruptFailure) throw { message: "Unexpected Status", response: { status: 409 } }
          running = false
          activeChildren.delete(sessionID)
          if (badgePermission === sessionID) badgePermission = undefined
        },
        get: async ({ sessionID }: any) => { if (deleted.has(sessionID)) throw { _tag: "SessionNotFoundError", sessionID }; return [...sessions, ...children].find((s) => s.id === sessionID) },
        export: async ({ sessionID }: any) => ({ info: sessions.find((s) => s.id === sessionID), messages: [{ id: "msg_preview", type: "user", text: "Archived transcript remains visible" }] }),
        remove: async ({ sessionID }: any) => {
          for (const id of sessionID === "s0" ? [sessionID, "child", "grandchild"] : [sessionID]) deleted.add(id)
        },
        import: async ({ info }: any) => { deleted.delete(info.id); return info },
      },
      shell: { list: async () => ({ data: [] }), remove: empty },
      permission: {
        list: async ({ sessionID }: any) => withPermission ? [{ id: "p1", sessionID, action: "shell", resources: ["echo hello\n".repeat(30)] }] : [],
        reply: async ({ decision }: any) => {
          replies.push(decision)
          await new Promise<void>((resolve) => { finishReply = resolve })
          approved = true
        },
        request: { list: async () => ({ data: [] }) },
      },
      form: { list: async () => ({ data: [] }) },
    },
  }
  let questions: any[] = [{ id: "q1", sessionID: "grandchild", title: "Choose an option", fields: [] }]
  context.client.form.list = async () => ({ data: questions })
  context.client.session.form.list = async ({ sessionID }: any) => questions.filter((form) => form.sessionID === sessionID)
  context.data.session.permission = {
    list: (sessionID: string) => withPermission || badgePermission === sessionID ? [{ id: "p1", sessionID, action: "shell", resources: ["echo hello\n".repeat(30)] }] : [],
    sync: empty, invalidate() {},
  }
  context.data.session.form = {
    list: (sessionID: string) => questions.filter((form) => form.sessionID === sessionID),
    sync: empty, invalidate() {},
  }
  // Normal previews must use host caches, not session HTTP request methods.
  context.client.permission.list = async () => { throw new Error("Direct preview permission lookup") }
  context.client.session.form.list = async () => { throw new Error("Direct preview form lookup") }
  const setup = await testRender(() => <SessionPicker context={context} archiveStore={archiveStore} hostDialogInsets={false} />, { width: 100, height: 55 })
  try {
    await new Promise((resolve) => setTimeout(resolve, 20))
    await setup.renderOnce()
    assert.match(setup.captureCharFrame(), /Question waiting/, "already-pending questions are discovered when the picker opens")
    questions = []
    handlers.get("form.replied")!({ data: { sessionID: "grandchild" } })
    await new Promise((resolve) => setTimeout(resolve, 20))
    await setup.renderOnce()
    assert.doesNotMatch(setup.captureCharFrame(), /Question waiting/)
    questions = [{ id: "q2", sessionID: "grandchild", title: "Reconnect question", fields: [] }]
    handlers.get("server.connected")!({})
    await new Promise((resolve) => setTimeout(resolve, 20))
    await setup.renderOnce()
    assert.match(setup.captureCharFrame(), /Question waiting/, "reconnect reconciles missed question events")
    questions = []
    handlers.get("form.cancelled")!({ data: { sessionID: "grandchild" } })
    await new Promise((resolve) => setTimeout(resolve, 20))
    await setup.renderOnce()
    context.data.session.form.sync = async (id: string) => { if (id === "s0") throw new Error("cache API unavailable") }
    handlers.get("server.connected")!({})
    await new Promise((resolve) => setTimeout(resolve, 20))
    await setup.renderOnce()
    assert.match(setup.captureCharFrame(), /Status unavailable/)
    assert.match(setup.captureCharFrame(), /Ctrl\+R to retry/)
    context.data.session.form.sync = empty
    commands.find((c) => c.bind === "ctrl+r").run()
    await new Promise((resolve) => setTimeout(resolve, 20))
    await setup.renderOnce()
    assert.doesNotMatch(setup.captureCharFrame(), /Status unavailable/)
    // A running grandchild outside the list page activates its idle parent.
    assert.match(setup.captureCharFrame(), /1 sub-agent running/)
    assert.match(setup.captureCharFrame(), /Grandchild/)
    const parentRow = setup.renderer.root.findDescendantById("claude-session-row-1")!
    const childRow = setup.renderer.root.findDescendantById("claude-session-row-2")!
    const runningTitle = setup.renderer.root.findDescendantById("claude-session-title-1")!
    const idleTitle = setup.renderer.root.findDescendantById("claude-session-title-4")!
    assert.equal(parentRow.height, 1)
    assert.equal(childRow.height, 1)
    assert.equal(runningTitle.x, idleTitle.x)
    assert.match(setup.captureCharFrame(), /\d+[smhdy] ago|just now/)
    assert.doesNotMatch(setup.captureCharFrame(), /\[x\]/)
    assert.doesNotMatch(setup.captureCharFrame(), /❯/)
    setLifecycle("inactive", { s0: true })
    await setup.renderOnce()
    assert.match(setup.captureCharFrame(), /1 sub-agent running/)
    activeChildren.add("child")
    handlers.get("*")!({ details: { type: "session.status", data: { sessionID: "child" } } })
    await new Promise((resolve) => setTimeout(resolve, 20))
    await setup.renderOnce()
    assert.match(setup.captureCharFrame(), /2 sub-agents running/)
    activeChildren.delete("child")
    handlers.get("*")!({ details: { type: "session.idle", data: { sessionID: "child" } } })
    await new Promise((resolve) => setTimeout(resolve, 20))
    await setup.renderOnce()
    assert.match(setup.captureCharFrame(), /1 sub-agent running/)
    activeChildren.add("child")
    badgePermission = "grandchild"
    handlers.get("permission.asked")!({ data: { sessionID: "grandchild" } })
    await new Promise((resolve) => setTimeout(resolve, 20))
    await setup.renderOnce()
    assert.match(setup.captureCharFrame(), /Permission required · 2 sub-agents running/)
    commands.find((c) => c.bind === "down").run()
    commands.find((c) => c.bind === "down").run() // Child action is owned by the root.
    setLifecycle("inactive", "child", true) // Clean up stale child-specific attributes.
    await commands.find((c) => c.bind === "x").run()
    await setup.renderOnce()
    assert.equal(lifecycle.inactive.s0, true)
    assert.equal(lifecycle.inactive.child, undefined, "only the parent owns the marker")
    assert.equal(lifecycle.inactive.grandchild, undefined)
    assert.equal(deleted.size, 0, "soft archive preserves the entire family")
    assert.equal(saved.size, 0, "soft archive does not export transcripts")
    assert.equal(activeChildren.size, 0)
    assert.match(setup.captureCharFrame(), /Session 1/)
    setLifecycle("inactive", "child", false)
    setLifecycle("inactive", "grandchild", false)
    for (const child of children) {
      // Simulate an external deletion after verifying soft archive retained them.
      deleted.add(child.id)
      activeChildren.delete(child.id)
      handlers.get("session.deleted")!({ data: { sessionID: child.id } })
    }
    await setup.renderOnce()
    assert.doesNotMatch(setup.captureCharFrame(), /sub-agents? running/)
    setLifecycle("inactive", "s0", false)
    // The root is still available without an import.
    handlers.get("*")!({ details: { type: "session.created", data: { sessionID: "s0" } } })
    await new Promise((resolve) => setTimeout(resolve, 20))
    await setup.renderOnce()
    const row = setup.renderer.root.findDescendantById("claude-session-row-3")!
    assert.ok(row)
    await setup.mockMouse.click(row.x + 8, row.y)
    await setup.renderOnce()
    assert.match(setup.captureCharFrame(), /Session 2/)
    setup.resize(100, 30)
    for (let i = 0; i < 18; i++) {
      commands.find((c) => c.bind === "down").run()
      await setup.renderOnce()
    }
    const scroll = setup.renderer.root.findDescendantById("claude-session-list") as ScrollBoxRenderable
    assert.ok(scroll.scrollTop > 0)
    const before = scroll.scrollTop
    interruptFailure = true
    running = true
    await commands.find((c) => c.bind === "x").run()
    await setup.renderOnce()
    assert.match(toasts.at(-1)!.message, /Archive session \(s20\).*HTTP 409/)
    assert.equal(toasts.at(-1)!.variant, "error")
    assert.equal(lifecycle.inactive.s20, undefined)
    assert.match(setup.captureCharFrame(), /Session 20/)
    interruptFailure = false
    storageFailure = true
    await commands.find((c) => c.bind === "x").run()
    await setup.renderOnce()
    assert.match(toasts.at(-1)!.message, /Update lifecycle marker.*s20.*disk unavailable/)
    assert.equal(lifecycle.inactive.s20, undefined)
    assert.match(setup.captureCharFrame(), /Session 20/)
    storageFailure = false
    running = true
    pauseLifecycle = true
    const archiving = commands.find((c) => c.bind === "x").run()
    while (!releaseLifecycle) await new Promise((resolve) => setTimeout(resolve, 1))
    await setup.renderOnce()
    assert.doesNotMatch(setup.captureCharFrame(), /Archived transcript remains visible/, "archived preview does not flash before selection advances")
    assert.doesNotMatch(setup.captureCharFrame(), /Updating session…/)
    assert.ok(setup.renderer.root.findDescendantById("claude-session-spinner-s20"), "archive progress stays on the affected row")
    releaseLifecycle()
    await archiving
    pauseLifecycle = false
    releaseLifecycle = undefined
    await setup.renderOnce()
    assert.equal(lifecycle.inactive.s20, true)
    assert.equal(setup.renderer.root.findDescendantById("claude-session-spinner-s20"), undefined)
    assert.equal(opened, undefined)
    assert.equal(scroll.scrollTop, before)
    assert.match(setup.captureCharFrame(), /Session 21/)
    commands.find((c) => c.bind === "up").run()
    await setup.renderOnce()
    // Index reuses this renderable for Session 21 after Session 20 moves away.
    const moved = setup.renderer.root.findDescendantById("claude-session-row-21")!
    await setup.mockMouse.click(moved.x + 8, moved.y)
    await setup.renderOnce()
    assert.match(setup.captureCharFrame(), /Session 21/)
    assert.equal(scroll.scrollTop, before)
    assert.equal(opened, undefined)
    const previous = setup.renderer.root.findDescendantById("claude-session-row-20")!
    await setup.mockMouse.click(previous.x + 8, previous.y, 2)
    await setup.renderOnce()
    assert.match(setup.captureCharFrame(), /Session 21/)
    commands.find((c) => c.bind === "return").run()
    assert.equal(opened, "s21")
    await setup.mockMouse.doubleClick(previous.x + 8, previous.y)
    assert.equal(opened, "s19")

    // Archiving idle sessions also performs API cleanup.
    running = false
    interruptFailure = false
    const callsBeforeIdle = interruptCalls
    // Stop every remaining active session, including the last row in its section.
    for (let i = 0; i < 50; i++) commands.find((c) => c.bind === "up").run()
    commands.find((c) => c.bind === "down").run()
    for (let i = 0; i < 39; i++) {
      await commands.find((c) => c.bind === "x").run()
      await setup.renderOnce()
    }
    assert.equal(Object.values(lifecycle.inactive).filter(Boolean).length, 40)
    assert.ok(interruptCalls > callsBeforeIdle)
    assert.equal(toasts.at(-1)!.message, "Session soft archived; family stopped, history retained")
    assert.match(setup.captureCharFrame(), /\+New session/)
    assert.match(setup.captureCharFrame(), /New session/)

    commands.find((c) => c.bind === "down").run()
    await new Promise((resolve) => setTimeout(resolve, 20))
    await setup.renderOnce()
    assert.match(setup.captureCharFrame(), /Archived/)
    const restore = setup.renderer.root.findDescendantById("claude-session-preview-lifecycle")!
    await setup.mockMouse.click(restore.x + 2, restore.y)
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(lifecycle.inactive.s0, false)
    for (let i = 0; i < 50; i++) commands.find((c) => c.bind === "up").run()
    commands.find((c) => c.bind === "down").run()
    await setup.renderOnce()
    const markInactive = setup.renderer.root.findDescendantById("claude-session-preview-lifecycle")!
    await setup.mockMouse.click(markInactive.x + 2, markInactive.y)
    await new Promise((resolve) => setTimeout(resolve, 300))
    assert.equal(lifecycle.inactive.s0, true)

    // A keyboard-sized phone viewport must retain a usable list and tap actions.
    withPermission = true
    commands.find((c) => c.bind === "down").run()
    await commands.find((c) => c.bind === "r").run()
    sessions[0]!.title = "A long mobile session title that wraps across two lines"
    handlers.get("*")!({ details: { type: "session.created", data: { sessionID: "s0" } } })
    for (let i = 0; i < 50; i++) commands.find((c) => c.bind === "up").run()
    commands.find((c) => c.bind === "down").run()
    await new Promise((resolve) => setTimeout(resolve, 20))
    for (const [width, height] of [[36, 24], [36, 16], [100, 55]]) {
      setup.resize(width!, height!)
      await setup.renderOnce()
      const picker = setup.renderer.root.findDescendantById("claude-session-picker")!
      const preview = setup.renderer.root.findDescendantById("claude-session-preview")!
      const approve = setup.renderer.root.findDescendantById("claude-session-approve")!
      assert.equal(picker.height, width! < 70 ? height : Math.min(40, height! - 2))
      assert.equal(picker.width, width)
      assert.equal(picker.x, 0)
      assert.equal(picker.y, 0)
      const row = setup.renderer.root.findDescendantById("claude-session-row-1")!
      assert.equal(row.x + row.width, picker.x + picker.width, "session rows reach the picker's right edge")
      const timestamp = row.getChildren().at(-1)!
      assert.equal(timestamp.x + timestamp.width, picker.x + picker.width, "timestamps have no reserved right column")
      assert.ok(scroll.height >= 2, `list remains usable at ${width}x${height}`)
      assert.ok(preview.y + preview.height <= picker.y + picker.height)
      assert.ok(approve.y + approve.height <= preview.y + preview.height)
      const lifecycleButton = setup.renderer.root.findDescendantById("claude-session-preview-lifecycle")!
      assert.ok(lifecycleButton.x >= preview.x)
      assert.ok(lifecycleButton.x + lifecycleButton.width <= preview.x + preview.width)
      assert.equal(lifecycleButton.y + lifecycleButton.height, preview.y + preview.height)
      for (const id of ["claude-session-approve", "claude-session-always", "claude-session-deny", ...(width! < 70 ? ["claude-session-open", "claude-session-close"] : [])]) {
        const button = setup.renderer.root.findDescendantById(id)!
        assert.ok(button.x >= preview.x && button.x + button.width <= preview.x + preview.width, `${id} fits at ${width}x${height}`)
      }
      if (width! < 70) {
        assert.doesNotMatch(setup.captureCharFrame(), /Approval required/)
        assert.match(setup.captureCharFrame(), /echo hello/)
        assert.match(setup.captureCharFrame(), /shell · 1\/1/)
        assert.match(setup.captureCharFrame(), /Allow\s+Deny\s+Always/)
        assert.match(setup.captureCharFrame(), /\[Open\] \[Archive\] \[Close\]/)
      }
      const request = setup.renderer.root.findDescendantById("claude-session-request")!
      assert.ok(request.height >= 1)
      assert.equal(request.y + request.height, approve.y)
      assert.equal(approve.height, width! < 70 && height! >= 20 ? 3 : 1)
      assert.equal(approve.y + approve.height, lifecycleButton.y)
    }
    assert.doesNotMatch(setup.captureCharFrame(), /←\/esc close/)
    setup.resize(36, 24)
    await setup.renderOnce()
    const approve = setup.renderer.root.findDescendantById("claude-session-approve")!
    const bounds = [approve.x, approve.y, approve.width, approve.height]
    // Tap the padded edge, outside the text, then try another action while pending.
    await setup.mockMouse.click(approve.x + 1, approve.y)
    await new Promise((resolve) => setTimeout(resolve, 20))
    await setup.renderOnce()
    assert.match(setup.captureCharFrame(), /Sending…/)
    assert.deepEqual([approve.x, approve.y, approve.width, approve.height], bounds)
    const deny = setup.renderer.root.findDescendantById("claude-session-deny")!
    await setup.mockMouse.click(deny.x + 1, deny.y)
    assert.deepEqual(replies, ["once"])
    finishReply!()
    await new Promise((resolve) => setTimeout(resolve, 20))
    await setup.renderOnce()
    assert.equal(approved, true)
    const openButton = setup.renderer.root.findDescendantById("claude-session-open")!
    await setup.mockMouse.click(openButton.x + 1, openButton.y)
    assert.equal(opened, "s0")
    const beforeClose = closed
    const closeButton = setup.renderer.root.findDescendantById("claude-session-close")!
    await setup.mockMouse.click(closeButton.x + 1, closeButton.y)
    assert.equal(closed, beforeClose + 1)
    await commands.find((c) => c.bind === "/").run()
    await setup.renderOnce()
    assert.match(setup.captureCharFrame(), /Session 20/)
    assert.doesNotMatch(setup.captureCharFrame(), /Session 19/)
    commands.find((c) => c.bind === "down").run()
    commands.find((c) => c.bind === "return").run()
    assert.equal(opened, "s20", "soft archived history opens directly without importing")
    await commands.find((c) => c.bind === "r").run()
    assert.equal(deleted.has("s20"), false)
    assert.equal(saved.has("s20"), false)

    // Age is inferred on read: no marker, interrupt, export, or timestamp write.
    withPermission = false
    setup.resize(100, 55)
    const oldTimestamp = Date.now() - INACTIVE_AFTER_MS - 1000
    sessions[20]!.time.updated = oldTimestamp
    const overrides = { ...lifecycle.inactive }
    delete overrides.s20
    setLifecycle("inactive", reconcile(overrides))
    handlers.get("*")!({ details: { type: "session.created", data: { sessionID: "s20" } } })
    const beforeImputation = interruptCalls
    await new Promise((resolve) => setTimeout(resolve, 20))
    await setup.renderOnce()
    assert.match(setup.captureCharFrame(), /Inactive · 7d\+/)
    assert.equal(lifecycle.inactive.s20, undefined)
    assert.equal(interruptCalls, beforeImputation)
    commands.find((c) => c.bind === "down").run()
    await commands.find((c) => c.bind === "r").run()
    assert.equal(lifecycle.inactive.s20, false, "explicit restore overrides the inferred default")
    assert.equal(sessions[20]!.time.updated, oldTimestamp)
    assert.equal(interruptCalls, beforeImputation)
  } finally {
    setup.renderer.destroy()
  }
})
