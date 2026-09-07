/** @jsxImportSource @opentui/solid */
import type { FormInfo, ModelInfo, PermissionRequest, SessionInfo, SessionMessageAssistant, SessionMessageInfo } from "@opencode-ai/client"
import { Plugin } from "@opencode-ai/plugin/tui"
import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { Index, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { descendantIDs, groupLabel, inheritLifecycle, lifecycleOwner, nestRows, propagateAttention, sessionState, sortRows } from "./session-groups"
import { sectionNeighbor } from "./picker-selection"
import { Cause, Effect } from "effect"
import { makeRunner, operation } from "./effects"

const PAGE_SIZE = 100
const LOAD_MORE_THRESHOLD = 10
const NEW_SESSION_VALUE = "__claude_sessions_new__"

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

function relativeTime(timestamp: number) {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1_000))
  if (seconds < 60) return "now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.floor(months / 12)}y ago`
}

function locationKey(session: SessionInfo) {
  return `${session.location.workspaceID ?? ""}\0${session.location.directory}`
}

function shortenLocation(location: string) {
  const parts = location.split("/").filter((part) => part !== "")
  if (parts.length <= 4) return location
  return `…/${parts.slice(-3).join("/")}`
}

function formatCompactTokens(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return `${Math.round(value)}`
}

function formatCost(value: number) {
  if (value < 0.01 && value > 0) return `$${value.toFixed(4)}`
  return `$${value.toFixed(2)}`
}

// Mirrors opencode's sidebar context calculation
// (packages/tui/src/util/session.ts + feature-plugins/sidebar/context.tsx):
// current window usage = last assistant message with token usage after the
// last completed compaction, before any revert boundary. Percent resolves
// against that message's model limit.
function lastAssistantWithUsage(messages: ReadonlyArray<SessionMessageInfo>, boundary?: string) {
  const boundaryIndex = boundary ? messages.findIndex((message) => message.id === boundary) : -1
  if (boundary && boundaryIndex === -1) return undefined
  const end = boundaryIndex === -1 ? messages.length : boundaryIndex
  const compactionIndex = messages.findLastIndex(
    (message, index) => message.type === "compaction" && message.status === "completed" && index < end,
  )
  return messages.findLast(
    (message, index): message is SessionMessageAssistant & { tokens: NonNullable<SessionMessageAssistant["tokens"]> } =>
      message.type === "assistant" && message.tokens !== undefined && index > compactionIndex && index < end,
  )
}

function contextUsage(
  messages: ReadonlyArray<SessionMessageInfo> | undefined,
  models: ReadonlyArray<ModelInfo> | undefined,
  boundary?: string,
) {
  if (!messages) return undefined
  const last = lastAssistantWithUsage(messages, boundary)
  if (!last) return undefined
  const tokens =
    last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
  if (tokens <= 0) return undefined
  const model = models?.find((candidate) => candidate.providerID === last.model.providerID && candidate.id === last.model.id)
  return {
    tokens,
    percent: model?.limit.context ? Math.round((tokens / model.limit.context) * 100) : undefined,
    model: last.model,
  }
}

function contextStats(
  session: SessionInfo | undefined,
  usage: { tokens: number; percent?: number; model?: { providerID: string; id: string } } | undefined,
  cost: number,
  syncing: boolean,
): { left: string; right: string } {
  if (!session) return { left: "New session", right: "" }
  if (!usage) {
    // Messages for this session aren't synced yet (or it has no assistant
    // usage). Fall back to the session's cumulative totals so the row still
    // shows something useful.
    const tokens = session.tokens
    const total = tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
    if (total <= 0) return syncing ? { left: "…", right: "" } : { left: "no usage yet", right: "" }
    return {
      left: `≈${formatCompactTokens(total)} · ${formatCost(cost || session.cost)}`,
      right: syncing ? "…" : "",
    }
  }
  const leftParts = [
    `${formatCompactTokens(usage.tokens)}`,
    usage.model ? `${usage.model.providerID}/${usage.model.id}` : undefined,
    cost > 0 ? `${formatCost(cost)}` : undefined,
  ]
  return {
    left: leftParts.filter(Boolean).join(" · "),
    right: usage.percent !== undefined ? `${usage.percent}%` : syncing ? "…" : "",
  }
}

