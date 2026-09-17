import type { ModelInfo, SessionInfo, SessionMessageAssistant, SessionMessageInfo } from "@opencode/client"

export function relativeTime(timestamp: number) {
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

export function shortenLocation(location: string) {
  const parts = location.split("/").filter((part) => part !== "")
  if (parts.length <= 4) return location
  return `…/${parts.slice(-3).join("/")}`
}

export function formatCompactTokens(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return `${Math.round(value)}`
}

export function formatCost(value: number) {
  if (value < 0.01 && value > 0) return `$${value.toFixed(4)}`
  return `$${value.toFixed(2)}`
}

// Mirrors the host sidebar: last assistant usage after completed compaction,
// before the revert boundary, measured against that message's model limit.
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

export function contextUsage(messages: ReadonlyArray<SessionMessageInfo> | undefined, models: ReadonlyArray<ModelInfo> | undefined, boundary?: string) {
  if (!messages) return undefined
  const last = lastAssistantWithUsage(messages, boundary)
  if (!last) return undefined
  const tokens = last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
  if (tokens <= 0) return undefined
  const model = models?.find((candidate) => candidate.providerID === last.model.providerID && candidate.id === last.model.id)
  return {
    tokens, breakdown: last.tokens,
    percent: model?.limit.context ? Math.round((tokens / model.limit.context) * 100) : undefined,
    limit: model?.limit.context, model: last.model,
  }
}

export function contextStats(
  session: SessionInfo | undefined,
  usage: { tokens: number; percent?: number; model?: { providerID: string; id: string } } | undefined,
  cost: number,
  syncing: boolean,
): { left: string; right: string } {
  if (!session) return { left: "New session", right: "" }
  if (!usage) {
    // Use cumulative totals until messages are synced or when no assistant has usage.
    const tokens = session.tokens
    const total = tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
    if (total <= 0) return syncing ? { left: "…", right: "" } : { left: "no usage yet", right: "" }
    return { left: `≈${formatCompactTokens(total)} · ${formatCost(cost || session.cost)}`, right: syncing ? "…" : "" }
  }
  const leftParts = [
    `${formatCompactTokens(usage.tokens)}`,
    usage.model ? `${usage.model.providerID}/${usage.model.id}` : undefined,
    cost > 0 ? `${formatCost(cost)}` : undefined,
  ]
  return { left: leftParts.filter(Boolean).join(" · "), right: usage.percent !== undefined ? `${usage.percent}%` : syncing ? "…" : "" }
}
