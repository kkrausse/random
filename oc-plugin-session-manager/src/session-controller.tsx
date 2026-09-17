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

export type SessionController = ReturnType<typeof createSessionController>

// An explicit root belongs to the plugin, never to the dialog that first opens it.
// Reads start on attachment; selection effects pause while no view is attached.
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
    let reads = createRunner()
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
    // Metadata/status changes within the same locations need not rediscover the
    // inbox. Newly loaded or active locations do, without another history query.
    const inboxLocations = createMemo(() => [...new Set(liveSessions().map(locationKey))].sort().join("\0"))
    const archived = (id: string) => archives().find((item) => item.transcript.info.id === id)
    const isArchived = (id: string) => !!archived(id) && !liveSessions().some((session) => session.id === id)
    const sessions = createMemo(() => {
      const merged = new Map(archives().map((item) => [item.transcript.info.id, item.transcript.info]))
      for (const session of liveSessions()) merged.set(session.id, session)
      return [...merged.values()]
    })
    const requestsAPI = attentionAPI(context)
    const [liveVersion, setLiveVersion] = createSignal(0)
    const [attentionChecks, setAttentionChecks] = createSignal(new Map<string, "checking" | "ready" | "unavailable">())
    const [attentionErrors, setAttentionErrors] = createSignal(new Map<string, string>())
    const attentionSnapshots = createMemo(() => {
      liveVersion()
      return new Map<string, { state: Attention | undefined; running: boolean }>(liveSessions().map((session) => {
        const check = attentionChecks().get(session.id) ?? "checking"
        if (check !== "ready") return [session.id, { state: check as Attention, running: false }]
        try {
          const current = requestsAPI.read(session)
          return [session.id, { state: current.permissions.length ? "permission" as const : current.forms.length ? "question" as const
            : attentionErrors().has(`location:${locationKey(session)}`) ? "unavailable" as const : undefined, running: current.running }]
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
    const [search, setSearch] = createSignal("")
    const [tick, setTick] = createSignal(0)
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
          return {
            session, ownRunning, runningChildren, inactiveByAge,
            state: isArchived(session.id) ? "inactive" as const : sessionState(effective.get(session.id) ?? attention().get(session.id),
              ownRunning || runningChildren > 0, override ?? inactiveByAge),
          }
        }),
      ), openingTimes))
    })
    const options = createMemo(() => [
      { title: "New session", description: "Start with a blank prompt", value: NEW_SESSION_VALUE, state: "new" as const, depth: 0 },
      ...rows().filter(({ session }) => !search() || `${session.title ?? "Untitled session"} ${session.location.directory}`.toLowerCase().includes(search().toLowerCase())).map(({ session, state, runningChildren, depth, inactiveByAge }) => {
        const baseStatus = {
          permission: "Permission required", question: "Question waiting", unavailable: "Status unavailable", checking: "Checking status…",
          inactive: inactiveByAge && !isArchived(session.id) ? "Inactive · 7d+" : "Archived", idle: "Ready",
        }[state as Attention | "inactive" | "idle"]
        const childStatus = `${runningChildren} sub-agent${runningChildren === 1 ? "" : "s"} running`
        const status = runningChildren > 0
          ? state === "running" ? childStatus : `${baseStatus} · ${childStatus}`
          : state === "running" ? undefined : baseStatus
        const location = shortenLocation(context.ui.format.path(session.location.directory))
        const details = [relativeTime(session.time.updated), location]
        if (session.agent) details.push(session.agent)
        return {
          title: session.title?.trim() || "Untitled session", description: details.join(" · "), status, state, inactiveByAge,
          value: session.id, depth, updated: relativeTime(session.time.updated),
        }
      }),
    ])
    const selectedIndex = createMemo(() => options().findIndex((option) => option.value === selectedValue()))
    const selectedSession = createMemo(() => sessions().find((session) => session.id === selectedValue()))
    const [contextSyncing, setContextSyncing] = createSignal(false)
    const [contextVersion, setContextVersion] = createSignal(0)
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
    const selectedStats = createMemo(() => contextStats(selectedSession(), selectedUsage(), selectedCost(), contextSyncing()))
    const [rowPercents, setRowPercents] = createSignal(new Map<string, string>())
    const rowFetching = new Set<string>()
    const isInbox = () => selectedValue() === NEW_SESSION_VALUE
    const visiblePreview = createMemo(() => preview()?.sessionID === selectedValue() ? preview() : undefined)
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
      if (!attached()) return
      const loaded = sessions()
      const targets = rows()
        .filter(({ state, session }) => session.id === selectedValue() || state === "running" || state === "permission" || state === "question")
        .map(({ session }) => session)
        .filter((session) => !isArchived(session.id) && !rowPercents().has(session.id) && !rowFetching.has(session.id))
        .slice(0, 8)
      for (const session of targets) {
        const generation = opening
        rowFetching.add(session.id)
        reads.start(Effect.all([
          operation({ operation: "Sync row context messages", sessionID: session.id }, () => context.data.session.message.sync(session.id)),
          operation({ operation: "Sync row models", directory: session.location.directory }, () => context.data.location.model.sync(session.location)),
        ], { concurrency: "unbounded" }).pipe(
          Effect.tap(() => Effect.sync(() => {
            if (disposed || generation !== opening) return
            const fresh = loaded.find((item) => item.id === session.id) ?? session
            const messages = context.data.session.message.list(session.id)
            const models = context.data.location.model.list(fresh.location)
            const usage = contextUsage(messages, models, fresh.revert?.messageID)
            if (usage?.percent !== undefined) setRowPercents((current) => new Map(current).set(session.id, `${usage.percent}%`))
          })),
          Effect.ensuring(Effect.sync(() => { if (generation === opening) rowFetching.delete(session.id) })),
        ))
      }
    })
    createEffect(() => {
      if (!attached()) return
      const session = selectedSession()
      contextVersion()
      let cancelled = false
      onCleanup(() => { cancelled = true })
      if (!session || isArchived(session.id)) { setContextSyncing(false); return }
      setContextSyncing(true)
      const job = reads.start(Effect.all([
        operation({ operation: "Sync context messages", sessionID: session.id }, () => context.data.session.message.sync(session.id)),
        operation({ operation: "Sync models", directory: session.location.directory }, () => context.data.location.model.sync(session.location)),
      ], { concurrency: "unbounded" }).pipe(
        Effect.ensuring(Effect.sync(() => { if (!cancelled) setContextSyncing(false) })),
      ))
      onCleanup(job.cancel)
    })
    createEffect(() => {
      if (!attached()) return
      const sessionID = isInbox() ? NEW_SESSION_VALUE : selectedSession()?.id
      reviewVersion()
      let cancelled = false
      onCleanup(() => { cancelled = true })
      setPreview((current) => current?.sessionID === sessionID ? current : undefined)
      setPreviewError(undefined)
      setPreviewLoading(!!sessionID && !isArchived(sessionID))
      if (!sessionID || isArchived(sessionID)) return
      if (sessionID === NEW_SESSION_VALUE) {
        inboxLocations()
        const job = reads.start(loadInbox(context.client, untrack(liveSessions)).pipe(Effect.tap((inbox) => Effect.sync(() => {
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
      const related = [sessionID, ...descendantIDs(sessions(), sessionID)]
      const job = reads.start(Effect.gen(function* () {
        const lookups = yield* Effect.all(related.map((id) => operation({ operation: "Sync preview requests", sessionID: id }, async () => {
          const session = sessions().find((item) => item.id === id)!
          await requestsAPI.sync(session)
          return requestsAPI.read(session)
        })), { concurrency: 4 })
        const permissions = lookups.flatMap((requests) => requests.permissions)
        const forms = lookups.flatMap((requests) => requests.forms)
        if (!cancelled) setPreview({ sessionID, permissions, forms })
      }).pipe(Effect.ensuring(Effect.sync(() => { if (!cancelled) setPreviewLoading(false) }))),
      (message) => { if (!cancelled) setPreviewError(message) })
      onCleanup(job.cancel)
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
      if (!attached() || disposed) return
      reads.start(Effect.gen(function* () {
        const requests = yield* operation({ operation: "Discover attention owners", directory: location.directory },
          (signal) => requestsAPI.discover(location, signal))
        for (const id of new Set([...requests.permissions, ...requests.forms].map((request) => request.sessionID))) {
          if (!liveSessions().some((session) => session.id === id)) void refreshSessionRow(id)
        }
        setAttentionErrors((current) => { const next = new Map(current); next.delete(`location:${key}`); return next })
      }), (message) => {
        queriedLocations.delete(key)
        setAttentionErrors((current) => new Map(current).set(`location:${key}`, message))
      })
    }
    function refreshAttention(loaded: SessionInfo[], force = false) {
      if (!attached() || disposed) return
      const targets = loaded.filter((session) => !isArchived(session.id) && (force || !queriedSessions.has(session.id)))
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
      if (targets.length) reads.start(Effect.all(targets.map((session) => operation({ operation: "Refresh attention status", sessionID: session.id },
        () => requestsAPI.sync(session)).pipe(
        Effect.map(() => ({ id: session.id, error: undefined as string | undefined })),
        Effect.catch((error) => Effect.sync(() => {
          console.error(`[claude.sessions] ${error.message}`, error)
          if (attentionRequests.get(session.id) === versions.get(session.id)) queriedSessions.delete(session.id)
          return { id: session.id, error: error.message }
        })),
      )), { concurrency: 4 }).pipe(Effect.tap((results) => Effect.sync(() => batch(() => {
        // Publish one status snapshot rather than rebuild every row for every
        // request completion during startup. A newer targeted refresh wins.
        const fresh = results.filter((result) => attentionRequests.get(result.id) === versions.get(result.id))
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
      })))))
      const locations = new Map<string, SessionInfo["location"]>()
      for (const session of loaded) if (!isArchived(session.id)) locations.set(locationKey(session), session.location)
      for (const [key, location] of locations) {
        if (!force && queriedLocations.has(key)) continue
        queriedLocations.add(key)
        applyAttentionLookup(location, key)
      }
    }
    function refreshLocationForSession(sessionID: string) {
      if (!attached() || disposed) return
      const session = sessions().find((item) => item.id === sessionID)
      if (!session) { void refreshSessionRow(sessionID); return }
      refreshAttention([session], true)
    }
    function refreshSessionRow(sessionID: string) {
      if (!attached() || disposed) return
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
        refreshAttention(liveSessions())
      })).done
    }
    function refreshActiveSessions() {
      if (!attached() || disposed) return
      reads.start(Effect.gen(function* () {
        const active = yield* operation({ operation: "Load active sessions" }, (signal) => context.client.session.active({ signal }))
        for (const id of Object.keys(active)) void refreshSessionRow(id)
      }))
    }
    function refreshContextForSession(sessionID: string) {
      if (!attached() || disposed) return
      if (selectedSession()?.id !== sessionID) return
      context.data.session.message.invalidate(sessionID)
      setContextVersion((version) => version + 1)
    }
    function loadMore(initial = false) {
      if (disposed || !attached() || loading() || (!initial && !cursor())) return
      const generation = opening
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
      }).pipe(Effect.ensuring(Effect.sync(() => { if (generation === opening) setLoading(false) }))), setFailure).done
    }
    function refresh() {
      if (disposed || !attached()) return
      refreshAttention(liveSessions(), true)
      setReviewVersion((version) => version + 1)
    }

    let unsubscribe = () => {}
    function start() {
      if (started) return
      started = true
      const unsubscribes = [
        context.data.on("server.connected", () => {
          refreshActiveSessions()
          refreshAttention(sessions(), true)
          setReviewVersion((version) => version + 1)
        }),
        context.data.listen(({ details }) => {
          if (["permission.asked", "permission.replied", "form.created", "form.replied", "form.cancelled"].includes(details.type)) {
            setReviewVersion((version) => version + 1)
          }
        }),
        context.data.on("permission.asked", (event) => refreshLocationForSession(event.data.sessionID)),
        context.data.on("permission.replied", (event) => refreshLocationForSession(event.data.sessionID)),
        context.data.on("form.created", (event) => refreshLocationForSession(event.data.form.sessionID)),
        context.data.on("form.replied", (event) => refreshLocationForSession(event.data.sessionID)),
        context.data.on("form.cancelled", (event) => refreshLocationForSession(event.data.sessionID)),
        context.data.on("session.status", (event) => {
          void refreshSessionRow(event.data.sessionID)
          refreshContextForSession(event.data.sessionID)
        }),
        context.data.on("session.idle", (event) => {
          void refreshSessionRow(event.data.sessionID)
          refreshContextForSession(event.data.sessionID)
        }),
        context.data.on("session.created", (event) => {
          deletedIDs.delete(event.data.sessionID)
          void refreshSessionRow(event.data.sessionID)
        }),
        context.data.on("session.renamed", (event) => {
          const title = event.data.title
          setSessions((loaded) => loaded.map((item) => item.id === event.data.sessionID ? { ...item, title } : item))
        }),
        context.data.on("session.deleted", (event) => {
          deletedIDs.add(event.data.sessionID)
          if (!changingLifecycle() && selectedValue() === event.data.sessionID) setSelectedValue(NEW_SESSION_VALUE)
          setSessions((loaded) => loaded.filter((item) => item.id !== event.data.sessionID))
          queriedSessions.delete(event.data.sessionID)
          setAttentionChecks((current) => { const next = new Map(current); next.delete(event.data.sessionID); return next })
          setAttentionErrors((current) => { const next = new Map(current); next.delete(event.data.sessionID); return next })
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
        queriedSessions.clear()
        attentionRequests.clear()
        queriedLocations.clear()
        rowFetching.clear()
        const route = context.ui.router.current()
        const id = returnSessionID ?? (route.type === "session" ? route.sessionID : undefined)
        const current = id ? context.data.session.get(id) : undefined
        batch(() => {
          setCurrentSessionID(id)
          setSelectedValue(id ?? NEW_SESSION_VALUE)
          setSearch("")
          // Only in-progress mutation owners survive the previous working set.
          const pending = liveSessions().filter((session) => changingLifecycle()?.has(session.id) && session.id !== current?.id)
          setSessions(current ? [current, ...pending] : pending)
          setAttentionChecks(new Map())
          setAttentionErrors(new Map())
          setRowPercents(new Map())
          setCursor(undefined)
          setLoading(false)
          setFailure(undefined)
          setPreview(undefined)
          setInboxErrors([])
          setAttached(true)
        })
        start()
        reads.start(operation({ operation: "Load session archives" }, () => archiveStore.list()).pipe(
          Effect.map((items) => { setArchives(items); setArchivesReady(true) }),
        ), showFailure)
        if (id && !current) {
          reads.start(Effect.gen(function* () {
            const session = yield* operation({ operation: "Load current session", sessionID: id },
              (signal) => context.client.session.get({ sessionID: id }, { signal }))
            setSessions((loaded) => [session, ...loaded.filter((item) => item.id !== session.id)])
          }))
        }
        void loadMore(true)
        refreshActiveSessions()
      }
      let detached = false
      return () => {
        if (detached || disposed) return
        detached = true
        if (--attachments === 0) {
          opening++
          setAttached(false)
          reads.dispose()
          reads = createRunner()
        }
      }
    }

    return {
      state: {
        sessions, options, selectedValue, selectedIndex, selectedSession, selectedMessages, selectedStats,
        search, loading, failure, attention, attentionErrors, changingLifecycle, rowPercents,
        visiblePreview, permission, inboxRequest, inboxOwner, inboxErrors, isInbox,
        previewLoading, previewError, replying, replyChoice, isArchived,
        isDeleted: (id: string) => deletedIDs.has(id),
      },
      commands: {
        select: (value: string) => { if (!disposed) setSelectedValue(value) },
        search: (value: string) => { if (!disposed) { setSearch(value); setSelectedValue(NEW_SESSION_VALUE) } },
        loadMore: () => loadMore(), refresh, changeLifecycle, replyToPermission,
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