export function SessionPicker(props: { context: Plugin.Context }) {
  const dimensions = useTerminalDimensions()
  // Use nearly all available height on phones, including with the keyboard open.
  const mobile = () => dimensions().width < 70
  const height = () => Math.max(1, mobile() ? dimensions().height - 2 : Math.min(48, dimensions().height - 6))
  const previewHeight = () => Math.min(permission() ? 20 : 6, Math.max(5, Math.floor(height() * 0.4)))
  const runner = makeRunner((message, cause) => {
    console.error(`[claude.sessions] ${message}\n${Cause.pretty(cause)}`)
  })
  onCleanup(() => runner.dispose())
  const showFailure = (message: string) => props.context.ui.toast.show({
    title: "Sessions viewer", message, variant: "error", duration: 8000,
  })
  const [lifecycle, updateLifecycle] = props.context.storage.store("session-lifecycle", {
    initial: { inactive: {} as Record<string, boolean> },
  })
  const [changingLifecycle, setChangingLifecycle] = createSignal(false)
  const route = props.context.ui.router.current()
  const currentSessionID = route.type === "session" ? route.sessionID : undefined
  const currentSession = currentSessionID ? props.context.data.session.get(currentSessionID) : undefined
  const [sessions, setSessions] = createSignal<SessionInfo[]>(currentSession ? [currentSession] : [])
  const [attention, setAttention] = createSignal(new Map<string, "permission" | "question">())
  const [cursor, setCursor] = createSignal<string>()
  const [loading, setLoading] = createSignal(false)
  const [failure, setFailure] = createSignal<string>()
  const [selectedValue, setSelectedValue] = createSignal(currentSessionID ?? NEW_SESSION_VALUE)
  const [tick, setTick] = createSignal(0)
  const [liveVersion, setLiveVersion] = createSignal(0)
  const [reviewVersion, setReviewVersion] = createSignal(0)
  const [preview, setPreview] = createSignal<{ sessionID: string; permissions: PermissionRequest[]; forms: FormInfo[] }>()
  const [previewLoading, setPreviewLoading] = createSignal(false)
  const [previewError, setPreviewError] = createSignal<string>()
  const [replying, setReplying] = createSignal(false)
  const queriedLocations = new Set<string>()
  let scroll: ScrollBoxRenderable | undefined
  let previewScroll: ScrollBoxRenderable | undefined

  const rows = createMemo(() => {
    tick()
    liveVersion()
    const loaded = sessions()
    const effective = propagateAttention(loaded, attention(), currentSessionID)
    return nestRows(sortRows(inheritLifecycle(
      loaded.map((session) => {
        const ownRunning = props.context.data.session.status(session.id) === "running"
        const runningChildren = descendantIDs(loaded, session.id)
          .filter((id) => props.context.data.session.status(id) === "running").length
        return {
          session, ownRunning, runningChildren,
          state: sessionState(attention().get(session.id) ?? effective.get(session.id),
            ownRunning || runningChildren > 0, !!lifecycle.inactive[session.id]),
        }
      }),
    )))
  })

  const options = createMemo(() => {
    return [
      {
        title: "New session",
        description: "Start with a blank prompt",
        value: NEW_SESSION_VALUE,
        state: "new" as const,
        depth: 0,
      },
      ...rows().map(({ session, state, ownRunning, runningChildren, depth }) => {
        const baseStatus = {
          permission: "Permission required",
          question: "Question waiting",
          inactive: "Inactive",
          idle: "Ready",
        }[state as "permission" | "question" | "inactive" | "idle"]
        const childStatus = `${runningChildren} sub-agent${runningChildren === 1 ? "" : "s"} running`
        // Running is indicated by the spinner icon, so it gets no text status.
        const status = runningChildren > 0
          ? state === "running" ? childStatus : `${baseStatus} · ${childStatus}`
          : state === "running" ? undefined : baseStatus
        const location = shortenLocation(props.context.ui.format.path(session.location.directory))
        const details = [relativeTime(session.time.updated), location]
        if (session.agent) details.push(session.agent)
        return {
          title: session.title?.trim() || "Untitled session",
          description: details.join(" · "),
          status,
          state,
          value: session.id,
          depth,
          updated: relativeTime(session.time.updated),
        }
      }),
    ]
  })

  const selectedIndex = createMemo(() => options().findIndex((option) => option.value === selectedValue()))
  const selectedSession = createMemo(() => sessions().find((session) => session.id === selectedValue()))
  const [contextSyncing, setContextSyncing] = createSignal(false)
  const [contextVersion, setContextVersion] = createSignal(0)
  const selectedMessages = createMemo(() => {
    const sessionID = selectedSession()?.id
    return sessionID ? props.context.data.session.message.list(sessionID) : undefined
  })
  const selectedModels = createMemo(() => {
    const session = selectedSession()
    return session ? props.context.data.location.model.list(session.location) : undefined
  })
  const selectedCost = createMemo(() => {
    const session = selectedSession()
    if (!session) return 0
    const live = props.context.data.session.cost(session.id)
    return live > 0 ? live : session.cost
  })
  const selectedUsage = createMemo(() =>
    contextUsage(selectedMessages(), selectedModels(), selectedSession()?.revert?.messageID),
  )
  const selectedStats = createMemo(() =>
    contextStats(selectedSession(), selectedUsage(), selectedCost(), contextSyncing()),
  )
  const [rowPercents, setRowPercents] = createSignal(new Map<string, string>())
  const rowFetching = new Set<string>()
  const visiblePreview = createMemo(() => preview()?.sessionID === selectedSession()?.id ? preview() : undefined)
  const permission = createMemo(() => visiblePreview()?.permissions[0])

  createEffect(() => {
    // Mirror the selected row's synced percent into the row cache so the
    // list shows % without syncing every row.
    const session = selectedSession()
    const usage = selectedUsage()
    if (session && usage?.percent !== undefined) {
      const label = `${usage.percent}%`
      setRowPercents((current) => {
        if (current.get(session.id) === label) return current
        return new Map(current).set(session.id, label)
      })
    }
  })

  createEffect(() => {
    // Only sync context for rows that need attention (running / permission /
    // question) plus the selected row — syncing all rows would be expensive.
    const loaded = sessions()
    const targets = rows()
      .filter(({ state, session }) =>
        session.id === selectedValue() || state === "running" || state === "permission" || state === "question")
      .map(({ session }) => session)
      .filter((session) => !rowPercents().has(session.id) && !rowFetching.has(session.id))
      .slice(0, 8)
    for (const session of targets) {
      rowFetching.add(session.id)
      runner.start(Effect.all([
        operation({ operation: "Sync row context messages", sessionID: session.id }, () => props.context.data.session.message.sync(session.id)),
        operation({ operation: "Sync row models", directory: session.location.directory }, () => props.context.data.location.model.sync(session.location)),
      ], { concurrency: "unbounded" }).pipe(
        Effect.ensuring(Effect.sync(() => { rowFetching.delete(session.id) })),
      ), () => { rowFetching.delete(session.id) }).done.then(() => {
        const byID = new Map(loaded.map((item) => [item.id, item]))
        const fresh = byID.get(session.id) ?? session
        const messages = props.context.data.session.message.list(session.id)
        const models = props.context.data.location.model.list(fresh.location)
        const usage = contextUsage(messages, models, fresh.revert?.messageID)
        if (usage?.percent !== undefined) {
          const label = `${usage.percent}%`
          setRowPercents((current) => new Map(current).set(session.id, label))
        }
      })
    }
  })

  createEffect(() => {
    const session = selectedSession()
    contextVersion()
    let cancelled = false
    onCleanup(() => { cancelled = true })
    if (!session) {
      setContextSyncing(false)
      return
    }
    setContextSyncing(true)
    const job = runner.start(Effect.all([
      operation({ operation: "Sync context messages", sessionID: session.id }, () => props.context.data.session.message.sync(session.id)),
      operation({ operation: "Sync models", directory: session.location.directory }, () => props.context.data.location.model.sync(session.location)),
    ], { concurrency: "unbounded" }).pipe(
      Effect.ensuring(Effect.sync(() => { if (!cancelled) setContextSyncing(false) })),
    ))
    onCleanup(job.cancel)
  })

  createEffect(() => {
    visiblePreview()
    previewScroll?.scrollTo(0)
  })

  createEffect(() => {
    const sessionID = selectedSession()?.id
    reviewVersion()
    let cancelled = false
    onCleanup(() => { cancelled = true })
    setPreview(undefined)
    setPreviewError(undefined)
    setPreviewLoading(!!sessionID)
    if (!sessionID) return
    // Include subagent descendants so their approval requests are
    // still actionable from the parent preview.
    const related = [sessionID, ...descendantIDs(sessions(), sessionID)]
    const job = runner.start(Effect.gen(function* () {
      const lookups = yield* Effect.all(related.map((id) => Effect.all([
        operation({ operation: "Load preview permissions", sessionID: id }, (signal) => props.context.client.permission.list({ sessionID: id }, { signal })),
        operation({ operation: "Load preview questions", sessionID: id }, (signal) => props.context.client.form.list({ sessionID: id }, { signal })),
      ], { concurrency: "unbounded" })), { concurrency: "unbounded" })
      const permissions = lookups.flatMap(([list]) => list)
      const forms = lookups.flatMap(([, list]) => list)
      if (!cancelled) setPreview({ sessionID, permissions, forms })
    }).pipe(Effect.ensuring(Effect.sync(() => { if (!cancelled) setPreviewLoading(false) }))),
    (message) => { if (!cancelled) setPreviewError(message) })
    onCleanup(job.cancel)
  })

  function replyToPermission(reply: "once" | "always" | "reject") {
    const request = permission()
    if (!request || replying() || changingLifecycle() || previewLoading()) return
    setReplying(true)
    return runner.start(Effect.gen(function* () {
      yield* operation({ operation: `Reply to permission (${reply})`, sessionID: request.sessionID, requestID: request.id },
        (signal) => props.context.client.permission.reply({ sessionID: request.sessionID, requestID: request.id, reply }, { signal }))
      props.context.ui.toast.show({ message: reply === "once" ? "Permission approved once" : reply === "always" ? "Permission approved always" : "Permission denied", variant: "success" })
    }).pipe(Effect.ensuring(Effect.sync(() => {
      setReplying(false)
      setReviewVersion((version) => version + 1)
      refreshLocationForSession(request.sessionID)
    }))), showFailure).done
  }

  function changeLifecycle(inactive: boolean) {
    const selected = selectedSession()
    if (!selected || changingLifecycle() || replying()) return
    const session = lifecycleOwner(sessions(), selected)
    const family = [session.id, ...descendantIDs(sessions(), session.id)]
    const affected = new Set(family)
    const neighbor = sectionNeighbor(options().filter((option) => option.value === session.id || !affected.has(option.value)), session.id) ?? NEW_SESSION_VALUE
    // Interrupting starts the session's location runtime, which fails for old
    // sessions whose directory was removed. Idle rows only need the local marker.
    const interruptIDs = family.filter((id) => props.context.data.session.status(id) === "running"
      || attention().has(id)
      || visiblePreview()?.permissions.some((request) => request.sessionID === id)
      || visiblePreview()?.forms.some((form) => form.sessionID === id))
    const needsInterrupt = interruptIDs.length > 0
    setChangingLifecycle(true)
    return runner.start(Effect.gen(function* () {
      if (inactive) {
        for (const id of interruptIDs) yield* operation({ operation: "Interrupt session", sessionID: id },
          (signal) => props.context.client.session.interrupt({ sessionID: id, continue: false }, { signal }))
      }
      yield* operation({ operation: inactive ? needsInterrupt ? "Persist inactive marker (session already interrupted)" : "Persist inactive marker" : "Persist active marker", sessionID: session.id }, () => updateLifecycle((draft) => {
        if (inactive) draft.inactive[session.id] = true
        else delete draft.inactive[session.id]
      }))
      // Don't steal selection if the user navigated while the request ran.
      if (selectedValue() === selected.id) setSelectedValue(neighbor)
      props.context.ui.toast.show({ message: inactive ? needsInterrupt ? "Session interrupted and marked inactive" : "Session marked inactive" : "Session restored to active", variant: "success" })
    }).pipe(Effect.ensuring(Effect.sync(() => {
      setChangingLifecycle(false)
      for (const id of family) {
        void refreshSessionRow(id)
        refreshLocationForSession(id)
      }
      setReviewVersion((version) => version + 1)
    }))), showFailure).done
  }

  function applyAttentionLookup(location: SessionInfo["location"], key: string) {
    runner.start(Effect.gen(function* () {
      const [permissions, forms] = yield* Effect.all([
        operation({ operation: "Refresh permission badges", directory: location.directory },
          (signal) => props.context.client.permission.request.list({ location }, { signal })),
        operation({ operation: "Refresh question badges", directory: location.directory },
          (signal) => props.context.client.form.request.list({ location }, { signal })),
      ], { concurrency: "unbounded" })
      setAttention((current) => {
        const next = new Map(current)
        // Reconcile: drop stale entries for sessions in this location, then apply fresh state.
        const locationSessionIDs = new Set(
          sessions()
            .filter((session) => locationKey(session) === key)
            .map((session) => session.id),
        )
        for (const id of locationSessionIDs) next.delete(id)
        for (const request of permissions.data) next.set(request.sessionID, "permission")
        for (const request of forms.data) next.set(request.sessionID, "question")
        return next
      })
    }), () => { queriedLocations.delete(key) })
  }

  function refreshAttention(loaded: SessionInfo[], force = false) {
    const locations = new Map<string, SessionInfo["location"]>()
    for (const session of loaded) locations.set(locationKey(session), session.location)

    for (const [key, location] of locations) {
      if (!force && queriedLocations.has(key)) continue
      queriedLocations.add(key)
      applyAttentionLookup(location, key)
    }
  }

  function refreshLocationForSession(sessionID: string) {
    const session = sessions().find((item) => item.id === sessionID)
    if (!session) return
    applyAttentionLookup(session.location, locationKey(session))
  }

  function refreshSessionRow(sessionID: string) {
    return runner.start(Effect.gen(function* () {
      // Active children may be outside the loaded page. Load their ancestry too
      // so their activity reaches the correct parent instead of an orphan row.
      let id: string | undefined = sessionID
      const seen = new Set<string>()
      while (id && !seen.has(id)) {
        seen.add(id)
        const target: string = id
        const fresh = yield* operation({ operation: "Refresh session row", sessionID: target },
          (signal) => props.context.client.session.get({ sessionID: target }, { signal }))
        setSessions((loaded) => [...loaded.filter((item) => item.id !== fresh.id), fresh])
        id = fresh.parentID && !sessions().some((item) => item.id === fresh.parentID) ? fresh.parentID : undefined
      }
      setLiveVersion((version) => version + 1)
    })).done
  }

  function refreshActiveSessions() {
    runner.start(Effect.gen(function* () {
      const active = yield* operation({ operation: "Load active sessions" },
        (signal) => props.context.client.session.active({ signal }))
      for (const id of Object.keys(active)) void refreshSessionRow(id)
    }))
  }

  function refreshContextForSession(sessionID: string) {
    // Invalidate the cached messages so the next sync refetches, then bump
    // the version to retrigger the selected-session context sync effect.
    // The effect's sync() repopulates even without invalidate, but dropping
    // the cache first avoids showing stale usage while refetching.
    if (selectedSession()?.id !== sessionID) return
    props.context.data.session.message.invalidate(sessionID)
    setContextVersion((version) => version + 1)
  }

  function loadMore(initial = false) {
    if (loading() || (!initial && !cursor())) return
    setLoading(true)
    setFailure(undefined)

    return runner.start(Effect.gen(function* () {
      const result = yield* operation({ operation: initial ? "Load sessions" : "Load more sessions" }, (signal) => props.context.client.session.list({
        limit: PAGE_SIZE,
        order: "desc",
        ...(initial ? {} : { cursor: cursor() }),
      }, { signal }))
      const known = new Map(sessions().map((session) => [session.id, session]))
      for (const session of result.data) known.set(session.id, session)
      const loaded = [...known.values()]
      setSessions(loaded)
      setCursor(result.cursor.next ?? undefined)
      refreshAttention(loaded)
    }).pipe(Effect.ensuring(Effect.sync(() => setLoading(false)))), setFailure).done
  }

  function open(sessionID: string) {
    props.context.ui.dialog.clear()
    props.context.ui.router.navigate({ type: "session", sessionID })
  }

  function newSession() {
    props.context.ui.dialog.clear()
    props.context.ui.router.navigate({ type: "home" })
  }

  function scrollToIndex(index: number) {
    const option = options()[index]
    if (!option) return
    const id = `claude-session-row-${index}`
    queueMicrotask(() => scroll?.scrollChildIntoView(id))
  }

  function selectIndex(index: number, follow: boolean) {
    const available = options()
    if (available.length === 0) return
    const next = Math.max(0, Math.min(available.length - 1, index))
    const option = available[next]
    if (!option) return
    setSelectedValue(option.value)
    if (follow) scrollToIndex(next)
    if (next >= available.length - LOAD_MORE_THRESHOLD) void loadMore()
  }

  function moveSelection(delta: number) {
    selectIndex(selectedIndex() + delta, true)
  }

  function selectRowByValue(value: string) {
    const index = options().findIndex((option) => option.value === value)
    if (index < 0) return
    // The pointer already identifies a visible row; clicking must not scroll it.
    selectIndex(index, false)
  }

  let lastClick: { value: string; time: number } | undefined
  function handleRowClick(value: string) {
    const now = Date.now()
    // Single click selects; double-click (<400ms on the same row) opens.
    if (lastClick && lastClick.value === value && now - lastClick.time < 400) {
      lastClick = undefined
      selectRowByValue(value)
      selectCurrent()
      return
    }
    lastClick = { value, time: now }
    selectRowByValue(value)
  }

  function selectCurrent() {
    const option = options()[selectedIndex()]
    if (!option) return
    if (option.value === NEW_SESSION_VALUE) newSession()
    else open(option.value)
  }

  props.context.keymap.layer(() => ({
    mode: "global",
    target: () => scroll,
    priority: 200,
    commands: [
      {
        bind: "left",
        run: () => props.context.ui.dialog.clear(),
      },
      {
        bind: "n",
        run: newSession,
      },
      { bind: "up", run: () => moveSelection(-1) },
      { bind: "k", run: () => moveSelection(-1) },
      { bind: "down", run: () => moveSelection(1) },
      { bind: "j", run: () => moveSelection(1) },
      { bind: "shift+up", run: () => moveSelection(-8) },
      { bind: "shift+down", run: () => moveSelection(8) },
      { bind: "return", run: selectCurrent },
      { bind: "linefeed", run: selectCurrent },
      { bind: "right", run: selectCurrent },
      { bind: "x", run: (_input, event) => { if (!event?.repeated) return changeLifecycle(true) } },
      { bind: "r", run: (_input, event) => { if (!event?.repeated) return changeLifecycle(false) } },
      { bind: "a", run: (_input, event) => { if (!event?.repeated) return replyToPermission("once") } },
      { bind: "shift+a", run: (_input, event) => { if (!event?.repeated) return replyToPermission("always") } },
      { bind: "d", run: (_input, event) => { if (!event?.repeated) return replyToPermission("reject") } },
    ],
  }))

  let initialScrollDone = false
  createEffect(() => {
    const available = options()
    const index = available.findIndex((option) => option.value === selectedValue())
    if (index < 0) return
    if (!initialScrollDone && available.length > 0) {
      initialScrollDone = true
      scrollToIndex(index)
    }
  })

  onMount(() => {
    // Applying this after the dialog exists reliably overrides its default 60-column width.
    props.context.ui.dialog.set({ size: "xlarge", centered: true })
    if (currentSessionID && !currentSession) {
      runner.start(Effect.gen(function* () {
        const session = yield* operation({ operation: "Load current session", sessionID: currentSessionID },
          (signal) => props.context.client.session.get({ sessionID: currentSessionID }, { signal }))
        setSessions((loaded) => [session, ...loaded.filter((item) => item.id !== session.id)])
      }))
    }
    void loadMore(true)
    refreshActiveSessions()

    // Live updates while the picker is open. Running/idle also flows through
    // context.data.session.status, but permission/question badges and titles
    // need explicit event handling.
    const unsubscribes = [
      props.context.data.on("server.connected", refreshActiveSessions),
      props.context.data.listen(({ details }) => {
        if (["permission.asked", "permission.replied", "form.created", "form.replied", "form.cancelled"].includes(details.type)) {
          setReviewVersion((version) => version + 1)
        }
      }),
      props.context.data.on("permission.asked", (event) => {
        setAttention((current) => new Map(current).set(event.data.sessionID, "permission"))
      }),
      props.context.data.on("permission.replied", (event) => {
        refreshLocationForSession(event.data.sessionID)
      }),
      props.context.data.on("form.created", (event) => {
        setAttention((current) => new Map(current).set(event.data.form.sessionID, "question"))
      }),
      props.context.data.on("form.replied", (event) => {
        refreshLocationForSession(event.data.sessionID)
      }),
      props.context.data.on("form.cancelled", (event) => {
        refreshLocationForSession(event.data.sessionID)
      }),
      props.context.data.on("session.status", (event) => {
        void refreshSessionRow(event.data.sessionID)
        refreshContextForSession(event.data.sessionID)
      }),
      props.context.data.on("session.idle", (event) => {
        void refreshSessionRow(event.data.sessionID)
        refreshContextForSession(event.data.sessionID)
      }),
      props.context.data.on("session.created", (event) => {
        void refreshSessionRow(event.data.sessionID)
      }),
      props.context.data.on("session.renamed", (event) => {
        const title = event.data.title
        setSessions((loaded) =>
          loaded.map((item) => (item.id === event.data.sessionID ? { ...item, title } : item)),
        )
      }),
      props.context.data.on("session.deleted", (event) => {
        if (selectedValue() === event.data.sessionID) setSelectedValue(NEW_SESSION_VALUE)
        setSessions((loaded) => loaded.filter((item) => item.id !== event.data.sessionID))
        setAttention((current) => {
          if (!current.has(event.data.sessionID)) return current
          const next = new Map(current)
          next.delete(event.data.sessionID)
          return next
        })
      }),
    ]

    // Keep "xm ago" labels fresh without refetching.
    const timer = setInterval(() => setTick((value) => value + 1), 30_000)
    onCleanup(() => {
      clearInterval(timer)
      for (const unsubscribe of unsubscribes) unsubscribe()
    })
  })

  return (
    <box
      flexDirection="column"
      id="claude-session-picker"
      height={height()}
      overflow="hidden"
      backgroundColor={props.context.theme.contextual.overlay.background.default}
    >
      {changingLifecycle() ? (
        <box height={1} flexShrink={0} flexDirection="column" paddingLeft={0} paddingRight={0}>
          <text wrapMode="none" fg={props.context.theme.text.subdued}>Updating session…</text>
        </box>
      ) : null}
      {failure() ? (
        <box paddingLeft={0} paddingRight={0}>
          <text fg={props.context.theme.text.feedback.error.default}>{failure()}</text>
        </box>
      ) : null}
        <scrollbox
          id="claude-session-list"
          ref={scroll}
          focused
          flexGrow={1}
          minHeight={0}
          scrollY
          scrollX={false}
          viewportCulling
          contentOptions={{ flexDirection: "column" }}
          verticalScrollbarOptions={{ visible: false }}
        >
          <Index each={options()}>
            {(option, index) => {
              const active = () => selectedIndex() === index
               const titleColor = () => option().state === "inactive" ? props.context.theme.text.subdued : props.context.theme.text.default
               const heading = () => {
                 const label = groupLabel(option().state)
                 return label !== groupLabel(options()[index - 1]?.state ?? "new") ? label : undefined
               }
              const descriptionColor = () => props.context.theme.text.subdued
              const iconColor = () => {
                if (option().state === "permission") return props.context.theme.text.status.permission
                if (option().state === "question") return props.context.theme.text.status.question
                if (option().state === "running") return props.context.theme.text.status.running
                return descriptionColor()
              }
              return (
                <>
                {heading() ? (
                  <box height={3} flexShrink={0} paddingLeft={0} paddingRight={0}
                    border={["top"]} borderColor={props.context.theme.hue.accent[400]}>
                    <text fg={props.context.theme.text.default} attributes={TextAttributes.BOLD}>{heading()}</text>
                  </box>
                ) : null}
                <box
                  id={`claude-session-row-${index}`}
                   height={1}
                  flexShrink={0}
                   flexDirection="row"
                   paddingLeft={Math.max(0, Math.min(option().depth, 4) * 2 - (active() ? 1 : 0))}
                  paddingRight={0}
                  border={active() ? ["left"] : []}
                  borderColor={props.context.theme.hue.accent[400]}
                  backgroundColor={
                    active()
                      ? props.context.theme.contextual.overlay.background.surface.offset
                      : props.context.theme.contextual.overlay.background.default
                  }
                  onMouseDown={(event) => {
                    if (event.button !== 0) return
                    event.stopPropagation()
                    event.preventDefault()
                    handleRowClick(option().value)
                  }}
                >
                  <box height={1} flexDirection="row" flexGrow={1} flexBasis={0} minWidth={0} overflow="hidden">
                    {(() => {
                      const state = option().state
                      const icon = state === "running" ? "spinner"
                        : state === "permission" ? "!"
                        : state === "question" ? "?"
                        : state === "new" ? "+" : ""
                      if (!icon) return null
                      return (
                        <box width={2} flexShrink={0}>
                          {icon === "spinner" ? (
                            <spinner frames={SPINNER_FRAMES} interval={80} color={iconColor()} />
                          ) : (
                            <text fg={iconColor()}>{`${icon} `}</text>
                          )}
                        </box>
                      )
                    })()}
                    <text wrapMode="none" flexShrink={1} fg={titleColor()} attributes={active() ? TextAttributes.BOLD : undefined}>
                      {option().title}
                    </text>
                    {(() => {
                      const row = option()
                      return "status" in row && row.status ? (
                        <>
                          <text wrapMode="none" flexShrink={0} fg={iconColor()}>{` · ${row.status}`}</text>
                        </>
                      ) : (
                        null
                      )
                    })()}
                  </box>
                  {option().state !== "new" ? (
                    <>
                      {"value" in option() && rowPercents().get(option().value as string) ? (
                        <text flexShrink={0} fg={descriptionColor()}>{` ${rowPercents().get(option().value as string)}`}</text>
                      ) : null}
                      <box width={8} flexShrink={0} justifyContent="flex-end">
                        <text wrapMode="none" fg={descriptionColor()}>
                          {((option() as { updated?: string }).updated ?? "").padStart(8)}
                        </text>
                      </box>
                    </>
                  ) : null}
                </box>
                </>
              )
            }}
          </Index>
        </scrollbox>
      <box id="claude-session-preview" height={previewHeight()} flexShrink={0} flexDirection="column" paddingLeft={0} paddingRight={0}
        border={["top"]} borderColor={permission() ? props.context.theme.text.status.permission : props.context.theme.contextual.overlay.scrollbar.default}>
        <box flexGrow={1} minHeight={0} overflow="hidden" flexDirection="column">
        <text wrapMode="none" fg={props.context.theme.text.subdued}>{options()[selectedIndex()]?.description}</text>
        <box height={1} flexShrink={0} flexDirection="row" justifyContent="space-between">
           <text wrapMode="none" fg={props.context.theme.text.default} attributes={TextAttributes.BOLD}>
            {selectedStats().left}
          </text>
          <text fg={props.context.theme.text.subdued} attributes={TextAttributes.BOLD}>
            {selectedStats().right}
          </text>
        </box>
        {permission() ? (
          <>
            <box height={1} flexShrink={0} flexDirection="row" justifyContent="space-between">
              <text wrapMode="none" flexShrink={1} fg={props.context.theme.text.status.permission} attributes={TextAttributes.BOLD}>
                {`Approval required · 1 of ${visiblePreview()!.permissions.length}`}
              </text>
              <box flexShrink={0} flexDirection="row" gap={1}>
                <text id="claude-session-approve" fg={props.context.theme.text.subdued} onMouseDown={(event) => { if (event.button === 0) { event.stopPropagation(); void replyToPermission("once") } }}>{replying() ? "Sending…" : "[Once]"}</text>
                <text id="claude-session-always" fg={props.context.theme.text.subdued} onMouseDown={(event) => { if (event.button === 0) { event.stopPropagation(); void replyToPermission("always") } }}>[Always]</text>
                <text id="claude-session-deny" fg={props.context.theme.text.subdued} onMouseDown={(event) => { if (event.button === 0) { event.stopPropagation(); void replyToPermission("reject") } }}>[Deny]</text>
              </box>
            </box>
            <scrollbox ref={previewScroll} flexGrow={1} minHeight={0} scrollY scrollX={false}>
              <text fg={props.context.theme.text.default}>
                {[permission()!.action, permission()!.message, ...permission()!.resources,
                  permission()!.metadata ? JSON.stringify(permission()!.metadata, null, 2) : undefined].filter(Boolean).join("\n")}
              </text>
            </scrollbox>
          </>
        ) : (
          <>
            <text wrapMode="none" fg={props.context.theme.text.subdued}>
              {previewLoading() ? "Checking for approval requests…" : previewError() ? `Preview unavailable: ${previewError()}` : visiblePreview()?.forms.length ? "Question waiting — open session to answer" : "No permission requested"}
            </text>
          </>
        )}
        </box>
        <box height={1} flexShrink={0} flexDirection="row">
          {selectedSession() ? (
            <text id="claude-session-preview-lifecycle" wrapMode="none" fg={props.context.theme.text.default}
              onMouseDown={(event) => {
                if (event.button !== 0) return
                event.stopPropagation()
                event.preventDefault()
                void changeLifecycle(options()[selectedIndex()]?.state !== "inactive")
              }}>
              {changingLifecycle() ? "[Updating…]" : options()[selectedIndex()]?.state === "inactive" ? "[Restore to active]" : "[Mark inactive]"}
            </text>
          ) : null}
        </box>
      </box>
      {loading() ? (
        <box paddingLeft={0} paddingRight={0}>
          <text fg={props.context.theme.text.subdued}>
            {sessions().length === 0 ? "Loading sessions…" : "Loading more…"}
          </text>
        </box>
      ) : null}
    </box>
  )
}

function EmptyPromptBinding(props: { context: Plugin.Context }) {
  const openPicker = () => {
    const route = props.context.ui.router.current()
    if (route.type !== "home" && route.type !== "session") return false

    props.context.ui.dialog.set({ size: "xlarge", centered: true })
    props.context.ui.dialog.show(() => <SessionPicker context={props.context} />)
  }

  props.context.keymap.layer(() => ({
    priority: 100,
    commands: [
      {
        id: "claude-sessions.open",
        title: "Open sessions from an empty prompt",
        group: "Sessions",
        bind: "left",
        run: () => {
          const editor = props.context.renderer.currentFocusedEditor
          if (!editor || editor.plainText !== "") return false

          return openPicker()
        },
      },
    ],
  }))

  props.context.keymap.layer(() => ({
    mode: "global",
    priority: 100,
    commands: [
      {
        id: "claude-sessions.open-global",
        title: "Open session picker",
        group: "Sessions",
        bind: "alt+s",
        palette: true,
        run: openPicker,
      },
    ],
  }))

  return null
}

export default Plugin.define({
  id: "claude.sessions",
  setup(context) {
    return context.ui.slot({
      append: "app",
      render: () => <EmptyPromptBinding context={context} />,
    })
  },
})
