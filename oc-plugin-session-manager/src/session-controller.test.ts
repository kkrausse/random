import { strict as assert } from "node:assert"
import { test } from "node:test"
import { createRoot, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { createSessionController, NEW_SESSION_VALUE, type SessionController } from "./session-controller"

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

async function until(check: () => boolean) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  assert.ok(check(), "controller operation settled")
}

function fixture(configure?: (context: any) => void) {
  const session = {
    id: "parent", title: "Parent", location: { directory: "/test" }, time: { updated: Date.now() },
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, cost: 0,
  }
  const request = { id: "request", sessionID: session.id, action: "shell", resources: ["echo hello"] }
  let permissions = [request]
  const [lifecycle, setLifecycle] = createStore({ inactive: {} as Record<string, boolean> })
  const lifecycleGate = deferred()
  const replyGate = deferred()
  let markerWrites = 0
  let replies = 0
  let replySignal: AbortSignal | undefined
  let subscriptions = 0
  let unsubscriptions = 0
  const handlers = new Map<string, (event: any) => void>()
  const empty = async () => []
  const context: any = {
    storage: { store: () => [lifecycle, async (update: any) => {
      markerWrites++
      await lifecycleGate.promise
      const draft = { inactive: { ...lifecycle.inactive } }
      update(draft)
      setLifecycle("inactive", draft.inactive)
    }] },
    ui: {
      router: { current: () => ({ type: "session", sessionID: session.id }) },
      toast: { show() {} }, format: { path: (value: string) => value },
    },
    data: {
      session: {
        get: () => session, status: () => "idle", cost: () => 0,
        message: { list: () => [], sync: empty, invalidate() {} },
        permission: { list: () => permissions, sync: empty, invalidate() {} },
        form: { list: () => [], sync: empty, invalidate() {} },
      },
      location: { model: { list: () => [], sync: empty } },
      on: (type: string, handler: (event: any) => void) => {
        subscriptions++
        handlers.set(type, handler)
        return () => { unsubscriptions++; handlers.delete(type) }
      },
      listen: (handler: (event: any) => void) => {
        subscriptions++
        handlers.set("*", handler)
        return () => { unsubscriptions++; handlers.delete("*") }
      },
    },
    client: {
      session: {
        list: async ({ parentID }: any = {}) => ({ data: parentID ? [] : [session], cursor: {} }),
        get: async () => session, active: async () => ({}), interrupt: async () => {},
        inbox: { list: empty, cancel: async () => {} },
      },
      shell: { list: async () => ({ data: [] }), remove: async () => {} },
      permission: {
        request: { list: async () => ({ data: permissions }) },
        reply: async (_input: any, options: { signal: AbortSignal }) => {
          replies++
          replySignal = options.signal
          await replyGate.promise
          permissions = []
        },
      },
      form: { list: async () => ({ data: [] }) },
    },
  }
  configure?.(context)
  const controller = createSessionController(context, { list: empty, save: async () => {}, remove: async () => {} })
  return {
    controller, context, session, lifecycle, setLifecycle, lifecycleGate, replyGate, handlers,
    counts: () => ({ markerWrites, replies, subscriptions, unsubscriptions }),
    replySignal: () => replySignal,
  }
}

// A view owns only its attachment; the controller owns state and mutation guards.
function mount(controller: SessionController) {
  return createRoot((dispose) => {
    onCleanup(controller.attach())
    return dispose
  })
}

