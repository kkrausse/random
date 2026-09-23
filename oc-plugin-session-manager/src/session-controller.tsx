/** @jsxImportSource @opentui/solid */
import type { FormInfo, PermissionRequest, SessionInfo } from "@opencode/client"
import type { Plugin } from "@opencode/plugin/tui"
import { batch, createEffect, createMemo, createRoot, createSignal, onCleanup, untrack } from "solid-js"
import { Cause, Effect } from "effect"
import { descendantIDs, imputedInactiveRoots, inheritLifecycle, lifecycleOwner, nestRows, propagateAttention, sessionState, sortRows, type Attention } from "./session-groups"
import { sectionNeighbor } from "./picker-selection"
import { makeRunner, operation } from "./effects"
import { fileArchiveStore, restoreSession, type Archive, type ArchiveStore } from "./archive"
import { sessionFamily, softArchiveSession } from "./soft-archive"
import { loadInbox, pendingOrder, requestKey } from "./inbox"
import { attentionAPI } from "./attention-api"
import { contextStats, contextUsage, relativeTime, shortenLocation } from "./session-display"

const PAGE_SIZE = 100
export const NEW_SESSION_VALUE = "__claude_sessions_new__"
const locationKey = (session: SessionInfo) => session.location.directory
const SESSION_SUMMARY_REFRESH_EVENTS = new Set([
  "session.created",
  "session.moved",
  "session.agent.selected",
  "session.model.selected",
  "session.revert.staged",
  "session.revert.cleared",
  "session.revert.committed",
])

export type SessionController = ReturnType<typeof createSessionController>

