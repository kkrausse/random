/** @jsxImportSource @opentui/solid */
import type { SessionInfo } from "@opencode-ai/client"
import { Plugin } from "@opencode-ai/plugin/tui"
import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { For, createEffect, createMemo, createSignal, onMount } from "solid-js"

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
  const queriedLocations = new Set<string>()
  let scroll: ScrollBoxRenderable | undefined

  const rows = createMemo(() => {
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
      const location = props.context.ui.format.path(session.location.directory)
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

  function refreshAttention(loaded: SessionInfo[]) {
    const locations = new Map<string, SessionInfo["location"]>()
    for (const session of loaded) locations.set(locationKey(session), session.location)

    for (const [key, location] of locations) {
      if (queriedLocations.has(key)) continue
      queriedLocations.add(key)

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
          for (const result of found) for (const id of result.ids) next.set(id, result.kind)
          return next
        })
      })
    }
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
    ],
  }))

  let selectedValue = currentSessionID ?? NEW_SESSION_VALUE
  createEffect(() => {
    const available = options()
    const index = available.findIndex((option) => option.value === selectedValue)
    if (index < 0) return
    setSelectedIndex(index)
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
  })

  return (
    <box
      flexDirection="column"
      height={30}
      backgroundColor={props.context.theme.contextual.overlay.background.default}
    >
      <box height={3} flexShrink={0} flexDirection="column" paddingLeft={2} paddingRight={2}>
        <text fg={props.context.theme.text.default} attributes={TextAttributes.BOLD}>
          Sessions
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
              const titleColor = () =>
                active()
                  ? props.context.theme.text.action.primary.focused
                  : props.context.theme.text.default
              const iconColor = () => {
                if (option.state === "permission") return props.context.theme.text.status.permission
                if (option.state === "question") return props.context.theme.text.status.question
                if (option.state === "running") return props.context.theme.text.status.running
                return titleColor()
              }
              return (
                <box
                  id={`claude-session-${index()}`}
                  height={3}
                  flexShrink={0}
                  flexDirection="column"
                  paddingLeft={2}
                  paddingRight={2}
                  backgroundColor={
                    active()
                      ? props.context.theme.background.action.primary.default
                      : props.context.theme.contextual.overlay.background.default
                  }
                  onMouseDown={() => {
                    selectedValue = option.value
                    setSelectedIndex(index())
                  }}
                >
                  <box height={1} flexDirection="row">
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
                  <box height={1} flexDirection="row" paddingLeft={3}>
                    {"status" in option ? (
                      <>
                        <text fg={iconColor()}>{option.status}</text>
                        <text fg={active() ? titleColor() : props.context.theme.text.subdued}>
                          {`  ·  ${option.description}`}
                        </text>
                      </>
                    ) : (
                      <text fg={active() ? titleColor() : props.context.theme.text.subdued}>{option.description}</text>
                    )}
                  </box>
                </box>
              )
            }}
          </For>
        </scrollbox>
      )}
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
