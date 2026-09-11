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
import { archiveSession, fileArchiveStore, restoreSession, type Archive, type ArchiveStore } from "./archive"
import { loadInbox, pendingOrder, requestKey } from "./inbox"

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

export function sessionTokenBreakdown(session: Pick<SessionInfo, "tokens">, compact = false) {
  const tokens = session.tokens
  const labels = compact
    ? ["In", "CR", "CW", "Out", "Think"]
    : ["Input", "Cache read", "Cache write", "Output", "Reasoning"]
  const values = [tokens.input, tokens.cache.read, tokens.cache.write, tokens.output, tokens.reasoning]
  return labels.map((label, index) => `${label} ${formatCompactTokens(values[index]!)}`).join(" · ")
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

export function SessionPicker(props: { context: Plugin.Context; archiveStore?: ArchiveStore; returnSessionID?: string; hostDialogInsets?: boolean }) {
  const dimensions = useTerminalDimensions()
  // The dialog tracks the terminal, including phone keyboard/rotation changes.
  const mobile = () => dimensions().width < 70
  const offsetHostInsets = () => mobile() && props.hostDialogInsets !== false
  const height = () => Math.max(1, dimensions().height)
  const dialogHeight = () => mobile()
    ? height()
    : Math.max(1, Math.min(40, height() - 2))
  const previewHeight = () => Math.min(permission() ? 20 : mobile() ? 8 : 6, Math.max(mobile() && permission() ? 9 : 5, Math.floor(height() * (mobile() ? 0.5 : 0.4))))
  const approvalButtonHeight = () => mobile() && dimensions().height >= 20 ? 3 : 1
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
  const currentSessionID = props.returnSessionID ?? (route.type === "session" ? route.sessionID : undefined)
  const currentSession = currentSessionID ? props.context.data.session.get(currentSessionID) : undefined
  const archiveStore = props.archiveStore ?? fileArchiveStore()
  const [archives, setArchives] = createSignal<Archive[]>([])
  const [archivesReady, setArchivesReady] = createSignal(false)
  const deletedIDs = new Set<string>()
  const [liveSessions, setSessions] = createSignal<SessionInfo[]>(currentSession ? [currentSession] : [])
  const archived = (id: string) => archives().find((item) => item.transcript.info.id === id)
  const isArchived = (id: string) => !!archived(id) && !liveSessions().some((session) => session.id === id)
  const sessions = createMemo(() => {
    const merged = new Map(archives().map((item) => [item.transcript.info.id, item.transcript.info]))
    for (const session of liveSessions()) merged.set(session.id, session)
    return [...merged.values()]
  })
  const [attention, setAttention] = createSignal(new Map<string, "permission" | "question">())
  const [cursor, setCursor] = createSignal<string>()
  const [loading, setLoading] = createSignal(false)
  const [failure, setFailure] = createSignal<string>()
  const [selectedValue, setSelectedValue] = createSignal(currentSessionID ?? NEW_SESSION_VALUE)
  const [search, setSearch] = createSignal("")
  const [tick, setTick] = createSignal(0)
  const [liveVersion, setLiveVersion] = createSignal(0)
  const [reviewVersion, setReviewVersion] = createSignal(0)
  const [preview, setPreview] = createSignal<{ sessionID: string; permissions: PermissionRequest[]; forms: FormInfo[] }>()
  const [inboxSessions, setInboxSessions] = createSignal<SessionInfo[]>([])
  const [inboxErrors, setInboxErrors] = createSignal<string[]>([])
  const answeredRequests = new Set<string>()
  const [previewLoading, setPreviewLoading] = createSignal(false)
  const [previewError, setPreviewError] = createSignal<string>()
  const [replying, setReplying] = createSignal(false)
  const [replyChoice, setReplyChoice] = createSignal<"once" | "always" | "reject">()
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
        const ownRunning = !isArchived(session.id) && props.context.data.session.status(session.id) === "running"
        const runningChildren = descendantIDs(loaded, session.id)
          .filter((id) => props.context.data.session.status(id) === "running").length
        return {
          session, ownRunning, runningChildren,
           state: isArchived(session.id) ? "inactive" as const : sessionState(attention().get(session.id) ?? effective.get(session.id),
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
      ...rows().filter(({ session }) => !search() || `${session.title ?? "Untitled session"} ${session.location.directory}`.toLowerCase().includes(search().toLowerCase())).map(({ session, state, ownRunning, runningChildren, depth }) => {
        const baseStatus = {
          permission: "Permission required",
          question: "Question waiting",
          inactive: "Archived",
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
    return sessionID ? isArchived(sessionID) ? archived(sessionID)?.transcript.messages : props.context.data.session.message.list(sessionID) : undefined
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
  const isInbox = () => selectedValue() === NEW_SESSION_VALUE
  const visiblePreview = createMemo(() => preview()?.sessionID === selectedValue() ? preview() : undefined)
  const permission = createMemo(() => visiblePreview()?.permissions[0])
  const inboxRequest = createMemo(() => isInbox() ? permission() ?? visiblePreview()?.forms[0] : undefined)
  const inboxOwner = createMemo(() => inboxSessions().find((session) => session.id === inboxRequest()?.sessionID))

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
       .filter((session) => !isArchived(session.id) && !rowPercents().has(session.id) && !rowFetching.has(session.id))
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
    if (!session || isArchived(session.id)) {
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
    const sessionID = isInbox() ? NEW_SESSION_VALUE : selectedSession()?.id
    reviewVersion()
    let cancelled = false
    onCleanup(() => { cancelled = true })
    setPreview((current) => current?.sessionID === sessionID ? current : undefined)
    setPreviewError(undefined)
    setPreviewLoading(!!sessionID && !isArchived(sessionID))
    if (!sessionID || isArchived(sessionID)) return
    if (sessionID === NEW_SESSION_VALUE) {
      const job = runner.start(loadInbox(props.context.client).pipe(Effect.tap((inbox) => Effect.sync(() => {
        if (cancelled) return
        setInboxSessions(inbox.sessions)
        setInboxErrors(inbox.errors)
        setPreview((current) => ({
          sessionID,
          permissions: pendingOrder(current?.sessionID === sessionID ? current.permissions : [], inbox.permissions.filter((request) => !answeredRequests.has(requestKey(request)))),
          forms: pendingOrder(current?.sessionID === sessionID ? current.forms : [], inbox.forms),
        }))
      })), Effect.ensuring(Effect.sync(() => { if (!cancelled) setPreviewLoading(false) }))),
      (message) => { if (!cancelled) setPreviewError(message) })
      onCleanup(job.cancel)
      return
    }
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
    if (!request || replying() || changingLifecycle() || previewLoading() || previewError()) return
    setReplyChoice(reply)
    setReplying(true)
    return runner.start(Effect.gen(function* () {
      yield* operation({ operation: `Reply to permission (${reply})`, sessionID: request.sessionID, requestID: request.id },
        (signal) => props.context.client.permission.reply({ sessionID: request.sessionID, requestID: request.id, reply }, { signal }))
      answeredRequests.add(requestKey(request))
      props.context.ui.toast.show({ message: reply === "once" ? "Permission approved once" : reply === "always" ? "Permission approved always" : "Permission denied", variant: "success" })
    }).pipe(Effect.ensuring(Effect.sync(() => {
      setReplying(false)
      setReviewVersion((version) => version + 1)
      refreshLocationForSession(request.sessionID)
    }))), showFailure).done
  }

  function changeLifecycle(inactive: boolean) {
    const selected = selectedSession()
    if (!selected || changingLifecycle() || replying() || !archivesReady()) return
    const session = lifecycleOwner(sessions(), selected)
    const family = [session.id, ...descendantIDs(sessions(), session.id)]
    const affected = new Set(family)
    const neighbor = sectionNeighbor(options().filter((option) => option.value === session.id || !affected.has(option.value)), session.id) ?? NEW_SESSION_VALUE
    if (inactive && isArchived(session.id)) return
    setChangingLifecycle(true)
    return runner.start(Effect.gen(function* () {
      if (inactive) {
        const saved = yield* operation({ operation: "Archive session", sessionID: session.id },
          () => archiveSession(props.context.client, archiveStore, session))
        for (const id of saved.familyIDs) affected.add(id)
        for (const id of affected) deletedIDs.add(id)
        setArchives((items) => [...items.filter((item) => item.transcript.info.id !== session.id), saved])
        setSessions((items) => items.filter((item) => !affected.has(item.id)))
        setAttention((current) => new Map([...current].filter(([id]) => !affected.has(id))))
      } else if (isArchived(session.id)) {
        const restored = yield* operation({ operation: "Restore archived session", sessionID: session.id },
          () => restoreSession(props.context.client, archiveStore, archived(session.id)!))
        deletedIDs.delete(restored.id)
        setSessions((items) => [...items.filter((item) => item.id !== restored.id), restored])
        setArchives((items) => items.filter((item) => item.transcript.info.id !== session.id))
      }
      yield* operation({ operation: "Update lifecycle marker", sessionID: session.id }, () => updateLifecycle((draft) => {
        if (inactive) draft.inactive[session.id] = true
        else delete draft.inactive[session.id]
      }))
      // Don't steal selection if the user navigated while the request ran.
      if (selectedValue() === selected.id) setSelectedValue(neighbor)
      props.context.ui.toast.show({ message: inactive ? "Session archived; family deleted" : "Session restored to active", variant: "success" })
    }).pipe(Effect.ensuring(Effect.sync(() => {
      setChangingLifecycle(false)
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
        if (deletedIDs.has(target)) break
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
      const known = new Map(liveSessions().map((session) => [session.id, session]))
      for (const session of result.data) if (!deletedIDs.has(session.id)) known.set(session.id, session)
      const loaded = [...known.values()]
      setSessions(loaded)
      setCursor(result.cursor.next ?? undefined)
      refreshAttention(loaded)
    }).pipe(Effect.ensuring(Effect.sync(() => setLoading(false)))), setFailure).done
  }

  function open(sessionID: string) {
    if (isArchived(sessionID)) {
      props.context.ui.toast.show({ message: "Archived session — press r to import and restore", variant: "info" })
      return
    }
    props.context.ui.dialog.clear()
    props.context.ui.router.navigate({ type: "session", sessionID })
  }

  function close() {
    props.context.ui.dialog.clear()
    if (currentSessionID && deletedIDs.has(currentSessionID)) {
      props.context.ui.router.navigate({ type: "home" })
    }
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
        run: close,
      },
      { bind: "escape", run: close },
      {
        bind: "n",
        run: newSession,
      },
      { bind: "up", run: () => moveSelection(-1) },
      { bind: "k", run: () => moveSelection(-1) },
      { bind: "down", run: () => moveSelection(1) },
      { bind: "/", run: async () => {
        const value = await props.context.ui.dialog.prompt({ title: "Search sessions (including archives)", placeholder: "Title or directory; empty clears filter" })
        if (value === undefined) return
        setSearch(value ?? "")
        setSelectedValue(NEW_SESSION_VALUE)
      } },
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
    runner.start(operation({ operation: "Load session archives" }, () => archiveStore.list()).pipe(
      Effect.map((items) => { setArchives(items); setArchivesReady(true) }),
    ), showFailure)
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
      props.context.data.on("server.connected", () => {
        refreshActiveSessions()
        setReviewVersion((version) => version + 1)
      }),
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
        deletedIDs.delete(event.data.sessionID)
        void refreshSessionRow(event.data.sessionID)
      }),
      props.context.data.on("session.renamed", (event) => {
        const title = event.data.title
        setSessions((loaded) =>
          loaded.map((item) => (item.id === event.data.sessionID ? { ...item, title } : item)),
        )
      }),
      props.context.data.on("session.deleted", (event) => {
        deletedIDs.add(event.data.sessionID)
        if (!changingLifecycle() && selectedValue() === event.data.sessionID) setSelectedValue(NEW_SESSION_VALUE)
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
      width={offsetHostInsets() ? dimensions().width : "100%"}
      height={dialogHeight()}
      position="relative"
      left={offsetHostInsets() ? -1 : 0}
      top={offsetHostInsets() ? -1 : 0}
      minHeight={0}
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
              // Hardcoded: the active theme maps its yellow ramp to grey, so
              // theme hues can't provide a bright selection color.
              const SELECTED = "#fde047"
              const active = () => selectedIndex() === index
              const titleColor = () => active()
                ? SELECTED
                : option().state === "inactive" ? props.context.theme.text.subdued : props.context.theme.text.default
               const heading = () => {
                 const label = groupLabel(option().state)
                 return label !== groupLabel(options()[index - 1]?.state ?? "new") ? label : undefined
               }
              const descriptionColor = () => active() ? props.context.theme.text.default : props.context.theme.text.subdued
              const iconColor = () => {
                if (option().state === "permission") return props.context.theme.text.status.permission
                if (option().state === "question") return props.context.theme.text.status.question
                if (option().state === "running") return SELECTED
                return descriptionColor()
              }
              return (
                <>
                {heading() ? (
                  <box height={mobile() ? 2 : 3} flexShrink={0} paddingLeft={0} paddingRight={0}
                    border={["top"]} borderColor={props.context.theme.hue.accent[400]}>
                    <text fg={props.context.theme.text.default} attributes={TextAttributes.BOLD}>{heading()}</text>
                  </box>
                ) : null}
                <box
                  id={`claude-session-row-${index}`}
                  height={1}
                  flexShrink={0}
                  flexDirection="row"
                  paddingLeft={0}
                  paddingRight={0}
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
                  <box
                    id={`claude-session-gutter-${index}`}
                    width={1}
                    height={1}
                    flexShrink={0}
                  >
                    {(() => {
                      const state = option().state
                      const icon = state === "running" ? "spinner"
                        : state === "permission" ? "!"
                        : state === "question" ? "?"
                        : state === "new" ? "+" : active() ? "❯" : ""
                      if (!icon) return null
                      if (icon === "❯") return (
                        <text fg={SELECTED} attributes={TextAttributes.BOLD}>{icon}</text>
                      )
                      return (
                        icon === "spinner" ? (
                          <spinner frames={SPINNER_FRAMES} interval={80} color={iconColor()} />
                        ) : (
                          <text fg={iconColor()}>{icon}</text>
                        )
                      )
                    })()}
                  </box>
                  <box
                    height={1}
                    flexDirection="row"
                    flexGrow={1}
                    flexBasis={0}
                    minWidth={0}
                    overflow="hidden"
                    paddingLeft={Math.max(0, Math.min(option().depth, 4) * 2)}
                  >
                    <text id={`claude-session-title-${index}`} wrapMode="none" flexShrink={1} fg={titleColor()} attributes={active() ? TextAttributes.BOLD : undefined}>
                      {option().title}
                    </text>
                    {(() => {
                      const row = option()
                      return !mobile() && "status" in row && row.status ? (
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
                      {!mobile() && "value" in option() && rowPercents().get(option().value as string) ? (
                        <text flexShrink={0} fg={descriptionColor()}>{` ${rowPercents().get(option().value as string)}`}</text>
                      ) : null}
                      <box width={mobile() ? 5 : 8} flexShrink={0} justifyContent="flex-end">
                        <text wrapMode="none" fg={descriptionColor()}>
                          {mobile()
                            ? ((option() as { updated?: string }).updated ?? "").replace(" ago", "").padStart(5)
                            : ((option() as { updated?: string }).updated ?? "").padStart(8)}
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
        {(mobile() && selectedSession()) || inboxRequest() ? (
          <text id="claude-session-preview-title" maxHeight={2} flexShrink={0} fg={props.context.theme.text.default} attributes={TextAttributes.BOLD}>
            {inboxRequest() ? inboxOwner()?.title || inboxRequest()!.sessionID : options()[selectedIndex()]?.title}
          </text>
        ) : null}
        {!(mobile() && permission() && dimensions().height < 20) ? (
          <text height={1} flexShrink={0} wrapMode="none" fg={props.context.theme.text.subdued}>{inboxRequest()
            ? inboxOwner() ? shortenLocation(props.context.ui.format.path(inboxOwner()!.location.directory)) : ""
            : options()[selectedIndex()]?.description}</text>
        ) : null}
        {!inboxRequest() && (!mobile() || !permission()) ? (
        <box height={1} flexShrink={0} flexDirection="row" justifyContent="space-between">
           <text wrapMode="none" flexShrink={1} fg={props.context.theme.text.default} attributes={TextAttributes.BOLD}>
            {selectedStats().left}
          </text>
          <text flexShrink={0} fg={props.context.theme.text.subdued} attributes={TextAttributes.BOLD}>
            {selectedStats().right}
          </text>
        </box>
        ) : null}
        {selectedSession() && !inboxRequest() && (!mobile() || !permission()) ? (
          <text id="claude-session-token-breakdown" height={1} flexShrink={0} wrapMode="none" fg={props.context.theme.text.subdued}>
            {sessionTokenBreakdown(selectedSession()!, mobile())}
          </text>
        ) : null}
        {permission() ? (
          <>
            <text height={1} flexShrink={0} wrapMode="none" fg={props.context.theme.text.status.permission} attributes={TextAttributes.BOLD}>
              {previewError() ? `Preview unavailable: ${previewError()}` : `${permission()!.action} · 1/${visiblePreview()!.permissions.length}${isInbox() && visiblePreview()!.forms.length ? ` · ?${visiblePreview()!.forms.length}` : ""}${isInbox() && inboxErrors().length ? ` · ${inboxErrors().length} unavailable` : ""}`}
            </text>
            <scrollbox id="claude-session-request" ref={previewScroll} flexGrow={1} minHeight={0} scrollY scrollX={false}>
              <text fg={props.context.theme.text.default}>
                {[permission()!.message, ...permission()!.resources,
                  permission()!.metadata ? JSON.stringify(permission()!.metadata, null, 2) : undefined].filter(Boolean).join("\n")}
              </text>
            </scrollbox>
            <box id="claude-session-approval-actions" height={approvalButtonHeight()} flexShrink={0} flexDirection="row" gap={1}>
              <Index each={[
                { id: "approve", reply: "once" as const, label: "Allow" },
                { id: "deny", reply: "reject" as const, label: "Deny" },
                { id: "always", reply: "always" as const, label: "Always" },
              ]}>
                {(action) => {
                  const disabled = () => replying() || previewLoading() || !!previewError() || changingLifecycle()
                  return (
                    <box id={`claude-session-${action().id}`} flexGrow={1} flexBasis={0} minWidth={0}
                      height={approvalButtonHeight()} justifyContent="center" alignItems="center"
                      backgroundColor={action().reply === "once" && !disabled()
                        ? props.context.theme.hue.accent[400]
                        : props.context.theme.contextual.overlay.background.surface.offset}
                      onMouseDown={(event) => {
                        if (event.button !== 0) return
                        event.stopPropagation()
                        event.preventDefault()
                        if (!disabled()) void replyToPermission(action().reply)
                      }}>
                      <text wrapMode="none" fg={action().reply === "once" && !disabled()
                        ? props.context.theme.contextual.overlay.background.default
                        : action().reply === "always" || disabled() ? props.context.theme.text.subdued : props.context.theme.text.default}
                        attributes={action().reply === "once" ? TextAttributes.BOLD : undefined}>
                        {replying() && replyChoice() === action().reply ? "Sending…" : action().label}
                      </text>
                    </box>
                  )
                }}
              </Index>
            </box>
          </>
        ) : (
          <>
            <text wrapMode="none" fg={props.context.theme.text.subdued}>
              {selectedSession() && isArchived(selectedSession()!.id)
                ? `Archived · ${selectedMessages()?.length ?? 0} messages`
                : previewLoading() ? "Checking for approval requests…" : previewError() ? `Preview unavailable: ${previewError()}` : visiblePreview()?.forms.length ? `Question · ${visiblePreview()!.forms[0]!.title}` : isInbox() && inboxErrors().length ? `${inboxErrors().length} location${inboxErrors().length === 1 ? "" : "s"} unavailable` : selectedSession() ? (options()[selectedIndex()] as { status?: string })?.status ?? "" : ""}
            </text>
            {isInbox() && visiblePreview()?.forms.length ? (
              <scrollbox flexGrow={1} minHeight={0} scrollY scrollX={false}>
                <text fg={props.context.theme.text.default}>{visiblePreview()!.forms[0]!.fields.map((field) => field.title ?? field.key).join("\n")}</text>
              </scrollbox>
            ) : null}
            {selectedSession() && isArchived(selectedSession()!.id) ? (
              <scrollbox flexGrow={1} minHeight={0} scrollY scrollX={false}>
                <text fg={props.context.theme.text.default}>{(selectedMessages() ?? []).flatMap((message) =>
                  message.type === "user" ? [`User: ${message.text}`]
                    : message.type === "assistant" ? message.content.filter((part) => part.type === "text").map((part) => `Assistant: ${part.text}`) : [],
                ).join("\n\n")}</text>
              </scrollbox>
            ) : null}
          </>
        )}
        </box>
        <box height={1} flexShrink={0} flexDirection="row" gap={mobile() ? 1 : 0}>
          {inboxRequest() ? (
            <text id="claude-session-inbox-open" fg={props.context.theme.text.default} onMouseDown={(event) => {
              if (event.button !== 0) return
              event.stopPropagation()
              event.preventDefault()
              open(inboxRequest()!.sessionID)
            }}>{mobile() ? "[Open]" : "[Open request] "}</text>
          ) : null}
          {mobile() && (!selectedSession() || !isArchived(selectedSession()!.id)) ? (
            <text id="claude-session-open" fg={props.context.theme.text.default} onMouseDown={(event) => {
              if (event.button !== 0) return
              event.stopPropagation()
              event.preventDefault()
              selectCurrent()
            }}>{selectedSession() ? "[Open]" : "[New]"}</text>
          ) : null}
          {selectedSession() ? (
            <text id="claude-session-preview-lifecycle" wrapMode="none" fg={props.context.theme.text.default}
              onMouseDown={(event) => {
                if (event.button !== 0) return
                event.stopPropagation()
                event.preventDefault()
                void changeLifecycle(options()[selectedIndex()]?.state !== "inactive")
              }}>
              {changingLifecycle() ? "[Updating…]" : options()[selectedIndex()]?.state === "inactive" ? "[Restore]" : "[Archive]"}
            </text>
          ) : null}
          {mobile() ? (
            <text id="claude-session-close" fg={props.context.theme.text.subdued} onMouseDown={(event) => {
              if (event.button !== 0) return
              event.stopPropagation()
              event.preventDefault()
              close()
            }}>[Close]</text>
          ) : <text fg={props.context.theme.text.subdued}>{search() ? ` · / filter: ${search()}` : " · / search"}</text>}
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

export function showSessionPicker(context: Plugin.Context) {
  const route = context.ui.router.current()
  if (route.type !== "home" && route.type !== "session") return false

  const returnSessionID = route.type === "session" ? route.sessionID : undefined
  context.ui.dialog.show(() => <SessionPicker context={context} returnSessionID={returnSessionID} />)
  // show() resets host presentation options, so apply these after mounting.
  context.ui.dialog.set({ size: "xlarge", centered: true })
}

function EmptyPromptBinding(props: { context: Plugin.Context }) {
  const openPicker = () => showSessionPicker(props.context)

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
    const unregisterSlot = context.ui.slot({
      append: "app",
      render: () => <EmptyPromptBinding context={context} />,
    })
    return () => {
      unregisterSlot()
    }
  },
})
