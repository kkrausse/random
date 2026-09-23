import type { Plugin } from "@opencode/plugin/tui"
import type { TokenUsageInfo } from "@opencode/client"

export type Stats = Awaited<ReturnType<Plugin.Context["client"]["session"]["stats"]>>
export type Range = "24h" | "today" | "7d" | "14d" | "30d"
export type Metric = "steps" | "output" | "cache" | "cost"

export function totalTokens(tokens: TokenUsageInfo): number {
  return tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
}

export function groupModels(models: Stats["models"]): Stats["models"] {
  const grouped = new Map<string, Stats["models"][number]>()
  for (const entry of models) {
    const key = `${entry.model.providerID}/${entry.model.id}`
    const existing = grouped.get(key)
    if (!existing) {
      grouped.set(key, {
        model: { providerID: entry.model.providerID, id: entry.model.id },
        steps: entry.steps,
        cost: entry.cost,
        tokens: { ...entry.tokens, cache: { ...entry.tokens.cache } },
      })
      continue
    }
    existing.steps += entry.steps
    existing.cost += entry.cost
    existing.tokens.input += entry.tokens.input
    existing.tokens.output += entry.tokens.output
    existing.tokens.reasoning += entry.tokens.reasoning
    existing.tokens.cache.read += entry.tokens.cache.read
    existing.tokens.cache.write += entry.tokens.cache.write
  }
  return [...grouped.values()]
}

export function bounds(range: Range, now: number): { from: number; to: number; width: number } {
  const day = 86_400_000
  if (range === "today") {
    const date = new Date(now)
    date.setHours(0, 0, 0, 0)
    return { from: date.getTime(), to: now, width: 2 * 3_600_000 }
  }
  if (range === "24h") return { from: now - day, to: now, width: 2 * 3_600_000 }
  const date = new Date(now)
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() - (range === "7d" ? 6 : range === "14d" ? 13 : 29))
  return { from: date.getTime(), to: now, width: day }
}

export function metricValue(stats: Stats, metric: Metric) {
  switch (metric) {
    case "steps": return stats.steps
    case "output": return stats.tokens.output
    case "cache": return stats.tokens.cache.read
    case "cost": return stats.cost
  }
}

export async function loadBuckets(
  client: Plugin.Context["client"],
  period: ReturnType<typeof bounds>,
  project: string | undefined,
  signal: AbortSignal,
  timezone: string,
): Promise<Stats[]> {
  const intervals: Array<{ from: number; to: number }> = []
  for (let from = period.from; from < period.to;) {
    let next = from + period.width
    if (period.width === 86_400_000) {
      const date = new Date(from)
      date.setDate(date.getDate() + 1)
      next = date.getTime()
    }
    intervals.push({ from, to: Math.min(next, period.to) })
    from = next
  }
  const result: Stats[] = new Array(intervals.length)
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(4, intervals.length) }, async () => {
    while (cursor < intervals.length) {
      signal.throwIfAborted()
      const index = cursor++
      result[index] = await client.session.stats({
        ...intervals[index]!, project, timezone, tools: "none",
      }, { signal })
    }
  }))
  return result
}

export function compact(value: number): string {
  return Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: value < 10_000 ? 1 : 0 }).format(value)
}

export function money(value: number): string {
  return value === 0 ? "$0" : `$${value < 0.01 ? value.toFixed(4) : value.toFixed(2)}`
}
