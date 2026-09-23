/** @jsxImportSource @opentui/solid */
import type { ModelCost, ModelInfo, SessionInfo, SessionMessageInfo, TokenUsageInfo } from "@opencode/client"
import { Plugin } from "@opencode/plugin/tui"
import { TextAttributes, type ScrollBoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { Index, Show, createEffect, createMemo, onCleanup } from "solid-js"
import { groupLabel } from "./session-groups"
import type { ArchiveStore } from "./archive"
import { createSessionController, NEW_SESSION_VALUE, type SessionController } from "./session-controller"
import { contextUsage, formatCompactTokens, formatCost, shortenLocation } from "./session-display"
import { sessionManagerPalette } from "./palette"

const LOAD_MORE_THRESHOLD = 10

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

export function sessionTokenBreakdown(session: Pick<SessionInfo, "tokens">, compact = false) {
  const tokens = session.tokens
  const labels = compact
    ? ["In", "CR", "CW", "Out", "Think"]
    : ["Input", "Cache read", "Cache write", "Output", "Reasoning"]
  const values = [tokens.input, tokens.cache.read, tokens.cache.write, tokens.output, tokens.reasoning]
  return labels.map((label, index) => `${label} ${formatCompactTokens(values[index]!)}`).join(" · ")
}

export function processedTokens(sessions: ReadonlyArray<Pick<SessionInfo, "tokens">>) {
  return sessions.reduce((total, session) => total
    + session.tokens.input + session.tokens.output + session.tokens.reasoning
    + session.tokens.cache.read + session.tokens.cache.write, 0)
}

type UsageRates = Pick<ModelCost, "input" | "output" | "cache"> & { tier?: ModelCost["tier"] }

const defaultUsageRates: Record<string, UsageRates[]> = {}

function usageRates(options: Record<string, unknown>) {
  const configured = options.usageRates
  if (!configured || typeof configured !== "object" || Array.isArray(configured)) return defaultUsageRates
  return { ...defaultUsageRates, ...(configured as Record<string, UsageRates[]>) }
}

function rateFor(rates: UsageRates[], tokens: TokenUsageInfo) {
  const context = tokens.input + tokens.cache.read + tokens.cache.write
  return rates
    .filter((rate) => !rate.tier || context > rate.tier.size)
    .sort((a, b) => (b.tier?.size ?? 0) - (a.tier?.size ?? 0))[0]
}

export function estimateUsageCost(
  messages: ReadonlyArray<SessionMessageInfo>,
  models: ReadonlyArray<ModelInfo>,
  fallback: Record<string, UsageRates[]> = defaultUsageRates,
) {
  let cost = 0
  let estimated = false
  let zenEquivalent = false
  let otherEstimate = false
  let unpriced = 0
  for (const message of messages) {
    if (message.type !== "assistant" || !message.tokens) continue
    if ((message.cost ?? 0) > 0) {
      cost += message.cost!
      continue
    }
    const key = `${message.model.providerID}/${message.model.id}`
    const model = models.find((candidate) => candidate.providerID === message.model.providerID && candidate.id === message.model.id)
    // Fast variants share the underlying modelID: quote the standard Zen
    // equivalent, without guessing a priority surcharge or stripping names.
    const zen = models.find((candidate) => candidate.providerID === "opencode"
      && candidate.id === (model?.modelID ?? message.model.id) && candidate.cost.length > 0)
    const rates = model?.cost.length ? model.cost : zen?.cost ?? fallback[key]
    const rate = rates && rateFor(rates, message.tokens)
    if (!rate) {
      unpriced++
      continue
    }
    estimated = true
    if (rates === zen?.cost || (model?.providerID === "opencode" && rates === model.cost)) zenEquivalent = true
    else otherEstimate = true
    cost += (
      message.tokens.input * rate.input
      + (message.tokens.output + message.tokens.reasoning) * rate.output
      + message.tokens.cache.read * rate.cache.read
      + message.tokens.cache.write * rate.cache.write
    ) / 1_000_000
  }
  return { cost, estimated, unpriced, zenEquivalent: zenEquivalent && !otherEstimate }
}

function UsageBreakdown(props: { context: Plugin.Context; sessionID: string }) {
  const colors = sessionManagerPalette(props.context.theme)
  const session = createMemo(() => props.context.data.session.get(props.sessionID))
  const messages = createMemo(() => props.context.data.session.message.list(props.sessionID))
  const models = createMemo(() => props.context.data.location.model.list(session()?.location) ?? [])
  const usage = createMemo(() => contextUsage(messages(), models(), session()?.revert?.messageID))
  const estimate = createMemo(() => estimateUsageCost(messages(), models(), usageRates(props.context.options)))
  const requestedSessions = new Set<string>()

  createEffect(() => {
    const current = session()
    if (!current) return
    const fresh = [current].filter((item) => !requestedSessions.has(item.id))
    for (const item of fresh) requestedSessions.add(item.id)
    if (fresh.length === 0) return
    void Promise.all([
      ...fresh.flatMap((item) => [
        props.context.data.session.sync(item.id),
        props.context.data.session.message.sync(item.id),
      ]),
      props.context.data.location.model.sync(current.location),
    ]).catch((error) => console.error("[claude.sessions] Failed to sync usage breakdown", error))
  })

  const row = (label: string, value: () => number) => (
    <box flexDirection="row" justifyContent="space-between">
      <text fg={colors.muted}>{label}</text>
      <text fg={colors.text}>{formatCompactTokens(value())}</text>
    </box>
  )

  return (
    <box paddingTop={1}>
      <text fg={colors.text} attributes={TextAttributes.BOLD}>Token breakdown</text>
      {usage() ? (
        <box>
          <box flexDirection="row" justifyContent="space-between">
            <text fg={colors.muted}>Current context</text>
            <text fg={colors.text}>
              {formatCompactTokens(usage()!.tokens)}{usage()!.limit ? ` / ${formatCompactTokens(usage()!.limit!)}` : ""}
            </text>
          </box>
          {row("Fresh input", () => usage()!.breakdown.input)}
          {row("Cache read", () => usage()!.breakdown.cache.read)}
          {row("Cache write", () => usage()!.breakdown.cache.write)}
          {row("Output", () => usage()!.breakdown.output)}
          {row("Reasoning", () => usage()!.breakdown.reasoning)}
        </box>
      ) : <text fg={colors.muted}>No usage yet</text>}
      <box paddingTop={1}>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={colors.muted}>Session processed</text>
          <text fg={colors.text}>{formatCompactTokens(session() ? processedTokens([session()!]) : 0)}</text>
        </box>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={colors.muted}>{estimate().estimated ? estimate().zenEquivalent ? "Zen equivalent" : "Estimated cost" : "Calculated cost"}</text>
          <text fg={colors.text}>{estimate().estimated ? "≈ " : ""}{formatCost(estimate().cost)}</text>
        </box>
        {estimate().unpriced > 0
          ? <text fg={colors.muted}>{estimate().unpriced} unpriced response{estimate().unpriced === 1 ? "" : "s"}</text>
          : null}
      </box>
    </box>
  )
}

export function SessionPicker(props: { context: Plugin.Context; controller?: SessionController; archiveStore?: ArchiveStore; returnSessionID?: string; hostDialogInsets?: boolean }) {
  const dimensions = useTerminalDimensions()
  const colors = sessionManagerPalette(props.context.theme)
  // The dialog tracks the terminal, including phone keyboard/rotation changes.
  const mobile = () => dimensions().width < 70
  const offsetHostInsets = () => mobile() && props.hostDialogInsets !== false
  const height = () => Math.max(1, dimensions().height)
  const dialogHeight = () => mobile()
    ? height()
    : Math.max(1, Math.min(40, height() - 2))
  const detailedPreview = () => !!permission() || !!(selectedSession() && isArchived(selectedSession()!.id))
  const previewHeight = () => Math.min(detailedPreview() ? 20 : mobile() ? 8 : 6, Math.max(mobile() && detailedPreview() ? 9 : 5, Math.floor(height() * (mobile() ? 0.5 : 0.4))))
  const approvalButtonHeight = () => mobile() && dimensions().height >= 20 ? 3 : 1
  const controller = props.controller ?? createSessionController(props.context, props.archiveStore)
  if (!props.controller) onCleanup(() => controller.dispose())
  const {
    sessions, options, selectedValue, selectedIndex, selectedSession, selectedMessages, selectedStats,
    search, loading, ready, failure, attention, attentionErrors, changingLifecycle, rowPercents,
    visiblePreview, permission, inboxRequest, inboxOwner, inboxErrors, isInbox,
    previewLoading, previewError, replying, replyChoice, isArchived, isDeleted,
  } = controller.state
   const { select: setSelectedValue, search: searchSessions, loadMore, refresh, changeLifecycle, replyToPermission, toggleChildren } = controller.commands
  const route = props.context.ui.router.current()
  const currentSessionID = props.returnSessionID ?? (route.type === "session" ? route.sessionID : undefined)
  onCleanup(controller.attach(currentSessionID))
  let scroll: ScrollBoxRenderable | undefined
  let previewScroll: ScrollBoxRenderable | undefined

  createEffect(() => {
    visiblePreview()
    previewScroll?.scrollTo(0)
  })

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
    if (currentSessionID && isDeleted(currentSessionID)) {
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
      { bind: "ctrl+r", run: refresh },
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
        searchSessions(value ?? "")
      } },
      { bind: "j", run: () => moveSelection(1) },
      { bind: "shift+up", run: () => moveSelection(-8) },
      { bind: "shift+down", run: () => moveSelection(8) },
      { bind: "return", run: selectCurrent },
      { bind: "linefeed", run: selectCurrent },
       { bind: "right", run: selectCurrent },
       { bind: "space", run: (_input, event) => { if (!event?.repeated) toggleChildren() } },
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
      backgroundColor={colors.surface}
    >
      {failure() ? (
        <box paddingLeft={0} paddingRight={0}>
          <text fg={colors.error}>{failure()}</text>
        </box>
      ) : null}
      <Show when={ready()} fallback={<text fg={colors.muted}>Loading sessions…</text>}>
      {attentionErrors().size || [...attention().values()].includes("unavailable") ? (
        <text fg={colors.error}>Status unavailable · Ctrl+R to retry</text>
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
              const titleColor = () => active() ? colors.selected : option().state === "inactive" ? colors.muted : colors.text
              const heading = () => {
                const label = groupLabel(option().state)
                return label !== groupLabel(options()[index - 1]?.state ?? "new") ? label : undefined
              }
              const descriptionColor = () => active() ? colors.text : colors.muted
              const updating = () => changingLifecycle()?.has(option().value) ?? false
              const iconColor = () => {
                if (updating()) return colors.error
                if (option().statusState === "permission") return colors.permission
                if (option().statusState === "question") return colors.question
                if (option().statusState === "unavailable") return colors.error
                if (option().statusState === "running") return colors.selected
                return descriptionColor()
              }
              return (
                <>
                {heading() ? (
                  <box height={mobile() ? 2 : 3} flexShrink={0} paddingLeft={0} paddingRight={0}
                    border={["top"]} borderColor={colors.border}>
                    <text fg={colors.text} attributes={TextAttributes.BOLD}>{heading()}</text>
                  </box>
                ) : null}
                <box
                  id={`claude-session-row-${index}`}
                  height={1}
                  flexShrink={0}
                  flexDirection="row"
                  paddingLeft={0}
                  paddingRight={0}
                  backgroundColor={active() ? colors.surfaceRaised : colors.surface}
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
                      if (updating()) return (
                        <spinner id={`claude-session-spinner-${option().value}`} frames={SPINNER_FRAMES} interval={80} color={colors.error} />
                      )
                      const state = option().statusState
                      const icon = state === "running" ? "spinner"
                        : state === "permission" ? "!"
                         : state === "question" ? "?"
                         : state === "unavailable" ? "×"
                         : state === "checking" ? "…"
                        : state === "new" ? "+" : active() ? "❯" : ""
                      if (!icon) return null
                      if (icon === "❯") return (
                        <text fg={colors.selected} attributes={TextAttributes.BOLD}>{icon}</text>
                      )
                      return (
                        icon === "spinner" ? (
                          <spinner id={`claude-session-spinner-${option().value}`} frames={SPINNER_FRAMES} interval={80} color={iconColor()} />
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
                     {"childCount" in option() && option().childCount ? (
                       <text wrapMode="none" flexShrink={0} fg={descriptionColor()}
                         onMouseDown={(event) => {
                           if (event.button !== 0) return
                           event.stopPropagation()
                           event.preventDefault()
                           selectRowByValue(option().value)
                           toggleChildren()
                         }}>
                         {` ${option().expanded ? "▾" : "▸"} ${option().childCount} sub-agent${option().childCount === 1 ? "" : "s"}`}
                       </text>
                     ) : null}
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
        border={["top"]} borderColor={permission() ? colors.permission : colors.border}>
        <box flexGrow={1} minHeight={0} overflow="hidden" flexDirection="column">
        {(mobile() && selectedSession()) || inboxRequest() ? (
          <text id="claude-session-preview-title" maxHeight={2} flexShrink={0} fg={colors.text} attributes={TextAttributes.BOLD}>
            {inboxRequest() ? inboxOwner()?.title || inboxRequest()!.sessionID : options()[selectedIndex()]?.title}
          </text>
        ) : null}
        {!(mobile() && permission() && dimensions().height < 20) ? (
          <text height={1} flexShrink={0} wrapMode="none" fg={colors.muted}>{inboxRequest()
            ? `Known-location inbox${inboxOwner() ? ` · ${shortenLocation(props.context.ui.format.path(inboxOwner()!.location.directory))}` : ""}`
            : options()[selectedIndex()]?.description}</text>
        ) : null}
        {!inboxRequest() && (!mobile() || !permission()) ? (
        <box height={1} flexShrink={0} flexDirection="row" justifyContent="space-between">
           <text wrapMode="none" flexShrink={1} fg={colors.text} attributes={TextAttributes.BOLD}>
            {selectedStats().left}
          </text>
          <text flexShrink={0} fg={colors.muted} attributes={TextAttributes.BOLD}>
            {selectedStats().right}
          </text>
        </box>
        ) : null}
        {selectedSession() && !inboxRequest() && (!mobile() || !permission()) ? (
          <text id="claude-session-token-breakdown" height={1} flexShrink={0} wrapMode="none" fg={colors.muted}>
            {sessionTokenBreakdown(selectedSession()!, mobile())}
          </text>
        ) : null}
        {permission() ? (
          <>
            <text height={1} flexShrink={0} wrapMode="none" fg={colors.permission} attributes={TextAttributes.BOLD}>
              {previewError() ? `Preview unavailable: ${previewError()}` : `${permission()!.action} · 1/${visiblePreview()!.permissions.length}${isInbox() && visiblePreview()!.forms.length ? ` · ?${visiblePreview()!.forms.length}` : ""}${isInbox() && inboxErrors().length ? ` · ${inboxErrors().length} unavailable` : ""}`}
            </text>
            <scrollbox id="claude-session-request" ref={previewScroll} flexGrow={1} minHeight={0} scrollY scrollX={false}>
              <text fg={colors.text}>
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
                      backgroundColor={action().reply === "once" && !disabled() ? colors.selected : colors.surfaceRaised}
                      onMouseDown={(event) => {
                        if (event.button !== 0) return
                        event.stopPropagation()
                        event.preventDefault()
                        if (!disabled()) void replyToPermission(action().reply)
                      }}>
                      <text wrapMode="none" fg={action().reply === "once" && !disabled() ? colors.selectedText : disabled() ? colors.muted : colors.text}
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
            <text wrapMode="none" fg={colors.muted}>
              {selectedSession() && isArchived(selectedSession()!.id)
                ? `Archived · ${selectedMessages()?.length ?? 0} messages`
                : previewLoading() ? "Checking for approval requests…" : previewError() ? `Preview unavailable: ${previewError()}` : visiblePreview()?.forms.length ? `Question · ${visiblePreview()!.forms[0]!.title}` : isInbox() && inboxErrors().length ? `${inboxErrors().length} location${inboxErrors().length === 1 ? "" : "s"} unavailable` : options()[selectedIndex()]?.state === "inactive" ? (options()[selectedIndex()] as { inactiveByAge?: boolean })?.inactiveByAge ? "Inactive by age · no cleanup performed" : "Soft archived · history retained" : selectedSession() ? (options()[selectedIndex()] as { status?: string })?.status ?? "" : "Known-location inbox"}
            </text>
            {isInbox() && visiblePreview()?.forms.length ? (
              <scrollbox flexGrow={1} minHeight={0} scrollY scrollX={false}>
                <text fg={colors.text}>{visiblePreview()!.forms[0]!.fields.map((field) => field.title ?? field.key).join("\n")}</text>
              </scrollbox>
            ) : null}
            {selectedSession() && isArchived(selectedSession()!.id) ? (
              <scrollbox flexGrow={1} minHeight={0} scrollY scrollX={false}>
                <text fg={colors.text}>{(selectedMessages() ?? []).flatMap((message) =>
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
            <text id="claude-session-inbox-open" fg={colors.text} onMouseDown={(event) => {
              if (event.button !== 0) return
              event.stopPropagation()
              event.preventDefault()
              open(inboxRequest()!.sessionID)
            }}>{mobile() ? "[Open]" : "[Open request] "}</text>
          ) : null}
          {mobile() && (!selectedSession() || !isArchived(selectedSession()!.id)) ? (
            <text id="claude-session-open" fg={colors.text} onMouseDown={(event) => {
              if (event.button !== 0) return
              event.stopPropagation()
              event.preventDefault()
              selectCurrent()
            }}>{selectedSession() ? "[Open]" : "[New]"}</text>
          ) : null}
          {selectedSession() ? (
            <text id="claude-session-preview-lifecycle" wrapMode="none" fg={colors.text}
              onMouseDown={(event) => {
                if (event.button !== 0) return
                event.stopPropagation()
                event.preventDefault()
                void changeLifecycle(options()[selectedIndex()]?.state !== "inactive")
              }}>
              {changingLifecycle()?.has(selectedValue()) ? "[Updating…]" : options()[selectedIndex()]?.state === "inactive" ? "[Restore]" : "[Archive]"}
            </text>
          ) : null}
          {mobile() ? (
            <text id="claude-session-close" fg={colors.muted} onMouseDown={(event) => {
              if (event.button !== 0) return
              event.stopPropagation()
              event.preventDefault()
              close()
            }}>[Close]</text>
          ) : <text fg={colors.muted}>{search() ? ` · / filter: ${search()}` : " · / search"}</text>}
        </box>
      </box>
      {loading() ? (
        <box paddingLeft={0} paddingRight={0}>
          <text fg={colors.muted}>
            {sessions().length === 0 ? "Loading sessions…" : "Loading more…"}
          </text>
        </box>
      ) : null}
      </Show>
    </box>
  )
}

export function showSessionPicker(context: Plugin.Context, controller?: SessionController) {
  const route = context.ui.router.current()
  if (route.type !== "home" && route.type !== "session") return false

  const returnSessionID = route.type === "session" ? route.sessionID : undefined
  context.ui.dialog.show(() => <SessionPicker context={context} controller={controller} returnSessionID={returnSessionID} />)
  // show() resets host presentation options, so apply these after mounting.
  context.ui.dialog.set({ size: "xlarge", centered: true })
}

function EmptyPromptBinding(props: { context: Plugin.Context; controller: SessionController }) {
  const openPicker = () => showSessionPicker(props.context, props.controller)

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
    const controller = createSessionController(context)
    const unregisterSlot = context.ui.slot({
      append: "app",
      render: () => <EmptyPromptBinding context={context} controller={controller} />,
    })
    const unregisterUsage = context.ui.slot({
      append: "sidebar.content",
      render: ({ sessionID }) => <UsageBreakdown context={context} sessionID={sessionID} />,
    })
    return () => {
      unregisterSlot()
      unregisterUsage()
      controller.dispose()
    }
  },
})
