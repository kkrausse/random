/** @jsxImportSource @opentui/solid */
import type { FormInfo, ModelInfo, PermissionRequest, SessionInfo, SessionMessageAssistant, SessionMessageInfo } from "@opencode-ai/client"
import { Plugin } from "@opencode-ai/plugin/tui"
import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { For, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js"

const PAGE_SIZE = 100
const LOAD_MORE_THRESHOLD = 10
const NEW_SESSION_VALUE = "__claude_sessions_new__"

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

type SessionState = "permission" | "question" | "running" | "idle"

interface SessionRow {
  session: SessionInfo
  state: SessionState
}

function stateRank(state: SessionState) {
  if (state === "permission" || state === "question") return 0
  if (state === "running") return 1
  return 2
}

function sortRows(rows: SessionRow[]) {
  return rows.sort((a, b) => {
    const rank = stateRank(a.state) - stateRank(b.state)
    return rank || b.session.time.updated - a.session.time.updated
  })
}

function relativeTime(timestamp: number) {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1_000))
  if (seconds < 60) return "just now"
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
  if (!session) return { left: "New session — no context yet", right: "" }
  if (!usage) {
    // Messages for this session aren't synced yet (or it has no assistant
    // usage). Fall back to the session's cumulative totals so the row still
    // shows something useful.
    const tokens = session.tokens
    const total = tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
    if (total <= 0) return syncing ? { left: "Context — loading…", right: "" } : { left: "Context — no usage yet", right: "" }
    return {
      left: `Context ≈${formatCompactTokens(total)} total toks · ${formatCost(cost || session.cost)}`,
      right: syncing ? "loading…" : "",
    }
  }
  const leftParts = [
    `Context ${usage.tokens.toLocaleString()} tokens`,
    usage.model ? `${usage.model.providerID}/${usage.model.id}` : undefined,
    cost > 0 ? `${formatCost(cost)} spent` : undefined,
  ]
  return {
    left: leftParts.filter(Boolean).join("  ·  "),
    right: usage.percent !== undefined ? `${usage.percent}% used` : syncing ? "loading…" : "",
  }
}