test("archive job and guard survive closing and reopening; subscriptions belong to the controller", async () => {
  const f = fixture()
  let close = mount(f.controller)
  try {
    await until(() => !f.controller.state.previewLoading())
    const job = f.controller.commands.changeLifecycle(true)
    assert.ok(job)
    await until(() => f.counts().markerWrites === 1)
    assert.ok(f.controller.state.changingLifecycle()?.has("parent"))
    const subscriptions = f.counts().subscriptions
    close()
    assert.equal(f.counts().unsubscriptions, 0)
    close = mount(f.controller)
    assert.equal(f.counts().subscriptions, subscriptions, "reopening does not add event listeners")
    assert.ok(f.controller.state.changingLifecycle()?.has("parent"), "new view observes the original job")
    assert.equal(f.controller.commands.changeLifecycle(true), undefined, "duplicate archive is guarded")
    assert.equal(f.controller.commands.changeLifecycle(false), undefined, "restore cannot race archive")
    f.lifecycleGate.resolve()
    await job
    assert.equal(f.lifecycle.inactive.parent, true)
    assert.equal(f.counts().markerWrites, 1)
    assert.equal(f.controller.state.changingLifecycle(), undefined)
    close()
    f.controller.dispose()
    f.controller.dispose()
    assert.equal(f.counts().unsubscriptions, subscriptions, "unload removes every listener exactly once")
    assert.equal(f.handlers.size, 0)
    assert.throws(() => f.controller.attach(), /disposed/)
  } finally {
    f.lifecycleGate.resolve()
    close()
    f.controller.dispose()
  }
})

test("permission reply survives view disposal and cannot be sent twice on reopening", async () => {
  const f = fixture()
  let close = mount(f.controller)
  try {
    await until(() => !!f.controller.state.permission() && !f.controller.state.previewLoading())
    const job = f.controller.commands.replyToPermission("once")
    assert.ok(job)
    await until(() => f.counts().replies === 1)
    close()
    assert.equal(f.replySignal()?.aborted, false, "view dismissal does not cancel the mutation")
    close = mount(f.controller)
    assert.equal(f.controller.state.replying(), true)
    assert.equal(f.controller.state.replyChoice(), "once")
    assert.equal(f.controller.commands.replyToPermission("always"), undefined)
    f.replyGate.resolve()
    await job
    await until(() => !f.controller.state.permission() && !f.controller.state.previewLoading())
    assert.equal(f.counts().replies, 1)
    assert.equal(f.controller.state.replying(), false)
  } finally {
    f.replyGate.resolve()
    close()
    f.controller.dispose()
  }
})

const flush = () => new Promise<void>((resolve) => setImmediate(resolve))

test("background warm-up waits for all row statuses, including failed lookups", async () => {
  const gates = new Map(Array.from({ length: 6 }, (_, index) => [`row-${index}`, deferred()]))
  const started: string[] = []
  const f = fixture((context) => {
    const session = context.data.session.get()
    context.ui.router.current = () => ({ type: "home" })
    context.client.session.list = async () => ({ data: [...gates.keys()].map((id, index) => ({ ...session, id, time: { updated: Date.now() - index } })), cursor: {} })
    context.client.permission.request.list = async () => ({ data: [] })
    context.data.session.permission.list = () => []
    context.data.session.permission.sync = async (id: string) => {
      if (!started.includes(id)) started.push(id)
      await gates.get(id)?.promise
      if (id === "row-5") throw new Error("row status unavailable")
    }
  })
  f.setLifecycle("inactive", "row-5", true)
  try {
    await until(() => started.length === 4 && !f.controller.state.loading())
    assert.equal(f.controller.state.ready(), false, "no partially checked startup snapshot")
    const row = (id: string) => f.controller.state.options().find((row) => row.value === id)!
    gates.get("row-0")!.resolve()
    await until(() => started.length === 5)
    assert.equal(f.controller.state.ready(), false)
    for (const gate of gates.values()) gate.resolve()
    await until(() => f.controller.state.ready())
    assert.equal(row("row-5").statusState, "unavailable")
    assert.equal(row("row-5").state, "inactive")
    const close = mount(f.controller)
    assert.equal(f.controller.state.ready(), true, "first opening uses the warmed snapshot")
    close()
  } finally {
    for (const gate of gates.values()) gate.resolve()
    f.controller.dispose()
  }
})

