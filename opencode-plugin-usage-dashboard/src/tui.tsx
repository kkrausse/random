/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui"
import { useTerminalDimensions } from "@opentui/solid"
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { accountLimits, loadCodexUsage, type CodexAccount } from "./codex"
import { chart } from "./chart"
import { estimateSpend, loadResponses, type Spend } from "./pricing"
import { bounds, compact, loadBuckets, metricValue, money, totalTokens, type Metric, type Range, type Stats } from "./usage"

const ranges: Range[] = ["24h", "today", "7d", "14d", "30d"]
const metrics: Metric[] = ["steps", "output", "cache", "cost"]
const rangeNames: Record<Range, string> = { "24h": "24 hours", today: "Today", "7d": "Week", "14d": "2 Weeks", "30d": "Month" }

function row(columns: readonly string[], widths: readonly number[]) {
  return columns.map((value, index) => {
    const width = widths[index]!
    const clipped = value.length > width ? `${value.slice(0, width - 1)}…` : value
    return index === 0 ? clipped.padEnd(width) : clipped.padStart(width)
  }).join("  ")
}

function Dashboard(props: { context: Plugin.Context; close: () => void }) {
  const theme = props.context.theme
  const text = theme.text.base
  const muted = theme.text.muted
  const accent = theme.text.accent
  const dimensions = useTerminalDimensions()
  const [range, setRange] = createSignal<Range>("24h")
  const [metric, setMetric] = createSignal<Metric>("steps")
  const [activeModel, setActiveModel] = createSignal<string>()
  const [currentProject, setCurrentProject] = createSignal(false)
  const [refresh, setRefresh] = createSignal(0)
  const [stats, setStats] = createSignal<Stats>()
  const [buckets, setBuckets] = createSignal<Stats[]>()
  const [statsError, setStatsError] = createSignal("")
  const [bucketError, setBucketError] = createSignal("")
  const [spend, setSpend] = createSignal<Spend>()
  const [spendError, setSpendError] = createSignal("")
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
    setSpendError("")
    setStats(undefined)
    setBuckets(undefined)
    setSpend(undefined)
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
      const bucketPromise = loadBuckets(props.context.client, period, project, controller.signal, timezone)
      void bucketPromise.then(setBuckets).catch((error: Error) => {
          if (!controller.signal.aborted) setBucketError(error.message)
      })
      void Promise.all([
        bucketPromise,
        props.context.client.model.list({ location: props.context.location ?? props.context.data.location.default() }, { signal: controller.signal }),
        loadResponses(props.context.client, period.from, period.to, project, controller.signal),
      ]).then(([bins, inventory, responses]) => {
        if (!controller.signal.aborted) setSpend(estimateSpend(responses, inventory.data, bins))
      }).catch((error: Error) => {
        if (!controller.signal.aborted) setSpendError(error.message)
      })
    })().catch((error: Error) => {
      if (!controller.signal.aborted) { setStatsError(error.message); setBucketError(error.message); setSpendError(error.message) }
    })
    onCleanup(() => controller.abort())
  })

  const chartValues = createMemo(() => {
    const points = buckets()
    if (!points) return
    const selected = activeModel()
    if (metric() === "cost") return selected ? spend()?.byBucketModel[selected] ?? points.map(() => 0) : spend()?.byBucket
    return points.map((point) => {
      if (!selected) return metricValue(point, metric())
      const model = point.models.find((item) => `${item.model.providerID}/${item.model.id}:${item.model.variant ?? "default"}` === selected)
      if (!model) return 0
      if (metric() === "steps") return model.steps
      return metric() === "output" ? model.tokens.output : model.tokens.cache.read
    })
  })
  const displayChart = createMemo(() => {
    const points = buckets()
    const values = chartValues()
    if (!points) return []
    if (!values) return []
    return chart(values, points.map((point) => point.range), dimensions().width - 6, metric() === "cost", range())
  })
  const toolUsage = createMemo(() => {
    const tools = stats()?.tools
    return tools?.mode === "detail" ? tools.usage : []
  })
  const modelWidths = createMemo(() => dimensions().width >= 105
    ? [34, 7, 12, 9, 9, 9, 10]
    : dimensions().width >= 85
      ? [Math.max(20, dimensions().width - 65), 7, 12, 9, 9, 10]
      : [Math.max(16, dimensions().width - 53), 7, 12, 9, 10])
  const modelColumns = createMemo(() => ["Model", "Steps", "Total tokens", ...(modelWidths().length === 7 ? ["Input"] : []), "Output", ...(modelWidths().length >= 6 ? ["Cache"] : []), "Spend ≈"])
  const modelRow = (name: string, steps: number, tokens: Stats["tokens"], cost: string) => row([
    name, compact(steps), compact(totalTokens(tokens)),
    ...(modelWidths().length === 7 ? [compact(tokens.input)] : []),
    compact(tokens.output),
    ...(modelWidths().length >= 6 ? [compact(tokens.cache.read)] : []),
    cost,
  ], modelWidths())
  const modelUsage = createMemo(() => [...(stats()?.models ?? [])].sort((a, b) => {
    const prices = spend()?.byModel
    const key = (model: typeof a) => `${model.model.providerID}/${model.model.id}:${model.model.variant ?? "default"}`
    return prices ? (prices[key(b)] ?? 0) - (prices[key(a)] ?? 0) : b.steps - a.steps
  }))
  const codexWidths = createMemo(() => dimensions().width >= 100 ? [18, 10, 16, 8, 20, 7] : [12, 8, 12, 7, 16, 7])
  const codexRows = createMemo(() => (accounts() ?? []).flatMap((account) => {
    const limits = accountLimits(account)
    const windows = limits.flatMap((limit) => [limit.primary, limit.secondary].filter((window) => window != null)
      .map((window) => ({ limit: limit.limitName ?? limit.id, window })))
    if (!windows.length) return [{ columns: [account.account.name, account.usage?.planType ?? account.identity?.plan ?? "–", "–", "–", account.error ?? "Unavailable", "–"], account }]
    return windows.map(({ limit, window }, index) => ({ account, columns: [
      index === 0 ? account.account.name : "",
      index === 0 ? account.usage?.planType ?? account.identity?.plan ?? "–" : "",
      `${limit} ${window.windowDurationMins ? `${compact(window.windowDurationMins / 60)}h` : ""}`,
      window.usedPercent == null ? "?" : `${Math.max(0, 100 - window.usedPercent)}%`,
      window.resetsAt ? (() => {
        const date = new Date(window.resetsAt * 1000)
        return `${date.toLocaleDateString([], { month: "short", day: "numeric" })} ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
      })() : "–",
      index === 0 ? String(account.usage?.rateLimitResetCredits?.availableCount ?? "–") : "",
    ] }))
  }))

  async function chooseRange() {
    const result = await props.context.ui.dialog.select({
      title: "Usage period", current: range(),
      options: ranges.map((value) => ({ title: rangeNames[value], value })),
    })
    if (result) setRange(result as Range)
  }

  async function chooseBucket() {
    const points = buckets()
    const values = chartValues()
    if (!points || !values) return
    const selected = await props.context.ui.dialog.select({
      title: `${metric().toUpperCase()} by period`,
      options: points.map((point, index) => ({
        title: `${new Date(point.range.from).toLocaleString()} — ${metric() === "cost" ? money(values[index]!) : compact(values[index]!)}`,
        value: String(index),
      })),
    })
    if (selected == null) return
    const point = points[Number(selected)]
    if (!point) return
    await props.context.ui.dialog.alert({
      title: new Date(point.range.from).toLocaleString(),
      message: `${point.steps} steps · ${compact(point.tokens.output)} output · ${compact(point.tokens.cache.read)} cache read${spend() ? ` · ${money(spend()!.byBucket[Number(selected)] ?? 0)} estimated spend` : ""}`,
    })
  }

  function showAccount(account: CodexAccount) {
    const limits = accountLimits(account)
    const windows = limits.flatMap((limit) => [limit.primary, limit.secondary].filter((window) => window != null)
      .map((window) => `${limit.limitName ?? limit.id}: ${window.usedPercent == null ? "usage unknown" : `${Math.max(0, 100 - window.usedPercent)}% left`}${window.resetsAt ? ` · resets ${new Date(window.resetsAt * 1000).toLocaleString()}` : ""}`))
    void props.context.ui.dialog.alert({
      title: account.account.name,
      message: [account.usage?.planType ?? account.identity?.plan ?? account.account.source, ...windows,
        `Reset credits: ${account.usage?.rateLimitResetCredits?.availableCount ?? "unknown"}`, account.error ?? ""].filter(Boolean).join("\n"),
    })
  }

  props.context.keymap.layer(() => ({
    commands: [
      { id: "usage-dashboard.close", bind: "escape", run: props.close },
      ...ranges.map((value, index) => ({
        id: `usage-dashboard.range-${value}`, bind: String(index + 1), run: () => setRange(value),
      })),
      { id: "usage-dashboard.metric", bind: "m", run: () => setMetric(metrics[(metrics.indexOf(metric()) + 1) % metrics.length]!) },
      { id: "usage-dashboard.period", bind: "t", run: chooseRange },
      { id: "usage-dashboard.project", bind: "p", run: () => setCurrentProject(!currentProject()) },
      { id: "usage-dashboard.refresh", bind: "r", run: () => { setRefresh((value) => value + 1); refreshCodex() } },
    ],
  }))

  const section = (title: string) => <text fg={accent}>{title}</text>

  return (
    <box flexDirection="column" flexGrow={1} minHeight={0} paddingLeft={2} paddingRight={2} paddingTop={1}>
      <box flexDirection="column" height={4} flexShrink={0}>
        <box flexDirection="row" gap={1}>
          <text fg={text}>Usage dashboard ·</text>
          <text fg={accent} onMouseDown={(event) => {
            if (event.button === 0) setCurrentProject(!currentProject())
          }}>{currentProject() ? "Current project ▾" : "All projects ▾"}</text>
        </box>
        <box flexDirection="row" gap={2}>
          <For each={ranges}>{(value, index) => <text fg={range() === value ? accent : muted} onMouseDown={(event) => {
            if (event.button === 0) setRange(value)
          }}>{range() === value ? `▸ ${rangeNames[value]}` : `${index() + 1} ${rangeNames[value]}`}</text>}</For>
        </box>
        <text fg={muted}>t choose period · m chart metric · p project · r refresh · Esc back</text>
        <text fg={accent}>{rangeNames[range()]} · {activeModel() ?? "All models"}</text>
      </box>
      <scrollbox focused flexGrow={1} minHeight={0} scrollY scrollX={false} contentOptions={{ flexDirection: "column" }} verticalScrollbarOptions={{ visible: false }}>
        <box flexDirection="column" paddingBottom={2}>
          <box flexDirection="column">
            <text fg={accent} onMouseDown={(event) => { if (event.button === 0) void chooseBucket() }}>
              ACTIVITY CHART{activeModel() ? ` · ${activeModel()}` : ""}   [click chart for periods]
            </text>
            <box flexDirection="row" gap={2}>
              <For each={metrics}>{(value) => <text fg={metric() === value ? accent : muted} onMouseDown={(event) => {
                if (event.button === 0) setMetric(value)
              }}>{metric() === value ? `▸ ${value.toUpperCase()}` : value.toUpperCase()}</text>}</For>
            </box>
            <Show when={activeModel()}><text fg={accent} onMouseDown={(event) => { if (event.button === 0) setActiveModel(undefined) }}>← All models (clear filter)</text></Show>
            <Show when={displayChart().length} fallback={<text fg={muted}>{bucketError() || spendError() || (metric() === "cost" && buckets() ? "Calculating priced responses…" : "Calculating timeline…")}</text>}>
              <For each={displayChart()}>{(line) => <text fg={accent} onMouseDown={(event) => { if (event.button === 0) void chooseBucket() }}>{line}</text>}</For>
            </Show>
          </box>

          <box paddingTop={1} flexDirection="column">
            {section("MODELS")}
            <text fg={muted}>{row(modelColumns(), modelWidths())}</text>
            <text fg={muted}>{"─".repeat(modelWidths().reduce((sum, width) => sum + width + 2, -2))}</text>
            <For each={modelUsage()}>
              {(model) => <text fg={activeModel() === `${model.model.providerID}/${model.model.id}:${model.model.variant ?? "default"}` ? accent : text} onMouseDown={(event) => {
                if (event.button !== 0) return
                const key = `${model.model.providerID}/${model.model.id}:${model.model.variant ?? "default"}`
                setActiveModel(activeModel() === key ? undefined : key)
              }}>{modelRow(
                  `${model.model.providerID}/${model.model.id}${model.model.variant && model.model.variant !== "default" ? `:${model.model.variant}` : ""}`,
                  model.steps, model.tokens,
                  spend() ? money(spend()!.byModel[`${model.model.providerID}/${model.model.id}:${model.model.variant ?? "default"}`] ?? 0) : "…",
                )}</text>}
            </For>
            <Show when={stats()} fallback={<text fg={muted}>{statsError() || "Loading model usage…"}</text>}>
              {(data) => <>
                <text fg={muted}>{"─".repeat(modelWidths().reduce((sum, width) => sum + width + 2, -2))}</text>
                <text fg={accent} onMouseDown={(event) => { if (event.button === 0) setActiveModel(undefined) }}>
                  {modelRow("TOTAL", data().steps, data().tokens, spend() ? money(spend()!.total) : spendError() || "…")}
                </text>
                <text fg={muted}>{data().sessions} sessions · {data().subagents} subagents · {data().prompts} prompts · recorded charge {money(data().cost)}</text>
              </>}
            </Show>
            <Show when={spend()}>{(value) => <text fg={muted}>{value().quoted} priced responses · {value().unpriced} unpriced · {value().zenEquivalent ? "Zen list-price equivalent" : "model list prices"}</text>}</Show>
            <text fg={muted}>Total tokens = input + output + reasoning + cache read + write</text>
          </box>

          <box paddingTop={1} flexDirection="column">
            {section("TOOLS")}
            <text fg={muted}>{row(["Tool", "Calls", "Failed", "P50"], [22, 9, 9, 10])}</text>
            <text fg={muted}>{"─".repeat(56)}</text>
            <For each={toolUsage()} fallback={<text fg={muted}>No tool calls in this period</text>}>
              {(tool) => <text fg={text} onMouseDown={(event) => {
                if (event.button === 0) void props.context.ui.dialog.alert({
                  title: tool.name,
                  message: `${tool.calls} calls · ${tool.succeeded} succeeded · ${tool.failed} failed · ${tool.unfinished} unfinished\nMedian duration: ${tool.durationP50 ?? "unknown"}ms`,
                })
              }}>{row([tool.name, compact(tool.calls), String(tool.failed), `${tool.durationP50 ?? "–"}ms`], [22, 9, 9, 10])}</text>}
            </For>
          </box>

          <box paddingTop={1} flexDirection="column">
            {section("CODEX ACCOUNT ALLOWANCES · local")}
            <Show when={accounts()} fallback={<text fg={muted}>{codexError() || "Checking accounts…"}</text>}>
              <text fg={muted}>{row(["Account", "Plan", "Limit", "Left", "Resets", "Credits"], codexWidths())}</text>
              <text fg={muted}>{"─".repeat(codexWidths().reduce((sum, width) => sum + width + 2, -2))}</text>
              <For each={codexRows()} fallback={<text fg={muted}>No accounts configured</text>}>
                {(entry) => <text fg={text} onMouseDown={(event) => { if (event.button === 0) showAccount(entry.account) }}>{row(entry.columns, codexWidths())}</text>}
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