// An explicit root belongs to the plugin, never to the dialog that first opens it.
// Reads and event reconciliation belong to this root, independently of views.
export function createSessionController(context: Plugin.Context, archiveStore: ArchiveStore = fileArchiveStore()) {
  return createRoot((disposeRoot) => {
    let disposed = false
    let started = false
    let attachments = 0
    let opening = 0
    const openingTimes = new Map<string, number>()
    const [attached, setAttached] = createSignal(false)
    const [currentSessionID, setCurrentSessionID] = createSignal<string>()
    const createRunner = () => makeRunner((message, cause) => {
      console.error(`[claude.sessions] ${message}\n${Cause.pretty(cause)}`)
    })
    const reads = createRunner()
    const mutations = createRunner()
    const showFailure = (message: string) => context.ui.toast.show({
      title: "Sessions viewer", message, variant: "error", duration: 8000,
    })
    const [lifecycle, updateLifecycle] = context.storage.store("session-lifecycle", {
      initial: { inactive: {} as Record<string, boolean> },
    })
    const [changingLifecycle, setChangingLifecycle] = createSignal<Set<string>>()
    const [archives, setArchives] = createSignal<Archive[]>([])
    const [archivesReady, setArchivesReady] = createSignal(false)
    const deletedIDs = new Set<string>()
    const [liveSessions, setSessions] = createSignal<SessionInfo[]>([])
    const [firstPageReady, setFirstPageReady] = createSignal(false)
    const [activeReady, setActiveReady] = createSignal(false)
    const [inboxReady, setInboxReady] = createSignal(false)
    const [ready, setReady] = createSignal(false)
    const [discovering, setDiscovering] = createSignal(0)
    // Metadata/status changes within the same locations need not rediscover the
    // inbox. Newly loaded or active locations do, without another history query.
    const inboxLocations = createMemo(() => [...new Set(liveSessions().map(locationKey))].sort().join("\0"))
    const archived = (id: string) => archives().find((item) => item.transcript.info.id === id)
    const isArchived = (id: string) => !!archived(id) && !liveSessions().some((session) => session.id === id)
    const sessions = createMemo(() => {
      // Legacy archives join the initial live snapshot.
      const merged = new Map((firstPageReady() ? archives() : []).map((item) => [item.transcript.info.id, item.transcript.info]))
      for (const session of liveSessions()) merged.set(session.id, session)
      return [...merged.values()]
    })
    const requestsAPI = attentionAPI(context)
    const [liveVersion, setLiveVersion] = createSignal(0)
    const [attentionChecks, setAttentionChecks] = createSignal(new Map<string, "checking" | "ready" | "unavailable">())
    const [attentionErrors, setAttentionErrors] = createSignal(new Map<string, string>())
    const [requestSnapshots, setRequestSnapshots] = createSignal(new Map<string, ReturnType<typeof requestsAPI.read>>())
    const attentionSnapshots = createMemo(() => {
      liveVersion()
      return new Map<string, { state: Attention | undefined; running: boolean }>(liveSessions().map((session) => {
        const check = attentionChecks().get(session.id) ?? "checking"
        if (check !== "ready") return [session.id, { state: check as Attention, running: false }]
        try {
          const current = requestSnapshots().get(session.id)
          if (!current) return [session.id, { state: "unavailable" as const, running: false }]
          const status = context.data.session.status(session.id)
          if (status !== "idle" && status !== "running") return [session.id, { state: "unavailable" as const, running: false }]
          return [session.id, { state: current.permissions.length ? "permission" as const : current.forms.length ? "question" as const
            : attentionErrors().has(`location:${locationKey(session)}`) ? "unavailable" as const : undefined, running: status === "running" }]
        } catch {
          return [session.id, { state: "unavailable" as const, running: false }]
        }
      }))
    })
    const attention = createMemo(() => new Map([...attentionSnapshots()].flatMap(([id, snapshot]) => snapshot.state ? [[id, snapshot.state] as const] : [])))
    const [cursor, setCursor] = createSignal<string>()
    const [loading, setLoading] = createSignal(false)
    const [failure, setFailure] = createSignal<string>()
    const [selectedValue, setSelectedValue] = createSignal(NEW_SESSION_VALUE)
    const [expanded, setExpanded] = createSignal<Set<string>>(new Set())
    const [search, setSearch] = createSignal("")
    const [tick, setTick] = createSignal(0)
    const [reviewVersion, setReviewVersion] = createSignal(0)
    const [inboxPreview, setInboxPreview] = createSignal<{ sessionID: string; permissions: PermissionRequest[]; forms: FormInfo[] }>()
    const [inboxSessions, setInboxSessions] = createSignal<SessionInfo[]>([])
    const [inboxErrors, setInboxErrors] = createSignal<string[]>([])
    const answeredRequests = new Set<string>()
    const [inboxLoading, setPreviewLoading] = createSignal(false)
    const [inboxError, setPreviewError] = createSignal<string>()
    const [replying, setReplying] = createSignal(false)
    const [replyChoice, setReplyChoice] = createSignal<"once" | "always" | "reject">()
    const queriedLocations = new Set<string>()
    const queriedSessions = new Set<string>()
    const attentionRequests = new Map<string, number>()

    const rows = createMemo(() => {
      tick()
      liveVersion()
      const loaded = sessions()
      for (const session of loaded) {
        if (!openingTimes.has(session.id)) openingTimes.set(session.id, session.time.updated)
      }
      const imputed = imputedInactiveRoots(loaded, currentSessionID())
      const effective = propagateAttention(loaded, attention(), currentSessionID())
      return nestRows(sortRows(inheritLifecycle(
        loaded.map((session) => {
          const owner = lifecycleOwner(loaded, session)
          const override = lifecycle.inactive[owner.id]
          const inactiveByAge = override === undefined && imputed.has(owner.id)
          const ownRunning = !isArchived(session.id) && !!attentionSnapshots().get(session.id)?.running
          const runningChildren = descendantIDs(loaded, session.id)
            .filter((id) => attentionSnapshots().get(id)?.running).length
          const rowAttention = effective.get(session.id) ?? attention().get(session.id)
          const inactive = override ?? inactiveByAge
          // Unknown status is a badge, not evidence that an archived family is
          // active. Only verified running/input status overrides its section.
          const sectionAttention = inactive && (rowAttention === "checking" || rowAttention === "unavailable") ? undefined : rowAttention
          return {
            session, ownRunning, runningChildren, inactiveByAge, rowAttention,
            state: isArchived(session.id) ? "inactive" as const : sessionState(sectionAttention,
              ownRunning || runningChildren > 0, inactive),
          }
        }),
      ), openingTimes))
    })
    const options = createMemo(() => [
      { title: "New session", description: "Start with a blank prompt", value: NEW_SESSION_VALUE, state: "new" as const, statusState: "new" as const, depth: 0, childCount: 0, expanded: false },
      ...rows().filter(({ session }) => {
        if (search()) return `${session.title ?? "Untitled session"} ${session.location.directory}`.toLowerCase().includes(search().toLowerCase())
        // One expansion reveals the entire loaded family, including grandchildren.
        // Orphans become their own roots until an ancestor is loaded.
        const root = lifecycleOwner(sessions(), session)
        return root.id === session.id || expanded().has(root.id) || session.id === currentSessionID()
          || descendantIDs(sessions(), session.id).includes(currentSessionID() ?? "")
      }).map(({ session, state, runningChildren, depth, inactiveByAge, rowAttention }) => {
        const statusState = state === "inactive" && !isArchived(session.id) ? rowAttention ?? state : state
        const baseStatus = {
          permission: "Permission required", question: "Question waiting", unavailable: "Status unavailable", checking: "Checking status…",
          inactive: inactiveByAge && !isArchived(session.id) ? "Inactive · 7d+" : "Archived", idle: "Ready",
        }[statusState as Attention | "inactive" | "idle"]
        const childStatus = `${runningChildren} sub-agent${runningChildren === 1 ? "" : "s"} running`
        const status = runningChildren > 0
          ? state === "running" ? childStatus : `${baseStatus} · ${childStatus}`
          : state === "running" ? undefined : baseStatus
        const location = shortenLocation(context.ui.format.path(session.location.directory))
        const details = [relativeTime(session.time.updated), location]
        if (session.agent) details.push(session.agent)
        return {
          title: session.title?.trim() || "Untitled session", description: details.join(" · "), status, state, statusState, inactiveByAge,
          value: session.id, depth, updated: relativeTime(session.time.updated),
          childCount: lifecycleOwner(sessions(), session).id === session.id ? descendantIDs(sessions(), session.id).length : 0,
          expanded: expanded().has(session.id),
        }
      }),
    ])
    const selectedIndex = createMemo(() => options().findIndex((option) => option.value === selectedValue()))
    function toggleChildren() {
      const selected = sessions().find((session) => session.id === selectedValue())
      const id = selected ? lifecycleOwner(sessions(), selected).id : selectedValue()
      if (id === NEW_SESSION_VALUE || !descendantIDs(sessions(), id).length) return
      const next = new Set(expanded())
      if (next.has(id)) {
        next.delete(id)
        if (selectedValue() !== id) setSelectedValue(id)
      } else next.add(id)
      setExpanded(next)
    }
    const selectedSession = createMemo(() => sessions().find((session) => session.id === selectedValue()))
    const [contextSyncing, setContextSyncing] = createSignal(false)
    const [contextVersion, setContextVersion] = createSignal(0)
    const [contextChecks, setContextChecks] = createSignal(new Map<string, "ready" | "unavailable">())
    const selectedMessages = createMemo(() => {
      const sessionID = selectedSession()?.id
      return sessionID ? isArchived(sessionID) ? archived(sessionID)?.transcript.messages : context.data.session.message.list(sessionID) : undefined
    })
    const selectedModels = createMemo(() => {
      const session = selectedSession()
      return session ? context.data.location.model.list(session.location) : undefined
    })
    const selectedCost = createMemo(() => {
      const session = selectedSession()
      if (!session) return 0
      const live = context.data.session.cost(session.id)
      return live > 0 ? live : session.cost
    })
    const selectedUsage = createMemo(() => contextUsage(selectedMessages(), selectedModels(), selectedSession()?.revert?.messageID))
    const selectedStats = createMemo(() => contextChecks().get(selectedSession()?.id ?? "") === "unavailable"
      ? { left: "Context unavailable · Ctrl+R to retry", right: "" }
      : contextStats(selectedSession(), selectedUsage(), selectedCost(), contextSyncing()))
    const [rowPercents, setRowPercents] = createSignal(new Map<string, string>())
    const rowFetching = new Set<string>()
    const contextRequests = new Map<string, number>()
    const isInbox = () => selectedValue() === NEW_SESSION_VALUE
    const previewIDs = createMemo(() => {
      const session = selectedSession()
      return session && !isArchived(session.id) ? [session.id, ...descendantIDs(sessions(), session.id)] : []
    })
    const previewLoading = () => isInbox() ? inboxLoading() : previewIDs().some((id) => !attentionChecks().has(id) || attentionChecks().get(id) === "checking")
    const previewError = () => isInbox() ? inboxError() : previewIDs().map((id) => attentionErrors().get(id)).find(Boolean)
    const visiblePreview = createMemo(() => {
      liveVersion()
      reviewVersion()
      if (isInbox()) return inboxPreview()
      const session = selectedSession()
      if (!session || isArchived(session.id)) return undefined
      const related = [session.id, ...descendantIDs(sessions(), session.id)]
      if (related.some((id) => attentionChecks().get(id) !== "ready")) return undefined
      try {
        const requests = related.map((id) => requestSnapshots().get(id)!)
        return { sessionID: session.id,
          permissions: requests.flatMap((item) => item.permissions).filter((item) => !answeredRequests.has(requestKey(item))),
          forms: requests.flatMap((item) => item.forms) }
      } catch { return undefined }
    })
    const permission = createMemo(() => visiblePreview()?.permissions[0])
    const inboxRequest = createMemo(() => isInbox() ? permission() ?? visiblePreview()?.forms[0] : undefined)
    const inboxOwner = createMemo(() => inboxSessions().find((session) => session.id === inboxRequest()?.sessionID))

    createEffect(() => {
      const session = selectedSession()
      const usage = selectedUsage()
      if (session && usage?.percent !== undefined) {
        const label = `${usage.percent}%`
        setRowPercents((current) => current.get(session.id) === label ? current : new Map(current).set(session.id, label))
      }
    })
    createEffect(() => {
      contextVersion()
      const targets = liveSessions()
        .filter((session) => !contextChecks().has(session.id) && !rowFetching.has(session.id))
        .slice(0, Math.max(0, 4 - rowFetching.size))
      for (const session of targets) {
        const version = contextRequests.get(session.id) ?? 0
        rowFetching.add(session.id)
        reads.start(Effect.all([
          operation({ operation: "Sync row context messages", sessionID: session.id }, () => context.data.session.message.sync(session.id)),
          operation({ operation: "Sync row models", directory: session.location.directory }, () => context.data.location.model.sync(session.location)),
        ], { concurrency: "unbounded" }).pipe(
          Effect.tap(() => Effect.sync(() => {
            if (disposed) return
            const fresh = liveSessions().find((item) => item.id === session.id) ?? session
            const messages = context.data.session.message.list(session.id)
            const models = context.data.location.model.list(fresh.location)
            const usage = contextUsage(messages, models, fresh.revert?.messageID)
            if (usage?.percent !== undefined) setRowPercents((current) => new Map(current).set(session.id, `${usage.percent}%`))
            if ((contextRequests.get(session.id) ?? 0) === version) setContextChecks((current) => new Map(current).set(session.id, "ready"))
          })),
          Effect.catch((error) => Effect.sync(() => {
            console.error(`[claude.sessions] ${error.message}`, error)
            if ((contextRequests.get(session.id) ?? 0) === version) setContextChecks((current) => new Map(current).set(session.id, "unavailable"))
          })),
          Effect.ensuring(Effect.sync(() => {
            rowFetching.delete(session.id)
            if (!disposed) setContextVersion((version) => version + 1)
          })),
        ))
      }
    })
    createEffect(() => {
      const session = selectedSession()
      setContextSyncing(!!session && !isArchived(session.id) && !contextChecks().has(session.id))
    })
    createEffect(() => {
      inboxLocations()
      reviewVersion()
      let cancelled = false
      onCleanup(() => { cancelled = true })
      setPreviewError(undefined)
      setPreviewLoading(true)
        const job = reads.start(loadInbox(context.client, untrack(liveSessions)).pipe(Effect.tap((inbox) => Effect.sync(() => {
          if (cancelled) return
          setInboxSessions(inbox.sessions)
          setInboxErrors(inbox.errors)
          setInboxPreview((current) => ({
            sessionID: NEW_SESSION_VALUE,
            permissions: pendingOrder(current?.permissions ?? [], inbox.permissions.filter((request) => !answeredRequests.has(requestKey(request)))),
            forms: pendingOrder(current?.forms ?? [], inbox.forms),
          }))
        })), Effect.ensuring(Effect.sync(() => { if (!cancelled) { setPreviewLoading(false); setInboxReady(true) } }))),
        (message) => { if (!cancelled) { setInboxPreview(undefined); setPreviewError(message) } })
        onCleanup(job.cancel)
    })
    createEffect(() => {
      if (ready() || !firstPageReady() || !archivesReady() || !activeReady() || !inboxReady() || inboxLoading() || discovering()) return
      if (liveSessions().some((session) => !contextChecks().has(session.id)
        || !attentionChecks().has(session.id) || attentionChecks().get(session.id) === "checking")) return
      setReady(true)
    })

    function replyToPermission(reply: "once" | "always" | "reject") {
      const request = permission()
      if (disposed || !request || replying() || changingLifecycle() || previewLoading() || previewError()) return
      setReplyChoice(reply)
      setReplying(true)
      return mutations.start(Effect.gen(function* () {
        yield* operation({ operation: `Reply to permission (${reply})`, sessionID: request.sessionID, requestID: request.id },
          (signal) => requestsAPI.reply(request, reply, signal))
        answeredRequests.add(requestKey(request))
        context.ui.toast.show({ message: reply === "once" ? "Permission approved once" : reply === "always" ? "Permission approved always" : "Permission denied", variant: "success" })
      }).pipe(Effect.ensuring(Effect.sync(() => {
        setReplying(false)
        setReviewVersion((version) => version + 1)
        refreshLocationForSession(request.sessionID)
      }))), showFailure).done
    }

    function changeLifecycle(inactive: boolean) {
      const selected = selectedSession()
      if (disposed || !selected || changingLifecycle() || replying()) return
      if (!inactive && isArchived(selected.id) && !archivesReady()) return
      const session = lifecycleOwner(sessions(), selected)
      const family = [session.id, ...descendantIDs(sessions(), session.id)]
      const affected = new Set(family)
      const generation = opening
      const neighbor = sectionNeighbor(options().filter((option) => option.value === session.id || !affected.has(option.value)), session.id) ?? NEW_SESSION_VALUE
      if (inactive && isArchived(session.id)) return
      setChangingLifecycle(new Set(affected))
      return mutations.start(Effect.gen(function* () {
        let owner = session
        if (inactive) {
          const stopped = yield* operation({ operation: "Archive session", sessionID: session.id }, () => softArchiveSession(context.client, session))
          owner = stopped[0]!
          for (const member of stopped) affected.add(member.id)
          setChangingLifecycle(new Set(affected))
          setSessions((items) => [...new Map([...items, ...stopped].map((item) => [item.id, item])).values()])
          yield* Effect.all(stopped.map((member) => operation({ operation: "Refresh archived attention", sessionID: member.id },
            () => requestsAPI.sync(member))), { concurrency: 4 })
          setAttentionChecks((current) => {
            const next = new Map(current)
            for (const member of stopped) next.set(member.id, "ready")
            return next
          })
          setRequestSnapshots((current) => {
            const next = new Map(current)
            for (const member of stopped) next.set(member.id, requestsAPI.read(member))
            return next
          })
        } else if (isArchived(session.id)) {
          const restored = yield* operation({ operation: "Restore archived session", sessionID: session.id },
            () => restoreSession(context.client, archiveStore, archived(session.id)!))
          deletedIDs.delete(restored.id)
          setSessions((items) => [...items.filter((item) => item.id !== restored.id), restored])
          setArchives((items) => items.filter((item) => item.transcript.info.id !== session.id))
        } else {
          const family = yield* operation({ operation: "Load family to restore", sessionID: session.id }, () => sessionFamily(context.client, session))
          owner = family[0]!
          for (const member of family) affected.add(member.id)
          setChangingLifecycle(new Set(affected))
          setSessions((items) => [...new Map([...items, ...family].map((item) => [item.id, item])).values()])
        }
        yield* operation({ operation: "Update lifecycle marker", sessionID: session.id }, () => updateLifecycle((draft) => {
          for (const id of affected) delete draft.inactive[id]
          draft.inactive[owner.id] = inactive
        }))
        if (attached() && generation === opening && selectedValue() === selected.id) setSelectedValue(neighbor)
        context.ui.toast.show({ message: inactive ? "Session soft archived; family stopped, history retained" : "Session restored to active", variant: "success" })
      }).pipe(Effect.ensuring(Effect.sync(() => {
        setChangingLifecycle(undefined)
        setReviewVersion((version) => version + 1)
      }))), showFailure, { detached: true }).done
    }

    function applyAttentionLookup(location: SessionInfo["location"], key: string) {
      if (disposed) return
      setDiscovering((count) => count + 1)
      reads.start(Effect.gen(function* () {
        const requests = yield* operation({ operation: "Discover attention owners", directory: location.directory },
          (signal) => requestsAPI.discover(location, signal))
        for (const id of new Set([...requests.permissions, ...requests.forms].map((request) => request.sessionID))) {
          if (!liveSessions().some((session) => session.id === id)) yield* operation({ operation: "Load attention owner", sessionID: id },
            async () => { await refreshSessionRow(id) })
        }
        setAttentionErrors((current) => { const next = new Map(current); next.delete(`location:${key}`); return next })
      }).pipe(Effect.ensuring(Effect.sync(() => setDiscovering((count) => count - 1)))), (message) => {
        queriedLocations.delete(key)
        setAttentionErrors((current) => new Map(current).set(`location:${key}`, message))
      })
    }
    function refreshAttention(loaded: SessionInfo[], force = false) {
      if (disposed) return
      const order = new Map(rows().map((row, index) => [row.session.id, index]))
      const targets = loaded.filter((session) => !isArchived(session.id) && (force || !queriedSessions.has(session.id)))
        .sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity))
      const versions = new Map(targets.map((session) => {
        const version = (attentionRequests.get(session.id) ?? 0) + 1
        attentionRequests.set(session.id, version)
        return [session.id, version] as const
      }))
      if (targets.length) setAttentionChecks((current) => {
        const next = new Map(current)
        for (const session of targets) {
          queriedSessions.add(session.id)
          if (next.get(session.id) !== "ready") next.set(session.id, "checking")
        }
        return next
      })
      let completed: Array<{ id: string; error?: string; snapshot?: ReturnType<typeof requestsAPI.read> }> = []
      let publishTimer: ReturnType<typeof setTimeout> | undefined
      const publish = () => {
        clearTimeout(publishTimer)
        publishTimer = undefined
        const fresh = completed.filter((result) => attentionRequests.get(result.id) === versions.get(result.id))
        completed = []
        if (disposed || !fresh.length) return
        batch(() => {
          setRequestSnapshots((current) => {
            const next = new Map(current)
            for (const result of fresh) if (result.snapshot) next.set(result.id, result.snapshot)
            return next
          })
          setAttentionChecks((current) => {
            const next = new Map(current)
            for (const result of fresh) next.set(result.id, result.error ? "unavailable" : "ready")
            return next
          })
          setAttentionErrors((current) => {
            const next = new Map(current)
            for (const result of fresh) {
              if (result.error) next.set(result.id, result.error)
              else next.delete(result.id)
            }
            return next
          })
        })
      }
      if (targets.length) reads.start(Effect.all(targets.map((session) => operation({ operation: "Refresh attention status", sessionID: session.id },
        async () => { await requestsAPI.sync(session); return requestsAPI.read(session) }).pipe(
        Effect.map((snapshot) => ({ id: session.id, snapshot, error: undefined as string | undefined })),
        Effect.catch((error) => Effect.sync(() => {
          console.error(`[claude.sessions] ${error.message}`, error)
          if (attentionRequests.get(session.id) === versions.get(session.id)) queriedSessions.delete(session.id)
          return { id: session.id, error: error.message }
        })),
        Effect.tap((result) => Effect.sync(() => {
          // Coalesce fast completions into one paint instead of rebuilding the
          // entire list per response. Slow rows never hold back completed ones.
          completed.push(result)
          publishTimer ??= setTimeout(publish, 16)
        })),
      )), { concurrency: 4 }).pipe(Effect.ensuring(Effect.sync(publish))))
      const locations = new Map<string, SessionInfo["location"]>()
      for (const session of loaded) if (!isArchived(session.id)) locations.set(locationKey(session), session.location)
      for (const [key, location] of locations) {
        if (!force && queriedLocations.has(key)) continue
        queriedLocations.add(key)
        applyAttentionLookup(location, key)
      }
    }
    function refreshLocationForSession(sessionID: string) {
      if (disposed) return
      const session = sessions().find((item) => item.id === sessionID)
      if (!session) { void refreshSessionRow(sessionID); return }
      refreshAttention([session], true)
    }
    function refreshSessionRow(sessionID: string) {
      if (disposed) return
      return reads.start(Effect.gen(function* () {
        let id: string | undefined = sessionID
        const seen = new Set<string>()
        while (id && !seen.has(id)) {
          seen.add(id)
          const target: string = id
          const fresh = yield* operation({ operation: "Refresh session row", sessionID: target },
            (signal) => context.client.session.get({ sessionID: target }, { signal }))
          if (deletedIDs.has(target)) break
          setSessions((loaded) => [...loaded.filter((item) => item.id !== fresh.id), fresh])
          id = fresh.parentID && !sessions().some((item) => item.id === fresh.parentID) ? fresh.parentID : undefined
        }
        setLiveVersion((version) => version + 1)
        // Permission/form events refresh attention explicitly. Metadata reads
        // must not invalidate those caches and create a session-event loop.
        refreshAttention(liveSessions())
      })).done
    }
    function refreshActiveSessions() {
      if (disposed) return
      return reads.start(Effect.gen(function* () {
        const active = yield* operation({ operation: "Load active sessions" }, (signal) => context.client.session.active({ signal }))
        yield* Effect.all(Object.keys(active).map((id) => operation({ operation: "Load active session", sessionID: id },
          async () => { await refreshSessionRow(id) })), { concurrency: 4 })
      }).pipe(Effect.ensuring(Effect.sync(() => setActiveReady(true)))))
    }
    function refreshContextForSession(sessionID: string) {
      if (disposed) return
      contextRequests.set(sessionID, (contextRequests.get(sessionID) ?? 0) + 1)
      context.data.session.message.invalidate(sessionID)
      setContextChecks((current) => { const next = new Map(current); next.delete(sessionID); return next })
      setContextVersion((version) => version + 1)
    }
    function loadMore(initial = false) {
      if (disposed || loading() || (!initial && !cursor())) return
      setLoading(true)
      setFailure(undefined)
      return reads.start(Effect.gen(function* () {
        const result = yield* operation({ operation: initial ? "Load sessions" : "Load more sessions" }, (signal) => context.client.session.list({
          limit: PAGE_SIZE, order: "desc", ...(initial ? {} : { cursor: cursor() }),
        }, { signal }))
        const known = new Map(liveSessions().map((session) => [session.id, session]))
        for (const session of result.data) if (!deletedIDs.has(session.id)) known.set(session.id, session)
        const loaded = [...known.values()]
        setSessions(loaded)
        setCursor(result.cursor.next ?? undefined)
        refreshAttention(loaded)
      }).pipe(Effect.ensuring(Effect.sync(() => {
        if (disposed) return
        batch(() => { setLoading(false); if (initial) setFirstPageReady(true) })
      }))), setFailure).done
    }
    function refresh() {
      if (disposed) return
      if (failure()) void loadMore(true)
      setContextChecks(new Map())
      refreshAttention(liveSessions(), true)
      setReviewVersion((version) => version + 1)
    }

    // A session event during a read requests one follow-up, not a parallel read.
    const sessionRefreshes = new Map<string, boolean>()
    function refreshFromEvent(sessionID: string) {
      if (disposed || deletedIDs.has(sessionID)) return
      if (sessionRefreshes.has(sessionID)) { sessionRefreshes.set(sessionID, true); return }
      sessionRefreshes.set(sessionID, false)
      void (async () => {
        try {
          do {
            sessionRefreshes.set(sessionID, false)
            refreshContextForSession(sessionID)
            await refreshSessionRow(sessionID)
          } while (!disposed && !deletedIDs.has(sessionID) && sessionRefreshes.get(sessionID))
        } finally { sessionRefreshes.delete(sessionID) }
      })()
    }

    let unsubscribe = () => {}
    function start() {
      if (started) return
      started = true
      const unsubscribes = [
        context.data.on("server.connected", () => {
          void loadMore(true)
          refreshActiveSessions()
          refreshAttention(sessions(), true)
          setReviewVersion((version) => version + 1)
        }),
        context.data.listen(({ details }) => {
          if (["permission.asked", "permission.replied", "form.created", "form.replied", "form.cancelled"].includes(details.type)) {
            setReviewVersion((version) => version + 1)
          }
          if (!details.type.startsWith("session.") || !("sessionID" in details.data)
            || typeof details.data.sessionID !== "string") return
          const sessionID = details.data.sessionID

          // Runtime events are already reflected by the host status cache.
          // Recompute badges without fetching the session, its transcript, or
          // permission/form caches for every step, tool, usage, and shell event.
          if (details.type === "session.status" || details.type === "session.idle"
            || details.type.startsWith("session.execution.")) {
            setLiveVersion((version) => version + 1)
            if (details.type === "session.idle") refreshContextForSession(sessionID)
            return
          }
          if (details.type === "session.usage.updated") {
            setSessions((loaded) => loaded.map((session) => session.id === sessionID
              ? { ...session, cost: details.data.cost, tokens: details.data.tokens }
              : session))
            return
          }
          if (details.type === "session.renamed") {
            setSessions((loaded) => loaded.map((session) => session.id === sessionID
              ? { ...session, title: details.data.title }
              : session))
            return
          }
          if (!SESSION_SUMMARY_REFRESH_EVENTS.has(details.type)) return
          if (details.type === "session.created") {
            deletedIDs.delete(sessionID)
            queriedSessions.delete(sessionID)
          }
          refreshFromEvent(sessionID)
        }),
        context.data.on("permission.asked", (event) => refreshLocationForSession(event.data.sessionID)),
        context.data.on("permission.replied", (event) => refreshLocationForSession(event.data.sessionID)),
        context.data.on("form.created", (event) => refreshLocationForSession(event.data.form.sessionID)),
        context.data.on("form.replied", (event) => refreshLocationForSession(event.data.sessionID)),
        context.data.on("form.cancelled", (event) => refreshLocationForSession(event.data.sessionID)),
        context.data.on("session.deleted", (event) => {
          // Server deletion removes the entire family. Reconcile loaded children
          // even if the stream delivers only the root's deletion event.
          const removed = new Set([event.data.sessionID, ...descendantIDs(liveSessions(), event.data.sessionID)])
          for (const id of removed) { deletedIDs.add(id); queriedSessions.delete(id) }
          if (!changingLifecycle() && removed.has(selectedValue())) setSelectedValue(NEW_SESSION_VALUE)
          setSessions((loaded) => loaded.filter((item) => !removed.has(item.id)))
          setAttentionChecks((current) => { const next = new Map(current); for (const id of removed) next.delete(id); return next })
          setAttentionErrors((current) => { const next = new Map(current); for (const id of removed) next.delete(id); return next })
        }),
      ]
      unsubscribe = () => { for (const stop of unsubscribes) stop() }
    }
    createEffect(() => {
      if (!attached()) return
      const timer = setInterval(() => setTick((value) => value + 1), 30_000)
      onCleanup(() => clearInterval(timer))
    })

    function attach(returnSessionID?: string) {
      if (disposed) throw new Error("Session controller is disposed")
      if (attachments++ === 0) {
        opening++
        openingTimes.clear()
        const route = context.ui.router.current()
        const id = returnSessionID ?? (route.type === "session" ? route.sessionID : undefined)
        batch(() => {
          setCurrentSessionID(id)
          setSelectedValue(id ?? NEW_SESSION_VALUE)
          setSearch("")
          setExpanded(new Set<string>())
          setTick((value) => value + 1)
          setAttached(true)
        })
        if (id && !liveSessions().some((session) => session.id === id)) void refreshSessionRow(id)
      }
      let detached = false
      return () => {
        if (detached || disposed) return
        detached = true
        if (--attachments === 0) {
          opening++
          setAttached(false)
        }
      }
    }

    // Start immediately, before a picker has ever been mounted.
    start()
    reads.start(operation({ operation: "Load session archives" }, () => archiveStore.list()).pipe(
      Effect.tap((items) => Effect.sync(() => setArchives(items))),
      Effect.ensuring(Effect.sync(() => setArchivesReady(true))),
    ), showFailure)
    void loadMore(true)
    refreshActiveSessions()
    createEffect(() => {
      const route = context.ui.router.current()
      const id = route.type === "session" ? route.sessionID : undefined
      setCurrentSessionID(id)
      if (id && !untrack(liveSessions).some((session) => session.id === id)) void refreshSessionRow(id)
    })

    return {
      state: {
        sessions, options, selectedValue, selectedIndex, selectedSession, selectedMessages, selectedStats,
        search, loading, ready, failure, attention, attentionErrors, changingLifecycle, rowPercents,
        visiblePreview, permission, inboxRequest, inboxOwner, inboxErrors, isInbox,
        previewLoading, previewError, replying, replyChoice, isArchived,
        isDeleted: (id: string) => deletedIDs.has(id),
      },
      commands: {
        select: (value: string) => { if (!disposed) setSelectedValue(value) },
        search: (value: string) => { if (!disposed) { setSearch(value); setSelectedValue(NEW_SESSION_VALUE) } },
        loadMore: () => loadMore(), refresh, changeLifecycle, replyToPermission, toggleChildren,
      },
      attach,
      dispose() {
        if (disposed) return
        disposed = true
        unsubscribe()
        disposeRoot()
        // Preserve the existing detached archive transaction policy on unload.
        reads.dispose()
        mutations.dispose()
      },
    }
  })
}
