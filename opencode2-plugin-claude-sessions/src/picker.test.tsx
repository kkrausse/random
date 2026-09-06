/** @jsxImportSource @opentui/solid */
import { strict as assert } from "node:assert"
import { test } from "node:test"
import { testRender } from "@opentui/solid"
import { createStore } from "solid-js/store"
import type { ScrollBoxRenderable } from "@opentui/core"
import { SessionPicker } from "./tui"

test("mouse and keyboard selection stay correct across lifecycle reordering", async () => {
  const commands: any[] = []
  const [lifecycle, setLifecycle] = createStore({ inactive: {} as Record<string, boolean> })
  let opened: string | undefined
  const sessions = Array.from({ length: 40 }, (_, i) => ({
    id: `s${i}`,
    title: `Session ${i}`,
    location: { directory: "/test" },
    time: { updated: 1000 - i },
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    cost: 0,
  }))
  const empty = async () => []
  const context: any = {
    storage: {
      store: () => [
        lifecycle,
        async (update: any) => {
          const draft = { inactive: { ...lifecycle.inactive } }
          update(draft)
          setLifecycle("inactive", draft.inactive)
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
      dialog: { set() {}, clear() {} },
      toast: { show() {} },
      format: { path: (s: string) => s },
    },
    keymap: { layer: (fn: any) => commands.push(...fn().commands) },
    data: {
      session: { status: () => "idle", message: { list: () => [], sync: empty }, cost: () => 0 },
      location: { model: { list: () => [], sync: empty } },
      on: () => () => {},
      listen: () => () => {},
    },
    client: {
      session: {
        list: async () => ({ data: sessions, cursor: {} }),
        interrupt: empty,
        get: async ({ sessionID }: any) => sessions.find((s) => s.id === sessionID),
      },
      permission: { list: empty, request: { list: async () => ({ data: [] }) } },
      form: { list: empty, request: { list: async () => ({ data: [] }) } },
    },
  }
  const setup = await testRender(() => <SessionPicker context={context} />, { width: 100, height: 55 })
  try {
    await new Promise((resolve) => setTimeout(resolve, 20))
    await setup.renderOnce()
    const row = setup.renderer.root.findDescendantById("claude-session-row-3")!
    assert.ok(row)
    await setup.mockMouse.click(row.x + 8, row.y)
    await setup.renderOnce()
    assert.match(setup.captureCharFrame(), /❯\s+Session 2/)
    for (let i = 0; i < 18; i++) {
      commands.find((c) => c.bind === "down").run()
      await setup.renderOnce()
    }
    const scroll = setup.renderer.root.findDescendantById("claude-session-list") as ScrollBoxRenderable
    assert.ok(scroll.scrollTop > 0)
    const before = scroll.scrollTop
    await commands.find((c) => c.bind === "x").run()
    await setup.renderOnce()
    assert.equal(scroll.scrollTop, before)
    assert.match(setup.captureCharFrame(), /❯\s+Session 21/)
    commands.find((c) => c.bind === "up").run()
    await setup.renderOnce()
    // Index reuses this renderable for Session 21 after Session 20 moves away.
    const moved = setup.renderer.root.findDescendantById("claude-session-row-21")!
    await setup.mockMouse.click(moved.x + 8, moved.y + 1)
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
  } finally {
    setup.renderer.destroy()
  }
})
