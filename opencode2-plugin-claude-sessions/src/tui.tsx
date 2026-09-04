/** @jsxImportSource @opentui/solid */
import type { SessionInfo } from "@opencode-ai/client"
import { Plugin } from "@opencode-ai/plugin/tui"
import type { SelectOption, SelectRenderable } from "@opentui/core"
import { createMemo, createSignal, onMount } from "solid-js"

const PAGE_SIZE = 100
const LOAD_MORE_THRESHOLD = 10

type SessionState = "attention" | "running" | "idle"

interface SessionRow {
  session: SessionInfo
  state: SessionState
}

function stateRank(state: SessionState) {
  if (state === "attention") return 0
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
  const [sessions, setSessions] = createSignal<SessionInfo[]>([])
  const [attentionIDs, setAttentionIDs] = createSignal(new Set<string>())
  const [cursor, setCursor] = createSignal<string>()
  const [loading, setLoading] = createSignal(false)
  const [failure, setFailure] = createSignal<string>()
  let select: SelectRenderable | undefined

  const rows = createMemo(() => {
    const attention = attentionIDs()
    return sortRows(
      sessions().map((session) => ({
        session,
        state: attention.has(session.id)
          ? "attention"
          : props.context.data.session.status(session.id) === "running"
            ? "running"
            : "idle",
      })),
    )
  })

  const options = createMemo<SelectOption[]>(() =>
    rows().map(({ session, state }) => {
      const status = state === "attention" ? "Needs input" : state === "running" ? "Working" : "Ready"
      const marker = state === "attention" ? "?" : state === "running" ? "●" : "○"
      const location = props.context.ui.format.path(session.location.directory)
      const details = [status, relativeTime(session.time.updated), location]
      if (session.agent) details.push(session.agent)

      return {
        name: `${marker} ${session.title?.trim() || "Untitled session"}`,
        description: details.join(" · "),
        value: session.id,
      }
    }),
  )

  async function refreshAttention(loaded: SessionInfo[]) {
    const locations = new Map<string, SessionInfo["location"]>()
    for (const session of loaded) locations.set(locationKey(session), session.location)

    const lookups: Array<Promise<readonly { sessionID: string }[]>> = [...locations.values()].flatMap((location) => [
      props.context.client.permission.request.list({ location }).then((result) => result.data),
      props.context.client.form.request.list({ location }).then((result) => result.data),
    ])
    const requests = await Promise.allSettled(lookups)

    setAttentionIDs(
      new Set(
        requests
          .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
          .map((request) => request.sessionID),
      ),
    )
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
      const known = new Map((initial ? [] : sessions()).map((session) => [session.id, session]))
      for (const session of result.data) known.set(session.id, session)
      const loaded = [...known.values()]
      setSessions(loaded)
      setCursor(result.cursor.next ?? undefined)
      await refreshAttention(loaded)
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

  props.context.keymap.layer(() => ({
    target: () => select,
    priority: 200,
    commands: [
      {
        bind: "left",
        run: () => props.context.ui.dialog.clear(),
      },
    ],
  }))

  onMount(() => void loadMore(true))

  return (
    <box flexDirection="column" height={24}>
      <text fg={props.context.theme.text.default}>Sessions</text>
      <text fg={props.context.theme.text.subdued}>↑/↓ select · →/enter open · ←/esc close</text>
      {failure() ? (
        <text fg={props.context.theme.text.feedback.error.default}>{failure()}</text>
      ) : options().length === 0 && loading() ? (
        <text fg={props.context.theme.text.subdued}>Loading sessions…</text>
      ) : (
        <select
          ref={select}
          focused
          flexGrow={1}
          options={options()}
          showDescription
          showScrollIndicator
          wrapSelection={false}
          textColor={props.context.theme.text.default}
          descriptionColor={props.context.theme.text.subdued}
          selectedTextColor={props.context.theme.text.action.primary.focused}
          selectedDescriptionColor={props.context.theme.text.action.primary.focused}
          selectedBackgroundColor={props.context.theme.background.action.primary.default}
          keyBindings={[
            { name: "up", action: "move-up" },
            { name: "k", action: "move-up" },
            { name: "down", action: "move-down" },
            { name: "j", action: "move-down" },
            { name: "up", shift: true, action: "move-up-fast" },
            { name: "down", shift: true, action: "move-down-fast" },
            { name: "return", action: "select-current" },
            { name: "linefeed", action: "select-current" },
            { name: "right", action: "select-current" },
          ]}
          onChange={(index) => {
            if (index >= options().length - LOAD_MORE_THRESHOLD) void loadMore()
          }}
          onSelect={(_index, option) => {
            if (typeof option?.value === "string") open(option.value)
          }}
        />
      )}
      {loading() && options().length > 0 ? <text fg={props.context.theme.text.subdued}>Loading more…</text> : null}
    </box>
  )
}

function EmptyPromptBinding(props: { context: Plugin.Context }) {
  props.context.keymap.layer(() => ({
    priority: 100,
    commands: [
      {
        id: "claude-sessions.open",
        title: "Open sessions from an empty prompt",
        group: "Sessions",
        bind: "left",
        run: () => {
          const route = props.context.ui.router.current()
          if (route.type !== "home" && route.type !== "session") return false

          const editor = props.context.renderer.currentFocusedEditor
          if (!editor || editor.plainText !== "") return false

          props.context.ui.dialog.set({ size: "xlarge", centered: true })
          props.context.ui.dialog.show(() => <SessionPicker context={props.context} />)
        },
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
