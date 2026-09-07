/** @jsxImportSource @opentui/solid */
import { strict as assert } from "node:assert"
import { test } from "node:test"
import { extend, testRender } from "@opentui/solid"
import { createStore, reconcile } from "solid-js/store"
import { TextRenderable, type ScrollBoxRenderable } from "@opentui/core"
import { SessionPicker } from "./tui"

// The host registers its spinner; the standalone renderer only needs a row placeholder.
extend({ spinner: TextRenderable })

test("mouse and keyboard selection stay correct across lifecycle reordering", async () => {
  const commands: any[] = []
  const [lifecycle, setLifecycle] = createStore({ inactive: {} as Record<string, boolean> })
  let opened: string | undefined
  let closed = 0
  let withPermission = false
  let approved = false
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
      hue: { accent: { 400: "#ffffff" } },
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
        },
      },
      dialog: { set() {}, clear() { closed++ } },
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
        list: async () => ({ data: sessions, cursor: {} }),
        active: async () => Object.fromEntries([...activeChildren].map((id) => [id, { type: "running" }])),
        interrupt: async ({ sessionID }: any) => {
          interruptCalls++
          if (interruptFailure) throw { message: "Unexpected Status", response: { status: 409 } }
          running = false
          activeChildren.delete(sessionID)
        },
        get: async ({ sessionID }: any) => [...sessions, ...children].find((s) => s.id === sessionID),
      },
      permission: {
        list: async ({ sessionID }: any) => withPermission ? [{ id: "p1", sessionID, action: "shell", resources: ["echo hello\n".repeat(30)] }] : [],
        reply: async () => { approved = true },
        request: { list: async () => ({ data: [] }) },
      },
      form: { list: empty, request: { list: async () => ({ data: [] }) } },
    },
  }
  const setup = await testRender(() => <SessionPicker context={context} />, { width: 100, height: 55 })
  try {
    await new Promise((resolve) => setTimeout(resolve, 20))
    await setup.renderOnce()
    // A running grandchild outside the list page activates its idle parent.
    assert.match(setup.captureCharFrame(), /1 sub-agent running/)
    assert.match(setup.captureCharFrame(), /Grandchild/)
    const parentRow = setup.renderer.root.findDescendantById("claude-session-row-1")!
    const childRow = setup.renderer.root.findDescendantById("claude-session-row-2")!
    assert.equal(parentRow.height, 1)
    assert.equal(childRow.height, 1)
    assert.match(setup.captureCharFrame(), /\d+[smhdy] ago|just now/)
    assert.doesNotMatch(setup.captureCharFrame(), /\[x\]/)
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
    assert.match(setup.captureCharFrame(), /❯\s+Session 1/)
    setLifecycle("inactive", "child", false)
    setLifecycle("inactive", "grandchild", false)
    for (const child of children) {
      activeChildren.delete(child.id)
      handlers.get("session.deleted")!({ data: { sessionID: child.id } })
    }
    await setup.renderOnce()
    assert.doesNotMatch(setup.captureCharFrame(), /sub-agents? running/)
    setLifecycle("inactive", "s0", false)
    await setup.renderOnce()
    const row = setup.renderer.root.findDescendantById("claude-session-row-3")!
    assert.ok(row)
    await setup.mockMouse.click(row.x + 8, row.y)
    await setup.renderOnce()
    assert.match(setup.captureCharFrame(), /❯\s+Session 2/)
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
    assert.match(toasts.at(-1)!.message, /Interrupt session \(s20\).*HTTP 409/)
    assert.equal(toasts.at(-1)!.variant, "error")
    assert.equal(lifecycle.inactive.s20, undefined)
    assert.match(setup.captureCharFrame(), /❯\s+Session 20/)
    interruptFailure = false
    storageFailure = true
    await commands.find((c) => c.bind === "x").run()
    await setup.renderOnce()
    assert.match(toasts.at(-1)!.message, /Persist inactive marker \(session already interrupted\).*s20.*disk unavailable/)
    assert.equal(lifecycle.inactive.s20, undefined)
    assert.match(setup.captureCharFrame(), /❯\s+Session 20/)
    storageFailure = false
    running = true
    await commands.find((c) => c.bind === "x").run()
    await new Promise((resolve) => setTimeout(resolve, 20))
    await setup.renderOnce()
    assert.equal(lifecycle.inactive.s20, true)
    assert.equal(opened, undefined)
    assert.equal(scroll.scrollTop, before)
    assert.match(setup.captureCharFrame(), /❯\s+Session 21/)
    commands.find((c) => c.bind === "up").run()
    await setup.renderOnce()
    // Index reuses this renderable for Session 21 after Session 20 moves away.
    const moved = setup.renderer.root.findDescendantById("claude-session-row-21")!
    await setup.mockMouse.click(moved.x + 8, moved.y)
    await setup.renderOnce()
    assert.match(setup.captureCharFrame(), /❯\s+Session 21/)
    assert.equal(scroll.scrollTop, before)
    assert.equal(opened, undefined)
    const previous = setup.renderer.root.findDescendantById("claude-session-row-20")!
    await setup.mockMouse.click(previous.x + 8, previous.y, 2)
    await setup.renderOnce()
    assert.match(setup.captureCharFrame(), /❯\s+Session 21/)
    commands.find((c) => c.bind === "return").run()
    assert.equal(opened, "s21")
    await setup.mockMouse.doubleClick(previous.x + 8, previous.y)
    assert.equal(opened, "s19")

    // Idle sessions must remain markable when their location runtime cannot start.
    running = false
    interruptFailure = true
    const callsBeforeIdle = interruptCalls
    // Stop every remaining active session, including the last row in its section.
    for (let i = 0; i < 50; i++) commands.find((c) => c.bind === "up").run()
    commands.find((c) => c.bind === "down").run()
    for (let i = 0; i < 39; i++) {
      await commands.find((c) => c.bind === "x").run()
      await setup.renderOnce()
    }
    assert.equal(Object.values(lifecycle.inactive).filter(Boolean).length, 40)
    assert.equal(interruptCalls, callsBeforeIdle)
    assert.equal(toasts.at(-1)!.message, "Session marked inactive")
    assert.match(setup.captureCharFrame(), /❯\s+\+\s+New session/)
    assert.match(setup.captureCharFrame(), /New session — no context yet/)

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
    await new Promise((resolve) => setTimeout(resolve, 20))
    for (const [width, height] of [[36, 24], [36, 16], [100, 55]]) {
      setup.resize(width!, height!)
      await setup.renderOnce()
      const picker = setup.renderer.root.findDescendantById("claude-session-picker")!
      const preview = setup.renderer.root.findDescendantById("claude-session-preview")!
      const approve = setup.renderer.root.findDescendantById("claude-session-approve")!
      assert.equal(picker.height, width! < 70 ? height! - 2 : Math.min(48, height! - 6))
      assert.ok(scroll.height >= 2, `list remains usable at ${width}x${height}`)
      assert.ok(preview.y + preview.height <= picker.y + picker.height)
      assert.ok(approve.y + approve.height <= preview.y + preview.height)
      const lifecycleButton = setup.renderer.root.findDescendantById("claude-session-preview-lifecycle")!
      assert.ok(lifecycleButton.x >= preview.x)
      assert.ok(lifecycleButton.x + lifecycleButton.width <= preview.x + preview.width)
      assert.equal(lifecycleButton.y + lifecycleButton.height, preview.y + preview.height)
    }
    assert.doesNotMatch(setup.captureCharFrame(), /←\/esc close/)
    setup.resize(36, 24)
    await setup.renderOnce()
    const approve = setup.renderer.root.findDescendantById("claude-session-approve")!
    await setup.mockMouse.click(approve.x + 1, approve.y)
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(approved, true)
    commands.find((c) => c.bind === "return").run()
    assert.equal(opened, "s0")
    const beforeClose = closed
    commands.find((c) => c.bind === "left").run()
    assert.equal(closed, beforeClose + 1)
  } finally {
    setup.renderer.destroy()
  }
})
