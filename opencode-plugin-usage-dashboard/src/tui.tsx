/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui"
import { useTerminalDimensions } from "@opentui/solid"
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { accountLimits, loadCodexUsage, type CodexAccount } from "./codex"
import { bounds, compact, loadBuckets, metricValue, money, type Metric, type Range, type Stats } from "./usage"

const ranges: Range[] = ["24h", "today", "7d", "30d"]
const metrics: Metric[] = ["steps", "output", "cache", "cost"]

function Dashboard(props: { context: Plugin.Context; close: () => void }) {
  const theme = props.context.theme
  const text = theme.text.base
  const muted = theme.text.muted
  const accent = theme.text.accent
  const dimensions = useTerminalDimensions()
  const [range, setRange] = createSignal<Range>("24h")
  const [metric, setMetric] = createSignal<Metric>("steps")
  const [currentProject, setCurrentProject] = createSignal(false)
  const [refresh, setRefresh] = createSignal(0)
  const [stats, setStats] = createSignal<Stats>()
  const [buckets, setBuckets] = createSignal<Stats[]>()
  const [statsError, setStatsError] = createSignal("")
  const [bucketError, setBucketError] = createSignal("")
  const [accounts, setAccounts] = createSignal<CodexAccount[]>()
  const [codexError, setCodexError] = createSignal("")
  const [codexLoading, setCodexLoading] = createSignal(false)

  function refreshCodex() {
    setCodexLoading(true)
    setCodexError("")
    void loadCodexUsage().then(setAccounts).catch((error: Error) => setCodexError(error.message))
      .finally(() => setCodexLoading(false))
  }

  refreshCodex()
  createEffect(() => {
    const selected = range()
    const scoped = currentProject()
    refresh()
    const controller = new AbortController()
    const period = bounds(selected, Date.now())
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
    setStatsError("")
    setBucketError("")
    setStats(undefined)
    setBuckets(undefined)
    void (async () => {
      const project = scoped
        ? (await props.context.client.location.get({ location: props.context.location ?? props.context.data.location.default() }, { signal: controller.signal })).project.id
        : undefined
      if (controller.signal.aborted) return
      void props.context.client.session.stats({
        from: period.from, to: period.to, project, timezone, tools: "detail",
      }, { signal: controller.signal }).then(setStats).catch((error: Error) => {
        if (!controller.signal.aborted) setStatsError(error.message)
      })
      void loadBuckets(props.context.client, period, project, controller.signal, timezone)
        .then(setBuckets).catch((error: Error) => {
          if (!controller.signal.aborted) setBucketError(error.message)
        })
    })().catch((error: Error) => {
      if (!controller.signal.aborted) { setStatsError(error.message); setBucketError(error.message) }
    })
    onCleanup(() => controller.abort())
  })

  const displayBars = createMemo(() => {
    const points = buckets()
    if (!points) return []
    const values = points.map((point) => metricValue(point, metric()))
    const max = Math.max(1, ...values)
    const width = Math.max(5, Math.min(34, dimensions().width - 38))
    return values.map((value, index) => {
      const date = new Date(points[index]!.range.from)
      const label = range() === "24h" || range() === "today"
        ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
        : date.toLocaleDateString([], { month: "short", day: "numeric" })
      const length = value ? Math.max(1, Math.round(value / max * width)) : 0
      return { label, bar: "█".repeat(length), value: metric() === "cost" ? money(value) : compact(value) }
    })
  })
  const toolUsage = createMemo(() => {
    const tools = stats()?.tools
    return tools?.mode === "detail" ? tools.usage : []
  })

  props.context.keymap.layer(() => ({
    commands: [
      { id: "usage-dashboard.close", bind: "escape", run: props.close },
      ...ranges.map((value, index) => ({
        id: `usage-dashboard.range-${value}`, bind: String(index + 1), run: () => setRange(value),
      })),
      { id: "usage-dashboard.metric", bind: "m", run: () => setMetric(metrics[(metrics.indexOf(metric()) + 1) % metrics.length]!) },
      { id: "usage-dashboard.project", bind: "p", run: () => setCurrentProject(!currentProject()) },
      { id: "usage-dashboard.refresh", bind: "r", run: () => { setRefresh((value) => value + 1); refreshCodex() } },
    ],
  }))

  const section = (title: string) => <text fg={accent}>{title}</text>
  const line = (label: string, value: string) => (
    <box flexDirection="row" justifyContent="space-between">
      <text fg={muted}>{label}</text><text fg={text}>{value}</text>
    </box>
  )

  return (
    <box flexDirection="column" flexGrow={1} minHeight={0} paddingLeft={2} paddingRight={2} paddingTop={1}>
      <box flexDirection="column" height={3} flexShrink={0}>
        <text fg={text}>Usage dashboard</text>
        <text fg={muted}>1 24h · 2 today · 3 7d · 4 30d · m metric · p project · r refresh · Esc back</text>
        <text fg={accent}>{range()}  ·  {currentProject() ? "Current project" : "All projects"}</text>
      </box>
      <scrollbox focused flexGrow={1} minHeight={0} scrollY scrollX={false} contentOptions={{ flexDirection: "column" }} verticalScrollbarOptions={{ visible: false }}>
        <box flexDirection="column" paddingBottom={2}>
          {section("OPENCODE ACTIVITY")}
          <Show when={stats()} fallback={<text fg={muted}>{statsError() || "Loading OpenCode usage…"}</text>}>
            {(data) => (
              <box flexDirection="column">
                {line("Model steps / prompts", `${compact(data().steps)} / ${compact(data().prompts)}`)}
                {line("Sessions / subagents", `${data().sessions} / ${data().subagents}`)}
                {line("Fresh input / output", `${compact(data().tokens.input)} / ${compact(data().tokens.output)}`)}
                {line("Cache read / write", `${compact(data().tokens.cache.read)} / ${compact(data().tokens.cache.write)}`)}
                {line("Recorded cost", money(data().cost))}
              </box>
            )}
          </Show>

          <box paddingTop={1} flexDirection="column">
            {section(`TREND · ${metric().toUpperCase()}`)}
            <Show when={buckets()} fallback={<text fg={muted}>{bucketError() || "Calculating timeline…"}</text>}>
              <For each={displayBars()}>{(item) => (
                <box flexDirection="row" gap={1}>
                  <text fg={muted} width={12}>{item.label}</text>
                  <text fg={accent}>{item.bar}</text>
                  <text fg={text}> {item.value}</text>
                </box>
              )}</For>
            </Show>
          </box>

          <box paddingTop={1} flexDirection="column">
            {section("MODELS · steps / output / cache read / recorded cost")}
            <For each={stats()?.models ?? []} fallback={<text fg={muted}>No model usage in this period</text>}>
              {(model) => (
                <box flexDirection="column">
                  <text fg={text}>{model.model.providerID}/{model.model.id}{model.model.variant ? ` · ${model.model.variant}` : ""}</text>
                  <text fg={muted}>  {compact(model.steps)} steps · {compact(model.tokens.output)} out · {compact(model.tokens.cache.read)} cached · {money(model.cost)}</text>
                </box>
              )}
            </For>
          </box>

          <box paddingTop={1} flexDirection="column">
            {section("TOOLS · calls / failures")}
            <For each={toolUsage()} fallback={<text fg={muted}>No tool calls in this period</text>}>
              {(tool) => line(tool.name, `${compact(tool.calls)} / ${tool.failed}`)}
            </For>
          </box>

          <box paddingTop={1} flexDirection="column">
            {section("CODEX ACCOUNT ALLOWANCES · local")}
            <Show when={accounts()} fallback={<text fg={muted}>{codexError() || "Checking accounts…"}</text>}>
              <For each={accounts()} fallback={<text fg={muted}>No accounts configured</text>}>
                {(account) => (
                  <box flexDirection="column" paddingTop={1}>
                    <text fg={text}>{account.account.name} · {account.usage?.planType ?? account.identity?.plan ?? account.account.source}</text>
                    <Show when={account.error}>
                      <text fg={muted}>Unavailable: {account.error}</text>
                    </Show>
                    <For each={accountLimits(account)}>
                      {(limit) => (
                        <box flexDirection="column">
                          <text fg={muted}>{limit.limitName ?? limit.id}</text>
                          <For each={[limit.primary, limit.secondary].filter((window) => window != null)}>
                            {(window) => <text fg={text}>  {window.windowDurationMins ? `${compact(window.windowDurationMins / 60)}h` : "Window"}: {window.usedPercent == null ? "usage unknown" : `${Math.max(0, 100 - window.usedPercent)}% left`}{window.resetsAt ? ` · resets ${new Date(window.resetsAt * 1000).toLocaleString()}` : ""}</text>}
                          </For>
                        </box>
                      )}
                    </For>
                    <Show when={account.usage?.rateLimitResetCredits?.availableCount != null}>
                      <text fg={muted}>Reset credits: {account.usage?.rateLimitResetCredits?.availableCount}</text>
                    </Show>
                  </box>
                )}
              </For>
            </Show>
            <Show when={codexLoading() && accounts()}><text fg={muted}>Refreshing accounts…</text></Show>
            <Show when={codexError() && accounts()}><text fg={muted}>{codexError()}</text></Show>
          </box>
        </box>
      </scrollbox>
    </box>
  )
}

function Commands(props: { context: Plugin.Context; open: () => void }) {
  props.context.keymap.layer(() => ({
    mode: "global",
    commands: [{
      id: "usage-dashboard.open",
      title: "Open usage dashboard",
      group: "Usage",
      palette: true,
      slash: { name: "usage" },
      run: props.open,
    }],
  }))
  return null
}

export default Plugin.define({
  id: "usage-dashboard",
  setup(context) {
    let previousSession: string | undefined
    const commands = context.ui.slot({
      append: "app",
      render: () => <Commands context={context} open={() => {
        const current = context.ui.router.current()
        previousSession = current.type === "session" ? current.sessionID : undefined
        context.ui.router.navigate({ type: "plugin", name: "usage-dashboard" })
      }} />,
    })
    const route = context.ui.router.register({
      name: "usage-dashboard",
      render: () => <Dashboard context={context} close={() => context.ui.router.navigate(
        previousSession ? { type: "session", sessionID: previousSession } : { type: "home" },
      )} />,
    })
    return () => { commands(); route() }
  },
})
