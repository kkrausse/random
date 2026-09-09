/** @jsxImportSource @opentui/solid */
import { strict as assert } from "node:assert"
import { test } from "node:test"
import { extend, testRender } from "@opentui/solid"
import { createStore, reconcile } from "solid-js/store"
import { TextRenderable, type ScrollBoxRenderable } from "@opentui/core"
import { SessionPicker } from "./tui"
import type { Archive, ArchiveStore } from "./archive"

// The host registers its spinner; the standalone renderer only needs a row placeholder.
extend({ spinner: TextRenderable })

test("mouse and keyboard selection stay correct across lifecycle reordering", async () => {
  const commands: any[] = []
  const [lifecycle, setLifecycle] = createStore({ inactive: {} as Record<string, boolean> })
  let opened: string | undefined
  let closed = 0
  let withPermission = false
  let approved = false
  let finishReply: (() => void) | undefined
  const replies: string[] = []
  let interruptFailure = false
  let storageFailure = false
  let running = false
  let interruptCalls = 0
  const toasts: Array<{ message: string; variant: string }> = []
  const sessions = Array.from({ length: 40 }, (_, i) => ({
    id: `s${i}`,
    title: `Session ${i}`,
    location: { directory: "/test" },
    time: { updated: 1000 - i },
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
          const draft = { inactive: { ...lifecycle.inactive } }
          update(draft)
          setLifecycle("inactive", reconcile(draft.inactive))
        },
      ],
    },
    theme: {
      text: {
        default: "#ffffff",
        subdued: "#888888",
        status: { permission: "#ffffff", question: "#ffffff", running: "#ffffff" },
        feedback: { error: { default: "#ffffff" } },
      },
      hue: { accent: { 400: "#ffffff" }, yellow: { 400: "#ffff00" } },
      contextual: {
        overlay: {
          background: { default: "#000000", surface: { offset: "#444444" } },
          scrollbar: { default: "#888888" },
        },
      },
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
      session: { status: (id: string) => running || activeChildren.has(id) ? "running" : "idle", message: { list: () => [], sync: empty }, cost: () => 0 },
      location: { model: { list: () => [], sync: empty } },
      on: (type: string, handler: (event: any) => void) => { handlers.set(type, handler); return () => handlers.delete(type) },
      listen: () => () => {},
    },
    client: {
      session: {
        list: async ({ parentID }: any = {}) => ({ data: (parentID ? children.filter((s) => s.parentID === parentID) : sessions).filter((s) => !deleted.has(s.id)), cursor: {} }),
        active: async () => Object.fromEntries([...activeChildren].map((id) => [id, { type: "running" }])),
        interrupt: async ({ sessionID }: any) => {
          interruptCalls++
          if (interruptFailure) throw { message: "Unexpected Status", response: { status: 409 } }
          running = false
          activeChildren.delete(sessionID)
        },
        get: async ({ sessionID }: any) => { if (deleted.has(sessionID)) throw { response: { status: 404 } }; return [...sessions, ...children].find((s) => s.id === sessionID) },
        export: async ({ sessionID }: any) => ({ info: sessions.find((s) => s.id === sessionID), messages: [] }),
        remove: async ({ sessionID }: any) => {
          for (const id of sessionID === "s0" ? [sessionID, "child", "grandchild"] : [sessionID]) deleted.add(id)
        },
        import: async ({ info }: any) => { deleted.delete(info.id); return info },
      },
      shell: { list: async () => ({ data: [] }), remove: empty },
      permission: {
        list: async ({ sessionID }: any) => withPermission ? [{ id: "p1", sessionID, action: "shell", resources: ["echo hello\n".repeat(30)] }] : [],
        reply: async ({ reply }: any) => {
          replies.push(reply)
          await new Promise<void>((resolve) => { finishReply = resolve })
          approved = true
        },
        request: { list: async () => ({ data: [] }) },
      },
      form: { list: empty, request: { list: async () => ({ data: [] }) } },
    },
  }
  const setup = await testRender(() => <SessionPicker context={context} archiveStore={archiveStore} />, { width: 100, height: 55 })
  try {
    await new Promise((resolve) => setTimeout(resolve, 20))
    await setup.renderOnce()
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
    handlers.get("session.status")!({ data: { sessionID: "child" } })
    await new Promise((resolve) => setTimeout(resolve, 20))
    await setup.renderOnce()
    assert.match(setup.captureCharFrame(), /2 sub-agents running/)
    activeChildren.delete("child")
    handlers.get("session.idle")!({ data: { sessionID: "child" } })
    await new Promise((resolve) => setTimeout(resolve, 20))
    await setup.renderOnce()
    assert.match(setup.captureCharFrame(), /1 sub-agent running/)
    activeChildren.add("child")
    handlers.get("permission.asked")!({ data: { sessionID: "grandchild" } })
    await setup.renderOnce()
    assert.match(setup.captureCharFrame(), /Permission required · 2 sub-agents running/)
    commands.find((c) => c.bind === "down").run()
    await commands.find((c) => c.bind === "x").run()
    await setup.renderOnce()
    assert.equal(lifecycle.inactive.s0, true)
    assert.equal(lifecycle.inactive.child, undefined)
    assert.equal(lifecycle.inactive.grandchild, undefined)
    assert.equal(activeChildren.size, 0)
    assert.match(setup.captureCharFrame(), /Session 1/)
    setLifecycle("inactive", "child", false)
    setLifecycle("inactive", "grandchild", false)
    for (const child of children) {
      activeChildren.delete(child.id)
      handlers.get("session.deleted")!({ data: { sessionID: child.id } })
    }
    await setup.renderOnce()
    assert.doesNotMatch(setup.captureCharFrame(), /sub-agents? running/)
    setLifecycle("inactive", "s0", false)
    // Restore the archived root; children intentionally remain deleted.
    const archivedRoot = saved.get("s0")!
    await context.client.session.import(archivedRoot.transcript)
    await archiveStore.remove("s0")
    handlers.get("session.created")!({ data: { sessionID: "s0" } })
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
    assert.match(toasts.at(-1)!.message, /Archive session.*s20.*disk unavailable/)
    assert.equal(lifecycle.inactive.s20, undefined)
    assert.match(setup.captureCharFrame(), /Session 20/)
    storageFailure = false
    running = true
    await commands.find((c) => c.bind === "x").run()
    await new Promise((resolve) => setTimeout(resolve, 20))
    await setup.renderOnce()
    assert.equal(lifecycle.inactive.s20, true)
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
    assert.equal(toasts.at(-1)!.message, "Session archived; family deleted")
    assert.match(setup.captureCharFrame(), /\+New session/)
    assert.match(setup.captureCharFrame(), /New session/)

    commands.find((c) => c.bind === "down").run()
    await new Promise((resolve) => setTimeout(resolve, 20))
    await setup.renderOnce()
    const restore = setup.renderer.root.findDescendantById("claude-session-preview-lifecycle")!
    await setup.mockMouse.click(restore.x + 2, restore.y)
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(lifecycle.inactive.s0, undefined)
    for (let i = 0; i < 50; i++) commands.find((c) => c.bind === "up").run()
    commands.find((c) => c.bind === "down").run()
    await setup.renderOnce()
    const markInactive = setup.renderer.root.findDescendantById("claude-session-preview-lifecycle")!
    await setup.mockMouse.click(markInactive.x + 2, markInactive.y)
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(lifecycle.inactive.s0, true)

    // A keyboard-sized phone viewport must retain a usable list and tap actions.
    withPermission = true
    commands.find((c) => c.bind === "down").run()
    await commands.find((c) => c.bind === "r").run()
    sessions[0]!.title = "A long mobile session title that wraps across two lines"
    handlers.get("session.created")!({ data: { sessionID: "s0" } })
    for (let i = 0; i < 50; i++) commands.find((c) => c.bind === "up").run()
    commands.find((c) => c.bind === "down").run()
    await new Promise((resolve) => setTimeout(resolve, 20))
    for (const [width, height] of [[36, 24], [36, 16], [100, 55]]) {
      setup.resize(width!, height!)
      await setup.renderOnce()
      const picker = setup.renderer.root.findDescendantById("claude-session-picker")!
      const preview = setup.renderer.root.findDescendantById("claude-session-preview")!
      const approve = setup.renderer.root.findDescendantById("claude-session-approve")!
      assert.equal(picker.height, height)
      assert.equal(picker.width, width)
      assert.equal(picker.x, 0)
      assert.equal(picker.y, 0)
      const row = setup.renderer.root.findDescendantById("claude-session-row-1")!
      assert.equal(row.x + row.width, width, "session rows reach the terminal's right edge")
      const timestamp = row.getChildren().at(-1)!
      assert.equal(timestamp.x + timestamp.width, width, "timestamps have no reserved right column")
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
    assert.match(toasts.at(-1)!.message, /press r to import/)
    await commands.find((c) => c.bind === "r").run()
    assert.equal(deleted.has("s20"), false)
    assert.equal(saved.has("s20"), false)
  } finally {
    setup.renderer.destroy()
  }
})