function SessionPicker(props: { context: Plugin.Context }) {
  const route = props.context.ui.router.current()
  const currentSessionID = route.type === "session" ? route.sessionID : undefined
  const currentSession = currentSessionID ? props.context.data.session.get(currentSessionID) : undefined
  const [sessions, setSessions] = createSignal<SessionInfo[]>(currentSession ? [currentSession] : [])
  const [attention, setAttention] = createSignal(new Map<string, "permission" | "question">())
  const [cursor, setCursor] = createSignal<string>()
  const [loading, setLoading] = createSignal(false)
  const [failure, setFailure] = createSignal<string>()
  const [selectedIndex, setSelectedIndex] = createSignal(0)
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
    const attentionByID = attention()
    return sortRows(
      sessions().map((session) => ({
        session,
        state: attentionByID.get(session.id)
          ? attentionByID.get(session.id)!
          : props.context.data.session.status(session.id) === "running"
            ? "running"
            : "idle",
      })),
    )
  })

  const options = createMemo(() => [
    {
      title: "New session",
      description: "Start with a blank prompt",
      value: NEW_SESSION_VALUE,
      state: "new" as const,
    },
    ...rows().map(({ session, state }) => {
      const status =
        state === "permission"
          ? "Permission required"
          : state === "question"
            ? "Question waiting"
            : state === "running"
              ? "Working"
              : "Ready"
      const location = shortenLocation(props.context.ui.format.path(session.location.directory))
      const details = [relativeTime(session.time.updated), location]
      if (session.agent) details.push(session.agent)

      return {
        title: session.title?.trim() || "Untitled session",
        description: details.join("  ·  "),
        status,
        state,
        value: session.id,
      }
    }),
  ])

  const selectedSession = createMemo(() => sessions().find((session) => session.id === options()[selectedIndex()]?.value))
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
  const baseDirectory = createMemo(() => (currentSession ?? selectedSession() ?? sessions()[0]?.location.directory) ? (currentSession ?? selectedSession() ?? sessions()[0])!.location.directory : undefined)
  const visiblePreview = createMemo(() => preview()?.sessionID === selectedSession()?.id ? preview() : undefined)
  const permission = createMemo(() => visiblePreview()?.permissions[0])

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
    void Promise.allSettled([
      props.context.data.session.message.sync(session.id),
      props.context.data.location.model.sync(session.location),
    ]).finally(() => {
      if (!cancelled) setContextSyncing(false)
    })
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
    void Promise.all([
      props.context.client.permission.list({ sessionID }),
      props.context.client.form.list({ sessionID }),
    ]).then(([permissions, forms]) => {
      if (!cancelled) setPreview({ sessionID, permissions, forms })
    }).catch((error) => {
      if (!cancelled) setPreviewError(error instanceof Error ? error.message : "Could not load preview")
    }).finally(() => {
      if (!cancelled) setPreviewLoading(false)
    })
  })

  async function replyToPermission(reply: "once" | "always" | "reject") {
    const request = permission()
    if (!request || replying() || previewLoading()) return
    setReplying(true)
    try {
      await props.context.client.permission.reply({ sessionID: request.sessionID, requestID: request.id, reply })
      props.context.ui.toast.show({ message: reply === "once" ? "Permission approved once" : reply === "always" ? "Permission approved always" : "Permission denied", variant: "success" })
    } catch (error) {
      props.context.ui.toast.show({ message: error instanceof Error ? error.message : "Could not reply to permission", variant: "error" })
    } finally {
      setReplying(false)
      setReviewVersion((version) => version + 1)
      refreshLocationForSession(request.sessionID)
    }
  }

  function applyAttentionLookup(location: SessionInfo["location"], key: string) {
    const lookups: Array<Promise<{ kind: "permission" | "question"; ids: string[] }>> = [
      props.context.client.permission.request
        .list({ location })
        .then((result) => ({ kind: "permission", ids: result.data.map((request) => request.sessionID) })),
      props.context.client.form.request
        .list({ location })
        .then((result) => ({ kind: "question", ids: result.data.map((request) => request.sessionID) })),
    ]
    void Promise.allSettled(lookups).then((requests) => {
      const found = requests.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []))
      if (found.length === 0) return
      setAttention((current) => {
        const next = new Map(current)
        // Reconcile: drop stale entries for sessions in this location, then apply fresh state.
        const locationSessionIDs = new Set(
          sessions()
            .filter((session) => locationKey(session) === key)
            .map((session) => session.id),
        )
        for (const id of locationSessionIDs) next.delete(id)
        for (const result of found) for (const id of result.ids) next.set(id, result.kind)
        return next
      })
    })
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

  async function refreshSessionRow(sessionID: string) {
    try {
      const fresh = await props.context.client.session.get({ sessionID })
      setSessions((loaded) => loaded.map((item) => (item.id === fresh.id ? fresh : item)))
      setLiveVersion((version) => version + 1)
    } catch {
      // Session may be deleted or unreachable; event handlers below clean up.
    }
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

  async function loadMore(initial = false) {
    if (loading() || (!initial && !cursor())) return
    setLoading(true)
    setFailure(undefined)

    try {
      const result = await props.context.client.session.list({
        limit: PAGE_SIZE,
        order: "desc",
        ...(initial ? {} : { cursor: cursor() }),
      })
      const known = new Map(sessions().map((session) => [session.id, session]))
      for (const session of result.data) known.set(session.id, session)
      const loaded = [...known.values()]
      setSessions(loaded)
      setCursor(result.cursor.next ?? undefined)
      refreshAttention(loaded)
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Could not load sessions")
    } finally {
      setLoading(false)
    }
  }

  function open(sessionID: string) {
    props.context.ui.dialog.clear()
    props.context.ui.router.navigate({ type: "session", sessionID })
  }

  function newSession() {
    props.context.ui.dialog.clear()
    props.context.ui.router.navigate({ type: "home" })
  }

  function moveSelection(delta: number) {
    const available = options()
    if (available.length === 0) return
    const next = Math.max(0, Math.min(available.length - 1, selectedIndex() + delta))
    const option = available[next]
    if (!option) return
    selectedValue = option.value
    setSelectedIndex(next)
    if (next >= available.length - LOAD_MORE_THRESHOLD) void loadMore()
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
      { bind: "a", run: (_input, event) => { if (!event?.repeated) return replyToPermission("once") } },
      { bind: "shift+a", run: (_input, event) => { if (!event?.repeated) return replyToPermission("always") } },
      { bind: "d", run: (_input, event) => { if (!event?.repeated) return replyToPermission("reject") } },
    ],
  }))

  let selectedValue = currentSessionID ?? NEW_SESSION_VALUE
  createEffect(() => {
    const available = options()
    const index = available.findIndex((option) => option.value === selectedValue)
    if (index < 0) return
    setSelectedIndex(index)
  })

  createEffect(() => {
    const index = selectedIndex()
    // Track row creation as pages load, but do not react to manual viewport scrolling.
    options().length
    queueMicrotask(() => scroll?.scrollChildIntoView(`claude-session-${index}`))
  })

  onMount(() => {
    // Applying this after the dialog exists reliably overrides its default 60-column width.
    props.context.ui.dialog.set({ size: "xlarge", centered: true })
    if (currentSessionID && !currentSession) {
      void props.context.client.session
        .get({ sessionID: currentSessionID })
        .then((session) => setSessions((loaded) => [session, ...loaded.filter((item) => item.id !== session.id)]))
        .catch(() => undefined)
    }
    void loadMore(true)

    // Live updates while the picker is open. Running/idle also flows through
    // context.data.session.status, but permission/question badges and titles
    // need explicit event handling.
    const unsubscribes = [
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
        if (selectedValue === event.data.sessionID) {
          selectedValue = NEW_SESSION_VALUE
          setSelectedIndex(0)
        }
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
      height={48}
      backgroundColor={props.context.theme.contextual.overlay.background.default}
    >
      <box height={4} flexShrink={0} flexDirection="column" paddingLeft={2} paddingRight={2}>
        <text fg={props.context.theme.text.default} attributes={TextAttributes.BOLD}>
          {sessions().length > 0 ? `Sessions viewer · ${sessions().length}` : "Sessions viewer"}
        </text>
        <text fg={props.context.theme.text.subdued}>
          {baseDirectory() ? props.context.ui.format.path(baseDirectory()!) : " "}
        </text>
        <text fg={props.context.theme.text.subdued}>↑/↓ select  ·  →/enter open  ·  n new  ·  ←/esc close</text>
      </box>
      {failure() ? (
        <box paddingLeft={2} paddingRight={2}>
          <text fg={props.context.theme.text.feedback.error.default}>{failure()}</text>
        </box>
      ) : options().length === 0 && loading() ? (
        <box paddingLeft={2} paddingRight={2}>
          <text fg={props.context.theme.text.subdued}>Loading sessions…</text>
        </box>
      ) : (
        <scrollbox
          ref={scroll}
          focused
          flexGrow={1}
          scrollY
          scrollX={false}
          viewportCulling
          contentOptions={{ flexDirection: "column" }}
          verticalScrollbarOptions={{
            visible: true,
            trackOptions: {
              backgroundColor: props.context.theme.contextual.overlay.background.default,
              foregroundColor: props.context.theme.contextual.overlay.scrollbar.default,
            },
          }}
        >
          <For each={options()}>
            {(option, index) => {
              const active = () => selectedIndex() === index()
              const titleColor = () => props.context.theme.text.default
              const descriptionColor = () => props.context.theme.text.subdued
              const cursorColor = () => props.context.theme.hue.accent[400]
              const iconColor = () => {
                if (option.state === "permission") return props.context.theme.text.status.permission
                if (option.state === "question") return props.context.theme.text.status.question
                if (option.state === "running") return props.context.theme.text.status.running
                return descriptionColor()
              }
              return (
                <box
                  id={`claude-session-${index()}`}
                  height={2}
                  flexShrink={0}
                  flexDirection="column"
                  paddingLeft={1}
                  paddingRight={2}
                  backgroundColor={
                    active()
                      ? props.context.theme.contextual.overlay.background.surface.offset
                      : props.context.theme.contextual.overlay.background.default
                  }
                  onMouseDown={() => {
                    selectedValue = option.value
                    setSelectedIndex(index())
                  }}
                >
                  <box height={1} flexDirection="row">
                    <box width={2} flexShrink={0}>
                      <text fg={cursorColor()}>{active() ? "❯" : " "}</text>
                    </box>
                    <box width={3} flexShrink={0}>
                      {option.state === "running" ? (
                        <spinner frames={SPINNER_FRAMES} interval={80} color={iconColor()} />
                      ) : (
                        <text fg={iconColor()}>
                          {option.state === "permission"
                            ? "!"
                            : option.state === "question"
                              ? "?"
                              : option.state === "new"
                                ? "+"
                                : ""}
                        </text>
                      )}
                    </box>
                    <text fg={titleColor()} attributes={active() ? TextAttributes.BOLD : undefined}>
                      {option.title}
                    </text>
                  </box>
                  <box height={1} flexDirection="row" paddingLeft={5}>
                    {"status" in option ? (
                      <>
                        <text fg={iconColor()}>{option.status}</text>
                        <text fg={descriptionColor()}>{`  ·  ${option.description}`}</text>
                      </>
                    ) : (
                      <text fg={descriptionColor()}>{option.description}</text>
                    )}
                  </box>
                </box>
              )
            }}
          </For>
        </scrollbox>
      )}
      <box height={permission() ? 19 : 6} flexShrink={0} flexDirection="column" paddingLeft={2} paddingRight={2}
        border={["top"]} borderColor={permission() ? props.context.theme.text.status.permission : props.context.theme.contextual.overlay.scrollbar.default}>
        <box height={1} flexDirection="row" justifyContent="space-between">
          <text fg={props.context.theme.text.default} attributes={TextAttributes.BOLD}>
            {selectedStats().left}
          </text>
          <text fg={props.context.theme.text.subdued} attributes={TextAttributes.BOLD}>
            {selectedStats().right}
          </text>
        </box>
        {permission() ? (
          <>
            <text fg={props.context.theme.text.status.permission} attributes={TextAttributes.BOLD}>
              {`Approval required · 1 of ${visiblePreview()!.permissions.length}`}
            </text>
            <scrollbox ref={previewScroll} height={14} scrollY scrollX={false}>
              <text fg={props.context.theme.text.default}>
                {[permission()!.action, permission()!.message, ...permission()!.resources,
                  permission()!.metadata ? JSON.stringify(permission()!.metadata, null, 2) : undefined].filter(Boolean).join("\n")}
              </text>
            </scrollbox>
            <text fg={props.context.theme.text.subdued}>
              {replying() ? "Sending reply…" : "a approve once  ·  A always  ·  d deny  ·  enter open session"}
            </text>
          </>
        ) : (
          <>
            <text fg={props.context.theme.text.subdued}>
              {previewLoading() ? "Checking for approval requests…" : previewError() ? `Preview unavailable: ${previewError()}` : visiblePreview()?.forms.length ? "Question waiting — open session to answer" : "No permission requested"}
            </text>
            <text fg={props.context.theme.text.subdued}>enter open session</text>
          </>
        )}
      </box>
      {loading() ? (
        <box paddingLeft={2} paddingRight={2}>
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
