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

function fixture() {
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
      listen: () => { subscriptions++; return () => { unsubscriptions++ } },
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

test("status fills top-down with active rows first and archived rows keep their section while checking or unavailable", async () => {
  const f = fixture()
  const active = Array.from({ length: 5 }, (_, index) => ({ ...f.session, id: `active-${index}`, time: { updated: Date.now() - index } }))
  const archived = { ...f.session, id: "archived", time: { updated: Date.now() + 1000 } }
  const gates = new Map([...active, archived].map((session) => [session.id, deferred()]))
  const started: string[] = []
  f.setLifecycle("inactive", archived.id, true)
  f.context.ui.router.current = () => ({ type: "home" })
  f.context.client.session.list = async () => ({ data: [archived, ...active], cursor: {} })
  f.context.client.permission.request.list = async () => ({ data: [] })
  f.context.data.session.permission.list = () => []
  f.context.data.session.permission.sync = async (id: string) => {
    if (!started.includes(id)) started.push(id)
    await gates.get(id)?.promise
    if (id === archived.id) throw new Error("row status unavailable")
  }
  const close = mount(f.controller)
  try {
    await until(() => started.length === 4 && !f.controller.state.loading())
    assert.deepEqual(started, active.slice(0, 4).map((session) => session.id))
    const row = (id: string) => f.controller.state.options().find((row) => row.value === id)!
    const order = f.controller.state.options().map((row) => row.value)
    assert.equal(row(archived.id).state, "inactive")
    assert.equal(row(archived.id).statusState, "checking")
    gates.get(active[0]!.id)!.resolve()
    await until(() => row(active[0]!.id).statusState === "idle")
    assert.equal(row(active[1]!.id).statusState, "checking", "slow rows do not hold back completed badges")
    await until(() => started.length === 5)
    assert.equal(started[4], active[4]!.id)
    for (const gate of gates.values()) gate.resolve()
    await until(() => row(archived.id).statusState === "unavailable")
    assert.equal(row(archived.id).state, "inactive", "failed status does not move an archived row")
    assert.deepEqual(f.controller.state.options().map((row) => row.value), order)
  } finally {
    for (const gate of gates.values()) gate.resolve()
    close()
    f.controller.dispose()
  }
})

test("closing stops read activity; reopening ignores a late response from the old opening", async () => {
  const f = fixture()
  const oldGate = deferred()
  const freshGate = deferred()
  const calls: Array<{ cursor?: string; signal: AbortSignal }> = []
  const oldRow = { ...f.session, id: "old-only", title: "Obsolete row" }
  const freshRow = { ...f.session, id: "fresh-only", title: "Fresh row" }
  const oldCurrent = { ...f.session, title: "Obsolete parent" }
  const freshCurrent = { ...f.session, title: "Fresh parent" }
  let reads = 0
  f.context.client.session.list = async (input: { cursor?: string }, options: { signal: AbortSignal }) => {
    const index = calls.length
    calls.push({ cursor: input.cursor, signal: options.signal })
    // Deliberately ignore abort: the controller must reject stale publication.
    await (index === 0 ? oldGate.promise : freshGate.promise)
    return { data: index === 0 ? [oldCurrent, oldRow] : [freshCurrent, freshRow], cursor: {} }
  }
  const countReads = (object: any, key: string) => {
    const original = object[key]
    object[key] = (...args: any[]) => { reads++; return original(...args) }
  }
  for (const key of ["list", "get", "active"]) countReads(f.context.client.session, key)
  countReads(f.context.client.permission.request, "list")
  countReads(f.context.client.form, "list")
  for (const key of ["permission", "form", "message"]) countReads(f.context.data.session[key], "sync")
  countReads(f.context.data.location.model, "sync")
  let close = mount(f.controller)
  try {
    await until(() => calls.length === 1)
    assert.equal(calls[0]!.signal.aborted, false)
    close()
    await until(() => calls[0]!.signal.aborted)
    await flush()
    const before = reads
    for (const type of ["session.status", "session.idle"]) {
      f.handlers.get(type)?.({ data: { sessionID: "parent" } })
      f.handlers.get(type)?.({ data: { sessionID: "off-page" } })
    }
    await flush()
    assert.equal(reads, before, "closed status events neither fetch metadata nor synchronize host caches")
    close = mount(f.controller)
    await until(() => calls.length === 2)
    assert.deepEqual(calls.map((call) => call.cursor), [undefined, undefined])
    assert.equal(calls[1]!.signal.aborted, false)
    freshGate.resolve()
    await until(() => f.controller.state.sessions().some((row) => row.id === freshRow.id) && !f.controller.state.loading())
    oldGate.resolve()
    await flush()
    assert.deepEqual(f.controller.state.sessions().map((row) => row.id).sort(), ["fresh-only", "parent"])
    assert.equal(f.controller.state.sessions().find((row) => row.id === "parent")?.title, "Fresh parent")
    assert.equal(f.controller.state.loading(), false)
    assert.equal(f.controller.state.failure(), undefined)
    assert.equal(calls.length, 2)
  } finally {
    oldGate.resolve()
    freshGate.resolve()
    close()
    f.controller.dispose()
  }
})

test("reopening resets the historical page and selects the current route for each opening", async () => {
  const f = fixture()
  const firstGate = deferred()
  const secondGate = deferred()
  const reopenGate = deferred()
  const history = { ...f.session, id: "history", title: "Historical page" }
  const cursors: Array<string | undefined> = []
  let route: { type: "session"; sessionID: string } | { type: "home" } = { type: "session", sessionID: "parent" }
  f.context.ui.router.current = () => route
  f.context.client.session.list = async ({ cursor }: { cursor?: string }) => {
    const index = cursors.length
    cursors.push(cursor)
    await (index === 0 ? firstGate.promise : cursor ? secondGate.promise : reopenGate.promise)
    return cursor ? { data: [history], cursor: {} } : { data: [f.session], cursor: { next: "older" } }
  }
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
    assert.ok(f.controller.state.sessions().some((row) => row.id === history.id))
    f.controller.commands.select(history.id)
    close()
    close = mount(f.controller)
    await until(() => cursors.length === 3)
    assert.equal(f.controller.state.selectedValue(), "parent", "route selection replaces the previous historical selection")
    assert.equal(f.controller.state.sessions().some((row) => row.id === history.id), false, "historical page is discarded before the fresh page finishes")
    reopenGate.resolve()
    await until(() => !f.controller.state.loading())
    assert.deepEqual(cursors, [undefined, "older", undefined])
    assert.equal(f.controller.state.sessions().some((row) => row.id === history.id), false)
    close()
    route = { type: "home" }
    close = mount(f.controller)
    await until(() => !f.controller.state.loading())
    assert.equal(f.controller.state.selectedValue(), NEW_SESSION_VALUE, "opening from home selects New session")
  } finally {
    firstGate.resolve()
    secondGate.resolve()
    reopenGate.resolve()
    close()
    f.controller.dispose()
  }
})