test("closing keeps reads and events alive; reopening does not fetch; unloading cancels reads", async () => {
  const gate = deferred()
  const calls: Array<{ cursor?: string; signal: AbortSignal }> = []
  let reads = 0
  let title = "Initial"
  const f = fixture((context) => {
    const session = context.data.session.get()
    context.client.session.list = async (input: { cursor?: string }, options: { signal: AbortSignal }) => {
      calls.push({ cursor: input.cursor, signal: options.signal })
      await gate.promise
      return { data: [session], cursor: {} }
    }
    context.client.session.get = async () => { reads++; return { ...session, title } }
  })
  let close = mount(f.controller)
  try {
    await until(() => calls.length === 1)
    assert.equal(calls[0]!.signal.aborted, false)
    close()
    assert.equal(calls[0]!.signal.aborted, false, "closing does not cancel warm-up")
    gate.resolve()
    await until(() => f.controller.state.ready())
    title = "Updated while closed"
    const before = reads
    f.handlers.get("*")!({ details: { type: "session.renamed", data: { sessionID: "parent", title } } })
    await until(() => f.controller.state.sessions().some((row) => row.title === title))
    assert.equal(reads, before, "rename payload updates the row without fetching it")
    await flush()
    const settled = reads
    close = mount(f.controller)
    assert.equal(f.controller.state.ready(), true)
    await flush()
    assert.equal(reads, settled)
    assert.equal(calls.length, 1)
    f.handlers.get("*")!({ details: { type: "session.step.streamed", data: { sessionID: "parent" } } })
    f.handlers.get("*")!({ details: { type: "session.text.ended", data: { sessionID: "parent" } } })
    await flush()
    assert.equal(reads, settled, "streaming fragments do not fetch session summaries")
    const pending = deferred()
    let signal: AbortSignal | undefined
    f.context.client.session.get = async (_input: any, options: { signal: AbortSignal }) => {
      signal = options.signal
      await pending.promise
      return { ...f.session, title: "Late" }
    }
    f.handlers.get("*")!({ details: { type: "session.status", data: { sessionID: "parent" } } })
    await flush()
    assert.equal(reads, settled, "status events do not fetch session summaries")
    f.handlers.get("*")!({ details: { type: "session.moved", data: { sessionID: "parent" } } })
    await until(() => !!signal)
    f.controller.dispose()
    await until(() => !!signal?.aborted)
    pending.resolve()
    await flush()
    assert.equal(f.controller.state.sessions()[0]?.title, title)
  } finally {
    gate.resolve()
    close()
    f.controller.dispose()
  }
})

test("reopening retains loaded history and selects the current route without new reads", async () => {
  const firstGate = deferred()
  const secondGate = deferred()
  const cursors: Array<string | undefined> = []
  let route: { type: "session"; sessionID: string } | { type: "home" } = { type: "session", sessionID: "parent" }
  const f = fixture((context) => {
    const session = context.data.session.get()
    context.ui.router.current = () => route
    context.client.session.list = async ({ cursor }: { cursor?: string }) => {
      cursors.push(cursor)
      await (cursor ? secondGate.promise : firstGate.promise)
      return cursor ? { data: [{ ...session, id: "history" }], cursor: {} } : { data: [session], cursor: { next: "older" } }
    }
  })
  let close = mount(f.controller)
  try {
    await until(() => cursors.length === 1)
    firstGate.resolve()
    await until(() => !f.controller.state.loading())
    const page = f.controller.commands.loadMore()
    assert.ok(page, "second page is explicitly requested")
    await until(() => cursors.length === 2)
    secondGate.resolve()
    await page
    assert.ok(f.controller.state.sessions().some((row) => row.id === "history"))
    f.controller.commands.select("history")
    close()
    close = mount(f.controller)
    assert.equal(f.controller.state.selectedValue(), "parent", "route selection replaces the previous historical selection")
    assert.deepEqual(cursors, [undefined, "older"])
    assert.equal(f.controller.state.sessions().some((row) => row.id === "history"), true)
    close()
    route = { type: "home" }
    close = mount(f.controller)
    await until(() => !f.controller.state.loading())
    assert.equal(f.controller.state.selectedValue(), NEW_SESSION_VALUE, "opening from home selects New session")
  } finally {
    firstGate.resolve()
    secondGate.resolve()
    close()
    f.controller.dispose()
  }
})
